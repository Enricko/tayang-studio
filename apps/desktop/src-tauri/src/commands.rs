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
    /// The working folder each study started in, so changing the working folder mid-study can't strand its files.
    pub study_working: std::sync::Mutex<std::collections::HashMap<String, PathBuf>>,
}

impl AppState {
    /// The working folder `study_dir` created this study in, else the current one.
    pub fn working_for_study(&self, study_id: &str) -> PathBuf {
        let known = self.study_working.lock().unwrap_or_else(|e| e.into_inner()).get(study_id).cloned();
        known.unwrap_or_else(|| self.working())
    }

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

/// The operating system's preferred language, like `id-ID` or `en-US`. The webview's own
/// `navigator.language` follows the app bundle (English only), not the system, so the first-run
/// interface language is picked from this instead.
#[tauri::command]
pub fn system_locale() -> Option<String> {
    clean_locale(sys_locale::get_locale())
}

fn clean_locale(raw: Option<String>) -> Option<String> {
    raw.map(|l| l.trim().to_string()).filter(|l| !l.is_empty() && !is_posix_default(l))
}

/// `C`, `POSIX` and values like `C.UTF-8` mean "no language chosen", not a language.
fn is_posix_default(l: &str) -> bool {
    ["C", "POSIX"].iter().any(|p| {
        l.strip_prefix(p).is_some_and(|rest| rest.is_empty() || rest.starts_with(['.', '@', '_', '-']))
    })
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
    crate::scheduler::sync_tray(&app, &settings);
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
        review_state: ReviewState::None,
        posted_at: None,
        reminded_at: None,
        review_reminded_at: None,
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

/// Sets or clears when a video is due to be posted. `at` must be RFC 3339; a new time is
/// reminded afresh, so `remindedAt` is cleared with it.
pub fn schedule_project(db: &Db, project_id: &str, at: Option<String>) -> CmdResult<Project> {
    // Stored as UTC so every schedule compares as plain text.
    let at = at
        .map(|at| {
            chrono::DateTime::parse_from_rfc3339(&at)
                .map(|dt| dt.with_timezone(&chrono::Utc).to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
                .map_err(|_| format!("That date and time isn't valid: {at}"))
        })
        .transpose()?;
    db.update_project(project_id, serde_json::json!({ "scheduledAt": at, "remindedAt": null, "reviewRemindedAt": null }))
        .map_err(err)
}

pub fn mark_posted(db: &Db, project_id: &str, posted: bool) -> CmdResult<Project> {
    let at = posted.then(crate::db::now);
    db.update_project(project_id, serde_json::json!({ "postedAt": at })).map_err(err)
}

pub fn approve(db: &Db, project_id: &str) -> CmdResult<Project> {
    db.update_project(project_id, serde_json::json!({ "reviewState": "approved" })).map_err(err)
}

#[tauri::command]
pub fn set_schedule(state: State<'_, AppState>, project_id: String, at: Option<String>) -> CmdResult<Project> {
    schedule_project(&state.db, &project_id, at)
}

#[tauri::command]
pub fn set_posted(state: State<'_, AppState>, project_id: String, posted: bool) -> CmdResult<Project> {
    mark_posted(&state.db, &project_id, posted)
}

#[tauri::command]
pub fn approve_project(state: State<'_, AppState>, project_id: String) -> CmdResult<Project> {
    approve(&state.db, &project_id)
}

// ---- autopilots ----

#[tauri::command]
pub fn list_autopilots(state: State<'_, AppState>) -> CmdResult<Vec<Autopilot>> {
    state.db.list_autopilots().map_err(err)
}

#[tauri::command]
pub fn save_autopilot(state: State<'_, AppState>, input: AutopilotInput) -> CmdResult<Autopilot> {
    state.db.save_autopilot(&input).map_err(err)
}

#[tauri::command]
pub fn delete_autopilot(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.db.delete_autopilot(&id).map_err(err)
}

#[tauri::command]
pub fn set_autopilot_status(state: State<'_, AppState>, id: String, status: AutopilotStatus) -> CmdResult<Autopilot> {
    state.db.set_autopilot_status(&id, status).map_err(err)
}

#[tauri::command]
pub fn list_slots(state: State<'_, AppState>, from: String, to: String) -> CmdResult<Vec<AutopilotSlot>> {
    state.db.list_slots(&from, &to).map_err(err)
}

#[tauri::command]
pub fn upsert_slot(state: State<'_, AppState>, autopilot_id: String, due_at: String) -> CmdResult<AutopilotSlot> {
    state.db.upsert_slot(&autopilot_id, &due_at).map_err(err)
}

#[tauri::command]
pub fn update_slot(state: State<'_, AppState>, id: String, patch: serde_json::Value) -> CmdResult<AutopilotSlot> {
    state.db.update_slot(&id, patch).map_err(err)
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

/// Switches the chat to another agent. The agent id is validated by its enum on the way in.
#[tauri::command]
pub fn update_chat_agent(state: State<'_, AppState>, chat_id: String, agent_id: AgentId) -> CmdResult<Chat> {
    state
        .db
        .set_chat_agent(&chat_id, agent_id)
        .map_err(err)?
        .ok_or_else(|| format!("No chat {chat_id}"))
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
pub fn delete_style(app: AppHandle, state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.db.delete_style(&id).map_err(err)?;
    if let Ok(data) = app.path().app_data_dir() {
        media::remove_style_media(&data, &id);
    }
    Ok(())
}

/// Where copied styles keep their preview clip and poster; the webview may read it.
pub fn allow_style_media(app: &AppHandle) {
    if let Ok(data) = app.path().app_data_dir() {
        let dir = data.join("style-media");
        let _ = std::fs::create_dir_all(&dir);
        let _ = app.asset_protocol_scope().allow_directory(&dir, true);
    }
}

/// Makes the preview clip and poster of a finished study (from its downloaded source), then deletes the
/// source. `None` when there was no source or nothing could be made.
#[tauri::command]
pub async fn make_style_preview(
    app: AppHandle,
    state: State<'_, AppState>,
    study_id: String,
    style_id: String,
) -> CmdResult<Option<media::StylePreview>> {
    let study = study_path(&state.working_for_study(&study_id), &study_id)?;
    let data = app.path().app_data_dir().map_err(err)?;
    let out = media::style_media_dir(&data, &style_id).ok_or("That style id isn't valid")?;
    let tools = state.media.clone();
    tauri::async_runtime::spawn_blocking(move || media::make_style_preview(&tools, &study, &out))
        .await
        .map_err(err)?
}

/// `<working>/.tayang/style-study/<id>`, rejected if it would leave the working folder.
pub(crate) fn study_path(working: &Path, study_id: &str) -> CmdResult<PathBuf> {
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
    let path = study_path(&state.working_for_study(&study_id), &study_id)?.join("style.json");
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Can't read the style result: {e}")),
    }
}

/// Deletes a study's folder (its download, frames and result) once the study is over, however it ended.
#[tauri::command]
pub fn remove_study_dir(state: State<'_, AppState>, study_id: String) -> CmdResult<()> {
    let working = state.working_for_study(&study_id);
    let out = media::remove_study_dir(&working, &study_id);
    state.study_working.lock().unwrap_or_else(|e| e.into_inner()).remove(&study_id);
    out
}

#[tauri::command]
pub fn study_dir(state: State<'_, AppState>, study_id: String) -> CmdResult<String> {
    let working = state.working();
    let dir = study_path(&working, &study_id)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Can't create the study folder: {e}"))?;
    state.study_working.lock().unwrap_or_else(|e| e.into_inner()).insert(study_id, working);
    Ok(dir.to_string_lossy().into_owned())
}

// ---- jobs ----

#[tauri::command]
pub fn list_jobs(state: State<'_, AppState>) -> CmdResult<Vec<Job>> {
    state.db.list_jobs().map_err(err)
}

#[tauri::command]
pub fn delete_job(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.db.delete_job(&id).map_err(err)
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

/// Added to Claude's system prompt for sessions Tayang starts.
pub const TAYANG_APPEND: &str = "You are running inside Tayang Studio, a desktop app for making motion videos. \
Follow the tayang-studio and a2ui-options skills. The user sees your replies in a chat that draws A2UI, \
so offer every choice as an A2UI card.";

/// The Tayang agent plugin in the repo, used when the bundled copy is missing (`tauri dev`).
/// Debug builds only: a release build must never reach into the build machine's checkout.
fn dev_plugin_dir() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("packages")
        .join("skills")
        .join("agent-plugin");
    dir.join(".claude-plugin").join("plugin.json").is_file().then_some(dir)
}

/// `<resource dir>/agent-plugin` when it holds the plugin, else the repo copy (debug builds).
/// `None` means Claude starts without the plugin, and the skills go into its first prompt instead.
fn plugin_dir(resource_dir: Option<&Path>) -> Option<PathBuf> {
    let found = resource_dir
        .map(|r| r.join("agent-plugin"))
        .filter(|p| p.join(".claude-plugin").join("plugin.json").is_file())
        .or_else(dev_plugin_dir);
    if found.is_none() {
        eprintln!(
            "[tayang] warning: agent-plugin/.claude-plugin/plugin.json is missing from the app resources; \
             Claude gets the Tayang skills in its first prompt instead"
        );
    }
    found
}

/// Internal sessions (the setup installs, style studies and the autopilots' topic chats) never
/// show A2UI in a chat, so they get neither the plugin nor the A2UI system prompt. Topic ideas
/// (`ideas-*`) do.
pub fn wants_skills(chat_id: &str) -> bool {
    !(chat_id == "setup" || chat_id.starts_with("study-") || chat_id.starts_with("autopilot-"))
}

/// Claude gets the plugin and the system prompt through `_meta` (so nothing is
/// installed in the user's own `~/.claude`); every agent gets `TAYANG_STUDIO=1`.
/// Without `skills` (internal sessions) there is no `_meta` at all.
fn session_options(agent: AgentId, plugin: Option<&Path>, skills: bool) -> crate::acp::SessionOptions {
    let env = vec![("TAYANG_STUDIO".to_string(), "1".to_string())];
    let use_modes = agent == AgentId::Claude;
    if agent != AgentId::Claude || !skills {
        return crate::acp::SessionOptions { meta: None, env, auto: false, use_modes, mode_timeout: None };
    }
    let mut meta = serde_json::json!({ "systemPrompt": { "append": TAYANG_APPEND } });
    if let Some(path) = plugin {
        meta["claudeCode"] = serde_json::json!({
            "options": { "plugins": [{ "type": "local", "path": path.to_string_lossy() }] }
        });
    }
    crate::acp::SessionOptions { meta: Some(meta), env, auto: false, use_modes, mode_timeout: None }
}

/// Starts the chat's agent. Resolves `true` when Claude started without the Tayang
/// plugin, so the caller must send the skills as text in the first prompt (other
/// agents always get them that way).
#[tauri::command]
pub async fn agent_start(
    app: AppHandle,
    state: State<'_, AppState>,
    chat_id: String,
    agent_id: AgentId,
    auto: Option<bool>,
) -> CmdResult<bool> {
    let mut command = system::acp_command(agent_id)
        .ok_or("Pick an agent first: custom agents have no start command yet")?;
    let program = command[0].clone();
    let found = system::Exec::which(&RealExec, &program)
        .ok_or_else(|| format!("Can't find {program} on this computer"))?;
    command[0] = found.to_string_lossy().into_owned();
    let folder = project_folder_for_chat(&state, &chat_id)?;
    let cwd = resolve_cwd(&state.working(), &chat_id, folder.as_deref())?;
    let resource_dir = app.path().resource_dir().ok();
    let skills = wants_skills(&chat_id);
    let plugin = if agent_id == AgentId::Claude && skills {
        plugin_dir(resource_dir.as_deref())
    } else {
        None
    };
    let mut options = session_options(agent_id, plugin.as_deref(), skills);
    options.auto = wants_auto(&chat_id, auto.unwrap_or(false));
    let skills_as_text = skills && needs_skills_text(agent_id, plugin.as_deref());
    state
        .acp
        .start_with(&chat_id, &command, &cwd, Arc::new(TauriSink(app)), options)
        .await
        .map_err(err)?;
    Ok(skills_as_text)
}

/// Style studies and the autopilots' topic chats always run in auto mode; the install chat
/// never does (installs need the user's approval); other chats follow the chat's Auto toggle.
fn wants_auto(chat_id: &str, requested: bool) -> bool {
    if chat_id == "setup" {
        return false;
    }
    chat_id.starts_with("study-") || chat_id.starts_with("autopilot-") || requested
}

/// Claude without the plugin has no skills unless the first prompt carries them.
fn needs_skills_text(agent: AgentId, plugin: Option<&Path>) -> bool {
    agent == AgentId::Claude && plugin.is_none()
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
                            "Context: video project \"{}\". Its Tayang id is {}. Its files are in {}.",
                            p.title, p.id, p.folder
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
            MessagePart::File { path, name, size, .. } => {
                let rel = Path::new(path)
                    .file_name()
                    .map(|f| format!("attachments/{}", f.to_string_lossy()))
                    .unwrap_or_else(|| name.clone());
                let inline = is_image_name(name) && *size <= MAX_IMAGE_BLOCK;
                let size = human_size(*size);
                if inline {
                    out.push(PromptPart::Image { path: PathBuf::from(path) });
                    out.push(PromptPart::Text(format!("Attached image: {rel} ({name}, {size})")));
                } else {
                    out.push(PromptPart::Text(format!("Attached file: {rel} ({name}, {size})")));
                }
            }
            MessagePart::Tool { .. } | MessagePart::Thought { .. } | MessagePart::A2ui { .. } => {}
            MessagePart::A2uiAction { summary, action } => {
                out.push(PromptPart::Text(format!("{summary}\n\n```a2ui-action\n{action}\n```")));
            }
        }
    }
    out
}

pub const MAX_ATTACHMENT: u64 = 50 * 1024 * 1024;
/// Larger images go to the agent as the "Attached file" line: agents refuse big inline images.
pub const MAX_IMAGE_BLOCK: u64 = 5 * 1024 * 1024;

/// Mime type from the file extension; unknown ones are generic binary.
fn mime_for(name: &str) -> &'static str {
    let ext = Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "txt" | "md" => "text/plain",
        "csv" => "text/csv",
        "json" => "application/json",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        _ => "application/octet-stream",
    }
}

