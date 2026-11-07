//! Tables the web server adds to the shared Tayang database. The desktop app ignores them.

use rusqlite::OptionalExtension;
use serde_json::Value;
use tayang_core::db::Db;

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS web_sessions (
  token_hash TEXT PRIMARY KEY,
  csrf TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS web_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS web_pending (
  request_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS web_pending_chat ON web_pending(chat_id, resolved_at);
CREATE TABLE IF NOT EXISTS web_turns (
  chat_id TEXT PRIMARY KEY,
  message_id TEXT,
  parts TEXT NOT NULL,
  streaming INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS web_claims (
  key TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  kind TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS web_events_created ON web_events(created_at);
";

pub fn init(db: &Db) -> Result<(), String> {
    db.with_conn(|conn| conn.execute_batch(SCHEMA)).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn insert_event(db: &Db, kind: &str, payload: &Value, at: &str) -> Result<i64, String> {
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO web_events (kind, payload, created_at) VALUES (?1,?2,?3)",
            rusqlite::params![kind, payload.to_string(), at],
        )?;
        Ok(conn.last_insert_rowid())
    })
    .map_err(|e| e.to_string())
}

pub fn events_since(db: &Db, last: i64, limit: usize) -> Result<Vec<(i64, String, Value)>, String> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, kind, payload FROM web_events WHERE id > ?1 ORDER BY id ASC LIMIT ?2",
        )?;
        let rows = stmt.query_map(rusqlite::params![last, limit as i64], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (id, kind, payload) = row?;
            if let Ok(v) = serde_json::from_str::<Value>(&payload) {
                out.push((id, kind, v));
            }
        }
        Ok(out)
    })
    .map_err(|e| e.to_string())
}

pub fn last_event_id(db: &Db) -> i64 {
    db.with_conn(|conn| {
        conn.query_row("SELECT COALESCE(MAX(id), 0) FROM web_events", [], |r| r.get::<_, i64>(0))
    })
    .unwrap_or(0)
}

pub fn prune_events(db: &Db, keep_days: i64) {
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(keep_days)).to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let _ = db.with_conn(|conn| {
        conn.execute("DELETE FROM web_events WHERE created_at < ?1", [&cutoff])?;
        // A hard cap too, so a chatty agent can't grow the file without bound.
        conn.execute(
            "DELETE FROM web_events WHERE id NOT IN (SELECT id FROM web_events ORDER BY id DESC LIMIT 50000)",
            [],
        )
    });
}

pub fn pending_put(db: &Db, request_id: &str, chat_id: &str, kind: &str, payload: &Value) -> Result<(), String> {
    let at = crate::auth::now_text();
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO web_pending (request_id, chat_id, kind, payload, created_at, resolved_at) \
             VALUES (?1,?2,?3,?4,?5,NULL) \
             ON CONFLICT(request_id) DO UPDATE SET payload = excluded.payload, resolved_at = NULL",
            rusqlite::params![request_id, chat_id, kind, payload.to_string(), at],
        )
    })
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn pending_resolve(db: &Db, request_id: &str) {
    let _ = db.with_conn(|conn| {
        conn.execute(
            "UPDATE web_pending SET resolved_at = ?2 WHERE request_id = ?1 AND resolved_at IS NULL",
            rusqlite::params![request_id, crate::auth::now_text()],
        )
    });
}

pub fn pending_for_chat(db: &Db, chat_id: &str) -> Vec<(String, String, Value)> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT kind, payload, request_id FROM web_pending WHERE chat_id = ?1 AND resolved_at IS NULL ORDER BY created_at, rowid",
        )?;
        let rows = stmt.query_map([chat_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (kind, payload, id) = row?;
            if let Ok(v) = serde_json::from_str::<Value>(&payload) {
                out.push((kind, id, v));
            }
        }
        Ok(out)
    })
    .unwrap_or_default()
}

pub fn resolve_all_for_chat(db: &Db, chat_id: &str) {
    let _ = db.with_conn(|conn| {
        conn.execute(
            "UPDATE web_pending SET resolved_at = ?2 WHERE chat_id = ?1 AND resolved_at IS NULL",
            rusqlite::params![chat_id, crate::auth::now_text()],
        )
    });
}

