import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useChat } from '@/state/chat';

describe('chat store rows and drafts', () => {
  it('remembers chat rows and drafts until reset', () => {
    useChat.getState().reset();
    act(() => {
      useChat.getState().rememberChat({ id: 'c1', projectId: null, agentId: 'claude', title: 'Hi', createdAt: '' });
      useChat.getState().setDraft('new', 'half a thought');
    });
    expect(useChat.getState().rows.c1?.projectId).toBeNull();
    expect(useChat.getState().drafts.new).toBe('half a thought');
    useChat.getState().reset();
    expect(useChat.getState().rows).toEqual({});
    expect(useChat.getState().drafts).toEqual({});
  });
});
