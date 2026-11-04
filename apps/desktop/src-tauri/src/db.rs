//! SQLite storage for settings, projects, chats, styles and jobs.

use crate::types::*;
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
pub type Result<T> = std::result::Result<T, DbError>;

pub struct Db {
    _conn: Mutex<()>,
}

#[allow(unused_variables)]
impl Db {
    pub fn open(path: &Path) -> Result<Db> { todo!() }
    pub fn open_in_memory() -> Result<Db> { todo!() }
    pub fn get_settings(&self, home: &Path) -> Settings { todo!() }
    pub fn update_settings(&self, patch: serde_json::Value) -> Result<Settings> { todo!() }
    pub fn list_projects(&self) -> Result<Vec<Project>> { todo!() }
    pub fn insert_project(&self, p: &Project) -> Result<()> { todo!() }
    pub fn update_project(&self, id: &str, patch: serde_json::Value) -> Result<Project> { todo!() }
    pub fn get_project(&self, id: &str) -> Result<Option<Project>> { todo!() }
    pub fn create_chat(&self, project_id: Option<&str>, agent: AgentId, title: &str) -> Result<Chat> { todo!() }
    pub fn list_chats(&self, project_id: Option<&str>) -> Result<Vec<Chat>> { todo!() }
    pub fn add_message(&self, chat_id: &str, role: MessageRole, parts: &[MessagePart]) -> Result<ChatMessage> { todo!() }
    pub fn list_messages(&self, chat_id: &str) -> Result<Vec<ChatMessage>> { todo!() }
    pub fn list_styles(&self) -> Result<Vec<Style>> { todo!() }
    pub fn save_style(&self, s: &Style) -> Result<()> { todo!() }
    pub fn delete_style(&self, id: &str) -> Result<()> { todo!() }
    pub fn upsert_job(&self, j: &Job) -> Result<()> { todo!() }
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
