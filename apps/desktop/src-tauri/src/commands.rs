//! Tauri commands: the thin layer between the UI and the Rust modules.

use crate::db::Db;
use crate::media::MediaTools;
use crate::system::{self, RealExec};
use crate::types::*;
use crate::acp::AcpManager;
use crate::projects;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};
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
    state: State<'_, AppState>,
    patch: serde_json::Value,
) -> CmdResult<Settings> {
    state.db.update_settings(patch).map_err(err)
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
