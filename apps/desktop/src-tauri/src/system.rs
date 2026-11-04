//! Detects the OS, installed AI agents and the tools video rendering needs.

use crate::types::*;
use std::path::{Path, PathBuf};

pub trait Exec {
    fn run(&self, program: &str, args: &[&str]) -> Option<String>;
    fn which(&self, program: &str) -> Option<PathBuf>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[derive(Default)]
    struct FakeExec {
        out: HashMap<String, String>,
    }
    impl FakeExec {
        fn with(mut self, prog: &str, out: &str) -> Self {
            self.out.insert(prog.to_string(), out.to_string());
            self
        }
    }
    impl Exec for FakeExec {
        fn run(&self, program: &str, _args: &[&str]) -> Option<String> {
            self.out.get(program).cloned()
        }
        fn which(&self, program: &str) -> Option<PathBuf> {
            self.out.get(program).map(|_| PathBuf::from(format!("/bin/{program}")))
        }
    }

    #[test]
    fn parse_version_cases() {
        assert_eq!(parse_version("v22.12.0").as_deref(), Some("22.12.0"));
        assert_eq!(parse_version("ffmpeg version n7.1-tessus").as_deref(), Some("7.1"));
        assert_eq!(
            parse_version("ffmpeg version 7.1.1-full_build-www.gyan.dev").as_deref(),
            Some("7.1.1")
        );
        assert_eq!(parse_version("2026.10.22").as_deref(), Some("2026.10.22"));
        assert_eq!(parse_version("nope"), None);
        assert_eq!(parse_version("build 7 then 1.2"), Some("1.2".to_string()));
    }

    fn tool(list: &[ToolStatus], id: ToolId) -> &ToolStatus {
        list.iter().find(|t| t.id == id).unwrap()
    }

    #[test]
    fn old_node_is_not_ok() {
        let ex = FakeExec::default().with("node", "v20.11.0");
        let t = check_tools(&ex, AgentId::Claude, Path::new("/nonexistent"));
        let n = tool(&t, ToolId::Node);
        assert!(n.found && !n.ok && n.required);
        assert_eq!(n.version.as_deref(), Some("20.11.0"));
        assert_eq!(n.detail, "Runs the video engine · needs 22 or newer");
    }

    #[test]
    fn new_node_is_ok() {
        let ex = FakeExec::default().with("node", "v22.1.0");
        let t = check_tools(&ex, AgentId::Claude, Path::new("/nonexistent"));
        assert!(tool(&t, ToolId::Node).ok);
    }

    #[test]
    fn missing_ffmpeg_is_not_found() {
        let ex = FakeExec::default();
        let t = check_tools(&ex, AgentId::Claude, Path::new("/nonexistent"));
        assert_eq!(t.len(), 5);
        let f = tool(&t, ToolId::Ffmpeg);
        assert!(!f.found && !f.ok && f.required && f.version.is_none());
        assert!(!tool(&t, ToolId::Ytdlp).required);
    }

    #[test]
    fn elevenlabs_config_detection() {
        assert!(elevenlabs_in_claude_config(r#"{"mcpServers":{"elevenlabs":{}}}"#));
        assert!(elevenlabs_in_claude_config(
            r#"{"projects":{"/a":{"mcpServers":{"my-ElevenLabs-tts":{}}}}}"#
        ));
        assert!(!elevenlabs_in_claude_config("{}"));
        assert!(!elevenlabs_in_claude_config(r#"{"mcpServers":{"other":{}}}"#));
        assert!(!elevenlabs_in_claude_config("not json"));
    }

    #[test]
    fn non_claude_agent_elevenlabs_hint() {
        let ex = FakeExec::default();
        let t = check_tools(&ex, AgentId::Gemini, Path::new("/nonexistent"));
        let e = tool(&t, ToolId::ElevenlabsMcp);
        assert!(!e.found);
        assert_eq!(e.detail, "Check your agent's MCP settings");
    }

    #[test]
    fn detect_agents_only_claude() {
        let ex = FakeExec::default().with("claude", "2.1.3 (Claude Code)");
        let a = detect_agents(&ex);
        let ids: Vec<_> = a.iter().map(|x| x.id).collect();
        assert_eq!(ids, [AgentId::Claude, AgentId::Opencode, AgentId::Gemini, AgentId::Codex]);
        assert!(a[0].installed && a[0].recommended);
        assert_eq!(a[0].version.as_deref(), Some("2.1.3"));
        assert_eq!(a[0].acp_command, ["npx", "-y", "@agentclientprotocol/claude-agent-acp"]);
        assert!(a[1..].iter().all(|x| !x.installed && x.version.is_none() && !x.recommended));
        assert_eq!(a[2].acp_command, ["gemini", "--experimental-acp"]);
    }

    #[test]
    fn package_manager_first_found() {
        let ex = FakeExec::default().with("brew", "x").with("dnf", "x").with("apt", "x");
        let s = system_info(&ex);
        if cfg!(target_os = "linux") {
            assert_eq!(s.package_manager, Some(PackageManager::Apt));
        } else if cfg!(target_os = "macos") {
            assert_eq!(s.package_manager, Some(PackageManager::Brew));
        }
    }
}
