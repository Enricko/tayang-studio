//! Server-side scheduling: reminders, autopilot slot planning/runs, and late render reconciliation.
//! This is what keeps working when the browser is closed; no tab drives these decisions.

use crate::agent;
use crate::state::{AppState, AutopilotRun};
use crate::web_db;
use chrono::{Datelike, Local, TimeZone, Utc};
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tayang_core::types::*;

const PLAN_DAYS: i64 = 7;
const START_WITHIN_HOURS: i64 = 24;
const REVIEW_LEAD_HOURS: i64 = 2;
const MISSED_WINDOW_HOURS: i64 = 24;
const TURN_TIMEOUT: Duration = Duration::from_secs(45 * 60);

fn language_name(l: VideoLanguage) -> &'static str {
    match l {
        VideoLanguage::Id => "Indonesian",
        VideoLanguage::En => "English",
    }
}

fn plan_slots(frequency: &AutopilotFrequency, from: chrono::DateTime<Local>, days: i64) -> Vec<chrono::DateTime<Utc>> {
    let mut out = Vec::new();
    let today = from.date_naive();
    for i in 0..days {
        let Some(date) = today.checked_add_signed(chrono::Duration::days(i)) else { continue };
        let times: Vec<(u32, u32)> = match frequency {
            AutopilotFrequency::Daily { times } => times
                .iter()
                .filter_map(|t| {
                    let (h, m) = t.split_once(':')?;
                    Some((h.parse().ok()?, m.parse().ok()?))
                })
                .collect(),
            AutopilotFrequency::Weekly { days, time } => {
                let weekday = date.weekday().num_days_from_sunday() as u8;
                if !days.contains(&weekday) {
                    Vec::new()
                } else {
                    time.split_once(':')
                        .and_then(|(h, m)| Some((h.parse().ok()?, m.parse().ok()?)))
                        .into_iter()
                        .collect()
                }
            }
        };
        for (h, m) in times {
            let Some(native) = date.and_hms_opt(h, m, 0) else { continue };
            let Some(at) = Local.from_local_datetime(&native).earliest() else { continue };
            if at > from {
                out.push(at.with_timezone(&Utc));
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

fn style_text(style: &Style) -> String {
    let mut out = format!("{}: {}", style.name, style.prompt.trim());
    for (aspect, note) in &style.notes {
        let label = serde_json::to_value(aspect).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default();
        out.push_str(&format!("\n{label}: {note}"));
    }
    out
}

fn topic_prompt(a: &Autopilot, style: &Style, previous: &[String]) -> String {
    let lang = language_name(a.language);
    let lines = vec![
        format!("Suggest exactly ONE topic for a short motion video in this niche: \"{}\". Write the title in {lang}.", a.niche),
        format!("The video will be about {} seconds long and made in this style: {}", a.length_sec, style_text(style)),
        String::new(),
        "Rules:".into(),
        "- It must be a concrete idea that can be said in one short video.".into(),
        "- It must fit the niche and suit the style.".into(),
        "- Use real, checkable facts; never invent numbers.".into(),
        if previous.is_empty() {
            "- There are no earlier titles yet.".into()
        } else {
            format!("- It must not repeat, or be a close variation of, these earlier titles:\n  - {}", previous.join("\n  - "))
        },
        String::new(),
        "How to reply:".into(),
        "- Do not use any tools, create files or run commands. Just answer.".into(),
        "- Reply with only one fenced ```json block and nothing else, like this (kind is one of: explainer, promo, quote, news, tutorial, data, event):".into(),
        "```json".into(),
        format!("{{\"title\": \"<the title>\", \"kind\": \"explainer\", \"lengthSec\": {}}}", a.length_sec),
        "```".into(),
    ];
    lines.join("\n")
}

const TOPIC_RETRY: &str = "I could not use that. Reply again with only one fenced ```json block, {\"title\": \"...\", \"kind\": \"...\", \"lengthSec\": ...}, with a new title that is not one of the earlier titles. Nothing else.";

fn parse_topic(text: &str) -> Option<(String, VideoKind, u32)> {
    let raw = if let Some(start) = text.find("```json") {
        let rest = &text[start + 7..];
        rest.find("```").map(|end| rest[..end].trim())
    } else {
        Some(text.trim())
    }?;
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    let value = value.as_array().and_then(|a| a.first()).cloned().unwrap_or(value);
    let title = value.get("title")?.as_str()?.trim();
    if title.is_empty() {
        return None;
    }
    let kind = match value.get("kind").and_then(|v| v.as_str()).unwrap_or("explainer") {
        "promo" => VideoKind::Promo,
        "quote" => VideoKind::Quote,
        "news" => VideoKind::News,
        "tutorial" => VideoKind::Tutorial,
        "data" => VideoKind::Data,
        "event" => VideoKind::Event,
        _ => VideoKind::Explainer,
    };
    let length = value.get("lengthSec").and_then(|v| v.as_f64()).filter(|n| *n > 0.0).unwrap_or(30.0) as u32;
    Some((title.chars().take(120).collect(), kind, length.clamp(15, 180)))
}

fn build_prompt(title: &str, length: u32, language: VideoLanguage, frame_check: bool) -> String {
    let lang = language_name(language);
    let mut steps = vec![
        format!("Write the script for \"{title}\", about {length} seconds in {lang}."),
        "Build the video in this project, following AGENTS.md and its style.".into(),
        "Render it to an MP4 with the render command in tayang.json (or the project's own render setup).".into(),
    ];
    if frame_check {
        steps.push("Check frames of the render, fix anything that looks wrong and render again.".into());
    }
    steps.push("Finish by saying the path of the rendered file.".into());
    format!(
        "This video is made by an autopilot: work through every step on your own, without asking questions or waiting for a reply.\n{}\nRun long renders in the foreground. Put finished renders in renders/. Do not render again after you finish.",
        steps.iter().enumerate().map(|(i, s)| format!("{}. {s}", i + 1)).collect::<Vec<_>>().join("\n")
    )
}

const RENDER_NOW: &str = "Render it now: no rendered video file was found in this project. Use the render command in tayang.json (or the project's own render setup), run it in the foreground, then finish by saying the path of the rendered file.";

fn project_brief(title: &str, kind: VideoKind, settings: &Settings, style: &Style, length: u32) -> String {
    let mut lines = vec![
        format!("# {title}"),
        String::new(),
        "## Project".into(),
        format!("- Kind: {kind:?}"),
        format!("- Format: {:?}, {} fps", settings.format, settings.fps),
        format!("- Video language: {}. All on-screen text and voice-over are in {}.", language_name(settings.language), language_name(settings.language)),
        format!("- Target length: about {length} seconds."),
        String::new(),
        "## How to work".into(),
        "- Keep all files in this folder. Do not write outside it.".into(),
        "- Use HyperFrames (`npx hyperframes`) to build and render the video, unless the style says otherwise.".into(),
        "- Put finished renders in renders/ so Tayang can show them.".into(),
        "- Render long videos in the foreground. Do not leave a background render running.".into(),
        String::new(),
        "## Style".into(),
        style_text(style),
        String::new(),
        format!("## Brief\n{}\n", style.prompt.trim()),
    ];
    if settings.frame_check {
        lines.push("## Quality loop\nAfter rendering, sample a few frames, fix anything that looks wrong, and render again.".into());
    }
    lines.join("\n")
}

async fn turn(state: Arc<AppState>, chat_id: &str, agent_id: AgentId, text: &str, auto: bool) -> Result<String, String> {
    agent::start(state.clone(), chat_id.to_string(), agent_id, Some(auto)).await?;
    let mut rx = state.agent.subscribe(chat_id);
    agent::prompt(state.clone(), chat_id.to_string(), vec![MessagePart::Text { text: text.to_string() }]).await?;
    let deadline = tokio::time::Instant::now() + TURN_TIMEOUT;
    let mut out = String::new();
    loop {
        match tokio::time::timeout_at(deadline, rx.recv()).await {
            Err(_) => {
                let _ = agent::cancel(state.clone(), chat_id.to_string()).await;
                let _ = agent::stop(state.clone(), chat_id.to_string()).await;
                return Err("The agent took too long and was stopped".into());
            }
            Ok(Err(_)) => return Err("The agent stopped".into()),
            Ok(Ok(AgentUpdate::Text { text })) => out.push_str(&text),
            Ok(Ok(AgentUpdate::Done { stop_reason })) => {
                if stop_reason == "cancelled" {
                    return Err("The agent was stopped".into());
                }
                return Ok(out);
            }
            Ok(Ok(AgentUpdate::Error { message })) => return Err(message),
            Ok(Ok(_)) => {}
        }
    }
}

fn job(state: &AppState, chat_id: &str, project_id: &str, title: &str, agent_id: AgentId, status: JobStatus, note: Option<String>) {
    let job = Job {
        id: format!("build-{chat_id}"),
        kind: JobKind::Build,
        title: title.to_string(),
        project_id: Some(project_id.to_string()),
        chat_id: Some(chat_id.to_string()),
        agent_id,
        status,
        progress: None,
        note,
        source_url: None,
        updated_at: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        render_baseline_at: None,
        archived_at: None,
    };
    let _ = state.db.upsert_job(&job);
}

fn rendered_since(state: &AppState, folder: &std::path::Path, since: chrono::DateTime<Utc>) -> bool {
    let Some(info) = tayang_core::media::latest_render_info(folder) else { return false };
    if info.size == 0 {
        return false;
    }
    let Ok(modified) = chrono::DateTime::parse_from_rfc3339(&info.modified_at) else { return false };
    if modified.with_timezone(&Utc) < since - chrono::Duration::seconds(2) {
        return false;
    }
    tayang_core::media::probe(&state.media, &PathBuf::from(&info.path))
        .map(|m| m.duration_sec > 0.0)
        .unwrap_or(true)
}

async fn make_slot(state: Arc<AppState>, slot: AutopilotSlot, autopilot: Autopilot, run: Arc<AutopilotRun>) -> Result<String, String> {
    run.check()?;
    let styles = state.db.list_styles().map_err(|e| e.to_string())?;
    let style = styles
        .into_iter()
        .find(|s| s.id == autopilot.style_id)
        .ok_or("The autopilot's style is missing")?;
    let settings = state.db.get_settings(&state.home);
    let recent_slots = state.db.list_slots("1970-01-01T00:00:00Z", "9999-12-31T23:59:59Z").unwrap_or_default();
    let titles: Vec<String> = recent_slots
        .iter()
        .filter(|s| s.autopilot_id == autopilot.id)
        .filter_map(|s| s.project_id.as_ref())
        .filter_map(|id| state.db.get_project(id).ok().flatten().map(|p| p.title))
        .take(50)
        .collect();

    // 1. Topic, in a hidden chat; the session is stopped afterwards.
    let topic_chat = format!("autopilot-{}", autopilot.id);
    run.set_chat(&topic_chat);
    let mut reply = turn(state.clone(), &topic_chat, autopilot.agent_id, &topic_prompt(&autopilot, &style, &titles), true).await;
    let mut topic = reply.as_ref().ok().and_then(|t| parse_topic(t));
    if topic.is_none() {
        reply = turn(state.clone(), &topic_chat, autopilot.agent_id, TOPIC_RETRY, true).await;
        topic = reply.as_ref().ok().and_then(|t| parse_topic(t));
    }
    let _ = agent::stop(state.clone(), topic_chat).await;
    run.check()?;
    let (title, kind, length) = topic.ok_or("The agent didn't suggest a usable topic")?;

    // 2. The project and its own chat.
    let input = NewProject {
        title: title.clone(),
        kind,
        format: settings.format,
        language: autopilot.language,
        style_id: Some(style.id.clone()),
    };
    let brief = project_brief(&title, kind, &settings, &style, length);
    let working = state.working();
    let project = tayang_core::service::new_project(&state.db, &working, input.clone(), &brief)?;
    let chat = state.db.create_chat(Some(&project.id), autopilot.agent_id, &title).map_err(|e| e.to_string())?;
    run.set_chat(&chat.id);
    let _ = state.db.update_project(&project.id, json!({ "status": "building" }));
    let _ = state.db.update_slot(&slot.id, json!({ "projectId": project.id }));
    job(&state, &chat.id, &project.id, &title, autopilot.agent_id, JobStatus::Working, None);

    // Reference frames and the style template, when the style has them.
    if !style.references.is_empty() {
        let refs = tayang_core::media::style_refs_dir(&state.data_dir, &style.id);
        if let Some(refs) = refs {
            let _ = tayang_core::media::copy_style_refs(&refs, &PathBuf::from(&project.folder));
        }
    }
    if style.template.is_some() {
        let templates = state.data_dir.join("templates");
        let api_url = tayang_core::styles_sync::effective_api_url(&settings);
        if let Ok(fetcher) = tayang_core::styles_sync::HttpFetcher::new(Duration::from_secs(120)) {
            match tayang_core::styles_sync::install_template(&state.db, &fetcher, &api_url, &templates, &project.id).await {
                Ok(true) => {
                    let _ = state.db.update_project(&project.id, json!({ "status": "building" }));
                }
                _ => {
                    let fallback = project_brief(&title, kind, &settings, &style, length);
                    let _ = tayang_core::service::write_brief(&state.db, &project.id, &fallback);
                }
            }
        }
    }

    // 3. Build, then the render-now retry if no finished video exists.
    run.check()?;
    let started = Utc::now();
    let user_text = format!("Make the video \"{title}\" now.");
    let _ = state.db.add_message(&chat.id, MessageRole::User, &[MessagePart::Text { text: user_text }]);
    let prompt = build_prompt(&title, length, autopilot.language, settings.frame_check);
    let mut result = turn(state.clone(), &chat.id, autopilot.agent_id, &prompt, true).await;
    let folder = PathBuf::from(&project.folder);
    if !rendered_since(&state, &folder, started) {
        run.check()?;
        result = turn(state.clone(), &chat.id, autopilot.agent_id, RENDER_NOW, true).await;
    }
    if let Err(e) = result {
        job(&state, &chat.id, &project.id, &title, autopilot.agent_id, JobStatus::Failed, Some(e.clone()));
        let _ = agent::stop(state.clone(), chat.id).await;
        return Err(e);
    }
    run.check()?;
    if !rendered_since(&state, &folder, started) {
        let msg = "The agent finished without a rendered video".to_string();
        job(&state, &chat.id, &project.id, &title, autopilot.agent_id, JobStatus::Failed, Some(msg.clone()));
        let _ = agent::stop(state.clone(), chat.id).await;
        return Err(msg);
    }

    // 4. Publish it on the project and the calendar.
    let info = tayang_core::media::latest_render_info(&folder);
    let review = if autopilot.review { "pending" } else { "approved" };
    let _ = state.db.update_project(
        &project.id,
        json!({ "status": "rendered", "durationSec": info.as_ref().map(|i| tayang_core::media::probe(&state.media, &PathBuf::from(&i.path)).map(|m| m.duration_sec).unwrap_or(0.0)), "reviewState": review }),
    );
    let _ = tayang_core::service::schedule_project(&state.db, &project.id, Some(slot.due_at.clone()));
    job(&state, &chat.id, &project.id, &title, autopilot.agent_id, JobStatus::Done, info.map(|i| i.name));
    let _ = agent::stop(state.clone(), chat.id).await;
    Ok(project.id)
}

async fn produce(state: Arc<AppState>, slot: AutopilotSlot, autopilot: Autopilot) {
    let run = AutopilotRun::new(&slot.id);
    *state.autopilot_current.lock().unwrap_or_else(|e| e.into_inner()) = Some(run.clone());
    let result = make_slot(state.clone(), slot.clone(), autopilot, run.clone()).await;
    if run.is_cancelled() {
        if let Some(chat) = run.chat() {
            let _ = agent::cancel(state.clone(), chat.clone()).await;
            let _ = agent::stop(state.clone(), chat).await;
        }
        let _ = state.db.update_slot(&slot.id, json!({ "status": "failed", "error": "Stopped" }));
        let project_id = state
            .db
            .get_slot(&slot.id)
            .ok()
            .flatten()
            .and_then(|s| s.project_id)
            .or(slot.project_id.clone());
        if let Some(project_id) = project_id.as_deref() {
            if let Ok(chats) = state.db.list_chats(Some(project_id)) {
                for chat in chats {
                    let job_id = format!("build-{}", chat.id);
                    if let Ok(Some(mut job)) = state.db.list_jobs().map(|all| all.into_iter().find(|j| j.id == job_id)) {
                        job.status = JobStatus::Failed;
                        job.note = Some("Stopped".into());
                        job.updated_at = crate::auth::now_text();
                        let _ = state.db.upsert_job(&job);
                    }
                }
            }
        }
    } else {
        // Only a slot still `making` may be finished: a concurrent Stop already failed it.
        match result {
            Ok(project_id) => {
                finish_making_slot(&state.db, &slot.id, json!({ "status": "done", "projectId": project_id, "error": null }));
            }
            Err(error) => {
                finish_making_slot(&state.db, &slot.id, json!({ "status": "failed", "error": error }));
            }
        }
    }
    *state.autopilot_current.lock().unwrap_or_else(|e| e.into_inner()) = None;
    web_db::release_claim(&state.db, &format!("slot:{}", slot.id));
    state.events.emit(&state.db, "autopilot://changed", json!({ "slotId": slot.id }));
}

/// One autopilot pass, serialized across the process. Tabs never call this.
pub async fn pass(state: Arc<AppState>) {
    let _guard = state.autopilot_lock.lock().await;
    let now_local = Local::now();
    let now = Utc::now();
    let autopilots = state.db.list_autopilots().unwrap_or_default();
    let active: Vec<_> = autopilots.into_iter().filter(|a| a.status == AutopilotStatus::Active).collect();
    let from = (now - chrono::Duration::hours(24)).to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let to = (now + chrono::Duration::days(PLAN_DAYS + 1)).to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let mut slots = state.db.list_slots(&from, &to).unwrap_or_default();
    let have: std::collections::HashSet<String> = slots.iter().map(|s| format!("{}|{}", s.autopilot_id, s.due_at)).collect();
    let mut changed = false;
    for a in &active {
        for at in plan_slots(&a.frequency, now_local, PLAN_DAYS) {
            let key = format!("{}|{}", a.id, at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
            if have.contains(&key) {
                continue;
            }
            if let Ok(slot) = state.db.upsert_slot(&a.id, &at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)) {
                slots.push(slot);
                changed = true;
            }
        }
    }
    for slot in slots.iter_mut() {
        if slot.status == SlotStatus::Planned {
            if let Ok(due) = chrono::DateTime::parse_from_rfc3339(&slot.due_at) {
                if due.with_timezone(&Utc) < now {
                    if let Ok(next) = state.db.update_slot(&slot.id, json!({ "status": "skipped" })) {
                        *slot = next;
                        changed = true;
                    }
                }
            }
        }
    }
    if changed {
        state.events.emit(&state.db, "autopilot://changed", json!({}));
    }

    // Start the earliest due slot, if nothing is already being made.
    let making = slots.iter().any(|s| s.status == SlotStatus::Making);
    if making {
        return;
    }
    let by_id: std::collections::HashMap<String, Autopilot> = active.into_iter().map(|a| (a.id.clone(), a)).collect();
    let until = now + chrono::Duration::hours(START_WITHIN_HOURS);
    let next = slots
        .into_iter()
        .filter(|s| s.status == SlotStatus::Planned && by_id.contains_key(&s.autopilot_id))
        .filter(|s| {
            chrono::DateTime::parse_from_rfc3339(&s.due_at)
                .map(|d| d.with_timezone(&Utc) >= now && d.with_timezone(&Utc) <= until)
                .unwrap_or(false)
        })
        .min_by_key(|s| s.due_at.clone());
    let Some(slot) = next else { return };
    // Atomic status transition: even two server processes cannot both take the slot.
    if !claim_slot_row(&state.db, &slot.id) {
        return;
    }
    let _ = web_db::claim_slot(&state.db, &slot.id, "autopilot");
    let Some(autopilot) = by_id.get(&slot.autopilot_id).cloned() else { return };
    let fresh = state.db.get_slot(&slot.id).ok().flatten().unwrap_or(slot);
    state.events.emit(&state.db, "autopilot://changed", json!({ "slotId": fresh.id }));
    let run_state = state.clone();
    tokio::spawn(produce(run_state, fresh, autopilot));
}

// ---- reminders and late renders ----

pub fn due_reminders(projects: &[Project], now: chrono::DateTime<Utc>) -> Vec<(Project, &'static str, &'static str)> {
    let mut out = Vec::new();
    for p in projects {
        let Some(scheduled) = p.scheduled_at.as_deref() else { continue };
        if p.posted_at.is_some() {
            continue;
        }
        let Ok(due) = chrono::DateTime::parse_from_rfc3339(scheduled) else { continue };
        let due = due.with_timezone(&Utc);
        if now > due + chrono::Duration::hours(MISSED_WINDOW_HOURS) {
            continue;
        }
        if p.review_state == ReviewState::Pending {
            if now >= due - chrono::Duration::hours(REVIEW_LEAD_HOURS) && p.review_reminded_at.is_none() {
                out.push((p.clone(), if now >= due { "reviewLate" } else { "review" }, "reviewRemindedAt"));
            }
        } else if now >= due && p.reminded_at.is_none() {
            out.push((p.clone(), "post", "remindedAt"));
        }
    }
    out.sort_by_key(|(p, _, _)| p.scheduled_at.clone());
    out
}

pub async fn tick(state: Arc<AppState>) {
    let now = Utc::now();
    let projects = state.db.list_projects().unwrap_or_default();
    for (project, kind, stamp) in due_reminders(&projects, now) {
        let patch = json!({ stamp: now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true), "updatedAt": project.updated_at });
        if state.db.update_project(&project.id, patch).is_err() {
            continue;
        }
        state.events.emit(
            &state.db,
            "scheduler://reminder",
            json!({ "kind": kind, "projectId": project.id, "title": project.title }),
        );
    }
    settle_late_renders(&state, now).await;
    pass(state).await;
}

/// Build jobs waiting for a video whose render finished after the job's last turn.
pub async fn settle_late_renders(state: &AppState, now: chrono::DateTime<Utc>) {
    let jobs = state.db.list_jobs().unwrap_or_default();
    for job in jobs.into_iter().filter(|j| {
        j.kind == JobKind::Build
            && (j.status == JobStatus::NeedsYou
                // A tab that closed mid-turn may have left "working": reconcile it after it is idle.
                || (j.status == JobStatus::Working
                    && chrono::DateTime::parse_from_rfc3339(&j.updated_at)
                        .map(|t| now - t.with_timezone(&Utc) > chrono::Duration::seconds(90))
                        .unwrap_or(false)))
    }) {
        let (Some(project_id), Some(chat_id)) = (job.project_id.as_deref(), job.chat_id.as_deref()) else { continue };
        let live = agent::live(state, chat_id);
        if live.streaming {
            continue;
        }
        let Some(project) = state.db.get_project(project_id).ok().flatten() else { continue };
        let folder = PathBuf::from(project.folder);
        let since = chrono::DateTime::parse_from_rfc3339(job.render_baseline_at.as_deref().unwrap_or(&job.updated_at))
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or(now - chrono::Duration::days(1));
        let info = tayang_core::media::latest_render_info(&folder).filter(|i| i.size > 0);
        let recent = info.as_ref().and_then(|info| {
            chrono::DateTime::parse_from_rfc3339(&info.modified_at)
                .map(|d| d.with_timezone(&Utc) >= since - chrono::Duration::seconds(2))
                .ok()
        }).unwrap_or(false);
        let mut next = job.clone();
        next.updated_at = now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        if recent {
            let info = info.unwrap();
            next.status = JobStatus::Done;
            next.note = Some(info.name);
            next.render_baseline_at = None;
            let _ = state.db.update_project(project_id, json!({ "status": "rendered" }));
        } else if job.status == JobStatus::Working {
            next.status = JobStatus::NeedsYou;
            next.note = Some("No video yet. The agent stopped before rendering".into());
        } else {
            continue;
        }
        let _ = state.db.upsert_job(&next);
        state.events.emit(&state.db, "jobs://changed", json!({ "id": next.id }));
    }
}

fn finish_making_slot(db: &tayang_core::db::Db, slot_id: &str, patch: serde_json::Value) -> bool {
    let status = patch.get("status").and_then(|v| v.as_str()).unwrap_or("failed");
    let project = patch.get("projectId").and_then(|v| v.as_str());
    let error = patch.get("error").and_then(|v| v.as_str());
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE autopilot_slots SET status = ?2, project_id = COALESCE(?3, project_id), error = ?4 \
             WHERE id = ?1 AND status = 'making'",
            rusqlite::params![slot_id, status, project, error],
        )
    })
    .unwrap_or(0)
        == 1
}

