import type { AgentQuestion, PermissionRequest, ChatMessage } from '@tayang/shared';
import { rpc } from './webRpc';

export interface ChatLive {
  /** The server owns turns and this snapshot can clear stale browser state. */
  available?: boolean;
  streaming: boolean;
  sessionRunning: boolean;
  turnStartedAt: string;
  message: ChatMessage | null;
  permissions: PermissionRequest[];
  questions: AgentQuestion[];
}

/** The in-flight turn and pending cards from the server, used after a reconnect. */
export const chatLive = (chatId: string) => rpc<ChatLive>('chat_live', { chatId });
