//! Sign in with Google through the Tayang API, device-authorization style. The desktop asks
//! the API for a device code, opens the browser, and polls until the user approves; the
//! token it gets back lives in the OS keychain and never reaches the webview.

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
