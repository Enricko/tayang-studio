import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  deleteJob: vi.fn().mockResolvedValue(undefined),
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

  it('shows a card only for a request auto mode could not approve, never for the ones it ran', async () => {
    vi.mocked(ipc.studyDir).mockResolvedValue('/w/s');
    render(<Style />);
    await userEvent.type(screen.getByLabelText('Video link'), 'https://youtu.be/abc');
    await userEvent.click(screen.getByRole('button', { name: 'Study video' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    const chatId = vi.mocked(ipc.agentPrompt).mock.calls[0]![0];
    // Rust answered this one itself: only the tool line reaches the UI.
    act(() =>
      updateHandlers.forEach((h) =>
        h({ chatId, update: { kind: 'tool', toolCallId: 'auto-1', title: 'Ran without asking: ls -la', status: 'done' } }),
      ),
    );
    expect(screen.queryByText('This request can\'t be allowed once')).not.toBeInTheDocument();
    // This one had no allow-once option, so Rust forwarded it as a normal request.
    act(() =>
      permHandlers.forEach((h) =>
        h({
          chatId,
          requestId: 'r1',
          title: 'Delete files',
          commands: ['rm -rf x'],
          options: [{ id: 'no', label: 'Reject', kind: 'reject-once' }],
        }),
      ),
    );
    expect(await screen.findByText("This request can't be allowed once")).toBeInTheDocument();
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
  previewVideoUrl: 'https://api.tayang.app/v1/styles/atlas-journey/preview-video',
  template: { sha256: 'a', size: 1, version: 1 },
};
const plain: StyleT = { ...atlas, id: 'plain', name: 'Plain look', engine: 'hyperframes', previewUrl: null, previewVideoUrl: null, template: null };
const openCard = async (name: string) => {
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(`^${name}`) }));
  return screen.findByRole('dialog');
};

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
    expect(imgs.length).toBe(1);
    imgs.forEach((img) => fireEvent.error(img));
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('style-swatch')).toBeInTheDocument();
    const dialog = await openCard('Atlas journey');
    fireEvent.error(dialog.querySelector('video')!);
    fireEvent.error(dialog.querySelector('img')!);
    expect(screen.getByLabelText('Sampled frames')).toBeInTheDocument();
  });

  it('shows the engine in the detail', async () => {
    vi.mocked(ipc.syncStyles).mockResolvedValue({ styles: [atlas], offline: false });
    vi.mocked(ipc.listStyles).mockResolvedValue([atlas]);
    render(<Style />);
    await openCard('Atlas journey');
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
    await openCard('Atlas journey');
    await userEvent.click(await screen.findByRole('button', { name: 'Use in a new chat' }));
    expect(useApp.getState().route).toEqual({ name: 'chat-new', styleId: 'atlas-journey' });
  });
});

