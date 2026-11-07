//! Detects the OS, installed AI agents and the tools video rendering needs.

use crate::types::*;
use std::path::{Path, PathBuf};

pub trait Exec {
    fn run(&self, program: &str, args: &[&str]) -> Option<String>;
    fn which(&self, program: &str) -> Option<PathBuf>;
}

use std::io::Read;
use std::time::{Duration, Instant};

const EXEC_TIMEOUT: Duration = Duration::from_secs(5);

/// `v22.11.0` -> (22, 11, 0). Anything that isn't a version sorts first.
fn semver_key(name: &str) -> (u64, u64, u64) {
    let mut it = name.trim_start_matches('v').split('.').map(|p| p.parse::<u64>().unwrap_or(0));
    (it.next().unwrap_or(0), it.next().unwrap_or(0), it.next().unwrap_or(0))
}

/// Highest-version `~/.nvm/versions/node/*/bin` that exists.
fn newest_nvm_bin(home: &Path) -> Option<PathBuf> {
    std::fs::read_dir(home.join(".nvm").join("versions").join("node"))
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().join("bin").is_dir())
        .max_by_key(|e| semver_key(&e.file_name().to_string_lossy()))
        .map(|e| e.path().join("bin"))
}

/// Where Node, npx, agents and the render tools usually live, beyond PATH. Both the PATH
/// we give spawned processes and `RealExec::which` are built from this one list, so a
/// GUI launch (minimal PATH) finds what nvm, volta, fnm or Homebrew installed.
pub fn tool_dirs(home: Option<&Path>, appdata: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if cfg!(unix) {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
        if let Some(h) = home {
            dirs.push(h.join(".local").join("bin"));
            dirs.push(h.join(".volta").join("bin"));
            for fnm in [
                h.join(".fnm"),
                h.join(".local").join("share").join("fnm"),
                h.join("Library").join("Application Support").join("fnm"),
            ] {
                let bin = fnm.join("aliases").join("default").join("bin");
                if bin.is_dir() {
                    dirs.push(bin);
                }
            }
            dirs.extend(newest_nvm_bin(h));
            dirs.push(h.join(".claude").join("local"));
            dirs.push(h.join(".opencode").join("bin"));
        }
        // System dirs last, so user-space installs (a newer node in nvm, ffmpeg in ~/.local/bin) win.
        dirs.push(PathBuf::from("/usr/bin"));
        dirs.push(PathBuf::from("/bin"));
    }
    if cfg!(windows) {
        dirs.extend(appdata.map(|a| a.join("npm")));
        // winget puts portable tools (ffmpeg, yt-dlp) behind links here.
        if let Some(h) = home {
            dirs.push(h.join("AppData").join("Local").join("Microsoft").join("WinGet").join("Links"));
        }
        // A winget install updates the stored PATH, not the one this app started with.
        dirs.extend(registry_path());
    }
    dirs
}

/// Replaces `%NAME%` with `lookup(NAME)`; unknown names and lone `%` stay as they are.
pub fn expand_env_vars(s: &str, lookup: impl Fn(&str) -> Option<String>) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) if end > 0 => {
                let name = &after[..end];
                match lookup(name) {
                    Some(v) => out.push_str(&v),
                    None => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            _ => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// The machine and user PATH as stored in the registry, expanded.
#[cfg(windows)]
fn registry_path() -> Vec<PathBuf> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;
    let machine = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment")
        .and_then(|k| k.get_value::<String, _>("Path"))
        .ok();
    let user = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Environment")
        .and_then(|k| k.get_value::<String, _>("Path"))
        .ok();
    [machine, user]
        .into_iter()
        .flatten()
        .flat_map(|p| {
            let expanded = expand_env_vars(&p, |n| std::env::var(n).ok());
            std::env::split_paths(&expanded).collect::<Vec<_>>()
        })
        .collect()
}

#[cfg(not(windows))]
fn registry_path() -> Vec<PathBuf> {
    Vec::new()
}

fn dedupe(dirs: &mut Vec<PathBuf>) {
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|d| !d.as_os_str().is_empty() && seen.insert(d.clone()));
}

