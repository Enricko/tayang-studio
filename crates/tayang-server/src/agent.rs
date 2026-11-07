//! Server-owned ACP sessions. The browser is only a viewer: an agent keeps running when every tab
//! closes, its assistant message is persisted as it streams, and permission/question cards survive a
//! reconnect until answered.

use crate::state::AppState;
use crate::web_db;
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, Weak};
use tayang_core::acp::{AcpSink, PromptPart};
use tayang_core::types::*;

struct LiveTurn {
    message_id: Option<String>,
    parts: Vec<MessagePart>,
    streaming: bool,
    started_at: String,
    image_since: DateTime<Utc>,
}

#[derive(Default)]
pub struct AgentHub {
    turns: Mutex<HashMap<String, LiveTurn>>,
    watchers: Mutex<HashMap<String, tokio::sync::broadcast::Sender<AgentUpdate>>>,
    start_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

fn agent_key(agent: AgentId) -> String {
    serde_json::to_value(agent).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default()
}

impl AgentHub {
    fn start_lock(&self, chat_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        self.start_locks
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entry(chat_id.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }

    pub fn subscribe(&self, chat_id: &str) -> tokio::sync::broadcast::Receiver<AgentUpdate> {
        let mut map = self.watchers.lock().unwrap_or_else(|e| e.into_inner());
        map.entry(chat_id.to_string())
            .or_insert_with(|| tokio::sync::broadcast::channel(512).0)
            .subscribe()
    }

    fn publish(&self, chat_id: &str, update: &AgentUpdate) {
        if let Some(tx) = self.watchers.lock().unwrap_or_else(|e| e.into_inner()).get(chat_id) {
            let _ = tx.send(update.clone());
        }
    }

    fn begin_turn(state: &AppState, chat_id: &str) -> Option<String> {
        let message = state
            .db
            .add_message(chat_id, MessageRole::Agent, &[])
            .ok()
            .map(|m| m.id);
        let turn = LiveTurn {
            message_id: message.clone(),
            parts: Vec::new(),
            streaming: true,
            started_at: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            image_since: Utc::now() - chrono::Duration::seconds(1),
        };
        state.agent.turns.lock().unwrap_or_else(|e| e.into_inner()).insert(chat_id.to_string(), turn);
        message
    }

    fn persist(state: &AppState, chat_id: &str) {
        let turns = state.agent.turns.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(t) = turns.get(chat_id) {
            if let Some(id) = &t.message_id {
                let _ = state.db.update_message_parts(id, &t.parts);
            }
            let _ = web_db::save_turn(&state.db, chat_id, t.message_id.as_deref(), &t.parts, t.streaming, &t.started_at);
        }
    }

    fn note_update(state: &AppState, chat_id: &str, update: AgentUpdate) {
        // Models are session metadata, not conversation.
        if matches!(&update, AgentUpdate::Models { .. }) {
            emit_update(state, chat_id, &update);
            return;
        }
        let terminal = matches!(&update, AgentUpdate::Done { .. } | AgentUpdate::Error { .. });
        {
            let mut turns = state.agent.turns.lock().unwrap_or_else(|e| e.into_inner());
            let stale = turns.get(chat_id).map(|t| !t.streaming).unwrap_or(true);
            if stale && !terminal {
                drop(turns);
                Self::begin_turn(state, chat_id);
                turns = state.agent.turns.lock().unwrap_or_else(|e| e.into_inner());
            }
            if let Some(turn) = turns.get_mut(chat_id) {
                if !terminal {
                    turn.streaming = true;
                }
                let is_text = matches!(&update, AgentUpdate::Text { .. });
                match update.clone() {
                    AgentUpdate::Text { text } | AgentUpdate::Thought { text } => {
                        let same = if is_text {
                            matches!(turn.parts.last(), Some(MessagePart::Text { .. }))
                        } else {
                            matches!(turn.parts.last(), Some(MessagePart::Thought { .. }))
                        };
                        if same {
                            match turn.parts.last_mut() {
                                Some(MessagePart::Text { text: last }) => last.push_str(&text),
                                Some(MessagePart::Thought { text: last }) => last.push_str(&text),
                                _ => {}
                            }
                        } else if is_text {
                            turn.parts.push(MessagePart::Text { text });
                        } else {
                            turn.parts.push(MessagePart::Thought { text });
                        }
                    }
                    AgentUpdate::Tool { tool_call_id, title, status, tool_kind, path } => {
                        let part = MessagePart::Tool { tool_call_id: tool_call_id.clone(), title, status, tool_kind, path };
                        if let Some(i) = turn.parts.iter().position(
                            |p| matches!(p, MessagePart::Tool { tool_call_id: id, .. } if *id == tool_call_id),
                        ) {
                            turn.parts[i] = part;
                        } else {
                            turn.parts.push(part);
                        }
                    }
                    AgentUpdate::Done { .. } => {
                        for p in &mut turn.parts {
                            if let MessagePart::Tool { status, .. } = p {
                                if matches!(status, ToolCallStatus::Pending | ToolCallStatus::Running) {
                                    *status = ToolCallStatus::Done;
                                }
                            }
                        }
                        turn.streaming = false;
                    }
                    AgentUpdate::Error { .. } => {
                        for p in &mut turn.parts {
                            if let MessagePart::Tool { status, .. } = p {
                                if matches!(status, ToolCallStatus::Pending | ToolCallStatus::Running) {
                                    *status = ToolCallStatus::Failed;
                                }
                            }
                        }
                        turn.streaming = false;
                    }
                    AgentUpdate::Models { .. } => {}
                }
            }
        }
        if terminal {
            // One last look for images the turn made, so a reopened chat has them too.
            if matches!(&update, AgentUpdate::Done { .. }) {
                Self::append_images(state, chat_id);
            }
            Self::persist(state, chat_id);
            web_db::resolve_all_for_chat(&state.db, chat_id);
            Self::finish_job(state, chat_id, &update);
        } else {
            Self::persist(state, chat_id);
        }
        emit_update(state, chat_id, &update);
        state.agent.publish(chat_id, &update);
    }

    /// Reconciles the build-job card even when the tab that started the turn is gone. The browser
    /// writes the same card while open; both paths converge on done/needs-you, never on a stale
    /// "working" card.
    fn finish_job(state: &AppState, chat_id: &str, update: &AgentUpdate) {
        let Some(chat) = state.db.get_chat(chat_id).ok().flatten() else { return };
        let Some(project_id) = chat.project_id.as_deref() else { return };
        let job_id = format!("build-{chat_id}");
        let Ok(Some(existing)) = state.db.list_jobs().map(|all| all.into_iter().find(|j| j.id == job_id)) else { return };
        if existing.status != JobStatus::Working {
            return;
        }
        let started = {
            let turns = state.agent.turns.lock().unwrap_or_else(|e| e.into_inner());
            turns.get(chat_id).map(|t| t.started_at.clone()).unwrap_or_else(crate::auth::now_text)
        };
        let mut job = existing.clone();
        job.updated_at = crate::auth::now_text();
        match update {
            AgentUpdate::Error { message } => {
                job.status = JobStatus::Failed;
                job.note = Some(message.clone());
            }
            AgentUpdate::Done { stop_reason } if stop_reason == "cancelled" => {
                job.status = JobStatus::Done;
                job.note = Some("Cancelled".into());
            }
            AgentUpdate::Done { .. } => {
                let render = crate::paths::project_folder(state, project_id)
                    .ok()
                    .and_then(|folder| tayang_core::media::latest_render_info(&folder))
                    .filter(|info| info.size > 0)
                    .filter(|info| {
                        chrono::DateTime::parse_from_rfc3339(&info.modified_at)
                            .map(|m| m.with_timezone(&Utc) >= chrono::DateTime::parse_from_rfc3339(&started).map(|s| s.with_timezone(&Utc)).unwrap_or(Utc::now()) - chrono::Duration::seconds(2))
                            .unwrap_or(false)
                    });
                if let Some(info) = render {
                    job.status = JobStatus::Done;
                    job.note = Some(info.name);
                    job.render_baseline_at = None;
                    let _ = state.db.update_project(project_id, json!({ "status": "rendered" }));
                } else {
                    job.status = JobStatus::NeedsYou;
                    job.note = Some("No video yet. The agent stopped before rendering".into());
                }
            }
            _ => return,
        }
        let _ = state.db.upsert_job(&job);
        state.events.emit(&state.db, "jobs://changed", json!({ "id": job_id }));
    }

    fn append_images(state: &AppState, chat_id: &str) {
        let Some(project_id) = state
            .db
            .get_chat(chat_id)
            .ok()
            .flatten()
            .and_then(|c| c.project_id)
        else {
            return;
        };
        let Some(project) = state.db.get_project(&project_id).ok().flatten() else { return };
        let since = {
            let turns = state.agent.turns.lock().unwrap_or_else(|e| e.into_inner());
            turns.get(chat_id).map(|t| t.image_since).unwrap_or_else(|| Utc::now() - chrono::Duration::seconds(1))
        };
        let folder = PathBuf::from(&project.folder);
        let found = tayang_core::media::recent_images(&folder, since, 50);
        if found.is_empty() {
            return;
        }
        let mut turns = state.agent.turns.lock().unwrap_or_else(|e| e.into_inner());
        let Some(turn) = turns.get_mut(chat_id) else { return };
        for f in found {
            let exists = turn.parts.iter().any(|p| matches!(p, MessagePart::File { path, .. } if path == &f.path));
            if exists {
                continue;
            }
            turn.parts.push(MessagePart::File {
                path: f.path.clone(),
                name: f.name.clone(),
                mime: tayang_core::service::mime_for(&f.name).to_string(),
                size: f.size,
                modified_at: Some(f.modified_at),
            });
        }
    }

    fn permission(state: &AppState, req: PermissionRequest) {
        if let Ok(v) = serde_json::to_value(&req) {
            let _ = web_db::pending_put(&state.db, &req.request_id, &req.chat_id, "permission", &v);
        }
        state.events.emit(&state.db, "agent://permission", serde_json::to_value(&req).unwrap_or(Value::Null));
    }

    fn question(state: &AppState, q: AgentQuestion) {
        if let Ok(v) = serde_json::to_value(&q) {
            let _ = web_db::pending_put(&state.db, &q.request_id, &q.chat_id, "question", &v);
        }
        state.events.emit(&state.db, "agent://question", serde_json::to_value(&q).unwrap_or(Value::Null));
    }

    pub fn resolve_permission(&self, state: &AppState, request_id: &str, option_id: Option<String>) -> Result<(), String> {
        state.acp.respond_permission(request_id, option_id).map_err(|e| e.to_string())?;
        web_db::pending_resolve(&state.db, request_id);
        state.events.emit(&state.db, "agent://permission-resolved", json!({ "requestId": request_id }));
        Ok(())
    }

    pub fn resolve_question(&self, state: &AppState, request_id: &str, response: Value) -> Result<(), String> {
        state.acp.respond_question(request_id, response).map_err(|e| e.to_string())?;
        web_db::pending_resolve(&state.db, request_id);
        state.events.emit(&state.db, "agent://question-resolved", json!({ "requestId": request_id }));
        Ok(())
    }
}

fn emit_update(state: &AppState, chat_id: &str, update: &AgentUpdate) {
    state.events.emit(
        &state.db,
        "agent://update",
        json!({ "chatId": chat_id, "update": update }),
    );
}

pub struct ServerSink {
    pub state: Weak<AppState>,
}

impl AcpSink for ServerSink {
    fn update(&self, chat_id: &str, u: AgentUpdate) {
        if let Some(state) = self.state.upgrade() {
            AgentHub::note_update(&state, chat_id, u);
        }
    }

