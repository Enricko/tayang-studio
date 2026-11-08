//! Tayang's own Claude sign-in. Claude Code runs with `CLAUDE_CONFIG_DIR` set to a folder in
//! Tayang's app data, so a session starts clean (none of the user's own plugins, MCP servers or
//! CLAUDE.md, which only cost tokens here) and signs in once, from Tayang, through Claude Code's
//! own `claude auth login`. Tayang never sees the OAuth exchange: Claude Code keeps its tokens
//! where it always does for a config dir of its own (a Keychain item on macOS, a file elsewhere).

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::oneshot;

/// The environment variable that points Claude Code at a config folder.
pub const CONFIG_ENV: &str = "CLAUDE_CONFIG_DIR";

/// How long a sign-in may wait for the user to finish in the browser.
pub const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(600);

/// Tayang's Claude config folder inside its app data folder.
pub fn config_dir(app_data: &Path) -> PathBuf {
    app_data.join("claude")
}

/// The macOS Keychain service Claude Code keeps a config folder's sign-in under: `Claude
/// Code-credentials` plus the first 8 hex digits of the folder path's SHA-256 (as Claude Code
/// 2.1 names it when `CLAUDE_CONFIG_DIR` is set).
pub fn keychain_service(config_dir: &str) -> String {
    let digest = Sha256::digest(config_dir.as_bytes());
    let hex: String = digest.iter().take(4).map(|b| format!("{b:02x}")).collect();
    format!("Claude Code-credentials-{hex}")
}

/// Who is signed in to Claude in Tayang.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeAccount {
    pub signed_in: bool,
    pub email: Option<String>,
    /// The Claude plan, such as `pro` or `max`.
    pub plan: Option<String>,
}

/// Reads `claude auth status --json`. Anything unreadable counts as signed out.
pub fn parse_status(json: &str) -> ClaudeAccount {
    let Ok(v) = serde_json::from_str::<Value>(json.trim()) else {
        return ClaudeAccount::default();
    };
    let text = |k: &str| v.get(k).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string);
    let signed_in = v.get("loggedIn").and_then(Value::as_bool).unwrap_or(false);
    ClaudeAccount {
        signed_in,
        email: if signed_in { text("email") } else { None },
        plan: if signed_in { text("subscriptionType") } else { None },
    }
}

/// The sign-in page Claude Code prints ("If the browser didn't open, visit: …"), without the
/// terminal hyperlink escapes around it.
pub fn sign_in_url(line: &str) -> Option<String> {
    let start = line.find("https://")?;
    let url: String = line[start..]
        .chars()
        .take_while(|c| !c.is_whitespace() && !c.is_control())
        .collect();
    (url.len() > "https://".len()).then_some(url)
}

