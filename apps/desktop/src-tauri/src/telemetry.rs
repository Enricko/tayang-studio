//! Anonymous install ping: a random install id, the OS and its version, the CPU architecture
//! and the app version, at most once a day. Nothing about the user, their videos or their paths.

use crate::db::Db;
use crate::types::*;
use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use std::path::Path;

const PING_EVERY_HOURS: i64 = 24;
const PING_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Body of `POST /v1/telemetry/ping`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryPing {
    pub install_id: String,
    pub platform: OsKind,
    pub os_version: String,
    pub arch: String,
    pub app_version: String,
}

pub fn build_ping(install_id: &str, info: &SystemInfo) -> TelemetryPing {
    TelemetryPing {
        install_id: install_id.to_string(),
        platform: info.os,
        os_version: info.os_version.chars().take(64).collect(),
        arch: std::env::consts::ARCH.to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

/// Whether a ping should go out now: sharing is on, an API is set, and the last one is over 24 hours old.
/// `api_url` is the effective one (`styles_sync::effective_api_url`).
pub fn is_due(s: &Settings, api_url: &str, now: DateTime<Utc>) -> bool {
    if !s.share_install_stats || api_url.trim().is_empty() {
        return false;
    }
    match s.last_ping_at.as_deref().and_then(|t| DateTime::parse_from_rfc3339(t).ok()) {
        Some(last) => now.signed_duration_since(last.with_timezone(&Utc)) >= Duration::hours(PING_EVERY_HOURS),
        None => true,
    }
}

async fn send(api_url: &str, ping: &TelemetryPing) -> Result<(), reqwest::Error> {
    let url = format!("{}/v1/telemetry/ping", api_url.trim_end_matches('/'));
    reqwest::Client::builder()
        .timeout(PING_TIMEOUT)
        .build()?
        .post(url)
        .header("content-type", "application/json")
        .body(serde_json::to_vec(ping).unwrap_or_default())
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}

/// Sends the ping when it's due and records `lastPingAt` on success. Failures are ignored: the
/// next start tries again. Returns whether a ping was delivered.
pub async fn ping_if_due(db: &Db, home: &Path, info: &SystemInfo, now: DateTime<Utc>) -> bool {
    let settings = db.get_settings(home);
    let api_url = crate::styles_sync::effective_api_url(&settings);
    if !is_due(&settings, &api_url, now) {
        return false;
    }
    let Ok(id) = db.ensure_install_id(home) else { return false };
    if send(&api_url, &build_ping(&id, info)).await.is_err() {
        return false;
    }
    db.update_settings(serde_json::json!({ "lastPingAt": now.to_rfc3339() })).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::sync::mpsc;

    fn info() -> SystemInfo {
        SystemInfo { os: OsKind::Macos, os_version: "15.1".into(), package_manager: None }
    }

    fn settings() -> Settings {
        Db::open_in_memory().unwrap().get_settings(&PathBuf::from("/home/u"))
    }

    fn at(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    /// One-shot HTTP server answering 204; sends the raw request over the channel.
    fn serve() -> (String, mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut s) = stream else { return };
                let mut buf = Vec::new();
                let mut chunk = [0u8; 4096];
                loop {
                    let n = s.read(&mut chunk).unwrap_or(0);
                    buf.extend_from_slice(&chunk[..n]);
                    let text = String::from_utf8_lossy(&buf).to_string();
                    if let Some(i) = text.find("\r\n\r\n") {
                        let len = text[..i]
                            .lines()
                            .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0)))
                            .unwrap_or(0);
                        if buf.len() >= i + 4 + len {
                            break;
                        }
                    }
                    if n == 0 {
                        break;
                    }
                }
                let _ = s.write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
                let _ = tx.send(String::from_utf8_lossy(&buf).to_string());
            }
        });
        (url, rx)
    }

    #[test]
    fn ping_body_has_exactly_the_agreed_fields() {
        let p = build_ping("3f2b8c1e-5d4a-4e7b-9a10-2c6d8e9f0a1b", &info());
        let v = serde_json::to_value(&p).unwrap();
        let mut keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(keys, ["appVersion", "arch", "installId", "osVersion", "platform"]);
        assert_eq!(v["installId"], "3f2b8c1e-5d4a-4e7b-9a10-2c6d8e9f0a1b");
        assert_eq!(v["platform"], "macos");
        assert_eq!(v["osVersion"], "15.1");
        assert_eq!(v["arch"], std::env::consts::ARCH);
        assert_eq!(v["appVersion"], env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn os_version_is_capped_at_64_chars() {
        let long = SystemInfo { os: OsKind::Linux, os_version: "x".repeat(100), package_manager: None };
        assert_eq!(build_ping("id", &long).os_version.len(), 64);
    }

    #[test]
    fn due_when_never_pinged_or_over_24_hours() {
        let mut s = settings();
        let api = s.api_url.clone();
        let now = at("2026-11-04T12:00:00Z");
        assert!(is_due(&s, &api, now));
        s.last_ping_at = Some("2026-11-03T12:00:00Z".into());
        assert!(is_due(&s, &api, now));
        s.last_ping_at = Some("2026-11-03T12:00:01Z".into());
        assert!(!is_due(&s, &api, now));
        s.last_ping_at = Some("garbage".into());
        assert!(is_due(&s, &api, now));
    }

    #[test]
    fn never_due_when_sharing_is_off_or_no_api() {
        let now = at("2026-11-04T12:00:00Z");
        let mut s = settings();
        s.share_install_stats = false;
        assert!(!is_due(&s, "https://studio.tayang.app/api", now));
        let s = settings();
        assert!(!is_due(&s, " ", now));
    }

    #[test]
    fn install_id_is_made_once_and_is_a_uuid_v4() {
        let db = Db::open_in_memory().unwrap();
        let home = PathBuf::from("/home/u");
        assert_eq!(db.get_settings(&home).install_id, "");
        let a = db.ensure_install_id(&home).unwrap();
        let parsed = uuid::Uuid::parse_str(&a).unwrap();
        assert_eq!(parsed.get_version_num(), 4);
        assert_eq!(db.ensure_install_id(&home).unwrap(), a);
        assert_eq!(db.get_settings(&home).install_id, a);
    }

    #[tokio::test]
    async fn sends_the_ping_and_records_the_time() {
        let (url, rx) = serve();
        let db = Db::open_in_memory().unwrap();
        let home = PathBuf::from("/home/u");
        db.update_settings(serde_json::json!({ "apiUrl": url })).unwrap();
        let now = at("2026-11-04T12:00:00Z");
        assert!(ping_if_due(&db, &home, &info(), now).await);
        let req = rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        assert!(req.starts_with("POST /v1/telemetry/ping "), "{req}");
        let body: serde_json::Value = serde_json::from_str(req.split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(body["installId"], db.get_settings(&home).install_id);
        assert_eq!(body["platform"], "macos");
        assert_eq!(db.get_settings(&home).last_ping_at.as_deref(), Some(now.to_rfc3339().as_str()));
        // Within 24 hours: nothing more is sent.
        assert!(!ping_if_due(&db, &home, &info(), now + Duration::hours(23)).await);
        assert!(rx.recv_timeout(std::time::Duration::from_millis(300)).is_err());
        // Over 24 hours: sent again.
        assert!(ping_if_due(&db, &home, &info(), now + Duration::hours(25)).await);
        assert!(rx.recv_timeout(std::time::Duration::from_secs(5)).is_ok());
    }

    #[tokio::test]
    async fn sends_nothing_when_sharing_is_off() {
        let (url, rx) = serve();
        let db = Db::open_in_memory().unwrap();
        let home = PathBuf::from("/home/u");
        db.update_settings(serde_json::json!({ "apiUrl": url, "shareInstallStats": false })).unwrap();
        assert!(!ping_if_due(&db, &home, &info(), at("2026-11-04T12:00:00Z")).await);
        assert!(rx.recv_timeout(std::time::Duration::from_millis(300)).is_err());
        // Turning it off doesn't even make an install id.
        assert_eq!(db.get_settings(&home).install_id, "");
    }

    #[tokio::test]
    async fn a_failed_ping_is_silent_and_not_recorded() {
        let db = Db::open_in_memory().unwrap();
        let home = PathBuf::from("/home/u");
        // Nothing listens on port 9 (discard) of localhost, so the connection is refused.
        db.update_settings(serde_json::json!({ "apiUrl": "http://127.0.0.1:9" })).unwrap();
        assert!(!ping_if_due(&db, &home, &info(), at("2026-11-04T12:00:00Z")).await);
        assert_eq!(db.get_settings(&home).last_ping_at, None);
    }
}
