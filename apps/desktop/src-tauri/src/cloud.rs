//! The Tayang account's paid features through the Tayang API: credits and auto-posts left, social
//! accounts, posting a video, and AI images and voice. The sign-in token stays in Rust; the webview
//! (and an agent) only ever see what the API answered.

use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use crate::styles_sync::endpoint;

/// What went wrong, as the kebab-case code the UI (and an agent) gets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CloudError {
    SignedOut,
    /// The plan has none of this (no AI credits, no auto-posts).
    PlanRequired,
    /// This cycle's allowance is used up.
    QuotaExceeded,
    /// The feature isn't set up on the server, or the provider is busy.
    Unavailable,
    /// The provider failed.
    Provider,
    NotFound,
    /// The same request is still running.
    InProgress,
    /// A post that already went out can't be cancelled.
    AlreadyPosted,
    Invalid,
    Network,
    Server,
    /// A URL the API gave isn't one Tayang will fetch or open.
    BadUrl,
    /// What came back is bigger than Tayang keeps.
    TooLarge,
}

impl CloudError {
    pub fn code(self) -> String {
        serde_json::to_value(self).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default()
    }
}

/// The API's `{ error }` code first (it is more exact), then the status.
fn error_for(status: u16, body: &[u8]) -> CloudError {
    let code = serde_json::from_slice::<Value>(body).ok().and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_string));
    match code.as_deref() {
        Some("unauthorized") => CloudError::SignedOut,
        Some("plan_required") => CloudError::PlanRequired,
        Some("quota_exceeded") => CloudError::QuotaExceeded,
        Some("ai_unavailable" | "posting_unavailable") => CloudError::Unavailable,
        Some("provider") => CloudError::Provider,
        Some("not_found") => CloudError::NotFound,
        Some("in_progress") => CloudError::InProgress,
        Some("already_posted") => CloudError::AlreadyPosted,
        Some("invalid_request") => CloudError::Invalid,
        _ => match status {
            401 => CloudError::SignedOut,
            402 => CloudError::QuotaExceeded,
            403 => CloudError::PlanRequired,
            404 => CloudError::NotFound,
            409 => CloudError::InProgress,
            400 => CloudError::Invalid,
            502 => CloudError::Provider,
            503 => CloudError::Unavailable,
            _ => CloudError::Server,
        },
    }
}

async fn finish(res: Result<reqwest::Response, reqwest::Error>) -> Result<Value, CloudError> {
    let res = res.map_err(|_| CloudError::Network)?;
    let status = res.status().as_u16();
    let body = res.bytes().await.map_err(|_| CloudError::Network)?;
    if !(200..300).contains(&status) {
        return Err(error_for(status, &body));
    }
    if body.is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_slice(&body).map_err(|_| CloudError::Server)
}

/// `GET {base}{path}` with the sign-in token.
pub async fn get(client: &reqwest::Client, base: &str, token: &str, path: &str) -> Result<Value, CloudError> {
    finish(client.get(endpoint(base, path)).bearer_auth(token).send().await).await
}

/// `POST` (or another method) with a JSON body and the sign-in token.
pub async fn send(client: &reqwest::Client, method: reqwest::Method, base: &str, token: &str, path: &str, body: Option<&Value>) -> Result<Value, CloudError> {
    let mut req = client.request(method, endpoint(base, path)).bearer_auth(token);
    if let Some(b) = body {
        req = req.header(reqwest::header::CONTENT_TYPE, "application/json").body(b.to_string());
    }
    finish(req.send().await).await
}

/// Only https URLs are fetched, uploaded to or opened from what the API said.
pub fn is_https(u: &str) -> bool {
    reqwest::Url::parse(u).is_ok_and(|u| u.scheme() == "https" && u.host_str().is_some())
}