/// The in-progress assistant turn, read after a reconnect. `None` when nothing is running.
#[allow(dead_code)]
pub struct SavedTurn {
    pub message_id: Option<String>,
    pub parts: Vec<tayang_core::types::MessagePart>,
    pub streaming: bool,
}

pub fn save_turn(
    db: &Db,
    chat_id: &str,
    message_id: Option<&str>,
    parts: &[tayang_core::types::MessagePart],
    streaming: bool,
    started_at: &str,
) -> Result<(), String> {
    let at = crate::auth::now_text();
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO web_turns (chat_id, message_id, parts, streaming, started_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6) \
             ON CONFLICT(chat_id) DO UPDATE SET message_id=excluded.message_id, parts=excluded.parts, \
               streaming=excluded.streaming, updated_at=excluded.updated_at",
            rusqlite::params![chat_id, message_id, serde_json::to_string(parts).unwrap_or_else(|_| "[]".into()), streaming as i32, started_at, at],
        )
    })
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[allow(dead_code)]
pub fn load_turn(db: &Db, chat_id: &str) -> Option<SavedTurn> {
    db.with_conn(|conn| {
        conn.query_row(
            "SELECT message_id, parts, streaming FROM web_turns WHERE chat_id = ?1",
            [chat_id],
            |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()
    })
    .ok()
    .flatten()
    .and_then(|(message_id, parts, streaming)| {
        let parts = serde_json::from_str(&parts).ok()?;
        Some(SavedTurn { message_id, parts, streaming: streaming != 0 })
    })
}

#[allow(dead_code)]
pub fn clear_turn(db: &Db, chat_id: &str) {
    let _ = db.with_conn(|conn| conn.execute("DELETE FROM web_turns WHERE chat_id = ?1", [chat_id]));
}

/// Atomically claims a slot for production. Returns true for exactly one caller.
pub fn claim_slot(db: &Db, slot_id: &str, owner: &str) -> bool {
    let at = crate::auth::now_text();
    let expires = (chrono::Utc::now() + chrono::Duration::hours(24)).to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO web_claims (key, owner, kind, claimed_at, expires_at) VALUES (?1,?2,'slot',?3,?4) \
             ON CONFLICT(key) DO UPDATE SET owner=excluded.owner, claimed_at=excluded.claimed_at, expires_at=excluded.expires_at \
             WHERE web_claims.expires_at < ?3",
            rusqlite::params![format!("slot:{slot_id}"), owner, at, expires],
        )
    })
    .unwrap_or(0)
        > 0
}

pub fn release_claim(db: &Db, key: &str) {
    let _ = db.with_conn(|conn| conn.execute("DELETE FROM web_claims WHERE key = ?1", [key]));
}

