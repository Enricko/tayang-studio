//! Backend operations shared by the desktop command layer and the headless web server.
//!
//! These are deliberately free of Tauri and of any HTTP types: callers supply paths (for the web server
//! they are confined to the configured workspace root) and a database handle.

use crate::acp::{AcpError, PromptPart, SessionOptions};
use crate::db::Db;
use crate::files;
use crate::media;
use crate::projects;
use crate::types::*;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub type Result<T> = std::result::Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub fn working(db: &Db, home: &Path) -> PathBuf {
    PathBuf::from(db.get_settings(home).working_folder)
}

// ---- projects ----

/// A new draft project: its own folder in `working` with the brief, and its row.
pub fn new_project(db: &Db, working: &Path, input: NewProject, brief: &str) -> Result<Project> {
    new_project_with(db, working, input, |dir| projects::write_project_brief(dir, brief))
}

fn new_project_with(
    db: &Db,
    working: &Path,
    input: NewProject,
    write_brief: impl FnOnce(&Path) -> std::io::Result<()>,
) -> Result<Project> {
    let slugs: Vec<String> = db.list_projects().map_err(err)?.into_iter().map(|p| p.slug).collect();
    let (slug, dir) = projects::create_project_folder(working, &input.title, &slugs)
        .map_err(|e| format!("Can't create the project folder: {e}"))?;
    if let Err(e) = write_brief(&dir) {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(format!("Can't write the project brief: {e}"));
    }
    let now = crate::db::now();
    let project = Project {
        id: uuid::Uuid::new_v4().to_string(),
        title: input.title,
        slug,
        folder: dir.to_string_lossy().into_owned(),
        kind: input.kind,
        format: input.format,
        language: input.language,
        status: ProjectStatus::Draft,
        style_id: input.style_id,
        scheduled_at: None,
        review_state: ReviewState::None,
        posted_at: None,
        reminded_at: None,
        review_reminded_at: None,
        social_post_id: None,
        duration_sec: None,
        created_at: now.clone(),
        updated_at: now,
    };
    if let Err(e) = db.insert_project(&project) {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(err(e));
    }
    Ok(project)
}

