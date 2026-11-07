//! Single-user web authentication: an argon2id password, opaque server-side sessions, HttpOnly
//! cookies, CSRF tokens and same-origin checks. Separate from the optional Tayang cloud account.

use crate::state::AppState;
use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{Duration, Utc};
use rand::RngCore;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration as StdDuration, Instant};
use subtle::ConstantTimeEq;

pub const COOKIE: &str = "tayang_web_session";
const LOGIN_LIMIT: usize = 8;
const LOGIN_WINDOW: StdDuration = StdDuration::from_secs(10 * 60);

pub fn hash_password(password: &str) -> Result<String, String> {
    if password.len() < 8 {
        return Err("TAYANG_WEB_PASSWORD must be at least 8 characters".into());
    }
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| format!("can't hash the password: {e}"))
}

pub fn verify_password(hash: &str, password: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else { return false };
    Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Me {
    pub authenticated: bool,
    pub username: String,
    pub csrf_token: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Session {
    pub csrf: String,
}

#[derive(Debug, Clone, Default)]
pub struct LoginLimiter {
    attempts: Arc<Mutex<HashMap<String, Vec<Instant>>>>,
}

impl LoginLimiter {
    fn allowed(&self, key: &str) -> bool {
        let mut all = self.attempts.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        let list = all.entry(key.to_string()).or_default();
        list.retain(|at| now.duration_since(*at) < LOGIN_WINDOW);
        list.len() < LOGIN_LIMIT
    }

    fn fail(&self, key: &str) {
        self.attempts
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entry(key.to_string())
            .or_default()
            .push(Instant::now());
    }

    fn success(&self, key: &str) {
        self.attempts.lock().unwrap_or_else(|e| e.into_inner()).remove(key);
    }
}

pub fn token_hash(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub fn now_text() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

pub fn cookie_from(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    for part in raw.split(';') {
        let mut kv = part.trim().splitn(2, '=');
        if kv.next() == Some(COOKIE) {
            return kv.next().map(str::to_string).filter(|v| !v.is_empty());
        }
    }
    None
}

pub fn session_cookie(state: &AppState, token: &str) -> String {
    let max_age = state.config.session_hours * 3600;
    let mut c = format!("{COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}");
    if state.config.secure_cookies {
        c.push_str("; Secure");
    }
    c
}

pub fn clear_cookie() -> String {
    format!("{COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
}

// ---- sessions ----

pub fn create_session(state: &AppState) -> Result<(String, String), String> {
    let token = random_token();
    let csrf = random_token();
    let now = Utc::now();
    let expires = (now + Duration::hours(state.config.session_hours)).to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    state
        .db
        .with_conn(|conn| {
            conn.execute("DELETE FROM web_sessions WHERE expires_at <= ?1", [now_text()])?;
            conn.execute(
                "INSERT INTO web_sessions (token_hash, csrf, created_at, last_seen_at, expires_at) VALUES (?1,?2,?3,?4,?5)",
                rusqlite::params![token_hash(&token), csrf, now_text(), now_text(), expires],
            )
        })
        .map_err(|e| e.to_string())?;
    Ok((token, csrf))
}

pub fn validate_session(state: &AppState, token: &str) -> Option<Session> {
    let hash = token_hash(token);
    let found: Option<(String, String)> = state
        .db
        .with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT csrf, expires_at FROM web_sessions WHERE token_hash = ?1")?;
            let row = stmt
                .query_row([&hash], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .ok();
            Ok(row)
        })
        .ok()
        .flatten();
    let (csrf, expires) = found?;
    let expired = chrono::DateTime::parse_from_rfc3339(&expires)
        .map(|t| t.with_timezone(&Utc) <= Utc::now())
        .unwrap_or(true);
    if expired {
        let _ = state.db.with_conn(|conn| conn.execute("DELETE FROM web_sessions WHERE token_hash = ?1", [&hash]));
        return None;
    }
    // Sliding expiry: an open tab stays signed in; a stolen idle cookie still dies.
    let next = (Utc::now() + Duration::hours(state.config.session_hours)).to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let _ = state.db.with_conn(|conn| {
        conn.execute(
            "UPDATE web_sessions SET last_seen_at = ?2, expires_at = ?3 WHERE token_hash = ?1",
            rusqlite::params![hash, now_text(), next],
        )
    });
    Some(Session { csrf })
}

pub fn delete_session(state: &AppState, token: &str) {
    let _ = state
        .db
        .with_conn(|conn| conn.execute("DELETE FROM web_sessions WHERE token_hash = ?1", [token_hash(token)]));
}

// ---- origin and CSRF ----

fn origin_ok(state: &AppState, headers: &HeaderMap) -> bool {
    if headers
        .get("sec-fetch-site")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.eq_ignore_ascii_case("cross-site"))
    {
        return false;
    }
    let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) else {
        // Non-browser clients (curl, tests) send no Origin. The CSRF token still gates mutations.
        return true;
    };
    if origin == "null" {
        return false;
    }
    let origin = origin.trim_end_matches('/');
    if origin.eq_ignore_ascii_case(&state.config.public_origin()) {
        return true;
    }
    // The reverse proxy may keep the browser's Host. Allow exactly that origin too; a cross-site
    // attacker's Origin never matches the Host it is sending the request to.
    if let Some(host) = headers.get(header::HOST).and_then(|v| v.to_str().ok()) {
        if let Some(scheme) = origin.split_once("://").map(|(s, _)| s) {
            if origin.eq_ignore_ascii_case(&format!("{scheme}://{host}")) {
                return true;
            }
        }
    }
    false
}

fn csrf_ok(headers: &HeaderMap, session: &Session) -> bool {
    let Some(sent) = headers.get("x-csrf-token").and_then(|v| v.to_str().ok()) else {
        return false;
    };
    sent.as_bytes().ct_eq(session.csrf.as_bytes()).into()
}

pub fn client_ip(state: &AppState, headers: &HeaderMap, fallback: &str) -> String {
    if state.config.trust_proxy {
        if let Some(forwarded) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
            if let Some(first) = forwarded.split(',').next().map(str::trim).filter(|v| !v.is_empty()) {
                return first.to_string();
            }
        }
        if let Some(real) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
            if !real.trim().is_empty() {
                return real.trim().to_string();
            }
        }
    }
    fallback.to_string()
}

