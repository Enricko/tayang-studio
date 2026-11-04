import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { FileInfo, Job } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({
  listJobs: vi.fn(),
  upsertJob: vi.fn().mockResolvedValue(undefined),
  deleteJob: vi.fn().mockResolvedValue(undefined),
  detectAgents: vi.fn().mockResolvedValue([]),
  listProjects: vi.fn().mockResolvedValue([]),
  latestRenderInfo: vi.fn().mockResolvedValue(null),
  mediaProbe: vi.fn().mockResolvedValue({ durationSec: 12, fps: 30, frames: 360, width: 1080, height: 1920 }),
  getChat: vi.fn().mockResolvedValue(null),
  listMessages: vi.fn().mockResolvedValue([]),
  addMessage: vi.fn().mockResolvedValue(null),
  agentStart: vi.fn().mockResolvedValue(undefined),
  agentPrompt: vi.fn().mockResolvedValue(undefined),
  agentCancel: vi.fn(),
  agentStop: vi.fn().mockResolvedValue(undefined),
  agentRespondPermission: vi.fn(),
  assetUrl: (p: string) => p,
}));
vi.mock('@/lib/events', () => ({ onAgentUpdate: vi.fn(async () => () => {}), onPermission: vi.fn(async () => () => {}) }));

import { agentPrompt, agentStart, getChat, latestRenderInfo, listJobs, mediaProbe, upsertJob } from '@/lib/ipc';
import { renderTiming } from '@/lib/renderCheck';
import { useJobs } from '@/state/jobs';
import { resetLateRenders, settleLateRenders } from '@/lib/buildJobs';
import { Agents } from '@/screens/Agents';
import { setUiLanguage } from '@/i18n';
import { useApp } from '@/state/app';
import { useChat } from '@/state/chat';

const T = Date.parse('2026-11-04T10:00:00Z');
const job = (extra: Partial<Job> = {}): Job => ({
  id: 'build-c1', kind: 'build', title: 'Jalur Rempah', projectId: 'p1', chatId: 'c1', agentId: 'claude', status: 'needs-you',
  progress: null, note: 'No video yet. The agent stopped before rendering', sourceUrl: null, updatedAt: new Date(T).toISOString(), ...extra,
});
const file = (at: number): FileInfo => ({ path: '/w/p1/renders/v-2.mp4', name: 'v-2.mp4', size: 5, modifiedAt: new Date(at).toISOString() });

beforeEach(() => {
  vi.clearAllMocks();
  renderTiming.stableMs = 0;
  vi.mocked(latestRenderInfo).mockReset().mockResolvedValue(null);
  resetLateRenders();
  useJobs.setState({ jobs: [] });
  useChat.getState().reset();
  useApp.setState({ route: { name: 'agents' } });
});

