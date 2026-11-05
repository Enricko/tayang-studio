//! A project's files for the workspace: its folder tree, a name search, and one file's contents to
//! show. Everything stays inside the project folder: a path is relative to it, may not climb out
//! with `..`, and a symlink that points outside is refused.

use std::collections::VecDeque;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

/// Folders shown dimmed and never searched: dependencies, builds and tool folders.
const DIM_DIRS: [&str; 6] = ["node_modules", "dist", "build", "target", "out", "__pycache__"];
/// Text files larger than this are not shown.
pub const TEXT_MAX: u64 = 1024 * 1024;
/// The search walks at most this many entries and returns at most `FIND_LIMIT` files.
const FIND_WALK: usize = 20_000;
pub const FIND_LIMIT: usize = 200;
const FIND_DEPTH: usize = 10;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    /// Relative to the project folder, with `/` between parts.
    pub path: String,
    pub dir: bool,
    pub size: u64,
    /// A dot file, or a dependency or build folder (or inside one): shown dimmed.
    pub dim: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileKind {
    Text,
    Image,
    Video,
    Audio,
    Binary,
    TooLarge,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub kind: FileKind,
    /// The absolute path, for the asset protocol and "show in folder".
    pub abs_path: String,
    pub size: u64,
    /// Only for `Text`.
    pub text: Option<String>,
}

fn is_dim_name(name: &str) -> bool {
    name.starts_with('.') || DIM_DIRS.contains(&name)
}

/// `rel` inside `root`, or an error. Empty `rel` is the root itself.
pub fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = Path::new(rel);
    if rel.components().any(|c| !matches!(c, Component::Normal(_) | Component::CurDir)) {
        return Err("That path is outside the project".into());
    }
    let base = std::fs::canonicalize(root).map_err(|e| format!("The project folder can't be read: {e}"))?;
    let full = std::fs::canonicalize(base.join(rel)).map_err(|_| "That file isn't there any more".to_string())?;
    if !full.starts_with(&base) {
        return Err("That path is outside the project".into());
    }
    Ok(full)
}

fn rel_string(rel: &Path) -> String {
    rel.components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn entry(rel_dir: &Path, name: String, meta: &std::fs::Metadata, dim_parent: bool) -> FileEntry {
    let dim = dim_parent || is_dim_name(&name);
    FileEntry { path: rel_string(&rel_dir.join(&name)), dir: meta.is_dir(), size: if meta.is_dir() { 0 } else { meta.len() }, dim, name }
}

fn sort(entries: &mut [FileEntry]) {
    entries.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
}

/// One folder's entries, folders first then by name. Symlinks are listed by what they point to and
/// skipped when that is gone.
pub fn list_dir(root: &Path, rel: &str) -> Result<Vec<FileEntry>, String> {
    let dir = resolve(root, rel)?;
    let rel_dir = PathBuf::from(rel);
    let dim_parent = rel_dir.components().any(|c| matches!(c, Component::Normal(s) if is_dim_name(&s.to_string_lossy())));
    let mut out = Vec::new();
    for e in std::fs::read_dir(&dir).map_err(|e| format!("That folder can't be read: {e}"))?.flatten() {
        let Ok(meta) = std::fs::metadata(e.path()) else { continue };
        out.push(entry(&rel_dir, e.file_name().to_string_lossy().into_owned(), &meta, dim_parent));
    }
    sort(&mut out);
    Ok(out)
}

/// Files whose name contains `query` (any case), nearest the top first. Dependency, build and dot
/// folders are not searched; symlinked folders are not followed.
pub fn find(root: &Path, query: &str) -> Result<Vec<FileEntry>, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let base = resolve(root, "")?;
    let mut out = Vec::new();
    let mut queue: VecDeque<(PathBuf, usize)> = VecDeque::from([(PathBuf::new(), 0)]);
    let mut seen = 0usize;
    while let Some((rel, depth)) = queue.pop_front() {
        let Ok(read) = std::fs::read_dir(base.join(&rel)) else { continue };
        let mut names: Vec<_> = read.flatten().collect();
        names.sort_by_key(|e| e.file_name());
        for e in names {
            seen += 1;
            if seen > FIND_WALK || out.len() >= FIND_LIMIT {
                return Ok(out);
            }
            let name = e.file_name().to_string_lossy().into_owned();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() {
                if depth < FIND_DEPTH && !is_dim_name(&name) {
                    queue.push_back((rel.join(&name), depth + 1));
                }
            } else if name.to_lowercase().contains(&q) {
                let Ok(meta) = std::fs::metadata(e.path()) else { continue };
                if meta.is_file() {
                    out.push(entry(&rel, name, &meta, false));
                }
            }
        }
    }
    Ok(out)
}

fn kind_by_extension(path: &Path) -> Option<FileKind> {
    let ext = path.extension()?.to_string_lossy().to_lowercase();
    Some(match ext.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "avif" | "bmp" | "ico" => FileKind::Image,
        "mp4" | "webm" | "mov" | "m4v" => FileKind::Video,
        "mp3" | "wav" | "m4a" | "aac" | "ogg" | "flac" => FileKind::Audio,
        _ => return None,
    })
}

