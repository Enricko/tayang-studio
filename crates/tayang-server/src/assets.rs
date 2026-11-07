//! Authorized media serving with HTTP Range support. The browser seeks rendered videos through
//! `Range`, and every request is checked against the configured workspace roots.

use crate::paths;
use crate::state::AppState;
use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use std::io::SeekFrom;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;

#[derive(Deserialize)]
pub struct AssetQuery {
    pub path: String,
    #[serde(default)]
    pub download: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}

fn parse_range(raw: &str, len: u64) -> Option<(u64, u64)> {
    let raw = raw.strip_prefix("bytes=")?;
    // Only one range is supported; browsers ask for one for video seeking.
    let part = raw.split(',').next()?.trim();
    let (start, end) = part.split_once('-')?;
    if start.is_empty() {
        let suffix: u64 = end.parse().ok()?;
        if suffix == 0 || len == 0 {
            return None;
        }
        let start = len.saturating_sub(suffix);
        return Some((start, len - 1));
    }
    let start: u64 = start.parse().ok()?;
    if start >= len {
        return None;
    }
    let end = if end.is_empty() { len - 1 } else { end.parse::<u64>().ok()?.min(len - 1) };
    (end >= start).then_some((start, end))
}

fn ascii_filename(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ') { c } else { '_' })
        .collect::<String>()
        .trim()
        .replace(' ', "_")
}

pub async fn serve(
    State(state): State<Arc<AppState>>,
    method: Method,
    headers: HeaderMap,
    Query(q): Query<AssetQuery>,
) -> Response {
    let path = match paths::resolve_asset(&state, &q.path) {
        Ok(p) => p,
        Err(message) => return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "not-found", "message": message }))).into_response(),
    };
    let meta = match tokio::fs::metadata(&path).await {
        Ok(m) => m,
        Err(_) => return (StatusCode::NOT_FOUND, "not found").into_response(),
    };
    let len = meta.len();
    let etag = paths::etag(&meta);
    if headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.split(',').any(|x| x.trim() == etag))
    {
        return (StatusCode::NOT_MODIFIED, [(header::ETAG, etag.as_str())]).into_response();
    }
    let mut builder = Response::builder()
        .header(header::CONTENT_TYPE, paths::content_type(&path))
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ETAG, etag.as_str())
        .header(header::CACHE_CONTROL, "private, max-age=0, must-revalidate");
    if let Ok(modified) = meta.modified() {
        if let Some(dt) = chrono::DateTime::<chrono::Utc>::from_timestamp(
            modified.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0),
            0,
        ) {
            if let Ok(v) = HeaderValue::from_str(&dt.format("%a, %d %b %Y %H:%M:%S GMT").to_string()) {
                builder = builder.header(header::LAST_MODIFIED, v);
            }
        }
    }
    if q.download.as_deref() == Some("1") {
        let name = q.name.as_deref().unwrap_or_else(|| path.file_name().and_then(|n| n.to_str()).unwrap_or("download"));
        let disp = format!("attachment; filename=\"{}\"; filename*=UTF-8''{}", ascii_filename(name), urlencode(name));
        builder = builder.header(header::CONTENT_DISPOSITION, disp);
    } else if paths::content_type(&path) == "application/octet-stream" {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
        builder = builder.header(header::CONTENT_DISPOSITION, format!("inline; filename=\"{}\"", ascii_filename(name)));
    }
    let range = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| parse_range(v, len));
    if headers.get(header::RANGE).is_some() && range.is_none() {
        return (
            StatusCode::RANGE_NOT_SATISFIABLE,
            [(header::CONTENT_RANGE, format!("bytes */{len}"))],
        )
            .into_response();
    }
    let (start, end) = range.unwrap_or((0, len.saturating_sub(1)));
    let length = if len == 0 { 0 } else { end - start + 1 };
    if len == 0 {
        return builder
            .status(StatusCode::OK)
            .header(header::CONTENT_LENGTH, "0")
            .body(Body::empty())
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
    }
    let mut file = match tokio::fs::File::open(&path).await {
        Ok(f) => f,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    if start > 0 && file.seek(SeekFrom::Start(start)).await.is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    let reader = file.take(length);
    let body = Body::from_stream(ReaderStream::new(reader));
    let status = if range.is_some() { StatusCode::PARTIAL_CONTENT } else { StatusCode::OK };
    if range.is_some() {
        builder = builder.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"));
    }
    let resp = builder
        .status(status)
        .header(header::CONTENT_LENGTH, length.to_string())
        .body(body)
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
    if method == Method::HEAD {
        let mut head = resp;
        *head.body_mut() = Body::empty();
        return head;
    }
    resp
}

fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}
