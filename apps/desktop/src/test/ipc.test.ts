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

  it('schedule, posted and approve call the Rust commands with camelCase args', async () => {
    const calls: { cmd: string; args: unknown }[] = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
    });
    await ipc.setSchedule('p1', '2026-11-05T02:00:00.000Z');
    await ipc.setSchedule('p1', null);
    await ipc.setPosted('p1', true);
    await ipc.approveProject('p1');
    expect(calls).toEqual([
      { cmd: 'set_schedule', args: { projectId: 'p1', at: '2026-11-05T02:00:00.000Z' } },
      { cmd: 'set_schedule', args: { projectId: 'p1', at: null } },
      { cmd: 'set_posted', args: { projectId: 'p1', posted: true } },
      { cmd: 'approve_project', args: { projectId: 'p1' } },
    ]);
  });

  it('project status and the newest video call the Rust commands with camelCase args', async () => {
    const calls: { cmd: string; args: unknown }[] = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
    });
    await ipc.setProjectStatus('p1', 'building');
    await ipc.setProjectStatus('p1', 'draft', true);
    await ipc.newestVideoInfo('p1');
    await ipc.videoThumbnail('p1');
    expect(calls).toEqual([
      { cmd: 'set_project_status', args: { projectId: 'p1', status: 'building', reset: false } },
      { cmd: 'set_project_status', args: { projectId: 'p1', status: 'draft', reset: true } },
      { cmd: 'newest_video_info', args: { projectId: 'p1' } },
      { cmd: 'video_thumbnail', args: { projectId: 'p1' } },
    ]);
  });

  it('autopilot and slot wrappers call the Rust commands with camelCase args', async () => {
    const calls: { cmd: string; args: unknown }[] = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
    });
    await ipc.listAutopilots();
    await ipc.setAutopilotStatus('a1', 'paused');
    await ipc.deleteAutopilot('a1');
    await ipc.listSlots('2026-11-01T00:00:00.000Z', '2026-12-01T00:00:00.000Z');
    await ipc.upsertSlot('a1', '2026-11-05T09:00:00.000Z');
    await ipc.updateSlot('s1', { status: 'planned', error: null });
    expect(calls).toEqual([
      { cmd: 'list_autopilots', args: {} },
      { cmd: 'set_autopilot_status', args: { id: 'a1', status: 'paused' } },
      { cmd: 'delete_autopilot', args: { id: 'a1' } },
      { cmd: 'list_slots', args: { from: '2026-11-01T00:00:00.000Z', to: '2026-12-01T00:00:00.000Z' } },
      { cmd: 'upsert_slot', args: { autopilotId: 'a1', dueAt: '2026-11-05T09:00:00.000Z' } },
      { cmd: 'update_slot', args: { id: 's1', patch: { status: 'planned', error: null } } },
    ]);
  });

  it('style sync, template install and render command call the Rust commands', async () => {
    const calls: { cmd: string; args: unknown }[] = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
    });
    await ipc.syncStyles();
    await ipc.installStyleTemplate('p1');
    await ipc.renderCommand('p1');
    await ipc.writeBrief('p1', 'b');
    expect(calls).toEqual([
      { cmd: 'sync_styles', args: {} },
      { cmd: 'install_style_template', args: { projectId: 'p1' } },
      { cmd: 'render_command', args: { projectId: 'p1' } },
      { cmd: 'write_brief', args: { projectId: 'p1', brief: 'b' } },
    ]);
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

  it('agentStop sends chatId', async () => {
    const calls: { cmd: string; args: unknown }[] = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
    });
    await ipc.agentStop('study-x');
    expect(calls).toEqual([{ cmd: 'agent_stop', args: { chatId: 'study-x' } }]);
  });
});
