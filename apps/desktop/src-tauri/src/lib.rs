pub mod acp;
pub mod db;
pub mod media;
pub mod projects;
pub mod system;
pub mod types;

#[tauri::command]
fn list_projects() -> Vec<serde_json::Value> {
    // Placeholder until the project store lands.
    Vec::new()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![list_projects])
        .run(tauri::generate_context!())
        .expect("error while running Tayang Studio");
}
