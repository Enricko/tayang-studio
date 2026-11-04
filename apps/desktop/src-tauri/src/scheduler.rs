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
/// Event the tray's "Pause all autopilots" item emits to the main window (disabled until A4).
pub const PAUSE_ALL_EVENT: &str = "autopilot://pause-all";
pub const TICK_SECS: u64 = 30;
const TRAY_ID: &str = "tayang";
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray.png");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseAction {
    /// Keep running: hide the window, leave the tray icon to bring it back.
    Hide,
    /// Close as usual; the app quits when its last window is gone.
    Quit,
}

pub fn close_action(background_mode: bool) -> CloseAction {
    if background_mode {
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
    // Stays disabled until the autopilot engine (A4) handles `PAUSE_ALL_EVENT`.
    let pause = MenuItem::with_id(app, "pause-all", l.pause_all, false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", l.quit, true, None::<&str>)?;
    Menu::with_items(app, &[&open, &pause, &PredefinedMenuItem::separator(app)?, &quit])
}

/// Makes the tray icon (a template image on macOS) with its menu; hidden until background mode is on.
pub fn build_tray<R: Runtime>(app: &AppHandle<R>, settings: &Settings) -> tauri::Result<TrayIcon<R>> {
    let tray = TrayIconBuilder::with_id(TRAY_ID)
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
        .build(app)?;
    tray.set_visible(settings.background_mode)?;
    Ok(tray)
}

/// Brings the tray in line with the settings (visibility and menu language).
pub fn sync_tray<R: Runtime>(app: &AppHandle<R>, settings: &Settings) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_visible(settings.background_mode);
        if let Ok(menu) = tray_menu(app, settings.ui_language) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

/// Window close: hides instead of closing while background mode is on. Quitting (Cmd+Q, the tray's
/// Quit) goes through `app.exit` / `ExitRequested`, not through here, so it is unaffected.
pub fn on_window_event<R: Runtime>(window: &tauri::Window<R>, event: &WindowEvent, background_mode: bool) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == "main" && close_action(background_mode) == CloseAction::Hide {
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
    fn closing_hides_only_in_background_mode() {
        assert_eq!(close_action(true), CloseAction::Hide);
        assert_eq!(close_action(false), CloseAction::Quit);
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
