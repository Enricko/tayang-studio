//! Tauri commands: the thin layer between the UI and the Rust modules.

use crate::db::Db;
use crate::media::MediaTools;
use crate::system::{self, RealExec};
use crate::types::*;
use crate::media;
use crate::acp::{AcpManager, AcpSink, PromptPart};
use crate::projects;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

pub type CmdResult<T> = Result<T, String>;

/// Shared Tauri state.
pub struct AppState {
    pub db: Db,
    pub acp: AcpManager,
    pub media: MediaTools,
    pub home: PathBuf,
}

impl AppState {
    pub fn working(&self) -> PathBuf {
        PathBuf::from(self.db.get_settings(&self.home).working_folder)
    }
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ---- system and settings ----

#[tauri::command]
pub async fn get_system_info() -> CmdResult<SystemInfo> {
    tauri::async_runtime::spawn_blocking(|| system::system_info(&RealExec))
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn detect_agents() -> CmdResult<Vec<AgentInfo>> {
    tauri::async_runtime::spawn_blocking(|| system::detect_agents(&RealExec))
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn check_tools(state: State<'_, AppState>, agent: AgentId) -> CmdResult<Vec<ToolStatus>> {
    let home = state.home.clone();
    tauri::async_runtime::spawn_blocking(move || system::check_tools(&RealExec, agent, &home))
        .await
        .map_err(err)
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.db.get_settings(&state.home)
}

#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    patch: serde_json::Value,
) -> CmdResult<Settings> {
    let settings = state.db.update_settings(patch).map_err(err)?;
    allow_asset_folders(&app, &state.db, &settings.working_folder);
    Ok(settings)
}

/// Folders the webview may load files (frames, thumbnails, renders) from: the working
/// folder plus every known project's own folder, which stays put when the working
/// folder changes. Nothing else is in the asset scope.
pub fn asset_folders(db: &Db, working: &str) -> Vec<PathBuf> {
    let mut out = vec![PathBuf::from(working)];
    for p in db.list_projects().unwrap_or_default() {
        let folder = PathBuf::from(&p.folder);
        if folder.is_dir() && !out.contains(&folder) {
            out.push(folder);
        }
    }
    out
}

pub fn allow_asset_folders(app: &AppHandle, db: &Db, working: &str) {
    for folder in asset_folders(db, working) {
        let _ = app.asset_protocol_scope().allow_directory(&folder, true);
    }
}

#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> CmdResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folder()
            .and_then(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(err)
}

// ---- projects ----

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> CmdResult<Vec<Project>> {
    state.db.list_projects().map_err(err)
}

#[tauri::command]
pub fn create_project(
    state: State<'_, AppState>,
    input: NewProject,
    brief: String,
) -> CmdResult<Project> {
    let working = state.working();
    let slugs: Vec<String> = state
        .db
        .list_projects()
        .map_err(err)?
        .into_iter()
        .map(|p| p.slug)
        .collect();
    let (slug, dir) = projects::create_project_folder(&working, &input.title, &slugs)
        .map_err(|e| format!("Can't create the project folder: {e}"))?;
    projects::write_project_brief(&dir, &brief)
        .map_err(|e| format!("Can't write the project brief: {e}"))?;
    let now = crate::db::now();
    let project = Project {
        id: uuid::Uuid::new_v4().to_string(),
        title: input.title,
        slug,
        folder: dir.to_string_lossy().into_owned(),
        kind: input.kind,
        format: input.format,
        language: input.language,
        status: ProjectStatus::Draft,
        style_id: input.style_id,
        scheduled_at: None,
        duration_sec: None,
        created_at: now.clone(),
        updated_at: now,
    };
    state.db.insert_project(&project).map_err(err)?;
    Ok(project)
}

#[tauri::command]
pub fn update_project(
    state: State<'_, AppState>,
    id: String,
    patch: serde_json::Value,
) -> CmdResult<Project> {
    state.db.update_project(&id, patch).map_err(err)
}

// ---- chats ----

#[tauri::command]
pub fn list_chats(state: State<'_, AppState>, project_id: Option<String>) -> CmdResult<Vec<Chat>> {
    state.db.list_chats(project_id.as_deref()).map_err(err)
}

/// One chat by id, whether or not it belongs to a project.
pub fn lookup_chat(db: &Db, chat_id: &str) -> CmdResult<Option<Chat>> {
    db.get_chat(chat_id).map_err(err)
}

#[tauri::command]
pub fn get_chat(state: State<'_, AppState>, chat_id: String) -> CmdResult<Option<Chat>> {
    lookup_chat(&state.db, &chat_id)
}

#[tauri::command]
pub fn create_chat(
    state: State<'_, AppState>,
    project_id: Option<String>,
    agent_id: AgentId,
    title: String,
) -> CmdResult<Chat> {
    state
        .db
        .create_chat(project_id.as_deref(), agent_id, &title)
        .map_err(err)
}

#[tauri::command]
pub fn list_messages(state: State<'_, AppState>, chat_id: String) -> CmdResult<Vec<ChatMessage>> {
    state.db.list_messages(&chat_id).map_err(err)
}

#[tauri::command]
pub fn add_message(
    state: State<'_, AppState>,
    chat_id: String,
    role: MessageRole,
    parts: Vec<MessagePart>,
) -> CmdResult<ChatMessage> {
    state.db.add_message(&chat_id, role, &parts).map_err(err)
}

// ---- styles ----

#[tauri::command]
pub fn list_styles(state: State<'_, AppState>) -> CmdResult<Vec<Style>> {
    state.db.list_styles().map_err(err)
}

#[tauri::command]
pub fn save_style(state: State<'_, AppState>, style: Style) -> CmdResult<()> {
    state.db.save_style(&style).map_err(err)
}

#[tauri::command]
pub fn delete_style(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.db.delete_style(&id).map_err(err)
}

/// `<working>/.tayang/style-study/<id>`, rejected if it would leave the working folder.
fn study_path(working: &Path, study_id: &str) -> CmdResult<PathBuf> {
    let bad = study_id.is_empty()
        || study_id == "."
        || study_id == ".."
        || study_id.contains(['/', '\\']);
    let dir = working.join(".tayang").join("style-study").join(study_id);
    let _ = std::fs::create_dir_all(working);
    if bad || !projects::ensure_inside(working, &dir) {
        return Err("That style study id isn't valid".into());
    }
    Ok(dir)
}

#[tauri::command]
pub fn read_style_result(state: State<'_, AppState>, study_id: String) -> CmdResult<Option<String>> {
    let path = study_path(&state.working(), &study_id)?.join("style.json");
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Can't read the style result: {e}")),
    }
}

#[tauri::command]
pub fn study_dir(state: State<'_, AppState>, study_id: String) -> CmdResult<String> {
    let dir = study_path(&state.working(), &study_id)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Can't create the study folder: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

// ---- jobs ----

#[tauri::command]
pub fn list_jobs(state: State<'_, AppState>) -> CmdResult<Vec<Job>> {
    state.db.list_jobs().map_err(err)
}

#[tauri::command]
pub fn upsert_job(state: State<'_, AppState>, job: Job) -> CmdResult<()> {
    state.db.upsert_job(&job).map_err(err)
}

// ---- agent ----

struct TauriSink(AppHandle);

impl AcpSink for TauriSink {
    fn update(&self, chat_id: &str, u: AgentUpdate) {
        let _ = self.0.emit("agent://update", serde_json::json!({ "chatId": chat_id, "update": u }));
    }

    fn permission(&self, req: PermissionRequest) {
        let _ = self.0.emit("agent://permission", req);
    }
}

/// A chat id that is safe to use as a single folder name.
fn safe_segment(s: &str) -> bool {
    !s.is_empty() && s != "." && s != ".." && !s.contains(['/', '\\'])
}

/// Where this chat's agent runs. `project_folder` is the recorded folder of the chat's
/// (known) project, when it has one: that folder is used as is, even if the working
/// folder has changed since, as long as it still exists. Every other chat runs inside
/// `working`.
pub fn resolve_cwd(
    working: &Path,
    chat_id: &str,
    project_folder: Option<&Path>,
) -> CmdResult<PathBuf> {
    if let Some(folder) = project_folder {
        if !folder.is_dir() {
            return Err(format!("This project's folder is missing: {}", folder.display()));
        }
        return Ok(folder.to_path_buf());
    }
    let cwd = if chat_id == "setup" {
        working.join(".tayang").join("setup")
    } else if let Some(rest) = chat_id.strip_prefix("study-") {
        if !safe_segment(rest) {
            return Err("That chat isn't valid".into());
        }
        working.join(".tayang").join("style-study").join(rest)
    } else {
        if !safe_segment(chat_id) {
            return Err("That chat isn't valid".into());
        }
        working.join(".tayang").join("chats").join(chat_id)
    };
    std::fs::create_dir_all(working).map_err(|e| format!("Can't create the working folder: {e}"))?;
    if !projects::ensure_inside(working, &cwd) {
        return Err("The agent can only work inside your working folder".into());
    }
    std::fs::create_dir_all(&cwd).map_err(|e| format!("Can't create {}: {e}", cwd.display()))?;
    Ok(cwd)
}

fn project_folder_for_chat(state: &AppState, chat_id: &str) -> CmdResult<Option<PathBuf>> {
    let chat = state.db.get_chat(chat_id).map_err(err)?;
    let Some(project_id) = chat.and_then(|c| c.project_id) else {
        return Ok(None);
    };
    let project = state
        .db
        .get_project(&project_id)
        .map_err(err)?
        .ok_or("This chat's project no longer exists")?;
    Ok(Some(PathBuf::from(project.folder)))
}

#[tauri::command]
pub async fn agent_start(
    app: AppHandle,
    state: State<'_, AppState>,
    chat_id: String,
    agent_id: AgentId,
) -> CmdResult<()> {
    let mut command = system::acp_command(agent_id)
        .ok_or("Pick an agent first: custom agents have no start command yet")?;
    let program = command[0].clone();
    let found = system::Exec::which(&RealExec, &program)
        .ok_or_else(|| format!("Can't find {program} on this computer"))?;
    command[0] = found.to_string_lossy().into_owned();
    let folder = project_folder_for_chat(&state, &chat_id)?;
    let cwd = resolve_cwd(&state.working(), &chat_id, folder.as_deref())?;
    state
        .acp
        .start(&chat_id, &command, &cwd, Arc::new(TauriSink(app)))
        .await
        .map_err(err)
}

/// m:ss.cc, same as `formatTimecode` in `@tayang/shared`.
pub fn format_timecode(sec: f64, fps: u32) -> String {
    let fps = fps.max(1);
    let total = sec.max(0.0);
    let whole = total.floor();
    let frame = (((total - whole) * fps as f64).round() as u32).min(fps - 1);
    let cc = (frame as f64 / fps as f64 * 100.0).floor() as u32;
    let whole = whole as u64;
    format!("{}:{:02}.{:02}", whole / 60, whole % 60, cc)
}

/// How much of a mentioned project's AGENTS.md goes into the prompt.
const BRIEF_LIMIT: usize = 8 * 1024;

/// `<folder>/AGENTS.md`, cut to `BRIEF_LIMIT` bytes on a character boundary.
pub fn read_brief(folder: &Path) -> Option<String> {
    let text = std::fs::read_to_string(folder.join("AGENTS.md")).ok()?;
    Some(truncate_brief(&text))
}

fn truncate_brief(text: &str) -> String {
    if text.len() <= BRIEF_LIMIT {
        return text.to_string();
    }
    let mut end = BRIEF_LIMIT;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n[AGENTS.md cut at 8 KB]", &text[..end])
}

/// Turns chat parts into what the agent sees. Tool parts are skipped. A mentioned
/// project's AGENTS.md (from `brief`) is inlined, since a new chat's agent runs
/// outside that project's folder.
pub fn build_prompt(
    parts: &[MessagePart],
    fps: u32,
    project: impl Fn(&str) -> Option<Project>,
    brief: impl Fn(&Path) -> Option<String>,
) -> Vec<PromptPart> {
    let mut out = Vec::new();
    for part in parts {
        match part {
            MessagePart::Text { text } => out.push(PromptPart::Text(text.clone())),
            MessagePart::Mention { project_id, title } => {
                out.push(PromptPart::Text(match project(project_id) {
                    Some(p) => {
                        let head = format!(
                            "Context: video project \"{}\". Its files are in {}.",
                            p.title, p.folder
                        );
                        match brief(Path::new(&p.folder)) {
                            Some(b) if !b.trim().is_empty() => {
                                format!("{head}\nIts AGENTS.md:\n\n{}", b.trim_end())
                            }
                            _ => head,
                        }
                    }
                    None => format!(
                        "Context: video project \"{title}\" (no longer on this computer)."
                    ),
                }));
            }
            MessagePart::Frame { project_id, frame, time_sec, image_path, marks } => {
                let title = project(project_id).map(|p| p.title).unwrap_or_default();
                let marks = if marks.is_empty() {
                    "none".to_string()
                } else {
                    marks
                        .iter()
                        .map(|m| format!("({:.2}, {:.2})", m.x, m.y))
                        .collect::<Vec<_>>()
                        .join(", ")
                };
                out.push(PromptPart::Image { path: PathBuf::from(image_path) });
                out.push(PromptPart::Text(format!(
                    "Frame {frame} at {} of {title}. Marks (x,y relative): {marks}",
                    format_timecode(*time_sec, fps)
                )));
            }
            MessagePart::Tool { .. } => {}
        }
    }
    out
}

/// Frame images must live inside the working folder or inside the recorded folder of
/// the frame's own (known, existing) project.
pub fn check_frame_images(
    working: &Path,
    parts: &[MessagePart],
    project_folder: impl Fn(&str) -> Option<PathBuf>,
) -> CmdResult<()> {
    for part in parts {
        if let MessagePart::Frame { image_path, project_id, .. } = part {
            let image = Path::new(image_path);
            let in_project = project_folder(project_id)
                .filter(|f| f.is_dir())
                .is_some_and(|f| projects::ensure_inside(&f, image));
            if !in_project && !projects::ensure_inside(working, image) {
                return Err("That frame image is outside your working folder".into());
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn agent_prompt(
    state: State<'_, AppState>,
    chat_id: String,
    parts: Vec<MessagePart>,
) -> CmdResult<()> {
    let settings = state.db.get_settings(&state.home);
    let fps = settings.fps;
    let working = PathBuf::from(&settings.working_folder);
    check_frame_images(&working, &parts, |id| {
        state.db.get_project(id).ok().flatten().map(|p| PathBuf::from(p.folder))
    })?;
    let prompt = build_prompt(&parts, fps, |id| state.db.get_project(id).ok().flatten(), read_brief);
    state.acp.prompt(&chat_id, prompt).await.map_err(err)
}

#[tauri::command]
pub async fn agent_cancel(state: State<'_, AppState>, chat_id: String) -> CmdResult<()> {
    state.acp.cancel(&chat_id).await.map_err(err)
}

#[tauri::command]
pub fn agent_respond_permission(
    state: State<'_, AppState>,
    request_id: String,
    option_id: Option<String>,
) -> CmdResult<()> {
    state.acp.respond_permission(&request_id, option_id).map_err(err)
}

// ---- media ----

fn project_folder(state: &AppState, project_id: &str) -> CmdResult<PathBuf> {
    state
        .db
        .get_project(project_id)
        .map_err(err)?
        .map(|p| PathBuf::from(p.folder))
        .ok_or_else(|| "That project no longer exists".to_string())
}

fn path_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

#[tauri::command]
pub fn media_latest_render(
    state: State<'_, AppState>,
    project_id: String,
) -> CmdResult<Option<String>> {
    let folder = project_folder(&state, &project_id)?;
    Ok(media::latest_render(&folder).map(|p| path_string(&p)))
}

#[tauri::command]
pub async fn media_probe(
    state: State<'_, AppState>,
    project_id: String,
) -> CmdResult<Option<MediaInfo>> {
    let folder = project_folder(&state, &project_id)?;
    let tools = state.media.clone();
    tauri::async_runtime::spawn_blocking(move || match media::latest_render(&folder) {
        Some(video) => media::probe(&tools, &video).map(Some),
        None => Ok(None),
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn media_extract_frame(
    state: State<'_, AppState>,
    project_id: String,
    time_sec: f64,
) -> CmdResult<String> {
    let folder = project_folder(&state, &project_id)?;
    let tools = state.media.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let video = media::latest_render(&folder).ok_or("This project has no render yet")?;
        let out = folder.join(".tayang").join("frames");
        media::extract_frame(&tools, &video, time_sec, &out).map(|p| path_string(&p))
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn media_thumbnails(
    state: State<'_, AppState>,
    project_id: String,
    count: u32,
) -> CmdResult<Vec<String>> {
    let folder = project_folder(&state, &project_id)?;
    let tools = state.media.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let video = media::latest_render(&folder).ok_or("This project has no render yet")?;
        let out = folder.join(".tayang").join("thumbs");
        media::thumbnails(&tools, &video, count, &out)
            .map(|v| v.iter().map(|p| path_string(p)).collect())
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn media_render(state: State<'_, AppState>, project_id: String) -> CmdResult<String> {
    let folder = project_folder(&state, &project_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        media::render(&folder).map(|p| path_string(&p))
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timecode_matches_ts() {
        assert_eq!(format_timecode(0.0, 30), "0:00.00");
        assert_eq!(format_timecode(65.5, 30), "1:05.50");
        assert_eq!(format_timecode(1.999, 30), "0:01.96");
    }

    #[test]
    fn cwd_rules() {
        let tmp = tempfile::tempdir().unwrap();
        let w = tmp.path();
        let setup = resolve_cwd(w, "setup", None).unwrap();
        assert!(setup.ends_with(".tayang/setup") || setup.ends_with(r".tayang\setup"));
        assert!(setup.is_dir());
        let study = resolve_cwd(w, "study-abc", None).unwrap();
        assert_eq!(study, w.join(".tayang").join("style-study").join("abc"));
        let chat = resolve_cwd(w, "c1", None).unwrap();
        assert_eq!(chat, w.join(".tayang").join("chats").join("c1"));
        let proj = w.join("my-video");
        std::fs::create_dir(&proj).unwrap();
        assert_eq!(resolve_cwd(w, "c2", Some(&proj)).unwrap(), proj);
    }

    #[test]
    fn project_chats_keep_their_folder_after_the_working_folder_changes() {
        let tmp = tempfile::tempdir().unwrap();
        let old_project = tmp.path().join("old-work").join("promo");
        std::fs::create_dir_all(&old_project).unwrap();
        let new_working = tmp.path().join("new-work");
        assert_eq!(resolve_cwd(&new_working, "c", Some(&old_project)).unwrap(), old_project);
        // A project folder that is gone is an error, not silently recreated.
        let gone = tmp.path().join("gone");
        assert!(resolve_cwd(&new_working, "c", Some(&gone)).is_err());
        assert!(!gone.exists());
    }

    #[test]
    fn cwd_rejects_escapes() {
        let tmp = tempfile::tempdir().unwrap();
        let w = tmp.path().join("work");
        let outside = tmp.path().join("elsewhere");
        std::fs::create_dir(&outside).unwrap();
        assert!(resolve_cwd(&w, "../x", None).is_err());
        assert!(resolve_cwd(&w, "study-../x", None).is_err());
        assert!(resolve_cwd(&w, "ideas-../x", None).is_err());
        let _ = outside;
    }

    #[test]
    fn frame_images_must_be_inside_working() {
        let tmp = tempfile::tempdir().unwrap();
        let w = tmp.path().join("work");
        std::fs::create_dir_all(&w).unwrap();
        let frame = |p: PathBuf| MessagePart::Frame {
            project_id: "p".into(),
            frame: 1,
            time_sec: 0.0,
            image_path: p.to_string_lossy().into_owned(),
            marks: vec![],
        };
        let none = |_: &str| None;
        assert!(check_frame_images(&w, &[frame(w.join("a/f.png"))], none).is_ok());
        assert!(check_frame_images(&w, &[frame(tmp.path().join("secret.png"))], none).is_err());
        assert!(check_frame_images(&w, &[frame(w.join("../secret.png"))], none).is_err());

        // A project left in an old working folder: its own frames are fine, others aren't.
        let old = tmp.path().join("old").join("p");
        std::fs::create_dir_all(&old).unwrap();
        let known = |id: &str| (id == "p").then(|| old.clone());
        let in_old = frame(old.join(".tayang/frames/f.png"));
        assert!(check_frame_images(&w, &[in_old.clone()], known).is_ok());
        assert!(check_frame_images(&w, &[in_old], none).is_err());
        assert!(check_frame_images(&w, &[frame(old.join("../secret.png"))], known).is_err());
    }

    #[test]
    fn asset_folders_are_working_plus_existing_projects() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Db::open_in_memory().unwrap();
        let kept = tmp.path().join("old").join("kept");
        std::fs::create_dir_all(&kept).unwrap();
        let mk = |id: &str, folder: &Path| Project {
            id: id.into(),
            title: id.into(),
            slug: id.into(),
            folder: folder.to_string_lossy().into_owned(),
            kind: VideoKind::Promo,
            format: VideoFormat::Portrait,
            language: VideoLanguage::En,
            status: ProjectStatus::Draft,
            style_id: None,
            scheduled_at: None,
            duration_sec: None,
            created_at: String::new(),
            updated_at: String::new(),
        };
        db.insert_project(&mk("a", &kept)).unwrap();
        db.insert_project(&mk("b", &tmp.path().join("missing"))).unwrap();
        let working = tmp.path().join("work");
        assert_eq!(
            asset_folders(&db, &working.to_string_lossy()),
            vec![working.clone(), kept]
        );
    }

    #[test]
    fn lookup_chat_finds_project_chats() {
        let db = Db::open_in_memory().unwrap();
        let chat = db.create_chat(Some("p1"), AgentId::Gemini, "Intro").unwrap();
        let loose = db.create_chat(None, AgentId::Claude, "Loose").unwrap();
        // The unfiltered list only has chats without a project, so lookups must go by id.
        assert!(!db.list_chats(None).unwrap().contains(&chat));
        assert_eq!(lookup_chat(&db, &chat.id).unwrap(), Some(chat));
        assert_eq!(lookup_chat(&db, &loose.id).unwrap(), Some(loose));
        assert_eq!(lookup_chat(&db, "missing").unwrap(), None);
    }

    #[test]
    fn brief_is_read_and_cut_at_8_kb() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(read_brief(tmp.path()), None);
        std::fs::write(tmp.path().join("AGENTS.md"), "# Hi\n").unwrap();
        assert_eq!(read_brief(tmp.path()).as_deref(), Some("# Hi\n"));
        // 3-byte characters straddle the limit: the cut stays on a boundary.
        let long = "é€".repeat(3000);
        std::fs::write(tmp.path().join("AGENTS.md"), &long).unwrap();
        let cut = read_brief(tmp.path()).unwrap();
        let body = cut.strip_suffix("\n[AGENTS.md cut at 8 KB]").unwrap();
        assert!(body.len() <= BRIEF_LIMIT && body.len() > BRIEF_LIMIT - 4);
        assert!(long.starts_with(body));
    }

    #[test]
    fn missing_mention_has_no_empty_folder() {
        let parts = vec![MessagePart::Mention { project_id: "x".into(), title: "Gone".into() }];
        assert_eq!(
            build_prompt(&parts, 30, |_| None, |_| None),
            vec![PromptPart::Text(
                "Context: video project \"Gone\" (no longer on this computer).".into()
            )]
        );
    }

    #[test]
    fn prompt_conversion() {
        let project = Project {
            id: "p1".into(),
            title: "Launch".into(),
            slug: "launch".into(),
            folder: "/w/launch".into(),
            kind: VideoKind::Promo,
            format: VideoFormat::Portrait,
            language: VideoLanguage::En,
            status: ProjectStatus::Draft,
            style_id: None,
            scheduled_at: None,
            duration_sec: None,
            created_at: String::new(),
            updated_at: String::new(),
        };
        let parts = vec![
            MessagePart::Text { text: "hi".into() },
            MessagePart::Mention { project_id: "p1".into(), title: "old".into() },
            MessagePart::Frame {
                project_id: "p1".into(),
                frame: 45,
                time_sec: 1.5,
                image_path: "/w/f.png".into(),
                marks: vec![Mark { x: 0.5, y: 0.25 }],
            },
            MessagePart::Tool {
                tool_call_id: "t".into(),
                title: "x".into(),
                status: ToolCallStatus::Done,
            },
        ];
        let out = build_prompt(
            &parts,
            30,
            |id| (id == "p1").then(|| project.clone()),
            |f| (f == Path::new("/w/launch")).then(|| "# Launch\n- Kind: promo\n".to_string()),
        );
        assert_eq!(
            out,
            vec![
                PromptPart::Text("hi".into()),
                PromptPart::Text(
                    "Context: video project \"Launch\". Its files are in /w/launch.\nIts AGENTS.md:\n\n# Launch\n- Kind: promo"
                        .into()
                ),
                PromptPart::Image { path: PathBuf::from("/w/f.png") },
                PromptPart::Text(
                    "Frame 45 at 0:01.50 of Launch. Marks (x,y relative): (0.50, 0.25)".into()
                ),
            ]
        );
    }
}
