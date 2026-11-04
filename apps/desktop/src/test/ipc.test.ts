import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';
import { afterEach, describe, expect, it } from 'vitest';
import type { NewProject } from '@tayang/shared';
import * as ipc from '@/lib/ipc';

afterEach(() => clearMocks());

describe('ipc', () => {
  it('createProject sends input and brief', async () => {
    const calls: { cmd: string; args: unknown }[] = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      return { id: 'p1' };
    });
    const input: NewProject = { title: 'Hi', kind: 'promo', format: '9:16', language: 'en' };
    await ipc.createProject(input, 'brief text');
    expect(calls).toEqual([{ cmd: 'create_project', args: { input, brief: 'brief text' } }]);
  });

  it('agentRespondPermission sends requestId and optionId', async () => {
    const calls: { cmd: string; args: unknown }[] = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
    });
    await ipc.agentRespondPermission('r1', null);
    expect(calls).toEqual([
      { cmd: 'agent_respond_permission', args: { requestId: 'r1', optionId: null } },
    ]);
  });

  it('mediaExtractFrame sends projectId and timeSec', async () => {
    const calls: { cmd: string; args: unknown }[] = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      return '/x.png';
    });
    expect(await ipc.mediaExtractFrame('p1', 1.5)).toBe('/x.png');
    expect(calls[0]).toEqual({ cmd: 'media_extract_frame', args: { projectId: 'p1', timeSec: 1.5 } });
  });

  it('getChat sends chatId', async () => {
    const calls: { cmd: string; args: unknown }[] = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      return null;
    });
    expect(await ipc.getChat('c1')).toBeNull();
    expect(calls).toEqual([{ cmd: 'get_chat', args: { chatId: 'c1' } }]);
  });
});
