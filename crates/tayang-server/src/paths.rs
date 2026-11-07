//! File-system boundaries for the web edition. Every absolute path that reaches the browser is
//! checked against the configured workspace/data roots after canonicalization (so symlinks that
//! point outside are refused too).

use crate::state::AppState;
use std::path::{Path, PathBuf};

pub fn canonical_dir(path: &Path) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(path)?;
    std::fs::canonicalize(path)
}

/// The workspace root plus the app-data folders that hold style previews and thumbnails. These are
/// the only folders an asset request may read.
pub fn allowed_roots(state: &AppState) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(root) = std::fs::canonicalize(&state.config.workspace_root) {
        out.push(root);
    }
    for dir in ["style-media", "style-refs", "thumbs"] {
        let p = state.data_dir.join(dir);
        if let Ok(c) = std::fs::canonicalize(&p) {
            out.push(c);
        }
    }
    out
}

/// Resolves an existing asset path, refusing anything outside the allowed roots.
pub fn resolve_asset(state: &AppState, requested: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(requested);
    if !path.is_absolute() {
        return Err("Asset paths must be absolute".into());
    }
    let canonical = std::fs::canonicalize(&path).map_err(|_| "That file isn't there any more".to_string())?;
    if !canonical.is_file() {
        return Err("That isn't a file".into());
    }
    if !allowed_roots(state).iter().any(|root| canonical.starts_with(root)) {
        return Err("That file is outside the configured workspace".into());
    }
    Ok(canonical)
}

/// A project folder must be inside the workspace root. The desktop app lets users choose any folder;
/// the self-hosted web edition intentionally does not.
pub fn project_folder(state: &AppState, project_id: &str) -> Result<PathBuf, String> {
    let p = state
        .db
        .get_project(project_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "That project no longer exists".to_string())?;
    let folder = PathBuf::from(&p.folder);
    if !in_workspace(state, &folder) {
        return Err("This project's folder is outside the server workspace".into());
    }
    Ok(folder)
}

pub fn in_workspace(state: &AppState, path: &Path) -> bool {
    let Ok(root) = std::fs::canonicalize(&state.config.workspace_root) else { return false };
    let check = if path.exists() {
        std::fs::canonicalize(path).ok()
    } else {
        // For a path that doesn't exist yet, canonicalize its nearest existing parent and append
        // the rest lexically. This is how uploads and new project folders are checked.
        let mut existing = path;
        let mut rest = Vec::new();
        loop {
            if let Ok(c) = std::fs::canonicalize(existing) {
                let mut out = c;
                for name in rest.iter().rev() {
                    out.push(name);
                }
                break Some(out);
            }
            let Some(name) = existing.file_name() else { break None };
            rest.push(name.to_os_string());
            let Some(parent) = existing.parent() else { break None };
            existing = parent;
        }
    };
    check.is_some_and(|p| p.starts_with(root))
}

/// Validate a `workingFolder` patch. Only a path inside the configured workspace root is accepted.
pub fn validate_working_folder(state: &AppState, candidate: &str) -> Result<(), String> {
    let path = PathBuf::from(candidate.trim());
    if candidate.trim().is_empty() {
        return Err("The working folder can't be empty".into());
    }
    if !in_workspace(state, &path) {
        return Err("The web edition only works inside the configured workspace root".into());
    }
    if path == state.config.workspace_root {
        return Err("Choose a folder inside the workspace root, not the root itself".into());
    }
    Ok(())
}

pub fn content_type(path: &Path) -> String {
    mime_guess::from_path(path)
        .first_or_octet_stream()
        .essence_str()
        .to_string()
}

pub fn etag(meta: &std::fs::Metadata) -> String {
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("\"{:x}-{:x}\"", meta.len(), modified)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assets_are_only_served_from_the_workspace_or_style_folders() {
        let tmp = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(tmp.path());
        let inside = state.config.workspace_root.join("tayang/render.mp4");
        std::fs::create_dir_all(inside.parent().unwrap()).unwrap();
        std::fs::write(&inside, b"video").unwrap();
        assert!(resolve_asset(&state, inside.to_str().unwrap()).is_ok());

        let outside = tmp.path().join("secret.txt");
        std::fs::write(&outside, b"no").unwrap();
        assert!(resolve_asset(&state, outside.to_str().unwrap()).is_err());
        // Relative paths never reach the resolver.
        assert!(resolve_asset(&state, "relative/file").is_err());
        assert!(resolve_asset(&state, inside.to_str().unwrap()).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_the_workspace_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(tmp.path());
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret.txt"), b"no").unwrap();
        let link = state.config.workspace_root.join("tayang/escape");
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        assert!(resolve_asset(&state, link.join("secret.txt").to_str().unwrap()).is_err());
    }

    #[test]
    fn working_folder_must_be_inside_the_workspace_root() {
        let tmp = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(tmp.path());
        let inside = state.config.workspace_root.join("tayang/sub");
        std::fs::create_dir_all(&inside).unwrap();
        assert!(validate_working_folder(&state, inside.to_str().unwrap()).is_ok());
        assert!(validate_working_folder(&state, state.config.workspace_root.to_str().unwrap()).is_err());
        let outside = tmp.path().join("elsewhere");
        std::fs::create_dir_all(&outside).unwrap();
        assert!(validate_working_folder(&state, outside.to_str().unwrap()).is_err());
        assert!(validate_working_folder(&state, "../escape").is_err());
    }

    #[test]
    fn a_project_row_pointing_outside_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(tmp.path());
        let outside = tmp.path().join("outside-project");
        std::fs::create_dir_all(&outside).unwrap();
        let project = tayang_core::types::Project {
            id: "p".into(),
            title: "P".into(),
            slug: "p".into(),
            folder: outside.to_string_lossy().into_owned(),
            kind: tayang_core::types::VideoKind::Explainer,
            format: tayang_core::types::VideoFormat::Portrait,
            language: tayang_core::types::VideoLanguage::En,
            status: tayang_core::types::ProjectStatus::Draft,
            style_id: None,
            scheduled_at: None,
            review_state: tayang_core::types::ReviewState::None,
            posted_at: None,
            reminded_at: None,
            review_reminded_at: None,
            social_post_id: None,
            duration_sec: None,
            created_at: "t".into(),
            updated_at: "t".into(),
        };
        state.db.insert_project(&project).unwrap();
        assert!(project_folder(&state, "p").is_err());
    }
}
