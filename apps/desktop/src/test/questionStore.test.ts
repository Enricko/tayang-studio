import { vi } from 'vitest';

vi.mock('@/lib/ipc', async (orig) => ({
  ...(await orig<typeof import('@/lib/ipc')>()),
  agentRespondQuestion: vi.fn().mockResolvedValue(undefined),
  addMessage: vi.fn(async (chatId: string, role: string, parts: unknown[]) => ({ id: 'm1', chatId, role, parts, createdAt: '' })),
  upsertJob: vi.fn().mockResolvedValue(undefined),
  listJobs: vi.fn().mockResolvedValue([]),
}));

import { agentRespondQuestion } from '@/lib/ipc';
import { headQuestion, useChat } from '@/state/chat';

const q = (id: string) => ({ chatId: 'c1', requestId: id, message: 'Which?', schema: { properties: {} } });

describe('answering a question', () => {
  beforeEach(() => useChat.setState({ questions: { c1: [q('r1'), q('r2')] }, messages: { c1: [] } }));

  it('answers the oldest, puts the answer in the chat, and shows the next', async () => {
    expect(headQuestion(useChat.getState(), 'c1')?.requestId).toBe('r1');
    await useChat.getState().respondQuestion('c1', { action: 'accept', content: { topic: 'b' } }, 'Volcanoes');
    expect(agentRespondQuestion).toHaveBeenCalledWith('r1', { action: 'accept', content: { topic: 'b' } });
    const last = useChat.getState().messages.c1!.at(-1)!;
    expect(last.role).toBe('user');
    expect(last.parts).toEqual([{ type: 'text', text: 'Volcanoes' }]);
    expect(headQuestion(useChat.getState(), 'c1')?.requestId).toBe('r2');
  });

  it('a skip is recorded as skipped', async () => {
    await useChat.getState().respondQuestion('c1', { action: 'decline' }, '');
    expect(useChat.getState().messages.c1!.at(-1)!.parts).toEqual([{ type: 'text', text: 'Skipped the question' }]);
  });
});
