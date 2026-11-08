//! Environment configuration for the headless server.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct Config {
    pub bind: SocketAddr,
    pub data_dir: PathBuf,
    pub workspace_root: PathBuf,
    pub public_url: String,
    pub secure_cookies: bool,
    pub trust_proxy: bool,
    pub session_hours: i64,
    pub dist_dir: PathBuf,
    pub plugin_dir: Option<PathBuf>,
    pub max_upload: usize,
    pub password_hash: String,
    pub tick_secs: u64,
    pub tts_service_url: Option<String>,
    pub tts_token: Option<String>,
}

fn env_path(key: &str, default: PathBuf) -> PathBuf {
    std::env::var_os(key).filter(|v| !v.is_empty()).map(PathBuf::from).unwrap_or(default)
}

fn bool_env(key: &str, default: bool) -> bool {
    match std::env::var(key).ok().as_deref().map(str::trim).map(str::to_ascii_lowercase) {
        Some(v) if ["1", "true", "yes", "on"].contains(&v.as_str()) => true,
        Some(v) if ["0", "false", "no", "off"].contains(&v.as_str()) => false,
        _ => default,
    }
}

fn read_secret(key: &str) -> Option<String> {
    if let Ok(v) = std::env::var(key) {
        let v = v.trim().to_string();
        if !v.is_empty() {
            return Some(v);
        }
    }
    let file = std::env::var(format!("{key}_FILE")).ok()?;
    let v = std::fs::read_to_string(file).ok()?.trim().to_string();
    (!v.is_empty()).then_some(v)
}

/// Resolves the first-run workspace: the configured root itself is never used as a project folder,
/// so projects live in `<root>/tayang`.
pub fn default_working_folder(root: &Path) -> PathBuf {
    root.join("tayang")
}

impl Config {
    pub fn from_env() -> Result<Config, String> {
        let bind: SocketAddr = std::env::var("TAYANG_BIND")
            .unwrap_or_else(|_| "0.0.0.0:8787".into())
            .parse()
            .map_err(|e| format!("TAYANG_BIND isn't a socket address: {e}"))?;
        let data_dir = env_path("TAYANG_DATA_DIR", PathBuf::from("./data"));
        let workspace_root = env_path("TAYANG_WORKSPACE_ROOT", data_dir.join("workspaces"));
        let public_url = std::env::var("TAYANG_PUBLIC_URL")
            .unwrap_or_else(|_| format!("http://localhost:{}", bind.port()))
            .trim_end_matches('/')
            .to_string();
        let secure = bool_env("TAYANG_COOKIE_SECURE", public_url.starts_with("https://"));
        let dist_dir = env_path(
            "TAYANG_DIST_DIR",
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/desktop/dist"),
        );
        let plugin = std::env::var_os("TAYANG_AGENT_PLUGIN_DIR")
            .map(PathBuf::from)
            .or_else(|| {
                let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/skills/agent-plugin");
                (p.join(".claude-plugin/plugin.json").is_file()).then_some(p)
            });
        let max_mb: usize = std::env::var("TAYANG_MAX_UPLOAD_MB")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(50)
            .clamp(1, 500);
        let session_hours: i64 = std::env::var("TAYANG_SESSION_HOURS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(24 * 30)
            .clamp(1, 24 * 365);
        let password = read_secret("TAYANG_WEB_PASSWORD");
        let hash_env = read_secret("TAYANG_WEB_PASSWORD_HASH");
        let password_hash = match (hash_env, password) {
            (Some(h), _) if h.starts_with("$argon2") => h,
            (Some(_), _) => return Err("TAYANG_WEB_PASSWORD_HASH must be a PHC argon2id hash (use: tayang-server hash-password)".into()),
            (None, Some(p)) => crate::auth::hash_password(&p)?,
            (None, None) => {
                return Err(
                    "no password configured: set TAYANG_WEB_PASSWORD or TAYANG_WEB_PASSWORD_HASH \
                     (see .env.web.example). The web edition never starts without authentication."
                        .into(),
                )
            }
        };
        let tick_secs = std::env::var("TAYANG_TICK_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(30)
            .clamp(5, 3600);
        Ok(Config {
            bind,
            data_dir,
            workspace_root,
            public_url,
            secure_cookies: secure,
            trust_proxy: bool_env("TAYANG_TRUST_PROXY", false),
            session_hours,
            dist_dir,
            plugin_dir: plugin,
            max_upload: max_mb * 1024 * 1024,
            password_hash,
            tick_secs,
            tts_service_url: std::env::var("TAYANG_TTS_SERVICE_URL").ok().map(|v| v.trim().trim_end_matches('/').to_string()).filter(|v| !v.is_empty()),
            tts_token: read_secret("TAYANG_TTS_TOKEN"),
        })
    }

    /// The origin the browser uses, e.g. `https://studio.example.com`.
    pub fn public_origin(&self) -> String {
        self.public_url.trim_end_matches('/').to_string()
    }
}
