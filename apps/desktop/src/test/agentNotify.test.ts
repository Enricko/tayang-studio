import { vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/plugin-notification', () => ({ isPermissionGranted: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/ipc', () => ({
  listRecentChats: vi.fn().mockResolvedValue([{ id: 'c1', title: 'Chat', projectTitle: 'Lampu lalu lintas pertama' }]),
}));

import { invoke } from '@tauri-apps/api/core';
import { isPermissionGranted } from '@tauri-apps/plugin-notification';
import { notifyAgent } from '@/lib/agentNotify';
import { useApp } from '@/state/app';

const sent = () => vi.mocked(invoke).mock.calls.map((c) => (c[1] as { options: { title: string; body: string } }).options);

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ route: { name: 'videos' } });
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
});

describe('agent notifications', () => {
  it('says a chat is done, by its video title', async () => {
    await notifyAgent('c1', 'done');
    expect(sent()).toEqual([{ title: 'Your agent is done', body: 'Lampu lalu lintas pertama is ready for you.' }]);
  });

  it('says when it waits for a pick, or asks to run a command', async () => {
    await notifyAgent('c1', 'asks');
    await notifyAgent('c1', 'permission');
    expect(sent().map((o) => o.title)).toEqual(['Your agent needs you', 'Your agent asks to run a command']);
  });

  it('stays quiet while the user looks at that chat, and not for another chat', async () => {
    useApp.setState({ route: { name: 'chat', chatId: 'c1' } });
    await notifyAgent('c1', 'done');
    expect(invoke).not.toHaveBeenCalled();
    await notifyAgent('c2', 'done');
    expect(sent()).toEqual([{ title: 'Your agent is done', body: 'A chat is ready for you.' }]);
  });

  it('shows when the chat is open but the window is in the background', async () => {
    useApp.setState({ route: { name: 'chat', chatId: 'c1' } });
    vi.mocked(document.hasFocus).mockReturnValue(false);
    await notifyAgent('c1', 'asks');
    expect(sent()).toHaveLength(1);
  });

  it('never shows without permission, and never throws', async () => {
    vi.mocked(isPermissionGranted).mockResolvedValueOnce(false);
    await notifyAgent('c1', 'done');
    expect(invoke).not.toHaveBeenCalled();
    vi.mocked(invoke).mockRejectedValueOnce(new Error('no'));
    await expect(notifyAgent('c1', 'done')).resolves.toBeUndefined();
  });
});
