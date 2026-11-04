//! Agent usage: how much of the plan's rolling limits an agent has used.
//! Only Claude Code is supported so far. The OAuth token is read, used for one request
//! and dropped: it is never logged, stored or sent to the UI.

use crate::system::Exec;
use crate::types::*;
use chrono::{DateTime, Utc};
use std::path::Path;

pub const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";

pub fn read_claude_token(_exec: &dyn Exec, _home: &Path) -> Option<String> {
    todo!()
}

pub fn parse_claude_usage(_json: &str, _now: DateTime<Utc>) -> AgentUsage {
    todo!()
}

/// Maps an HTTP status and body to a usage result.
pub fn usage_from_response(_status: u16, _body: &str, _now: DateTime<Utc>) -> AgentUsage {
    todo!()
}

pub fn unavailable(_id: AgentId, _name: &str, _now: DateTime<Utc>) -> AgentUsage {
    todo!()
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