/// Pure core of `augmented_path`: node's directory first, then the usual install spots,
/// then the existing PATH. Duplicates and empty entries are dropped, order is kept.
pub fn build_path(
    home: Option<&Path>,
    existing: Option<&std::ffi::OsStr>,
    node_dir: Option<&Path>,
    appdata: Option<&Path>,
) -> std::ffi::OsString {
    let mut dirs: Vec<PathBuf> = Vec::new();
    dirs.extend(node_dir.map(Path::to_path_buf));
    dirs.extend(tool_dirs(home, appdata));
    if let Some(p) = existing {
        dirs.extend(std::env::split_paths(p));
    }
    dedupe(&mut dirs);
    std::env::join_paths(dirs).unwrap_or_else(|_| existing.map(Into::into).unwrap_or_default())
}

/// Pure core of `RealExec::which`'s search list: the existing PATH first, then `tool_dirs`.
pub fn search_dirs(
    home: Option<&Path>,
    existing: Option<&std::ffi::OsStr>,
    appdata: Option<&Path>,
) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = existing.map(|p| std::env::split_paths(p).collect()).unwrap_or_default();
    dirs.extend(tool_dirs(home, appdata));
    dedupe(&mut dirs);
    dirs
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from)
}

/// PATH for processes we spawn. A GUI launch has a minimal PATH, so scripts with
/// `#!/usr/bin/env node` (npx, gemini, hyperframes) would otherwise fail.
pub fn augmented_path() -> std::ffi::OsString {
    let node_dir = RealExec.which("node").and_then(|p| p.parent().map(Path::to_path_buf));
    let home = home_dir();
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from);
    build_path(
        home.as_deref(),
        std::env::var_os("PATH").as_deref(),
        node_dir.as_deref(),
        appdata.as_deref(),
    )
}

/// Runs real processes with a 5 s timeout.
pub struct RealExec;

impl RealExec {
    fn search_dirs() -> Vec<PathBuf> {
        let appdata = std::env::var_os("APPDATA").map(PathBuf::from);
        search_dirs(home_dir().as_deref(), std::env::var_os("PATH").as_deref(), appdata.as_deref())
    }
}

impl Exec for RealExec {
    fn run(&self, program: &str, args: &[&str]) -> Option<String> {
        let resolved = self.which(program).unwrap_or_else(|| PathBuf::from(program));
        let mut cmd = std::process::Command::new(resolved);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd
            .args(args)
            .env("PATH", augmented_path())
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .ok()?;
        let mut out = child.stdout.take()?;
        let mut err = child.stderr.take()?;
        let t_out = std::thread::spawn(move || {
            let mut s = String::new();
            let _ = out.read_to_string(&mut s);
            s
        });
        let t_err = std::thread::spawn(move || {
            let mut s = String::new();
            let _ = err.read_to_string(&mut s);
            s
        });
        let start = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if start.elapsed() >= EXEC_TIMEOUT => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(20)),
                Err(_) => return None,
            }
        }
        let stdout = t_out.join().unwrap_or_default();
        let stderr = t_err.join().unwrap_or_default();
        Some(format!("{stdout}\n{stderr}").trim().to_string())
    }

    fn which(&self, program: &str) -> Option<PathBuf> {
        let pathext = std::env::var("PATHEXT").ok();
        let exts = candidate_exts(program, pathext.as_deref(), cfg!(windows));
        find_in(&Self::search_dirs(), program, &exts)
    }
}

