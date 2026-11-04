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
            "apiUrl": crate::telemetry::default_api_url(),
            "installId": "",
            "shareInstallStats": true,
            "lastPingAt": null,
        })
    }

    /// The install id, made (uuid v4) and saved the first time it's asked for.
    pub fn ensure_install_id(&self, home: &Path) -> Result<String> {
        let current = self.get_settings(home).install_id;
        if !current.is_empty() {
            return Ok(current);
        }
        let id = uuid::Uuid::new_v4().to_string();
        self.update_settings(json!({ "installId": id }))?;
        Ok(id)
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

    /// Merges `patch` over the current settings, validates, and persists only the patched
    /// keys, so unset keys (like the home-based working folder) keep following their defaults.
    /// The returned value uses the home from the last `get_settings` call for unset defaults.
    pub fn update_settings(&self, patch: Value) -> Result<Settings> {
        if !patch.is_object() {
            return Err(DbError("settings patch must be a JSON object".into()));
        }
        let home = self.home.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let mut merged = self.settings_value(&home)?;
        merge_patch(&mut merged, &patch);
        let settings: Settings = serde_json::from_value(merged)?;
        let full = serde_json::to_value(&settings)?;
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        for k in patch.as_object().into_iter().flat_map(|o| o.keys()) {
            let Some(v) = full.get(k) else { continue };
            tx.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2) \
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![k, v.to_string()],
            )?;
        }
        tx.commit()?;
        Ok(settings)
    }

    // ---- projects ----

    pub fn list_projects(&self) -> Result<Vec<Project>> {
        let sql = format!("{PROJECT_SELECT} ORDER BY updated_at DESC, rowid DESC");
        query_as(&self.conn(), &sql, &[])
    }

    pub fn insert_project(&self, p: &Project) -> Result<()> {
        let vals = bind_values(p, &PROJECT_KEYS)?;
        self.conn().execute(
            "INSERT INTO projects (id, title, slug, folder, kind, format, language, status, \
             style_id, scheduled_at, duration_sec, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            params_from_iter(vals),
        )?;
        Ok(())
    }

    pub fn get_project(&self, id: &str) -> Result<Option<Project>> {
        let sql = format!("{PROJECT_SELECT} WHERE id = ?1");
        Ok(query_as::<Project>(&self.conn(), &sql, &[&id])?.into_iter().next())
    }

    /// Shallow-merges `patch` over the stored project. `id` cannot change; `updatedAt`
    /// is bumped unless the patch sets it.
    pub fn update_project(&self, id: &str, patch: Value) -> Result<Project> {
        if let Some(new_id) = patch.get("id") {
            if new_id != &json!(id) {
                return Err(DbError("project id cannot be changed".into()));
            }
        }
        let current = self
            .get_project(id)?
            .ok_or_else(|| DbError(format!("project not found: {id}")))?;
        let mut merged = serde_json::to_value(&current)?;
        if patch.get("updatedAt").is_none() {
            merged["updatedAt"] = json!(now());
        }
        merge_patch(&mut merged, &patch);
        let updated: Project = serde_json::from_value(merged)?;
        let mut vals = bind_values(&updated, &PROJECT_KEYS)?;
        let id_val = vals.remove(0);
        vals.push(id_val);
        self.conn().execute(
            "UPDATE projects SET title=?1, slug=?2, folder=?3, kind=?4, format=?5, language=?6, \
             status=?7, style_id=?8, scheduled_at=?9, duration_sec=?10, created_at=?11, \
             updated_at=?12 WHERE id=?13",
            params_from_iter(vals),
        )?;
        Ok(updated)
    }

    // ---- chats and messages ----

    pub fn create_chat(&self, project_id: Option<&str>, agent: AgentId, title: &str) -> Result<Chat> {
        let chat = Chat {
            id: new_id(),
            project_id: project_id.map(str::to_string),
            agent_id: agent,
            title: title.to_string(),
            created_at: now(),
        };
        let vals = bind_values(&chat, &["id", "projectId", "agentId", "title", "createdAt"])?;
        self.conn().execute(
            "INSERT INTO chats (id, project_id, agent_id, title, created_at) VALUES (?1,?2,?3,?4,?5)",
            params_from_iter(vals),
        )?;
        Ok(chat)
    }

    /// `Some(id)` lists that project's chats; `None` lists chats not tied to a project.
    pub fn list_chats(&self, project_id: Option<&str>) -> Result<Vec<Chat>> {
        let conn = self.conn();
        match project_id {
            Some(p) => query_as(
                &conn,
                &format!("{CHAT_SELECT} WHERE project_id = ?1 ORDER BY created_at DESC, rowid DESC"),
                &[&p],
            ),
            None => query_as(
                &conn,
                &format!("{CHAT_SELECT} WHERE project_id IS NULL ORDER BY created_at DESC, rowid DESC"),
                &[],
            ),
        }
    }

    pub fn get_chat(&self, id: &str) -> Result<Option<Chat>> {
        let sql = format!("{CHAT_SELECT} WHERE id = ?1");
        Ok(query_as::<Chat>(&self.conn(), &sql, &[&id])?.into_iter().next())
    }

    pub fn add_message(
        &self,
        chat_id: &str,
        role: MessageRole,
        parts: &[MessagePart],
    ) -> Result<ChatMessage> {
        let msg = ChatMessage {
            id: new_id(),
            chat_id: chat_id.to_string(),
            role,
            parts: parts.to_vec(),
            created_at: now(),
        };
        let role_s = serde_json::to_value(role)?;
        self.conn().execute(
            "INSERT INTO messages (id, chat_id, role, parts, created_at) VALUES (?1,?2,?3,?4,?5)",
            rusqlite::params![
                msg.id,
                msg.chat_id,
                role_s.as_str().unwrap_or_default(),
                serde_json::to_string(&msg.parts)?,
                msg.created_at
            ],
        )?;
        Ok(msg)
    }

    pub fn list_messages(&self, chat_id: &str) -> Result<Vec<ChatMessage>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, chat_id AS chatId, role, parts, created_at AS createdAt \
             FROM messages WHERE chat_id = ?1 ORDER BY rowid",
        )?;
        let rows = stmt.query_map([chat_id], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "chatId": r.get::<_, String>(1)?,
                "role": r.get::<_, String>(2)?,
                "parts": r.get::<_, String>(3)?,
                "createdAt": r.get::<_, String>(4)?,
            }))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let mut v = row?;
            let parts: Value = serde_json::from_str(v["parts"].as_str().unwrap_or("[]"))?;
            v["parts"] = parts;
            out.push(serde_json::from_value(v)?);
        }
        Ok(out)
    }

    // ---- styles ----

    fn seed_styles(&self) -> Result<()> {
        let conn = self.conn();
        for s in builtin_styles() {
            conn.execute(
                "INSERT OR IGNORE INTO styles (id, name, source, source_url, notes, prompt, created_at) \
                 VALUES (?1,?2,'builtin',NULL,?3,?4,?5)",
                rusqlite::params![s.id, s.name, serde_json::to_string(&s.notes)?, s.prompt, s.created_at],
            )?;
        }
        Ok(())
    }

    pub fn list_styles(&self) -> Result<Vec<Style>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, name, source, source_url AS sourceUrl, notes, prompt, created_at AS createdAt \
             FROM styles ORDER BY created_at, rowid",
        )?;
        let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let rows = stmt.query_map([], |row| {
            let mut obj = Map::new();
            for (i, n) in names.iter().enumerate() {
                obj.insert(n.clone(), json_from_ref(row.get_ref(i)?));
            }
            Ok(Value::Object(obj))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let mut v = row?;
            let notes: Value = serde_json::from_str(v["notes"].as_str().unwrap_or("{}"))?;
            v["notes"] = notes;
            out.push(serde_json::from_value(v)?);
        }
        Ok(out)
    }

    /// Inserts or replaces a style. Built-in styles are read-only.
    pub fn save_style(&self, s: &Style) -> Result<()> {
        let conn = self.conn();
        if Self::is_builtin(&conn, &s.id)? || s.source == StyleSource::Builtin {
            return Err(DbError("built-in styles cannot be changed".into()));
        }
        let source = serde_json::to_value(s.source)?;
        conn.execute(
            "INSERT INTO styles (id, name, source, source_url, notes, prompt, created_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(id) DO UPDATE SET name=excluded.name, \
             source=excluded.source, source_url=excluded.source_url, notes=excluded.notes, \
             prompt=excluded.prompt, created_at=excluded.created_at",
            rusqlite::params![
                s.id,
                s.name,
                source.as_str().unwrap_or_default(),
                s.source_url,
                serde_json::to_string(&s.notes)?,
                s.prompt,
                s.created_at
            ],
        )?;
        Ok(())
    }

    pub fn delete_style(&self, id: &str) -> Result<()> {
        let conn = self.conn();
        if Self::is_builtin(&conn, id)? {
            return Err(DbError("built-in styles cannot be deleted".into()));
        }
        conn.execute("DELETE FROM styles WHERE id = ?1", [id])?;
        Ok(())
    }

    fn is_builtin(conn: &Connection, id: &str) -> Result<bool> {
        let source: Option<String> = conn
            .query_row("SELECT source FROM styles WHERE id = ?1", [id], |r| r.get(0))
            .optional()?;
        Ok(source.as_deref() == Some("builtin"))
    }

    // ---- jobs ----

    pub fn upsert_job(&self, j: &Job) -> Result<()> {
        let vals = bind_values(j, &JOB_KEYS)?;
        self.conn().execute(
            "INSERT INTO jobs (id, kind, title, project_id, chat_id, agent_id, status, progress, note, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, \
             title=excluded.title, project_id=excluded.project_id, chat_id=excluded.chat_id, \
             agent_id=excluded.agent_id, status=excluded.status, progress=excluded.progress, \
             note=excluded.note, updated_at=excluded.updated_at",
            params_from_iter(vals),
        )?;
        Ok(())
    }

    /// Marks jobs still `working` as failed with `note`: their agent died with the app.
    /// Returns how many changed.
    pub fn fail_stale_jobs(&self, note: &str) -> Result<usize> {
        Ok(self.conn().execute(
            "UPDATE jobs SET status = 'failed', note = ?1, updated_at = ?2 WHERE status = 'working'",
            rusqlite::params![note, now()],
        )?)
    }

    pub fn list_jobs(&self) -> Result<Vec<Job>> {
        let sql = format!("{JOB_SELECT} ORDER BY updated_at DESC, rowid DESC");
        query_as(&self.conn(), &sql, &[])
    }
}

