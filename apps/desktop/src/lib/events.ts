import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AgentUpdate, PermissionRequest } from '@tayang/shared';

export function onAgentUpdate(
  cb: (e: { chatId: string; update: AgentUpdate }) => void,
): Promise<UnlistenFn> {
  return listen<{ chatId: string; update: AgentUpdate }>('agent://update', (e) => cb(e.payload));
}

export function onPermission(cb: (req: PermissionRequest) => void): Promise<UnlistenFn> {
  return listen<PermissionRequest>('agent://permission', (e) => cb(e.payload));
}