/// Suffixes `which` tries, in order. On Windows the PATHEXT extensions come first: npm
/// ships an extension-less `npx` shell script next to `npx.cmd`, and CreateProcess can't
/// run the script (error 193). The bare name is tried last, or first when `program`
/// already ends with one of the extensions.
pub fn candidate_exts(program: &str, pathext: Option<&str>, windows: bool) -> Vec<String> {
    if !windows {
        return vec![String::new()];
    }
    let exts: Vec<String> = pathext
        .unwrap_or(".COM;.EXE;.BAT;.CMD")
        .split(';')
        .map(|e| e.trim().to_ascii_lowercase())
        .filter(|e| e.starts_with('.') && e.len() > 1)
        .collect();
    let lower = program.to_ascii_lowercase();
    if exts.iter().any(|e| lower.ends_with(e.as_str())) {
        std::iter::once(String::new()).chain(exts).collect()
    } else {
        exts.into_iter().chain(std::iter::once(String::new())).collect()
    }
}

/// First `<dir>/<program><ext>` that is a file, dirs in order, then exts in order.
pub fn find_in(dirs: &[PathBuf], program: &str, exts: &[String]) -> Option<PathBuf> {
    dirs.iter().find_map(|dir| {
        exts.iter().map(|ext| dir.join(format!("{program}{ext}"))).find(|c| c.is_file())
    })
}

/// First `\d+(\.\d+)+` match in `raw`.
pub fn parse_version(raw: &str) -> Option<String> {
    let b = raw.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if !b[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let start = i;
        let mut end = i;
        let mut groups = 1;
        loop {
            while end < b.len() && b[end].is_ascii_digit() {
                end += 1;
            }
            if end + 1 < b.len() && b[end] == b'.' && b[end + 1].is_ascii_digit() {
                groups += 1;
                end += 1;
            } else {
                break;
            }
        }
        if groups > 1 {
            return Some(raw[start..end].to_string());
        }
        i = end;
    }
    None
}

fn os_kind() -> OsKind {
    if cfg!(target_os = "macos") {
        OsKind::Macos
    } else if cfg!(target_os = "windows") {
        OsKind::Windows
    } else {
        OsKind::Linux
    }
}

fn os_version(exec: &dyn Exec, os: OsKind) -> String {
    match os {
        OsKind::Macos => exec
            .run("sw_vers", &["-productVersion"])
            .map(|s| s.trim().to_string())
            .unwrap_or_default(),
        OsKind::Windows => exec
            .run("cmd", &["/c", "ver"])
            .and_then(|s| parse_version(&s))
            .unwrap_or_default(),
        OsKind::Linux => std::fs::read_to_string("/etc/os-release")
            .ok()
            .and_then(|text| {
                let get = |key: &str| {
                    text.lines().find_map(|l| {
                        l.strip_prefix(key)
                            .and_then(|v| v.strip_prefix('='))
                            .map(|v| v.trim().trim_matches('"').to_string())
                    })
                };
                get("PRETTY_NAME").or_else(|| get("VERSION_ID"))
            })
            .unwrap_or_default(),
    }
}

pub fn system_info(exec: &dyn Exec) -> SystemInfo {
    let os = os_kind();
    let managers: &[(&str, PackageManager)] = match os {
        OsKind::Macos => &[("brew", PackageManager::Brew)],
        OsKind::Windows => &[("winget", PackageManager::Winget)],
        OsKind::Linux => &[
            ("apt", PackageManager::Apt),
            ("dnf", PackageManager::Dnf),
            ("pacman", PackageManager::Pacman),
        ],
    };
    let package_manager = managers
        .iter()
        .find(|(bin, _)| exec.which(bin).is_some())
        .map(|(_, pm)| *pm);
    SystemInfo { os, os_version: os_version(exec, os), package_manager }
}

type AgentDef = (AgentId, &'static str, &'static str, &'static [&'static str]);

const AGENT_DEFS: [AgentDef; 4] = [
    (
        AgentId::Claude,
        "Claude Code",
        "claude",
        &["npx", "-y", "@agentclientprotocol/claude-agent-acp"],
    ),
    (AgentId::Opencode, "OpenCode", "opencode", &["opencode", "acp"]),
    (AgentId::Gemini, "Gemini CLI", "gemini", &["gemini", "--experimental-acp"]),
    (AgentId::Codex, "Codex", "codex", &["npx", "-y", "@agentclientprotocol/codex-acp"]),
];