/// `UPDATE ... WHERE status = 'planned'` returns one row for exactly one caller, so two engine
/// passes (or two server processes sharing the database) cannot start the same slot twice.
pub fn claim_slot_row(db: &tayang_core::db::Db, slot_id: &str) -> bool {
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE autopilot_slots SET status = 'making', error = NULL WHERE id = ?1 AND status = 'planned'",
            [slot_id],
        )
    })
    .unwrap_or(0)
        == 1
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Timelike};

    fn project(id: &str, scheduled: &str, review: ReviewState, review_reminded: Option<&str>, reminded: Option<&str>) -> Project {
        Project {
            id: id.into(),
            title: id.into(),
            slug: id.into(),
            folder: "/w/p".into(),
            kind: VideoKind::Explainer,
            format: VideoFormat::Portrait,
            language: VideoLanguage::En,
            status: ProjectStatus::Rendered,
            style_id: None,
            scheduled_at: Some(scheduled.into()),
            review_state: review,
            posted_at: None,
            reminded_at: reminded.map(str::to_string),
            review_reminded_at: review_reminded.map(str::to_string),
            social_post_id: None,
            duration_sec: None,
            created_at: "t".into(),
            updated_at: "t".into(),
        }
    }

    #[test]
    fn parses_a_topic_from_a_fenced_or_bare_json_reply() {
        let fenced = "Here:\n```json\n{\"title\":\"Kopi Senja\",\"kind\":\"promo\",\"lengthSec\":30}\n```";
        assert_eq!(parse_topic(fenced), Some(("Kopi Senja".into(), VideoKind::Promo, 30)));
        assert_eq!(parse_topic("{\"title\":\"X\"}"), Some(("X".into(), VideoKind::Explainer, 30)));
        assert!(parse_topic("no json").is_none());
        assert!(parse_topic("{\"kind\":\"promo\"}").is_none());
    }

    #[test]
    fn plans_daily_slots_in_local_time_and_skips_the_past() {
        let from = chrono::Local.with_ymd_and_hms(2026, 11, 7, 12, 0, 0).unwrap();
        let slots = plan_slots(&AutopilotFrequency::Daily { times: vec!["09:00".into(), "18:00".into()] }, from, 2);
        // Today 09:00 is past for a 12:00 start; today 18:00 and tomorrow 09:00/18:00 remain.
        assert_eq!(slots.len(), 3);
        let first_local = slots[0].with_timezone(&chrono::Local);
        assert_eq!(first_local.hour(), 18);
    }

    #[test]
    fn a_review_reminder_fires_early_and_a_post_reminder_on_time() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-11-07T10:00:00Z").unwrap().with_timezone(&Utc);
        let due = "2026-11-07T11:00:00Z";
        let pending = project("review", due, ReviewState::Pending, None, None);
        let ready = project("ready", "2026-11-07T09:00:00Z", ReviewState::None, None, None);
        let later = project("later", "2026-11-09T09:00:00Z", ReviewState::None, None, None);
        let out = due_reminders(&[pending, ready, later], now);
        assert_eq!(out.len(), 2);
        let review = out.iter().find(|(p, _, _)| p.id == "review").unwrap();
        assert_eq!(review.1, "review");
        assert_eq!(review.2, "reviewRemindedAt");
        let post = out.iter().find(|(p, _, _)| p.id == "ready").unwrap();
        assert_eq!(post.1, "post");
        assert_eq!(post.2, "remindedAt");
    }

    #[test]
    fn a_cancelled_or_stopped_slot_cannot_be_overwritten_by_a_late_done() {
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
        assert!(claim_slot_row(&state.db, &slot.id));
        assert!(finish_making_slot(&state.db, &slot.id, serde_json::json!({ "status": "failed", "error": "Stopped" })));
        assert!(!finish_making_slot(&state.db, &slot.id, serde_json::json!({ "status": "done", "projectId": "p" })));
        assert_eq!(state.db.get_slot(&slot.id).unwrap().unwrap().status, SlotStatus::Failed);
    }

    #[test]
    fn an_autopilot_run_can_be_cancelled_and_checked() {
        let run = AutopilotRun::new("slot");
        assert!(run.check().is_ok());
        run.set_chat("chat-1");
        assert_eq!(run.chat().as_deref(), Some("chat-1"));
        run.cancel();
        assert!(run.is_cancelled());
        assert_eq!(run.check().unwrap_err(), "Stopped");
    }

    #[test]
    fn a_claimed_slot_cannot_be_claimed_again() {
        let tmp = tempfile::tempdir().unwrap();
        let state = crate::test_support::state(tmp.path());
        state
            .db
            .save_style(&Style {
                id: "style-1".into(),
                name: "Style".into(),
                source: StyleSource::Mine,
                source_url: None,
                notes: Default::default(),
                prompt: "clean".into(),
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
                name: "Daily".into(),
                niche: "Indonesian history".into(),
                language: VideoLanguage::En,
                style_id: "style-1".into(),
                agent_id: AgentId::Claude,
                frequency: AutopilotFrequency::Daily { times: vec!["09:00".into()] },
                length_sec: 30,
                review: true,
                posting: Posting::Manual,
            })
            .unwrap();
        let slot = state.db.upsert_slot(&autopilot.id, "2027-01-01T09:00:00Z").unwrap();
        assert!(claim_slot_row(&state.db, &slot.id));
        assert!(!claim_slot_row(&state.db, &slot.id));
        assert_eq!(state.db.get_slot(&slot.id).unwrap().unwrap().status, SlotStatus::Making);
        // A different slot is unaffected.
        let other = state.db.upsert_slot(&autopilot.id, "2027-01-02T09:00:00Z").unwrap();
        assert!(claim_slot_row(&state.db, &other.id));
    }
}
