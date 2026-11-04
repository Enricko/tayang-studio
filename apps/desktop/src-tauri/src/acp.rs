//! Agent Client Protocol client: drives the user's coding agent over stdio.
//!
//! Hand-rolled newline-delimited JSON-RPC 2.0 following the ACP v1 schema
//! (https://agentclientprotocol.com). One agent process per chat.

use crate::types::{AgentUpdate, PermissionRequest};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcpError(pub String);

impl std::fmt::Display for AcpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for AcpError {}

pub type Result<T> = std::result::Result<T, AcpError>;

/// Receives everything the agent streams back.
pub trait AcpSink: Send + Sync {
    fn update(&self, chat_id: &str, u: AgentUpdate);
    fn permission(&self, req: PermissionRequest);
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PromptPart {
    Text(String),
    Image { path: PathBuf },
}

// ---------------------------------------------------------------------------
// JSON-RPC transport
// ---------------------------------------------------------------------------

const INVALID_PARAMS: i64 = -32602;
const METHOD_NOT_FOUND: i64 = -32601;
const INTERNAL_ERROR: i64 = -32603;
/// Local-only code for "the connection is gone"; never sent over the wire.
const CONNECTION_CLOSED: i64 = -1;

#[derive(Debug, Clone, PartialEq, Eq)]
struct RpcError {
    code: i64,
    message: String,
}

impl RpcError {
    fn new(code: i64, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }

    fn closed() -> Self {
        Self::new(CONNECTION_CLOSED, "connection closed")
    }

    fn is_closed(&self) -> bool {
        self.code == CONNECTION_CLOSED
    }
}

type RpcResult = std::result::Result<Value, RpcError>;

/// One decoded line from the agent.
#[derive(Debug, PartialEq)]
enum Incoming {
    Request { id: Value, method: String, params: Value },
    Notification { method: String, params: Value },
    Response { id: u64, result: RpcResult },
}

fn parse_message(line: &str) -> Option<Incoming> {
    let mut v: Value = serde_json::from_str(line).ok()?;
    let obj = v.as_object_mut()?;
    let params = obj.remove("params").unwrap_or(Value::Null);
    match (obj.remove("method"), obj.remove("id")) {
        (Some(Value::String(method)), Some(id)) if !id.is_null() => {
            Some(Incoming::Request { id, method, params })
        }
        (Some(Value::String(method)), _) => Some(Incoming::Notification { method, params }),
        (None, Some(id)) => {
            let id = id.as_u64()?;
            let result = match obj.remove("error") {
                Some(err) if !err.is_null() => Err(RpcError::new(
                    err.get("code").and_then(Value::as_i64).unwrap_or(INTERNAL_ERROR),
                    err.get("message").and_then(Value::as_str).unwrap_or("agent error"),
                )),
                _ => Ok(obj.remove("result").unwrap_or(Value::Null)),
            };
            Some(Incoming::Response { id, result })
        }
        _ => None,
    }
}

#[derive(Default)]
struct Waiters {
    closed: bool,
    map: HashMap<u64, oneshot::Sender<RpcResult>>,
}

/// Outgoing half of the connection plus the table of in-flight requests.
struct Rpc {
    out: mpsc::UnboundedSender<String>,
    waiters: Mutex<Waiters>,
    next_id: AtomicU64,
}

impl Rpc {
    fn new(out: mpsc::UnboundedSender<String>) -> Self {
        Self { out, waiters: Mutex::new(Waiters::default()), next_id: AtomicU64::new(1) }
    }

    fn send(&self, msg: Value) -> std::result::Result<(), RpcError> {
        self.out.send(msg.to_string()).map_err(|_| RpcError::closed())
    }

    async fn request(&self, method: &str, params: Value) -> RpcResult {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        {
            let mut w = self.waiters.lock().unwrap();
            if w.closed {
                return Err(RpcError::closed());
            }
            w.map.insert(id, tx);
        }
        let msg = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        if let Err(e) = self.send(msg) {
            self.waiters.lock().unwrap().map.remove(&id);
            return Err(e);
        }
        rx.await.unwrap_or_else(|_| Err(RpcError::closed()))
    }

    fn notify(&self, method: &str, params: Value) -> std::result::Result<(), RpcError> {
        if self.is_closed() {
            return Err(RpcError::closed());
        }
        self.send(json!({ "jsonrpc": "2.0", "method": method, "params": params }))
    }

