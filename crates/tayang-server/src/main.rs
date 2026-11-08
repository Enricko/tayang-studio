mod action_proxy;
mod agent;
mod api;
mod assets;
mod auth;
mod config;
mod events;
mod orchestrator;
mod paths;
mod sse;
mod state;
mod upload;
mod web_db;

use axum::extract::{DefaultBodyLimit, Request};
use axum::http::HeaderValue;
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::{get, post};
use axum::{Json, Router};
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

async fn security_headers(req: Request, next: Next) -> Response {
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    h.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    h.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    h.insert("x-frame-options", HeaderValue::from_static("DENY"));
    h.insert("cross-origin-resource-policy", HeaderValue::from_static("same-origin"));
    h.insert("permissions-policy", HeaderValue::from_static("camera=(), microphone=(), geolocation=()"));
    h.insert(
        "content-security-policy",
        HeaderValue::from_static(
            "default-src 'self'; img-src 'self' data: blob: https://i.ytimg.com https://studio.tayang.app; \
             media-src 'self' blob: https://studio.tayang.app; style-src 'self' 'unsafe-inline'; \
             font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        ),
    );
    res
}

fn prepare_workspace(state: &state::AppState) -> Result<(), String> {
    for dir in [
        state.data_dir.clone(),
        state.config.workspace_root.clone(),
        state.data_dir.join("style-media"),
        state.data_dir.join("style-refs"),
        state.data_dir.join("thumbs"),
        state.data_dir.join("templates"),
        state.data_dir.join("tmp"),
        state.data_dir.join("model-probe"),
        state.data_dir.join("claude"),
    ] {
        std::fs::create_dir_all(&dir).map_err(|e| format!("Can't create {}: {e}", dir.display()))?;
    }
    let wanted = crate::paths::canonical_dir(&config::default_working_folder(&state.config.workspace_root))
        .map_err(|e| format!("Can't create the working folder: {e}"))?;
    let now = state.db.get_settings(&state.home);
    if now.working_folder.trim().is_empty() || !paths::in_workspace(state, std::path::Path::new(&now.working_folder)) {
        // First run, or a database copied from a desktop whose folder is outside this server's root.
        state
            .db
            .update_settings(serde_json::json!({ "workingFolder": wanted.to_string_lossy() }))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

async fn version() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "version": env!("CARGO_PKG_VERSION"), "edition": "web" }))
}

async fn api_not_found() -> impl axum::response::IntoResponse {
    (
        axum::http::StatusCode::NOT_FOUND,
        Json(serde_json::json!({ "error": "not-found", "message": "No such API route" })),
    )
}

