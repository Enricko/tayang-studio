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
    /// Uses `FFMPEG_PATH` / `FFPROBE_PATH` when set, else resolves `ffmpeg` / `ffprobe`
    /// (falling back to the bare names).
    pub fn from_env_or_path() -> Self {
        let pick = |var: &str, default: &str| {
            std::env::var_os(var)
                .filter(|v| !v.is_empty())
                .map(PathBuf::from)
                .or_else(|| crate::system::Exec::which(&crate::system::RealExec, default))
                .unwrap_or_else(|| PathBuf::from(default))
        };
        Self { ffmpeg: pick("FFMPEG_PATH", "ffmpeg"), ffprobe: pick("FFPROBE_PATH", "ffprobe") }
    }
}

/// Builds a command that never flashes a console window on Windows.
#[allow(unused_mut)]
fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut cmd = Command::new(program);
    cmd.env("PATH", crate::system::augmented_path());
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

/// What `tayang.json` asks for (`engine` and `readme` are for the agent, not for rendering).
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
struct RenderManifest {
    render: Vec<String>,
    #[serde(default)]
    install: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderPlan {
    /// Argv to run first when `node_modules` is missing.
    pub install: Option<Vec<String>>,
    /// Argv with `{output}` already replaced.
    pub render: Vec<String>,
    /// Output path relative to the project folder.
    pub output: PathBuf,
}

const ALLOWED_PROGRAMS: [&str; 6] = ["npx", "npm", "node", "pnpm", "bun", "yarn"];

/// Templates may only run JavaScript tooling: a bare allow-listed program name.
fn check_allowed_program(argv: &[String]) -> Result<()> {
    let name = argv.first().map(String::as_str).unwrap_or("");
    let base = if cfg!(windows) {
        let lower = name.to_ascii_lowercase();
        if lower.ends_with(".cmd") || lower.ends_with(".exe") {
            name[..name.len() - 4].to_string()
        } else {
            name.to_string()
        }
    } else {
        name.to_string()
    };
    let bare = !name.contains('/') && !name.contains('\\') && !name.contains("..");
    if bare && ALLOWED_PROGRAMS.contains(&base.as_str()) {
        Ok(())
    } else {
        Err(format!("This template asks to run {name}, which Tayang doesn't allow"))
    }
}

/// `Ok(None)` when the folder has no `tayang.json` (use the HyperFrames default).
pub fn render_plan(folder: &Path, unix_secs: u64) -> Result<Option<RenderPlan>> {
    let path = folder.join("tayang.json");
    let raw = match std::fs::read_to_string(&path) {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("could not read tayang.json: {e}")),
    };
    let m: RenderManifest =
        serde_json::from_str(&raw).map_err(|e| format!("tayang.json is not valid: {e}"))?;
    if m.render.is_empty() {
        return Err("tayang.json has an empty render command".into());
    }
    check_allowed_program(&m.render)?;
    if let Some(install) = &m.install {
        check_allowed_program(install)?;
    }
    let slug = folder.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let slug = if slug.is_empty() { "render".to_string() } else { slug };
    let output = Path::new("renders").join(format!("{slug}-{unix_secs}.mp4"));
    let out_s = output.to_string_lossy().into_owned();
    let render = m.render.iter().map(|a| a.replace("{output}", &out_s)).collect();
    let install = m
        .install
        .filter(|i| !i.is_empty() && !folder.join("node_modules").exists());
    Ok(Some(RenderPlan { install, render, output }))
}

/// The render command to show the user: the `tayang.json` one, or `None` for the HyperFrames default.
pub fn render_command(folder: &Path, unix_secs: u64) -> Result<Option<RenderPlan>> {
    render_plan(folder, unix_secs)
}

/// Resolves argv[0] the way detection does (GUI apps can start with a minimal PATH).
fn argv_command(argv: &[String], folder: &Path) -> Command {
    let exec = crate::system::RealExec;
    let program = crate::system::Exec::which(&exec, &argv[0])
        .or_else(|| {
            cfg!(windows)
                .then(|| crate::system::Exec::which(&exec, &format!("{}.cmd", argv[0])))
                .flatten()
        })
        .unwrap_or_else(|| PathBuf::from(&argv[0]));
    let mut cmd = command(program);
    cmd.args(&argv[1..]).current_dir(folder);
    cmd
}

