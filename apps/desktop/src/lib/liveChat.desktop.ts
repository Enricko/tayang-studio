import type { AgentQuestion, PermissionRequest, ChatMessage } from '@tayang/shared';

export interface ChatLive {
  streaming: boolean;
  sessionRunning: boolean;
  turnStartedAt: string;
  message: ChatMessage | null;
  permissions: PermissionRequest[];
  questions: AgentQuestion[];
}

/** The desktop has one window and owns its in-memory turn; there is nothing extra to restore. */
export const chatLive = async (_chatId: string): Promise<ChatLive> => ({
  streaming: false,
  sessionRunning: false,
  turnStartedAt: '',
  message: null,
  permissions: [],
  questions: [],
});
