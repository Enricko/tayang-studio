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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectStatus {
    Draft,
    Building,
    Rendered,
    Scheduled,
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
    /// (`styles_sync::effective_api_url`) without being stored. Empty turns online features off.
    pub api_url: String,
    /// Random uuid v4 made on first run (empty until then); never derived from the machine.
    pub install_id: String,
    /// Sends the anonymous daily install ping.
    pub share_install_stats: bool,
    /// RFC 3339 time of the last successful ping.
    pub last_ping_at: Option<String>,
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
