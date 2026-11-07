//! Persisted server-sent events. Every browser event has a database id, so a tab that reconnects
//! can replay what it missed (including permission cards) without duplicates.

use serde_json::Value;
use tayang_core::db::Db;
use tokio::sync::broadcast;

#[derive(Debug, Clone)]
pub struct StoredEvent {
    pub id: i64,
    pub kind: String,
    pub payload: Value,
}

#[derive(Clone)]
pub struct EventBus {
    tx: broadcast::Sender<StoredEvent>,
}

impl Default for EventBus {
    fn default() -> Self {
        let (tx, _) = broadcast::channel(2048);
        Self { tx }
    }
}

impl EventBus {
    pub fn emit(&self, db: &Db, kind: &str, payload: Value) -> i64 {
        let at = crate::auth::now_text();
        let id = crate::web_db::insert_event(db, kind, &payload, &at).unwrap_or(0);
        let _ = self.tx.send(StoredEvent { id, kind: kind.to_string(), payload });
        id
    }

    pub fn subscribe(&self) -> broadcast::Receiver<StoredEvent> {
        self.tx.subscribe()
    }
}
