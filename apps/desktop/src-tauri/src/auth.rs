//! Sign in with Google through the Tayang API, device-authorization style. The desktop asks
//! the API for a device code, opens the browser, and polls until the user approves; the
//! token it gets back lives in the OS keychain and never reaches the webview.

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use crate::styles_sync::endpoint;
use crate::types::{Account, AuthError};
use serde::Deserialize;

/// Keychain service name for every stored token.
pub const SERVICE: &str = "app.tayang.studio";

/// The keychain account for an API base: `api:` + origin + path, without a trailing slash,
/// so a token is bound to the API it came from.
pub fn account_key(base: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(base.trim()).map_err(|_| format!("That API address isn't valid: {base}"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host().is_none() {
        return Err(format!("That API address isn't valid: {base}"));
    }
    Ok(format!("api:{}{}", url.origin().ascii_serialization(), url.path().trim_end_matches('/')))
}

// ---- token storage ----

/// Where sign-in tokens live, by keychain account. Injectable so tests never touch the OS keychain.
pub trait TokenStore: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    fn set(&self, account: &str, token: &str) -> Result<(), String>;
    /// Deleting a token that isn't there is not an error.
    fn delete(&self, account: &str) -> Result<(), String>;
}

/// In-memory store, for tests.
#[derive(Default)]
pub struct MemoryStore(Mutex<HashMap<String, String>>);

impl TokenStore for MemoryStore {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self.0.lock().unwrap_or_else(|e| e.into_inner()).get(account).cloned())
    }
    fn set(&self, account: &str, token: &str) -> Result<(), String> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).insert(account.into(), token.into());
        Ok(())
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).remove(account);
        Ok(())
    }
}

/// The OS keychain (macOS Keychain, Windows Credential Manager, Secret Service on Linux).
pub struct KeyringStore;

impl KeyringStore {
    fn entry(account: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, account).map_err(|e| e.to_string())
    }
}

impl TokenStore for KeyringStore {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        match Self::entry(account)?.get_password() {
            Ok(t) => Ok(Some(t)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    fn set(&self, account: &str, token: &str) -> Result<(), String> {
        Self::entry(account)?.set_password(token).map_err(|e| e.to_string())
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

/// `<app_data>/auth.json`, `{ account: token }`, readable by this user only (0600 on unix).
/// Used only when the keychain can't be.
pub struct FileStore {
    path: PathBuf,
}

impl FileStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// A missing or damaged file holds no tokens.
    fn read(&self) -> Result<FileMap, String> {
        match std::fs::read(&self.path) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes).unwrap_or_default()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(FileMap::new()),
            Err(e) => Err(e.to_string()),
        }
    }

    /// Writes a fresh 0600 file and renames it into place; no tokens left means no file.
    fn write(&self, map: &FileMap) -> Result<(), String> {
        if map.is_empty() {
            return match std::fs::remove_file(&self.path) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
                _ => Ok(()),
            };
        }
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let tmp = self.path.with_extension("json.tmp");
        let _ = std::fs::remove_file(&tmp);
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut opts, 0o600);
        let body = serde_json::to_vec(map).map_err(|e| e.to_string())?;
        let written = opts.open(&tmp).and_then(|mut f| {
            std::io::Write::write_all(&mut f, &body)?;
            f.sync_all()
        });
        if let Err(e) = written.and_then(|_| std::fs::rename(&tmp, &self.path)) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e.to_string());
        }
        Ok(())
    }
}

impl TokenStore for FileStore {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self.read()?.remove(account))
    }
    fn set(&self, account: &str, token: &str) -> Result<(), String> {
        let mut map = self.read()?;
        map.insert(account.into(), token.into());
        self.write(&map)
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        let mut map = self.read()?;
        if map.remove(account).is_none() {
            return Ok(());
        }
        self.write(&map)
    }
}

/// The keychain, falling back to the file only when the keychain itself fails. The fallback
/// is logged once.
pub struct SecureStore<K: TokenStore> {
    keychain: K,
    file: FileStore,
    warned: AtomicBool,
}

impl<K: TokenStore> SecureStore<K> {
    pub fn new(keychain: K, file: FileStore) -> Self {
        Self { keychain, file, warned: AtomicBool::new(false) }
    }

    fn fallback(&self, why: &str) {
        if !self.warned.swap(true, Ordering::Relaxed) {
            eprintln!("[auth] the keychain isn't available ({why}); keeping the sign-in token in auth.json instead");
        }
    }
}