    fn permission(&self, req: PermissionRequest) {
        if let Some(state) = self.state.upgrade() {
            AgentHub::permission(&state, req);
        }
    }

    fn question(&self, q: AgentQuestion) {
        if let Some(state) = self.state.upgrade() {
            AgentHub::question(&state, q);
        }
    }
}

// Runs a short hidden session to read the agent's models, like the desktop does before a chat starts.
struct QuietSink;
impl AcpSink for QuietSink {
    fn update(&self, _chat_id: &str, _u: AgentUpdate) {}
    fn permission(&self, _req: PermissionRequest) {}
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModels {
    pub current: Option<String>,
    pub options: Vec<ModelChoice>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveChat {
    pub streaming: bool,
    pub session_running: bool,
    pub turn_started_at: String,
    pub message: Option<ChatMessage>,
    pub permissions: Vec<PermissionRequest>,
    pub questions: Vec<AgentQuestion>,
}

pub async fn start(state: Arc<AppState>, chat_id: String, agent_id: AgentId, auto: Option<bool>) -> Result<bool, String> {
    let lock = state.agent.start_lock(&chat_id);
    let _guard = lock.lock().await;
    // Another tab already opened this chat's session: do not kill it and restart, which would settle
    // its first turn as cancelled.
    if state.acp.is_running(&chat_id) {
        return Ok(false);
    }
    let prepared = tayang_core::service::prepare_agent(
        &state.db,
        &state.home,
        &chat_id,
        agent_id,
        auto.unwrap_or(false),
        state.config.plugin_dir.as_deref(),
        &state.data_dir,
    )?;
    if !crate::paths::in_workspace(&state, &prepared.cwd) {
        return Err("The chat's working folder is outside the server workspace".into());
    }
    let sink = Arc::new(ServerSink { state: Arc::downgrade(&state) });
    state
        .acp
        .start_with(&chat_id, &prepared.command, &prepared.cwd, sink, prepared.options)
        .await
        .map_err(|e| e.to_string())?;
    Ok(prepared.skills_as_text)
}

pub async fn prompt(state: Arc<AppState>, chat_id: String, parts: Vec<MessagePart>) -> Result<(), String> {
    let settings = state.db.get_settings(&state.home);
    let working = PathBuf::from(&settings.working_folder);
    if parts.iter().any(|p| matches!(p, MessagePart::File { .. })) {
        let cwd = tayang_core::service::agent_cwd(&state.db, &working, &chat_id)?;
        tayang_core::service::check_file_parts(&cwd, &parts)?;
    }
    tayang_core::service::check_frame_images(&working, &parts, |id| {
        state.db.get_project(id).ok().flatten().map(|p| PathBuf::from(p.folder))
    })?;
    let prompt: Vec<PromptPart> = tayang_core::service::build_prompt(
        &parts,
        settings.fps,
        |id| state.db.get_project(id).ok().flatten(),
        tayang_core::service::read_brief,
    );
    // The first streamed update creates the live row. Starting it here would leave an empty
    // assistant message when the prompt call itself fails (for example, no agent is running).
    state.acp.prompt(&chat_id, prompt).await.map_err(|e| e.to_string())
}

pub async fn stop(state: Arc<AppState>, chat_id: String) -> Result<(), String> {
    let was_streaming = {
        let turns = state.agent.turns.lock().unwrap_or_else(|e| e.into_inner());
        turns.get(&chat_id).map(|t| t.streaming).unwrap_or(false)
    };
    let _ = state.acp.stop(&chat_id).await;
    web_db::resolve_all_for_chat(&state.db, &chat_id);
    if was_streaming {
        let update = AgentUpdate::Done { stop_reason: "cancelled".into() };
        AgentHub::note_update(&state, &chat_id, update);
    }
    Ok(())
}

pub async fn cancel(state: Arc<AppState>, chat_id: String) -> Result<(), String> {
    state.acp.cancel(&chat_id).await.map_err(|e| e.to_string())
}

pub async fn set_auto(state: Arc<AppState>, chat_id: String, on: bool) -> Result<(), String> {
    let on = tayang_core::service::wants_auto(&chat_id, on);
    state.acp.set_auto(&chat_id, on).await.map(|_| ()).map_err(|e| e.to_string())
}

pub async fn models(state: Arc<AppState>, agent_id: AgentId) -> Result<Option<AgentModels>, String> {
    let mut command = tayang_core::system::acp_command(agent_id).ok_or("This agent has no start command")?;
    let program = command[0].clone();
    let found = tayang_core::system::Exec::which(&tayang_core::system::RealExec, &program)
        .ok_or_else(|| format!("Can't find {program} on this computer or server"))?;
    command[0] = found.to_string_lossy().into_owned();
    let cwd = state.data_dir.join("model-probe").join(agent_key(agent_id));
    std::fs::create_dir_all(&cwd).map_err(|e| e.to_string())?;
    let probe = format!("models-{}", agent_key(agent_id));
    let options = tayang_core::service::session_options(agent_id, None, false, false, None, &state.home, std::env::var("XDG_DATA_HOME").ok().as_deref());
    state
        .acp
        .start_with(&probe, &command, &cwd, Arc::new(QuietSink), options)
        .await
        .map_err(|e| e.to_string())?;
    let found = state.acp.models(&probe).ok().flatten();
    let _ = state.acp.stop(&probe).await;
    Ok(found.map(|m| AgentModels { current: m.current, options: m.options }))
}

pub async fn set_model(state: &AppState, agent_id: AgentId, model: Option<String>, chat_id: Option<String>) -> Result<Settings, String> {
    let settings = state
        .db
        .update_settings(json!({ "agentModels": { agent_key(agent_id): model.clone() } }))
        .map_err(|e| e.to_string())?;
    if let (Some(chat), Some(value)) = (chat_id.as_deref(), model.as_deref()) {
        if state.acp.is_running(chat) {
            state.acp.set_model(chat, value).await.map_err(|e| e.to_string())?;
        }
    }
    Ok(settings)
}

pub fn live(state: &AppState, chat_id: &str) -> LiveChat {
    let turns = state.agent.turns.lock().unwrap_or_else(|e| e.into_inner());
    let turn = turns.get(chat_id);
    let streaming = turn.map(|t| t.streaming).unwrap_or(false);
    let message = turn.and_then(|t| {
        t.message_id.as_ref().map(|id| ChatMessage {
            id: id.clone(),
            chat_id: chat_id.to_string(),
            role: MessageRole::Agent,
            parts: t.parts.clone(),
            created_at: t.started_at.clone(),
        })
    });
    let turn_started_at = turn.map(|t| t.started_at.clone()).unwrap_or_default();
    drop(turns);
    let mut permissions = Vec::new();
    let mut questions = Vec::new();
    for (kind, _id, payload) in web_db::pending_for_chat(&state.db, chat_id) {
        if kind == "permission" {
            if let Ok(p) = serde_json::from_value::<PermissionRequest>(payload) {
                permissions.push(p);
            }
        } else if let Ok(q) = serde_json::from_value::<AgentQuestion>(payload) {
            questions.push(q);
        }
    }
    LiveChat { streaming, session_running: state.acp.is_running(chat_id), turn_started_at, message, permissions, questions }
}

pub async fn stop_all(state: &AppState) {
    state.acp.stop_all().await;
}
