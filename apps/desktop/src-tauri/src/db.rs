//! SQLite storage for settings, projects, chats, styles and jobs.

use crate::types::*;
use rusqlite::types::{Value as Sql, ValueRef};
use rusqlite::{params_from_iter, Connection, OptionalExtension};
use serde::de::DeserializeOwned;
use serde_json::{json, Map, Value};
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug)]
pub struct DbError(pub String);

impl std::fmt::Display for DbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for DbError {}

impl From<rusqlite::Error> for DbError {
    fn from(e: rusqlite::Error) -> Self {
        DbError(e.to_string())
    }
}
impl From<serde_json::Error> for DbError {
    fn from(e: serde_json::Error) -> Self {
        DbError(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, DbError>;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, slug TEXT NOT NULL, folder TEXT NOT NULL,
  kind TEXT NOT NULL, format TEXT NOT NULL, language TEXT NOT NULL, status TEXT NOT NULL,
  style_id TEXT, scheduled_at TEXT, duration_sec REAL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY, project_id TEXT, agent_id TEXT NOT NULL,
  title TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, role TEXT NOT NULL,
  parts TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat_id);
CREATE TABLE IF NOT EXISTS styles (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL, source_url TEXT,
  notes TEXT NOT NULL, prompt TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, project_id TEXT, chat_id TEXT,
  agent_id TEXT NOT NULL, status TEXT NOT NULL, progress REAL, note TEXT, updated_at TEXT NOT NULL
);
";

// Column lists use camelCase aliases so rows deserialize straight into the serde types.
const PROJECT_SELECT: &str = "SELECT id, title, slug, folder, kind, format, language, status, \
    style_id AS styleId, scheduled_at AS scheduledAt, duration_sec AS durationSec, \
    created_at AS createdAt, updated_at AS updatedAt FROM projects";
const PROJECT_KEYS: [&str; 13] = [
    "id", "title", "slug", "folder", "kind", "format", "language", "status", "styleId",
    "scheduledAt", "durationSec", "createdAt", "updatedAt",
];
const CHAT_SELECT: &str = "SELECT id, project_id AS projectId, agent_id AS agentId, title, \
    created_at AS createdAt FROM chats";
const JOB_SELECT: &str = "SELECT id, kind, title, project_id AS projectId, chat_id AS chatId, \
    agent_id AS agentId, status, progress, note, updated_at AS updatedAt FROM jobs";
const JOB_KEYS: [&str; 10] = [
    "id", "kind", "title", "projectId", "chatId", "agentId", "status", "progress", "note",
    "updatedAt",
];

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn sql_from_json(v: &Value) -> Sql {
    match v {
        Value::Null => Sql::Null,
        Value::Bool(b) => Sql::Integer(*b as i64),
        Value::Number(n) => match n.as_i64() {
            Some(i) => Sql::Integer(i),
            None => Sql::Real(n.as_f64().unwrap_or_default()),
        },
        Value::String(s) => Sql::Text(s.clone()),
        other => Sql::Text(other.to_string()),
    }
}

fn json_from_ref(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) => json!(f),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(_) => Value::Null,
    }
}

/// Serializes `item` and returns its values in `keys` order, ready to bind.
fn bind_values<T: serde::Serialize>(item: &T, keys: &[&str]) -> Result<Vec<Sql>> {
    let v = serde_json::to_value(item)?;
    Ok(keys.iter().map(|k| sql_from_json(v.get(*k).unwrap_or(&Value::Null))).collect())
}