// ---- login / logout ----

#[derive(serde::Deserialize)]
pub struct LoginBody {
    pub password: String,
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    axum::extract::ConnectInfo(peer): axum::extract::ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<LoginBody>,
) -> Response {
    if !origin_ok(&state, &headers) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error":"origin","message":"Cross-origin sign-in is not allowed"}))).into_response();
    }
    let ip = client_ip(&state, &headers, &peer.ip().to_string());
    if !state.login_limiter.allowed(&ip) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({"error":"rate-limited","message":"Too many sign-in attempts. Wait a few minutes."})),
        )
            .into_response();
    }
    if !verify_password(&state.config.password_hash, &body.password) {
        state.login_limiter.fail(&ip);
        // No detail: never say whether a password is close.
        return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error":"invalid","message":"Wrong password"}))).into_response();
    }
    state.login_limiter.success(&ip);
    let (token, csrf) = match create_session(&state) {
        Ok(v) => v,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error":"storage","message":e}))).into_response(),
    };
    let mut res = Json(serde_json::json!({"ok": true, "csrfToken": csrf})).into_response();
    if let Ok(v) = header::HeaderValue::from_str(&session_cookie(&state, &token)) {
        res.headers_mut().append(header::SET_COOKIE, v);
    }
    res
}

pub async fn logout(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if let Some(token) = cookie_from(&headers) {
        delete_session(&state, &token);
    }
    let mut res = Json(serde_json::json!({"ok": true})).into_response();
    if let Ok(v) = header::HeaderValue::from_str(&clear_cookie()) {
        res.headers_mut().append(header::SET_COOKIE, v);
    }
    res
}

pub async fn me(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let session = cookie_from(&headers).and_then(|t| validate_session(&state, &t));
    Json(Me {
        authenticated: session.is_some(),
        username: "owner".into(),
        csrf_token: session.map(|s| s.csrf),
    })
    .into_response()
}

// ---- protected-route middleware ----