/// The command that starts this agent in ACP mode; `None` for `custom`.
pub fn acp_command(id: AgentId) -> Option<Vec<String>> {
    AGENT_DEFS
        .iter()
        .find(|d| d.0 == id)
        .map(|d| d.3.iter().map(|s| s.to_string()).collect())
}

pub fn detect_agents(exec: &dyn Exec) -> Vec<AgentInfo> {
    let defs = AGENT_DEFS;
    defs.iter()
        .map(|(id, name, bin, acp)| {
            let installed = exec.which(bin).is_some();
            let version = if installed {
                exec.run(bin, &["--version"]).and_then(|s| parse_version(&s))
            } else {
                None
            };
            AgentInfo {
                id: *id,
                name: name.to_string(),
                installed,
                version,
                acp_command: acp.iter().map(|s| s.to_string()).collect(),
                recommended: *id == AgentId::Claude,
            }
        })
        .collect()
}

/// True when `~/.claude.json` has an ElevenLabs server at user scope (top-level
/// `mcpServers`). Local-scope entries under `projects` only work in that one folder, so
/// they don't count.
pub fn elevenlabs_in_claude_config(json: &str) -> bool {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(json) else {
        return false;
    };
    v.get("mcpServers")
        .and_then(|s| s.as_object())
        .is_some_and(|m| m.keys().any(|k| k.to_ascii_lowercase().contains("elevenlabs")))
}

fn chrome_found(exec: &dyn Exec, os: OsKind) -> bool {
    match os {
        OsKind::Macos => Path::new("/Applications/Google Chrome.app").exists(),
        OsKind::Windows => {
            let rel = r"Google\Chrome\Application\chrome.exe";
            ["ProgramFiles", "ProgramFiles(x86)", "LocalAppData"]
                .iter()
                .filter_map(std::env::var_os)
                .any(|base| PathBuf::from(base).join(rel).exists())
        }
        OsKind::Linux => ["google-chrome", "chromium", "chromium-browser"]
            .iter()
            .any(|b| exec.which(b).is_some()),
    }
}

/// `claude_config` is the Claude Code config folder Tayang runs Claude with.
pub fn check_tools(exec: &dyn Exec, agent: AgentId, claude_config: &Path) -> Vec<ToolStatus> {
    let version_of = |bin: &str, arg: &str| -> Option<String> {
        exec.which(bin)?;
        exec.run(bin, &[arg]).and_then(|s| parse_version(&s))
    };

    let node_found = exec.which("node").is_some();
    let node_version = version_of("node", "--version");
    let node_major = node_version
        .as_deref()
        .and_then(|v| v.split('.').next())
        .and_then(|m| m.parse::<u32>().ok());
    let node = ToolStatus {
        id: ToolId::Node,
        name: "Node.js".into(),
        required: true,
        found: node_found,
        version: node_version,
        ok: node_major.is_some_and(|m| m >= 22),
        detail: "Runs the video engine · needs 22 or newer".into(),
    };

    let ffmpeg_found = exec.which("ffmpeg").is_some();
    let ffmpeg = ToolStatus {
        id: ToolId::Ffmpeg,
        name: "FFmpeg".into(),
        required: true,
        found: ffmpeg_found,
        version: version_of("ffmpeg", "-version"),
        ok: ffmpeg_found,
        detail: "Turns frames into the final video file".into(),
    };

    let chrome_ok = chrome_found(exec, os_kind());
    let chrome = ToolStatus {
        id: ToolId::Chrome,
        name: "Google Chrome".into(),
        required: true,
        found: chrome_ok,
        version: None,
        ok: chrome_ok,
        detail: "Draws each frame of your video".into(),
    };

    let ytdlp_found = exec.which("yt-dlp").is_some();
    let ytdlp = ToolStatus {
        id: ToolId::Ytdlp,
        name: "yt-dlp".into(),
        required: false,
        found: ytdlp_found,
        version: version_of("yt-dlp", "--version"),
        ok: ytdlp_found,
        detail: "Lets you copy the style of a video from a link".into(),
    };

    let (el_found, el_detail) = if agent == AgentId::Claude {
        let found = std::fs::read_to_string(claude_config.join(".claude.json"))
            .map(|s| elevenlabs_in_claude_config(&s))
            .unwrap_or(false);
        (found, "Adds a natural voice to your videos")
    } else {
        (false, "Check your agent's MCP settings")
    };
    let elevenlabs = ToolStatus {
        id: ToolId::ElevenlabsMcp,
        name: "ElevenLabs voice".into(),
        required: false,
        found: el_found,
        version: None,
        ok: el_found,
        detail: el_detail.into(),
    };

    vec![node, ffmpeg, chrome, ytdlp, elevenlabs]
}

