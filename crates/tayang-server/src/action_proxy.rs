//! The small loopback endpoint agents call to start a video or schedule videos. The desktop app
//! already exposes the same thing as `ai_proxy`; the web server must provide it too, otherwise the
//! bundled skill cannot start a project from a chat.
//!
//! Only actions and a clear "cloud assets unavailable" answer are exposed here. Image/voice
//! generation belongs to the optional Tayang cloud account and is not available in this edition.

use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAction {
    pub chat_id: String,
    pub name: &'static str,
    pub context: Value,
}

pub struct ActionProxy {
    port: u16,
    tokens: Arc<Mutex<HashMap<String, String>>>,
    actions: mpsc::UnboundedSender<AgentAction>,
}

impl ActionProxy {
    pub async fn start(actions: mpsc::UnboundedSender<AgentAction>) -> std::io::Result<Arc<Self>> {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        let proxy = Arc::new(Self { port, tokens: Arc::default(), actions });
        let router = Router::new()
            .route("/video", post(video))
            .route("/schedule", post(schedule))
            .route("/usage", get(usage))
            .route("/image", post(cloud_unavailable))
            .route("/voice", post(cloud_unavailable))
            .layer(DefaultBodyLimit::max(64 * 1024))
            .with_state(proxy.clone());
        tokio::spawn(async move {
            if let Err(e) = axum::serve(listener, router).await {
                tracing::warn!("agent action endpoint stopped: {e}");
            }
        });
        Ok(proxy)
    }

    /// A fresh token for this chat's agent process. Older tokens of the chat stop working.
    pub fn session_env(&self, chat_id: &str) -> Vec<(String, String)> {
        let token = format!("tai_{}", uuid::Uuid::new_v4().simple());
        {
            let mut tokens = self.tokens.lock().unwrap_or_else(|e| e.into_inner());
            tokens.retain(|_, chat| chat != chat_id);
            tokens.insert(token.clone(), chat_id.to_string());
        }
        vec![
            ("TAYANG_AI_URL".to_string(), format!("http://127.0.0.1:{}", self.port)),
            ("TAYANG_AI_TOKEN".to_string(), token),
        ]
    }

    fn chat_for(&self, headers: &HeaderMap) -> Option<String> {
        let raw = headers.get("authorization")?.to_str().ok()?;
        let token = raw.strip_prefix("Bearer ").or_else(|| raw.strip_prefix("bearer "))?.trim();
        self.tokens.lock().unwrap_or_else(|e| e.into_inner()).get(token).cloned()
    }

    fn authorized(&self, headers: &HeaderMap) -> Option<String> {
        self.chat_for(headers)
    }
}

fn unauthorized() -> Response {
    (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" }))).into_response()
}

async fn video(State(proxy): State<Arc<ActionProxy>>, headers: HeaderMap, body: String) -> Response {
    let Some(chat_id) = proxy.authorized(&headers) else {
        return unauthorized();
    };
    let body: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "body must be JSON" }))).into_response(),
    };
    let Some(title) = body.get("title").and_then(Value::as_str).map(str::trim).filter(|t| !t.is_empty()) else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "title is required" }))).into_response();
    };
    if title.chars().count() > 120 {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "title must be 120 characters or fewer" }))).into_response();
    }
    let mut context = json!({ "title": title });
    for key in ["kind", "styleId", "notes"] {
        if let Some(value) = body.get(key).and_then(Value::as_str).map(str::trim).filter(|v| !v.is_empty()) {
            context[key] = json!(value.chars().take(600).collect::<String>());
        }
    }
    if let Some(length) = body.get("lengthSec").and_then(Value::as_f64) {
        context["lengthSec"] = json!(length);
    }
    let _ = proxy.actions.send(AgentAction { chat_id, name: "pick_topic", context });
    Json(json!({ "ok": true })).into_response()
}

async fn schedule(State(proxy): State<Arc<ActionProxy>>, headers: HeaderMap, body: String) -> Response {
    let Some(chat_id) = proxy.authorized(&headers) else {
        return unauthorized();
    };
    let body: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "body must be JSON" }))).into_response(),
    };
    let Some(items) = body.get("items").and_then(Value::as_array) else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "items must be a list" }))).into_response();
    };
    if items.is_empty() || items.len() > 20 {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "items must hold 1 to 20 videos" }))).into_response();
    }
    let context = json!({ "items": items });
    let _ = proxy.actions.send(AgentAction { chat_id, name: "schedule_videos", context });
    Json(json!({ "ok": true })).into_response()
}

async fn usage(State(proxy): State<Arc<ActionProxy>>, headers: HeaderMap) -> Response {
    if proxy.authorized(&headers).is_none() {
        return unauthorized();
    }
    // The skill checks credits before planning. Saying honestly that this server has no cloud
    // assets lets it continue with the local video workflow instead of treating 404 as success.
    Json(json!({
        "signedIn": false,
        "credits": 0,
        "imagesAffordable": 0,
        "voiceMinutesAffordable": 0,
        "posts": 0,
        "message": "AI images and voice are not available in the self-hosted web edition. Build the video with local assets."
    }))
    .into_response()
}

async fn cloud_unavailable(State(proxy): State<Arc<ActionProxy>>, headers: HeaderMap) -> Response {
    if proxy.authorized(&headers).is_none() {
        return unauthorized();
    }
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({
            "error": "cloud-unavailable",
            "message": "AI images and voice need the external Tayang cloud API, which this self-hosted server does not bundle."
        })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_scoped_to_one_chat_and_rotate() {
        let (tx, _rx) = mpsc::unbounded_channel();
        // Constructing directly avoids opening a listener in this unit test.
        let proxy = ActionProxy { port: 1, tokens: Arc::default(), actions: tx };
        let first = proxy.session_env("chat-a");
        let token = first.iter().find(|(k, _)| k == "TAYANG_AI_TOKEN").unwrap().1.clone();
        assert_eq!(proxy.tokens.lock().unwrap().get(&token).map(String::as_str), Some("chat-a"));
        let second = proxy.session_env("chat-a");
        let new = second.iter().find(|(k, _)| k == "TAYANG_AI_TOKEN").unwrap().1.clone();
        assert_ne!(token, new);
        assert!(!proxy.tokens.lock().unwrap().contains_key(&token));
        assert_eq!(proxy.tokens.lock().unwrap().get(&new).map(String::as_str), Some("chat-a"));
    }
}
