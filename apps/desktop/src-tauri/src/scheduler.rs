//! Background scheduling: the 30 second tick, what closing the window does, and the tray menu.
//!
//! The UI decides what is due (reminders now, autopilot work in A4); Rust only keeps time, because
//! JS timers can be throttled while the window is hidden, and owns the window and tray.

use crate::types::{Settings, UiLanguage};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime, WindowEvent};

/// Event the main window receives on every tick; the payload is the time as RFC 3339 (UTC).
pub const TICK_EVENT: &str = "scheduler://tick";
/// Event the tray's "Pause all autopilots" item emits to the main window; the autopilot engine pauses them all.
pub const PAUSE_ALL_EVENT: &str = "autopilot://pause-all";
pub const TICK_SECS: u64 = 30;
const TRAY_ID: &str = "tayang";
/// Black template silhouette: macOS tints it for light and dark menu bars.
#[cfg(target_os = "macos")]
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray.png");
/// Windows and Linux panels are often dark, so they get the colour icon.
#[cfg(not(target_os = "macos"))]
const TRAY_ICON: &[u8] = include_bytes!("../icons/32x32.png");
/// Passed by "Open at login" so a login launch starts in the tray instead of showing the window.
pub const HIDDEN_ARG: &str = "--hidden";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseAction {
    /// Keep running: hide the window, leave the tray icon to bring it back.
    Hide,
    /// Close as usual; the app quits when its last window is gone.
    Quit,
}

/// Hides only when there is a tray icon to bring the window back; otherwise closing quits as usual.
pub fn close_action(background_mode: bool, has_tray: bool) -> CloseAction {
    if background_mode && has_tray {
        CloseAction::Hide
    } else {
        CloseAction::Quit
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayLabels {
    pub open: &'static str,
    pub pause_all: &'static str,
    pub quit: &'static str,
}

pub fn tray_labels(lang: Option<UiLanguage>) -> TrayLabels {
    match lang {
        Some(UiLanguage::Id) => TrayLabels { open: "Buka Tayang", pause_all: "Jeda semua autopilot", quit: "Keluar" },
        _ => TrayLabels { open: "Open Tayang", pause_all: "Pause all autopilots", quit: "Quit" },
    }
}

/// Calls `emit` once per `period`, forever (the first call comes one period after the start).
pub async fn run_ticker<F: FnMut()>(period: Duration, mut emit: F) {
    let mut interval = tokio::time::interval_at(tokio::time::Instant::now() + period, period);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        interval.tick().await;
        emit();
    }
}

/// Starts the ticker: every 30 s the main window gets `scheduler://tick`, hidden or not.
pub fn start_ticker<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        run_ticker(Duration::from_secs(TICK_SECS), || {
            let _ = app.emit_to("main", TICK_EVENT, chrono::Utc::now().to_rfc3339());
        })
        .await;
    });
}

pub fn launched_hidden(args: &[String]) -> bool {
    args.iter().any(|a| a == HIDDEN_ARG)
}

pub fn has_tray<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.tray_by_id(TRAY_ID).is_some()
}

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn tray_menu<R: Runtime>(app: &AppHandle<R>, lang: Option<UiLanguage>) -> tauri::Result<Menu<R>> {
    let l = tray_labels(lang);
    let open = MenuItem::with_id(app, "open", l.open, true, None::<&str>)?;
    // The autopilot engine (state/autopilot.ts) pauses every autopilot on `PAUSE_ALL_EVENT`.
    let pause = MenuItem::with_id(app, "pause-all", l.pause_all, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", l.quit, true, None::<&str>)?;
    Menu::with_items(app, &[&open, &pause, &PredefinedMenuItem::separator(app)?, &quit])
}

/// Makes the tray icon (a template image on macOS) with its menu.
pub fn build_tray<R: Runtime>(app: &AppHandle<R>, settings: &Settings) -> tauri::Result<TrayIcon<R>> {
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(tauri::image::Image::from_bytes(TRAY_ICON)?)
        .icon_as_template(true)
        .menu(&tray_menu(app, settings.ui_language)?)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "pause-all" => {
                let _ = app.emit_to("main", PAUSE_ALL_EVENT, ());
            }
            // Really quits, even with background mode on.
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)
}

/// What `update_settings` returns when background mode can't make its tray; the UI says it in the
/// user's language.
pub const TRAY_UNAVAILABLE: &str = "tray-unavailable";

/// Builds the tray without letting a crash in the platform tray library (Linux loads AppIndicator
/// lazily and panics when it is missing) take the app down: a panic is an error like any other.
pub fn try_build_tray<R: Runtime>(app: &AppHandle<R>, settings: &Settings) -> Result<(), String> {
    guarded(|| build_tray(app, settings).map(|_| ()).map_err(|e| e.to_string()))
}

/// Runs `f`, turning a panic into an error.
pub fn guarded(f: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(r) => r,
        Err(p) => Err(p
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| p.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "the tray library crashed".into())),
    }
}

