//! Process-wide server state: one SQLite database, one ACP manager, one event bus.

use crate::agent::AgentHub;
use crate::auth::LoginLimiter;
use crate::config::Config;
use crate::events::EventBus;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tayang_core::acp::AcpManager;
use tayang_core::db::Db;
use tayang_core::media::MediaTools;
use tayang_core::usage::UsageCache;

/// One server-run autopilot slot, so "Stop now" can reach the chat whose turn is running.
pub struct AutopilotRun {
    pub slot_id: String,
    cancelled: AtomicBool,
    chat_id: Mutex<Option<String>>,
}

impl AutopilotRun {
    pub fn new(slot_id: &str) -> Arc<Self> {
        Arc::new(Self { slot_id: slot_id.to_string(), cancelled: AtomicBool::new(false), chat_id: Mutex::new(None) })
    }

    pub fn set_chat(&self, chat_id: &str) {
        *self.chat_id.lock().unwrap_or_else(|e| e.into_inner()) = Some(chat_id.to_string());
    }

    pub fn chat(&self) -> Option<String> {
        self.chat_id.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    pub fn check(&self) -> Result<(), String> {
        if self.is_cancelled() {
            Err("Stopped".into())
        } else {
            Ok(())
        }
    }
}

pub struct AppState {
    pub config: Config,
    pub db: Db,
    pub home: PathBuf,
    pub data_dir: PathBuf,
    pub acp: AcpManager,
    pub media: MediaTools,
    pub usage: UsageCache,
    pub events: EventBus,
    pub agent: AgentHub,
    pub login_limiter: LoginLimiter,
    pub render_locks: tokio::sync::Mutex<std::collections::HashSet<String>>,
    pub study_working: Mutex<HashMap<String, PathBuf>>,
    pub claude_sign_in: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    pub autopilot_lock: tokio::sync::Mutex<()>,
    pub autopilot_current: Mutex<Option<Arc<AutopilotRun>>>,
    pub action_proxy: Option<Arc<crate::action_proxy::ActionProxy>>,
    pub started_at: chrono::DateTime<chrono::Utc>,
}

impl AppState {
    pub fn working(&self) -> PathBuf {
        PathBuf::from(self.db.get_settings(&self.home).working_folder)
    }

    pub fn working_for_study(&self, study_id: &str) -> PathBuf {
        self.study_working
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(study_id)
            .cloned()
            .unwrap_or_else(|| self.working())
    }
}
