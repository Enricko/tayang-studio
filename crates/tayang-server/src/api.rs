//! The authenticated JSON-RPC API used by the browser. Command names mirror the desktop's Tauri
//! commands, so the same React state layer can talk to either backend. Uploads, assets, events,
//! authentication and health live on their own routes.

use crate::agent;
use crate::orchestrator;
use crate::paths;
use crate::state::AppState;
use crate::web_db;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::Utc;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tayang_core::types::*;

pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
}

impl ApiError {
    pub fn bad(message: impl Into<String>) -> Self {
        Self { status: StatusCode::BAD_REQUEST, code: "invalid", message: message.into() }
    }
    pub fn not_found(message: impl Into<String>) -> Self {
        Self { status: StatusCode::NOT_FOUND, code: "not-found", message: message.into() }
    }
    pub fn conflict(message: impl Into<String>) -> Self {
        Self { status: StatusCode::CONFLICT, code: "busy", message: message.into() }
    }
    pub fn unavailable(message: impl Into<String>) -> Self {
        Self { status: StatusCode::SERVICE_UNAVAILABLE, code: "unavailable", message: message.into() }
    }
    pub fn internal(message: impl Into<String>) -> Self {
        Self { status: StatusCode::INTERNAL_SERVER_ERROR, code: "server", message: message.into() }
    }
}

impl From<String> for ApiError {
    fn from(message: String) -> Self {
        ApiError::bad(message)
    }
}

impl From<&str> for ApiError {
    fn from(message: &str) -> Self {
        ApiError::bad(message)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.code, "message": self.message }))).into_response()
    }
}

fn err(e: impl std::fmt::Display) -> ApiError {
    ApiError::bad(e.to_string())
}

fn value<T: Serialize>(v: T) -> Result<Json<Value>, ApiError> {
    serde_json::to_value(v).map(Json).map_err(|e| ApiError::internal(e.to_string()))
}

fn arg<T: DeserializeOwned>(args: &Value, name: &str) -> Result<T, ApiError> {
    serde_json::from_value(args.get(name).cloned().unwrap_or(Value::Null))
        .map_err(|e| ApiError::bad(format!("{name}: {e}")))
}

fn opt<T: DeserializeOwned>(args: &Value, name: &str) -> Result<Option<T>, ApiError> {
    match args.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => serde_json::from_value(v.clone()).map(Some).map_err(|e| ApiError::bad(format!("{name}: {e}"))),
    }
}

pub fn locale() -> Option<String> {
    let raw = ["LC_ALL", "LC_MESSAGES", "LANG"]
        .iter()
        .find_map(|k| std::env::var(k).ok().filter(|v| !v.trim().is_empty()))?;
    let v = raw.trim().trim_end_matches(".UTF-8").trim_end_matches(".utf8").to_string();
    let base = v.split('.').next().unwrap_or(&v);
    if matches!(base, "C" | "POSIX") {
        None
    } else {
        Some(base.replace('_', "-"))
    }
}

