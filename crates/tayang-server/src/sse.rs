//! Server-sent events with persisted ids and replay. A reloaded or second tab asks for the events
//! after `lastEventId` and reconstructs pending permission/question cards without duplicates.

use crate::state::AppState;
use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures::stream::Stream;
use serde::Deserialize;
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

#[derive(Deserialize, Default)]
pub struct EventQuery {
    #[serde(rename = "lastEventId", default)]
    pub last_event_id: Option<i64>,
}

fn event_of(kind: &str, payload: &serde_json::Value, id: i64) -> Event {
    Event::default().id(id.to_string()).event(kind).data(payload.to_string())
}

/// The newest event id. A fresh page starts here and restores durable state from the database;
/// EventSource's native Last-Event-ID then covers a dropped connection within that page.
pub async fn latest(State(state): State<Arc<AppState>>) -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({ "lastEventId": crate::web_db::last_event_id(&state.db) }))
}

pub async fn events(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(q): Query<EventQuery>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let header_last = headers
        .get("last-event-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<i64>().ok());
    let mut last = q.last_event_id.max(header_last).unwrap_or(0);
    // Subscribe before reading the replay: anything emitted while the replay is sent is also queued
    // on this receiver, and the id check removes the overlap.
    let mut rx = state.events.subscribe();
    let mut replay = crate::web_db::events_since(&state.db, last, 5000).unwrap_or_default();
    let newest = crate::web_db::last_event_id(&state.db);
    let truncated = replay.len() >= 5000 && replay.last().map(|e| e.0).unwrap_or(0) < newest;

    let stream = async_stream::stream! {
        if truncated {
            // The client jumps its cursor to `latest` before reloading, so the next connection does
            // not replay the same truncated gap forever.
            yield Ok(Event::default().event("resync").data(serde_json::json!({ "latest": newest }).to_string()));
        }
        for (id, kind, payload) in replay.drain(..) {
            last = last.max(id);
            yield Ok(event_of(&kind, &payload, id));
        }
        let mut heartbeat = tokio::time::interval(Duration::from_secs(15));
        heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                _ = heartbeat.tick() => {
                    yield Ok(Event::default().comment("keep-alive"));
                }
                received = rx.recv() => match received {
                    Ok(ev) if ev.id > last => {
                        last = ev.id;
                        yield Ok(event_of(&ev.kind, &ev.payload, ev.id));
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        // The agent outran this connection: replay the gap from the database.
                        if let Ok(gap) = crate::web_db::events_since(&state.db, last, 5000) {
                            for (id, kind, payload) in gap {
                                if id > last {
                                    last = id;
                                    yield Ok(event_of(&kind, &payload, id));
                                }
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    };
    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(20)).text("keep-alive"))
}
