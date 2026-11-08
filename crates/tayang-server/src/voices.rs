//! Local voice management for the self-hosted edition.
//!
//! The engines live in the `tts` Compose sidecar (Pocket TTS for Indonesian and cloned voices,
//! Kokoro for its built-in voices). This module owns the owner-facing bits: listing what the
//! sidecar offers, storing uploaded reference clips in `/data/voices`, and keeping the chosen
//! default in `config.json`, which the sidecar and every new agent session read.

use crate::api::ApiError;
use crate::state::AppState;
use axum::extract::{Multipart, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

const MAX_VOICE_BYTES: usize = 20 * 1024 * 1024;
const AUDIO_EXTENSIONS: [&str; 5] = ["wav", "mp3", "flac", "ogg", "m4a"];

fn voices_dir(state: &AppState) -> PathBuf {
    state.data_dir.join("voices")
}

fn tts_url(state: &AppState) -> Result<&str, ApiError> {
    state.config.tts_service_url.as_deref().ok_or_else(|| {
        ApiError::unavailable(
            "Local voice isn't configured on this server. Add the `tts` service and set TAYANG_TTS_SERVICE_URL.",
        )
    })
}

fn client() -> Result<reqwest::Client, ApiError> {
    client_for(20)
}

fn client_for(secs: u64) -> Result<reqwest::Client, ApiError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(secs))
        .build()
        .map_err(|e| ApiError::internal(e.to_string()))
}

async fn call(state: &AppState, method: reqwest::Method, path: &str, body: Option<Value>, secs: u64) -> Result<Value, ApiError> {
    let url = tts_url(state)?;
    let mut req = client_for(secs)?
        .request(method, format!("{}{}", url.trim_end_matches('/'), path))
        .header(reqwest::header::ACCEPT, "application/json");
    if let Some(body) = body {
        req = req.json(&body);
    }
    if let Some(token) = state.config.tts_token.as_deref() {
        req = req.bearer_auth(token);
    }
    let res = req.send().await.map_err(|e| {
        ApiError::unavailable(format!("The local voice service isn't reachable: {e}"))
    })?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(ApiError::unavailable(format!(
            "The local voice service answered {status}: {}",
            body.chars().take(500).collect::<String>()
        )));
    }
    res.json()
        .await
        .map_err(|e| ApiError::internal(format!("The local voice service sent invalid JSON: {e}")))
}

/// Whether each engine's model is already downloaded/loaded in the sidecar.
pub async fn status(state: &AppState) -> Result<Json<Value>, ApiError> {
    Ok(Json(call(state, reqwest::Method::GET, "/status", None, 20).await?))
}

/// One-click setup: download and load the model now instead of on the first narration.
pub async fn prepare(state: &AppState, engine: &str) -> Result<Json<Value>, ApiError> {
    if !matches!(engine, "pocket" | "kokoro") {
        return Err(ApiError::bad("engine must be `pocket` or `kokoro`"));
    }
    Ok(Json(
        call(state, reqwest::Method::POST, "/prepare", Some(json!({ "engine": engine })), 30 * 60).await?,
    ))
}

/// A short sample of an engine/voice for Settings; the file lives under the served thumbs root.
pub async fn preview(state: &AppState, engine: &str, voice: Option<&str>, language: Option<&str>) -> Result<Json<Value>, ApiError> {
    if !matches!(engine, "pocket" | "kokoro") {
        return Err(ApiError::bad("engine must be `pocket` or `kokoro`"));
    }
    if let Some(voice) = voice {
        if !safe_voice_id(voice.trim()) {
            return Err(ApiError::bad("voice contains characters that aren't allowed"));
        }
    }
    let body = json!({
        "engine": engine,
        "voice": voice.map(str::trim).filter(|v| !v.is_empty()),
        "language": language.unwrap_or(if engine == "pocket" { "id" } else { "en" }),
    });
    Ok(Json(call(state, reqwest::Method::POST, "/preview", Some(body), 10 * 60).await?))
}

