//! Integration tests for the ACP client against `tests/fake_agent.mjs` (needs `node` on PATH).

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tayang_studio_lib::acp::{AcpManager, AcpSink, PromptPart};
use tayang_studio_lib::types::{AgentUpdate, PermissionOptionKind, PermissionRequest, ToolCallStatus};

#[derive(Default)]
struct RecordingSink {
    updates: Mutex<Vec<(String, AgentUpdate)>>,
    permissions: Mutex<Vec<PermissionRequest>>,
}

impl AcpSink for RecordingSink {
    fn update(&self, chat_id: &str, u: AgentUpdate) {
        self.updates.lock().unwrap().push((chat_id.to_string(), u));
    }
    fn permission(&self, req: PermissionRequest) {
        self.permissions.lock().unwrap().push(req);
    }
}

impl RecordingSink {
    fn updates(&self) -> Vec<AgentUpdate> {
        self.updates.lock().unwrap().iter().map(|(_, u)| u.clone()).collect()
    }

    fn texts(&self) -> Vec<String> {
        self.updates()
            .into_iter()
            .filter_map(|u| match u {
                AgentUpdate::Text { text } => Some(text),
                _ => None,
            })
            .collect()
    }

    async fn wait_for(&self, what: &str, timeout: Duration, cond: impl Fn(&RecordingSink) -> bool) {
        let start = Instant::now();
        while !cond(self) {
            if start.elapsed() > timeout {
                panic!("timed out waiting for {what}; updates so far: {:?}", self.updates());
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    async fn wait_finished(&self) {
        self.wait_for("done or error", Duration::from_secs(10), |s| {
            s.updates()
                .iter()
                .any(|u| matches!(u, AgentUpdate::Done { .. } | AgentUpdate::Error { .. }))
        })
        .await;
    }

    async fn wait_permission(&self) -> PermissionRequest {
        self.wait_for("permission request", Duration::from_secs(10), |s| {
            !s.permissions.lock().unwrap().is_empty()
        })
        .await;
        self.permissions.lock().unwrap()[0].clone()
    }
}

fn fake_agent() -> Vec<String> {
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests").join("fake_agent.mjs");
    vec!["node".to_string(), script.to_string_lossy().into_owned()]
}

/// A temp parent holding the session cwd, so "outside cwd" paths stay inside the temp dir.
struct Workspace {
    _root: tempfile::TempDir,
    parent: PathBuf,
    cwd: PathBuf,
}

fn workspace() -> Workspace {
    let root = tempfile::tempdir().unwrap();
    let parent = root.path().to_path_buf();
    let cwd = parent.join("project");
    std::fs::create_dir_all(&cwd).unwrap();
    Workspace { _root: root, parent, cwd }
}

async fn started(chat: &str, ws: &Workspace) -> (AcpManager, Arc<RecordingSink>) {
    let manager = AcpManager::new();
    let sink = Arc::new(RecordingSink::default());
    manager
        .start(chat, &fake_agent(), &ws.cwd, sink.clone())
        .await
        .expect("agent starts");
    (manager, sink)
}

fn text(s: &str) -> AgentUpdate {
    AgentUpdate::Text { text: s.to_string() }
}

fn done(s: &str) -> AgentUpdate {
    AgentUpdate::Done { stop_reason: s.to_string() }
}

#[tokio::test]
async fn hello_streams_two_chunks_then_done() {
    let ws = workspace();
    let (manager, sink) = started("c1", &ws).await;
    manager.prompt("c1", vec![PromptPart::Text("hello".into())]).await.unwrap();
    sink.wait_finished().await;
    assert_eq!(sink.updates(), vec![text("Hel"), text("lo"), done("end_turn")]);
    assert!(sink.updates.lock().unwrap().iter().all(|(chat, _)| chat == "c1"));
    manager.stop("c1").await.unwrap();
}

#[tokio::test]
async fn thoughts_and_tool_statuses_are_mapped() {
    let ws = workspace();
    let (manager, sink) = started("c1", &ws).await;
    manager.prompt("c1", vec![PromptPart::Text("think".into())]).await.unwrap();
    sink.wait_finished().await;
    let tool = |status| AgentUpdate::Tool {
        tool_call_id: "t9".into(),
        title: "Read brief".into(),
        status,
    };
    assert_eq!(
        sink.updates(),
        vec![
            AgentUpdate::Thought { text: "pondering".into() },
            tool(ToolCallStatus::Pending),
            tool(ToolCallStatus::Running),
            tool(ToolCallStatus::Done),
            done("end_turn"),
        ]
    );
    manager.stop("c1").await.unwrap();
}

#[tokio::test]
async fn install_allowed_runs_after_permission() {
    let ws = workspace();
    let (manager, sink) = started("c1", &ws).await;
    manager.prompt("c1", vec![PromptPart::Text("install".into())]).await.unwrap();
    let req = sink.wait_permission().await;
    assert_eq!(req.chat_id, "c1");
    assert_eq!(req.title, "Install FFmpeg");
    assert_eq!(req.commands, vec!["brew install ffmpeg".to_string()]);
    let kinds: Vec<_> = req.options.iter().map(|o| o.kind).collect();
    assert_eq!(kinds, vec![PermissionOptionKind::AllowOnce, PermissionOptionKind::RejectOnce]);
    assert_eq!(req.options[0].label, "Allow");
    // Nothing runs before the user answers.
    assert!(sink.texts().is_empty());

    let allow = req.options[0].id.clone();
    manager.respond_permission(&req.request_id, Some(allow)).unwrap();
    sink.wait_finished().await;
    assert_eq!(sink.texts(), vec!["installed".to_string()]);
    assert!(sink.updates().contains(&done("end_turn")));
    assert!(sink.updates().contains(&AgentUpdate::Tool {
        tool_call_id: "t1".into(),
        title: "Install FFmpeg".into(),
        status: ToolCallStatus::Done,
    }));
    // A request can be answered only once.
    assert!(manager.respond_permission(&req.request_id, None).is_err());
    manager.stop("c1").await.unwrap();
}

#[tokio::test]
async fn install_dismissed_is_cancelled_and_skipped() {
    let ws = workspace();
    let (manager, sink) = started("c1", &ws).await;
    manager.prompt("c1", vec![PromptPart::Text("install".into())]).await.unwrap();
    let req = sink.wait_permission().await;
    manager.respond_permission(&req.request_id, None).unwrap();
    sink.wait_finished().await;
    assert_eq!(sink.texts(), vec!["skipped".to_string()]);
    manager.stop("c1").await.unwrap();
}

#[tokio::test]
async fn install_rejected_is_skipped() {
    let ws = workspace();
    let (manager, sink) = started("c1", &ws).await;
    manager.prompt("c1", vec![PromptPart::Text("install".into())]).await.unwrap();
    let req = sink.wait_permission().await;
    let reject = req.options[1].id.clone();
    manager.respond_permission(&req.request_id, Some(reject)).unwrap();
    sink.wait_finished().await;
    assert_eq!(sink.texts(), vec!["skipped".to_string()]);
    manager.stop("c1").await.unwrap();
}

#[tokio::test]
async fn unknown_option_id_is_refused() {
    let ws = workspace();
    let (manager, sink) = started("c1", &ws).await;
    manager.prompt("c1", vec![PromptPart::Text("install".into())]).await.unwrap();
    let req = sink.wait_permission().await;
    assert!(manager.respond_permission(&req.request_id, Some("made-up".into())).is_err());
    // The request is still open and can be answered properly.
    manager.respond_permission(&req.request_id, None).unwrap();
    sink.wait_finished().await;
    assert_eq!(sink.texts(), vec!["skipped".to_string()]);
    manager.stop("c1").await.unwrap();
}

#[tokio::test]
async fn crash_mid_turn_reports_error() {
    let ws = workspace();
    let (manager, sink) = started("c1", &ws).await;
    manager.prompt("c1", vec![PromptPart::Text("crash".into())]).await.unwrap();
    sink.wait_for("error update", Duration::from_secs(5), |s| {
        s.updates().iter().any(|u| matches!(u, AgentUpdate::Error { .. }))
    })
    .await;
    assert_eq!(
        sink.updates().last().unwrap(),
        &AgentUpdate::Error { message: "The agent stopped unexpectedly".into() }
    );
    // The dead session refuses new prompts instead of hanging.
    assert!(manager.prompt("c1", vec![PromptPart::Text("hello".into())]).await.is_err());
    manager.stop("c1").await.unwrap();
}

#[tokio::test]
async fn fs_write_outside_cwd_is_refused() {
    let ws = workspace();
    let (manager, sink) = started("c1", &ws).await;
    manager.prompt("c1", vec![PromptPart::Text("fs-outside".into())]).await.unwrap();
    sink.wait_finished().await;
    let texts = sink.texts();
    assert_eq!(texts.len(), 1, "{texts:?}");
    assert!(texts[0].starts_with("fs-error"), "{texts:?}");
    assert!(texts[0].contains("outside the project folder"), "{texts:?}");
    let leaked: Vec<_> = std::fs::read_dir(&ws.parent)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with("tayang-outside"))
        .collect();
    assert!(leaked.is_empty(), "file written outside cwd");
    manager.stop("c1").await.unwrap();
}

#[tokio::test]
async fn fs_inside_cwd_writes_and_reads_lines() {
    let ws = workspace();
    let (manager, sink) = started("c1", &ws).await;
    manager.prompt("c1", vec![PromptPart::Text("fs-inside".into())]).await.unwrap();
    sink.wait_finished().await;
    assert_eq!(sink.texts(), vec!["read: \"two\\n\"".to_string()]);
    let written = std::fs::read_to_string(ws.cwd.join("notes").join("inside.txt")).unwrap();
    assert_eq!(written, "one\ntwo\nthree");
    manager.stop("c1").await.unwrap();
}

#[tokio::test]
async fn image_parts_are_sent_as_base64_with_mime() {
    let ws = workspace();
    let img = ws.cwd.join("frame.png");
    std::fs::write(&img, b"PNGDATA").unwrap();
    let (manager, sink) = started("c1", &ws).await;
    manager
        .prompt(
            "c1",
            vec![PromptPart::Image { path: img }, PromptPart::Text("look".into())],
        )
        .await
        .unwrap();
    sink.wait_finished().await;
    // base64("PNGDATA") == "UE5HREFUQQ=="
    assert_eq!(sink.texts(), vec!["image image/png UE5HREFUQQ==".to_string()]);
    manager.stop("c1").await.unwrap();
}

#[tokio::test]
async fn missing_image_fails_the_prompt_call() {
    let ws = workspace();
    let (manager, _sink) = started("c1", &ws).await;
    let res = manager
        .prompt("c1", vec![PromptPart::Image { path: ws.cwd.join("nope.png") }])
        .await;
    assert!(res.is_err());
    manager.stop("c1").await.unwrap();
}

#[tokio::test]
async fn cancel_ends_turn_with_cancelled() {
    let ws = workspace();
    let (manager, sink) = started("c1", &ws).await;
    manager.prompt("c1", vec![PromptPart::Text("wait".into())]).await.unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    manager.cancel("c1").await.unwrap();
    sink.wait_finished().await;
    assert_eq!(sink.updates(), vec![done("cancelled")]);
    manager.stop("c1").await.unwrap();
}

#[tokio::test]
async fn cancel_answers_pending_permission_with_cancelled() {
    let ws = workspace();
    let (manager, sink) = started("c1", &ws).await;
    manager.prompt("c1", vec![PromptPart::Text("install".into())]).await.unwrap();
    let req = sink.wait_permission().await;
    manager.cancel("c1").await.unwrap();
    sink.wait_finished().await;
    assert_eq!(sink.texts(), vec!["skipped".to_string()]);
    assert_eq!(sink.updates().last().unwrap(), &done("cancelled"));
    assert!(manager.respond_permission(&req.request_id, None).is_err());
    manager.stop("c1").await.unwrap();
}

#[tokio::test]
async fn stop_cancels_pending_permission_and_ends_turn() {
    let ws = workspace();
    let (manager, sink) = started("c1", &ws).await;
    manager.prompt("c1", vec![PromptPart::Text("install".into())]).await.unwrap();
    let req = sink.wait_permission().await;
    manager.stop("c1").await.unwrap();
    sink.wait_finished().await;
    assert_eq!(sink.updates().last().unwrap(), &done("cancelled"));
    assert!(!sink.texts().contains(&"installed".to_string()));
    assert!(manager.respond_permission(&req.request_id, None).is_err());
    assert!(manager.prompt("c1", vec![PromptPart::Text("hello".into())]).await.is_err());
}

#[tokio::test]
async fn sessions_are_independent_per_chat() {
    let ws = workspace();
    let manager = AcpManager::new();
    let a = Arc::new(RecordingSink::default());
    let b = Arc::new(RecordingSink::default());
    manager.start("a", &fake_agent(), &ws.cwd, a.clone()).await.unwrap();
    manager.start("b", &fake_agent(), &ws.cwd, b.clone()).await.unwrap();
    manager.prompt("a", vec![PromptPart::Text("hello".into())]).await.unwrap();
    manager.prompt("b", vec![PromptPart::Text("think".into())]).await.unwrap();
    a.wait_finished().await;
    b.wait_finished().await;
    assert_eq!(a.texts(), vec!["Hel".to_string(), "lo".to_string()]);
    assert!(b.texts().is_empty());
    assert!(b.updates.lock().unwrap().iter().all(|(chat, _)| chat == "b"));
    manager.stop("a").await.unwrap();
    manager.stop("b").await.unwrap();
}

#[tokio::test]
async fn unknown_chat_and_bad_command_are_errors() {
    let ws = workspace();
    let manager = AcpManager::new();
    assert!(manager.prompt("nope", vec![PromptPart::Text("hello".into())]).await.is_err());
    let sink = Arc::new(RecordingSink::default());
    let bad = vec!["tayang-definitely-not-a-binary".to_string()];
    assert!(manager.start("c1", &bad, &ws.cwd, sink.clone()).await.is_err());
    assert!(manager.start("c1", &[], &ws.cwd, sink).await.is_err());
}

#[cfg(unix)]
fn alive(pid: &str) -> bool {
    std::process::Command::new("kill")
        .args(["-0", pid])
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[cfg(unix)]
async fn agent_pids(manager: &AcpManager, sink: &RecordingSink) -> Vec<String> {
    manager.prompt("c1", vec![PromptPart::Text("pids".into())]).await.unwrap();
    sink.wait_finished().await;
    let line = sink.texts().pop().unwrap();
    let pids: Vec<String> = line.split_whitespace().skip(1).map(str::to_string).collect();
    assert_eq!(pids.len(), 2, "{line}");
    assert!(pids.iter().all(|p| alive(p)));
    pids
}

#[cfg(unix)]
async fn wait_dead(pids: &[String]) {
    let start = Instant::now();
    while pids.iter().any(|p| alive(p)) {
        assert!(start.elapsed() < Duration::from_secs(5), "processes still alive: {pids:?}");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

#[cfg(unix)]
#[tokio::test]
async fn stop_kills_the_agent_and_its_helpers() {
    let ws = workspace();
    let (manager, sink) = started("c1", &ws).await;
    let pids = agent_pids(&manager, &sink).await;
    manager.stop("c1").await.unwrap();
    wait_dead(&pids).await;
}

#[cfg(unix)]
#[tokio::test]
async fn dropping_the_manager_kills_the_agent() {
    let ws = workspace();
    let (manager, sink) = started("c1", &ws).await;
    let pids = agent_pids(&manager, &sink).await;
    drop(manager);
    wait_dead(&pids).await;
}
