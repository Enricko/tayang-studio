//! ffmpeg/ffprobe helpers: probing, frame extraction, thumbnails, HyperFrames rendering.
//! Every process is spawned with an args array (never a shell string), so paths
//! containing spaces or quotes are safe.

use crate::types::MediaInfo;
use std::path::{Path, PathBuf};
use std::process::Command;

pub type Result<T> = std::result::Result<T, String>;

#[derive(Debug, Clone)]
pub struct MediaTools {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
}

impl MediaTools {
    /// Uses `FFMPEG_PATH` / `FFPROBE_PATH` when set, else `ffmpeg` / `ffprobe` from PATH.
    pub fn from_env_or_path() -> Self {
        let pick = |var: &str, default: &str| {
            std::env::var_os(var)
                .filter(|v| !v.is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(default))
        };
        Self { ffmpeg: pick("FFMPEG_PATH", "ffmpeg"), ffprobe: pick("FFPROBE_PATH", "ffprobe") }
    }
}

/// Builds a command that never flashes a console window on Windows.
#[allow(unused_mut)]
fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

fn run(mut cmd: Command, what: &str) -> Result<std::process::Output> {
    let out = cmd.output().map_err(|e| format!("could not run {what}: {e}"))?;
    if out.status.success() {
        Ok(out)
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr);
        Err(format!("{what} failed: {}", stderr.trim()))
    }
}

fn newest_mp4(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.is_file() && p.extension().map(|x| x.eq_ignore_ascii_case("mp4")).unwrap_or(false)
        })
        .filter_map(|p| {
            let m = p.metadata().ok()?.modified().ok()?;
            Some((m, p))
        })
        .max_by_key(|(m, _)| *m)
        .map(|(_, p)| p)
}

/// Newest `*.mp4` in `<folder>/renders/`, else in `<folder>/`.
pub fn latest_render(folder: &Path) -> Option<PathBuf> {
    newest_mp4(&folder.join("renders")).or_else(|| newest_mp4(folder))
}

fn parse_fps(s: &str) -> Option<f64> {
    let (n, d) = match s.split_once('/') {
        Some((n, d)) => (n.trim().parse::<f64>().ok()?, d.trim().parse::<f64>().ok()?),
        None => (s.trim().parse::<f64>().ok()?, 1.0),
    };
    if d == 0.0 || n <= 0.0 {
        None
    } else {
        Some(n / d)
    }
}

pub fn probe(tools: &MediaTools, video: &Path) -> Result<MediaInfo> {
    let mut cmd = command(&tools.ffprobe);
    cmd.args([
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,r_frame_rate,nb_frames:format=duration",
        "-of",
        "json",
    ])
    .arg(video);
    let out = run(cmd, "ffprobe")?;
    let v: serde_json::Value =
        serde_json::from_slice(&out.stdout).map_err(|e| format!("bad ffprobe output: {e}"))?;
    let stream = v["streams"].get(0).ok_or("no video stream found")?;
    let width = stream["width"].as_u64().ok_or("missing width")? as u32;
    let height = stream["height"].as_u64().ok_or("missing height")? as u32;
    let fps = stream["r_frame_rate"].as_str().and_then(parse_fps).ok_or("missing frame rate")?;
    let duration_sec = v["format"]["duration"]
        .as_str()
        .and_then(|d| d.parse::<f64>().ok())
        .ok_or("missing duration")?;
    let frames = stream["nb_frames"]
        .as_str()
        .and_then(|n| n.parse::<u64>().ok())
        .unwrap_or_else(|| (duration_sec * fps).round() as u64);
    Ok(MediaInfo { duration_sec, fps, frames, width, height })
}

fn grab(
    tools: &MediaTools,
    video: &Path,
    time_sec: f64,
    out: &Path,
    scale_height: Option<u32>,
) -> Result<()> {
    let mut cmd = command(&tools.ffmpeg);
    cmd.args(["-v", "error", "-y", "-ss"])
        .arg(format!("{:.3}", time_sec.max(0.0)))
        .arg("-i")
        .arg(video)
        .args(["-frames:v", "1"]);
    if let Some(h) = scale_height {
        cmd.arg("-vf").arg(format!("scale=-2:{h}"));
    }
    cmd.arg(out);
    run(cmd, "ffmpeg")?;
    if out.exists() {
        Ok(())
    } else {
        Err("ffmpeg produced no frame (time past end of video?)".into())
    }
}

/// `<out_dir>/frame-<ms>.png`
pub fn extract_frame(
    tools: &MediaTools,
    video: &Path,
    time_sec: f64,
    out_dir: &Path,
) -> Result<PathBuf> {
    std::fs::create_dir_all(out_dir).map_err(|e| e.to_string())?;
    let ms = (time_sec.max(0.0) * 1000.0).round() as u64;
    let out = out_dir.join(format!("frame-{ms}.png"));
    grab(tools, video, time_sec, &out, None)?;
    Ok(out)
}

/// `count` evenly spaced frames (centred in equal segments), scaled to height 96.
pub fn thumbnails(
    tools: &MediaTools,
    video: &Path,
    count: u32,
    out_dir: &Path,
) -> Result<Vec<PathBuf>> {
    if count == 0 {
        return Ok(Vec::new());
    }
    std::fs::create_dir_all(out_dir).map_err(|e| e.to_string())?;
    let info = probe(tools, video)?;
    let last = (info.duration_sec - 0.05).max(0.0);
    (0..count)
        .map(|i| {
            let t = (info.duration_sec * (i as f64 + 0.5) / count as f64).min(last);
            let out = out_dir.join(format!("thumb-{i:03}.png"));
            grab(tools, video, t, &out, Some(96))?;
            Ok(out)
        })
        .collect()
}

/// Arguments for `npx` (pinned, non-interactive), run with `folder` as the working directory.
/// `--output` pins the file into `<folder>/renders/`.
pub fn render_args(folder: &Path) -> Vec<String> {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let out = folder.join("renders").join(format!("render-{secs}.mp4"));
    vec![
        "-y".into(),
        "hyperframes@0.9.10".into(),
        "render".into(),
        "--output".into(),
        out.to_string_lossy().into_owned(),
        "--quiet".into(),
    ]
}

pub fn render(folder: &Path) -> Result<PathBuf> {
    std::fs::create_dir_all(folder.join("renders")).map_err(|e| e.to_string())?;
    // GUI apps can start with a minimal PATH, so resolve npx the way detection does.
    let npx = crate::system::Exec::which(&crate::system::RealExec, "npx")
        .unwrap_or_else(|| PathBuf::from(if cfg!(windows) { "npx.cmd" } else { "npx" }));
    let mut cmd = command(npx);
    cmd.args(render_args(folder)).current_dir(folder);
    run(cmd, "hyperframes render")?;
    latest_render(folder).ok_or_else(|| "render finished but no mp4 was found".to_string())
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
    fn parse_fps_handles_rationals() {
        assert_eq!(parse_fps("30/1"), Some(30.0));
        assert!((parse_fps("30000/1001").unwrap() - 29.97).abs() < 0.01);
        assert_eq!(parse_fps("0/0"), None);
        assert_eq!(parse_fps("25"), Some(25.0));
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
        assert_eq!(&args[..3], ["-y", "hyperframes@0.9.10", "render"]);
        let i = args.iter().position(|a| a == "--output").unwrap();
        assert!(Path::new(&args[i + 1]).starts_with(folder.join("renders")));
        assert!(args[i + 1].ends_with(".mp4"));
    }
}