/// Images the agent gets as an image block (the types ACP's `image_block` sends). A gif is a file.
fn is_image_name(name: &str) -> bool {
    matches!(mime_for(name), "image/png" | "image/jpeg" | "image/webp")
}

fn human_size(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    let b = bytes as f64;
    if b < KB {
        format!("{bytes} B")
    } else if b < KB * KB {
        format!("{:.1} KB", b / KB)
    } else {
        format!("{:.1} MB", b / (KB * KB))
    }
}

/// Copies `source` into `<cwd>/attachments/`, under a name that is not taken yet.
pub fn copy_attachment(cwd: &Path, source: &Path, max: u64) -> CmdResult<MessagePart> {
    let meta = std::fs::metadata(source).map_err(|e| format!("Can't read that file: {e}"))?;
    if !meta.is_file() {
        return Err("That isn't a file".into());
    }
    if meta.len() > max {
        return Err("That file is larger than 50 MB".into());
    }
    let file_name = source
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| safe_segment(n))
        .ok_or("That file has no usable name")?;
    let dir = cwd.join("attachments");
    if !projects::ensure_inside(cwd, &dir) {
        return Err("The agent can only read files inside this chat's folder".into());
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("Can't create {}: {e}", dir.display()))?;
    let (stem, ext) = match file_name.rfind('.') {
        Some(i) if i > 0 => (file_name[..i].to_string(), file_name[i..].to_string()),
        _ => (file_name.clone(), String::new()),
    };
    let mut name = file_name;
    let mut n = 1;
    loop {
        let dest = dir.join(&name);
        if !projects::ensure_inside(cwd, &dest) {
            return Err("The agent can only read files inside this chat's folder".into());
        }
        // create_new keeps two attachments from racing for the same name.
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&dest) {
            Ok(mut out) => {
                let mut input = std::fs::File::open(source)
                    .map_err(|e| format!("Can't read that file: {e}"))?;
                if let Err(e) = std::io::copy(&mut input, &mut out) {
                    drop(out);
                    let _ = std::fs::remove_file(&dest);
                    return Err(format!("Can't copy that file: {e}"));
                }
                return Ok(MessagePart::File {
                    path: dest.to_string_lossy().into_owned(),
                    mime: mime_for(&name).into(),
                    name,
                    size: meta.len(),
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                n += 1;
                name = format!("{stem}-{n}{ext}");
            }
            Err(e) => return Err(format!("Can't copy that file: {e}")),
        }
    }
}