/// List engines and voices from the sidecar, with the saved default.
pub async fn list(state: &AppState) -> Result<Json<Value>, ApiError> {
    let url = tts_url(state)?;
    let mut req = client()?.get(format!("{}/voices", url.trim_end_matches('/')));
    if let Some(token) = state.config.tts_token.as_deref() {
        req = req.bearer_auth(token);
    }
    let res = req.send().await.map_err(|e| {
        ApiError::unavailable(format!("The local voice service isn't reachable: {e}"))
    })?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(ApiError::unavailable(format!(
            "The local voice service answered {status}: {}",
            body.chars().take(300).collect::<String>()
        )));
    }
    let body: Value = res
        .json()
        .await
        .map_err(|e| ApiError::internal(format!("The local voice service sent invalid JSON: {e}")))?;
    Ok(Json(body))
}

/// Save the default engine/voice shared by the sidecar and new agent sessions.
pub fn set_default(state: &AppState, engine: &str, voice: &str) -> Result<Json<Value>, ApiError> {
    if !matches!(engine, "pocket" | "kokoro") {
        return Err(ApiError::bad("engine must be `pocket` or `kokoro`"));
    }
    let voice = voice.trim();
    if voice.is_empty() || voice.chars().count() > 120 {
        return Err(ApiError::bad("voice must be 1 to 120 characters"));
    }
    if !safe_voice_id(voice) {
        return Err(ApiError::bad("voice contains characters that aren't allowed"));
    }
    let dir = voices_dir(state);
    if audio_extension(voice).is_some() && !dir.join(voice).is_file() {
        return Err(ApiError::bad("That uploaded voice doesn't exist"));
    }
    std::fs::create_dir_all(&dir).map_err(|e| ApiError::internal(e.to_string()))?;
    let path = dir.join("config.json");
    let body = json!({ "engine": engine, "voice": voice });
    let written = serde_json::to_vec_pretty(&body).map_err(|e| ApiError::internal(e.to_string()))?;
    std::fs::write(&path, written).map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(body))
}

/// Delete an uploaded reference clip. Built-in voices are names, not files, so they simply aren't
/// found here. Deleting the current default falls back to the first Pocket Indonesian voice.
pub fn delete(state: &AppState, voice: &str) -> Result<Json<Value>, ApiError> {
    let voice = voice.trim();
    if !safe_voice_id(voice) || !audio_extension(voice).is_some() {
        return Err(ApiError::bad("That isn't an uploaded voice"));
    }
    let dir = voices_dir(state);
    let path = dir.join(voice);
    if path
        .parent()
        .and_then(|p| p.canonicalize().ok())
        .zip(dir.canonicalize().ok())
        .is_some_and(|(parent, root)| parent != root)
    {
        return Err(ApiError::bad("That voice is outside the voices folder"));
    }
    if path.is_file() {
        std::fs::remove_file(&path).map_err(|e| ApiError::internal(e.to_string()))?;
    }
    let current = read_default(state);
    if current.get("voice").and_then(Value::as_str) == Some(voice) {
        let _ = set_default(state, "pocket", "pocket-id-1")?;
    }
    Ok(Json(json!({ "ok": true })))
}

/// The saved default, shared with agent sessions and the sidecar.
pub fn read_default(state: &AppState) -> Value {
    let path = voices_dir(state).join("config.json");
    let parsed = std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok());
    let engine = parsed
        .as_ref()
        .and_then(|v| v.get("engine"))
        .and_then(Value::as_str)
        .filter(|v| matches!(*v, "pocket" | "kokoro"))
        .unwrap_or("pocket");
    let voice = parsed
        .as_ref()
        .and_then(|v| v.get("voice"))
        .and_then(Value::as_str)
        .filter(|v| safe_voice_id(v))
        .unwrap_or("pocket-id-1");
    json!({ "engine": engine, "voice": voice })
}

