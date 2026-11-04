//! Tauri commands: the thin layer between the UI and the Rust modules.

use crate::db::Db;
use crate::media::MediaTools;
use crate::system::{self, RealExec};
use crate::types::*;
use crate::acp::AcpManager;
use std::path::PathBuf;
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