fn query_as<T: DeserializeOwned>(
    conn: &Connection,
    sql: &str,
    args: &[&dyn rusqlite::ToSql],
) -> Result<Vec<T>> {
    let mut stmt = conn.prepare(sql)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt.query_map(args, |row| {
        let mut obj = Map::new();
        for (i, n) in names.iter().enumerate() {
            obj.insert(n.clone(), json_from_ref(row.get_ref(i)?));
        }
        Ok(Value::Object(obj))
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(serde_json::from_value(r?)?);
    }
    Ok(out)
}

fn merge_patch(target: &mut Value, patch: &Value) {
    if let (Value::Object(t), Value::Object(p)) = (target, patch) {
        for (k, v) in p {
            t.insert(k.clone(), v.clone());
        }
    }
}

pub struct Db {
    conn: Mutex<Connection>,
    home: Mutex<std::path::PathBuf>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Db> {
        Self::init(Connection::open(path)?)
    }

    pub fn open_in_memory() -> Result<Db> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Db> {
        conn.execute_batch(SCHEMA)?;
        let db = Db { conn: Mutex::new(conn), home: Mutex::new(Default::default()) };
        db.seed_styles()?;
        Ok(db)
    }

    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    // ---- settings ----

    fn default_settings(home: &Path) -> Value {
        json!({
            "workingFolder": home.join("Tayang").to_string_lossy(),
            "defaultAgent": "claude",
            "frameCheck": true,
            "language": "id",
            "format": "9:16",
            "fps": 30,
            "onboarded": false,
        })
    }

    fn settings_value(&self, home: &Path) -> Result<Value> {
        let mut v = Self::default_settings(home);
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        for row in rows {
            let (k, raw) = row?;
            if let (Ok(val), Some(obj)) = (serde_json::from_str::<Value>(&raw), v.as_object_mut()) {
                obj.insert(k, val);
            }
        }
        Ok(v)
    }

    /// Stored values over defaults; a stored value that no longer parses falls back to defaults.
    pub fn get_settings(&self, home: &Path) -> Settings {
        *self.home.lock().unwrap_or_else(|e| e.into_inner()) = home.to_path_buf();
        self.settings_value(home)
            .and_then(|v| Ok(serde_json::from_value(v)?))
            .unwrap_or_else(|_| {
                serde_json::from_value(Self::default_settings(home)).expect("valid defaults")
            })
    }

    /// Merges `patch` over the current settings, validates, and persists every key.
    /// Defaults use the home passed to the last `get_settings` call.
    pub fn update_settings(&self, patch: Value) -> Result<Settings> {
        let home = self.home.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let mut merged = self.settings_value(&home)?;
        merge_patch(&mut merged, &patch);
        let settings: Settings = serde_json::from_value(merged)?;
        let full = serde_json::to_value(&settings)?;
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        for (k, v) in full.as_object().into_iter().flatten() {
            tx.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2) \
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![k, v.to_string()],
            )?;
        }
        tx.commit()?;
        Ok(settings)
    }

    fn seed_styles(&self) -> Result<()> {
        Ok(())
    }

    // ---- projects, chats, messages, styles, jobs: implemented in later commits ----
    #[allow(unused_variables)]
    pub fn list_projects(&self) -> Result<Vec<Project>> { todo!() }
    #[allow(unused_variables)]
    pub fn insert_project(&self, p: &Project) -> Result<()> { todo!() }
    #[allow(unused_variables)]
    pub fn update_project(&self, id: &str, patch: Value) -> Result<Project> { todo!() }
    #[allow(unused_variables)]
    pub fn get_project(&self, id: &str) -> Result<Option<Project>> { todo!() }
    #[allow(unused_variables)]
    pub fn create_chat(&self, project_id: Option<&str>, agent: AgentId, title: &str) -> Result<Chat> { todo!() }
    #[allow(unused_variables)]
    pub fn list_chats(&self, project_id: Option<&str>) -> Result<Vec<Chat>> { todo!() }
    #[allow(unused_variables)]
    pub fn add_message(&self, chat_id: &str, role: MessageRole, parts: &[MessagePart]) -> Result<ChatMessage> { todo!() }
    #[allow(unused_variables)]
    pub fn list_messages(&self, chat_id: &str) -> Result<Vec<ChatMessage>> { todo!() }
    #[allow(unused_variables)]
    pub fn list_styles(&self) -> Result<Vec<Style>> { todo!() }
    #[allow(unused_variables)]
    pub fn save_style(&self, s: &Style) -> Result<()> { todo!() }
    #[allow(unused_variables)]
    pub fn delete_style(&self, id: &str) -> Result<()> { todo!() }
    #[allow(unused_variables)]
    pub fn upsert_job(&self, j: &Job) -> Result<()> { todo!() }
    #[allow(unused_variables)]
    pub fn list_jobs(&self) -> Result<Vec<Job>> { todo!() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;

    fn db() -> Db {
        Db::open_in_memory().unwrap()
    }

    fn project(id: &str, updated: &str) -> Project {
        Project {
            id: id.into(),
            title: format!("Title {id}"),
            slug: id.into(),
            folder: format!("/w/{id}"),
            kind: VideoKind::Promo,
            format: VideoFormat::Portrait,
            language: VideoLanguage::Id,
            status: ProjectStatus::Draft,
            style_id: None,
            scheduled_at: None,
            duration_sec: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: updated.into(),
        }
    }

    #[test]
    fn settings_defaults_and_update() {
        let db = db();
        let home = PathBuf::from("/home/u");
        let s = db.get_settings(&home);
        assert_eq!(s.working_folder, home.join("Tayang").to_string_lossy());
        assert_eq!(s.default_agent, AgentId::Claude);
        assert!(s.frame_check && !s.onboarded);
        assert_eq!((s.language, s.format, s.fps), (VideoLanguage::Id, VideoFormat::Portrait, 30));

        let u = db.update_settings(json!({"fps": 60, "onboarded": true, "defaultAgent": "gemini"})).unwrap();
        assert_eq!(u.fps, 60);
        let again = db.get_settings(&home);
        assert_eq!(again, u);
        assert!(again.onboarded);
        assert_eq!(again.default_agent, AgentId::Gemini);
        assert_eq!(again.working_folder, home.join("Tayang").to_string_lossy());
        assert!(db.update_settings(json!({"fps": "fast"})).is_err());
        assert_eq!(db.get_settings(&home).fps, 60);
    }

    #[test]
    fn project_insert_list_update() {
        let db = db();
        db.insert_project(&project("a", "2026-01-01T00:00:00Z")).unwrap();
        db.insert_project(&project("b", "2026-02-01T00:00:00Z")).unwrap();
        let ids: Vec<_> = db.list_projects().unwrap().into_iter().map(|p| p.id).collect();
        assert_eq!(ids, ["b", "a"]);
        assert_eq!(db.get_project("zzz").unwrap(), None);

        let up = db
            .update_project("a", json!({"title": "New", "status": "rendered", "durationSec": 12.5, "styleId": "builtin-news-recap"}))
            .unwrap();
        assert_eq!(up.title, "New");
        assert_eq!(up.status, ProjectStatus::Rendered);
        assert_eq!(up.duration_sec, Some(12.5));
        assert_eq!(db.get_project("a").unwrap().unwrap(), up);
        let ids: Vec<_> = db.list_projects().unwrap().into_iter().map(|p| p.id).collect();
        assert_eq!(ids, ["a", "b"]);

        assert!(db.update_project("a", json!({"id": "other"})).is_err());
        assert!(db.update_project("a", json!({"status": "bogus"})).is_err());
        assert!(db.update_project("missing", json!({"title": "x"})).is_err());
        assert_eq!(db.get_project("a").unwrap().unwrap().title, "New");
    }

    #[test]
    fn chat_and_messages_round_trip() {
        let db = db();
        db.insert_project(&project("a", "2026-01-01T00:00:00Z")).unwrap();
        let chat = db.create_chat(Some("a"), AgentId::Claude, "Fix intro").unwrap();
        let global = db.create_chat(None, AgentId::Codex, "General").unwrap();
        assert_eq!(db.list_chats(Some("a")).unwrap(), vec![chat.clone()]);
        assert_eq!(db.list_chats(None).unwrap(), vec![global]);

        let frame = MessagePart::Frame {
            project_id: "a".into(),
            frame: 42,
            time_sec: 1.4,
            image_path: "/x.png".into(),
            marks: vec![Mark { x: 0.5, y: 0.25 }],
        };
        let m1 = db.add_message(&chat.id, MessageRole::User, &[MessagePart::Text { text: "look".into() }, frame.clone()]).unwrap();
        let m2 = db.add_message(&chat.id, MessageRole::Agent, &[MessagePart::Text { text: "ok".into() }]).unwrap();
        let got = db.list_messages(&chat.id).unwrap();
        assert_eq!(got, vec![m1, m2]);
        assert_eq!(got[0].parts[1], frame);
    }

    #[test]
    fn builtin_styles_seeded_once_and_protected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tayang.db");
        drop(Db::open(&path).unwrap());
        let db = Db::open(&path).unwrap();
        let styles = db.list_styles().unwrap();
        assert_eq!(styles.len(), 3);
        let ids: Vec<_> = styles.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["builtin-bold-explainer", "builtin-kinetic-quote", "builtin-news-recap"]);
        assert_eq!(styles[0].name, "Bold explainer");
        assert_eq!(styles[1].created_at, "2026-11-04T00:00:00Z");
        assert!(db.delete_style("builtin-news-recap").is_err());
        assert_eq!(db.list_styles().unwrap().len(), 3);

        let mine = Style {
            id: "s1".into(),
            name: "Mine".into(),
            source: StyleSource::Mine,
            source_url: None,
            notes: [(StyleAspect::Camera, "static".to_string())].into(),
            prompt: "p".into(),
            created_at: "2026-11-05T00:00:00Z".into(),
        };
        db.save_style(&mine).unwrap();
        assert_eq!(db.list_styles().unwrap().len(), 4);
        db.delete_style("s1").unwrap();
        assert_eq!(db.list_styles().unwrap().len(), 3);
    }

    #[test]
    fn jobs_upsert_and_list() {
        let db = db();
        let mut j = Job {
            id: "j1".into(),
            kind: JobKind::Render,
            title: "Render".into(),
            project_id: None,
            chat_id: None,
            agent_id: AgentId::Claude,
            status: JobStatus::Queued,
            progress: None,
            note: None,
            updated_at: "2026-01-01T00:00:00Z".into(),
        };
        db.upsert_job(&j).unwrap();
        j.status = JobStatus::Working;
        j.progress = Some(0.5);
        j.updated_at = "2026-01-02T00:00:00Z".into();
        db.upsert_job(&j).unwrap();
        assert_eq!(db.list_jobs().unwrap(), vec![j]);
    }
}
