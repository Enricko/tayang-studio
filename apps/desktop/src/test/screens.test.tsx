import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo, AgentUpdate, Job, Project, Settings } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({
  listProjects: vi.fn(),
  updateProject: vi.fn(),
  listChats: vi.fn(),
  createChat: vi.fn(),
  listStyles: vi.fn(),
  saveStyle: vi.fn(),
  deleteStyle: vi.fn(),
  readStyleResult: vi.fn(),
  studyDir: vi.fn(),
  listJobs: vi.fn(),
  upsertJob: vi.fn(),
  agentStart: vi.fn(),
  agentPrompt: vi.fn(),
  agentCancel: vi.fn(),
  agentStop: vi.fn().mockResolvedValue(undefined),
  agentRespondPermission: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  pickFolder: vi.fn(),
  detectAgents: vi.fn(),
  checkTools: vi.fn(),
  getSystemInfo: vi.fn(),
  listMessages: vi.fn(),
  addMessage: vi.fn(),
}));
const updateHandlers: ((e: { chatId: string; update: AgentUpdate }) => void)[] = [];
vi.mock('@/lib/events', () => ({
  onAgentUpdate: vi.fn(async (f: (e: { chatId: string; update: AgentUpdate }) => void) => {
    updateHandlers.push(f);
    return () => {};
  }),
  onPermission: vi.fn(async () => () => {}),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

import * as ipc from '@/lib/ipc';
import { Agents } from '@/screens/Agents';
import { Calendar } from '@/screens/Calendar';
import { Settings as SettingsScreen } from '@/screens/Settings';
import { Style } from '@/screens/Style';
import { Videos } from '@/screens/Videos';
import { useApp } from '@/state/app';
import { useStudy } from '@/state/study';

const settings: Settings = {
  workingFolder: '/w/Tayang',
  defaultAgent: 'claude',
  frameCheck: true,
  language: 'id',
  format: '9:16',
  fps: 30,
  onboarded: true,
};

const project = (id: string, title: string, status: Project['status'], scheduledAt: string | null = null): Project => ({
  id,
  title,
  slug: id,
  folder: `/w/Tayang/${id}`,
  kind: 'explainer',
  format: '9:16',
  language: 'id',
  status,
  styleId: null,
  scheduledAt,
  durationSec: 30,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-02T00:00:00Z',
});

const agents: AgentInfo[] = [
  { id: 'claude', name: 'Claude Code', installed: true, version: '1.0', acpCommand: [], recommended: true },
  { id: 'gemini', name: 'Gemini CLI', installed: false, version: null, acpCommand: [], recommended: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  useStudy.getState().dismiss();
  useApp.setState({ settings, needsYouCount: 0, route: { name: 'videos' } });
  vi.mocked(ipc.listProjects).mockResolvedValue([]);
  vi.mocked(ipc.listStyles).mockResolvedValue([]);
  vi.mocked(ipc.listJobs).mockResolvedValue([]);
  vi.mocked(ipc.detectAgents).mockResolvedValue(agents);
  vi.mocked(ipc.checkTools).mockResolvedValue([]);
  vi.mocked(ipc.getSystemInfo).mockResolvedValue({ os: 'macos', osVersion: '15', packageManager: 'brew' });
  vi.mocked(ipc.updateSettings).mockImplementation(async (p) => ({ ...settings, ...p }));
});

describe('Videos', () => {
  it('Rendered tab shows only rendered projects and their count', async () => {
    vi.mocked(ipc.listProjects).mockResolvedValue([
      project('a', 'Draft one', 'draft'),
      project('b', 'Rendered one', 'rendered'),
      project('c', 'Building one', 'building'),
    ]);
    render(<Videos />);
    await screen.findAllByText('Draft one');
    const tab = screen.getByRole('tab', { name: /Rendered/ });
    expect(tab).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /In progress/ })).toHaveTextContent('2');
    await userEvent.click(tab);
    expect(screen.getAllByText('Rendered one').length).toBeGreaterThan(0);
    expect(screen.queryByText('Draft one')).not.toBeInTheDocument();
    expect(screen.queryByText('Building one')).not.toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    render(<Videos />);
    expect(await screen.findByText('No videos yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument();
  });
});

describe('Style', () => {
  it('rejects a link that is not a supported video site', async () => {
    render(<Style />);
    await userEvent.type(screen.getByLabelText('Video link'), 'https://example.com/x');
    await userEvent.click(screen.getByRole('button', { name: 'Study video' }));
    expect(await screen.findByText('Paste a TikTok, Reels or YouTube link')).toBeInTheDocument();
    expect(ipc.agentPrompt).not.toHaveBeenCalled();
  });

  it('studies a valid TikTok link through the agent', async () => {
    vi.mocked(ipc.studyDir).mockResolvedValue('/w/Tayang/.tayang/style-study/s1');
    render(<Style />);
    await userEvent.type(screen.getByLabelText('Video link'), 'https://www.tiktok.com/@a/video/123');
    await userEvent.click(screen.getByRole('button', { name: 'Study video' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    expect(ipc.studyDir).toHaveBeenCalled();
    expect(vi.mocked(ipc.upsertJob).mock.calls[0]![0]).toMatchObject({ kind: 'study-style', status: 'working' });
    const [chatId, parts] = vi.mocked(ipc.agentPrompt).mock.calls[0]!;
    expect(chatId).toMatch(/^study-/);
    expect(JSON.stringify(parts)).toContain('/w/Tayang/.tayang/style-study/s1');
  });
  it('saves the style on done and marks the job failed when the result is unreadable', async () => {
    vi.mocked(ipc.studyDir).mockResolvedValue('/w/s');
    const good = JSON.stringify({ name: 'Zoom cut', notes: { camera: 'Punch-in' }, prompt: 'Cut on every beat' });
    vi.mocked(ipc.readStyleResult).mockResolvedValueOnce(good).mockResolvedValueOnce('not json');
    for (const [i, last] of [[0, 'done'], [1, 'failed']] as const) {
      vi.mocked(ipc.upsertJob).mockClear();
      const { unmount } = render(<Style />);
      await userEvent.type(screen.getByLabelText('Video link'), 'https://youtu.be/abc');
      await userEvent.click(screen.getByRole('button', { name: 'Study video' }));
      await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalledTimes(i + 1));
      const chatId = vi.mocked(ipc.agentPrompt).mock.calls[i]![0];
      updateHandlers.forEach((h) => h({ chatId, update: { kind: 'done', stopReason: 'end_turn' } }));
      await waitFor(() => expect(vi.mocked(ipc.upsertJob).mock.calls.at(-1)![0].status).toBe(last));
      expect(ipc.agentStop).toHaveBeenCalledWith(chatId);
      if (last === 'done') expect(ipc.saveStyle).toHaveBeenCalledWith(expect.objectContaining({ name: 'Zoom cut', source: 'copied' }));
      else expect(vi.mocked(ipc.upsertJob).mock.calls.at(-1)![0].note).toBeTruthy();
      unmount();
      useStudy.getState().dismiss();
    }
  });
});

describe('Agents', () => {
  it('puts a failed job in Needs you with Fix it', async () => {
    const failed: Job = {
      id: 'j1',
      kind: 'render',
      title: 'Render failed',
      projectId: 'p1',
      chatId: 'c1',
      agentId: 'claude',
      status: 'failed',
      progress: null,
      note: 'A font is missing',
      updatedAt: '2026-11-04T00:00:00Z',
    };
    vi.mocked(ipc.listJobs).mockResolvedValue([failed]);
    render(<Agents />);
    const col = await screen.findByRole('region', { name: 'Needs you' });
    expect(within(col).getByText('Render failed')).toBeInTheDocument();
    expect(within(col).getByRole('button', { name: 'Fix it' })).toBeInTheDocument();
    await waitFor(() => expect(useApp.getState().needsYouCount).toBe(1));
  });
});

describe('Calendar', () => {
  it('renders 42 cells starting on Monday Oct 26 for November 2026', () => {
    render(<Calendar today={new Date(2026, 10, 4)} />);
    const cells = screen.getAllByTestId('cal-cell');
    expect(cells).toHaveLength(42);
    expect(cells[0]).toHaveAttribute('data-date', '2026-10-26');
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
  });
});

describe('Settings', () => {
  it('toggles frameCheck through updateSettings', async () => {
    render(<SettingsScreen />);
    const sw = await screen.findByRole('switch', { name: 'Check every frame before showing me' });
    await userEvent.click(sw);
    await waitFor(() => expect(ipc.updateSettings).toHaveBeenCalledWith({ frameCheck: false }));
  });

  it('says existing projects stay put when the working folder changes', async () => {
    render(<SettingsScreen />);
    expect(await screen.findByText('Existing projects stay where they are')).toBeInTheDocument();
  });
});