impl<K: TokenStore> TokenStore for SecureStore<K> {
    /// The keychain first; the file holds a token saved while the keychain was down.
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        match self.keychain.get(account) {
            Ok(Some(t)) => Ok(Some(t)),
            Ok(None) => self.file.get(account),
            Err(e) => {
                self.fallback(&e);
                self.file.get(account)
            }
        }
    }
    fn set(&self, account: &str, token: &str) -> Result<(), String> {
        match self.keychain.set(account, token) {
            Ok(()) => {
                // A copy from a keychain outage would otherwise linger in the file.
                let _ = self.file.delete(account);
                Ok(())
            }
            Err(e) => {
                self.fallback(&e);
                self.file.set(account, token)
            }
        }
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        let keychain = self.keychain.delete(account);
        let file = self.file.delete(account);
        match (keychain, file) {
            (Err(e), Err(_)) => Err(e),
            (Err(e), Ok(())) => {
                self.fallback(&e);
                Ok(())
            }
            _ => Ok(()),
        }
    }
}

type FileMap = BTreeMap<String, String>;

// ---- the API ----

/// Per-request timeout for every auth call.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
/// Polls in a row that may fail (network or server) before signing in gives up.
const MAX_POLL_FAILURES: u32 = 3;

pub fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(concat!("tayang-studio/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

/// `POST /v1/auth/device` (shared `AuthDeviceResponse`). The device code never leaves Rust.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
    pub interval: u64,
}

/// `POST /v1/auth/token`, 200 (shared `AuthTokenResponse`).
#[derive(Debug, Clone, Deserialize)]
pub struct Issued {
    pub token: String,
    pub account: Account,
}

/// One answer from `POST /v1/auth/token`.
#[derive(Debug)]
pub enum PollReply {
    Pending,
    SlowDown,
    Expired,
    Denied,
    Issued(Issued),
    Network,
    Server,
}

/// `GET /v1/me` with a stored token.
#[derive(Debug)]
pub enum Me {
    Account(Account),
    /// 401: the token is no good any more.
    Unauthorized,
    /// Offline, or the API is having a bad moment: keep the token.
    Unavailable,
}

/// The status and body of a response; `None` when the API couldn't be reached.
async fn send(req: reqwest::RequestBuilder) -> Option<(u16, Vec<u8>)> {
    let res = req.send().await.ok()?;
    let status = res.status().as_u16();
    Some((status, res.bytes().await.ok()?.to_vec()))
}

pub async fn request_device(client: &reqwest::Client, base: &str) -> Result<DeviceCode, AuthError> {
    let (status, body) =
        send(client.post(endpoint(base, "/v1/auth/device"))).await.ok_or(AuthError::Network)?;
    match status {
        200..=299 => serde_json::from_slice::<DeviceCode>(&body)
            .ok()
            .filter(|d| !d.device_code.is_empty() && !d.user_code.is_empty())
            .ok_or(AuthError::Server),
        429 => Err(AuthError::RateLimited),
        _ => Err(AuthError::Server),
    }
}

pub async fn poll_token(client: &reqwest::Client, base: &str, device_code: &str) -> PollReply {
    let req = client
        .post(endpoint(base, "/v1/auth/token"))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(serde_json::json!({ "deviceCode": device_code }).to_string());
    let Some((status, body)) = send(req).await else { return PollReply::Network };
    #[derive(Deserialize)]
    struct TokenError {
        error: String,
    }
    match status {
        200..=299 => match serde_json::from_slice::<Issued>(&body) {
            Ok(i) if i.token.starts_with("tyg_") && i.token.len() > 4 => PollReply::Issued(i),
            _ => PollReply::Server,
        },
        429 => PollReply::SlowDown,
        400 => match serde_json::from_slice::<TokenError>(&body).map(|e| e.error) {
            Ok(e) if e == "authorization_pending" => PollReply::Pending,
            Ok(e) if e == "slow_down" => PollReply::SlowDown,
            Ok(e) if e == "expired_token" => PollReply::Expired,
            Ok(e) if e == "access_denied" => PollReply::Denied,
            _ => PollReply::Server,
        },
        _ => PollReply::Server,
    }
}

pub async fn fetch_me(client: &reqwest::Client, base: &str, token: &str) -> Me {
    let Some((status, body)) = send(client.get(endpoint(base, "/v1/me")).bearer_auth(token)).await else {
        return Me::Unavailable;
    };
    match status {
        200..=299 => serde_json::from_slice(&body).map(Me::Account).unwrap_or(Me::Unavailable),
        401 => Me::Unauthorized,
        _ => Me::Unavailable,
    }
}

/// `POST /v1/auth/logout`; best effort, the result is ignored.
pub async fn revoke(client: &reqwest::Client, base: &str, token: &str) {
    let req = client.post(endpoint(base, "/v1/auth/logout")).bearer_auth(token).timeout(Duration::from_secs(5));
    let _ = send(req).await;
}

// ---- polling ----

/// What the poller does after a reply.
#[derive(Debug)]
pub enum Step {
    /// Poll again after this many seconds.
    Wait(u64),
    Done(Result<Issued, AuthError>),
}

/// The polling state machine: the interval (seconds) and the failures in a row.
pub struct PollState {
    pub interval: u64,
    failures: u32,
}

impl PollState {
    pub fn new(interval: u64) -> Self {
        Self { interval: interval.clamp(1, 60), failures: 0 }
    }

    pub fn next(&mut self, reply: PollReply) -> Step {
        let failed = |st: &mut Self, why: AuthError| {
            st.failures += 1;
            if st.failures >= MAX_POLL_FAILURES {
                Step::Done(Err(why))
            } else {
                Step::Wait(st.interval)
            }
        };
        match reply {
            PollReply::Pending => {
                self.failures = 0;
                Step::Wait(self.interval)
            }
            PollReply::SlowDown => {
                self.failures = 0;
                self.interval += 5;
                Step::Wait(self.interval)
            }
            PollReply::Expired => Step::Done(Err(AuthError::Expired)),
            PollReply::Denied => Step::Done(Err(AuthError::Denied)),
            PollReply::Issued(i) => Step::Done(Ok(i)),
            PollReply::Network => failed(self, AuthError::Network),
            PollReply::Server => failed(self, AuthError::Server),
        }
    }
}

/// Polls until the code is approved, refused or runs out. One `tick` is a second in the app;
/// tests shrink it.
pub async fn poll_until_done(
    client: &reqwest::Client,
    base: &str,
    device: &DeviceCode,
    tick: Duration,
) -> Result<Issued, AuthError> {
    use tokio::time::{sleep_until, Instant};
    let mut st = PollState::new(device.interval);
    let deadline = Instant::now() + tick * device.expires_in.min(3600) as u32;
    let mut wait = st.interval;
    loop {
        let at = Instant::now() + tick * wait as u32;
        if at > deadline {
            sleep_until(deadline).await;
            return Err(AuthError::Expired);
        }
        sleep_until(at).await;
        match st.next(poll_token(client, base, &device.device_code).await) {
            Step::Wait(w) => wait = w,
            Step::Done(r) => return r,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn account_key_is_origin_plus_path() {
        assert_eq!(account_key("https://studio.tayang.app/api").unwrap(), "api:https://studio.tayang.app/api");
        assert_eq!(account_key(" https://Studio.Tayang.app:443/api/ ").unwrap(), "api:https://studio.tayang.app/api");
        assert_eq!(account_key("http://localhost:8787/api").unwrap(), "api:http://localhost:8787/api");
        assert_eq!(account_key("http://localhost:8787").unwrap(), "api:http://localhost:8787");
        assert_ne!(account_key("http://localhost:8787/api").unwrap(), account_key("http://127.0.0.1:8787/api").unwrap());
        assert!(account_key("not a url").is_err());
        assert!(account_key("file:///etc/passwd").is_err());
    }

    /// A keychain that is never there.
    struct Broken;
    impl TokenStore for Broken {
        fn get(&self, _: &str) -> Result<Option<String>, String> {
            Err("no keychain".into())
        }
        fn set(&self, _: &str, _: &str) -> Result<(), String> {
            Err("no keychain".into())
        }
        fn delete(&self, _: &str) -> Result<(), String> {
            Err("no keychain".into())
        }
    }

    #[test]
    fn file_store_round_trips_per_account() {
        let dir = tempfile::tempdir().unwrap();
        let f = FileStore::new(dir.path().join("auth.json"));
        assert_eq!(f.get("api:a").unwrap(), None);
        f.set("api:a", "tyg_a").unwrap();
        f.set("api:b", "tyg_b").unwrap();
        assert_eq!(f.get("api:a").unwrap().as_deref(), Some("tyg_a"));
        f.delete("api:a").unwrap();
        f.delete("api:a").unwrap();
        assert_eq!(f.get("api:a").unwrap(), None);
        assert_eq!(f.get("api:b").unwrap().as_deref(), Some("tyg_b"));
        f.delete("api:b").unwrap();
        assert!(!dir.path().join("auth.json").exists(), "no tokens, no file");
    }

    #[cfg(unix)]
    #[test]
    fn file_store_is_private_to_the_user() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        std::fs::write(&path, "{}").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        FileStore::new(path.clone()).set("api:a", "tyg_a").unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[test]
    fn file_store_survives_a_damaged_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        std::fs::write(&path, "not json").unwrap();
        let f = FileStore::new(path);
        assert_eq!(f.get("api:a").unwrap(), None);
        f.set("api:a", "tyg_a").unwrap();
        assert_eq!(f.get("api:a").unwrap().as_deref(), Some("tyg_a"));
    }

    #[test]
    fn secure_store_uses_the_keychain_and_leaves_no_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        let s = SecureStore::new(MemoryStore::default(), FileStore::new(path.clone()));
        s.set("api:a", "tyg_a").unwrap();
        assert_eq!(s.get("api:a").unwrap().as_deref(), Some("tyg_a"));
        assert!(!path.exists());
        assert_eq!(s.keychain.get("api:a").unwrap().as_deref(), Some("tyg_a"));
        s.delete("api:a").unwrap();
        assert_eq!(s.get("api:a").unwrap(), None);
    }

    #[test]
    fn secure_store_falls_back_to_the_file_when_the_keychain_fails() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        let s = SecureStore::new(Broken, FileStore::new(path.clone()));
        s.set("api:a", "tyg_a").unwrap();
        assert!(path.exists());
        assert!(s.warned.load(Ordering::Relaxed));
        assert_eq!(s.get("api:a").unwrap().as_deref(), Some("tyg_a"));
        s.delete("api:a").unwrap();
        assert_eq!(s.get("api:a").unwrap(), None);
    }

    #[test]
    fn a_token_saved_while_the_keychain_was_down_is_still_found_and_moves_on_the_next_save() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        FileStore::new(path.clone()).set("api:a", "tyg_old").unwrap();
        let s = SecureStore::new(MemoryStore::default(), FileStore::new(path.clone()));
        assert_eq!(s.get("api:a").unwrap().as_deref(), Some("tyg_old"));
        s.set("api:a", "tyg_new").unwrap();
        assert!(!path.exists(), "the file copy is removed once the keychain holds the token");
        s.delete("api:a").unwrap();
        assert_eq!(s.get("api:a").unwrap(), None);
    }

    // ---- a fake API ----

    #[derive(Debug, Clone)]
    pub(crate) struct Req {
        pub method: String,
        pub path: String,
        pub auth: Option<String>,
        pub body: String,
    }

    type Handler = Arc<dyn Fn(&Req, usize) -> (u16, String) + Send + Sync>;

    /// A tiny HTTP/1.1 server on 127.0.0.1. `handler` gets each request and how many
    /// requests came before it to the same path; every request is recorded.
    pub(crate) struct Fake {
        pub base: String,
        pub hits: Arc<Mutex<Vec<Req>>>,
    }

    impl Fake {
        pub fn hits(&self, path: &str) -> Vec<Req> {
            self.hits.lock().unwrap().iter().filter(|r| r.path == path).cloned().collect()
        }
    }

    pub(crate) async fn fake(handler: impl Fn(&Req, usize) -> (u16, String) + Send + Sync + 'static) -> Fake {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let handler: Handler = Arc::new(handler);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/api", listener.local_addr().unwrap());
        let hits: Arc<Mutex<Vec<Req>>> = Arc::default();
        let recorded = hits.clone();
        tokio::spawn(async move {
            while let Ok((mut s, _)) = listener.accept().await {
                let handler = handler.clone();
                let hits = recorded.clone();
                tokio::spawn(async move {
                    let mut buf = Vec::new();
                    let mut chunk = [0u8; 4096];
                    let (head, body) = loop {
                        let n = s.read(&mut chunk).await.unwrap_or(0);
                        buf.extend_from_slice(&chunk[..n]);
                        let text = String::from_utf8_lossy(&buf).to_string();
                        if let Some(i) = text.find("\r\n\r\n") {
                            let len = text[..i]
                                .lines()
                                .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse().unwrap_or(0)))
                                .unwrap_or(0usize);
                            if buf.len() >= i + 4 + len || n == 0 {
                                break (text[..i].to_string(), text[i + 4..].to_string());
                            }
                        }
                        if n == 0 {
                            return;
                        }
                    };
                    let mut first = head.lines().next().unwrap_or("").split(' ');
                    let method = first.next().unwrap_or("").to_string();
                    let path = first.next().unwrap_or("").to_string();
                    let auth = head
                        .lines()
                        .find_map(|l| l.split_once(':').filter(|(k, _)| k.eq_ignore_ascii_case("authorization")).map(|(_, v)| v.trim().to_string()));
                    let req = Req { method, path, auth, body };
                    let nth = {
                        let mut h = hits.lock().unwrap();
                        let nth = h.iter().filter(|r| r.path == req.path).count();
                        h.push(req.clone());
                        nth
                    };
                    let (status, body) = handler(&req, nth);
                    let res = format!(
                        "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = s.write_all(res.as_bytes()).await;
                    let _ = s.shutdown().await;
                });
            }
        });
        Fake { base, hits }
    }

    /// An address nothing listens on.
    pub(crate) async fn dead_base() -> String {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        drop(l);
        format!("http://{addr}/api")
    }

    pub(crate) const DEVICE: &str = r#"{"deviceCode":"dev-secret","userCode":"ABCD-EFGH","verificationUri":"http://x/api/auth/device","verificationUriComplete":"http://x/api/auth/device?code=ABCD-EFGH","expiresIn":600,"interval":1}"#;
    pub(crate) const ISSUED: &str = r#"{"token":"tyg_abc","account":{"id":"acc_1","email":"a@b.c","name":"Ana","plan":"free","features":[]}}"#;
    pub(crate) const ME: &str = r#"{"id":"acc_1","email":"a@b.c","name":"Ana","plan":"pro","features":["voiceover"]}"#;
    pub(crate) fn err(code: &str) -> (u16, String) {
        (400, format!(r#"{{"error":"{code}"}}"#))
    }
    pub(crate) const TICK: Duration = Duration::from_millis(2);

    fn device(interval: u64, expires_in: u64) -> DeviceCode {
        let mut d: DeviceCode = serde_json::from_str(DEVICE).unwrap();
        d.interval = interval;
        d.expires_in = expires_in;
        d
    }

    #[tokio::test]
    async fn request_device_keeps_the_base_path() {
        let f = fake(|_, _| (200, DEVICE.into())).await;
        let d = request_device(&http_client().unwrap(), &format!("{}/", f.base)).await.unwrap();
        assert_eq!((d.user_code.as_str(), d.device_code.as_str(), d.interval), ("ABCD-EFGH", "dev-secret", 1));
        let hits = f.hits("/api/v1/auth/device");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].method, "POST");
    }

    #[tokio::test]
    async fn request_device_errors() {
        let c = http_client().unwrap();
        let f = fake(|_, _| (429, r#"{"error":"rate_limited"}"#.into())).await;
        assert_eq!(request_device(&c, &f.base).await.unwrap_err(), AuthError::RateLimited);
        let f = fake(|_, _| (404, "{}".into())).await;
        assert_eq!(request_device(&c, &f.base).await.unwrap_err(), AuthError::Server);
        let f = fake(|_, _| (200, "<html>".into())).await;
        assert_eq!(request_device(&c, &f.base).await.unwrap_err(), AuthError::Server);
        assert_eq!(request_device(&c, &dead_base().await).await.unwrap_err(), AuthError::Network);
    }

    #[test]
    fn poll_state_respects_interval_and_slow_down() {
        let mut st = PollState::new(5);
        assert!(matches!(st.next(PollReply::Pending), Step::Wait(5)));
        assert!(matches!(st.next(PollReply::SlowDown), Step::Wait(10)));
        assert!(matches!(st.next(PollReply::Pending), Step::Wait(10)));
        assert!(matches!(st.next(PollReply::SlowDown), Step::Wait(15)));
        assert!(matches!(st.next(PollReply::Expired), Step::Done(Err(AuthError::Expired))));
        assert!(matches!(PollState::new(5).next(PollReply::Denied), Step::Done(Err(AuthError::Denied))));
        assert_eq!(PollState::new(0).interval, 1, "never hammer the API");
    }

    #[test]
    fn poll_state_tolerates_a_few_failures_in_a_row() {
        let mut st = PollState::new(5);
        assert!(matches!(st.next(PollReply::Network), Step::Wait(5)));
        assert!(matches!(st.next(PollReply::Server), Step::Wait(5)));
        assert!(matches!(st.next(PollReply::Pending), Step::Wait(5)), "a good reply resets the count");
        assert!(matches!(st.next(PollReply::Network), Step::Wait(5)));
        assert!(matches!(st.next(PollReply::Network), Step::Wait(5)));
        assert!(matches!(st.next(PollReply::Network), Step::Done(Err(AuthError::Network))));
        let mut st = PollState::new(5);
        st.next(PollReply::Server);
        st.next(PollReply::Server);
        assert!(matches!(st.next(PollReply::Server), Step::Done(Err(AuthError::Server))));
    }

    #[tokio::test]
    async fn polls_through_pending_and_slow_down_to_a_token() {
        let f = fake(|r, n| {
            assert_eq!(r.path, "/api/v1/auth/token");
            match n {
                0 => err("authorization_pending"),
                1 => err("slow_down"),
                2 => err("authorization_pending"),
                _ => (200, ISSUED.into()),
            }
        })
        .await;
        let started = std::time::Instant::now();
        let issued = poll_until_done(&http_client().unwrap(), &f.base, &device(1, 600), TICK).await.unwrap();
        assert_eq!(issued.token, "tyg_abc");
        assert_eq!(issued.account.email.as_deref(), Some("a@b.c"));
        let hits = f.hits("/api/v1/auth/token");
        assert_eq!(hits.len(), 4);
        assert!(hits.iter().all(|h| h.method == "POST" && h.body.contains(r#""deviceCode":"dev-secret""#)));
        // 1 + 1 + 6 + 6 ticks: slow_down added five seconds to every wait after it.
        assert!(started.elapsed() >= TICK * 14, "{:?}", started.elapsed());
    }

    #[tokio::test]
    async fn polling_stops_on_deny_and_expiry() {
        let c = http_client().unwrap();
        let f = fake(|_, n| if n == 0 { err("authorization_pending") } else { err("access_denied") }).await;
        assert_eq!(poll_until_done(&c, &f.base, &device(1, 600), TICK).await.unwrap_err(), AuthError::Denied);
        let f = fake(|_, _| err("expired_token")).await;
        assert_eq!(poll_until_done(&c, &f.base, &device(1, 600), TICK).await.unwrap_err(), AuthError::Expired);
        // The code runs out on this side too, even while the server keeps saying pending.
        let f = fake(|_, _| err("authorization_pending")).await;
        assert_eq!(poll_until_done(&c, &f.base, &device(1, 5), TICK).await.unwrap_err(), AuthError::Expired);
        assert!(f.hits("/api/v1/auth/token").len() <= 5);
    }

    #[tokio::test]
    async fn a_token_without_the_tyg_prefix_is_refused() {
        let f = fake(|_, _| (200, ISSUED.replace("tyg_abc", "abc"))).await;
        assert!(matches!(poll_token(&http_client().unwrap(), &f.base, "d").await, PollReply::Server));
    }

    #[tokio::test]
    async fn me_sends_the_bearer_token_and_reads_401() {
        let c = http_client().unwrap();
        let f = fake(|r, _| if r.auth.as_deref() == Some("Bearer tyg_ok") { (200, ME.into()) } else { (401, r#"{"error":"unauthorized"}"#.into()) }).await;
        let Me::Account(a) = fetch_me(&c, &f.base, "tyg_ok").await else { panic!("expected the account") };
        assert_eq!((a.plan.as_str(), a.features.as_slice()), ("pro", ["voiceover".to_string()].as_slice()));
        assert_eq!(f.hits("/api/v1/me")[0].method, "GET");
        assert!(matches!(fetch_me(&c, &f.base, "tyg_old").await, Me::Unauthorized));
        let f = fake(|_, _| (503, "{}".into())).await;
        assert!(matches!(fetch_me(&c, &f.base, "tyg_ok").await, Me::Unavailable));
        assert!(matches!(fetch_me(&c, &dead_base().await, "tyg_ok").await, Me::Unavailable));
    }

    #[tokio::test]
    async fn revoke_posts_logout_with_the_token() {
        let f = fake(|_, _| (204, String::new())).await;
        revoke(&http_client().unwrap(), &f.base, "tyg_ok").await;
        let hits = f.hits("/api/v1/auth/logout");
        assert_eq!((hits[0].method.as_str(), hits[0].auth.as_deref()), ("POST", Some("Bearer tyg_ok")));
        revoke(&http_client().unwrap(), &dead_base().await, "tyg_ok").await;
    }
}