/// Rust copy of `packages/skills/src/builtinStyles.ts`; keep the two in sync.
fn builtin_styles() -> Vec<Style> {
    use StyleAspect::*;
    let style = |id: &str, name: &str, notes: [(StyleAspect, &str); 5], prompt: &str| Style {
        id: id.into(),
        name: name.into(),
        source: StyleSource::Builtin,
        source_url: None,
        notes: notes.into_iter().map(|(a, t)| (a, t.to_string())).collect(),
        prompt: prompt.into(),
        created_at: "2026-11-04T00:00:00Z".into(),
    };
    vec![
        style(
            "builtin-bold-explainer",
            "Bold explainer",
            [
                (Camera, "Static frame, elements slide in from the bottom"),
                (Pacing, "New scene every 4–8s, words land on the voice"),
                (Type, "Heavy sans, one highlighted word per line"),
                (Color, "Navy, white, one yellow highlight"),
                (Captions, "Word by word, center low"),
            ],
            "Navy background, white heavy sans.\nHighlight one key word per line in yellow.\nAnimate elements up 24px with ease-out, 300ms.\nCaptions word by word, centered low.",
        ),
        style(
            "builtin-kinetic-quote",
            "Kinetic quote",
            [
                (Camera, "Slow push in, 100% to 106% over the clip"),
                (Pacing, "One word every 0.3s, hold 1s at the end"),
                (Type, "Huge sans, stacked words"),
                (Color, "Orange ground, ink text"),
                (Captions, "The words are the captions"),
            ],
            "One short line, stacked one word per row.\nEach word pops in at 0.3s intervals.\nSlow push in from 100% to 106%.\nHold the full line for 1s.",
        ),
        style(
            "builtin-news-recap",
            "News recap",
            [
                (Camera, "Static, lower third slides in"),
                (Pacing, "One story per 8s"),
                (Type, "Medium sans, numbered stories"),
                (Color, "Light paper, navy text, red tag"),
                (Captions, "Full line, bottom"),
            ],
            "Light background, navy text.\nNumber each story 1–3 with a small red tag.\nLower third slides in from the left, 250ms.\nOne story per 8 seconds.",
        ),
    ]
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
        assert!(db.update_settings(json!([1])).is_err());
        assert!(db.update_settings(json!("x")).is_err());
        assert_eq!(db.get_settings(&home).fps, 60);
    }

    #[test]
    fn update_settings_before_get_keeps_home_default() {
        let db = db();
        db.update_settings(json!({"fps": 24})).unwrap();
        let home = PathBuf::from("/home/u");
        let s = db.get_settings(&home);
        assert_eq!(s.fps, 24);
        assert_eq!(s.working_folder, home.join("Tayang").to_string_lossy());
        let other = PathBuf::from("/home/v");
        assert_eq!(db.get_settings(&other).working_folder, other.join("Tayang").to_string_lossy());
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
        assert_eq!(db.get_chat(&chat.id).unwrap(), Some(chat.clone()));
        assert_eq!(db.get_chat("nope").unwrap(), None);

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
        assert_eq!(
            styles[0].prompt,
            "Navy background, white heavy sans.\nHighlight one key word per line in yellow.\nAnimate elements up 24px with ease-out, 300ms.\nCaptions word by word, centered low."
        );
        assert_eq!(
            styles[0].notes[&StyleAspect::Pacing],
            "New scene every 4–8s, words land on the voice"
        );
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

    #[test]
    fn stale_working_jobs_fail_on_start() {
        let db = db();
        let job = |id: &str, status: JobStatus| Job {
            id: id.into(),
            kind: JobKind::Build,
            title: id.into(),
            project_id: None,
            chat_id: None,
            agent_id: AgentId::Claude,
            status,
            progress: None,
            note: None,
            updated_at: "2026-01-01T00:00:00Z".into(),
        };
        db.upsert_job(&job("w", JobStatus::Working)).unwrap();
        db.upsert_job(&job("d", JobStatus::Done)).unwrap();
        assert_eq!(db.fail_stale_jobs("closed").unwrap(), 1);
        let jobs = db.list_jobs().unwrap();
        let w = jobs.iter().find(|j| j.id == "w").unwrap();
        assert_eq!((w.status, w.note.as_deref()), (JobStatus::Failed, Some("closed")));
        assert_eq!(jobs.iter().find(|j| j.id == "d").unwrap().status, JobStatus::Done);
    }
}
