import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, MessagePart } from '@tayang/shared';

vi.mock('@/lib/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ipc')>()),
  getChat: vi.fn().mockResolvedValue(null),
  listMessages: vi.fn().mockResolvedValue([]),
  addMessage: vi.fn().mockResolvedValue(null),
  agentStart: vi.fn().mockResolvedValue(undefined),
  agentPrompt: vi.fn().mockResolvedValue(undefined),
  agentCancel: vi.fn().mockResolvedValue(undefined),
  agentStop: vi.fn().mockResolvedValue(undefined),
  agentRespondPermission: vi.fn().mockResolvedValue(undefined),
  agentRespondQuestion: vi.fn().mockResolvedValue(undefined),
  agentSetAuto: vi.fn().mockResolvedValue(undefined),
  recentImages: vi.fn().mockResolvedValue([]),
  upsertJob: vi.fn().mockResolvedValue(undefined),
  updateChatAgent: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/liveChat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/liveChat')>()),
  chatLive: vi.fn(),
}));

import { chatLive } from '@/lib/liveChat';
import { listMessages } from '@/lib/ipc';
import { useChat } from '@/state/chat';

const text = (body: string): MessagePart => ({ type: 'text', text: body });
const user: ChatMessage = {
  id: 'u1',
  chatId: 'c1',
  role: 'user',
  parts: [text('buat videonya')],
  createdAt: '2026-11-08T06:00:00Z',
};
const stored: ChatMessage = {
  id: 'm1',
  chatId: 'c1',
  role: 'agent',
  parts: [text('bagian yang sudah tersimpan')],
  createdAt: '2026-11-08T06:00:01Z',
};
const live: ChatMessage = {
  ...stored,
  parts: [text('bagian yang sudah tersimpan, plus teks terbaru'), { type: 'file', path: '/w/a.png', name: 'a.png', mime: 'image/png', size: 10, modifiedAt: '2026-11-08T06:01:00Z' }],
};

beforeEach(() => {
  useChat.getState().reset();
  vi.clearAllMocks();
  vi.mocked(listMessages).mockResolvedValue([user, stored]);
});

describe('opening or reconnecting to a chat after a refresh', () => {
  it('uses the live turn instead of the older SQLite copy', async () => {
    vi.mocked(chatLive).mockResolvedValue({
      available: true,
      streaming: true,
      sessionRunning: true,
      turnStartedAt: '2026-11-08T06:00:01Z',
      message: live,
      permissions: [],
      questions: [],
    });
    await useChat.getState().load('c1', true);
    const messages = useChat.getState().messages.c1!;
    const agent = messages.filter((m) => m.role === 'agent').at(-1)!;
    expect(agent.parts).toHaveLength(2);
    expect(agent.parts[0]).toEqual(text('bagian yang sudah tersimpan, plus teks terbaru'));
    expect(agent.parts[1]).toMatchObject({ type: 'file', path: '/w/a.png' });
    expect(useChat.getState().streaming.c1).toBe(true);
    expect(useChat.getState().started.c1).toBe(true);
  });

  it('clears streaming and the session when the server restarted', async () => {
    vi.mocked(chatLive).mockResolvedValue({
      available: true,
      streaming: false,
      sessionRunning: false,
      turnStartedAt: '',
      message: null,
      permissions: [],
      questions: [],
    });
    useChat.setState({ streaming: { c1: true }, turnStartedAt: { c1: Date.now() }, started: { c1: true } });
    await useChat.getState().load('c1', true);
    expect(useChat.getState().streaming.c1).toBe(false);
    expect(useChat.getState().turnStartedAt.c1).toBeUndefined();
    expect(useChat.getState().started.c1).toBe(false);
    expect(useChat.getState().messages.c1).toEqual([user, stored]);
  });
});