#[cfg(test)]
mod path_tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn build_path_orders_and_dedupes() {
        let home = tempfile::tempdir().unwrap();
        let h = home.path();
        std::fs::create_dir_all(h.join(".nvm/versions/node/v20.1.0/bin")).unwrap();
        let existing = std::env::join_paths(["/usr/bin", "/usr/local/bin", "/bin", "/usr/bin", "/x"]).unwrap();
        let out = build_path(Some(h), Some(&existing), Some(Path::new("/n/bin")), None);
        let got: Vec<PathBuf> = std::env::split_paths(&out).collect();
        let want: Vec<PathBuf> = [
            "/n/bin".into(),
            "/opt/homebrew/bin".into(),
            "/usr/local/bin".into(),
            h.join(".local/bin"),
            h.join(".volta/bin"),
            h.join(".nvm/versions/node/v20.1.0/bin"),
            h.join(".claude/local"),
            h.join(".opencode/bin"),
            "/usr/bin".into(),
            "/bin".into(),
            "/x".into(),
        ]
        .into_iter()
        .collect();
        assert_eq!(got, want);
    }

    /// A fake home with nvm, fnm and volta installs: `which` must see them all, and pick
    /// nvm's highest version even when an older one was touched last.
    #[cfg(unix)]
    #[test]
    fn search_dirs_cover_node_managers() {
        let home = tempfile::tempdir().unwrap();
        let h = home.path();
        for v in ["v9.0.0", "v22.11.0", "v18.20.4"] {
            std::fs::create_dir_all(h.join(".nvm/versions/node").join(v).join("bin")).unwrap();
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(h.join(".nvm/versions/node/v9.0.0/bin/touch"), "").unwrap();
        std::fs::create_dir_all(h.join(".fnm/aliases/default/bin")).unwrap();
        std::fs::create_dir_all(h.join(".volta/bin")).unwrap();
        // A name no real machine has: the system folders in the list (a CI runner's /usr/local/bin has npx)
        // must not answer for it.
        std::fs::write(h.join(".volta/bin/tayang-test-tool"), "").unwrap();

        let existing = std::env::join_paths(["/usr/bin"]).unwrap();
        let dirs = search_dirs(Some(h), Some(&existing), None);
        assert_eq!(dirs[0], PathBuf::from("/usr/bin"));
        assert!(dirs.contains(&h.join(".nvm/versions/node/v22.11.0/bin")));
        assert!(!dirs.contains(&h.join(".nvm/versions/node/v9.0.0/bin")));
        assert!(dirs.contains(&h.join(".fnm/aliases/default/bin")));
        assert!(dirs.contains(&h.join(".volta/bin")));
        // Same list as the PATH given to spawned processes.
        let path: Vec<PathBuf> = std::env::split_paths(&build_path(Some(h), Some(&existing), None, None)).collect();
        for d in &dirs {
            assert!(path.contains(d), "{d:?} missing from PATH");
        }
        assert_eq!(find_in(&dirs, "tayang-test-tool", &[String::new()]), Some(h.join(".volta/bin/tayang-test-tool")));
    }

    #[test]
    fn windows_tries_pathext_before_the_bare_name() {
        let exts = candidate_exts("npx", Some(".EXE;.CMD;.BAT"), true);
        assert_eq!(exts, [".exe", ".cmd", ".bat", ""]);
        assert_eq!(candidate_exts("npx.cmd", Some(".EXE;.CMD"), true), ["", ".exe", ".cmd"]);
        assert_eq!(candidate_exts("npx", None, true).last().map(String::as_str), Some(""));
        assert_eq!(candidate_exts("npx", Some(".EXE"), false), [""]);

        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("npx"), "#!/bin/sh").unwrap();
        std::fs::write(tmp.path().join("npx.cmd"), "@echo off").unwrap();
        let dirs = [tmp.path().to_path_buf()];
        assert_eq!(find_in(&dirs, "npx", &exts), Some(tmp.path().join("npx.cmd")));
        assert_eq!(find_in(&dirs, "npx", &candidate_exts("npx", None, false)), Some(tmp.path().join("npx")));
    }

    #[cfg(windows)]
    #[test]
    fn real_which_prefers_npx_cmd() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("npx"), "#!/bin/sh").unwrap();
        std::fs::write(tmp.path().join("npx.cmd"), "@echo off").unwrap();
        let pathext = std::env::var("PATHEXT").ok();
        let exts = candidate_exts("npx", pathext.as_deref(), true);
        let found = find_in(&[tmp.path().to_path_buf()], "npx", &exts).unwrap();
        assert!(found.to_string_lossy().to_ascii_lowercase().ends_with("npx.cmd"));
    }

    #[test]
    fn registry_paths_expand_env_vars() {
        let lookup = |n: &str| match n {
            "USERPROFILE" => Some(r"C:\Users\a".to_string()),
            "SystemRoot" => Some(r"C:\Windows".to_string()),
            _ => None,
        };
        assert_eq!(
            expand_env_vars(r"%SystemRoot%\system32;%USERPROFILE%\AppData\Local\Microsoft\WinGet\Links", lookup),
            r"C:\Windows\system32;C:\Users\a\AppData\Local\Microsoft\WinGet\Links"
        );
        assert_eq!(expand_env_vars("%NOPE%\\x", lookup), "%NOPE%\\x");
        assert_eq!(expand_env_vars("100% sure", lookup), "100% sure");
        assert_eq!(expand_env_vars("a%%b", lookup), "a%%b");
    }

    #[test]
    fn semver_orders_numerically() {
        assert!(semver_key("v22.1.0") > semver_key("v9.12.0"));
        assert!(semver_key("v22.11.0") > semver_key("v22.2.9"));
        assert_eq!(semver_key("junk"), (0, 0, 0));
    }

    #[test]
    fn build_path_without_inputs_keeps_existing() {
        let existing = std::env::join_paths(["/a", "/b"]).unwrap();
        let out = build_path(None, Some(&existing), None, None);
        let got: Vec<PathBuf> = std::env::split_paths(&out).collect();
        assert!(got.ends_with(&[PathBuf::from("/a"), PathBuf::from("/b")]));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[derive(Default)]
    struct FakeExec {
        out: HashMap<String, String>,
    }
    impl FakeExec {
        fn with(mut self, prog: &str, out: &str) -> Self {
            self.out.insert(prog.to_string(), out.to_string());
            self
        }
    }
    impl Exec for FakeExec {
        fn run(&self, program: &str, _args: &[&str]) -> Option<String> {
            self.out.get(program).cloned()
        }
        fn which(&self, program: &str) -> Option<PathBuf> {
            self.out.get(program).map(|_| PathBuf::from(format!("/bin/{program}")))
        }
    }

    #[test]
    fn parse_version_cases() {
        assert_eq!(parse_version("v22.12.0").as_deref(), Some("22.12.0"));
        assert_eq!(parse_version("ffmpeg version n7.1-tessus").as_deref(), Some("7.1"));
        assert_eq!(
            parse_version("ffmpeg version 7.1.1-full_build-www.gyan.dev").as_deref(),
            Some("7.1.1")
        );
        assert_eq!(parse_version("2026.10.22").as_deref(), Some("2026.10.22"));
        assert_eq!(parse_version("nope"), None);
        assert_eq!(parse_version("build 7 then 1.2"), Some("1.2".to_string()));
    }

    fn tool(list: &[ToolStatus], id: ToolId) -> &ToolStatus {
        list.iter().find(|t| t.id == id).unwrap()
    }

    #[test]
    fn old_node_is_not_ok() {
        let ex = FakeExec::default().with("node", "v20.11.0");
        let t = check_tools(&ex, AgentId::Claude, Path::new("/nonexistent"));
        let n = tool(&t, ToolId::Node);
        assert!(n.found && !n.ok && n.required);
        assert_eq!(n.version.as_deref(), Some("20.11.0"));
        assert_eq!(n.detail, "Runs the video engine · needs 22 or newer");
    }

    #[test]
    fn new_node_is_ok() {
        let ex = FakeExec::default().with("node", "v22.1.0");
        let t = check_tools(&ex, AgentId::Claude, Path::new("/nonexistent"));
        assert!(tool(&t, ToolId::Node).ok);
    }

    #[test]
    fn missing_ffmpeg_is_not_found() {
        let ex = FakeExec::default();
        let t = check_tools(&ex, AgentId::Claude, Path::new("/nonexistent"));
        assert_eq!(t.len(), 5);
        let f = tool(&t, ToolId::Ffmpeg);
        assert!(!f.found && !f.ok && f.required && f.version.is_none());
        assert!(!tool(&t, ToolId::Ytdlp).required);
    }

    #[test]
    fn elevenlabs_config_detection() {
        assert!(elevenlabs_in_claude_config(r#"{"mcpServers":{"elevenlabs":{}}}"#));
        assert!(elevenlabs_in_claude_config(r#"{"mcpServers":{"my-ElevenLabs-tts":{}}}"#));
        // Local scope (one folder only) doesn't count.
        assert!(!elevenlabs_in_claude_config(
            r#"{"projects":{"/a":{"mcpServers":{"elevenlabs":{}}}}}"#
        ));
        assert!(!elevenlabs_in_claude_config("{}"));
        assert!(!elevenlabs_in_claude_config(r#"{"mcpServers":{"other":{}}}"#));
        assert!(!elevenlabs_in_claude_config("not json"));
    }

    #[test]
    fn non_claude_agent_elevenlabs_hint() {
        let ex = FakeExec::default();
        let t = check_tools(&ex, AgentId::Gemini, Path::new("/nonexistent"));
        let e = tool(&t, ToolId::ElevenlabsMcp);
        assert!(!e.found);
        assert_eq!(e.detail, "Check your agent's MCP settings");
    }

    #[test]
    fn detect_agents_only_claude() {
        let ex = FakeExec::default().with("claude", "2.1.3 (Claude Code)");
        let a = detect_agents(&ex);
        let ids: Vec<_> = a.iter().map(|x| x.id).collect();
        assert_eq!(ids, [AgentId::Claude, AgentId::Opencode, AgentId::Gemini, AgentId::Codex]);
        assert!(a[0].installed && a[0].recommended);
        assert_eq!(a[0].version.as_deref(), Some("2.1.3"));
        assert_eq!(a[0].acp_command, ["npx", "-y", "@agentclientprotocol/claude-agent-acp"]);
        assert!(a[1..].iter().all(|x| !x.installed && x.version.is_none() && !x.recommended));
        assert_eq!(a[2].acp_command, ["gemini", "--experimental-acp"]);
    }

    #[test]
    fn package_manager_first_found() {
        let ex = FakeExec::default().with("brew", "x").with("dnf", "x").with("apt", "x");
        let s = system_info(&ex);
        if cfg!(target_os = "linux") {
            assert_eq!(s.package_manager, Some(PackageManager::Apt));
        } else if cfg!(target_os = "macos") {
            assert_eq!(s.package_manager, Some(PackageManager::Brew));
        }
    }
}

/// Detection against the real server/desktop environment, for callers that don't already hold an Exec.
pub fn detect_agents_standalone() -> Vec<AgentInfo> {
    detect_agents(&RealExec)
}
