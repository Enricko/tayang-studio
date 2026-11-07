//! The platform-independent Tayang backend: SQLite, ACP agent processes, project files and media.
//!
//! Both the desktop Tauri app and the headless web server depend on this crate. Nothing here starts a
//! window, reads an OS keychain, or needs a graphical session.

pub mod acp;
pub mod claude_account;
pub mod db;
pub mod files;
pub mod media;
pub mod projects;
pub mod service;
pub mod styles_sync;
pub mod system;
pub mod types;
pub mod usage;