#[tokio::main]
async fn main() {
    // `tayang-server hash-password` makes a PHC hash for TAYANG_WEB_PASSWORD_HASH without putting the
    // plaintext password in a shell history-friendly env file.
    if std::env::args().nth(1).as_deref() == Some("hash-password") {
        let password = std::env::var("TAYANG_WEB_PASSWORD").ok().or_else(|| {
            eprintln!("reading the password from stdin");
            let mut line = String::new();
            std::io::stdin().read_line(&mut line).ok()?;
            Some(line.trim_end_matches(['\r', '\n']).to_string())
        });
        match password {
            Some(p) => match auth::hash_password(&p) {
                Ok(hash) => println!("{hash}"),
                Err(e) => {
                    eprintln!("{e}");
                    std::process::exit(1);
                }
            },
            None => {
                eprintln!("set TAYANG_WEB_PASSWORD or pipe a password on stdin");
                std::process::exit(1);
            }
        }
        return;
    }

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,tower_http=info")))
        .init();

    let config = match config::Config::from_env() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("{e}");
            std::process::exit(2);
        }
    };
    let data = config.data_dir.clone();
    let home = std::env::var_os("TAYANG_HOME").map(std::path::PathBuf::from).unwrap_or_else(|| data.join("home"));
    std::fs::create_dir_all(&home).ok();
    std::fs::create_dir_all(&config.workspace_root).ok();
    let db = match tayang_core::db::Db::open(&data.join("tayang.db")) {
        Ok(db) => db,
        Err(e) => {
            tracing::error!("can't open {}: {e}", data.join("tayang.db").display());
            std::process::exit(2);
        }
    };
    if let Err(e) = web_db::init(&db) {
        tracing::error!("can't create the web tables: {e}");
        std::process::exit(2);
    }
    // Honest restart: no agent survives, and half-finished turns/slots are marked, not resumed.
    web_db::mark_interrupted(&db, "Tayang server restarted while this was running");
    web_db::prune_events(&db, 7);
    let usage = tayang_core::usage::UsageCache::default();
    let (action_tx, mut action_rx) = tokio::sync::mpsc::unbounded_channel();
    let action_proxy = match action_proxy::ActionProxy::start(action_tx).await {
        Ok(proxy) => Some(proxy),
        Err(e) => {
            tracing::error!("agent action endpoint couldn't start: {e}");
            None
        }
    };
    let state = Arc::new(state::AppState {
        config: config.clone(),
        db,
        home,
        data_dir: data.clone(),
        acp: tayang_core::acp::AcpManager::new(),
        media: tayang_core::media::MediaTools::from_env_or_path(),
        usage,
        events: events::EventBus::default(),
        agent: agent::AgentHub::default(),
        login_limiter: auth::LoginLimiter::default(),
        render_locks: tokio::sync::Mutex::new(Default::default()),
        study_working: Default::default(),
        claude_sign_in: Default::default(),
        autopilot_lock: tokio::sync::Mutex::new(()),
        autopilot_current: Default::default(),
        action_proxy,
        started_at: chrono::Utc::now(),
    });
    if let Err(e) = prepare_workspace(&state) {
        tracing::error!("{e}");
        std::process::exit(2);
    }
    // Deliver the agent's /video and /schedule calls to the connected tabs. The agent keeps working
    // if no tab is open; the action stays in this process and is emitted when a tab reconnects? It
    // is a one-shot command, so log it instead of pretending a missing tab started a video.
    {
        let emitter = state.clone();
        tokio::spawn(async move {
            while let Some(action) = action_rx.recv().await {
                emitter.events.emit(
                    &emitter.db,
                    "agent://action",
                    serde_json::to_value(action).unwrap_or(serde_json::Value::Null),
                );
            }
        });
    }

    let protected = Router::new()
        .route("/api/rpc", post(api::rpc))
        .route("/api/capabilities", get(api::capabilities))
        .route("/api/assets", get(assets::serve).head(assets::serve))
        .route(
            "/api/upload",
            post(upload::upload).layer(DefaultBodyLimit::max(config.max_upload + 1024 * 1024)),
        )
        .route(
            "/api/projects/upload",
            post(upload::upload_project).layer(DefaultBodyLimit::max(config.max_upload + 1024 * 1024)),
        )
        .route("/api/events/latest", get(sse::latest))
        .route("/api/events", get(sse::events))
        .route("/api/auth/logout", post(auth::logout))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::require_auth));

    let public = Router::new()
        .route("/api/health", get(api::health))
        .route("/api/version", get(version))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/me", get(auth::me))
        .route("/api/{*rest}", axum::routing::any(api_not_found));

    let index = config.dist_dir.join("index.html");
    let static_files = ServeDir::new(&config.dist_dir)
        .append_index_html_on_directories(true)
        .not_found_service(ServeFile::new(&index));

    let app = public
        .merge(protected)
        .fallback_service(static_files)
        .layer(middleware::from_fn(security_headers))
        .layer(TraceLayer::new_for_http())
        .with_state(state.clone());

    // Start the server-owned clock and orchestrator. It does not depend on any browser connection.
    let (stop_tx, mut stop_rx) = tokio::sync::watch::channel(false);
    let tick_state = state.clone();
    let tick_secs = config.tick_secs;
    tokio::spawn(async move {
        let mut first = true;
        let mut last_prune = chrono::Utc::now();
        loop {
            if !first {
                tokio::select! {
                    _ = tokio::time::sleep(std::time::Duration::from_secs(tick_secs)) => {}
                    _ = stop_rx.changed() => break,
                }
            }
            first = false;
            if *stop_rx.borrow() {
                break;
            }
            tick_state
                .events
                .emit(&tick_state.db, "scheduler://tick", serde_json::json!(chrono::Utc::now().to_rfc3339()));
            orchestrator::tick(tick_state.clone()).await;
            if chrono::Utc::now() - last_prune > chrono::Duration::hours(24) {
                web_db::prune_events(&tick_state.db, 7);
                let _ = tick_state
                    .db
                    .with_conn(|conn| conn.execute("DELETE FROM web_sessions WHERE expires_at <= ?1", [auth::now_text()]));
                last_prune = chrono::Utc::now();
            }
        }
    });

    let listener = match tokio::net::TcpListener::bind(config.bind).await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!("can't listen on {}: {e}", config.bind);
            std::process::exit(2);
        }
    };
    tracing::info!(
        "Tayang web server {} on http://{} (workspace {})",
        env!("CARGO_PKG_VERSION"),
        config.bind,
        config.workspace_root.display()
    );
    let shutdown = async move {
        let ctrl_c = async {
            let _ = tokio::signal::ctrl_c().await;
        };
        #[cfg(unix)]
        let term = async {
            let mut sig = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).ok();
            if let Some(sig) = sig.as_mut() {
                sig.recv().await;
            } else {
                std::future::pending::<()>().await;
            }
        };
        #[cfg(not(unix))]
        let term = std::future::pending::<()>();
        tokio::select! {
            _ = ctrl_c => {},
            _ = term => {},
        }
        let _ = stop_tx.send(true);
        tracing::info!("shutting down; stopping agents and marking interrupted work");
    };
    let serve = axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(shutdown);
    if let Err(e) = serve.await {
        tracing::error!("server stopped: {e}");
    }
    api::shutdown(state.clone()).await;
    tracing::info!("bye");
}