pub fn schedule_project(db: &Db, project_id: &str, at: Option<String>) -> Result<Project> {
    let at = at
        .map(|at| {
            chrono::DateTime::parse_from_rfc3339(&at)
                .map(|dt| dt.with_timezone(&chrono::Utc).to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
                .map_err(|_| format!("That date and time isn't valid: {at}"))
        })
        .transpose()?;
    db.update_project(
        project_id,
        serde_json::json!({ "scheduledAt": at, "remindedAt": null, "reviewRemindedAt": null }),
    )
    .map_err(err)
}

pub fn mark_posted(db: &Db, project_id: &str, posted: bool) -> Result<Project> {
    let at = posted.then(crate::db::now);
    db.update_project(project_id, serde_json::json!({ "postedAt": at })).map_err(err)
}

pub fn approve(db: &Db, project_id: &str) -> Result<Project> {
    db.update_project(project_id, serde_json::json!({ "reviewState": "approved" })).map_err(err)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchItem {
    pub project_id: Option<String>,
    pub at: String,
    pub draft: Option<BatchDraft>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BatchDraft {
    pub input: NewProject,
    pub brief: String,
}

const BATCH_MAX: usize = 20;

pub fn schedule_batch(db: &Db, working: &Path, items: Vec<BatchItem>, now: chrono::DateTime<chrono::Utc>) -> Result<Vec<Project>> {
    if items.is_empty() || items.len() > BATCH_MAX {
        return Err("schedule:count".into());
    }
    let mut checked = Vec::with_capacity(items.len());
    for (i, item) in items.iter().enumerate() {
        let n = i + 1;
        let at = chrono::DateTime::parse_from_rfc3339(&item.at)
            .map_err(|_| format!("schedule:badTime:{n}"))?
            .with_timezone(&chrono::Utc);
        if at <= now {
            return Err(format!("schedule:past:{n}"));
        }
        if at - now > chrono::Duration::days(365) {
            return Err(format!("schedule:tooFar:{n}"));
        }
        match (&item.project_id, &item.draft) {
            (Some(id), None) => {
                if db.get_project(id).map_err(err)?.is_none() {
                    return Err(format!("schedule:unknown:{n}"));
                }
                if items[..i].iter().any(|x| x.project_id.as_deref() == Some(id.as_str())) {
                    return Err(format!("schedule:twice:{n}"));
                }
            }
            (None, Some(d)) if !d.input.title.trim().is_empty() => {}
            _ => return Err(format!("schedule:badItem:{n}")),
        }
        checked.push(at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
    }

    let mut created: Vec<Project> = Vec::new();
    let mut moved: Vec<Project> = Vec::new();
    let undo = |created: &[Project], moved: &[Project]| {
        for p in created {
            let _ = db.delete_project(&p.id);
            let dir = Path::new(&p.folder);
            if dir.starts_with(working) && dir != working {
                let _ = std::fs::remove_dir_all(dir);
            }
        }
        for old in moved.iter().rev() {
            let _ = db.update_project(
                &old.id,
                serde_json::json!({
                    "scheduledAt": old.scheduled_at,
                    "remindedAt": old.reminded_at,
                    "reviewRemindedAt": old.review_reminded_at,
                    "updatedAt": old.updated_at,
                }),
            );
        }
    };
    let mut ids = Vec::with_capacity(items.len());
    for item in items {
        match (item.project_id, item.draft) {
            (Some(id), _) => ids.push(id),
            (None, Some(d)) => match new_project(db, working, d.input, &d.brief) {
                Ok(p) => {
                    ids.push(p.id.clone());
                    created.push(p);
                }
                Err(_) => {
                    undo(&created, &moved);
                    return Err("schedule:write".into());
                }
            },
            (None, None) => unreachable!("checked above"),
        }
    }
    let mut out = Vec::with_capacity(ids.len());
    for (id, at) in ids.iter().zip(checked) {
        let before = db.get_project(id).ok().flatten();
        match schedule_project(db, id, Some(at)) {
            Ok(p) => {
                if let Some(b) = before.filter(|b| !created.iter().any(|c| c.id == b.id)) {
                    moved.push(b);
                }
                out.push(p);
            }
            Err(_) => {
                undo(&created, &moved);
                return Err("schedule:write".into());
            }
        }
    }
    Ok(out)
}

// ---- agent working folders ----

/// A chat id that is safe to use as a single folder name.
pub fn safe_segment(s: &str) -> bool {
    !s.is_empty() && s != "." && s != ".." && !s.contains(['/', '\\'])
}

/// Where a chat's agent runs. Project chats use the project's recorded folder (as long as it exists);
/// every other chat runs inside a `.tayang/<purpose>` subfolder of the working folder.
pub fn resolve_cwd(working: &Path, chat_id: &str, project_folder: Option<&Path>) -> Result<PathBuf> {
    if let Some(folder) = project_folder {
        if !folder.is_dir() {
            return Err(format!("This project's folder is missing: {}", folder.display()));
        }
        return Ok(folder.to_path_buf());
    }
    let cwd = if chat_id == "setup" {
        working.join(".tayang").join("setup")
    } else if let Some(rest) = chat_id.strip_prefix("study-") {
        if !safe_segment(rest) {
            return Err("That chat isn't valid".into());
        }
        working.join(".tayang").join("style-study").join(rest)
    } else {
        if !safe_segment(chat_id) {
            return Err("That chat isn't valid".into());
        }
        working.join(".tayang").join("chats").join(chat_id)
    };
    std::fs::create_dir_all(working).map_err(|e| format!("Can't create the working folder: {e}"))?;
    if !projects::ensure_inside(working, &cwd) {
        return Err("The agent can only work inside your working folder".into());
    }
    std::fs::create_dir_all(&cwd).map_err(|e| format!("Can't create {}: {e}", cwd.display()))?;
    Ok(cwd)
}

pub fn project_folder_for_chat(db: &Db, chat_id: &str) -> Result<Option<PathBuf>> {
    let Some(project_id) = db.get_chat(chat_id).map_err(err)?.and_then(|c| c.project_id) else {
        return Ok(None);
    };
    let project = db
        .get_project(&project_id)
        .map_err(err)?
        .ok_or("This chat's project no longer exists")?;
    Ok(Some(PathBuf::from(project.folder)))
}

pub fn agent_cwd(db: &Db, working: &Path, chat_id: &str) -> Result<PathBuf> {
    resolve_cwd(working, chat_id, project_folder_for_chat(db, chat_id)?.as_deref())
}

// ---- prompts ----

pub const TAYANG_APPEND: &str = "You are running inside Tayang Studio, a desktop app for making motion videos. \
Follow the tayang-studio skill. When the user has to choose, ask with your AskUserQuestion tool: Tayang shows \
it as a card with the options. Never write JSON or markup for a choice.";

/// Internal sessions (setup installs, style studies and autopilot topic chats) get no skills.
pub fn wants_skills(chat_id: &str) -> bool {
    !(chat_id == "setup" || chat_id.starts_with("study-") || chat_id.starts_with("autopilot-"))
}

pub fn wants_auto(chat_id: &str, requested: bool) -> bool {
    if chat_id == "setup" {
        return false;
    }
    chat_id.starts_with("study-") || chat_id.starts_with("autopilot-") || requested
}

pub fn chat_kind(chat_id: &str, has_project: bool) -> &'static str {
    if chat_id == "setup" {
        "setup"
    } else if chat_id.starts_with("study-") {
        "study"
    } else if chat_id.starts_with("autopilot-") {
        "autopilot"
    } else if has_project {
        "project"
    } else {
        "chat"
    }
}

pub fn needs_skills_text(agent: AgentId, plugin: Option<&Path>) -> bool {
    agent == AgentId::Claude && plugin.is_none()
}

fn agent_key(agent: AgentId) -> String {
    serde_json::to_value(agent).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default()
}

pub fn picked_model(db: &Db, home: &Path, agent: AgentId) -> Option<String> {
    db.get_settings(home).agent_models.get(&agent_key(agent)).cloned()
}

/// Persists one agent's model choice without replacing the choices of the other agents.
/// `None` removes the choice so the agent uses its own default.
pub fn set_agent_model(db: &Db, home: &Path, agent: AgentId, model: Option<String>) -> Result<Settings> {
    let mut models = db.get_settings(home).agent_models;
    let key = agent_key(agent);
    match model {
        Some(value) => {
            models.insert(key, value);
        }
        None => {
            models.remove(&key);
        }
    }
    db.update_settings(serde_json::json!({ "agentModels": models })).map_err(err)
}

pub fn error_log(agent: AgentId, home: &Path, xdg_data_home: Option<&str>) -> Option<PathBuf> {
    if agent != AgentId::Opencode {
        return None;
    }
    let db = crate::usage::opencode_db(home, xdg_data_home);
    Some(db.parent()?.join("log").join("opencode.log"))
}

/// The session options a normal Tayang chat starts with. `plugin` is the local Claude Code plugin
/// directory when this deployment ships one; without it Claude receives the skills as text.
pub fn session_options(
    agent: AgentId,
    plugin: Option<&Path>,
    skills: bool,
    auto: bool,
    model: Option<String>,
    home: &Path,
    xdg_data_home: Option<&str>,
) -> SessionOptions {
    let env = vec![("TAYANG_STUDIO".to_string(), "1".to_string())];
    let use_modes = agent == AgentId::Claude;
    let error_log = error_log(agent, home, xdg_data_home);
    if agent != AgentId::Claude || !skills {
        return SessionOptions {
            meta: None,
            env,
            auto,
            use_modes,
            mode_timeout: None,
            model,
            error_log,
            usage_log: None,
        };
    }
    let mut meta = serde_json::json!({ "systemPrompt": { "append": TAYANG_APPEND } });
    if let Some(path) = plugin {
        meta["claudeCode"] = serde_json::json!({
            "options": { "plugins": [{ "type": "local", "path": path.to_string_lossy() }] }
        });
    }
    SessionOptions { meta: Some(meta), env, auto, use_modes, mode_timeout: None, model, error_log, usage_log: None }
}

#[derive(Debug, Clone)]
pub struct PreparedAgent {
    /// The resolved argv (program replaced with its absolute path).
    pub command: Vec<String>,
    pub cwd: PathBuf,
    pub options: SessionOptions,
    pub skills_as_text: bool,
    pub has_project: bool,
}

pub fn prepare_agent(
    db: &Db,
    home: &Path,
    chat_id: &str,
    agent_id: AgentId,
    requested_auto: bool,
    plugin: Option<&Path>,
    data_dir: &Path,
) -> Result<PreparedAgent> {
    let mut command = crate::system::acp_command(agent_id)
        .ok_or("Pick an agent first: custom agents have no start command yet")?;
    let program = command[0].clone();
    let found = crate::system::Exec::which(&crate::system::RealExec, &program)
        .ok_or_else(|| format!("Can't find {program} on this computer or server"))?;
    command[0] = found.to_string_lossy().into_owned();
    let settings = db.get_settings(home);
    let working = PathBuf::from(&settings.working_folder);
    let project_folder = project_folder_for_chat(db, chat_id)?;
    let cwd = resolve_cwd(&working, chat_id, project_folder.as_deref())?;
    let skills = wants_skills(chat_id);
    let claude_plugin = if agent_id == AgentId::Claude && skills { plugin } else { None };
    let mut options = session_options(
        agent_id,
        claude_plugin,
        skills,
        wants_auto(chat_id, requested_auto),
        picked_model(db, home, agent_id),
        home,
        std::env::var("XDG_DATA_HOME").ok().as_deref(),
    );
    if agent_id == AgentId::Claude {
        options.env.push((
            crate::claude_account::CONFIG_ENV.to_string(),
            crate::claude_account::config_dir(data_dir).to_string_lossy().into_owned(),
        ));
    }
    Ok(PreparedAgent {
        skills_as_text: skills && needs_skills_text(agent_id, claude_plugin),
        command,
        cwd,
        options,
        has_project: project_folder.is_some(),
    })
}

// ---- chat prompts ----

const BRIEF_LIMIT: usize = 8 * 1024;

pub fn read_brief(folder: &Path) -> Option<String> {
    let text = std::fs::read_to_string(folder.join("AGENTS.md")).ok()?;
    if text.len() <= BRIEF_LIMIT {
        return Some(text);
    }
    let mut end = BRIEF_LIMIT;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    Some(format!("{}\n[AGENTS.md cut at 8 KB]", &text[..end]))
}

fn is_image_name(name: &str) -> bool {
    matches!(mime_for(name), "image/png" | "image/jpeg" | "image/webp")
}

pub fn mime_for(name: &str) -> &'static str {
    let ext = Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "txt" | "md" => "text/plain",
        "csv" => "text/csv",
        "json" => "application/json",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        _ => "application/octet-stream",
    }
}

fn human_size(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    let b = bytes as f64;
    if b < KB {
        format!("{bytes} B")
    } else if b < KB * KB {
        format!("{:.1} KB", b / KB)
    } else {
        format!("{:.1} MB", b / (KB * KB))
    }
}

pub fn build_prompt(
    parts: &[MessagePart],
    fps: u32,
    project: impl Fn(&str) -> Option<Project>,
    brief: impl Fn(&Path) -> Option<String>,
) -> Vec<PromptPart> {
    let mut out = Vec::new();
    for part in parts {
        match part {
            MessagePart::Text { text } => out.push(PromptPart::Text(text.clone())),
            MessagePart::Mention { project_id, title } => {
                out.push(PromptPart::Text(match project(project_id) {
                    Some(p) => {
                        let head = format!(
                            "Context: video project \"{}\". Its Tayang id is {}. Its files are in {}.",
                            p.title, p.id, p.folder
                        );
                        match brief(Path::new(&p.folder)) {
                            Some(b) if !b.trim().is_empty() => format!("{head}\nIts AGENTS.md:\n\n{}", b.trim_end()),
                            _ => head,
                        }
                    }
                    None => format!("Context: video project \"{title}\" (no longer on this computer)."),
                }));
            }
            MessagePart::Frame { project_id, frame, time_sec, image_path, marks } => {
                let title = project(project_id).map(|p| p.title).unwrap_or_default();
                let marks = if marks.is_empty() {
                    "none".to_string()
                } else {
                    marks.iter().map(|m| format!("({:.2}, {:.2})", m.x, m.y)).collect::<Vec<_>>().join(", ")
                };
                out.push(PromptPart::Image { path: PathBuf::from(image_path) });
                out.push(PromptPart::Text(format!(
                    "Frame {frame} at {} of {title}. Marks (x,y relative): {marks}",
                    format_timecode(*time_sec, fps)
                )));
            }
            MessagePart::File { path, name, size, .. } => {
                let rel = Path::new(path)
                    .file_name()
                    .map(|f| format!("attachments/{}", f.to_string_lossy()))
                    .unwrap_or_else(|| name.clone());
                let inline = is_image_name(name) && *size <= MAX_IMAGE_BLOCK;
                if inline {
                    out.push(PromptPart::Image { path: PathBuf::from(path) });
                    out.push(PromptPart::Text(format!("Attached image: {rel} ({name}, {})", human_size(*size))));
                } else {
                    out.push(PromptPart::Text(format!("Attached file: {rel} ({name}, {})", human_size(*size))));
                }
            }
            MessagePart::Tool { .. }
            | MessagePart::Thought { .. }
            | MessagePart::A2ui { .. }
            | MessagePart::StyleMention { .. } => {}
            MessagePart::A2uiAction { summary, action } => {
                out.push(PromptPart::Text(format!("{summary}\n\n```a2ui-action\n{action}\n```")));
            }
        }
    }
    out
}

pub const MAX_ATTACHMENT: u64 = 50 * 1024 * 1024;
pub const MAX_IMAGE_BLOCK: u64 = 5 * 1024 * 1024;

/// Copies `source` into `<cwd>/attachments/`, under a name that is not taken yet.
pub fn copy_attachment(cwd: &Path, source: &Path, max: u64) -> Result<MessagePart> {
    let meta = std::fs::metadata(source).map_err(|e| format!("Can't read that file: {e}"))?;
    if !meta.is_file() {
        return Err("That isn't a file".into());
    }
    if meta.len() > max {
        return Err("That file is larger than 50 MB".into());
    }
    let file_name = source
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| safe_segment(n))
        .ok_or("That file has no usable name")?;
    let dir = cwd.join("attachments");
    if !projects::ensure_inside(cwd, &dir) {
        return Err("The agent can only read files inside this chat's folder".into());
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("Can't create {}: {e}", dir.display()))?;
    let (stem, ext) = match file_name.rfind('.') {
        Some(i) if i > 0 => (file_name[..i].to_string(), file_name[i..].to_string()),
        _ => (file_name.clone(), String::new()),
    };
    let mut name = file_name;
    let mut n = 1;
    loop {
        let dest = dir.join(&name);
        if !projects::ensure_inside(cwd, &dest) {
            return Err("The agent can only read files inside this chat's folder".into());
        }
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&dest) {
            Ok(mut out) => {
                let mut input = std::fs::File::open(source).map_err(|e| format!("Can't read that file: {e}"))?;
                if let Err(e) = std::io::copy(&mut input, &mut out) {
                    drop(out);
                    let _ = std::fs::remove_file(&dest);
                    return Err(format!("Can't copy that file: {e}"));
                }
                return Ok(MessagePart::File {
                    path: dest.to_string_lossy().into_owned(),
                    mime: mime_for(&name).into(),
                    name,
                    size: meta.len(),
                    modified_at: None,
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                n += 1;
                name = format!("{stem}-{n}{ext}");
            }
            Err(e) => return Err(format!("Can't copy that file: {e}")),
        }
    }
}

pub fn check_file_parts(cwd: &Path, parts: &[MessagePart]) -> Result<()> {
    for part in parts {
        if let MessagePart::File { path, .. } = part {
            if !projects::ensure_inside(cwd, Path::new(path)) {
                return Err("That file is outside this chat's folder".into());
            }
        }
    }
    Ok(())
}

pub fn check_frame_images(
    working: &Path,
    parts: &[MessagePart],
    project_folder: impl Fn(&str) -> Option<PathBuf>,
) -> Result<()> {
    for part in parts {
        if let MessagePart::Frame { image_path, project_id, .. } = part {
            let image = Path::new(image_path);
            let in_project = project_folder(project_id)
                .filter(|f| f.is_dir())
                .is_some_and(|f| projects::ensure_inside(&f, image));
            if !in_project && !projects::ensure_inside(working, image) {
                return Err("That frame image is outside your working folder".into());
            }
        }
    }
    Ok(())
}

pub fn format_timecode(sec: f64, fps: u32) -> String {
    let fps = fps.max(1);
    let total = sec.max(0.0);
    let whole = total.floor();
    let frame = (((total - whole) * fps as f64).round() as u32).min(fps - 1);
    let cc = (frame as f64 / fps as f64 * 100.0).floor() as u32;
    let whole = whole as u64;
    format!("{}:{:02}.{:02}", whole / 60, whole % 60, cc)
}

// ---- media / workspace convenience ----

pub fn project_folder(db: &Db, project_id: &str) -> Result<PathBuf> {
    db.get_project(project_id)
        .map_err(err)?
        .map(|p| PathBuf::from(p.folder))
        .ok_or_else(|| "That project no longer exists".to_string())
}

pub fn latest_render(db: &Db, project_id: &str) -> Result<Option<PathBuf>> {
    Ok(media::latest_render(&project_folder(db, project_id)?))
}

pub fn list_project_files(db: &Db, project_id: &str, dir: &str) -> Result<Vec<files::FileEntry>> {
    files::list_dir(&project_folder(db, project_id)?, dir)
}

pub fn find_project_files(db: &Db, project_id: &str, query: &str) -> Result<Vec<files::FileEntry>> {
    files::find(&project_folder(db, project_id)?, query)
}

pub fn read_project_file(db: &Db, project_id: &str, path: &str) -> Result<files::FileContent> {
    files::read(&project_folder(db, project_id)?, path)
}

// ---- readable errors for the API ----

pub fn acp_error(e: AcpError) -> String {
    e.to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderCommand {
    pub install: Option<Vec<String>>,
    pub render: Vec<String>,
}

pub fn render_command(db: &Db, project_id: &str) -> Result<Option<RenderCommand>> {
    let folder = project_folder(db, project_id)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    Ok(media::render_command(&folder, now)?.map(|p| RenderCommand { install: p.install, render: p.render }))
}

pub fn write_brief(db: &Db, project_id: &str, brief: &str) -> Result<()> {
    let folder = project_folder(db, project_id)?;
    projects::write_project_brief(&folder, brief).map_err(|e| format!("Can't write the project brief: {e}"))
}

pub fn study_dir(working: &Path, study_id: &str) -> Result<PathBuf> {
    if !safe_segment(study_id) {
        return Err("That study isn't valid".into());
    }
    let dir = working.join(".tayang").join("style-study").join(study_id);
    if !projects::ensure_inside(working, &dir) {
        return Err("That study is outside your working folder".into());
    }
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setting_one_agent_model_keeps_the_others() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Db::open_in_memory().unwrap();
        let home = tmp.path();
        let settings = set_agent_model(&db, home, AgentId::Opencode, Some("opencode-go/deepseek-v4.1-flash".into())).unwrap();
        assert_eq!(settings.agent_models.get("opencode").map(String::as_str), Some("opencode-go/deepseek-v4.1-flash"));
        let settings = set_agent_model(&db, home, AgentId::Codex, Some("gpt-6.1-sol".into())).unwrap();
        assert_eq!(settings.agent_models.get("opencode").map(String::as_str), Some("opencode-go/deepseek-v4.1-flash"));
        assert_eq!(settings.agent_models.get("codex").map(String::as_str), Some("gpt-6.1-sol"));
        let settings = set_agent_model(&db, home, AgentId::Opencode, None).unwrap();
        assert!(!settings.agent_models.contains_key("opencode"));
        assert_eq!(settings.agent_models.get("codex").map(String::as_str), Some("gpt-6.1-sol"));
    }
}
