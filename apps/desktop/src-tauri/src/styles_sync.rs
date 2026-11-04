//! Built-in styles from the Tayang API: sync into SQLite and install a style's starter
//! template (a zip) into a project folder.

use crate::db::Db;
use crate::projects::ensure_inside;
use crate::types::{Style, StyleSource, StylesSync};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};

/// Refuse templates that would unpack to more than this many bytes (zip bombs).
const MAX_UNPACKED: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct Fetched {
    pub status: u16,
    pub body: Vec<u8>,
}

/// HTTP GET, injectable so tests never touch the network.
#[allow(async_fn_in_trait)]
pub trait Fetcher {
    async fn get(&self, url: &str) -> Result<Fetched, String>;
}

/// `reqwest`-backed fetcher with a per-request timeout.
pub struct HttpFetcher {
    client: reqwest::Client,
}

impl HttpFetcher {
    pub fn new(timeout: std::time::Duration) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .timeout(timeout)
            .user_agent(concat!("tayang-studio/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self { client })
    }
}

impl Fetcher for HttpFetcher {
    async fn get(&self, url: &str) -> Result<Fetched, String> {
        let res = self.client.get(url).send().await.map_err(|e| e.to_string())?;
        let status = res.status().as_u16();
        let body = res.bytes().await.map_err(|e| e.to_string())?.to_vec();
        Ok(Fetched { status, body })
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn endpoint(api_url: &str, path: &str) -> String {
    format!("{}{}", api_url.trim_end_matches('/'), path)
}

#[derive(Deserialize)]
struct StylesBody {
    styles: Vec<Style>,
}

/// GETs `/v1/styles` and replaces the cached built-ins. Any failure (network, status,
/// bad body, db) keeps the cache and reports `offline: true`.
pub async fn sync_styles<F: Fetcher>(db: &Db, api_url: &str, fetcher: &F) -> StylesSync {
    let fresh = async {
        let res = fetcher.get(&endpoint(api_url, "/v1/styles")).await?;
        if !(200..300).contains(&res.status) {
            return Err(format!("styles request returned {}", res.status));
        }
        let mut body: StylesBody = serde_json::from_slice(&res.body).map_err(|e| e.to_string())?;
        for s in &mut body.styles {
            s.source = StyleSource::Builtin;
        }
        db.replace_builtin_styles(&body.styles).map_err(|e| e.to_string())
    }
    .await;
    StylesSync { styles: db.list_styles().unwrap_or_default(), offline: fresh.is_err() }
}

/// True when the folder holds nothing but the files Tayang itself writes.
fn is_fresh_folder(folder: &Path) -> bool {
    std::fs::read_dir(folder)
        .map(|rd| {
            rd.filter_map(|e| e.ok()).all(|e| {
                matches!(e.file_name().to_string_lossy().as_ref(), "AGENTS.md" | "CLAUDE.md" | ".tayang")
            })
        })
        .unwrap_or(false)
}

/// Installs the project's style template into its folder. `Ok(false)` when the style has no
/// template or the folder already has the user's files.
pub async fn install_template<F: Fetcher>(
    db: &Db,
    fetcher: &F,
    api_url: &str,
    templates_dir: &Path,
    project_id: &str,
) -> Result<bool, String> {
    let project = db
        .get_project(project_id)
        .map_err(|e| e.to_string())?
        .ok_or("That project no longer exists")?;
    let Some(style_id) = project.style_id else { return Ok(false) };
    let Some(template) = db.get_style(&style_id).map_err(|e| e.to_string())?.and_then(|s| s.template)
    else {
        return Ok(false);
    };
    let folder = PathBuf::from(&project.folder);
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    if !is_fresh_folder(&folder) {
        return Ok(false);
    }
    let want = template.sha256.to_ascii_lowercase();
    let cached = templates_dir.join(format!("{want}.zip"));
    let bytes = match std::fs::read(&cached) {
        Ok(b) if sha256_hex(&b) == want => b,
        _ => {
            let url = endpoint(api_url, &format!("/v1/styles/{}/template", urlencode(&style_id)));
            let res = fetcher.get(&url).await?;
            if !(200..300).contains(&res.status) {
                return Err(format!("Couldn't download the template (status {})", res.status));
            }
            if sha256_hex(&res.body) != want {
                return Err("The downloaded template failed its checksum".into());
            }
            std::fs::create_dir_all(templates_dir).map_err(|e| e.to_string())?;
            std::fs::write(&cached, &res.body).map_err(|e| e.to_string())?;
            res.body
        }
    };
    extract_zip(&bytes, &folder)?;
    Ok(true)
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Entry names that stay relative and inside the destination.
fn safe_relative(name: &str) -> Option<PathBuf> {
    if name.contains('\\') || name.contains(':') || name.contains('\0') {
        return None;
    }
    let p = Path::new(name);
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::Normal(n) => out.push(n),
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(out)
}

/// Unpacks `bytes` into `dest`, never overwriting existing files. Every entry is checked
/// first (absolute paths, `..`, symlinks, `ensure_inside`) so a bad zip writes nothing.
/// Returns how many files were written.
pub fn extract_zip(bytes: &[u8], dest: &Path) -> Result<usize, String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    let mut plan: Vec<(usize, PathBuf, bool)> = Vec::new();
    let mut total = 0u64;
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        let rel = safe_relative(&name).ok_or_else(|| format!("Unsafe path in template: {name}"))?;
        if entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000) {
            return Err(format!("Symlink in template: {name}"));
        }
        if rel.as_os_str().is_empty() {
            continue;
        }
        let target = dest.join(&rel);
        if !ensure_inside(dest, &target) {
            return Err(format!("Unsafe path in template: {name}"));
        }
        total = total.saturating_add(entry.size());
        if total > MAX_UNPACKED {
            return Err("The template is too large".into());
        }
        plan.push((i, target, entry.is_dir()));
    }
    let mut written = 0;
    for (i, target, is_dir) in plan {
        if is_dir {
            std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
            continue;
        }
        if target.exists() {
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let mut buf = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        std::fs::write(&target, &buf).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode().filter(|m| m & 0o111 != 0) {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(mode & 0o777));
        }
        written += 1;
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use crate::types::*;
    use std::collections::{BTreeMap, HashMap};
    use std::io::Write;
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeFetcher {
        routes: HashMap<String, (u16, Vec<u8>)>,
        calls: Mutex<Vec<String>>,
    }

    impl Fetcher for FakeFetcher {
        async fn get(&self, url: &str) -> Result<Fetched, String> {
            self.calls.lock().unwrap().push(url.to_string());
            match self.routes.get(url) {
                Some((status, body)) => Ok(Fetched { status: *status, body: body.clone() }),
                None => Err("offline".into()),
            }
        }
    }

    fn zip_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let opts = zip::write::SimpleFileOptions::default();
        for (name, data) in entries {
            w.start_file(*name, opts).unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    fn style(id: &str, template: Option<(&[u8], u32)>) -> Style {
        Style {
            id: id.into(),
            name: id.into(),
            source: StyleSource::Builtin,
            source_url: None,
            notes: BTreeMap::new(),
            prompt: "p".into(),
            created_at: "2026-11-04T00:00:00Z".into(),
            engine: Some(StyleEngine::Remotion),
            preview_url: None,
            template: template.map(|(b, v)| StyleTemplate {
                sha256: sha256_hex(b),
                size: b.len() as u64,
                version: v,
            }),
            version: Some(1),
        }
    }

    fn list_route(styles: &[Style]) -> (String, (u16, Vec<u8>)) {
        (
            "https://api.test/v1/styles".into(),
            (200, serde_json::to_vec(&serde_json::json!({ "styles": styles })).unwrap()),
        )
    }

    #[tokio::test]
    async fn sync_upserts_builtins_and_deletes_stale() {
        let db = Db::open_in_memory().unwrap();
        db.replace_builtin_styles(&[style("builtin-news-recap", None)]).unwrap();
        let mut f = FakeFetcher::default();
        let (k, v) = list_route(&[style("a", None), style("b", None)]);
        f.routes.insert(k, v);
        let out = sync_styles(&db, "https://api.test/", &f).await;
        assert!(!out.offline);
        let ids: Vec<_> = out.styles.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["a", "b"]);
        assert_eq!(db.list_styles().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn sync_offline_keeps_cache() {
        let db = Db::open_in_memory().unwrap();
        db.replace_builtin_styles(&[style("a", None)]).unwrap();
        let out = sync_styles(&db, "https://api.test", &FakeFetcher::default()).await;
        assert!(out.offline);
        assert_eq!(out.styles.len(), 1);
        // Server errors and garbage bodies also keep the cache.
        let mut f = FakeFetcher::default();
        f.routes.insert("https://api.test/v1/styles".into(), (500, b"x".to_vec()));
        assert!(sync_styles(&db, "https://api.test", &f).await.offline);
        f.routes.insert("https://api.test/v1/styles".into(), (200, b"not json".to_vec()));
        let out = sync_styles(&db, "https://api.test", &f).await;
        assert!(out.offline);
        assert_eq!(db.list_styles().unwrap().len(), 1);
    }

    struct Setup {
        db: Db,
        tmp: tempfile::TempDir,
        folder: std::path::PathBuf,
        templates: std::path::PathBuf,
    }

    fn setup(zip: &[u8], claimed: &[u8]) -> (Setup, FakeFetcher) {
        let tmp = tempfile::tempdir().unwrap();
        let folder = tmp.path().join("proj");
        std::fs::create_dir_all(&folder).unwrap();
        let db = Db::open_in_memory().unwrap();
        db.replace_builtin_styles(&[style("atlas", Some((claimed, 1)))]).unwrap();
        let p = Project {
            id: "p1".into(),
            title: "t".into(),
            slug: "t".into(),
            folder: folder.to_string_lossy().into_owned(),
            kind: VideoKind::Promo,
            format: VideoFormat::Portrait,
            language: VideoLanguage::Id,
            status: ProjectStatus::Draft,
            style_id: Some("atlas".into()),
            scheduled_at: None,
            duration_sec: None,
            created_at: "t".into(),
            updated_at: "t".into(),
        };
        db.insert_project(&p).unwrap();
        let mut f = FakeFetcher::default();
        f.routes.insert("https://api.test/v1/styles/atlas/template".into(), (200, zip.to_vec()));
        let templates = tmp.path().join("templates");
        (Setup { db, tmp, folder, templates }, f)
    }

    #[tokio::test]
    async fn install_extracts_caches_and_skips_existing_files() {
        let z = zip_bytes(&[
            ("tayang.json", b"{}"),
            ("src/index.ts", b"export {}"),
            ("AGENTS.md", b"from template"),
        ]);
        let (s, f) = setup(&z, &z);
        std::fs::write(s.folder.join("AGENTS.md"), "mine").unwrap();
        std::fs::write(s.folder.join("CLAUDE.md"), "mine").unwrap();
        std::fs::create_dir_all(s.folder.join(".tayang")).unwrap();
        let ok = install_template(&s.db, &f, "https://api.test", &s.templates, "p1").await.unwrap();
        assert!(ok);
        assert_eq!(std::fs::read(s.folder.join("src").join("index.ts")).unwrap(), b"export {}");
        assert_eq!(std::fs::read_to_string(s.folder.join("AGENTS.md")).unwrap(), "mine");
        assert!(s.templates.join(format!("{}.zip", sha256_hex(&z))).exists());
        // Second project folder with a populated folder is skipped.
        let again = install_template(&s.db, &f, "https://api.test", &s.templates, "p1").await.unwrap();
        assert!(!again);
        // A cached zip is not downloaded again.
        std::fs::remove_dir_all(s.folder.join("src")).unwrap();
        std::fs::remove_file(s.folder.join("tayang.json")).unwrap();
        let calls_before = f.calls.lock().unwrap().len();
        assert!(install_template(&s.db, &f, "https://api.test", &s.templates, "p1").await.unwrap());
        assert_eq!(f.calls.lock().unwrap().len(), calls_before);
        let _ = &s.tmp;
    }

    #[tokio::test]
    async fn install_rejects_sha_mismatch() {
        let z = zip_bytes(&[("a.txt", b"x")]);
        let (s, f) = setup(&z, b"something else");
        let err = install_template(&s.db, &f, "https://api.test", &s.templates, "p1")
            .await
            .unwrap_err();
        assert!(err.contains("checksum"), "{err}");
        assert!(!s.folder.join("a.txt").exists());
        assert!(!s.templates.exists() || std::fs::read_dir(&s.templates).unwrap().count() == 0);
    }

    #[tokio::test]
    async fn install_without_template_does_nothing() {
        let (s, f) = setup(b"", b"");
        s.db.replace_builtin_styles(&[style("atlas", None)]).unwrap();
        assert!(!install_template(&s.db, &f, "https://api.test", &s.templates, "p1").await.unwrap());
    }

    #[test]
    fn extract_rejects_zip_slip_and_absolute_entries() {
        for bad in ["../evil.txt", "a/../../evil.txt", "/abs/evil.txt", "C:\\evil.txt", "..\\evil.txt"] {
            let tmp = tempfile::tempdir().unwrap();
            let dest = tmp.path().join("d");
            std::fs::create_dir_all(&dest).unwrap();
            let z = zip_bytes(&[("ok.txt", b"1"), (bad, b"x")]);
            assert!(extract_zip(&z, &dest).is_err(), "{bad}");
            assert!(!dest.join("ok.txt").exists(), "nothing is written when any entry is bad");
            assert!(!tmp.path().join("evil.txt").exists());
        }
    }

    #[test]
    fn extract_rejects_symlink_entries() {
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        w.add_symlink("link", "/etc/passwd", zip::write::SimpleFileOptions::default()).unwrap();
        let z = w.finish().unwrap().into_inner();
        let tmp = tempfile::tempdir().unwrap();
        assert!(extract_zip(&z, tmp.path()).is_err());
    }

    #[test]
    fn extract_never_overwrites() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("a.txt"), "mine").unwrap();
        let z = zip_bytes(&[("a.txt", b"theirs"), ("d/b.txt", b"new")]);
        let n = extract_zip(&z, tmp.path()).unwrap();
        assert_eq!(n, 1);
        assert_eq!(std::fs::read_to_string(tmp.path().join("a.txt")).unwrap(), "mine");
        assert_eq!(std::fs::read_to_string(tmp.path().join("d").join("b.txt")).unwrap(), "new");
    }
}