/// The tray exists only while background mode is on: made when it is turned on (and kept in the
/// menu language), removed when it is turned off. Errors when background mode is on and no tray
/// can be made; the caller turns background mode back off, and the window then closes normally
/// (see `close_action`) and is never hidden.
pub fn sync_tray<R: Runtime>(app: &AppHandle<R>, settings: &Settings) -> Result<(), String> {
    if !settings.background_mode {
        let _ = app.remove_tray_by_id(TRAY_ID);
    } else if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Ok(menu) = tray_menu(app, settings.ui_language) {
            let _ = tray.set_menu(Some(menu));
        }
    } else if let Err(e) = try_build_tray(app, settings) {
        eprintln!("Tayang: couldn't create the tray icon, background mode is off: {e}");
        return Err(e);
    }
    Ok(())
}

/// Background mode without a tray would hide the window with no way back: turn it (and the login
/// item that needs it) off in the database.
pub fn background_off(db: &crate::db::Db) -> Result<Settings, String> {
    db.update_settings(serde_json::json!({ "backgroundMode": false, "openAtLogin": false }))
        .map_err(|e| e.to_string())
}

/// Window close: hides instead of closing while background mode is on and the tray exists. The
/// setting is read only for a close request, and live. Quitting (Cmd+Q, the tray's Quit) goes
/// through `app.exit` / `ExitRequested`, not through here, so it is unaffected.
pub fn on_window_event<R: Runtime>(window: &tauri::Window<R>, event: &WindowEvent, background_mode: impl FnOnce() -> bool) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == "main" && close_action(background_mode(), has_tray(window.app_handle())) == CloseAction::Hide {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[tokio::test(start_paused = true)]
    async fn the_ticker_fires_once_per_period() {
        let count = Arc::new(AtomicUsize::new(0));
        let c = count.clone();
        let task = tokio::spawn(run_ticker(Duration::from_secs(30), move || {
            c.fetch_add(1, Ordering::SeqCst);
        }));
        tokio::time::sleep(Duration::from_secs(29)).await;
        assert_eq!(count.load(Ordering::SeqCst), 0, "not before the first period");
        tokio::time::sleep(Duration::from_secs(2)).await;
        assert_eq!(count.load(Ordering::SeqCst), 1);
        tokio::time::sleep(Duration::from_secs(90)).await;
        assert_eq!(count.load(Ordering::SeqCst), 4);
        task.abort();
    }

    #[test]
    fn a_crash_while_making_the_tray_is_an_error_not_a_crash() {
        let hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let r = guarded(|| panic!("Failed to load ayatana-appindicator3 or appindicator3 dynamic library"));
        let s = guarded(|| panic!("{}", String::from("owned message")));
        std::panic::set_hook(hook);
        assert_eq!(r.unwrap_err(), "Failed to load ayatana-appindicator3 or appindicator3 dynamic library");
        assert_eq!(s.unwrap_err(), "owned message");
        assert_eq!(guarded(|| Ok(())), Ok(()));
        assert_eq!(guarded(|| Err("no tray".into())), Err("no tray".to_string()));
    }

    #[test]
    fn background_off_turns_off_the_login_item_too() {
        let db = crate::db::Db::open_in_memory().unwrap();
        let home = std::path::PathBuf::from("/home/u");
        let _ = db.get_settings(&home);
        db.update_settings(serde_json::json!({ "backgroundMode": true, "openAtLogin": true })).unwrap();
        let s = background_off(&db).unwrap();
        assert!(!s.background_mode && !s.open_at_login);
    }

    #[test]
    fn closing_hides_only_in_background_mode() {
        assert_eq!(close_action(true, true), CloseAction::Hide);
        assert_eq!(close_action(false, true), CloseAction::Quit);
        // No tray icon means nothing could bring a hidden window back.
        assert_eq!(close_action(true, false), CloseAction::Quit);
        assert_eq!(close_action(false, false), CloseAction::Quit);
    }

    #[test]
    fn the_linux_deb_depends_on_appindicator_and_autostart_passes_the_hidden_flag() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let depends = conf["bundle"]["linux"]["deb"]["depends"].as_array().unwrap();
        assert!(depends.iter().any(|d| d == "libayatana-appindicator3-1"));
        let rpm = conf["bundle"]["linux"]["rpm"]["depends"].as_array().unwrap();
        assert!(rpm.iter().any(|d| d == "libayatana-appindicator-gtk3"));
        let caps = include_str!("../capabilities/default.json");
        assert!(!caps.contains("allow-is-enabled"), "unused permission");
        assert_eq!(HIDDEN_ARG, "--hidden");
    }

    #[test]
    fn a_hidden_launch_is_recognised() {
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(launched_hidden(&args(&["tayang", "--hidden"])));
        assert!(!launched_hidden(&args(&["tayang"])));
    }

    #[test]
    fn tray_labels_follow_the_interface_language() {
        assert_eq!(tray_labels(Some(UiLanguage::Id)).quit, "Keluar");
        assert_eq!(tray_labels(Some(UiLanguage::En)).open, "Open Tayang");
        assert_eq!(tray_labels(None), tray_labels(Some(UiLanguage::En)));
    }

    #[test]
    fn the_tray_icon_is_a_32px_png() {
        assert_eq!(&TRAY_ICON[..8], b"\x89PNG\r\n\x1a\n");
        assert_eq!(u32::from_be_bytes(TRAY_ICON[16..20].try_into().unwrap()), 32);
        assert_eq!(u32::from_be_bytes(TRAY_ICON[20..24].try_into().unwrap()), 32);
    }
}
