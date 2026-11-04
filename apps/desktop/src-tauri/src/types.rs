//! Serde mirrors of the TypeScript types in `packages/shared/src/types.ts`.
//! Field names are camelCase and string unions serialize to the exact TS literals.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentId {
    Claude,
    Opencode,
    Gemini,
    Codex,
    Custom,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: AgentId,
    pub name: String,
    pub installed: bool,
    pub version: Option<String>,
    pub acp_command: Vec<String>,
    pub recommended: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OsKind {
    Macos,
    Windows,
    Linux,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PackageManager {
    Brew,
    Winget,
    Apt,
    Dnf,
    Pacman,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub os: OsKind,
    pub os_version: String,
    pub package_manager: Option<PackageManager>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ToolId {
    #[serde(rename = "node")]
    Node,
    #[serde(rename = "ffmpeg")]
    Ffmpeg,
    #[serde(rename = "chrome")]
    Chrome,
    #[serde(rename = "ytdlp")]
    Ytdlp,
    #[serde(rename = "elevenlabs-mcp")]
    ElevenlabsMcp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub id: ToolId,
    pub name: String,
    pub required: bool,
    pub found: bool,
    pub version: Option<String>,
    pub ok: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VideoKind {
    Explainer,
    Promo,
    Quote,
    News,
    Tutorial,
    Data,
    Event,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VideoFormat {
    #[serde(rename = "9:16")]
    Portrait,
    #[serde(rename = "1:1")]
    Square,
    #[serde(rename = "16:9")]
    Landscape,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VideoLanguage {
    Id,
    En,
}

/// The language of Tayang's own interface, not of the videos it makes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UiLanguage {
    Id,
    En,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectStatus {
    Draft,
    Building,
    Rendered,
    Scheduled,
}

/// Whether a finished video still waits for the user's approval.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReviewState {
    #[default]
    None,
    Pending,
    Approved,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub title: String,
    pub slug: String,
    pub folder: String,
    pub kind: VideoKind,
    pub format: VideoFormat,
    pub language: VideoLanguage,
    pub status: ProjectStatus,
    pub style_id: Option<String>,
    pub scheduled_at: Option<String>,
    #[serde(default)]
    pub review_state: ReviewState,
    #[serde(default)]
    pub posted_at: Option<String>,
    #[serde(default)]
    pub reminded_at: Option<String>,
    /// When the "review before it's due" reminder was shown; separate from `reminded_at`.
    #[serde(default)]
    pub review_reminded_at: Option<String>,
    pub duration_sec: Option<f64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProject {
    pub title: String,
    pub kind: VideoKind,
    pub format: VideoFormat,
    pub language: VideoLanguage,
    #[serde(default)]
    pub style_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chat {
    pub id: String,
    pub project_id: Option<String>,
    pub agent_id: AgentId,
    pub title: String,
    pub created_at: String,
}

/// Relative position, 0-1.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Mark {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolCallStatus {
    Pending,
    Running,
    Done,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum MessagePart {
    Text {
        text: String,
    },
    Mention {
        project_id: String,
        title: String,
    },
    File {
        path: String,
        name: String,
        mime: String,
        size: u64,
    },
    Frame {
        project_id: String,
        frame: u32,
        time_sec: f64,
        image_path: String,
        marks: Vec<Mark>,
    },
    Tool {
        tool_call_id: String,
        title: String,
        status: ToolCallStatus,
        /// The ACP tool kind (`read`, `edit`, `execute` ...), when the agent said.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tool_kind: Option<String>,
        /// The first file the tool touches.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        path: Option<String>,
    },
    Thought {
        text: String,
    },
    A2ui {
        surface_id: String,
        messages: Vec<serde_json::Value>,
    },
    #[serde(rename = "a2ui-action")]
    A2uiAction {
        summary: String,
        action: serde_json::Value,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Agent,
    System,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub chat_id: String,
    pub role: MessageRole,
    pub parts: Vec<MessagePart>,
    pub created_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StyleAspect {
    Camera,
    Pacing,
    Type,
    Color,
    Captions,
    Transitions,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StyleSource {
    Builtin,
    Copied,
    Mine,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Style {
    pub id: String,
    pub name: String,
    pub source: StyleSource,
    pub source_url: Option<String>,
    /// Partial record: only aspects with notes are present.
    pub notes: BTreeMap<StyleAspect, String>,
    pub prompt: String,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub engine: Option<StyleEngine>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_video_url: Option<String>,
    /// The built-in style this one was cloned from; its template is downloaded under that id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub based_on: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<StyleTemplate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StyleEngine {
    Hyperframes,
    Remotion,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleTemplate {
    pub sha256: String,
    pub size: u64,
    pub version: u32,
}

/// Result of `sync_styles`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StylesSync {
    pub styles: Vec<Style>,
    pub offline: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub installed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum JobKind {
    Build,
    Render,
    Install,
    StudyStyle,
    Script,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum JobStatus {
    Queued,
    Working,
    NeedsYou,
    Done,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub kind: JobKind,
    pub title: String,
    pub project_id: Option<String>,
    pub chat_id: Option<String>,
    pub agent_id: AgentId,
    pub status: JobStatus,
    pub progress: Option<f64>,
    pub note: Option<String>,
    /// The link a style study was reading, so a failed study can be tried again.
    #[serde(default)]
    pub source_url: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub working_folder: String,
    pub default_agent: AgentId,
    pub frame_check: bool,
    pub language: VideoLanguage,
    pub format: VideoFormat,
    pub fps: u32,
    pub onboarded: bool,
    /// Base URL of the optional Tayang API; `TAYANG_API_URL` overrides it at read time
    /// (`styles_sync::effective_api_url`) without being stored. The Settings screen saves an
    /// empty field as the default URL.
    pub api_url: String,
    /// Random uuid v4 made on first run (empty until then); never derived from the machine.
    pub install_id: String,
    /// Sends the anonymous daily install ping.
    pub share_install_stats: bool,
    /// RFC 3339 time of the last successful ping.
    pub last_ping_at: Option<String>,
    /// Chats start in auto mode: the agent runs commands without asking.
    #[serde(default)]
    pub auto_mode: bool,
    /// Language of the interface. `None` until the first run, when the UI picks one from the
    /// system language and saves it.
    #[serde(default)]
    pub ui_language: Option<UiLanguage>,
    /// Closing the window hides it to the tray instead of quitting.
    #[serde(default)]
    pub background_mode: bool,
    /// Start Tayang when the user logs in; only meaningful while `background_mode` is on.
    #[serde(default)]
    pub open_at_login: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum AgentUpdate {
    Text {
        text: String,
    },
    Thought {
        text: String,
    },
    Tool {
        tool_call_id: String,
        title: String,
        status: ToolCallStatus,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tool_kind: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        path: Option<String>,
    },
    Done {
        stop_reason: String,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PermissionOptionKind {
    AllowOnce,
    AllowAlways,
    RejectOnce,
    RejectAlways,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PermissionOption {
    pub id: String,
    pub label: String,
    pub kind: PermissionOptionKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequest {
    pub chat_id: String,
    pub request_id: String,
    pub title: String,
    pub commands: Vec<String>,
    pub options: Vec<PermissionOption>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub duration_sec: f64,
    pub fps: f64,
    pub frames: u64,
    pub width: u32,
    pub height: u32,
}

// ---- autopilot ----

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum AutopilotFrequency {
    /// `times` are "HH:MM" in local time, 1 to 6 of them.
    Daily { times: Vec<String> },
    /// `days` are 0 (Sunday) to 6 (Saturday).
    Weekly { days: Vec<u8>, time: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AutopilotStatus {
    Active,
    Paused,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Posting {
    Manual,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Autopilot {
    pub id: String,
    pub name: String,
    pub niche: String,
    pub language: VideoLanguage,
    pub style_id: String,
    pub agent_id: AgentId,
    pub frequency: AutopilotFrequency,
    pub length_sec: u32,
    pub review: bool,
    pub posting: Posting,
    pub status: AutopilotStatus,
    pub created_at: String,
    pub updated_at: String,
}

/// What the UI sends to create (no id) or edit (with id) an autopilot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutopilotInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub niche: String,
    pub language: VideoLanguage,
    pub style_id: String,
    pub agent_id: AgentId,
    pub frequency: AutopilotFrequency,
    pub length_sec: u32,
    pub review: bool,
    pub posting: Posting,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SlotStatus {
    Planned,
    Making,
    Done,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutopilotSlot {
    pub id: String,
    pub autopilot_id: String,
    pub due_at: String,
    pub status: SlotStatus,
    pub project_id: Option<String>,
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn video_format_uses_ratio_literals() {
        assert_eq!(serde_json::to_value(VideoFormat::Portrait).unwrap(), json!("9:16"));
        let f: VideoFormat = serde_json::from_value(json!("16:9")).unwrap();
        assert_eq!(f, VideoFormat::Landscape);
    }

    #[test]
    fn tool_id_and_job_kind_literals() {
        assert_eq!(serde_json::to_value(ToolId::ElevenlabsMcp).unwrap(), json!("elevenlabs-mcp"));
        assert_eq!(serde_json::to_value(JobKind::StudyStyle).unwrap(), json!("study-style"));
        assert_eq!(serde_json::to_value(JobStatus::NeedsYou).unwrap(), json!("needs-you"));
    }

    #[test]
    fn message_part_frame_round_trips() {
        let v = json!({"type":"frame","projectId":"p1","frame":12,"timeSec":0.4,
            "imagePath":"/x.png","marks":[{"x":0.5,"y":0.25}]});
        let part: MessagePart = serde_json::from_value(v.clone()).unwrap();
        assert!(matches!(&part, MessagePart::Frame { frame: 12, .. }));
        assert_eq!(serde_json::to_value(&part).unwrap(), v);
    }

    #[test]
    fn message_part_a2ui_round_trips() {
        let v = json!({"type":"a2ui","surfaceId":"s","messages":[]});
        let part: MessagePart = serde_json::from_value(v.clone()).unwrap();
        assert!(matches!(&part, MessagePart::A2ui { surface_id, .. } if surface_id == "s"));
        assert_eq!(serde_json::to_value(&part).unwrap(), v);
        let v = json!({"type":"a2ui-action","summary":"Picked: A","action":{"version":"v0.9"}});
        let part: MessagePart = serde_json::from_value(v.clone()).unwrap();
        assert!(matches!(&part, MessagePart::A2uiAction { summary, .. } if summary == "Picked: A"));
        assert_eq!(serde_json::to_value(&part).unwrap(), v);
    }

    #[test]
    fn message_part_file_round_trips() {
        let v = json!({"type":"file","path":"/w/attachments/a.pdf","name":"a.pdf",
            "mime":"application/pdf","size":2048});
        let part: MessagePart = serde_json::from_value(v.clone()).unwrap();
        assert!(matches!(&part, MessagePart::File { size: 2048, .. }));
        assert_eq!(serde_json::to_value(&part).unwrap(), v);
    }

    #[test]
    fn agent_update_tool_round_trips() {
        let v = json!({"kind":"tool","toolCallId":"t1","title":"Run","status":"running"});
        let u: AgentUpdate = serde_json::from_value(v.clone()).unwrap();
        assert_eq!(serde_json::to_value(&u).unwrap(), v);
        let d = json!({"kind":"done","stopReason":"end_turn"});
        let u: AgentUpdate = serde_json::from_value(d.clone()).unwrap();
        assert_eq!(serde_json::to_value(&u).unwrap(), d);
    }

    #[test]
    fn tool_kind_and_path_are_optional_and_camel_case() {
        let v = json!({"kind":"tool","toolCallId":"t1","title":"Read","status":"done","toolKind":"read","path":"/a/b.ts"});
        let u: AgentUpdate = serde_json::from_value(v.clone()).unwrap();
        assert_eq!(serde_json::to_value(&u).unwrap(), v);
        let part = json!({"type":"tool","toolCallId":"t1","title":"Read","status":"done","toolKind":"read","path":"/a/b.ts"});
        let p: MessagePart = serde_json::from_value(part.clone()).unwrap();
        assert_eq!(serde_json::to_value(&p).unwrap(), part);
        let t = json!({"type":"thought","text":"hmm"});
        let p: MessagePart = serde_json::from_value(t.clone()).unwrap();
        assert_eq!(serde_json::to_value(&p).unwrap(), t);
    }

    #[test]
    fn style_notes_are_partial_and_new_project_style_optional() {
        let v = json!({"id":"s","name":"n","source":"builtin","sourceUrl":null,
            "notes":{"camera":"slow push"},"prompt":"p","createdAt":"t"});
        let s: Style = serde_json::from_value(v.clone()).unwrap();
        assert_eq!(serde_json::to_value(&s).unwrap(), v);
        let np: NewProject = serde_json::from_value(
            json!({"title":"t","kind":"promo","format":"1:1","language":"id"}),
        )
        .unwrap();
        assert_eq!(np.style_id, None);
    }

    #[test]
    fn autopilot_json_matches_the_typescript_shape() {
        let a: AutopilotInput = serde_json::from_value(json!({
            "name": "Kopi", "niche": "Coffee", "language": "id", "styleId": "s", "agentId": "claude",
            "frequency": {"kind": "weekly", "days": [1, 3], "time": "08:00"},
            "lengthSec": 30, "review": true, "posting": "manual"
        }))
        .unwrap();
        assert_eq!(a.id, None);
        assert_eq!(a.frequency, AutopilotFrequency::Weekly { days: vec![1, 3], time: "08:00".into() });
        let daily = serde_json::to_value(AutopilotFrequency::Daily { times: vec!["09:00".into()] }).unwrap();
        assert_eq!(daily, json!({"kind": "daily", "times": ["09:00"]}));
        let slot = AutopilotSlot {
            id: "i".into(),
            autopilot_id: "a".into(),
            due_at: "2026-11-05T09:00:00Z".into(),
            status: SlotStatus::Making,
            project_id: None,
            error: None,
        };
        assert_eq!(
            serde_json::to_value(slot).unwrap(),
            json!({"id": "i", "autopilotId": "a", "dueAt": "2026-11-05T09:00:00Z", "status": "making", "projectId": null, "error": null})
        );
        assert!(serde_json::from_value::<AutopilotInput>(json!({"posting": "automatic"})).is_err());
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub used_percent: f64,
    pub resets_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub label: String,
    pub window: UsageWindow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UsageStatus {
    Ok,
    SignedOut,
    Unavailable,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsage {
    pub agent_id: AgentId,
    pub status: UsageStatus,
    pub session: Option<UsageWindow>,
    pub weekly: Option<UsageWindow>,
    pub model_weekly: Option<ModelUsage>,
    pub updated_at: String,
    pub message: Option<String>,
}