describe('Style popup', () => {
  const mocks = () => {
    vi.mocked(ipc.syncStyles).mockResolvedValue({ styles: [atlas, plain], offline: false });
    vi.mocked(ipc.listStyles).mockResolvedValue([atlas, plain]);
  };
  let reduced = false;
  beforeEach(() => {
    reduced = false;
    window.matchMedia = ((q: string) => ({ matches: reduced && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    HTMLMediaElement.prototype.pause = vi.fn();
    HTMLMediaElement.prototype.load = vi.fn();
  });

  it('the grid is thumbnails only: no video, no details aside', async () => {
    mocks();
    const { container } = render(<Style />);
    await screen.findByRole('button', { name: /^Plain look/ });
    expect(container.querySelector('video')).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Style details' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use in a new chat' })).toBeNull();
  });

  it('clicking a card opens a dialog with the muted looping video, poster and details', async () => {
    mocks();
    render(<Style />);
    const dialog = await openCard('Atlas journey');
    const video = dialog.querySelector('video')!;
    expect(video).toHaveAttribute('src', atlas.previewVideoUrl);
    expect(video).toHaveAttribute('poster', atlas.previewUrl);
    expect(video).toHaveAttribute('autoplay');
    expect(video).toHaveAttribute('loop');
    expect(video).toHaveAttribute('playsinline');
    expect(video.muted).toBe(true);
    expect(within(dialog).getByRole('heading', { name: 'Atlas journey' })).toBeInTheDocument();
    expect(within(dialog).getByText('Map fly-through')).toBeInTheDocument();
    expect(within(dialog).getByText('Fly over a map.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Use in a new chat' })).toBeInTheDocument();
  });

  it('Enter opens the dialog from a focused card', async () => {
    mocks();
    render(<Style />);
    (await screen.findByRole('button', { name: /^Plain look/ })).focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('Escape closes the dialog, the video is gone and unloaded, and focus returns to the card', async () => {
    mocks();
    const { container } = render(<Style />);
    const dialog = await openCard('Atlas journey');
    const video = dialog.querySelector('video')!;
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(container.ownerDocument.querySelector('video')).toBeNull();
    expect(video).not.toHaveAttribute('src');
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: /^Atlas journey/ })).toHaveFocus());
  });

  it('the close button closes it too', async () => {
    mocks();
    render(<Style />);
    const dialog = await openCard('Atlas journey');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a style without a video shows its image, or the swatch frames', async () => {
    vi.mocked(ipc.syncStyles).mockResolvedValue({ styles: [{ ...atlas, previewVideoUrl: null }, plain], offline: false });
    vi.mocked(ipc.listStyles).mockResolvedValue([{ ...atlas, previewVideoUrl: null }, plain]);
    render(<Style />);
    let dialog = await openCard('Atlas journey');
    expect(dialog.querySelector('video')).toBeNull();
    expect(dialog.querySelector('img')).toHaveAttribute('src', atlas.previewUrl);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    dialog = await openCard('Plain look');
    expect(dialog.querySelector('video')).toBeNull();
    expect(within(dialog).getByLabelText('Sampled frames')).toBeInTheDocument();
  });

  it('falls back to the image when the video fails to load', async () => {
    mocks();
    render(<Style />);
    const dialog = await openCard('Atlas journey');
    fireEvent.error(dialog.querySelector('video')!);
    expect(dialog.querySelector('video')).toBeNull();
    expect(dialog.querySelector('img')).toHaveAttribute('src', atlas.previewUrl);
  });

  it('reduced motion: no autoplay, the poster with a play button that starts it', async () => {
    reduced = true;
    mocks();
    render(<Style />);
    const dialog = await openCard('Atlas journey');
    const video = dialog.querySelector('video')!;
    expect(video).not.toHaveAttribute('autoplay');
    expect(video).toHaveAttribute('poster', atlas.previewUrl);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Play preview' }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('has a pause button while playing', async () => {
    mocks();
    render(<Style />);
    const dialog = await openCard('Atlas journey');
    const video = dialog.querySelector('video')!;
    Object.defineProperty(video, 'paused', { value: false, configurable: true });
    fireEvent.playing(video);
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Pause preview' }));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    Object.defineProperty(video, 'paused', { value: true, configurable: true });
    fireEvent.pause(video);
    expect(await within(dialog).findByRole('button', { name: 'Play preview' })).toBeInTheDocument();
  });

  it('shows the poster as a layer until the video has data, and the icon says Play until it is playing', async () => {
    mocks();
    render(<Style />);
    const dialog = await openCard('Atlas journey');
    const video = dialog.querySelector('video')!;
    expect(within(dialog).getByTestId('preview-poster')).toBeInTheDocument();
    expect(within(dialog).getByTestId('preview-poster').querySelector('img')).toHaveAttribute('src', atlas.previewUrl);
    // WebKit fires play before any data: still the poster and a Play icon.
    fireEvent.play(video);
    expect(within(dialog).getByTestId('preview-poster')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Play preview' })).toBeInTheDocument();
    fireEvent.loadedData(video);
    expect(within(dialog).queryByTestId('preview-poster')).toBeNull();
    fireEvent.playing(video);
    expect(await within(dialog).findByRole('button', { name: 'Pause preview' })).toBeInTheDocument();
  });

  /** Opens a card with fake timers on, so the preview's timers are the fake ones. */
  const openWithFakeTimers = async (name: string) => {
    const card = await screen.findByRole('button', { name: new RegExp(`^${name}`) });
    vi.useFakeTimers();
    fireEvent.click(card);
    return screen.getByRole('dialog');
  };

  it('falls back to the image when the clip has no data after 5 seconds', async () => {
    mocks();
    render(<Style />);
    try {
      const dialog = await openWithFakeTimers('Atlas journey');
      act(() => void vi.advanceTimersByTime(4900));
      expect(dialog.querySelector('video')).not.toBeNull();
      act(() => void vi.advanceTimersByTime(200));
      expect(dialog.querySelector('video')).toBeNull();
      expect(dialog.querySelector('img')).toHaveAttribute('src', atlas.previewUrl);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not fall back after the clip has loaded', async () => {
    mocks();
    render(<Style />);
    try {
      const dialog = await openWithFakeTimers('Atlas journey');
      fireEvent.loadedData(dialog.querySelector('video')!);
      act(() => void vi.advanceTimersByTime(10_000));
      expect(dialog.querySelector('video')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a built-in offers Clone to edit, not Edit', async () => {
    mocks();
    render(<Style />);
    const dialog = await openCard('Atlas journey');
    expect(within(dialog).getByRole('button', { name: 'Clone to edit' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Edit prompt' })).toBeNull();
  });

  it('Clone to edit saves a copy of yours with the template and previews, and opens it in edit mode', async () => {
    mocks();
    // Like the database: the saved style shows up in the next list.
    vi.mocked(ipc.saveStyle).mockImplementation(async (st) => {
      vi.mocked(ipc.listStyles).mockResolvedValue([atlas, plain, st]);
    });
    render(<Style />);
    const dialog = await openCard('Atlas journey');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Clone to edit' }));
    await waitFor(() => expect(ipc.saveStyle).toHaveBeenCalledTimes(1));
    expect(ipc.saveStyle).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^mine-/),
        name: 'Atlas journey (copy)',
        source: 'mine',
        sourceUrl: null,
        notes: atlas.notes,
        prompt: atlas.prompt,
        engine: 'remotion',
        template: atlas.template,
        previewUrl: atlas.previewUrl,
        previewVideoUrl: atlas.previewVideoUrl,
        basedOn: 'atlas-journey',
      }),
    );
    const now = screen.getByRole('dialog');
    expect(await within(now).findByRole('textbox', { name: 'Style name' })).toHaveValue('Atlas journey (copy)');
    expect(within(now).getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Atlas journey \(copy\)/, hidden: true })).toBeInTheDocument();
  });

  it('edit mode has Name, one textarea per aspect in order, then the prompt; saving keeps notes and drops empty aspects', async () => {
    const mine: StyleT = { ...atlas, id: 'mine-1', name: 'Mine', source: 'mine', basedOn: 'atlas-journey', notes: { camera: 'Slow', pacing: 'Fast' } };
    vi.mocked(ipc.syncStyles).mockResolvedValue({ styles: [], offline: false });
    vi.mocked(ipc.listStyles).mockResolvedValue([mine]);
    vi.mocked(ipc.saveStyle).mockResolvedValue(undefined);
    render(<Style />);
    const dialog = await openCard('Mine');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Edit' }));
    const names = within(dialog).getAllByRole('textbox').map((t) => t.getAttribute('aria-label') ?? dialog.querySelector(`label[for="${t.id}"]`)?.textContent);
    expect(names).toEqual(['Style name', 'Camera', 'Pacing', 'Type', 'Color', 'Captions', 'Transitions', 'Prompt your agent gets']);
    const camera = within(dialog).getByRole('textbox', { name: 'Camera' });
    await userEvent.clear(camera);
    await userEvent.type(camera, 'Orbit');
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Pacing' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Color' }), 'Teal');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(ipc.saveStyle).toHaveBeenCalled());
    const saved = vi.mocked(ipc.saveStyle).mock.calls[0]![0];
    expect(saved).toMatchObject({ id: 'mine-1', source: 'mine', basedOn: 'atlas-journey', template: atlas.template });
    expect(saved.notes).toEqual({ camera: 'Orbit', color: 'Teal' });
  });

  it('Save needs a name and a prompt', async () => {
    const mine: StyleT = { ...atlas, id: 'mine-1', name: 'Mine', source: 'mine' };
    vi.mocked(ipc.syncStyles).mockResolvedValue({ styles: [], offline: false });
    vi.mocked(ipc.listStyles).mockResolvedValue([mine]);
    render(<Style />);
    const dialog = await openCard('Mine');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Edit' }));
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Prompt your agent gets' }));
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('a copied-from-video style has Edit directly, and unsaved aspect edits block closing; Cancel restores', async () => {
    const copied: StyleT = { id: 'c1', name: 'Zoom cut', source: 'copied', sourceUrl: null, notes: { camera: 'Punch in' }, prompt: 'Zoom.', createdAt: '2026-11-04T00:00:00Z' };
    vi.mocked(ipc.syncStyles).mockResolvedValue({ styles: [], offline: false });
    vi.mocked(ipc.listStyles).mockResolvedValue([copied]);
    render(<Style />);
    const dialog = await openCard('Zoom cut');
    expect(within(dialog).queryByRole('button', { name: 'Clone to edit' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Edit' }));
    const camera = within(dialog).getByRole('textbox', { name: 'Camera' });
    await userEvent.type(camera, ' more');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('You have unsaved changes. Save or cancel first')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(within(dialog).getByText('Punch in')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Edit' }));
    expect(within(dialog).getByRole('textbox', { name: 'Camera' })).toHaveValue('Punch in');
  });

  it('Delete on a copied style deletes it and closes the dialog', async () => {
    const copied: StyleT = { id: 'c1', name: 'Zoom cut', source: 'copied', sourceUrl: 'https://youtu.be/x', notes: {}, prompt: 'Zoom.', createdAt: '2026-11-04T00:00:00Z' };
    vi.mocked(ipc.syncStyles).mockResolvedValue({ styles: [atlas], offline: false });
    vi.mocked(ipc.listStyles).mockResolvedValue([atlas, copied]);
    vi.mocked(ipc.deleteStyle).mockResolvedValue(undefined);
    render(<Style />);
    const dialog = await openCard('Zoom cut');
    expect(within(dialog).getByText('Copied from a video · youtu.be')).toBeInTheDocument();
    expect(dialog.querySelector('video')).toBeNull();
    vi.mocked(ipc.listStyles).mockResolvedValue([atlas]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(ipc.deleteStyle).toHaveBeenCalledWith('c1');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Delete moves focus to the neighbouring card', async () => {
    const copied: StyleT = { id: 'c1', name: 'Zoom cut', source: 'copied', sourceUrl: null, notes: {}, prompt: 'Zoom.', createdAt: '2026-11-04T00:00:00Z' };
    vi.mocked(ipc.syncStyles).mockResolvedValue({ styles: [atlas], offline: false });
    vi.mocked(ipc.listStyles).mockResolvedValue([atlas, copied]);
    vi.mocked(ipc.deleteStyle).mockResolvedValue(undefined);
    render(<Style />);
    const dialog = await openCard('Zoom cut');
    vi.mocked(ipc.listStyles).mockResolvedValue([atlas]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Atlas journey/ })).toHaveFocus());
  });

  it('Escape and a click outside keep the dialog open while the prompt has unsaved edits, with a hint', async () => {
    const copied: StyleT = { id: 'c1', name: 'Zoom cut', source: 'copied', sourceUrl: null, notes: {}, prompt: 'Zoom.', createdAt: '2026-11-04T00:00:00Z' };
    vi.mocked(ipc.syncStyles).mockResolvedValue({ styles: [], offline: false });
    vi.mocked(ipc.listStyles).mockResolvedValue([copied]);
    render(<Style />);
    const dialog = await openCard('Zoom cut');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Edit' }));
    // Nothing changed yet: closing is fine elsewhere, but typing makes it dirty.
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Prompt your agent gets' }), ' More');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('You have unsaved changes. Save or cancel first')).toBeInTheDocument();
    await userEvent.click(document.querySelector('[data-slot="dialog-overlay"]')!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('You have unsaved changes. Save or cancel first')).toBeNull();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('opening Edit without changing anything still closes with Escape', async () => {
    const copied: StyleT = { id: 'c1', name: 'Zoom cut', source: 'copied', sourceUrl: null, notes: {}, prompt: 'Zoom.', createdAt: '2026-11-04T00:00:00Z' };
    vi.mocked(ipc.syncStyles).mockResolvedValue({ styles: [], offline: false });
    vi.mocked(ipc.listStyles).mockResolvedValue([copied]);
    render(<Style />);
    const dialog = await openCard('Zoom cut');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Edit' }));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('turns the open and close animation off under reduced motion', async () => {
    mocks();
    render(<Style />);
    const dialog = await openCard('Atlas journey');
    expect(dialog.className).toContain('motion-reduce:animate-none');
    expect(document.querySelector('[data-slot="dialog-overlay"]')!.className).toContain('motion-reduce:animate-none');
  });

  it('built-in styles have no Delete', async () => {
    mocks();
    render(<Style />);
    const dialog = await openCard('Atlas journey');
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).toBeNull();
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
    sourceUrl: null,
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

describe('Failed job recovery', () => {
  const failed = (over: Partial<Job>): Job => ({
    id: 'study-s1',
    kind: 'study-style',
    title: 'Study a video for a new style',
    projectId: null,
    chatId: 'study-s1',
    agentId: 'claude',
    status: 'failed',
    progress: null,
    note: 'Tayang was closed while this was running',
    sourceUrl: 'https://youtu.be/abc',
    updatedAt: '2026-11-04T00:00:00Z',
    ...over,
  });

  it('Try again restarts the study with the job link and agent, then deletes the old job and opens Style', async () => {
    vi.mocked(ipc.studyDir).mockResolvedValue('/w/s');
    vi.mocked(ipc.listJobs).mockResolvedValue([failed({ agentId: 'gemini' })]);
    useApp.setState({ route: { name: 'agents' } });
    render(<Agents />);
    const col = await screen.findByRole('region', { name: 'Needs you' });
    expect(within(col).queryByRole('button', { name: 'Fix it' })).not.toBeInTheDocument();
    expect(within(col).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    await userEvent.click(within(col).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(ipc.deleteJob).toHaveBeenCalledWith('study-s1'));
    expect(vi.mocked(ipc.agentStart).mock.calls[0]).toEqual([expect.stringMatching(/^study-/), 'gemini', true]);
    expect(JSON.stringify(vi.mocked(ipc.agentPrompt).mock.calls[0]![1])).toContain('https://youtu.be/abc');
    // The new job is written before the old one goes away.
    const writeOrder = vi.mocked(ipc.upsertJob).mock.invocationCallOrder[0]!;
    expect(writeOrder).toBeLessThan(vi.mocked(ipc.deleteJob).mock.invocationCallOrder[0]!);
    expect(useApp.getState().route).toEqual({ name: 'style' });
  });

  it('Try again opens Style straight away, before the agent has started', async () => {
    vi.mocked(ipc.studyDir).mockReturnValue(new Promise(() => {}));
    vi.mocked(ipc.listJobs).mockResolvedValue([failed({})]);
    useApp.setState({ route: { name: 'agents' } });
    render(<Agents />);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(useApp.getState().route).toEqual({ name: 'style' });
    expect(useStudy.getState().phase).toBe('running');
  });

  it('the board shows the new working card and drops the old failed one after Try again', async () => {
    vi.mocked(ipc.studyDir).mockResolvedValue('/w/s');
    const fresh: Job = failed({ id: 'study-new', status: 'working', note: null });
    vi.mocked(ipc.listJobs).mockResolvedValueOnce([failed({})]).mockResolvedValue([fresh]);
    useApp.setState({ route: { name: 'agents' } });
    render(<Agents />);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    const working = await screen.findByRole('region', { name: 'Working' });
    expect(await within(working).findByRole('progressbar', { name: 'Working' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument());
  });

  it('keeps the old job when the new one could not be written', async () => {
    vi.mocked(ipc.studyDir).mockResolvedValue('/w/s');
    vi.mocked(ipc.upsertJob).mockRejectedValue(new Error('disk full'));
    vi.mocked(ipc.listJobs).mockResolvedValue([failed({})]);
    render(<Agents />);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    expect(ipc.deleteJob).not.toHaveBeenCalled();
    vi.mocked(ipc.upsertJob).mockResolvedValue(undefined);
  });

  it('deletes the old job once the new failed job is written, so there is one failed card', async () => {
    vi.mocked(ipc.studyDir).mockRejectedValue(new Error('no folder'));
    vi.mocked(ipc.listJobs).mockResolvedValue([failed({})]);
    render(<Agents />);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(ipc.deleteJob).toHaveBeenCalledWith('study-s1'));
    const last = vi.mocked(ipc.upsertJob).mock.calls.at(-1)![0];
    expect(last.status).toBe('failed');
    expect(vi.mocked(ipc.upsertJob).mock.invocationCallOrder.at(-1)!).toBeLessThan(
      vi.mocked(ipc.deleteJob).mock.invocationCallOrder[0]!,
    );
  });

  it('Try again is disabled while another study is running', async () => {
    vi.mocked(ipc.listJobs).mockResolvedValue([failed({})]);
    useStudy.setState({ phase: 'running' });
    render(<Agents />);
    const btn = await screen.findByRole('button', { name: 'Try again' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Another study is running');
    useStudy.getState().dismiss();
  });

  it('a failed study without a saved link opens Style with the link input focused', async () => {
    vi.mocked(ipc.listJobs).mockResolvedValue([failed({ sourceUrl: null })]);
    useApp.setState({ route: { name: 'agents' } });
    render(<Agents />);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(useApp.getState().route).toEqual({ name: 'style', focusLink: true });
    expect(ipc.agentStart).not.toHaveBeenCalled();
    cleanup();
    render(<Style />);
    expect(screen.getByLabelText('Video link')).toHaveValue('');
    expect(screen.getByLabelText('Video link')).toHaveFocus();
  });

  it('Dismiss deletes the job and removes the card', async () => {
    vi.mocked(ipc.listJobs).mockResolvedValueOnce([failed({})]).mockResolvedValue([]);
    render(<Agents />);
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(ipc.deleteJob).toHaveBeenCalledWith('study-s1');
    await waitFor(() => expect(screen.queryByText('Study a video for a new style')).not.toBeInTheDocument());
  });

  it('Fix it on a chat job opens the chat with the closed-app draft, only for the closed note', async () => {
    const chatJob = failed({ id: 'build-c1', kind: 'build', title: 'Build', chatId: 'c1', sourceUrl: null });
    vi.mocked(ipc.listJobs).mockResolvedValue([chatJob]);
    const { unmount } = render(<Agents />);
    await userEvent.click(await screen.findByRole('button', { name: 'Fix it' }));
    expect(useApp.getState().route).toEqual({
      name: 'chat',
      chatId: 'c1',
      draft: "Tayang was closed while you were working on this. Check what's already done and continue.",
    });
    unmount();
    vi.mocked(ipc.listJobs).mockResolvedValue([{ ...chatJob, note: 'Render crashed' }]);
    render(<Agents />);
    await userEvent.click(await screen.findByRole('button', { name: 'Fix it' }));
    expect(useApp.getState().route).toEqual({ name: 'chat', chatId: 'c1' });
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
      sourceUrl: null,
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