/// Attached files must live inside the chat's own folder.
pub fn check_file_parts(cwd: &Path, parts: &[MessagePart]) -> CmdResult<()> {
    for part in parts {
        if let MessagePart::File { path, .. } = part {
            if !projects::ensure_inside(cwd, Path::new(path)) {
                return Err("That file is outside this chat's folder".into());
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn attach_file(
    state: State<'_, AppState>,
    chat_id: String,
    source_path: String,
) -> CmdResult<MessagePart> {
    let folder = project_folder_for_chat(&state, &chat_id)?;
    let cwd = resolve_cwd(&state.working(), &chat_id, folder.as_deref())?;
    copy_attachment(&cwd, Path::new(&source_path), MAX_ATTACHMENT)
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
    if parts.iter().any(|p| matches!(p, MessagePart::File { .. })) {
        let folder = project_folder_for_chat(&state, &chat_id)?;
        let cwd = resolve_cwd(&working, &chat_id, folder.as_deref())?;
        check_file_parts(&cwd, &parts)?;
    }
    check_frame_images(&working, &parts, |id| {
        state.db.get_project(id).ok().flatten().map(|p| PathBuf::from(p.folder))
    })?;
    let prompt = build_prompt(&parts, fps, |id| state.db.get_project(id).ok().flatten(), read_brief);
    state.acp.prompt(&chat_id, prompt).await.map_err(err)
}

/// Turns auto mode on or off for the chat's running agent. The setup chat can't.
#[tauri::command]
pub async fn agent_set_auto(
    state: State<'_, AppState>,
    chat_id: String,
    on: bool,
) -> CmdResult<()> {
    let on = wants_auto(&chat_id, on);
    state.acp.set_auto(&chat_id, on).await.map(|_| ()).map_err(err)
}

#[tauri::command]
pub async fn agent_cancel(state: State<'_, AppState>, chat_id: String) -> CmdResult<()> {
    state.acp.cancel(&chat_id).await.map_err(err)
}

/// Stops the agent process of this chat. Stopping a chat with no agent is fine.
#[tauri::command]
pub async fn agent_stop(state: State<'_, AppState>, chat_id: String) -> CmdResult<()> {
    let _ = state.acp.stop(&chat_id).await;
    Ok(())
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

/// Fetches the built-in styles from the API; keeps the cached ones when offline.
#[tauri::command]
pub async fn sync_styles(state: State<'_, AppState>) -> CmdResult<StylesSync> {
    let api_url = crate::styles_sync::effective_api_url(&state.db.get_settings(&state.home));
    let fetcher = crate::styles_sync::HttpFetcher::new(std::time::Duration::from_secs(10))?;
    crate::styles_sync::sync_styles(&state.db, &api_url, &fetcher).await
}

/// Unpacks the project's style template into its folder (once, never over existing files).
#[tauri::command]
pub async fn install_style_template(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
) -> CmdResult<InstallResult> {
    let api_url = crate::styles_sync::effective_api_url(&state.db.get_settings(&state.home));
    let templates = app.path().app_data_dir().map_err(err)?.join("templates");
    let fetcher = crate::styles_sync::HttpFetcher::new(std::time::Duration::from_secs(120))?;
    let installed =
        crate::styles_sync::install_template(&state.db, &fetcher, &api_url, &templates, &project_id)
            .await?;
    Ok(InstallResult { installed })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RenderCommand {
    pub install: Option<Vec<String>>,
    pub render: Vec<String>,
}

/// The exact command "Render video" will run when the project has a `tayang.json`.
#[tauri::command]
pub fn render_command(
    state: State<'_, AppState>,
    project_id: String,
) -> CmdResult<Option<RenderCommand>> {
    let folder = project_folder(&state, &project_id)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    Ok(media::render_command(&folder, now)?.map(|p| RenderCommand { install: p.install, render: p.render }))
}

/// Rewrites the project's AGENTS.md and CLAUDE.md (e.g. after a template could not be installed).
#[tauri::command]
pub fn write_brief(state: State<'_, AppState>, project_id: String, brief: String) -> CmdResult<()> {
    let folder = project_folder(&state, &project_id)?;
    projects::write_project_brief(&folder, &brief)
        .map_err(|e| format!("Can't write the project brief: {e}"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn locale_is_trimmed_and_blank_is_none() {
        assert_eq!(super::clean_locale(Some(" id-ID ".into())), Some("id-ID".into()));
        assert_eq!(super::clean_locale(Some("  ".into())), None);
        assert_eq!(super::clean_locale(None), None);
        for unknown in ["C", "POSIX", "C.UTF-8", "POSIX.UTF-8", " C "] {
            assert_eq!(super::clean_locale(Some(unknown.into())), None, "{unknown}");
        }
        assert_eq!(super::clean_locale(Some("ca-ES".into())), Some("ca-ES".into()));
        assert_eq!(super::clean_locale(Some("Czech".into())), Some("Czech".into()));
    }

    fn seeded() -> Db {
        let db = Db::open_in_memory().unwrap();
        db.insert_project(&Project {
            id: "p".into(),
            title: "P".into(),
            slug: "p".into(),
            folder: "/w/p".into(),
            kind: VideoKind::Promo,
            format: VideoFormat::Portrait,
            language: VideoLanguage::Id,
            status: ProjectStatus::Rendered,
            style_id: None,
            scheduled_at: None,
            review_state: ReviewState::Pending,
            posted_at: None,
            reminded_at: Some("2026-11-01T00:00:00Z".into()),
            review_reminded_at: None,
            duration_sec: None,
            created_at: "t".into(),
            updated_at: "t".into(),
        })
        .unwrap();
        db
    }

    #[test]
    fn set_schedule_validates_sets_clears_and_resets_the_reminder() {
        let db = seeded();
        assert!(schedule_project(&db, "p", Some("tomorrow".into())).is_err());
        assert!(schedule_project(&db, "p", Some("2026-11-05 09:00".into())).is_err());
        assert!(schedule_project(&db, "nope", Some("2026-11-05T09:00:00+07:00".into())).is_err());
        assert!(schedule_project(&db, "nope", None).is_err());
        let p = schedule_project(&db, "p", Some("2026-11-05T09:00:00+07:00".into())).unwrap();
        assert_eq!(p.scheduled_at.as_deref(), Some("2026-11-05T02:00:00Z"));
        assert_eq!(p.reminded_at, None);
        db.update_project("p", serde_json::json!({ "remindedAt": "2026-11-05T01:00:00Z", "reviewRemindedAt": "2026-11-05T00:00:00Z" })).unwrap();
        let p = schedule_project(&db, "p", None).unwrap();
        assert_eq!(p.scheduled_at, None);
        assert_eq!(p.reminded_at, None);
        assert_eq!(p.review_reminded_at, None);
        assert_eq!(db.get_project("p").unwrap().unwrap().scheduled_at, None);
    }

    #[test]
    fn set_posted_stamps_and_clears_and_approve_approves() {
        let db = seeded();
        let p = mark_posted(&db, "p", true).unwrap();
        assert!(p.posted_at.is_some());
        assert_eq!(mark_posted(&db, "p", false).unwrap().posted_at, None);
        assert!(mark_posted(&db, "nope", true).is_err());
        assert_eq!(approve(&db, "p").unwrap().review_state, ReviewState::Approved);
        assert_eq!(db.get_project("p").unwrap().unwrap().review_state, ReviewState::Approved);
        assert!(approve(&db, "nope").is_err());
    }

    #[test]
    fn system_locale_never_panics_and_is_none_or_text() {
        assert!(super::system_locale().is_none_or(|l| !l.is_empty()));
    }

    use super::*;

    #[test]
    fn a_study_keeps_the_working_folder_it_started_in() {
        let tmp = tempfile::tempdir().unwrap();
        let (old, new) = (tmp.path().join("old"), tmp.path().join("new"));
        let db = Db::open_in_memory().unwrap();
        db.update_settings(serde_json::json!({ "workingFolder": old.to_string_lossy() })).unwrap();
        let state = AppState {
            db,
            acp: AcpManager::new(),
            media: MediaTools::from_env_or_path(),
            home: tmp.path().to_path_buf(),
            study_working: Default::default(),
        };
        let dir = study_path(&state.working(), "s1").unwrap();
        std::fs::create_dir_all(&dir).unwrap();
        state.study_working.lock().unwrap().insert("s1".into(), state.working());
        state.db.update_settings(serde_json::json!({ "workingFolder": new.to_string_lossy() })).unwrap();
        assert_eq!(state.working(), new);
        assert_eq!(state.working_for_study("s1"), old);
        assert_eq!(state.working_for_study("other"), new);
        media::remove_study_dir(&state.working_for_study("s1"), "s1").unwrap();
        assert!(!dir.exists());
    }

    #[test]
    fn session_options_for_claude_load_the_plugin() {
        let plugin = PathBuf::from("/res/agent-plugin");
        let o = session_options(AgentId::Claude, Some(&plugin), true);
        assert_eq!(o.env, vec![("TAYANG_STUDIO".to_string(), "1".to_string())]);
        let meta = o.meta.unwrap();
        let path = meta["claudeCode"]["options"]["plugins"][0]["path"].as_str().unwrap();
        assert_eq!(PathBuf::from(path), plugin);
        assert_eq!(meta["claudeCode"]["options"]["plugins"][0]["type"], "local");
        assert_eq!(meta["systemPrompt"]["append"], TAYANG_APPEND);
    }

    #[test]
    fn session_options_for_other_agents_only_set_env() {
        for id in [AgentId::Opencode, AgentId::Codex, AgentId::Gemini] {
            let o = session_options(id, Some(Path::new("/x")), true);
            assert!(o.meta.is_none());
            assert_eq!(o.env, vec![("TAYANG_STUDIO".to_string(), "1".to_string())]);
        }
    }

    #[test]
    fn claude_without_a_plugin_folder_still_gets_the_append() {
        let o = session_options(AgentId::Claude, None, true);
        let meta = o.meta.unwrap();
        assert!(meta["claudeCode"].is_null());
        assert_eq!(meta["systemPrompt"]["append"], TAYANG_APPEND);
    }

    #[test]
    fn plugin_dir_prefers_resources_then_dev_folder() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(plugin_dir(Some(tmp.path())), dev_plugin_dir());
        let real = tmp.path().join("agent-plugin").join(".claude-plugin");
        std::fs::create_dir_all(&real).unwrap();
        std::fs::write(real.join("plugin.json"), "{}").unwrap();
        assert_eq!(plugin_dir(Some(tmp.path())), Some(tmp.path().join("agent-plugin")));
    }

    #[test]
    fn dev_plugin_folder_exists_in_the_repo() {
        // Only debug builds look in the repo; a release build must use its bundled copy.
        assert_eq!(dev_plugin_dir().is_some(), cfg!(debug_assertions));
    }

    #[test]
    fn internal_sessions_get_no_meta() {
        assert!(!wants_skills("setup"));
        assert!(!wants_skills("study-abc"));
        assert!(!wants_skills("autopilot-a1"));
        assert!(wants_skills("ideas-2026-11-04"));
        assert!(wants_skills("c1"));
    }

    #[test]
    fn auto_mode_rules() {
        assert!(wants_auto("study-abc", false));
        assert!(wants_auto("autopilot-a1", false));
        assert!(!wants_auto("setup", true));
        assert!(wants_auto("c1", true));
        assert!(!wants_auto("c1", false));
    }

    #[test]
    fn internal_sessions_get_no_meta_options() {
        let o = session_options(AgentId::Claude, Some(Path::new("/p")), false);
        assert!(o.meta.is_none());
        assert_eq!(o.env, vec![("TAYANG_STUDIO".to_string(), "1".to_string())]);
    }

    #[test]
    fn claude_without_the_plugin_gets_the_skills_as_text() {
        assert!(needs_skills_text(AgentId::Claude, None));
        assert!(!needs_skills_text(AgentId::Claude, Some(Path::new("/p"))));
        // Other agents get them as text anyway; the app decides that itself.
        assert!(!needs_skills_text(AgentId::Codex, None));
    }

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
        let topics = resolve_cwd(w, "autopilot-a1", None).unwrap();
        assert_eq!(topics, w.join(".tayang").join("chats").join("autopilot-a1"));
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
        assert!(check_frame_images(&w, std::slice::from_ref(&in_old), known).is_ok());
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
            review_state: ReviewState::None,
            posted_at: None,
            reminded_at: None,
            review_reminded_at: None,
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
    fn a2ui_action_becomes_summary_and_fenced_json() {
        let parts = vec![
            MessagePart::A2ui { surface_id: "s1".into(), messages: vec![serde_json::json!({"version":"v0.9"})] },
            MessagePart::A2uiAction {
                summary: "Picked: Kenapa rupiah melemah?".into(),
                action: serde_json::json!({"version":"v0.9","action":{"name":"pick"}}),
            },
        ];
        assert_eq!(
            build_prompt(&parts, 30, |_| None, |_| None),
            vec![PromptPart::Text(
                "Picked: Kenapa rupiah melemah?\n\n```a2ui-action\n{\"action\":{\"name\":\"pick\"},\"version\":\"v0.9\"}\n```".into()
            )]
        );
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
            review_state: ReviewState::None,
            posted_at: None,
            reminded_at: None,
            review_reminded_at: None,
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
                tool_kind: None,
                path: None,
            },
            MessagePart::Thought { text: "hmm".into() },
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
                    "Context: video project \"Launch\". Its Tayang id is p1. Its files are in /w/launch.\nIts AGENTS.md:\n\n# Launch\n- Kind: promo"
                        .into()
                ),
                PromptPart::Image { path: PathBuf::from("/w/f.png") },
                PromptPart::Text(
                    "Frame 45 at 0:01.50 of Launch. Marks (x,y relative): (0.50, 0.25)".into()
                ),
            ]
        );
    }

    #[test]
    fn attach_copies_into_attachments_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path().join("cwd");
        std::fs::create_dir_all(&cwd).unwrap();
        let src = tmp.path().join("notes.pdf");
        std::fs::write(&src, b"hello").unwrap();
        let part = copy_attachment(&cwd, &src, MAX_ATTACHMENT).unwrap();
        let dest = cwd.join("attachments").join("notes.pdf");
        assert_eq!(std::fs::read(&dest).unwrap(), b"hello");
        assert_eq!(
            part,
            MessagePart::File {
                path: dest.to_string_lossy().into_owned(),
                name: "notes.pdf".into(),
                mime: "application/pdf".into(),
                size: 5,
            }
        );
    }

    #[test]
    fn attach_names_collisions_uniquely() {
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path().join("cwd");
        std::fs::create_dir_all(&cwd).unwrap();
        let src = tmp.path().join("a.png");
        std::fs::write(&src, b"1").unwrap();
        copy_attachment(&cwd, &src, MAX_ATTACHMENT).unwrap();
        std::fs::write(&src, b"22").unwrap();
        let MessagePart::File { name, path, mime, .. } =
            copy_attachment(&cwd, &src, MAX_ATTACHMENT).unwrap()
        else {
            panic!("not a file part")
        };
        assert_eq!(name, "a-2.png");
        assert_eq!(mime, "image/png");
        assert_eq!(std::fs::read(path).unwrap(), b"22");
        assert_eq!(std::fs::read(cwd.join("attachments").join("a.png")).unwrap(), b"1");
    }

    #[test]
    fn attach_rejects_big_files_and_non_files() {
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path().join("cwd");
        std::fs::create_dir_all(&cwd).unwrap();
        let src = tmp.path().join("big.bin");
        std::fs::write(&src, vec![0u8; 11]).unwrap();
        let e = copy_attachment(&cwd, &src, 10).unwrap_err();
        assert_eq!(e, "That file is larger than 50 MB");
        assert!(copy_attachment(&cwd, tmp.path(), 10).is_err());
        assert!(copy_attachment(&cwd, &tmp.path().join("missing"), 10).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn attach_rejects_a_destination_outside_the_cwd() {
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path().join("cwd");
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&cwd).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, cwd.join("attachments")).unwrap();
        let src = tmp.path().join("a.txt");
        std::fs::write(&src, b"x").unwrap();
        assert!(copy_attachment(&cwd, &src, MAX_ATTACHMENT).is_err());
        assert!(!outside.join("a.txt").exists());
    }

    #[test]
    fn file_parts_become_images_or_text() {
        let parts = vec![
            MessagePart::File {
                path: "/w/c/attachments/shot.PNG".into(),
                name: "shot.PNG".into(),
                mime: "image/png".into(),
                size: 10,
            },
            MessagePart::File {
                path: "/w/c/attachments/brief.pdf".into(),
                name: "brief.pdf".into(),
                mime: "application/pdf".into(),
                size: 2048,
            },
        ];
        assert_eq!(
            build_prompt(&parts, 30, |_| None, |_| None),
            vec![
                PromptPart::Image { path: PathBuf::from("/w/c/attachments/shot.PNG") },
                PromptPart::Text("Attached image: attachments/shot.PNG (shot.PNG, 10 B)".into()),
                PromptPart::Text(
                    "Attached file: attachments/brief.pdf (brief.pdf, 2.0 KB)".into()
                ),
            ]
        );
    }

    #[test]
    fn gifs_and_big_images_are_sent_as_file_lines() {
        let file = |name: &str, size: u64| MessagePart::File {
            path: format!("/w/c/attachments/{name}"),
            name: name.into(),
            mime: mime_for(name).into(),
            size,
        };
        let parts = vec![
            file("loop.gif", 10),
            file("big.jpg", MAX_IMAGE_BLOCK + 1),
            file("edge.webp", MAX_IMAGE_BLOCK),
        ];
        let out = build_prompt(&parts, 30, |_| None, |_| None);
        assert_eq!(out[0], PromptPart::Text("Attached file: attachments/loop.gif (loop.gif, 10 B)".into()));
        assert_eq!(out[1], PromptPart::Text("Attached file: attachments/big.jpg (big.jpg, 5.0 MB)".into()));
        assert_eq!(out[2], PromptPart::Image { path: PathBuf::from("/w/c/attachments/edge.webp") });
        assert_eq!(out.len(), 4);
    }

    #[test]
    fn file_parts_must_be_inside_the_chat_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path().join("cwd");
        std::fs::create_dir_all(&cwd).unwrap();
        let file = |p: PathBuf| MessagePart::File {
            path: p.to_string_lossy().into_owned(),
            name: "x".into(),
            mime: "text/plain".into(),
            size: 1,
        };
        assert!(check_file_parts(&cwd, &[file(cwd.join("attachments").join("x"))]).is_ok());
        assert!(check_file_parts(&cwd, &[file(tmp.path().join("secret"))]).is_err());
    }
}

// ---- agent usage ----

#[tauri::command]
pub async fn get_agent_usage(
    state: State<'_, AppState>,
    cache: State<'_, crate::usage::UsageCache>,
    force: bool,
) -> CmdResult<Vec<AgentUsage>> {
    if !force {
        if let Some((at, v)) = cache.0.lock().map_err(err)?.as_ref() {
            if at.elapsed() < crate::usage::CACHE_TTL {
                return Ok(v.clone());
            }
        }
    }
    let home = state.home.clone();
    let (agents, token) = tauri::async_runtime::spawn_blocking(move || {
        let agents = system::detect_agents(&RealExec);
        let token = if agents.iter().any(|a| a.installed && a.id == AgentId::Claude) {
            crate::usage::read_claude_token(&RealExec, &home)
        } else {
            None
        };
        (agents, token)
    })
    .await
    .map_err(err)?;
    let now = chrono::Utc::now();
    let mut out = Vec::new();
    for a in agents.iter().filter(|a| a.installed) {
        if a.id != AgentId::Claude {
            out.push(crate::usage::unavailable(a.id, &a.name, now));
            continue;
        }
        let usage = match &token {
            None => crate::usage::usage_from_response(401, "", now),
            Some(t) => match crate::usage::fetch_claude_usage(t).await {
                Ok(u) => u,
                Err(m) => {
                    let mut u = crate::usage::usage_from_response(0, "", now);
                    u.message = Some(m);
                    u
                }
            },
        };
        out.push(usage);
    }
    // Failures aren't cached, so the next poll retries.
    if out.iter().all(|u| u.status != UsageStatus::Error) {
        *cache.0.lock().map_err(err)? = Some((std::time::Instant::now(), out.clone()));
    }
    Ok(out)
}
