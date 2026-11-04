//! ffmpeg/ffprobe helpers: probing, frame extraction, thumbnails, HyperFrames rendering.

use crate::types::MediaInfo;
use std::path::{Path, PathBuf};

pub type Result<T> = std::result::Result<T, String>;

#[derive(Debug, Clone)]
pub struct MediaTools {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
}

impl MediaTools {
    pub fn from_env_or_path() -> Self {
        unimplemented!()
    }
}

pub fn latest_render(_folder: &Path) -> Option<PathBuf> {
    unimplemented!()
}

pub fn probe(_tools: &MediaTools, _video: &Path) -> Result<MediaInfo> {
    unimplemented!()
}

pub fn extract_frame(_tools: &MediaTools, _video: &Path, _time_sec: f64, _out_dir: &Path) -> Result<PathBuf> {
    unimplemented!()
}

pub fn thumbnails(_tools: &MediaTools, _video: &Path, _count: u32, _out_dir: &Path) -> Result<Vec<PathBuf>> {
    unimplemented!()
}

pub fn render_args(_folder: &Path) -> Vec<String> {
    unimplemented!()
}

pub fn render(_folder: &Path) -> Result<PathBuf> {
    unimplemented!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn test_tools() -> Option<MediaTools> {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let ffmpeg = std::env::var_os("FFMPEG_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| manifest.join("../node_modules/ffmpeg-static/ffmpeg"));
        let ffprobe = std::env::var_os("FFPROBE_PATH").map(PathBuf::from).unwrap_or_else(|| {
            let os = match std::env::consts::OS {
                "macos" => "darwin",
                "windows" => "win32",
                o => o,
            };
            let arch = match std::env::consts::ARCH {
                "aarch64" => "arm64",
                "x86_64" => "x64",
                a => a,
            };
            let exe = if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" };
            manifest.join("../node_modules/ffprobe-static/bin").join(os).join(arch).join(exe)
        });
        if ffmpeg.exists() && ffprobe.exists() {
            Some(MediaTools { ffmpeg, ffprobe })
        } else {
            eprintln!("skipping media test: ffmpeg/ffprobe not found (set FFMPEG_PATH/FFPROBE_PATH or run pnpm install)");
            None
        }
    }

    /// Returns (tempdir guard, clip path). The directory name contains a space (and `"` on unix).
    fn make_clip(tools: &MediaTools) -> (tempfile::TempDir, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let name = if cfg!(unix) { "my \"clip\" dir" } else { "my clip dir" };
        let dir = tmp.path().join(name);
        std::fs::create_dir_all(&dir).unwrap();
        let clip = dir.join("clip.mp4");
        let out = Command::new(&tools.ffmpeg)
            .args(["-y", "-f", "lavfi", "-i", "testsrc=size=270x480:rate=30", "-t", "2", "-pix_fmt", "yuv420p"])
            .arg(&clip)
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        (tmp, clip)
    }

    #[test]
    fn probe_reads_clip_metadata() {
        let Some(t) = test_tools() else { return };
        let (_g, clip) = make_clip(&t);
        let info = probe(&t, &clip).unwrap();
        assert!((info.duration_sec - 2.0).abs() < 0.1, "{info:?}");
        assert_eq!(info.fps, 30.0);
        assert_eq!((info.width, info.height), (270, 480));
        assert_eq!(info.frames, 60);
    }

    #[test]
    fn probe_missing_file_errors() {
        let Some(t) = test_tools() else { return };
        assert!(probe(&t, Path::new("/definitely/not/here.mp4")).is_err());
    }

    #[test]
    fn extract_frame_writes_png() {
        let Some(t) = test_tools() else { return };
        let (g, clip) = make_clip(&t);
        let out_dir = g.path().join("out dir");
        let p = extract_frame(&t, &clip, 1.0, &out_dir).unwrap();
        assert!(p.exists());
        assert_eq!(p.file_name().unwrap(), "frame-1000.png");
        assert!(std::fs::metadata(&p).unwrap().len() > 0);
    }

    #[test]
    fn thumbnails_returns_count_files() {
        let Some(t) = test_tools() else { return };
        let (g, clip) = make_clip(&t);
        let out_dir = g.path().join("thumbs");
        let v = thumbnails(&t, &clip, 6, &out_dir).unwrap();
        assert_eq!(v.len(), 6);
        assert!(v.iter().all(|p| p.exists()));
        assert!(thumbnails(&t, &clip, 0, &out_dir).unwrap().is_empty());
    }

    #[test]
    fn latest_render_picks_newest_mp4() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(latest_render(tmp.path()), None);
        let renders = tmp.path().join("renders");
        std::fs::create_dir_all(&renders).unwrap();
        let old = renders.join("a.mp4");
        std::fs::write(&old, b"x").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
        let new = renders.join("b.mp4");
        std::fs::write(&new, b"x").unwrap();
        std::fs::write(renders.join("c.txt"), b"x").unwrap();
        assert_eq!(latest_render(tmp.path()), Some(new));
    }

    #[test]
    fn latest_render_falls_back_to_folder_root() {
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("out.mp4");
        std::fs::write(&f, b"x").unwrap();
        assert_eq!(latest_render(tmp.path()), Some(f));
    }

    #[test]
    fn render_args_sets_output_into_renders() {
        let folder = Path::new("proj dir");
        let args = render_args(folder);
        assert_eq!(&args[..2], ["hyperframes", "render"]);
        let i = args.iter().position(|a| a == "--output").unwrap();
        assert!(Path::new(&args[i + 1]).starts_with(folder.join("renders")));
        assert!(args[i + 1].ends_with(".mp4"));
    }
}