fn claude_config(state: &AppState) -> PathBuf {
    let dir = tayang_core::claude_account::config_dir(&state.data_dir);
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn claude_program() -> Result<PathBuf, ApiError> {
    tayang_core::system::Exec::which(&tayang_core::system::RealExec, "claude")
        .ok_or_else(|| ApiError::bad("Can't find Claude Code on this server"))
}

async fn agent_usage(state: Arc<AppState>, force: bool) -> Result<Vec<AgentUsage>, ApiError> {
    if !force {
        if let Some((at, v)) = state.usage.0.lock().map_err(|e| ApiError::internal(e.to_string()))?.as_ref() {
            if at.elapsed() < tayang_core::usage::CACHE_TTL {
                return Ok(v.clone());
            }
        }
    }
    let claude = claude_config(&state);
    let agents = tokio::task::spawn_blocking(tayang_core::system::detect_agents_standalone)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let token = if agents.iter().any(|a| a.installed && a.id == AgentId::Claude) {
        let exec = tayang_core::system::RealExec;
        tokio::task::spawn_blocking(move || tayang_core::usage::read_claude_token(&exec, &claude))
            .await
            .unwrap_or(None)
    } else {
        None
    };
    let now = Utc::now();
    let mut out = Vec::new();
    for a in agents.iter().filter(|a| a.installed) {
        if a.id == AgentId::Opencode {
            let db = tayang_core::usage::opencode_db(&state.home, std::env::var("XDG_DATA_HOME").ok().as_deref());
            let usage = tokio::task::spawn_blocking(move || tayang_core::usage::opencode_usage(&db, now))
                .await
                .map_err(|e| ApiError::internal(e.to_string()))?;
            out.push(usage);
        } else if a.id != AgentId::Claude {
            out.push(tayang_core::usage::unavailable(a.id, &a.name, now));
        } else {
            let usage = match &token {
                None => tayang_core::usage::usage_from_response(401, "", now),
                Some(token) => match tayang_core::usage::fetch_claude_usage(token).await {
                    Ok(u) => u,
                    Err(message) => {
                        let mut u = tayang_core::usage::usage_from_response(0, "", now);
                        u.message = Some(message);
                        u
                    }
                },
            };
            out.push(usage);
        }
    }
    if out.iter().all(|u| u.status != UsageStatus::Error) {
        *state.usage.0.lock().map_err(|e| ApiError::internal(e.to_string()))? = Some((std::time::Instant::now(), out.clone()));
    }
    Ok(out)
}

async fn claude_account_impl(state: &AppState) -> Result<tayang_core::claude_account::ClaudeAccount, ApiError> {
    let dir = claude_config(state);
    let Ok(claude) = claude_program() else { return Ok(Default::default()) };
    Ok(tayang_core::claude_account::status(&claude, &dir).await)
}

pub async fn claude_sign_in(state: Arc<AppState>) -> Result<Json<Value>, ApiError> {
    use tayang_core::claude_account::{sign_in, status, SignInEnd, SIGN_IN_TIMEOUT};
    let dir = claude_config(&state);
    let claude = claude_program()?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    if let Some(old) = state.claude_sign_in.lock().map_err(|e| ApiError::internal(e.to_string()))?.replace(tx) {
        let _ = old.send(());
    }
    let emitter = state.clone();
    let end = sign_in(&claude, &dir, SIGN_IN_TIMEOUT, rx, move |url| {
        emitter.events.emit(&emitter.db, "claude://sign-in-url", json!(url));
    })
    .await;
    let _ = state.usage.0.lock().map(|mut u| *u = None);
    match end {
        SignInEnd::Done => {
            let account = status(&claude, &dir).await;
            if account.signed_in {
                value(account)
            } else {
                Err(ApiError::bad("Claude didn't finish signing in. Try again"))
            }
        }
        SignInEnd::Cancelled => Err(ApiError { status: StatusCode::CONFLICT, code: "cancelled", message: "cancelled".into() }),
        SignInEnd::TimedOut => Err(ApiError::bad("Signing in took too long. Try again")),
        SignInEnd::Failed(why) => Err(ApiError::bad(why)),
    }
}

#[derive(serde::Deserialize)]
pub struct RpcBody {
    pub cmd: String,
    #[serde(default)]
    pub args: Value,
}

pub async fn rpc(State(state): State<Arc<AppState>>, Json(body): Json<RpcBody>) -> Result<Json<Value>, ApiError> {
    let args = if body.args.is_null() { json!({}) } else { body.args };
    let cmd = body.cmd.as_str();
    match cmd {
        // ---- system and settings ----
        "get_system_info" => {
            let info = tokio::task::spawn_blocking(|| tayang_core::system::system_info(&tayang_core::system::RealExec))
                .await
                .map_err(|e| ApiError::internal(e.to_string()))?;
            value(info)
        }
        "system_locale" => Ok(Json(json!(locale()))),
        "detect_agents" => {
            let agents = tokio::task::spawn_blocking(tayang_core::system::detect_agents_standalone)
                .await
                .map_err(|e| ApiError::internal(e.to_string()))?;
            value(agents)
        }
        "check_tools" => {
            let agent: AgentId = arg(&args, "agent")?;
            let config = claude_config(&state);
            let tools = tokio::task::spawn_blocking(move || {
                tayang_core::system::check_tools(&tayang_core::system::RealExec, agent, &config)
            })
            .await
            .map_err(|e| ApiError::internal(e.to_string()))?;
            value(tools)
        }
        "get_settings" => value(state.db.get_settings(&state.home)),
        "update_settings" => {
            let patch = args.get("patch").cloned().ok_or_else(|| ApiError::bad("patch is required"))?;
            if !patch.is_object() {
                return Err(ApiError::bad("patch must be an object"));
            }
            if let Some(folder) = patch.get("workingFolder").and_then(Value::as_str) {
                paths::validate_working_folder(&state, folder)?;
                std::fs::create_dir_all(folder).map_err(err)?;
            }
            let settings = state.db.update_settings(patch).map_err(err)?;
            value(settings)
        }
        "api_url_override" => Ok(Json(Value::Null)),
        "pick_folder" => Err(ApiError::unavailable(
            "Choosing a server folder in a browser isn't supported. Projects live in the configured workspace.",
        )),
        "get_agent_usage" => {
            let force = args.get("force").and_then(Value::as_bool).unwrap_or(false);
            value(agent_usage(state.clone(), force).await?)
        }
        "tts_voices" => crate::voices::list(&state).await,
        "tts_set_default" => {
            let engine: String = arg(&args, "engine")?;
            let voice: String = arg(&args, "voice")?;
            crate::voices::set_default(&state, &engine, &voice)
        }
        "tts_delete_voice" => {
            let voice: String = arg(&args, "voice")?;
            crate::voices::delete(&state, &voice)
        }
        "tts_status" => crate::voices::status(&state).await,
        "tts_prepare" => {
            let engine: String = arg(&args, "engine")?;
            crate::voices::prepare(&state, &engine).await
        }
        "tts_preview" => {
            let engine: String = arg(&args, "engine")?;
            let voice: Option<String> = opt(&args, "voice")?;
            let language: Option<String> = opt(&args, "language")?;
            crate::voices::preview(&state, &engine, voice.as_deref(), language.as_deref()).await
        }

        // ---- projects ----
        "list_projects" => value(state.db.list_projects().map_err(err)?),
        "create_project" => {
            let input: NewProject = arg(&args, "input")?;
            let brief: String = arg(&args, "brief")?;
            let working = state.working();
            paths::validate_working_folder(&state, &working.to_string_lossy())?;
            let project = tayang_core::service::new_project(&state.db, &working, input, &brief)?;
            state.events.emit(&state.db, "projects://changed", json!({ "id": project.id }));
            value(project)
        }
        "update_project" => {
            let id: String = arg(&args, "id")?;
            let patch = args.get("patch").cloned().ok_or_else(|| ApiError::bad("patch is required"))?;
            let p = state.db.update_project(&id, patch).map_err(err)?;
            state.events.emit(&state.db, "projects://changed", json!({ "id": p.id }));
            value(p)
        }
        "set_project_status" => {
            let project_id: String = arg(&args, "projectId")?;
            let status: ProjectStatus = arg(&args, "status")?;
            let reset = args.get("reset").and_then(Value::as_bool).unwrap_or(false);
            value(state.db.set_project_status(&project_id, status, reset).map_err(err)?)
        }
        "set_schedule" => {
            let project_id: String = arg(&args, "projectId")?;
            let at: Option<String> = opt(&args, "at")?;
            value(tayang_core::service::schedule_project(&state.db, &project_id, at)?)
        }
        "schedule_videos" => {
            let items: Vec<tayang_core::service::BatchItem> = arg(&args, "items")?;
            value(tayang_core::service::schedule_batch(&state.db, &state.working(), items, Utc::now())?)
        }
        "set_posted" => {
            let project_id: String = arg(&args, "projectId")?;
            let posted: bool = arg(&args, "posted")?;
            value(tayang_core::service::mark_posted(&state.db, &project_id, posted)?)
        }
        "approve_project" => {
            let project_id: String = arg(&args, "projectId")?;
            value(tayang_core::service::approve(&state.db, &project_id)?)
        }

        // ---- autopilots ----
        "list_autopilots" => value(state.db.list_autopilots().map_err(err)?),
        "save_autopilot" => {
            let input: AutopilotInput = arg(&args, "input")?;
            value(state.db.save_autopilot(&input).map_err(err)?)
        }
        "delete_autopilot" => {
            let id: String = arg(&args, "id")?;
            state.db.delete_autopilot(&id).map_err(err)?;
            Ok(Json(Value::Null))
        }
        "set_autopilot_status" => {
            let id: String = arg(&args, "id")?;
            let status: AutopilotStatus = arg(&args, "status")?;
            value(state.db.set_autopilot_status(&id, status).map_err(err)?)
        }
        "list_slots" => {
            let from: String = arg(&args, "from")?;
            let to: String = arg(&args, "to")?;
            value(state.db.list_slots(&from, &to).map_err(err)?)
        }
        "upsert_slot" => {
            let autopilot_id: String = arg(&args, "autopilotId")?;
            let due_at: String = arg(&args, "dueAt")?;
            value(state.db.upsert_slot(&autopilot_id, &due_at).map_err(err)?)
        }
        "update_slot" => {
            let id: String = arg(&args, "id")?;
            let patch = args.get("patch").cloned().ok_or_else(|| ApiError::bad("patch is required"))?;
            value(state.db.update_slot(&id, patch).map_err(err)?)
        }
        "stop_autopilot_slot" => {
            let slot_id: String = arg(&args, "slotId")?;
            let run = state.autopilot_current.lock().map_err(|e| ApiError::internal(e.to_string()))?.clone();
            let mut stopped = false;
            if let Some(run) = run.filter(|r| r.slot_id == slot_id) {
                run.cancel();
                if let Some(chat) = run.chat() {
                    let _ = agent::cancel(state.clone(), chat.clone()).await;
                    let _ = agent::stop(state.clone(), chat).await;
                }
                stopped = true;
            }
            if let Some(slot) = state.db.get_slot(&slot_id).map_err(err)? {
                if slot.status == SlotStatus::Making {
                    state.db.update_slot(&slot_id, json!({ "status": "failed", "error": "Stopped" })).map_err(err)?;
                    stopped = true;
                }
            }
            if !stopped {
                return Err(ApiError::bad("That autopilot slot isn't running any more"));
            }
            state.events.emit(&state.db, "autopilot://changed", json!({ "slotId": slot_id }));
            Ok(Json(Value::Null))
        }

        // ---- chats ----
        "list_chats" => {
            let project_id: Option<String> = opt(&args, "projectId")?;
            value(state.db.list_chats(project_id.as_deref()).map_err(err)?)
        }
        "list_recent_chats" => {
            let limit: Option<u32> = opt(&args, "limit")?;
            value(state.db.list_recent_chats(limit).map_err(err)?)
        }
        "list_archived_chats" => value(state.db.list_archived_chats().map_err(err)?),
        "set_thread_archived" => {
            let chat_id: String = arg(&args, "chatId")?;
            let archived: bool = arg(&args, "archived")?;
            state.db.set_thread_archived(&chat_id, archived).map_err(err)?;
            Ok(Json(Value::Null))
        }
        "purge_archive" => {
            let (chats, cards) = state.db.purge_archive().map_err(err)?;
            value(json!({ "chats": chats, "cards": cards }))
        }
        "get_chat" => {
            let chat_id: String = arg(&args, "chatId")?;
            value(state.db.get_chat(&chat_id).map_err(err)?)
        }
        "create_chat" => {
            let project_id: Option<String> = opt(&args, "projectId")?;
            let agent_id: AgentId = arg(&args, "agentId")?;
            let title: String = arg(&args, "title")?;
            value(state.db.create_chat(project_id.as_deref(), agent_id, &title).map_err(err)?)
        }
        "update_chat_agent" => {
            let chat_id: String = arg(&args, "chatId")?;
            let agent_id: AgentId = arg(&args, "agentId")?;
            state.db.set_chat_agent(&chat_id, agent_id).map_err(err)?.ok_or_else(|| ApiError::not_found("That chat doesn't exist"))
                .and_then(value)
        }
        "list_messages" => {
            let chat_id: String = arg(&args, "chatId")?;
            value(state.db.list_messages(&chat_id).map_err(err)?)
        }
        "add_message" => {
            let chat_id: String = arg(&args, "chatId")?;
            let role: MessageRole = arg(&args, "role")?;
            let parts: Vec<MessagePart> = arg(&args, "parts")?;
            value(state.db.add_message(&chat_id, role, &parts).map_err(err)?)
        }
        "chat_live" => {
            let chat_id: String = arg(&args, "chatId")?;
            value(agent::live(&state, &chat_id))
        }

        // ---- styles ----
        "list_styles" => value(state.db.list_styles().map_err(err)?),
        "save_style" => {
            let style: Style = arg(&args, "style")?;
            state.db.save_style(&style).map_err(err)?;
            Ok(Json(Value::Null))
        }
        "delete_style" => {
            let id: String = arg(&args, "id")?;
            state.db.delete_style(&id).map_err(err)?;
            tayang_core::media::remove_style_media(&state.data_dir, &id);
            Ok(Json(Value::Null))
        }
        "sync_styles" => {
            let settings = state.db.get_settings(&state.home);
            let api_url = tayang_core::styles_sync::effective_api_url(&settings);
            let fetcher = tayang_core::styles_sync::HttpFetcher::new(std::time::Duration::from_secs(10))
                .map_err(err)?;
            value(tayang_core::styles_sync::sync_styles(&state.db, &api_url, &fetcher).await.map_err(err)?)
        }
        "install_style_template" => {
            let project_id: String = arg(&args, "projectId")?;
            let settings = state.db.get_settings(&state.home);
            let api_url = tayang_core::styles_sync::effective_api_url(&settings);
            let templates = state.data_dir.join("templates");
            let fetcher = tayang_core::styles_sync::HttpFetcher::new(std::time::Duration::from_secs(120))
                .map_err(err)?;
            let installed = tayang_core::styles_sync::install_template(&state.db, &fetcher, &api_url, &templates, &project_id)
                .await
                .map_err(err)?;
            value(InstallResult { installed })
        }
        "read_style_result" => {
            let study_id: String = arg(&args, "studyId")?;
            let path = state.working_for_study(&study_id).join(".tayang/style-study").join(&study_id).join("style.json");
            match std::fs::read_to_string(&path) {
                Ok(s) => Ok(Json(json!(s))),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Json(Value::Null)),
                Err(e) => Err(ApiError::bad(format!("Can't read the style result: {e}"))),
            }
        }
        "study_dir" => {
            let study_id: String = arg(&args, "studyId")?;
            let working = state.working();
            let dir = tayang_core::service::study_dir(&working, &study_id)?;
            std::fs::create_dir_all(&dir).map_err(err)?;
            state
                .study_working
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(study_id, working);
            value(dir.to_string_lossy().into_owned())
        }
        "remove_study_dir" => {
            let study_id: String = arg(&args, "studyId")?;
            let working = state.working_for_study(&study_id);
            tayang_core::media::remove_study_dir(&working, &study_id)?;
            state.study_working.lock().unwrap_or_else(|e| e.into_inner()).remove(&study_id);
            Ok(Json(Value::Null))
        }
        "make_style_preview" => {
            let study_id: String = arg(&args, "studyId")?;
            let style_id: String = arg(&args, "styleId")?;
            let study = tayang_core::service::study_dir(&state.working_for_study(&study_id), &study_id)?;
            let out = tayang_core::media::style_media_dir(&state.data_dir, &style_id)
                .ok_or_else(|| ApiError::bad("That style id isn't valid"))?;
            let tools = state.media.clone();
            let made = tokio::task::spawn_blocking(move || tayang_core::media::make_style_preview(&tools, &study, &out))
                .await
                .map_err(|e| ApiError::internal(e.to_string()))??;
            value(made)
        }
        "make_style_sheets" => {
            let study_id: String = arg(&args, "studyId")?;
            let style_id: String = arg(&args, "styleId")?;
            let study = tayang_core::service::study_dir(&state.working_for_study(&study_id), &study_id)?;
            let out = tayang_core::media::style_refs_dir(&state.data_dir, &style_id)
                .ok_or_else(|| ApiError::bad("That style id isn't valid"))?;
            let tools = state.media.clone();
            let made = tokio::task::spawn_blocking(move || tayang_core::media::make_style_sheets(&tools, &study, &out))
                .await
                .map_err(|e| ApiError::internal(e.to_string()))??;
            value(made.into_iter().map(|p| p.to_string_lossy().into_owned()).collect::<Vec<_>>())
        }
        "keep_style_refs" => {
            let study_id: String = arg(&args, "studyId")?;
            let style_id: String = arg(&args, "styleId")?;
            let study = tayang_core::service::study_dir(&state.working_for_study(&study_id), &study_id)?;
            let out = tayang_core::media::style_refs_dir(&state.data_dir, &style_id)
                .ok_or_else(|| ApiError::bad("That style id isn't valid"))?;
            let kept = tayang_core::media::keep_style_refs(&study, &out)?;
            value(kept.into_iter().map(|p| p.to_string_lossy().into_owned()).collect::<Vec<_>>())
        }
        "copy_style_refs" => {
            let style_id: String = arg(&args, "styleId")?;
            let project_id: String = arg(&args, "projectId")?;
            let refs = tayang_core::media::style_refs_dir(&state.data_dir, &style_id)
                .ok_or_else(|| ApiError::bad("That style id isn't valid"))?;
            let folder = paths::project_folder(&state, &project_id)?;
            value(tayang_core::media::copy_style_refs(&refs, &folder)? as u32)
        }

        // ---- jobs ----
        "list_jobs" => value(state.db.list_jobs().map_err(err)?),
        "upsert_job" => {
            let job: Job = arg(&args, "job")?;
            state.db.upsert_job(&job).map_err(err)?;
            state.events.emit(&state.db, "jobs://changed", json!({ "id": job.id }));
            Ok(Json(Value::Null))
        }
        "delete_job" => {
            let id: String = arg(&args, "id")?;
            state.db.delete_job(&id).map_err(err)?;
            state.events.emit(&state.db, "jobs://changed", json!({ "id": id }));
            Ok(Json(Value::Null))
        }
        "set_jobs_archived" => {
            let ids: Vec<String> = arg(&args, "ids")?;
            let archived: bool = arg(&args, "archived")?;
            state.db.set_jobs_archived(&ids, archived).map_err(err)?;
            Ok(Json(Value::Null))
        }

        // ---- agent ----
        "agent_start" => {
            let chat_id: String = arg(&args, "chatId")?;
            let agent_id: AgentId = arg(&args, "agentId")?;
            let auto: Option<bool> = opt(&args, "auto")?;
            let skills = agent::start(state.clone(), chat_id, agent_id, auto).await?;
            value(skills)
        }
        "agent_prompt" => {
            let chat_id: String = arg(&args, "chatId")?;
            let parts: Vec<MessagePart> = arg(&args, "parts")?;
            agent::prompt(state.clone(), chat_id, parts).await?;
            Ok(Json(Value::Null))
        }
        "agent_set_auto" => {
            let chat_id: String = arg(&args, "chatId")?;
            let on: bool = arg(&args, "on")?;
            agent::set_auto(state.clone(), chat_id, on).await?;
            Ok(Json(Value::Null))
        }
        "agent_cancel" => {
            let chat_id: String = arg(&args, "chatId")?;
            agent::cancel(state.clone(), chat_id).await?;
            Ok(Json(Value::Null))
        }
        "agent_stop" => {
            let chat_id: String = arg(&args, "chatId")?;
            agent::stop(state.clone(), chat_id).await?;
            Ok(Json(Value::Null))
        }
        "agent_respond_permission" => {
            let request_id: String = arg(&args, "requestId")?;
            let option_id: Option<String> = opt(&args, "optionId")?;
            state.agent.resolve_permission(&state, &request_id, option_id)?;
            Ok(Json(Value::Null))
        }
        "agent_respond_question" => {
            let request_id: String = arg(&args, "requestId")?;
            let response: Value = arg(&args, "response")?;
            state.agent.resolve_question(&state, &request_id, response)?;
            Ok(Json(Value::Null))
        }
        "agent_models" => {
            let agent_id: AgentId = arg(&args, "agentId")?;
            value(agent::models(state.clone(), agent_id).await?)
        }
        "set_agent_model" => {
            let agent_id: AgentId = arg(&args, "agentId")?;
            let model: Option<String> = opt(&args, "model")?;
            let chat_id: Option<String> = opt(&args, "chatId")?;
            value(agent::set_model(&state, agent_id, model, chat_id).await?)
        }

        // ---- attachments (the browser uses POST /api/upload instead) ----
        "attach_file" => {
            let chat_id: String = arg(&args, "chatId")?;
            let source_path: String = arg(&args, "sourcePath")?;
            let source = PathBuf::from(&source_path);
            if !paths::in_workspace(&state, &source) {
                return Err(ApiError::bad("That file is outside the configured workspace"));
            }
            let cwd = tayang_core::service::agent_cwd(&state.db, &state.working(), &chat_id)?;
            let part = tayang_core::service::copy_attachment(&cwd, &source, tayang_core::service::MAX_ATTACHMENT)?;
            value(part)
        }

        // ---- project files (the workspace) ----
        "project_files" => {
            let project_id: String = arg(&args, "projectId")?;
            let dir: String = arg(&args, "dir")?;
            let root = paths::project_folder(&state, &project_id)?;
            let entries = tokio::task::spawn_blocking(move || tayang_core::files::list_dir(&root, &dir))
                .await
                .map_err(|e| ApiError::internal(e.to_string()))??;
            value(entries)
        }
        "find_project_files" => {
            let project_id: String = arg(&args, "projectId")?;
            let query: String = arg(&args, "query")?;
            let root = paths::project_folder(&state, &project_id)?;
            let entries = tokio::task::spawn_blocking(move || tayang_core::files::find(&root, &query))
                .await
                .map_err(|e| ApiError::internal(e.to_string()))??;
            value(entries)
        }
        "read_project_file" => {
            let project_id: String = arg(&args, "projectId")?;
            let path: String = arg(&args, "path")?;
            let root = paths::project_folder(&state, &project_id)?;
            let content = tokio::task::spawn_blocking(move || tayang_core::files::read(&root, &path))
                .await
                .map_err(|e| ApiError::internal(e.to_string()))??;
            value(content)
        }

        // ---- media ----
        "media_latest_render" => {
            let project_id: String = arg(&args, "projectId")?;
            let folder = paths::project_folder(&state, &project_id)?;
            value(tayang_core::media::latest_render(&folder).map(|p| p.to_string_lossy().into_owned()))
        }
        "latest_render_info" => {
            let project_id: String = arg(&args, "projectId")?;
            let folder = paths::project_folder(&state, &project_id)?;
            value(tayang_core::media::latest_render_info(&folder))
        }
        "newest_video_info" => {
            let project_id: String = arg(&args, "projectId")?;
            let folder = paths::project_folder(&state, &project_id)?;
            let folder = folder.clone();
            let info = tokio::task::spawn_blocking(move || tayang_core::media::newest_video_info(&folder))
                .await
                .map_err(|e| ApiError::internal(e.to_string()))?;
            value(info)
        }
        "recent_images" => {
            let chat_id: String = arg(&args, "chatId")?;
            let since: String = arg(&args, "since")?;
            let limit: u32 = arg(&args, "limit")?;
            let since = chrono::DateTime::parse_from_rfc3339(&since)
                .map_err(|_| ApiError::bad("since must be RFC 3339"))?
                .with_timezone(&Utc);
            let folder = state
                .db
                .get_chat(&chat_id)
                .map_err(err)?
                .and_then(|c| c.project_id)
                .and_then(|id| state.db.get_project(&id).ok().flatten())
                .map(|p| PathBuf::from(p.folder));
            let Some(folder) = folder else { return value(Vec::<FileInfo>::new()) };
            let found = tokio::task::spawn_blocking(move || tayang_core::media::recent_images(&folder, since, limit as usize))
                .await
                .map_err(|e| ApiError::internal(e.to_string()))?;
            value(found)
        }
        "video_thumbnail" => {
            let project_id: String = arg(&args, "projectId")?;
            let folder = paths::project_folder(&state, &project_id)?;
            let thumbs = state.data_dir.join("thumbs");
            let tools = state.media.clone();
            let id = project_id.clone();
            let hit = tokio::task::spawn_blocking({
                let folder = folder.clone();
                let thumbs = thumbs.clone();
                move || tayang_core::media::cached_video_thumbnail(&folder, &thumbs, &id)
            })
            .await
            .map_err(|e| ApiError::internal(e.to_string()))?;
            if let Some(hit) = hit {
                return value(hit);
            }
            let made = async {
                let _slot = THUMB_SLOTS.acquire().await.map_err(|e| ApiError::internal(e.to_string()))?;
                tokio::task::spawn_blocking(move || {
                    tayang_core::media::video_thumbnail(&tools, &folder, &thumbs, &project_id, tayang_core::media::THUMB_TIMEOUT)
                })
                .await
                .map_err(|e| ApiError::internal(e.to_string()))
            }
            .await?;
            value(made)
        }
        "media_probe" => {
            let project_id: String = arg(&args, "projectId")?;
            let folder = paths::project_folder(&state, &project_id)?;
            let tools = state.media.clone();
            let out = tokio::task::spawn_blocking(move || match tayang_core::media::latest_render(&folder) {
                Some(video) => tayang_core::media::probe(&tools, &video).map(Some),
                None => Ok(None),
            })
            .await
            .map_err(|e| ApiError::internal(e.to_string()))??;
            value(out)
        }
        "media_extract_frame" => {
            let project_id: String = arg(&args, "projectId")?;
            let time_sec: f64 = arg(&args, "timeSec")?;
            let folder = paths::project_folder(&state, &project_id)?;
            let tools = state.media.clone();
            let out = tokio::task::spawn_blocking(move || {
                let video = tayang_core::media::latest_render(&folder).ok_or("This project has no render yet")?;
                let dir = folder.join(".tayang").join("frames");
                tayang_core::media::extract_frame(&tools, &video, time_sec, &dir)
            })
            .await
            .map_err(|e| ApiError::internal(e.to_string()))??;
            value(out.to_string_lossy().into_owned())
        }
        "media_thumbnails" => {
            let project_id: String = arg(&args, "projectId")?;
            let count: u32 = arg(&args, "count")?;
            let folder = paths::project_folder(&state, &project_id)?;
            let tools = state.media.clone();
            let paths = tokio::task::spawn_blocking(move || {
                let video = tayang_core::media::latest_render(&folder).ok_or("This project has no render yet")?;
                let dir = folder.join(".tayang").join("thumbs");
                tayang_core::media::thumbnails(&tools, &video, count, &dir)
            })
            .await
            .map_err(|e| ApiError::internal(e.to_string()))??;
            value(paths.into_iter().map(|p| p.to_string_lossy().into_owned()).collect::<Vec<_>>())
        }
        "media_render" => {
            let project_id: String = arg(&args, "projectId")?;
            {
                let mut locks = state.render_locks.lock().await;
                if !locks.insert(project_id.clone()) {
                    return Err(ApiError::conflict("A render is already running for this project"));
                }
            }
            let folder = paths::project_folder(&state, &project_id)?;
            let out = tokio::task::spawn_blocking(move || tayang_core::media::render(&folder)).await;
            state.render_locks.lock().await.remove(&project_id);
            let path = out.map_err(|e| ApiError::internal(e.to_string()))??;
            let _ = state.db.update_project(&project_id, json!({ "status": "rendered" }));
            state.events.emit(&state.db, "projects://changed", json!({ "id": project_id }));
            value(path.to_string_lossy().into_owned())
        }
        "render_command" => {
            let project_id: String = arg(&args, "projectId")?;
            let folder = paths::project_folder(&state, &project_id)?;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let plan = tayang_core::media::render_command(&folder, now)?
                .map(|p| tayang_core::service::RenderCommand { install: p.install, render: p.render });
            value(plan)
        }
        "write_brief" => {
            let project_id: String = arg(&args, "projectId")?;
            let brief: String = arg(&args, "brief")?;
            let folder = paths::project_folder(&state, &project_id)?;
            tayang_core::projects::write_project_brief(&folder, &brief)
                .map_err(|e| ApiError::bad(format!("Can't write the project brief: {e}")))?;
            Ok(Json(Value::Null))
        }

        // ---- optional cloud features: explicit capability errors, never mock data ----
        "auth_start" => Err(ApiError::unavailable(
            "Tayang cloud sign-in isn't available in the self-hosted web edition. Local projects and agents work without it.",
        )),
        "auth_status" => value(json!({
            "state": "signed-out",
            "signedIn": false,
            "offline": false,
            "apiUrl": tayang_core::styles_sync::effective_api_url(&state.db.get_settings(&state.home)),
        })),
        "auth_cancel" => Ok(Json(Value::Null)),
        "auth_logout" => Ok(Json(Value::Null)),
        "billing_checkout" | "billing_status" => {
            Err(ApiError { status: StatusCode::SERVICE_UNAVAILABLE, code: "billing-unavailable", message: "Paid plans need the external Tayang cloud API, which the self-hosted web edition doesn't bundle.".into() })
        }
        "cloud_usage" | "social_accounts" | "social_connect" | "social_disconnect" | "social_post" | "social_post_status" | "redeem_gift_code" => {
            Err(ApiError { status: StatusCode::SERVICE_UNAVAILABLE, code: "cloud-unavailable", message: "This optional feature needs the private Tayang cloud API. It is not available in the self-hosted web edition.".into() })
        }

        // ---- Claude Code account (server-side CLI; the browser gets the URL) ----
        "claude_account" => value(claude_account_impl(&state).await?),
        "claude_sign_in" => claude_sign_in(state.clone()).await,
        "claude_sign_in_cancel" => {
            if let Some(tx) = state.claude_sign_in.lock().map_err(|e| ApiError::internal(e.to_string()))?.take() {
                let _ = tx.send(());
            }
            Ok(Json(Value::Null))
        }
        "claude_sign_out" => {
            let dir = claude_config(&state);
            let claude = claude_program()?;
            let _ = state.usage.0.lock().map(|mut u| *u = None);
            value(tayang_core::claude_account::sign_out(&claude, &dir).await)
        }

        other => Err(ApiError {
            status: StatusCode::NOT_FOUND,
            code: "unknown-command",
            message: format!("Unknown command: {other}"),
        }),
    }
}

