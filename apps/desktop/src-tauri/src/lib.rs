pub mod acp;
pub mod commands;
pub mod db;
pub mod media;
pub mod projects;
pub mod system;
pub mod types;

use commands::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let home = app.path().home_dir()?;
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            let db = db::Db::open(&data.join("tayang.db"))?;
            // Also records the real home so later settings updates resolve defaults against it.
            let working = db.get_settings(&home).working_folder;
            commands::allow_working_folder(app.handle(), &working);
            app.manage(AppState {
                db,
                acp: acp::AcpManager::new(),
                media: media::MediaTools::from_env_or_path(),
                home,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_system_info,
            commands::detect_agents,
            commands::check_tools,
            commands::get_settings,
            commands::update_settings,
            commands::pick_folder,
            commands::list_projects,
            commands::create_project,
            commands::update_project,
            commands::list_chats,
            commands::get_chat,
            commands::create_chat,
            commands::list_messages,
            commands::add_message,
            commands::list_styles,
            commands::save_style,
            commands::delete_style,
            commands::read_style_result,
            commands::study_dir,
            commands::list_jobs,
            commands::upsert_job,
            commands::agent_start,
            commands::agent_prompt,
            commands::agent_cancel,
            commands::agent_respond_permission,
            commands::media_latest_render,
            commands::media_probe,
            commands::media_extract_frame,
            commands::media_thumbnails,
            commands::media_render,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Tayang Studio");
    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
            // Don't leave agent processes behind.
            if let Some(state) = handle.try_state::<AppState>() {
                tauri::async_runtime::block_on(state.acp.stop_all());
            }
        }
    });
}
