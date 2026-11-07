// Browser implementation of events: one authenticated Server-Sent Events connection with persisted
// ids, so a reload or a second tab replays missed agent output and pending cards.

import type { AgentQuestion, AgentUpdate, PermissionRequest } from '@tayang/shared';

export interface AgentAction {
  chatId: string;
  name: 'pick_topic' | 'schedule_videos';
  context: Record<string, unknown>;
}

type Listener = (payload: unknown) => void;

const handlers = new Map<string, Set<Listener>>();
let source: EventSource | null = null;
let started = false;
let starting = false;

/** Kept for the login/logout call sites; a new page starts at the server's newest event id. */
export function clearEventCursor() {}

function dispatch(kind: string, raw: string) {
  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = raw;
  }
  for (const fn of handlers.get(kind) ?? []) {
    try {
      fn(payload);
    } catch (e) {
      console.error('Tayang: event handler failed', e);
    }
  }
}

const EVENT_KINDS = [
  'agent://update',
  'agent://permission',
  'agent://question',
  'agent://permission-resolved',
  'agent://question-resolved',
  'agent://action',
  'scheduler://tick',
  'scheduler://reminder',
  'claude://sign-in-url',
  'projects://changed',
  'jobs://changed',
  'autopilot://changed',
];

function open(lastEventId: number) {
  started = true;
  starting = false;
  source = new EventSource(`/api/events?lastEventId=${lastEventId}`, { withCredentials: true });
  for (const kind of EVENT_KINDS) {
    source.addEventListener(kind, (e) => dispatch(kind, (e as MessageEvent).data));
  }
  source.addEventListener('resync', () => {
    // Too much history to replay within a live connection: reload. Durable chat/state is in the
    // database, and a fresh connection starts at the newest id.
    console.warn('Tayang: the event history was truncated; reloading');
    window.location.reload();
  });
  source.onerror = () => {
    // EventSource reconnects by itself with its native Last-Event-ID. If the session expired, tell
    // the login gate.
    void fetch('/api/auth/me', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((me: { authenticated?: boolean } | null) => {
        if (me && me.authenticated === false) window.dispatchEvent(new CustomEvent('tayang:unauthorized'));
      })
      .catch(() => {});
  };
}

function connect() {
  if (started || starting || typeof window === 'undefined') return;
  starting = true;
  // A fresh page has no in-memory event cursor. Start at the server's newest id and rebuild the
  // open chat from stored messages/live snapshot; replaying every old agent update here would
  // duplicate history in a newly opened tab. A dropped EventSource still replays its own gap.
  void fetch('/api/events/latest', { credentials: 'same-origin', headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((body: { lastEventId?: number }) => open(Number(body.lastEventId) || 0))
    .catch(() => {
      starting = false;
      started = false;
      open(0);
    });
}

export function disconnectEvents() {
  source?.close();
  source = null;
  started = false;
  starting = false;
}

function on(kind: string, cb: Listener): () => void {
  connect();
  let set = handlers.get(kind);
  if (!set) handlers.set(kind, (set = new Set()));
  set.add(cb);
  return () => {
    set?.delete(cb);
  };
}

export function onAgentUpdate(cb: (e: { chatId: string; update: AgentUpdate }) => void): Promise<() => void> {
  const off = on('agent://update', (p) => cb(p as { chatId: string; update: AgentUpdate }));
  return Promise.resolve(off);
}

export function onPermission(cb: (req: PermissionRequest) => void): Promise<() => void> {
  const off = on('agent://permission', (p) => cb(p as PermissionRequest));
  return Promise.resolve(off);
}

export function onQuestion(cb: (q: AgentQuestion) => void): Promise<() => void> {
  const off = on('agent://question', (p) => cb(p as AgentQuestion));
  return Promise.resolve(off);
}

export function onPermissionResolved(cb: (requestId: string) => void): Promise<() => void> {
  const off = on('agent://permission-resolved', (p) => {
    const id = (p as { requestId?: string }).requestId;
    if (id) cb(id);
  });
  return Promise.resolve(off);
}

export function onQuestionResolved(cb: (requestId: string) => void): Promise<() => void> {
  const off = on('agent://question-resolved', (p) => {
    const id = (p as { requestId?: string }).requestId;
    if (id) cb(id);
  });
  return Promise.resolve(off);
}

export function onAgentAction(cb: (a: AgentAction) => void): Promise<() => void> {
  const off = on('agent://action', (p) => cb(p as AgentAction));
  return Promise.resolve(off);
}

export function onReminder(cb: (r: { kind: string; projectId: string; title: string }) => void): Promise<() => void> {
  const off = on('scheduler://reminder', (p) => cb(p as { kind: string; projectId: string; title: string }));
  return Promise.resolve(off);
}

export function onClaudeSignInUrl(cb: (url: string) => void): Promise<() => void> {
  const off = on('claude://sign-in-url', (p) => cb(String(p)));
  return Promise.resolve(off);
}

/** Ticks are informational in the web edition: the server already ran the orchestration. */
export function onTick(cb: (now: string) => void): Promise<() => void> {
  const off = on('scheduler://tick', (p) => cb(String(p)));
  return Promise.resolve(off);
}

/** Generic bridge for server-side state changes (projects, jobs, autopilots). */
export function onServerEvent(kind: string, cb: (payload: unknown) => void): () => void {
  return on(kind, cb);
}