fn claude_command(claude: &Path, config_dir: &Path, args: &[&str]) -> Command {
    let mut cmd = Command::new(claude);
    cmd.args(args)
        .env(CONFIG_ENV, config_dir)
        .env("PATH", crate::system::augmented_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    cmd
}

/// Who is signed in, from `claude auth status --json`.
pub async fn status(claude: &Path, config_dir: &Path) -> ClaudeAccount {
    let out = tokio::time::timeout(
        Duration::from_secs(30),
        claude_command(claude, config_dir, &["auth", "status", "--json"]).output(),
    )
    .await;
    match out {
        Ok(Ok(o)) => parse_status(&String::from_utf8_lossy(&o.stdout)),
        _ => ClaudeAccount::default(),
    }
}

/// Signs out of Claude in Tayang (the user's own Claude Code sign-in is untouched).
pub async fn sign_out(claude: &Path, config_dir: &Path) -> ClaudeAccount {
    let _ = tokio::time::timeout(
        Duration::from_secs(30),
        claude_command(claude, config_dir, &["auth", "logout"]).output(),
    )
    .await;
    status(claude, config_dir).await
}

/// How a sign-in ended.
#[derive(Debug, PartialEq, Eq)]
pub enum SignInEnd {
    Done,
    Cancelled,
    TimedOut,
    Failed(String),
}

/// Runs `claude auth login --claudeai`: Claude Code opens the browser and waits for the user.
/// `on_url` gets the sign-in page, for when the browser didn't open. Ends when the command does,
/// on `cancel`, or after `timeout`.
pub async fn sign_in(
    claude: &Path,
    config_dir: &Path,
    timeout: Duration,
    cancel: oneshot::Receiver<()>,
    on_url: impl Fn(String) + Send + 'static,
) -> SignInEnd {
    let mut cmd = claude_command(claude, config_dir, &["auth", "login", "--claudeai"]);
    // Claude Code may wait for a pasted code on stdin: keep it open, never send EOF.
    cmd.stdin(Stdio::piped());
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return SignInEnd::Failed(format!("Could not start Claude Code: {e}")),
    };
    let _stdin = child.stdin.take();
    if let Some(stdout) = child.stdout.take() {
        let mut lines = BufReader::new(stdout).lines();
        let reader = async move {
            let mut seen = false;
            let mut kept = Vec::new();
            while let Ok(Some(line)) = lines.next_line().await {
                if !seen {
                    if let Some(url) = sign_in_url(&line) {
                        seen = true;
                        on_url(url);
                        continue;
                    }
                }
                kept.push(line);
            }
            kept
        };
        let (tail, waited) = tokio::select! {
            kept = reader => (kept, child.wait().await.ok()),
            _ = cancel => { let _ = child.kill().await; return SignInEnd::Cancelled; }
            _ = tokio::time::sleep(timeout) => { let _ = child.kill().await; return SignInEnd::TimedOut; }
        };
        return match waited {
            Some(s) if s.success() => SignInEnd::Done,
            _ => SignInEnd::Failed(tail.last().cloned().unwrap_or_else(|| "Claude Code could not sign in".into())),
        };
    }
    SignInEnd::Failed("Claude Code gave no output".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keychain_service_matches_claude_code() {
        // Claude Code: `-${sha256(dir).hex.substring(0, 8)}` after "Claude Code-credentials".
        let dir = "/Users/x/Library/Application Support/app.tayang.studio/claude";
        let hex = format!("{:x}", Sha256::digest(dir.as_bytes()));
        assert_eq!(keychain_service(dir), format!("Claude Code-credentials-{}", &hex[..8]));
    }

    #[test]
    fn status_reads_the_account_or_nothing() {
        let signed_in = r#"{"loggedIn":true,"authMethod":"claude.ai","email":"a@b.c","subscriptionType":"pro"}"#;
        assert_eq!(
            parse_status(signed_in),
            ClaudeAccount { signed_in: true, email: Some("a@b.c".into()), plan: Some("pro".into()) }
        );
        assert_eq!(parse_status(r#"{"loggedIn":false,"authMethod":"none"}"#), ClaudeAccount::default());
        assert_eq!(parse_status("not json"), ClaudeAccount::default());
    }

    #[test]
    fn sign_in_url_drops_the_terminal_link_escapes() {
        let line = "If the browser didn't open, visit: \u{1b}]8;;https://claude.com/cai/oauth/authorize?code=true&x=1\u{1b}\\https://claude.com/cai/oauth/authorize?code=true&x=1\u{1b}]8;;\u{1b}\\";
        assert_eq!(sign_in_url(line).as_deref(), Some("https://claude.com/cai/oauth/authorize?code=true&x=1"));
        assert_eq!(sign_in_url("Opening browser to sign in…"), None);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn sign_in_reports_the_url_and_ends_with_the_command() {
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("claude");
        std::fs::write(&fake, "#!/bin/sh\necho 'Opening browser to sign in…'\necho \"visit: https://claude.com/login?x=1 now\"\necho \"dir=$CLAUDE_CONFIG_DIR\"\nexit 0\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let urls = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let seen = urls.clone();
        let (_tx, rx) = oneshot::channel();
        let end = sign_in(&fake, dir.path(), Duration::from_secs(10), rx, move |u| seen.lock().unwrap().push(u)).await;
        assert_eq!(end, SignInEnd::Done);
        assert_eq!(*urls.lock().unwrap(), vec!["https://claude.com/login?x=1".to_string()]);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn sign_in_can_be_cancelled() {
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("claude");
        std::fs::write(&fake, "#!/bin/sh\nsleep 30\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let (tx, rx) = oneshot::channel();
        let run = tokio::spawn(async move { sign_in(&fake, Path::new("/tmp"), Duration::from_secs(20), rx, |_| {}).await });
        tokio::time::sleep(Duration::from_millis(200)).await;
        tx.send(()).unwrap();
        assert_eq!(run.await.unwrap(), SignInEnd::Cancelled);
    }
}