pub async fn require_auth(State(state): State<Arc<AppState>>, mut request: Request, next: Next) -> Response {
    let headers = request.headers();
    let Some(token) = cookie_from(headers) else {
        return unauthorized();
    };
    let Some(session) = validate_session(&state, &token) else {
        return unauthorized();
    };
    let method = request.method().clone();
    if matches!(method, Method::POST | Method::PUT | Method::PATCH | Method::DELETE) {
        if !origin_ok(&state, headers) {
            return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error":"origin","message":"Cross-origin request refused"}))).into_response();
        }
        if !csrf_ok(headers, &session) {
            return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error":"csrf","message":"Missing or invalid CSRF token"}))).into_response();
        }
    }
    request.extensions_mut().insert(session);
    next.run(request).await
}

fn unauthorized() -> Response {
    (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error":"unauthorized","message":"Sign in to continue"}))).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, HeaderValue};

    #[test]
    fn argon2_round_trip_and_wrong_password() {
        let hash = hash_password("correct horse battery staple").unwrap();
        assert!(verify_password(&hash, "correct horse battery staple"));
        assert!(!verify_password(&hash, "wrong"));
        assert!(hash.starts_with("$argon2"));
        assert!(hash_password("short").is_err());
    }

    #[test]
    fn session_can_be_validated_and_revoked() {
        let tmp = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(tmp.path());
        let (token, csrf) = create_session(&state).unwrap();
        let session = validate_session(&state, &token).expect("session");
        assert_eq!(session.csrf, csrf);
        delete_session(&state, &token);
        assert!(validate_session(&state, &token).is_none());
        // Unknown tokens are rejected.
        assert!(validate_session(&state, "nope").is_none());
    }

    #[test]
    fn an_expired_session_is_rejected_even_if_the_cookie_is_still_sent() {
        let tmp = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(tmp.path());
        let (token, _) = create_session(&state).unwrap();
        state
            .db
            .with_conn(|conn| {
                conn.execute(
                    "UPDATE web_sessions SET expires_at = '2000-01-01T00:00:00Z' WHERE token_hash = ?1",
                    [token_hash(&token)],
                )
            })
            .unwrap();
        assert!(validate_session(&state, &token).is_none());
    }

    #[test]
    fn cookie_parser_takes_the_session_value_only() {
        let mut h = HeaderMap::new();
        h.insert(header::COOKIE, HeaderValue::from_static("a=1; tayang_web_session=abc; b=2"));
        assert_eq!(cookie_from(&h).as_deref(), Some("abc"));
        h.insert(header::COOKIE, HeaderValue::from_static("a=1"));
        assert_eq!(cookie_from(&h), None);
    }

    #[test]
    fn origin_checks_refuse_cross_site_and_allow_same_origin() {
        let tmp = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(tmp.path());
        let same = |origin: &str, host: Option<&str>, fetch_site: Option<&str>| {
            let mut h = HeaderMap::new();
            h.insert(header::ORIGIN, HeaderValue::from_str(origin).unwrap());
            if let Some(host) = host {
                h.insert(header::HOST, HeaderValue::from_str(host).unwrap());
            }
            if let Some(site) = fetch_site {
                h.insert("sec-fetch-site", HeaderValue::from_str(site).unwrap());
            }
            origin_ok(&state, &h)
        };
        assert!(same("http://127.0.0.1:8787", None, None));
        assert!(same("http://127.0.0.1:8787", Some("127.0.0.1:8787"), None));
        assert!(!same("https://evil.example", Some("127.0.0.1:8787"), None));
        assert!(!same("http://127.0.0.1:8787", None, Some("cross-site")));
        assert!(!same("null", None, None));
    }

    #[test]
    fn csrf_must_match_the_session_token() {
        let session = Session { csrf: "abc123".into() };
        let mut h = HeaderMap::new();
        h.insert("x-csrf-token", HeaderValue::from_static("abc123"));
        assert!(csrf_ok(&h, &session));
        h.insert("x-csrf-token", HeaderValue::from_static("abc124"));
        assert!(!csrf_ok(&h, &session));
        h.remove("x-csrf-token");
        assert!(!csrf_ok(&h, &session));
    }
}
