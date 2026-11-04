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
            // Records the real home so later settings updates resolve defaults against it.
            db.get_settings(&home);
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
        ])
        .build(tauri::generate_context!())
        .expect("error while building Tayang Studio");
    app.run(|_handle, _event| {});
}