pub fn mark_interrupted(db: &Db, note: &str) {
    let now = crate::auth::now_text();
    // No agent survives a server restart: pending cards would wait forever.
    let _ = db.with_conn(|conn| {
        conn.execute("UPDATE web_pending SET resolved_at = ?1 WHERE resolved_at IS NULL", [&now])?;
        conn.execute("UPDATE web_turns SET streaming = 0", [])?;
        conn.execute("DELETE FROM web_claims", [])
    });
    // Autopilot slots were running when the process died.
    let slots = db.list_slots("1970-01-01T00:00:00Z", "9999-12-31T23:59:59Z").unwrap_or_default();
    for slot in slots.into_iter().filter(|s| s.status == tayang_core::types::SlotStatus::Making) {
        let _ = db.update_slot(&slot.id, serde_json::json!({ "status": "failed", "error": note }));
        if let Some(project_id) = slot.project_id {
            if let Ok(chats) = db.list_chats(Some(&project_id)) {
                for chat in chats {
                    let job_id = format!("build-{}", chat.id);
                    if let Ok(Some(mut job)) = db.list_jobs().map(|all| all.into_iter().find(|j| j.id == job_id)) {
                        job.status = tayang_core::types::JobStatus::Failed;
                        job.note = Some(note.to_string());
                        job.updated_at = now.clone();
                        let _ = db.upsert_job(&job);
                    }
                }
            }
        }
    }
    let _ = db.fail_stale_jobs(note);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn events_replay_after_a_last_id_and_keep_order() {
        let tmp = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(tmp.path());
        let a = insert_event(&state.db, "agent://update", &json!({"n": 1}), &crate::auth::now_text()).unwrap();
        let b = insert_event(&state.db, "agent://update", &json!({"n": 2}), &crate::auth::now_text()).unwrap();
        let replay = events_since(&state.db, a, 10).unwrap();
        assert_eq!(replay.len(), 1);
        assert_eq!(replay[0].0, b);
        assert_eq!(replay[0].2["n"], 2);
        assert!(events_since(&state.db, b, 10).unwrap().is_empty());
    }

    #[test]
    fn pending_permission_cards_survive_until_resolved() {
        let tmp = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(tmp.path());
        pending_put(&state.db, "r1", "c1", "permission", &json!({"requestId":"r1","chatId":"c1"})).unwrap();
        pending_put(&state.db, "r2", "c1", "question", &json!({"requestId":"r2","chatId":"c1"})).unwrap();
        let list = pending_for_chat(&state.db, "c1");
        assert_eq!(list.len(), 2);
        pending_resolve(&state.db, "r1");
        let list = pending_for_chat(&state.db, "c1");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].1, "r2");
        resolve_all_for_chat(&state.db, "c1");
        assert!(pending_for_chat(&state.db, "c1").is_empty());
    }

    #[test]
    fn a_slot_claim_has_exactly_one_winner() {
        let tmp = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(tmp.path());
        assert!(claim_slot(&state.db, "slot-1", "engine-a"));
        assert!(!claim_slot(&state.db, "slot-1", "engine-b"));
        release_claim(&state.db, "slot:slot-1");
        assert!(claim_slot(&state.db, "slot-1", "engine-b"));
    }

    #[test]
    fn a_saved_turn_reloads_with_its_parts() {
        let tmp = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(tmp.path());
        let parts = vec![tayang_core::types::MessagePart::Text { text: "hi".into() }];
        save_turn(&state.db, "c1", Some("m1"), &parts, true, "2026-01-01T00:00:00Z").unwrap();
        let turn = load_turn(&state.db, "c1").unwrap();
        assert!(turn.streaming);
        assert_eq!(turn.message_id.as_deref(), Some("m1"));
        assert_eq!(turn.parts, parts);
        clear_turn(&state.db, "c1");
        assert!(load_turn(&state.db, "c1").is_none());
    }
}

#[cfg(test)]
mod interrupted_tests {
    use super::*;
    use tayang_core::types::*;

    #[test]
    fn a_restart_marks_in_flight_work_instead_of_resuming_it() {
        let tmp = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(tmp.path());
        state
            .db
            .save_style(&Style {
                id: "s".into(),
                name: "S".into(),
                source: StyleSource::Mine,
                source_url: None,
                notes: Default::default(),
                prompt: "p".into(),
                created_at: "t".into(),
                engine: None,
                preview_url: None,
                preview_video_url: None,
                based_on: None,
                template: None,
                version: None,
                build: None,
                palette: vec![],
                references: vec![],
            })
            .unwrap();
        let autopilot = state
            .db
            .save_autopilot(&AutopilotInput {
                id: None,
                name: "A".into(),
                niche: "N".into(),
                language: VideoLanguage::En,
                style_id: "s".into(),
                agent_id: AgentId::Opencode,
                frequency: AutopilotFrequency::Daily { times: vec!["09:00".into()] },
                length_sec: 30,
                review: false,
                posting: Posting::Manual,
            })
            .unwrap();
        let slot = state.db.upsert_slot(&autopilot.id, "2027-01-01T09:00:00Z").unwrap();
        state.db.update_slot(&slot.id, serde_json::json!({ "status": "making" })).unwrap();
        pending_put(&state.db, "r", "c1", "permission", &serde_json::json!({"requestId":"r"})).unwrap();
        save_turn(
            &state.db,
            "c1",
            Some("m1"),
            &[tayang_core::types::MessagePart::Text { text: "half".into() }],
            true,
            "2026-01-01T00:00:00Z",
        )
        .unwrap();

        mark_interrupted(&state.db, "Tayang server restarted while this was running");

        assert!(pending_for_chat(&state.db, "c1").is_empty());
        assert!(!load_turn(&state.db, "c1").unwrap().streaming);
        let after = state.db.get_slot(&slot.id).unwrap().unwrap();
        assert_eq!(after.status, SlotStatus::Failed);
        assert_eq!(after.error.as_deref(), Some("Tayang server restarted while this was running"));
    }
}
