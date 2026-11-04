//! Project folders on disk plus the slug helpers shared with the TS side.

use std::io;
use std::path::{Path, PathBuf};

pub fn slugify(_title: &str) -> String {
    todo!()
}

pub fn unique_slug(_base: &str, _taken: &[String]) -> String {
    todo!()
}

pub fn create_project_folder(
    _working: &Path,
    _title: &str,
    _existing_slugs: &[String],
) -> io::Result<(String, PathBuf)> {
    todo!()
}

pub fn write_project_brief(_folder: &Path, _brief: &str) -> io::Result<()> {
    todo!()
}

pub fn ensure_inside(_working: &Path, _p: &Path) -> bool {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_cases() {
        assert_eq!(slugify("Kopi \"Senja\""), "kopi-senja");
        assert_eq!(slugify("Café Déjà Vu"), "cafe-deja-vu");
        assert_eq!(slugify("???"), "video");
        assert_eq!(slugify(""), "video");
        assert_eq!(slugify("  --Hello   World--  "), "hello-world");
        let long = slugify(&"ab ".repeat(40));
        assert!(long.len() <= 48 && !long.ends_with('-'));
    }

    #[test]
    fn unique_slug_cases() {
        let t = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(unique_slug("promo", &t(&[])), "promo");
        assert_eq!(unique_slug("promo", &t(&["promo"])), "promo-2");
        assert_eq!(unique_slug("promo", &t(&["promo", "promo-2"])), "promo-3");
    }

    #[test]
    fn create_folder_and_brief() {
        let tmp = tempfile::tempdir().unwrap();
        let working = tmp.path().join("Video Saya");
        let (slug, dir) = create_project_folder(&working, "Kopi \"Senja\"", &[]).unwrap();
        assert_eq!(slug, "kopi-senja");
        assert!(dir.is_dir() && dir.ends_with("kopi-senja"));
        assert!(dir.join("AGENTS.md").is_file());
        write_project_brief(&dir, "# Brief").unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("AGENTS.md")).unwrap(), "# Brief");
        assert_eq!(std::fs::read_to_string(dir.join("CLAUDE.md")).unwrap(), "# Brief");

        let (s, _) = create_project_folder(&working, "???", &[]).unwrap();
        assert_eq!(s, "video");
        let (s, _) = create_project_folder(&working, "Promo", &[]).unwrap();
        assert_eq!(s, "promo");
        let (s, d) = create_project_folder(&working, "Promo", &["promo".to_string()]).unwrap();
        assert_eq!(s, "promo-2");
        assert!(d.is_dir());
        // folder already on disk but unknown to the caller is not reused
        let (s, _) = create_project_folder(&working, "Promo", &[]).unwrap();
        assert_eq!(s, "promo-3");
    }

    #[test]
    fn ensure_inside_rules() {
        let tmp = tempfile::tempdir().unwrap();
        let w = tmp.path().join("work");
        std::fs::create_dir_all(&w).unwrap();
        assert!(ensure_inside(&w, &w.join("a").join("b")));
        assert!(ensure_inside(&w, &w));
        assert!(!ensure_inside(&w, Path::new("../x")));
        assert!(!ensure_inside(&w, &w.join("..").join("x")));
        assert!(!ensure_inside(&w, tmp.path()));
        assert!(!ensure_inside(&w, &tmp.path().join("work2")));
    }
}