static THUMB_SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);

/// `/api/capabilities`: what this deployment can and cannot do. The UI uses this instead of
/// discovering failures feature by feature.
pub async fn capabilities(State(state): State<Arc<AppState>>) -> Json<Value> {
    let agents = tokio::task::spawn_blocking(tayang_core::system::detect_agents_standalone)
        .await
        .unwrap_or_default();
    let ffmpeg = tayang_core::system::Exec::which(&tayang_core::system::RealExec, "ffmpeg");
    let ffprobe = tayang_core::system::Exec::which(&tayang_core::system::RealExec, "ffprobe");
    let plugin = state
        .config
        .plugin_dir
        .as_ref()
        .map(|p| p.join(".claude-plugin/plugin.json").is_file())
        .unwrap_or(false);
    Json(json!({
        "edition": "web",
        "version": env!("CARGO_PKG_VERSION"),
        "agents": agents,
        "ffmpeg": ffmpeg.is_some(),
        "ffprobe": ffprobe.is_some(),
        "plugin": plugin,
        "cloud": {
            "signIn": false,
            "billing": false,
            "social": false,
            "aiAssets": false,
            "reason": "The optional Tayang cloud API is maintained separately and is not bundled with the self-hosted server."
        },
        "desktopOnly": {
            "folderPicker": false,
            "backgroundMode": false,
            "openAtLogin": false,
            "autoUpdate": false
        },
        "tts": {
            "enabled": state.config.tts_service_url.is_some(),
            "engines": ["pocket", "kokoro"],
            "default": crate::voices::read_default(&state)
        },
        "workspace": state.config.workspace_root.to_string_lossy(),
        "jobs": "server",
        "orchestration": "server"
    }))
}