/// PUTs a file to the signed upload URL PostForMe gave (no token: the URL is the permission).
pub async fn upload(client: &reqwest::Client, upload_url: &str, file: &Path, content_type: &str) -> Result<(), CloudError> {
    if !is_https(upload_url) {
        return Err(CloudError::BadUrl);
    }
    let bytes = tokio::fs::read(file).await.map_err(|_| CloudError::NotFound)?;
    let res = client
        .put(upload_url)
        .header(reqwest::header::CONTENT_TYPE, content_type)
        .timeout(std::time::Duration::from_secs(600))
        .body(bytes)
        .send()
        .await
        .map_err(|_| CloudError::Network)?;
    if res.status().is_success() {
        Ok(())
    } else {
        Err(CloudError::Provider)
    }
}

/// Downloads what a provider made (an image, a voice) to `dest`, at most `max` bytes. The file is
/// written next to `dest` first and moved into place, so a failed download leaves nothing behind.
pub async fn download(client: &reqwest::Client, url: &str, dest: &Path, max: u64) -> Result<u64, CloudError> {
    if !is_https(url) {
        return Err(CloudError::BadUrl);
    }
    let res = client.get(url).timeout(std::time::Duration::from_secs(120)).send().await.map_err(|_| CloudError::Network)?;
    if !res.status().is_success() {
        return Err(CloudError::Provider);
    }
    if res.content_length().is_some_and(|n| n > max) {
        return Err(CloudError::TooLarge);
    }
    let body = res.bytes().await.map_err(|_| CloudError::Network)?;
    if body.len() as u64 > max {
        return Err(CloudError::TooLarge);
    }
    if let Some(dir) = dest.parent() {
        tokio::fs::create_dir_all(dir).await.map_err(|_| CloudError::Server)?;
    }
    let tmp = dest.with_extension("part");
    tokio::fs::write(&tmp, &body).await.map_err(|_| CloudError::Server)?;
    tokio::fs::rename(&tmp, dest).await.map_err(|_| CloudError::Server)?;
    Ok(body.len() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::http_client;
    use crate::auth::tests::fake;

    #[tokio::test]
    async fn api_errors_become_codes() {
        let f = fake(|r, _| match r.path.as_str() {
            "/api/v1/usage" => (200, r#"{"plan":"lite"}"#.into()),
            "/api/v1/ai/image" => (403, r#"{"error":"plan_required"}"#.into()),
            "/api/v1/social/posts" => (402, r#"{"error":"quota_exceeded","usage":{}}"#.into()),
            "/api/v1/social/accounts" => (503, r#"{"error":"posting_unavailable"}"#.into()),
            _ => (500, "oops".into()),
        })
        .await;
        let c = http_client().unwrap();
        assert_eq!(get(&c, &f.base, "tyg_a", "/v1/usage").await.unwrap()["plan"], "lite");
        assert_eq!(f.hits("/api/v1/usage")[0].auth.as_deref(), Some("Bearer tyg_a"));
        let empty = serde_json::json!({});
        let post = |path: &'static str| send(&c, reqwest::Method::POST, &f.base, "tyg_a", path, Some(&empty));
        assert_eq!(post("/v1/ai/image").await, Err(CloudError::PlanRequired));
        assert_eq!(post("/v1/social/posts").await, Err(CloudError::QuotaExceeded));
        assert_eq!(get(&c, &f.base, "tyg_a", "/v1/social/accounts").await, Err(CloudError::Unavailable));
        assert_eq!(get(&c, &f.base, "tyg_a", "/v1/else").await, Err(CloudError::Server));
        assert_eq!(CloudError::PlanRequired.code(), "plan-required");
    }

    #[tokio::test]
    async fn only_https_is_fetched_or_uploaded() {
        let c = http_client().unwrap();
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(download(&c, "http://example.com/a.jpg", &dir.path().join("a.jpg"), 10).await, Err(CloudError::BadUrl));
        assert_eq!(upload(&c, "file:///etc/passwd", &dir.path().join("a"), "video/mp4").await, Err(CloudError::BadUrl));
        assert!(is_https("https://v3.fal.media/x.jpg"));
        assert!(!is_https("javascript:alert(1)"));
    }
}
