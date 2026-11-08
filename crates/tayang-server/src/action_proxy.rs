//! The small loopback endpoint agents call to start a video or schedule videos. The desktop app
//! already exposes the same thing as `ai_proxy`; the web server must provide it too, otherwise the
//! bundled skill cannot start a project from a chat.
//!
//! Actions are delivered to the chat tab. Voice-over is forwarded to the local TTS sidecar with the
//! output path confined to the chat's own project folder. Cloud image generation is not part of
//! this edition, so `/image` and the old `/voice` route answer with an explicit error.

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
    chats: Arc<Mutex<HashMap<String, std::path::PathBuf>>>,
    actions: mpsc::UnboundedSender<AgentAction>,
    tts_url: Option<String>,
    tts_token: Option<String>,
    client: reqwest::Client,
}

impl ActionProxy {
    pub async fn start(
        actions: mpsc::UnboundedSender<AgentAction>,
        tts_url: Option<String>,
        tts_token: Option<String>,
    ) -> std::io::Result<Arc<Self>> {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        let proxy = Arc::new(Self {
            port,
            tokens: Arc::default(),
            chats: Arc::default(),
            actions,
            tts_url,
            tts_token,
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10 * 60))
                .build()
                .unwrap_or_default(),
        });
        let router = Router::new()
            .route("/video", post(video))
            .route("/schedule", post(schedule))
            .route("/usage", get(usage))
            .route("/speak", post(speak))
            .route("/image", post(cloud_unavailable))
            .route("/voice", post(cloud_unavailable))
            .layer(DefaultBodyLimit::max(1024 * 1024))
            .with_state(proxy.clone());
        tokio::spawn(async move {
            if let Err(e) = axum::serve(listener, router).await {
                tracing::warn!("agent action endpoint stopped: {e}");
            }
        });
        Ok(proxy)
    }

    /// A fresh token for this chat's agent process. Older tokens of the chat stop working.
    pub fn session_env(&self, chat_id: &str, cwd: &std::path::Path, tts_engine: &str, tts_voice: &str) -> Vec<(String, String)> {
        let token = format!("tai_{}", uuid::Uuid::new_v4().simple());
        {
            let mut tokens = self.tokens.lock().unwrap_or_else(|e| e.into_inner());
            tokens.retain(|_, chat| chat != chat_id);
            tokens.insert(token.clone(), chat_id.to_string());
            self.chats.lock().unwrap_or_else(|e| e.into_inner()).insert(chat_id.to_string(), cwd.to_path_buf());
        }
        let base = format!("http://127.0.0.1:{}", self.port);
        let mut env = vec![
            ("TAYANG_AI_URL".to_string(), base.clone()),
            ("TAYANG_AI_TOKEN".to_string(), token.clone()),
            ("TAYANG_TTS_URL".to_string(), base),
            ("TAYANG_TTS_TOKEN".to_string(), token),
            ("TAYANG_TTS_ENGINE".to_string(), tts_engine.to_string()),
            ("TAYANG_TTS_VOICE".to_string(), tts_voice.to_string()),
        ];
        if self.tts_url.is_none() {
            env.retain(|(k, _)| !k.starts_with("TAYANG_TTS_"));
        }
        env
    }

    fn cwd_for(&self, chat_id: &str) -> Option<std::path::PathBuf> {
        self.chats.lock().unwrap_or_else(|e| e.into_inner()).get(chat_id).cloned()
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

#[derive(serde::Deserialize)]
struct SpeakBody {
    text: String,
    #[serde(default)]
    engine: Option<String>,
    #[serde(default)]
    voice: Option<String>,
    #[serde(default)]
    language: Option<String>,
    out: String,
}

async fn speak(State(proxy): State<Arc<ActionProxy>>, headers: HeaderMap, body: String) -> Response {
    let Some(chat_id) = proxy.authorized(&headers) else {
        return unauthorized();
    };
    let Some(tts_url) = proxy.tts_url.as_deref() else {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({
            "error": "tts-unavailable",
            "message": "Local TTS is not configured on this server. Use a system text-to-speech voice or add the tts service."
        }))).into_response();
    };
    let body: SpeakBody = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "body must be JSON" }))).into_response(),
    };
    if body.text.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "text is required" }))).into_response();
    }
    let Some(cwd) = proxy.cwd_for(&chat_id) else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "unknown chat folder" }))).into_response();
    };
    let out = cwd.join(&body.out);
    if !tayang_core::projects::ensure_inside(&cwd, &out) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "out must stay inside the chat folder" }))).into_response();
    }
    let mut payload = json!({
        "text": body.text,
        "language": body.language.as_deref().unwrap_or("id"),
        "out": out,
    });
    if let Some(engine) = body.engine.as_deref().filter(|e| matches!(*e, "pocket" | "kokoro")) {
        payload["engine"] = json!(engine);
    }
    if let Some(voice) = body.voice.as_deref().filter(|v| !v.trim().is_empty()) {
        payload["voice"] = json!(voice);
    }
    let mut req = proxy.client.post(format!("{}/speak", tts_url.trim_end_matches('/'))).json(&payload);
    if let Some(token) = &proxy.tts_token {
        req = req.bearer_auth(token);
    }
    match req.send().await {
        Ok(res) => {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            (StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY), body).into_response()
        }
        Err(e) => (StatusCode::BAD_GATEWAY, Json(json!({ "error": "tts-unavailable", "message": format!("Local TTS is not reachable: {e}") }))).into_response(),
    }
}

async fn usage(State(proxy): State<Arc<ActionProxy>>, headers: HeaderMap) -> Response {
    if proxy.authorized(&headers).is_none() {
        return unauthorized();
    }
    // Kept for older bundled skills that ask before planning. The current skill goes straight to
    // `/speak`. Say plainly that this server has no cloud assets, and point at the local engine.
    Json(json!({
        "signedIn": false,
        "credits": 0,
        "imagesAffordable": 0,
        "voiceMinutesAffordable": 0,
        "posts": 0,
        "message": "This self-hosted server has no AI credits, paid plans or cloud assets. Narrate with the local voice at $TAYANG_TTS_URL/speak and build pictures in code."
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
        let proxy = ActionProxy {
            port: 1,
            tokens: Arc::default(),
            chats: Arc::default(),
            actions: tx,
            tts_url: None,
            tts_token: None,
            client: reqwest::Client::new(),
        };
        let cwd = std::path::Path::new("/tmp");
        let first = proxy.session_env("chat-a", cwd, "pocket", "pocket-id-1");
        let token = first.iter().find(|(k, _)| k == "TAYANG_AI_TOKEN").unwrap().1.clone();
        assert_eq!(proxy.tokens.lock().unwrap().get(&token).map(String::as_str), Some("chat-a"));
        let second = proxy.session_env("chat-a", cwd, "pocket", "pocket-id-1");
        let new = second.iter().find(|(k, _)| k == "TAYANG_AI_TOKEN").unwrap().1.clone();
        assert_ne!(token, new);
        assert!(!proxy.tokens.lock().unwrap().contains_key(&token));
        assert_eq!(proxy.tokens.lock().unwrap().get(&new).map(String::as_str), Some("chat-a"));
    }
}
