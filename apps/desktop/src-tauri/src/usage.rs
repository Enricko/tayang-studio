//! Agent usage: how much of the plan's rolling limits an agent has used.
//! Only Claude Code is supported so far. The OAuth token is read, used for one request
//! and dropped: it is never logged, stored or sent to the UI.

use crate::system::Exec;
use crate::types::*;
use chrono::{DateTime, Utc};
use std::path::Path;

pub const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";

use serde_json::Value;

fn token_from_json(json: &str) -> Option<String> {
    let v: Value = serde_json::from_str(json.trim()).ok()?;
    let t = v.get("claudeAiOauth")?.get("accessToken")?.as_str()?.trim();
    (!t.is_empty()).then(|| t.to_string())
}

/// Claude Code's OAuth token: the macOS keychain first, then `~/.claude/.credentials.json`
/// (where Linux and Windows keep it). The caller must never log or return it.
pub fn read_claude_token(exec: &dyn Exec, home: &Path) -> Option<String> {
    if cfg!(target_os = "macos") {
        let out = exec.run("security", &["find-generic-password", "-s", "Claude Code-credentials", "-w"]);
        if let Some(t) = out.as_deref().and_then(token_from_json) {
            return Some(t);
        }
    }
    let file = std::fs::read_to_string(home.join(".claude").join(".credentials.json")).ok()?;
    token_from_json(&file)
}

fn percent(w: &Value) -> Option<f64> {
    ["utilization", "used_percentage", "percent"]
        .iter()
        .find_map(|k| w.get(*k).and_then(Value::as_f64))
        .map(|p| p.clamp(0.0, 100.0))
}

