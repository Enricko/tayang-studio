//! Agent Client Protocol client: drives the user's coding agent over stdio.

use crate::types::{AgentUpdate, PermissionRequest};
use std::path::{Path, PathBuf};
use std::sync::Arc;

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