/// What a file is and, for text, its contents. Images, video and audio are shown from `abs_path`;
/// text over `TEXT_MAX`, or with a NUL byte or invalid UTF-8, is not read into the UI.
pub fn read(root: &Path, rel: &str) -> Result<FileContent, String> {
    let path = resolve(root, rel)?;
    let meta = std::fs::metadata(&path).map_err(|e| format!("That file can't be read: {e}"))?;
    if meta.is_dir() {
        return Err("That is a folder".into());
    }
    let abs_path = path.to_string_lossy().into_owned();
    let size = meta.len();
    if let Some(kind) = kind_by_extension(&path) {
        return Ok(FileContent { kind, abs_path, size, text: None });
    }
    if size > TEXT_MAX {
        return Ok(FileContent { kind: FileKind::TooLarge, abs_path, size, text: None });
    }
    let mut bytes = Vec::with_capacity(size as usize);
    std::fs::File::open(&path)
        .and_then(|f| f.take(TEXT_MAX).read_to_end(&mut bytes))
        .map_err(|e| format!("That file can't be read: {e}"))?;
    let text = (!bytes[..bytes.len().min(8000)].contains(&0)).then(|| String::from_utf8(bytes).ok()).flatten();
    Ok(match text {
        Some(t) => FileContent { kind: FileKind::Text, abs_path, size, text: Some(t) },
        None => FileContent { kind: FileKind::Binary, abs_path, size, text: None },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project() -> tempfile::TempDir {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path();
        std::fs::create_dir_all(p.join("src/scenes")).unwrap();
        std::fs::create_dir_all(p.join("node_modules/react")).unwrap();
        std::fs::create_dir_all(p.join("renders")).unwrap();
        std::fs::write(p.join("src/Main.tsx"), "export const a = 1;\n").unwrap();
        std::fs::write(p.join("src/scenes/intro.tsx"), "intro").unwrap();
        std::fs::write(p.join("node_modules/react/index.js"), "x").unwrap();
        std::fs::write(p.join("AGENTS.md"), "# Brief").unwrap();
        std::fs::write(p.join(".env"), "A=1").unwrap();
        std::fs::write(p.join("renders/v-1.mp4"), "fake").unwrap();
        std::fs::write(p.join("blob.bin"), [0u8, 1, 2]).unwrap();
        tmp
    }

    #[test]
    fn lists_folders_first_and_dims_dependencies_and_dot_files() {
        let tmp = project();
        let top = list_dir(tmp.path(), "").unwrap();
        let names: Vec<&str> = top.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["node_modules", "renders", "src", ".env", "AGENTS.md", "blob.bin"]);
        assert!(top.iter().find(|e| e.name == "node_modules").unwrap().dim);
        assert!(top.iter().find(|e| e.name == ".env").unwrap().dim);
        assert!(!top.iter().find(|e| e.name == "src").unwrap().dim);
        let inner = list_dir(tmp.path(), "node_modules/react").unwrap();
        assert_eq!(inner[0].path, "node_modules/react/index.js");
        assert!(inner[0].dim, "inside a dependency folder");
        assert_eq!(list_dir(tmp.path(), "src").unwrap()[0].path, "src/scenes");
    }

    #[test]
    fn never_leaves_the_project_folder() {
        let tmp = project();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.txt"), "no").unwrap();
        assert!(read(tmp.path(), "../secret.txt").is_err());
        assert!(read(tmp.path(), &outside.path().join("secret.txt").to_string_lossy()).is_err());
        assert!(list_dir(tmp.path(), "..").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(outside.path(), tmp.path().join("escape")).unwrap();
            assert!(read(tmp.path(), "escape/secret.txt").is_err());
            assert!(list_dir(tmp.path(), "escape").is_err());
        }
    }

    #[test]
    fn reads_text_and_sorts_the_rest_by_kind() {
        let tmp = project();
        let t = read(tmp.path(), "src/Main.tsx").unwrap();
        assert_eq!(t.kind, FileKind::Text);
        assert_eq!(t.text.as_deref(), Some("export const a = 1;\n"));
        assert_eq!(read(tmp.path(), "renders/v-1.mp4").unwrap().kind, FileKind::Video);
        let b = read(tmp.path(), "blob.bin").unwrap();
        assert_eq!((b.kind, b.text), (FileKind::Binary, None));
        std::fs::write(tmp.path().join("big.txt"), vec![b'a'; TEXT_MAX as usize + 1]).unwrap();
        assert_eq!(read(tmp.path(), "big.txt").unwrap().kind, FileKind::TooLarge);
        assert!(read(tmp.path(), "src").is_err(), "a folder is not a file");
        assert!(read(tmp.path(), "gone.txt").is_err());
    }

    #[test]
    fn finds_by_name_without_searching_dependencies() {
        let tmp = project();
        let found = find(tmp.path(), "INTRO").unwrap();
        assert_eq!(found.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(), ["src/scenes/intro.tsx"]);
        assert!(find(tmp.path(), "index").unwrap().is_empty(), "node_modules is not searched");
        assert!(find(tmp.path(), "  ").unwrap().is_empty());
        // Nearest the top first.
        std::fs::write(tmp.path().join("main.css"), "").unwrap();
        let mains: Vec<String> = find(tmp.path(), "main").unwrap().into_iter().map(|e| e.path).collect();
        assert_eq!(mains, ["main.css", "src/Main.tsx"]);
    }
}