pub async fn health(State(state): State<Arc<AppState>>) -> Json<Value> {
    let db_ok = state.db.list_projects().is_ok();
    let agents = tokio::task::spawn_blocking(tayang_core::system::detect_agents_standalone)
        .await
        .unwrap_or_default()
        .into_iter()
        .filter(|a| a.installed)
        .map(|a| a.id)
        .collect::<Vec<_>>();
    Json(json!({
        "status": if db_ok { "ok" } else { "degraded" },
        "version": env!("CARGO_PKG_VERSION"),
        "database": db_ok,
        "agents": agents,
        "uptimeSec": (Utc::now() - state.started_at).num_seconds(),
    }))
}

/// Programmatic shutdown hook used by tests and graceful shutdown.
pub async fn shutdown(state: Arc<AppState>) {
    // The browser sees streaming updates before SQLite does; flush them before the process exits.
    agent::persist_all(&state);
    agent::stop_all(&state).await;
    agent::persist_all(&state);
    web_db::mark_interrupted(&state.db, "Tayang was stopped while this was running");
    orchestrator::settle_late_renders(&state, Utc::now()).await;
}

#[allow(dead_code)]
fn _assert_job(j: &Job) -> (&Option<String>, &Option<String>) {
    (&j.project_id, &j.chat_id)
}

#[allow(dead_code)]
fn _assert_path(p: &Path) -> &Path {
    p
}
