import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo, AgentUpdate, Job, PermissionRequest, Project, Settings, Style as StyleT } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({
  listProjects: vi.fn(),
  updateProject: vi.fn(),
  listChats: vi.fn(),
  createChat: vi.fn(),
  listStyles: vi.fn(),
  syncStyles: vi.fn(),
  saveStyle: vi.fn(),
  deleteStyle: vi.fn(),
  readStyleResult: vi.fn(),
  studyDir: vi.fn(),
  listJobs: vi.fn(),
  upsertJob: vi.fn(),
  agentStart: vi.fn(),
  agentSetAuto: vi.fn(),
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
const permHandlers: ((r: PermissionRequest) => void)[] = [];
vi.mock('@/lib/events', () => ({
  onAgentUpdate: vi.fn(async (f: (e: { chatId: string; update: AgentUpdate }) => void) => {
    updateHandlers.push(f);
    return () => {};
  }),
  onPermission: vi.fn(async (f: (r: PermissionRequest) => void) => {
    permHandlers.push(f);
    return () => {};
  }),
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
import { useChat } from '@/state/chat';

const settings: Settings = {
  workingFolder: '/w/Tayang',
  defaultAgent: 'claude',
  frameCheck: true,
  language: 'id',
  format: '9:16',
  fps: 30,
  onboarded: true,
  apiUrl: 'https://api.tayang.app',
  installId: '',
  shareInstallStats: true,
  autoMode: false,
  lastPingAt: null,
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
  vi.mocked(ipc.syncStyles).mockResolvedValue({ styles: [], offline: false });
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
  it('runs in auto mode: no Allow card, and shows the commands it ran without asking', async () => {
    vi.mocked(ipc.studyDir).mockResolvedValue('/w/s');
    render(<Style />);
    await userEvent.type(screen.getByLabelText('Video link'), 'https://youtu.be/abc');
    await userEvent.click(screen.getByRole('button', { name: 'Study video' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    expect(vi.mocked(ipc.agentStart).mock.calls[0]).toEqual([expect.stringMatching(/^study-/), 'claude', true]);
    const chatId = vi.mocked(ipc.agentPrompt).mock.calls[0]![0];
    act(() =>
      updateHandlers.forEach((h) =>
        h({ chatId, update: { kind: 'tool', toolCallId: 'auto-1', title: 'Ran without asking: yt-dlp -x https://youtu.be/abc', status: 'done' } }),
      ),
    );
    expect(await screen.findByText('Ran without asking: yt-dlp -x https://youtu.be/abc')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
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

const atlas: StyleT = {
  id: 'atlas-journey',
  name: 'Atlas journey',
  source: 'builtin',
  sourceUrl: null,
  notes: { camera: 'Map fly-through' },
  prompt: 'Fly over a map.',
  createdAt: '2026-11-04T00:00:00Z',
  engine: 'remotion',
  previewUrl: 'https://api.tayang.app/v1/styles/atlas-journey/preview',
  template: { sha256: 'a', size: 1, version: 1 },
};
const plain: StyleT = { ...atlas, id: 'plain', name: 'Plain look', engine: 'hyperframes', previewUrl: null, template: null };

describe('Style built-in styles from the API', () => {
  it('syncs on open and shows the synced styles with preview images', async () => {
    let done: (r: { styles: StyleT[]; offline: boolean }) => void = () => {};
    vi.mocked(ipc.syncStyles).mockReturnValue(new Promise((res) => (done = res)));
    vi.mocked(ipc.listStyles).mockResolvedValue([atlas, plain]);
    const { container } = render(<Style />);
    expect(await screen.findByText('Updating built-in styles')).toBeInTheDocument();
    await act(async () => done({ styles: [atlas, plain], offline: false }));
    expect(await screen.findByText('Starts from a working project')).toBeInTheDocument();
    expect(ipc.syncStyles).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Updating built-in styles')).not.toBeInTheDocument();
    expect(container.querySelector('img')).toHaveAttribute('src', atlas.previewUrl);
    expect(screen.queryByText('Built-in styles are from your last sync')).not.toBeInTheDocument();
    expect(screen.getAllByText('Plain look').length).toBeGreaterThan(0);
  });

  it('falls back to the swatch when a preview image fails to load (offline)', async () => {
    vi.mocked(ipc.syncStyles).mockResolvedValue({ styles: [atlas], offline: true });
    vi.mocked(ipc.listStyles).mockResolvedValue([atlas]);
    const { container } = render(<Style />);
    await screen.findByText('Built-in styles are from your last sync');
    const imgs = [...container.querySelectorAll('img')];
    expect(imgs.length).toBe(2);
    imgs.forEach((img) => fireEvent.error(img));
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('style-swatch')).toBeInTheDocument();
    expect(screen.getByLabelText('Sampled frames')).toBeInTheDocument();
  });

  it('shows the engine in the detail', async () => {
    vi.mocked(ipc.syncStyles).mockResolvedValue({ styles: [atlas], offline: false });
    vi.mocked(ipc.listStyles).mockResolvedValue([atlas]);
    render(<Style />);
    expect(await screen.findByText('Remotion')).toBeInTheDocument();
  });

  it('offline with cached styles says they are from the last sync', async () => {
    vi.mocked(ipc.syncStyles).mockResolvedValue({ styles: [atlas], offline: true });
    vi.mocked(ipc.listStyles).mockResolvedValue([atlas]);
    render(<Style />);
    expect(await screen.findByText('Built-in styles are from your last sync')).toBeInTheDocument();
  });

  it('offline with nothing cached asks to connect', async () => {
    vi.mocked(ipc.syncStyles).mockResolvedValue({ styles: [], offline: true });
    render(<Style />);
    expect(await screen.findByText('Connect to the internet to load built-in styles')).toBeInTheDocument();
  });

  it('Use in a new chat carries the style', async () => {
    vi.mocked(ipc.syncStyles).mockResolvedValue({ styles: [atlas], offline: false });
    vi.mocked(ipc.listStyles).mockResolvedValue([atlas]);
    render(<Style />);
    await userEvent.click(await screen.findByRole('button', { name: 'Use in a new chat' }));
    expect(useApp.getState().route).toEqual({ name: 'chat-new', styleId: 'atlas-journey' });
  });
});

describe('Style study cancel', () => {
  it('cancels a running study and marks its job failed "Cancelled"', async () => {
    vi.mocked(ipc.studyDir).mockResolvedValue('/w/s');
    vi.mocked(ipc.agentCancel).mockResolvedValue();
    render(<Style />);
    await userEvent.type(screen.getByLabelText('Video link'), 'https://youtu.be/abc');
    await userEvent.click(screen.getByRole('button', { name: 'Study video' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    const chatId = vi.mocked(ipc.agentPrompt).mock.calls[0]![0];
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(ipc.agentCancel).toHaveBeenCalledWith(chatId);
    await waitFor(() => expect(vi.mocked(ipc.upsertJob).mock.calls.at(-1)![0]).toMatchObject({ status: 'failed', note: 'Cancelled' }));
    expect(ipc.agentStop).toHaveBeenCalledWith(chatId);
  });
});

describe('Agents working indicator', () => {
  const job = (id: string, status: Job['status']): Job => ({
    id,
    kind: 'build',
    title: `Job ${id}`,
    projectId: null,
    chatId: 'c1',
    agentId: 'claude',
    status,
    progress: null,
    note: null,
    updatedAt: new Date().toISOString(),
  });

  it('shows an animated bar and "working ·" only on working cards', async () => {
    vi.mocked(ipc.listJobs).mockResolvedValue([job('w', 'working'), job('q', 'queued'), job('d', 'done')]);
    render(<Agents />);
    const working = await screen.findByRole('region', { name: 'Working' });
    expect(within(working).getByRole('progressbar', { name: 'Working' })).toBeInTheDocument();
    expect(within(working).getByText(/^working · /)).toBeInTheDocument();
    for (const name of ['Queued', 'Done']) {
      const col = screen.getByRole('region', { name });
      expect(within(col).queryByRole('progressbar')).not.toBeInTheDocument();
      expect(within(col).queryByText(/working ·/)).not.toBeInTheDocument();
    }
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
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
  it('asks for ideas in a scratch chat, shows its permission card and stops the agent after', async () => {
    useChat.getState().reset();
    vi.mocked(ipc.agentStart).mockResolvedValue(false);
    vi.mocked(ipc.agentPrompt).mockResolvedValue();
    vi.mocked(ipc.agentRespondPermission).mockResolvedValue();
    render(<Calendar today={new Date(2026, 10, 4)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Get ideas' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    expect(ipc.createChat).not.toHaveBeenCalled();
    expect(ipc.agentStart).toHaveBeenCalledWith('ideas-2026-11-02', 'claude');
    await act(async () =>
      permHandlers.forEach((h) =>
        h({
          chatId: 'ideas-2026-11-02',
          requestId: 'r1',
          title: 'Read trends',
          commands: ['curl trends'],
          options: [{ id: 'once', label: 'Allow', kind: 'allow-once' }],
        }),
      ),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    expect(ipc.agentRespondPermission).toHaveBeenCalledWith('r1', 'once');
    await act(async () => {
      updateHandlers.forEach((h) =>
        h({
          chatId: 'ideas-2026-11-02',
          update: { kind: 'text', text: '```json\n[{"title":"Ide","kind":"promo","lengthSec":20}]\n```' },
        }),
      );
      updateHandlers.forEach((h) => h({ chatId: 'ideas-2026-11-02', update: { kind: 'done', stopReason: 'end_turn' } }));
    });
    expect(await screen.findByText('Ide')).toBeInTheDocument();
    await waitFor(() => expect(ipc.agentStop).toHaveBeenCalledWith('ideas-2026-11-02'));
    expect(ipc.addMessage).not.toHaveBeenCalled();
  });

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

  it('toggles auto mode through updateSettings and explains it', async () => {
    render(<SettingsScreen />);
    const sw = await screen.findByRole('switch', { name: 'Auto mode for chats' });
    expect(sw).not.toBeChecked();
    expect(
      screen.getByText(
        "Your agent runs commands without asking. Claude Code reviews risky steps itself; other agents' requests are approved one at a time.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(sw);
    await waitFor(() => expect(ipc.updateSettings).toHaveBeenCalledWith({ autoMode: true }));
  });

  it('toggles shareInstallStats through updateSettings and explains what is sent', async () => {
    render(<SettingsScreen />);
    const sw = await screen.findByRole('switch', { name: 'Share anonymous install stats' });
    expect(sw).toBeChecked();
    expect(
      screen.getByText(
        'Sends a random install ID, your system (macOS, Windows or Linux), its version, your computer\'s processor type and the app version once a day. Nothing about you or your videos.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(sw);
    await waitFor(() => expect(ipc.updateSettings).toHaveBeenCalledWith({ shareInstallStats: false }));
  });

  it('edits the API address and explains what it is for', async () => {
    render(<SettingsScreen />);
    const input = await screen.findByLabelText('API address');
    expect(input).toHaveValue('https://api.tayang.app');
    expect(screen.getByText('Used for built-in styles and install stats')).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, 'http://localhost:8787');
    await userEvent.tab();
    await waitFor(() => expect(ipc.updateSettings).toHaveBeenCalledWith({ apiUrl: 'http://localhost:8787' }));
  });

  it('rejects an API address that is not http(s)', async () => {
    render(<SettingsScreen />);
    const input = await screen.findByLabelText('API address');
    await userEvent.clear(input);
    await userEvent.type(input, 'ftp://nope');
    await userEvent.tab();
    expect(await screen.findByText('Enter an address that starts with http:// or https://')).toBeInTheDocument();
    expect(ipc.updateSettings).not.toHaveBeenCalled();
  });

  it('clearing the API address resets it to the default', async () => {
    useApp.setState({ settings: { ...settings, apiUrl: 'http://localhost:8787' } });
    render(<SettingsScreen />);
    const input = await screen.findByLabelText('API address');
    await userEvent.clear(input);
    await userEvent.tab();
    await waitFor(() => expect(ipc.updateSettings).toHaveBeenCalledWith({ apiUrl: 'https://api.tayang.app' }));
  });

  it('says existing projects stay put when the working folder changes', async () => {
    render(<SettingsScreen />);
    expect(await screen.findByText('Existing projects stay where they are')).toBeInTheDocument();
  });
});
