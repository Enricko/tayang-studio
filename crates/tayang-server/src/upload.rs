//! Browser uploads. Files are staged under the server data directory, copied into the chat's own
//! attachments folder, and never read from an arbitrary client-supplied server path.

use crate::state::AppState;
use axum::extract::{Multipart, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;
use std::sync::Arc;
use tayang_core::types::MessagePart;

pub async fn upload(State(state): State<Arc<AppState>>, mut multipart: Multipart) -> Response {
    let mut chat_id: Option<String> = None;
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or_default().to_string();
        if name == "chatId" {
            chat_id = field.text().await.ok();
            continue;
        }
        if name != "file" && name != "files" {
            continue;
        }
        let filename = field.file_name().unwrap_or("upload").to_string();
        let bytes = match field.bytes().await {
            Ok(b) => b,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "invalid", "message": format!("Can't read the upload: {e}") })),
                )
                    .into_response()
            }
        };
        if bytes.len() as u64 > tayang_core::service::MAX_ATTACHMENT {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                Json(json!({ "error": "too-large", "message": "That file is larger than 50 MB" })),
            )
                .into_response();
        }
        files.push((filename, bytes.to_vec()));
    }
    let Some(chat_id) = chat_id.filter(|c| !c.trim().is_empty()) else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid", "message": "chatId is required" }))).into_response();
    };
    if files.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid", "message": "No file was uploaded" }))).into_response();
    }
    let cwd = match tayang_core::service::agent_cwd(&state.db, &state.working(), &chat_id) {
        Ok(c) => c,
        Err(message) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid", "message": message }))).into_response(),
    };
    let mut parts = Vec::new();
    for (filename, bytes) in files {
        let dir = state.data_dir.join("tmp").join(uuid::Uuid::new_v4().to_string());
        if let Err(e) = std::fs::create_dir_all(&dir) {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "server", "message": e.to_string() }))).into_response();
        }
        let safe = filename
            .rsplit(['/', '\\'])
            .next()
            .filter(|n| !n.is_empty() && *n != "." && *n != "..")
            .unwrap_or("upload");
        let staged = dir.join(safe);
        if let Err(e) = std::fs::write(&staged, &bytes) {
            let _ = std::fs::remove_dir_all(&dir);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "server", "message": e.to_string() }))).into_response();
        }
        let part: Result<MessagePart, String> =
            tayang_core::service::copy_attachment(&cwd, &staged, tayang_core::service::MAX_ATTACHMENT);
        let _ = std::fs::remove_dir_all(&dir);
        match part {
            Ok(p) => parts.push(p),
            Err(message) => {
                return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid", "message": message }))).into_response()
            }
        }
    }
    (StatusCode::OK, Json(json!(parts))).into_response()
}

/// Upload a file into a project folder (server-managed storage): `?projectId=..&dir=..`.
pub async fn upload_project(State(state): State<Arc<AppState>>, mut multipart: Multipart) -> Response {
    let mut project_id: Option<String> = None;
    let mut rel_dir = String::new();
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    while let Ok(Some(field)) = multipart.next_field().await {
        match field.name().unwrap_or_default() {
            "projectId" => project_id = field.text().await.ok(),
            "dir" => rel_dir = field.text().await.unwrap_or_default(),
            "file" | "files" => {
                let filename = field.file_name().unwrap_or("upload").to_string();
                match field.bytes().await {
                    Ok(b) => {
                        if b.len() as u64 > tayang_core::service::MAX_ATTACHMENT {
                            return (StatusCode::PAYLOAD_TOO_LARGE, Json(json!({ "error": "too-large", "message": "That file is larger than 50 MB" }))).into_response();
                        }
                        files.push((filename, b.to_vec()));
                    }
                    Err(e) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid", "message": e.to_string() }))).into_response(),
                }
            }
            _ => {}
        }
    }
    let Some(project_id) = project_id else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid", "message": "projectId is required" }))).into_response();
    };
    let folder = match crate::paths::project_folder(&state, &project_id) {
        Ok(f) => f,
        Err(message) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid", "message": message }))).into_response(),
    };
    let target_dir = if rel_dir.trim().is_empty() {
        folder.clone()
    } else {
        match tayang_core::files::resolve(&folder, &rel_dir) {
            Ok(p) => p,
            Err(message) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid", "message": message }))).into_response(),
        }
    };
    if !target_dir.is_dir() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid", "message": "That folder isn't there" }))).into_response();
    }
    let mut saved = Vec::new();
    for (filename, bytes) in files {
        let safe = filename.rsplit(['/', '\\']).next().filter(|n| !n.is_empty() && *n != "." && *n != "..").unwrap_or("upload");
        let dest = target_dir.join(safe);
        if !tayang_core::projects::ensure_inside(&folder, &dest) {
            return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid", "message": "That path leaves the project" }))).into_response();
        }
        if let Err(e) = std::fs::write(&dest, bytes) {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "server", "message": e.to_string() }))).into_response();
        }
        saved.push(dest.to_string_lossy().into_owned());
    }
    (StatusCode::OK, Json(json!(saved))).into_response()
}