pub fn render(folder: &Path) -> Result<PathBuf> {
    std::fs::create_dir_all(folder.join("renders")).map_err(|e| e.to_string())?;
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Some(plan) = render_plan(folder, secs)? {
        if let Some(install) = &plan.install {
            run(argv_command(install, folder), "template install")?;
        }
        run(argv_command(&plan.render, folder), "template render")?;
        let out = folder.join(&plan.output);
        if out.exists() {
            return Ok(out);
        }
        return latest_render(folder).ok_or_else(|| "render finished but no mp4 was found".to_string());
    }
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

    #[test]
    fn render_plan_reads_tayang_json() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = tmp.path().join("my-video");
        std::fs::create_dir_all(&folder).unwrap();
        assert!(render_plan(&folder, 1700).unwrap().is_none(), "no tayang.json means HyperFrames");
        std::fs::write(
            folder.join("tayang.json"),
            r#"{"engine":"remotion","render":["npx","remotion","render","src/index.ts","Geo","{output}","--gl=angle"],"install":["npm","install"],"readme":"STYLE.md"}"#,
        )
        .unwrap();
        let plan = render_plan(&folder, 1700).unwrap().unwrap();
        let out = Path::new("renders").join("my-video-1700.mp4");
        assert_eq!(plan.output, out);
        assert_eq!(
            plan.render,
            ["npx", "remotion", "render", "src/index.ts", "Geo", out.to_str().unwrap(), "--gl=angle"]
        );
        assert_eq!(plan.install.as_deref(), Some(&["npm".to_string(), "install".to_string()][..]));
        // Installed already: no install step.
        std::fs::create_dir_all(folder.join("node_modules")).unwrap();
        assert!(render_plan(&folder, 1700).unwrap().unwrap().install.is_none());
    }

    #[test]
    fn render_command_is_the_manifest_render_argv() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = tmp.path().join("v");
        std::fs::create_dir_all(&folder).unwrap();
        assert_eq!(render_command(&folder, 5).unwrap(), None);
        std::fs::write(folder.join("tayang.json"), r#"{"render":["npx","remotion","render","{output}"]}"#).unwrap();
        let out = Path::new("renders").join("v-5.mp4");
        let plan = render_command(&folder, 5).unwrap().unwrap();
        assert_eq!(plan.render, ["npx", "remotion", "render", out.to_str().unwrap()]);
        assert_eq!(plan.install, None);
        std::fs::write(
            folder.join("tayang.json"),
            r#"{"render":["npx","remotion","render","{output}"],"install":["npm","install"]}"#,
        )
        .unwrap();
        let plan = render_command(&folder, 5).unwrap().unwrap();
        assert_eq!(plan.install, Some(vec!["npm".to_string(), "install".to_string()]));
        std::fs::create_dir_all(folder.join("node_modules")).unwrap();
        assert_eq!(render_command(&folder, 5).unwrap().unwrap().install, None, "installed already");
    }

    #[test]
    fn render_plan_rejects_bad_manifest() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("tayang.json"), r#"{"render":[]}"#).unwrap();
        assert!(render_plan(tmp.path(), 1).is_err());
        std::fs::write(tmp.path().join("tayang.json"), "nope").unwrap();
        assert!(render_plan(tmp.path(), 1).is_err());
    }

    #[test]
    fn render_runs_tayang_json_without_a_shell() {
        if crate::system::Exec::which(&crate::system::RealExec, "node").is_none() {
            eprintln!("skipping: node not found");
            return;
        }
        let tmp = tempfile::tempdir().unwrap();
        let folder = tmp.path().join("p q");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(
            folder.join("tayang.json"),
            r#"{"render":["node","-e","require('fs').writeFileSync(process.argv[1],'x')","{output}"]}"#,
        )
        .unwrap();
        let out = render(&folder).unwrap();
        assert!(out.exists());
        assert!(out.starts_with(folder.join("renders")));
    }

    #[test]
    fn render_plan_rejects_programs_outside_the_allow_list() {
        let tmp = tempfile::tempdir().unwrap();
        for bad in ["sh", "./x", "/bin/sh", "curl", "../npx", "node/../sh", ""] {
            let m = format!(r#"{{"render":["{bad}","{{output}}"]}}"#);
            std::fs::write(tmp.path().join("tayang.json"), m).unwrap();
            let e = render_plan(tmp.path(), 1).unwrap_err();
            assert!(e.contains("which Tayang doesn't allow"), "{bad}: {e}");
        }
        std::fs::write(tmp.path().join("tayang.json"), r#"{"render":["npx","x"],"install":["sh","-c","x"]}"#).unwrap();
        assert!(render_plan(tmp.path(), 1).unwrap_err().contains("asks to run sh"));
        std::fs::write(tmp.path().join("tayang.json"), r#"{"render":["npx","x"],"install":[]}"#).unwrap();
        assert!(render_plan(tmp.path(), 1).is_err(), "empty install argv");
        for ok in ["npx", "npm", "node", "pnpm", "bun", "yarn"] {
            std::fs::write(tmp.path().join("tayang.json"), format!(r#"{{"render":["{ok}"]}}"#)).unwrap();
            assert!(render_plan(tmp.path(), 1).unwrap().is_some(), "{ok}");
        }
    }
}
