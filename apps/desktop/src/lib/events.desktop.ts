import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AgentQuestion, AgentUpdate, PermissionRequest } from '@tayang/shared';

export function onAgentUpdate(
  cb: (e: { chatId: string; update: AgentUpdate }) => void,
): Promise<UnlistenFn> {
  return listen<{ chatId: string; update: AgentUpdate }>('agent://update', (e) => cb(e.payload));
}

export function onPermission(cb: (req: PermissionRequest) => void): Promise<UnlistenFn> {
  return listen<PermissionRequest>('agent://permission', (e) => cb(e.payload));
}

/** An agent asks the user something (ACP elicitation). */
export function onQuestion(cb: (q: AgentQuestion) => void): Promise<UnlistenFn> {
  return listen<AgentQuestion>('agent://question', (e) => cb(e.payload));
}

/** What an agent asked Tayang to do through its local endpoint: start a video, or schedule videos. */
export interface AgentAction {
  chatId: string;
  name: 'pick_topic' | 'schedule_videos';
  context: Record<string, unknown>;
}

export function onAgentAction(cb: (a: AgentAction) => void): Promise<UnlistenFn> {
  return listen<AgentAction>('agent://action', (e) => cb(e.payload));
}

/** Desktop has a single window; resolved cards are handled locally. */
export const onPermissionResolved = (_cb: (requestId: string) => void): Promise<UnlistenFn> =>
  Promise.resolve(() => {});
export const onQuestionResolved = (_cb: (requestId: string) => void): Promise<UnlistenFn> =>
  Promise.resolve(() => {});
export const onReminder = (_cb: (r: { kind: string; projectId: string; title: string }) => void): Promise<UnlistenFn> =>
  Promise.resolve(() => {});

export const onClaudeSignInUrl = (cb: (url: string) => void): Promise<UnlistenFn> =>
  listen<string>('claude://sign-in-url', (e) => cb(e.payload));

export const clearEventCursor = () => {};
export const disconnectEvents = () => {};

export const onServerEvent = (_kind: string, _cb: (payload: unknown) => void): (() => void) => () => {};
