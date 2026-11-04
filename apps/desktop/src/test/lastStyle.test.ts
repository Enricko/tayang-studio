import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@tayang/shared';
import { lastMentionedStyle } from '@/lib/mentions';

const msg = (role: ChatMessage['role'], parts: ChatMessage['parts']): ChatMessage => ({
  id: Math.random().toString(36),
  chatId: 'c',
  role,
  parts,
  createdAt: '2026-11-04T00:00:00Z',
});

describe('lastMentionedStyle', () => {
  it('is the newest style the user mentioned in the chat', () => {
    const messages = [
      msg('user', [{ type: 'text', text: 'a' }, { type: 'style-mention', styleId: 's1', name: 'One' }]),
      msg('agent', [{ type: 'text', text: 'ok' }]),
      msg('user', [{ type: 'style-mention', styleId: 's2', name: 'Two' }]),
    ];
    expect(lastMentionedStyle(messages)).toBe('s2');
  });

  it('ignores agent and system messages, and is null without a mention', () => {
    expect(lastMentionedStyle([msg('agent', [{ type: 'style-mention', styleId: 'x', name: 'X' }])])).toBeNull();
    expect(lastMentionedStyle([msg('user', [{ type: 'text', text: 'hi' }])])).toBeNull();
    expect(lastMentionedStyle(undefined)).toBeNull();
  });
});
