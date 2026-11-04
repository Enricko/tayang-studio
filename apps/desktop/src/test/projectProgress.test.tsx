import { act, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import type { AgentUpdate, FileInfo, Job, Project, ProjectStatus } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({
  getChat: vi.fn().mockResolvedValue(null),
  listMessages: vi.fn().mockResolvedValue([]),
  addMessage: vi.fn().mockResolvedValue(null),
  agentStart: vi.fn().mockResolvedValue(undefined),
  agentPrompt: vi.fn().mockResolvedValue(undefined),
  agentCancel: vi.fn(),
  agentStop: vi.fn().mockResolvedValue(undefined),
  agentRespondPermission: vi.fn(),
  upsertJob: vi.fn().mockResolvedValue(undefined),
  listJobs: vi.fn().mockResolvedValue([]),
  latestRenderInfo: vi.fn().mockResolvedValue(null),
  newestVideoInfo: vi.fn().mockResolvedValue(null),
  setProjectStatus: vi.fn(),
  mediaProbe: vi.fn().mockResolvedValue({ durationSec: 12, fps: 30, frames: 360, width: 1080, height: 1920 }),
  recentImages: vi.fn().mockResolvedValue([]),
  assetUrl: (p: string) => p,
}));
const updates: ((e: { chatId: string; update: AgentUpdate }) => void)[] = [];
vi.mock('@/lib/events', () => ({
  onAgentUpdate: vi.fn(async (cb: (e: { chatId: string; update: AgentUpdate }) => void) => {
    updates.push(cb);
    return () => {};
  }),
  onPermission: vi.fn(async () => () => {}),
}));

import { latestRenderInfo, listJobs, setProjectStatus } from '@/lib/ipc';
import { renderTiming } from '@/lib/renderCheck';
import { resetLateRenders, settleLateRenders } from '@/lib/buildJobs';
import { useChat } from '@/state/chat';

const emit = (chatId: string, update: AgentUpdate) => act(async () => updates.forEach((cb) => cb({ chatId, update })));
const proj = (id: string, status: ProjectStatus): Project => ({
  id, title: id, slug: id, folder: `/w/${id}`, kind: 'explainer', format: '9:16', language: 'id', status,
  styleId: null, scheduledAt: null, reviewState: 'none', postedAt: null, remindedAt: null, reviewRemindedAt: null,
  durationSec: null, createdAt: 'c', updatedAt: 'u',
});
const video = (at: Date, size = 10): FileInfo => ({ path: '/w/p1/renders/v.mp4', name: 'v.mp4', size, modifiedAt: at.toISOString() });
const job = { projectId: 'p1', title: 'Jalur Rempah' };
const tool = (toolCallId: string, toolKind: 'edit' | 'read' | 'execute' | 'delete' | 'move', status: 'running' | 'done' | 'failed'): AgentUpdate => ({
  kind: 'tool', toolCallId, title: `${toolKind} something`, status, toolKind,
});
const statusCalls = () => vi.mocked(setProjectStatus).mock.calls.map(([id, s]) => `${id}:${s}`);

beforeEach(() => {
  vi.clearAllMocks();
  renderTiming.stableMs = 0;
  vi.mocked(latestRenderInfo).mockResolvedValue(null);
  vi.mocked(setProjectStatus).mockImplementation(async (id, status) => proj(id, status));
  updates.length = 0;
  useChat.getState().reset();
  useChat.getState().listen();
  resetLateRenders();
});

describe("a project's status follows its chat", () => {
  it('becomes building when the first edit, delete, move or command finishes, not on reads or failures', async () => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'go' }], { agentId: 'claude', job });
    await emit('c1', tool('t1', 'read', 'done'));
    await emit('c1', tool('t2', 'edit', 'running'));
    await emit('c1', tool('t3', 'execute', 'failed'));
    expect(setProjectStatus).not.toHaveBeenCalled();
    await emit('c1', tool('t2', 'edit', 'done'));
    await waitFor(() => expect(statusCalls()).toEqual(['p1:building']));
    // Once building, later work asks nothing more.
    await emit('c1', tool('t4', 'move', 'done'));
    await emit('c1', tool('t5', 'delete', 'done'));
    expect(statusCalls()).toEqual(['p1:building']);
  });

  it('a chat without a project never moves a status', async () => {
    await useChat.getState().send('c2', [{ type: 'text', text: 'go' }], { agentId: 'claude' });
    await emit('c2', tool('t1', 'edit', 'done'));
    await act(async () => {});
    expect(setProjectStatus).not.toHaveBeenCalled();
  });

  it('becomes rendered when the turn ends with a finished render', async () => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'go' }], { agentId: 'claude', job });
    vi.mocked(latestRenderInfo).mockResolvedValue(video(new Date(Date.now() + 500)));
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    await waitFor(() => expect(statusCalls()).toContain('p1:rendered'));
  });

  it('stays where it is when the turn ends without a video', async () => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'go' }], { agentId: 'claude', job });
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    await act(async () => {});
    expect(setProjectStatus).not.toHaveBeenCalled();
  });

  it('becomes rendered when a late render settles its build job', async () => {
    const waiting: Job = {
      id: 'build-c9', kind: 'build', title: 'Kopi', projectId: 'p9', chatId: 'c9', agentId: 'claude', status: 'needs-you',
      progress: null, note: 'No video yet', sourceUrl: null, renderBaselineAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
    };
    vi.mocked(listJobs).mockResolvedValue([waiting]);
    vi.mocked(latestRenderInfo).mockResolvedValue(video(new Date('2026-11-02T00:00:00.000Z')));
    await settleLateRenders(Date.parse('2026-11-03T00:00:00.000Z'), [waiting]);
    await waitFor(() => expect(statusCalls()).toEqual(['p9:rendered']));
  });
});