describe('late renders', () => {
  it('a needs-you build job becomes done once a video appears after it, named in the note', async () => {
    vi.mocked(latestRenderInfo).mockResolvedValue(file(T + 120_000));
    vi.mocked(listJobs).mockResolvedValue([job()]);
    await settleLateRenders(T + 180_000);
    expect(upsertJob).toHaveBeenCalledWith(expect.objectContaining({ id: 'build-c1', status: 'done', note: 'v-2.mp4' }));
  });

  it('leaves it alone without a newer video, looks at most once a minute, and skips other jobs', async () => {
    vi.mocked(latestRenderInfo).mockResolvedValue(file(T - 600_000));
    const jobs = [
      job(),
      job({ id: 'build-c2', chatId: 'c2', status: 'done' }),
      job({ id: 'study-1', kind: 'study-style', projectId: null }),
      job({ id: 'build-c3', chatId: 'c3', projectId: null }),
    ];
    await settleLateRenders(T + 60_000, jobs);
    expect(latestRenderInfo).toHaveBeenCalledTimes(1);
    expect(upsertJob).not.toHaveBeenCalled();
    await settleLateRenders(T + 90_000, jobs);
    expect(latestRenderInfo).toHaveBeenCalledTimes(1);
    vi.mocked(latestRenderInfo).mockResolvedValue(file(T + 100_000));
    await settleLateRenders(T + 121_000, jobs);
    // A new video is looked at twice: it must stay the same to count as finished.
    expect(latestRenderInfo).toHaveBeenCalledTimes(3);
    expect(upsertJob).toHaveBeenCalledWith(expect.objectContaining({ id: 'build-c1', status: 'done' }));
  });

  it('waits for a late render to be finished: still being written, it stays needs-you until a later look', async () => {
    vi.mocked(latestRenderInfo).mockResolvedValue(file(T + 120_000));
    vi.mocked(mediaProbe).mockRejectedValueOnce(new Error('no video stream found'));
    await settleLateRenders(T + 180_000, [job()]);
    expect(upsertJob).not.toHaveBeenCalled();
    await settleLateRenders(T + 240_000, [job()]);
    expect(upsertJob).toHaveBeenCalledWith(expect.objectContaining({ id: 'build-c1', status: 'done', note: 'v-2.mp4' }));
  });

  it('accepts a video up to 2 s older than the job, for a file clock a little behind', async () => {
    vi.mocked(latestRenderInfo).mockResolvedValue(file(T - 1500));
    await settleLateRenders(T + 60_000, [job()]);
    expect(upsertJob).toHaveBeenCalledWith(expect.objectContaining({ status: 'done' }));
    vi.mocked(upsertJob).mockClear();
    resetLateRenders();
    vi.mocked(latestRenderInfo).mockResolvedValue(file(T - 2500));
    await settleLateRenders(T + 60_000, [job()]);
    expect(upsertJob).not.toHaveBeenCalled();
  });

  it('never writes over a turn that started while it looked', async () => {
    vi.mocked(latestRenderInfo).mockImplementation(async () => {
      useChat.setState({ streaming: { c1: true } });
      return file(T + 120_000);
    });
    await settleLateRenders(T + 180_000, [job()]);
    expect(upsertJob).not.toHaveBeenCalled();
  });

  it('a tick reads the job list only when a build job may be waiting on its video', async () => {
    vi.mocked(listJobs).mockResolvedValue([]);
    await settleLateRenders(T);
    expect(listJobs).toHaveBeenCalledTimes(1);
    useJobs.setState({ jobs: [job({ status: 'done' })] });
    await settleLateRenders(T + 30_000);
    expect(listJobs).toHaveBeenCalledTimes(1);
    useJobs.setState({ jobs: [job()] });
    vi.mocked(listJobs).mockResolvedValue([job()]);
    await settleLateRenders(T + 60_000);
    expect(listJobs).toHaveBeenCalledTimes(2);
  });

  it('never touches a job whose chat is running a turn (waiting on a permission)', async () => {
    vi.mocked(latestRenderInfo).mockResolvedValue(file(T + 120_000));
    useChat.setState({ streaming: { c1: true } });
    await settleLateRenders(T + 180_000, [job({ note: null })]);
    expect(latestRenderInfo).not.toHaveBeenCalled();
  });
});

describe('a build job that stopped without a video, on the Agents board', () => {
  it('offers Open chat and Continue; Continue tells the agent to render, in that chat', async () => {
    vi.mocked(listJobs).mockResolvedValue([job()]);
    render(<Agents />);
    await screen.findByText('No video yet. The agent stopped before rendering');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(agentPrompt).toHaveBeenCalled());
    expect(vi.mocked(agentPrompt).mock.calls[0]![0]).toBe('c1');
    expect(useChat.getState().messages.c1!.at(-1)!.parts[0]).toEqual({
      type: 'text',
      text: 'Continue and render the video, then check the frames.',
    });
    // The turn is the job's own: back to working.
    await waitFor(() => expect(upsertJob).toHaveBeenCalledWith(expect.objectContaining({ id: 'build-c1', status: 'working' })));
    await userEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    expect(useApp.getState().route).toEqual({ name: 'chat', chatId: 'c1' });
  });

  it("Continue uses the chat's current agent, not the one the job was written with", async () => {
    vi.mocked(getChat).mockResolvedValue({ id: 'c1', projectId: 'p1', agentId: 'codex', title: 'Jalur Rempah', createdAt: '', updatedAt: '' } as never);
    vi.mocked(listJobs).mockResolvedValue([job({ agentId: 'claude' })]);
    render(<Agents />);
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(agentPrompt).toHaveBeenCalled());
    expect(vi.mocked(agentStart).mock.calls[0]!.slice(0, 2)).toEqual(['c1', 'codex']);
    vi.mocked(getChat).mockResolvedValue(null);
  });

  it('in Indonesian, also for a job waiting on an answer', async () => {
    setUiLanguage('id');
    vi.mocked(listJobs).mockResolvedValue([job({ note: 'The agent is waiting for your answer' })]);
    render(<Agents />);
    await screen.findByText('Agent menunggu jawabanmu');
    await userEvent.click(screen.getByRole('button', { name: 'Lanjutkan' }));
    await waitFor(() => expect(agentPrompt).toHaveBeenCalled());
    expect(useChat.getState().messages.c1!.at(-1)!.parts[0]).toEqual({
      type: 'text',
      text: 'Lanjutkan dan render videonya, lalu cek frame-nya.',
    });
    expect(screen.getByRole('button', { name: 'Buka chat' })).toBeInTheDocument();
  });

  it('keeps Review, without Continue, for other needs-you jobs (a permission request)', async () => {
    vi.mocked(listJobs).mockResolvedValue([job({ note: null })]);
    render(<Agents />);
    await screen.findByRole('button', { name: 'Review' });
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });
});