/// ISO strings are normalised to UTC; numbers are epoch seconds (or milliseconds).
fn resets_at(w: &Value) -> Option<String> {
    let dt = match w.get("resets_at")? {
        Value::String(s) => DateTime::parse_from_rfc3339(s).ok()?.with_timezone(&Utc),
        Value::Number(n) => {
            let n = n.as_f64()?;
            let secs = if n > 1e11 { n / 1000.0 } else { n };
            DateTime::from_timestamp(secs as i64, 0)?
        }
        _ => return None,
    };
    Some(dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

fn window(w: &Value) -> Option<UsageWindow> {
    Some(UsageWindow { used_percent: percent(w)?, resets_at: resets_at(w) })
}

fn model_weekly(v: &Value) -> Option<ModelUsage> {
    if let Some(limits) = v.get("limits").and_then(Value::as_array) {
        for l in limits {
            if l.get("kind").and_then(Value::as_str) != Some("weekly_scoped") {
                continue;
            }
            if l.get("is_active").and_then(Value::as_bool) == Some(false) {
                continue;
            }
            let name = l.pointer("/scope/model/display_name").and_then(Value::as_str);
            if let (Some(name), Some(w)) = (name, window(l)) {
                return Some(ModelUsage { label: name.to_string(), window: w });
            }
        }
    }
    ["seven_day_fable", "fable_weekly", "fable_seven_day"]
        .iter()
        .find_map(|k| v.get(*k).and_then(window))
        .map(|w| ModelUsage { label: "Fable".into(), window: w })
}

fn stamp(now: DateTime<Utc>) -> String {
    now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn with_status(status: UsageStatus, message: &str, now: DateTime<Utc>) -> AgentUsage {
    AgentUsage {
        agent_id: AgentId::Claude,
        status,
        session: None,
        weekly: None,
        model_weekly: None,
        updated_at: stamp(now),
        message: Some(message.to_string()),
    }
}

pub fn parse_claude_usage(json: &str, now: DateTime<Utc>) -> AgentUsage {
    let Ok(v) = serde_json::from_str::<Value>(json) else {
        return with_status(UsageStatus::Error, "Couldn't read the usage response", now);
    };
    AgentUsage {
        agent_id: AgentId::Claude,
        status: UsageStatus::Ok,
        session: v.get("five_hour").and_then(window),
        weekly: v.get("seven_day").and_then(window),
        model_weekly: model_weekly(&v),
        updated_at: stamp(now),
        message: None,
    }
}

/// Maps an HTTP status and body to a usage result.
pub fn usage_from_response(status: u16, body: &str, now: DateTime<Utc>) -> AgentUsage {
    match status {
        200..=299 => parse_claude_usage(body, now),
        401 | 403 => with_status(UsageStatus::SignedOut, "Sign in to Claude Code to see usage", now),
        429 => with_status(UsageStatus::Error, "Usage is busy, try again in a minute", now),
        _ => with_status(UsageStatus::Error, "Couldn't load usage", now),
    }
}

/// One GET to the usage endpoint. Errors never include the token.
pub async fn fetch_claude_usage(token: &str) -> Result<AgentUsage, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent(concat!("tayang-studio/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| "Couldn't start the usage request".to_string())?;
    let res = client
        .get(USAGE_URL)
        .bearer_auth(token)
        .header("anthropic-beta", "oauth-2025-04-20")
        .send()
        .await
        .map_err(|_| "Couldn't reach Anthropic to load usage".to_string())?;
    let status = res.status().as_u16();
    let body = res.text().await.unwrap_or_default();
    Ok(usage_from_response(status, &body, Utc::now()))
}

/// Last results, reused for five minutes unless the UI forces a refresh.
#[derive(Default)]
pub struct UsageCache(pub std::sync::Mutex<Option<(std::time::Instant, Vec<AgentUsage>)>>);

pub const CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(300);

pub fn unavailable(id: AgentId, name: &str, now: DateTime<Utc>) -> AgentUsage {
    AgentUsage {
        agent_id: id,
        status: UsageStatus::Unavailable,
        session: None,
        weekly: None,
        model_weekly: None,
        updated_at: stamp(now),
        message: Some(format!("Usage isn't available for {name} yet")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, 4, 10, 0, 0).unwrap()
    }

    struct Fake(Option<String>);
    impl Exec for Fake {
        fn run(&self, _p: &str, _a: &[&str]) -> Option<String> {
            self.0.clone()
        }
        fn which(&self, _p: &str) -> Option<std::path::PathBuf> {
            None
        }
    }

    const FULL: &str = r#"{
      "five_hour": {"utilization": 33.0, "resets_at": "2026-11-04T11:41:00Z"},
      "seven_day": {"utilization": 48, "resets_at": "2026-11-07T23:00:00.000000+00:00"},
      "limits": [
        {"kind": "weekly_scoped", "percent": 26, "resets_at": "2026-11-08T00:00:00Z", "is_active": true,
         "scope": {"model": {"display_name": "Fable"}}},
        {"kind": "weekly_scoped", "percent": 90, "resets_at": "2026-11-08T00:00:00Z", "is_active": false,
         "scope": {"model": {"display_name": "Old"}}}
      ]
    }"#;

    #[test]
    fn parses_windows_and_scoped_model() {
        let u = parse_claude_usage(FULL, now());
        assert_eq!(u.status, UsageStatus::Ok);
        assert_eq!(u.agent_id, AgentId::Claude);
        let s = u.session.unwrap();
        assert_eq!(s.used_percent, 33.0);
        assert_eq!(s.resets_at.as_deref(), Some("2026-11-04T11:41:00Z"));
        assert_eq!(u.weekly.unwrap().used_percent, 48.0);
        let m = u.model_weekly.unwrap();
        assert_eq!(m.label, "Fable");
        assert_eq!(m.window.used_percent, 26.0);
        assert_eq!(u.updated_at, "2026-11-04T10:00:00Z");
    }

    #[test]
    fn epoch_resets_and_used_percentage() {
        let j = r#"{"five_hour": {"used_percentage": 12.5, "resets_at": 1793790000},
                    "seven_day": {"utilization": 1, "resets_at": 1793790000000}}"#;
        let u = parse_claude_usage(j, now());
        let s = u.session.unwrap();
        assert_eq!(s.used_percent, 12.5);
        assert_eq!(s.resets_at.as_deref(), Some("2026-11-04T11:00:00Z"));
        assert_eq!(u.weekly.unwrap().resets_at.as_deref(), Some("2026-11-04T11:00:00Z"));
        assert!(u.model_weekly.is_none());
    }

    #[test]
    fn fable_fallback_keys() {
        for key in ["seven_day_fable", "fable_weekly", "fable_seven_day"] {
            let j = format!(r#"{{"{key}": {{"utilization": 26, "resets_at": null}}}}"#);
            let m = parse_claude_usage(&j, now()).model_weekly.unwrap();
            assert_eq!(m.label, "Fable");
            assert_eq!(m.window.used_percent, 26.0);
            assert_eq!(m.window.resets_at, None);
        }
    }

    #[test]
    fn clamps_percent_and_rejects_garbage() {
        let j = r#"{"five_hour": {"utilization": 140}}"#;
        assert_eq!(parse_claude_usage(j, now()).session.unwrap().used_percent, 100.0);
        let u = parse_claude_usage("not json", now());
        assert_eq!(u.status, UsageStatus::Error);
    }

    #[test]
    fn http_statuses() {
        assert_eq!(usage_from_response(200, FULL, now()).status, UsageStatus::Ok);
        for code in [401, 403] {
            assert_eq!(usage_from_response(code, "", now()).status, UsageStatus::SignedOut);
        }
        let busy = usage_from_response(429, "", now());
        assert_eq!(busy.status, UsageStatus::Error);
        assert_eq!(busy.message.as_deref(), Some("Usage is busy, try again in a minute"));
        assert_eq!(usage_from_response(500, "", now()).status, UsageStatus::Error);
    }

    #[test]
    fn unavailable_message() {
        let u = unavailable(AgentId::Gemini, "Gemini CLI", now());
        assert_eq!(u.status, UsageStatus::Unavailable);
        assert_eq!(u.message.as_deref(), Some("Usage isn't available for Gemini CLI yet"));
    }

    #[test]
    fn token_from_credentials_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".claude")).unwrap();
        std::fs::write(
            dir.path().join(".claude").join(".credentials.json"),
            r#"{"claudeAiOauth": {"accessToken": "tok-file"}}"#,
        )
        .unwrap();
        assert_eq!(read_claude_token(&Fake(None), dir.path()).as_deref(), Some("tok-file"));
        let empty = tempfile::tempdir().unwrap();
        assert_eq!(read_claude_token(&Fake(None), empty.path()), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn token_from_keychain_on_macos() {
        let dir = tempfile::tempdir().unwrap();
        let ex = Fake(Some("{\"claudeAiOauth\":{\"accessToken\":\"tok-kc\"}}\n".into()));
        assert_eq!(read_claude_token(&ex, dir.path()).as_deref(), Some("tok-kc"));
    }
}