#[cfg(test)]
pub mod test_support {
    use crate::state::AppState;
    use std::path::Path;
    use std::sync::Arc;

    pub fn state(root: &Path) -> Arc<AppState> {
        let data = root.join("data");
        let workspace = root.join("workspaces");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::create_dir_all(&workspace).unwrap();
        let home = data.join("home");
        std::fs::create_dir_all(&home).unwrap();
        let config = crate::config::Config {
            bind: "127.0.0.1:0".parse().unwrap(),
            data_dir: data.clone(),
            workspace_root: workspace.clone(),
            public_url: "http://127.0.0.1:8787".into(),
            secure_cookies: false,
            trust_proxy: false,
            session_hours: 24,
            dist_dir: root.join("dist"),
            plugin_dir: None,
            max_upload: 50 * 1024 * 1024,
            password_hash: crate::auth::hash_password("correct horse battery staple").unwrap(),
            tick_secs: 30,
        };
        let db = tayang_core::db::Db::open(&data.join("tayang.db")).unwrap();
        crate::web_db::init(&db).unwrap();
        let working = workspace.join("tayang");
        std::fs::create_dir_all(&working).unwrap();
        db.update_settings(serde_json::json!({ "workingFolder": working.to_string_lossy() })).unwrap();
        Arc::new(AppState {
            config,
            db,
            home,
            data_dir: data,
            acp: tayang_core::acp::AcpManager::new(),
            media: tayang_core::media::MediaTools::from_env_or_path(),
            usage: tayang_core::usage::UsageCache::default(),
            events: crate::events::EventBus::default(),
            agent: crate::agent::AgentHub::default(),
            login_limiter: crate::auth::LoginLimiter::default(),
            render_locks: tokio::sync::Mutex::new(Default::default()),
            study_working: Default::default(),
            claude_sign_in: Default::default(),
            autopilot_lock: tokio::sync::Mutex::new(()),
            autopilot_current: Default::default(),
            action_proxy: None,
            started_at: chrono::Utc::now(),
        })
    }
}
