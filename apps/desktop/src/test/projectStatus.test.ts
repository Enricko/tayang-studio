import { vi } from 'vitest';
import type { Chat, ChatMessage, FileInfo, Project, ProjectStatus } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({
  setProjectStatus: vi.fn(),
  listProjects: vi.fn(),
  listChats: vi.fn().mockResolvedValue([]),
  listMessages: vi.fn().mockResolvedValue([]),
  updateSettings: vi.fn().mockResolvedValue({}),
  latestRenderInfo: vi.fn().mockResolvedValue(null),
  mediaProbe: vi.fn().mockResolvedValue({ durationSec: 12, fps: 30, frames: 360, width: 1080, height: 1920 }),
}));

import { latestRenderInfo, listChats, listMessages, listProjects, setProjectStatus, updateSettings } from '@/lib/ipc';
import { renderTiming } from '@/lib/renderCheck';
import { advanceProject, backfillProjectStatus, isWorkTool, resetProjectStatus } from '@/lib/projectStatus';
import { useApp } from '@/state/app';

const proj = (id: string, status: ProjectStatus): Project => ({
  id, title: id, slug: id, folder: `/w/${id}`, kind: 'explainer', format: '9:16', language: 'id', status,
  styleId: null, scheduledAt: null, reviewState: 'none', postedAt: null, remindedAt: null, reviewRemindedAt: null,
  durationSec: null, createdAt: 'c', updatedAt: 'u',
});
const video: FileInfo = { path: '/w/a/renders/v.mp4', name: 'v.mp4', size: 10, modifiedAt: '2026-11-01T00:00:00.000Z' };
const chat = (id: string, projectId: string): Chat => ({ id, projectId, agentId: 'claude', title: id, createdAt: 'c' });
const toolMsg = (chatId: string, toolKind: 'edit' | 'read' | 'execute', status: 'done' | 'failed' = 'done'): ChatMessage => ({
  id: `m-${chatId}`, chatId, role: 'agent', createdAt: 'c',
  parts: [{ type: 'tool', toolCallId: 't', title: 'x', status, toolKind }],
});

beforeEach(() => {
  vi.clearAllMocks();
  renderTiming.stableMs = 0;
  resetProjectStatus();
  vi.mocked(setProjectStatus).mockImplementation(async (id, status) => proj(id, status));
});

describe('isWorkTool', () => {
  it('is a finished edit, delete, move or command', () => {
    for (const k of ['edit', 'delete', 'move', 'execute'] as const) {
      expect(isWorkTool({ type: 'tool', toolCallId: 't', title: '', status: 'done', toolKind: k })).toBe(true);
    }
    expect(isWorkTool({ type: 'tool', toolCallId: 't', title: '', status: 'running', toolKind: 'edit' })).toBe(false);
    expect(isWorkTool({ type: 'tool', toolCallId: 't', title: '', status: 'done', toolKind: 'read' })).toBe(false);
    expect(isWorkTool({ type: 'tool', toolCallId: 't', title: '', status: 'done' })).toBe(false);
    expect(isWorkTool({ type: 'text', text: 'edit' })).toBe(false);
  });
});

describe('advanceProject', () => {
  it('moves a project once and refreshes the project lists; never asks to go back', async () => {
    const before = useApp.getState().projectsVersion;
    await advanceProject('p1', 'building');
    await advanceProject('p1', 'building');
    expect(setProjectStatus).toHaveBeenCalledTimes(1);
    expect(setProjectStatus).toHaveBeenCalledWith('p1', 'building');
    expect(useApp.getState().projectsVersion).toBe(before + 1);
    await advanceProject('p1', 'rendered');
    expect(setProjectStatus).toHaveBeenLastCalledWith('p1', 'rendered');
    await advanceProject('p1', 'building');
    expect(setProjectStatus).toHaveBeenCalledTimes(2);
  });

  it('a project Rust keeps where it is (already further) is not asked again', async () => {
    vi.mocked(setProjectStatus).mockResolvedValueOnce(proj('p1', 'rendered'));
    await advanceProject('p1', 'building');
    await advanceProject('p1', 'rendered');
    expect(setProjectStatus).toHaveBeenCalledTimes(1);
  });

  it('two calls at once ask once; a failed call can be tried again', async () => {
    await Promise.all([advanceProject('p1', 'building'), advanceProject('p1', 'building')]);
    expect(setProjectStatus).toHaveBeenCalledTimes(1);
    vi.mocked(setProjectStatus).mockRejectedValueOnce(new Error('db busy'));
    await advanceProject('p2', 'building');
    await advanceProject('p2', 'building');
    expect(setProjectStatus).toHaveBeenCalledTimes(3);
  });
});

describe('backfillProjectStatus', () => {
  it('once: a finished render makes a project rendered, a chat that edited or ran commands makes it building', async () => {
    vi.mocked(listProjects).mockResolvedValue([proj('a', 'draft'), proj('b', 'draft'), proj('c', 'draft'), proj('d', 'building'), proj('e', 'rendered')]);
    vi.mocked(latestRenderInfo).mockImplementation(async (id) => (id === 'a' || id === 'd' ? video : null));
    vi.mocked(listChats).mockImplementation(async (id) => (id ? [chat(`chat-${id}`, id)] : []));
    vi.mocked(listMessages).mockImplementation(async (chatId) =>
      chatId === 'chat-b' ? [toolMsg(chatId, 'execute')] : chatId === 'chat-c' ? [toolMsg(chatId, 'read'), toolMsg(chatId, 'edit', 'failed')] : [],
    );
    await backfillProjectStatus(false);
    const calls = vi.mocked(setProjectStatus).mock.calls.map(([id, s]) => `${id}:${s}`).sort();
    expect(calls).toEqual(['a:rendered', 'b:building', 'd:rendered']);
    expect(updateSettings).toHaveBeenCalledWith({ projectStatusChecked: true });
  });

  it('does nothing once checked, and runs once when started twice', async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    await backfillProjectStatus(true);
    expect(listProjects).not.toHaveBeenCalled();
    await Promise.all([backfillProjectStatus(false), backfillProjectStatus(false)]);
    expect(listProjects).toHaveBeenCalledTimes(1);
  });

  it('is tried again at the next start when a write fails', async () => {
    vi.mocked(listProjects).mockResolvedValue([proj('a', 'draft')]);
    vi.mocked(latestRenderInfo).mockResolvedValue(video);
    vi.mocked(setProjectStatus).mockRejectedValueOnce(new Error('db busy'));
    await backfillProjectStatus(false);
    expect(updateSettings).not.toHaveBeenCalled();
  });
});