    fn respond(&self, id: Value, result: RpcResult) {
        let msg = match result {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err(e) => json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": e.code, "message": e.message },
            }),
        };
        // A closed connection has nobody left to answer.
        let _ = self.send(msg);
    }

    fn resolve(&self, id: u64, result: RpcResult) {
        if let Some(tx) = self.waiters.lock().unwrap().map.remove(&id) {
            let _ = tx.send(result);
        }
    }

    fn is_closed(&self) -> bool {
        self.waiters.lock().unwrap().closed
    }

    /// Fails every in-flight request; later requests fail immediately.
    fn close(&self) {
        let drained: Vec<_> = {
            let mut w = self.waiters.lock().unwrap();
            w.closed = true;
            w.map.drain().map(|(_, tx)| tx).collect()
        };
        for tx in drained {
            let _ = tx.send(Err(RpcError::closed()));
        }
    }
}

async fn write_loop(mut stdin: ChildStdin, mut rx: mpsc::UnboundedReceiver<String>) {
    while let Some(line) = rx.recv().await {
        let ok = stdin.write_all(line.as_bytes()).await.is_ok()
            && stdin.write_all(b"\n").await.is_ok()
            && stdin.flush().await.is_ok();
        if !ok {
            break;
        }
    }
}

/// The agent's stderr is diagnostics only: drain it so the pipe never fills.
async fn drain_stderr(stderr: impl AsyncRead + Unpin, label: String) {
    let mut lines = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        eprintln!("[agent {label}] {line}");
    }
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn spawn_agent(command: &[String], cwd: &Path) -> Result<Child> {
    let (program, args) = command
        .split_first()
        .ok_or_else(|| AcpError("No agent command was given".into()))?;
    let mut cmd = Command::new(program);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // Own process group, so stopping also reaches helpers such as the
    // package an `npx` launcher starts.
    #[cfg(unix)]
    cmd.process_group(0);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.spawn()
        .map_err(|e| AcpError(format!("Could not start the agent ({program}): {e}")))
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

pub struct AgentSession;

#[derive(Default)]
pub struct AcpManager;

impl AcpManager {
    pub fn new() -> Self {
        Self
    }

    pub async fn start(
        &self,
        _chat_id: &str,
        _command: &[String],
        _cwd: &Path,
        _sink: Arc<dyn AcpSink>,
    ) -> Result<()> {
        Err(AcpError("not implemented".into()))
    }

    pub async fn prompt(&self, _chat_id: &str, _parts: Vec<PromptPart>) -> Result<()> {
        Err(AcpError("not implemented".into()))
    }

    pub fn respond_permission(&self, _request_id: &str, _option_id: Option<String>) -> Result<()> {
        Err(AcpError("not implemented".into()))
    }

    pub async fn cancel(&self, _chat_id: &str) -> Result<()> {
        Err(AcpError("not implemented".into()))
    }

    pub async fn stop(&self, _chat_id: &str) -> Result<()> {
        Err(AcpError("not implemented".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_requests_notifications_and_responses() {
        let req = parse_message(
            r#"{"jsonrpc":"2.0","id":"a1","method":"fs/read_text_file","params":{"path":"/x"}}"#,
        );
        assert_eq!(
            req,
            Some(Incoming::Request {
                id: json!("a1"),
                method: "fs/read_text_file".into(),
                params: json!({"path": "/x"}),
            })
        );
        let note = parse_message(r#"{"jsonrpc":"2.0","method":"session/update","params":{}}"#);
        assert_eq!(
            note,
            Some(Incoming::Notification { method: "session/update".into(), params: json!({}) })
        );
        let ok = parse_message(r#"{"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}"#);
        assert_eq!(
            ok,
            Some(Incoming::Response { id: 3, result: Ok(json!({"stopReason": "end_turn"})) })
        );
        let err = parse_message(r#"{"jsonrpc":"2.0","id":4,"error":{"code":-32000,"message":"auth"}}"#);
        assert_eq!(
            err,
            Some(Incoming::Response { id: 4, result: Err(RpcError::new(-32000, "auth")) })
        );
        assert_eq!(parse_message("not json"), None);
        assert_eq!(parse_message("[1,2]"), None);
    }

    #[tokio::test]
    async fn requests_resolve_by_id_and_fail_when_closed() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let rpc = Arc::new(Rpc::new(tx));
        let r = rpc.clone();
        let call = tokio::spawn(async move { r.request("initialize", json!({"a": 1})).await });
        let sent: Value = serde_json::from_str(&rx.recv().await.unwrap()).unwrap();
        assert_eq!(sent["method"], "initialize");
        assert_eq!(sent["jsonrpc"], "2.0");
        rpc.resolve(sent["id"].as_u64().unwrap(), Ok(json!(7)));
        assert_eq!(call.await.unwrap(), Ok(json!(7)));

        let r = rpc.clone();
        let call = tokio::spawn(async move { r.request("session/prompt", json!({})).await });
        rx.recv().await.unwrap();
        rpc.close();
        assert!(call.await.unwrap().unwrap_err().is_closed());
        assert!(rpc.request("x", json!({})).await.unwrap_err().is_closed());
        assert!(rpc.notify("session/cancel", json!({})).is_err());
    }
}