/// A POST from the settings screen: one audio file becomes a cloneable reference voice.
pub async fn upload(State(state): State<Arc<AppState>>, mut multipart: Multipart) -> Response {
    let mut file: Option<(String, Vec<u8>)> = None;
    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name() != Some("file") {
            continue;
        }
        let filename = field.file_name().unwrap_or("voice").to_string();
        match field.bytes().await {
            Ok(bytes) => {
                if bytes.len() > MAX_VOICE_BYTES {
                    return error(StatusCode::PAYLOAD_TOO_LARGE, "too-large", "The voice clip is larger than 20 MB");
                }
                file = Some((filename, bytes.to_vec()));
            }
            Err(e) => return error(StatusCode::BAD_REQUEST, "invalid", &format!("Can't read the upload: {e}")),
        }
    }
    let Some((filename, bytes)) = file else {
        return error(StatusCode::BAD_REQUEST, "invalid", "No audio file was uploaded");
    };
    if bytes.is_empty() {
        return error(StatusCode::BAD_REQUEST, "invalid", "The audio file is empty");
    }
    let Some(ext) = audio_extension(&filename) else {
        return error(
            StatusCode::BAD_REQUEST,
            "invalid",
            "Use a WAV, MP3, FLAC, OGG or M4A recording",
        );
    };
    let stem = Path::new(&filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(sanitize_stem)
        .unwrap_or_else(|| "voice".to_string());
    let dir = voices_dir(&state);
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return error(StatusCode::INTERNAL_SERVER_ERROR, "server", &e.to_string());
    }
    // Never overwrite a clip: a second upload with the same name gets -2, -3, …
    let mut name = format!("{stem}.{ext}");
    let mut n = 2;
    while dir.join(&name).exists() {
        name = format!("{stem}-{n}.{ext}");
        n += 1;
    }
    let path = dir.join(&name);
    if let Err(e) = std::fs::write(&path, &bytes) {
        return error(StatusCode::INTERNAL_SERVER_ERROR, "server", &e.to_string());
    }
    (
        StatusCode::OK,
        Json(json!({
            "id": name,
            "name": Path::new(&name).file_stem().and_then(|s| s.to_str()).unwrap_or(&name),
            "custom": true
        })),
    )
        .into_response()
}

fn audio_extension(name: &str) -> Option<String> {
    let ext = Path::new(name).extension()?.to_str()?.to_ascii_lowercase();
    AUDIO_EXTENSIONS.contains(&ext.as_str()).then_some(ext)
}

fn safe_voice_id(voice: &str) -> bool {
    !voice.is_empty()
        && voice.len() <= 160
        && voice != "config.json"
        && voice
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        && !voice.contains("..")
}

fn sanitize_stem(stem: &str) -> String {
    let cleaned: String = stem
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '_' | '-') { c } else { '-' })
        .collect();
    let trimmed = cleaned.trim_matches('-').to_lowercase();
    if trimmed.is_empty() {
        "voice".to_string()
    } else {
        trimmed.chars().take(60).collect()
    }
}

fn error(status: StatusCode, code: &str, message: &str) -> Response {
    (status, Json(json!({ "error": code, "message": message }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upload_names_are_safe() {
        assert_eq!(sanitize_stem("My Voice (final)"), "my-voice--final");
        assert_eq!(sanitize_stem("../../etc/passwd"), "etc-passwd");
        assert_eq!(sanitize_stem("???"), "voice");
    }

    #[test]
    fn only_audio_extensions_are_accepted() {
        assert_eq!(audio_extension("a.WAV").as_deref(), Some("wav"));
        assert_eq!(audio_extension("a.mp3").as_deref(), Some("mp3"));
        assert_eq!(audio_extension("config.json"), None);
        assert_eq!(audio_extension("noext"), None);
    }

    #[test]
    fn the_saved_default_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(tmp.path());
        assert_eq!(read_default(&state), json!({ "engine": "pocket", "voice": "pocket-id-1" }));
        assert!(set_default(&state, "kokoro", "af_heart").is_ok());
        assert_eq!(read_default(&state), json!({ "engine": "kokoro", "voice": "af_heart" }));
        // Invalid engines never reach the file.
        assert!(set_default(&state, "cloud", "af_heart").is_err());
        assert_eq!(read_default(&state), json!({ "engine": "kokoro", "voice": "af_heart" }));
    }

    #[test]
    fn voice_ids_stay_in_the_voices_folder() {
        assert!(safe_voice_id("pocket-id-1"));
        assert!(safe_voice_id("my-voice.wav"));
        assert!(!safe_voice_id("../voice.wav"));
        assert!(!safe_voice_id("a/b.wav"));
        assert!(!safe_voice_id("config.json"));
        assert!(!safe_voice_id(""));
    }
}
