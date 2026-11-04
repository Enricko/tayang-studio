import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { AgentUpdate, Chat, PermissionRequest, Project, Settings } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  listChats: vi.fn(),
  getChat: vi.fn(),
  createChat: vi.fn(),
  listMessages: vi.fn(),
  addMessage: vi.fn(),
  agentStart: vi.fn(),
  agentPrompt: vi.fn(),
  agentCancel: vi.fn(),
  agentStop: vi.fn().mockResolvedValue(undefined),
  agentRespondPermission: vi.fn(),
  getSettings: vi.fn(),
  listStyles: vi.fn(),
  mediaLatestRender: vi.fn().mockResolvedValue(null),
  mediaProbe: vi.fn().mockResolvedValue(null),
  mediaThumbnails: vi.fn().mockResolvedValue([]),
  mediaExtractFrame: vi.fn(),
  mediaRender: vi.fn(),
  upsertJob: vi.fn().mockResolvedValue(undefined),
  listJobs: vi.fn().mockResolvedValue([]),
  attachFile: vi.fn(),
  assetUrl: (p: string) => p,
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

type UpdateCb = (e: { chatId: string; update: AgentUpdate }) => void;
type PermCb = (r: PermissionRequest) => void;
const handlers: { update: UpdateCb[]; perm: PermCb[] } = { update: [], perm: [] };
vi.mock('@/lib/events', () => ({
  onAgentUpdate: vi.fn(async (cb: UpdateCb) => {
    handlers.update.push(cb);
    return () => {};
  }),
  onPermission: vi.fn(async (cb: PermCb) => {
    handlers.perm.push(cb);
    return () => {};
  }),
}));

import { open as openDialog } from '@tauri-apps/plugin-dialog';
import * as ipc from '@/lib/ipc';
import { ChatNew } from '@/screens/ChatNew';
import { ChatProject } from '@/screens/ChatProject';
import { useApp } from '@/state/app';
import { useChat } from '@/state/chat';

const settings: Settings = {
  workingFolder: '/tmp/Tayang',
  defaultAgent: 'claude',
  frameCheck: true,
  language: 'id',
  format: '9:16',
  fps: 30,
  onboarded: true,
};

const mk = (id: string, title: string): Project => ({
  id,
  title,
  slug: id,
  folder: `/tmp/Tayang/${id}`,
  kind: 'explainer',
  format: '9:16',
  language: 'id',
  status: 'building',
  styleId: null,
  scheduledAt: null,
  durationSec: null,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
});

const projects = [mk('p1', 'Kenapa rupiah melemah?'), mk('p2', 'Sejarah singkat QRIS')];
const chat = (id: string, projectId: string | null): Chat => ({
  id,
  projectId,
  agentId: 'claude',
  title: 'chat',
  createdAt: '2026-11-01T00:00:00Z',
});

const emit = (chatId: string, update: AgentUpdate) =>
  act(async () => {
    handlers.update.forEach((cb) => cb({ chatId, update }));
  });

beforeEach(() => {
  vi.clearAllMocks();
  handlers.update.length = 0;
  handlers.perm.length = 0;
  useChat.getState().reset();
  useApp.setState({ settings, route: { name: 'chat-new' } });
  vi.mocked(ipc.listProjects).mockResolvedValue(projects);
  vi.mocked(ipc.listStyles).mockResolvedValue([]);
  // Same filter as Rust: a project id lists that project's chats, none lists chats without one.
  const allChats = [chat('c1', 'p1'), chat('c0', null)];
  vi.mocked(ipc.listChats).mockImplementation(async (projectId) =>
    allChats.filter((c) => c.projectId === (projectId ?? null)),
  );
  vi.mocked(ipc.getChat).mockImplementation(async (id) => allChats.find((c) => c.id === id) ?? null);
  vi.mocked(ipc.listMessages).mockResolvedValue([]);
  vi.mocked(ipc.createChat).mockResolvedValue(chat('c-new', null));
  vi.mocked(ipc.addMessage).mockImplementation(async (chatId, role, parts) => ({
    id: `m-${Math.random()}`,
    chatId,
    role,
    parts,
    createdAt: '',
  }));
  vi.mocked(ipc.agentStart).mockResolvedValue();
  vi.mocked(ipc.agentPrompt).mockResolvedValue();
  vi.mocked(ipc.agentRespondPermission).mockResolvedValue();
});

describe('ChatNew', () => {
  it('shows project titles after typing @ and inserts a chip on Enter', async () => {
    const user = userEvent.setup();
    render(<ChatNew />);
    expect(await screen.findByText('No video attached')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Bikin versi 15 detik dari @');
    const list = await screen.findByRole('listbox');
    expect(within(list).getByText('Kenapa rupiah melemah?')).toBeInTheDocument();
    expect(within(list).getByText('Sejarah singkat QRIS')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('1 video attached')).toBeInTheDocument();
    expect(screen.getByText('@Kenapa rupiah melemah?')).toBeInTheDocument();
  });

  it('sends without a mention part and without any project info', async () => {
    const user = userEvent.setup();
    render(<ChatNew />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'halo');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    expect(ipc.createChat).toHaveBeenCalledWith(null, 'claude', expect.any(String));
    const [chatId, parts] = vi.mocked(ipc.agentPrompt).mock.calls[0]!;
    expect(chatId).toBe('c-new');
    expect(parts.some((p) => p.type === 'mention')).toBe(false);
    expect(JSON.stringify(parts)).not.toContain('/tmp/Tayang');
  });

  it('sends the project folder and brief when a video is mentioned', async () => {
    const user = userEvent.setup();
    render(<ChatNew />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'remix @');
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    const parts = vi.mocked(ipc.agentPrompt).mock.calls[0]![1];
    expect(parts.some((p) => p.type === 'mention')).toBe(true);
    expect(JSON.stringify(parts)).toContain('/tmp/Tayang/p1');
  });
});

describe('ChatNew topic ideas', () => {
  it('turns the agent ideas into cards and creates a project on pick', async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.createProject).mockResolvedValue(mk('p9', 'Ide satu'));
    vi.mocked(ipc.createChat).mockResolvedValueOnce(chat('c-new', null)).mockResolvedValueOnce(chat('c9', 'p9'));
    render(<ChatNew />);
    await user.click(await screen.findByRole('button', { name: /From a topic/ }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    await emit('c-new', {
      kind: 'text',
      text: '```json\n[{"title":"Ide satu","kind":"explainer","lengthSec":30}]\n```',
    });
    await emit('c-new', { kind: 'done', stopReason: 'end_turn' });
    await user.click(await screen.findByRole('button', { name: /Ide satu/ }));
    await waitFor(() => expect(ipc.createProject).toHaveBeenCalled());
    expect(ipc.createProject).toHaveBeenCalledWith(
      { title: 'Ide satu', kind: 'explainer', format: '9:16', language: 'id' },
      expect.stringContaining('Ide satu'),
    );
    await waitFor(() => expect(useApp.getState().route).toEqual({ name: 'chat', chatId: 'c9' }));
    expect(useApp.getState().projectsVersion).toBeGreaterThan(0);
  });
});

describe('ChatProject', () => {
  it('renders the step bar and the preview slot', async () => {
    render(<ChatProject chatId="c1" />);
    expect(await screen.findByText('Kenapa rupiah melemah?', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Progress' })).toBeInTheDocument();
    expect(await screen.findByText('Nothing rendered yet')).toBeInTheDocument();
  });

  it('merges a text update sequence into one agent message', async () => {
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'faster');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    expect(ipc.agentStart).toHaveBeenCalledWith('c1', 'claude');
    await emit('c1', { kind: 'text', text: 'Okay, ' });
    await emit('c1', { kind: 'text', text: 'making it faster.' });
    expect(await screen.findByText('Okay, making it faster.')).toBeInTheDocument();
    expect(screen.getAllByTestId('agent-message')).toHaveLength(1);
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    expect(screen.getAllByTestId('agent-message')).toHaveLength(1);
  });

  it("talks to the chat's own agent, not the default one", async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.getChat).mockResolvedValue({ ...chat('c1', 'p1'), agentId: 'gemini' });
    render(<ChatProject chatId="c1" />);
    await screen.findByText('Kenapa rupiah melemah?', { selector: 'span' });
    expect(screen.getByText('Gemini CLI')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'go');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentStart).toHaveBeenCalledWith('c1', 'gemini'));
  });

  it('prefixes the Tayang skills on the first prompt of a non-Claude session only', async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.getChat).mockResolvedValue({ ...chat('c1', 'p1'), agentId: 'gemini' });
    render(<ChatProject chatId="c1" />);
    await screen.findByText('Kenapa rupiah melemah?', { selector: 'span' });
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'one');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalledTimes(1));
    const first = JSON.stringify(vi.mocked(ipc.agentPrompt).mock.calls[0]![1]);
    expect(first).toContain('a2ui');
    expect(first).toContain('one');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument());
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'two');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalledTimes(2));
    expect(JSON.stringify(vi.mocked(ipc.agentPrompt).mock.calls[1]![1])).not.toContain('a2ui');
  });

  it('does not prefix the skills for Claude, which loads the plugin', async () => {
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    await screen.findByText('Kenapa rupiah melemah?', { selector: 'span' });
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'one');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(vi.mocked(ipc.agentPrompt).mock.calls[0]![1])).not.toContain('a2ui');
  });

  it('shows an error message and re-enables the composer', async () => {
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    const box = await screen.findByRole('textbox', { name: 'Message' });
    await user.type(box, 'faster');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(box).toBeDisabled());
    await emit('c1', { kind: 'error', message: 'The agent reported an error: boom' });
    expect(await screen.findByText('The agent reported an error: boom')).toBeInTheDocument();
    expect(box).toBeEnabled();
  });

  it('tells the user how to sign in when the agent needs auth', async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.agentStart).mockRejectedValue(new Error('The agent needs you to sign in first (Authentication required)'));
    render(<ChatProject chatId="c1" />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'go');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(
      await screen.findByText('Sign in to Claude Code: open a terminal and run `claude` once, then try again'),
    ).toBeInTheDocument();
  });

  it('renders a permission card and Allow sends the allow option id', async () => {
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    await screen.findByRole('textbox', { name: 'Message' });
    await act(async () => {
      handlers.perm.forEach((cb) =>
        cb({
          chatId: 'c1',
          requestId: 'r1',
          title: 'Install a font',
          commands: ['brew install font'],
          options: [
            { id: 'opt-allow', label: 'Allow', kind: 'allow-once' },
            { id: 'opt-no', label: 'Reject', kind: 'reject-once' },
          ],
        }),
      );
    });
    await user.click(await screen.findByRole('button', { name: 'Allow' }));
    expect(ipc.agentRespondPermission).toHaveBeenCalledWith('r1', 'opt-allow');
  });

  it('queues parallel permission requests and answers both', async () => {
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    await screen.findByRole('textbox', { name: 'Message' });
    const req = (requestId: string, cmd: string): PermissionRequest => ({
      chatId: 'c1',
      requestId,
      title: cmd,
      commands: [cmd],
      options: [{ id: `allow-${requestId}`, label: 'Allow', kind: 'allow-once' }],
    });
    await act(async () => {
      handlers.perm.forEach((cb) => cb(req('r1', 'echo one')));
      handlers.perm.forEach((cb) => cb(req('r2', 'echo two')));
    });
    expect(screen.getAllByRole('button', { name: 'Allow' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Allow' }));
    expect(ipc.agentRespondPermission).toHaveBeenLastCalledWith('r1', 'allow-r1');
    expect(await screen.findByText('echo two', { selector: 'pre' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Allow' }));
    expect(ipc.agentRespondPermission).toHaveBeenLastCalledWith('r2', 'allow-r2');
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
  });

  it('answers still-queued requests with null when the turn ends', async () => {
    render(<ChatProject chatId="c1" />);
    await screen.findByRole('textbox', { name: 'Message' });
    const base = { chatId: 'c1', title: 't', commands: ['x'], options: [{ id: 'a', label: 'Allow', kind: 'allow-once' as const }] };
    await act(async () => {
      handlers.perm.forEach((cb) => cb({ ...base, requestId: 'q1' }));
      handlers.perm.forEach((cb) => cb({ ...base, requestId: 'q2' }));
    });
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    expect(ipc.agentRespondPermission).toHaveBeenCalledWith('q1', null);
    expect(ipc.agentRespondPermission).toHaveBeenCalledWith('q2', null);
    expect(useChat.getState().permissions['c1']).toEqual([]);
  });

  it.each([true, false])('frame check setting %s: skip line only when off', async (frameCheck) => {
    useApp.setState({ settings: { ...settings, frameCheck } });
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'faster');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    const parts = vi.mocked(ipc.agentPrompt).mock.calls[0]![1];
    expect(parts[0]).toEqual(
      frameCheck ? { type: 'text', text: 'faster' } : { type: 'text', text: 'Skip the frame check this time.' },
    );
    // The visible message never shows the instruction.
    expect(screen.queryByText('Skip the frame check this time.')).not.toBeInTheDocument();
  });

  it('shows Stop while the agent works and cancels the turn', async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.agentCancel).mockResolvedValue();
    render(<ChatProject chatId="c1" />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'faster');
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(ipc.agentCancel).toHaveBeenCalledWith('c1');
    await emit('c1', { kind: 'done', stopReason: 'cancelled' });
    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('attach and detach feed the next send, then clear', async () => {
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'fix this');
    act(() => {
      useChat.getState().attach('c1', { type: 'frame', projectId: 'p1', frame: 330, timeSec: 11, imagePath: '/x.png', marks: [] });
    });
    expect(await screen.findByText('Frame 0:11.00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    const parts = vi.mocked(ipc.agentPrompt).mock.calls[0]![1];
    expect(parts.some((p) => p.type === 'frame')).toBe(true);
    expect(useChat.getState().attachments['c1'] ?? []).toHaveLength(0);
  });
});

describe('chat persistence scope', () => {
  it.each(['setup', 'study-abc', 'ideas-2026-11-02'])('never stores %s updates', async (id) => {
    useChat.getState().listen();
    await emit(id, { kind: 'tool', toolCallId: 't1', title: 'claude mcp add -s user elevenlabs -e ELEVENLABS_API_KEY=sk_real', status: 'done' });
    await emit(id, { kind: 'text', text: 'done' });
    await emit(id, { kind: 'done', stopReason: 'end_turn' });
    await emit(id, { kind: 'error', message: 'x' });
    expect(ipc.addMessage).not.toHaveBeenCalled();
    expect(useChat.getState().messages[id]).toBeUndefined();
  });

  it('keeps an ideas chat in memory but never stores it', async () => {
    useChat.getState().listen();
    await act(async () => {
      await useChat.getState().send('ideas-2026-11-02', [{ type: 'text', text: 'ideas' }]);
    });
    await emit('ideas-2026-11-02', { kind: 'text', text: 'here' });
    await emit('ideas-2026-11-02', { kind: 'done', stopReason: 'end_turn' });
    expect(useChat.getState().messages['ideas-2026-11-02']).toHaveLength(2);
    expect(ipc.addMessage).not.toHaveBeenCalled();
  });

  it('ignores updates for chats it never loaded or started', async () => {
    useChat.getState().listen();
    await emit('someone-else', { kind: 'text', text: 'hi' });
    expect(useChat.getState().messages['someone-else']).toBeUndefined();
  });
});

describe('ChatProject render and jobs', () => {
  it('Render video renders, then records rendered with the probed duration', async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.mediaRender).mockResolvedValue('/tmp/Tayang/p1/renders/a.mp4');
    vi.mocked(ipc.mediaProbe).mockResolvedValue({ durationSec: 12.5, fps: 30, frames: 375, width: 1080, height: 1920 });
    vi.mocked(ipc.updateProject).mockImplementation(async (id, patch) => ({ ...projects[0]!, id, ...patch }));
    render(<ChatProject chatId="c1" />);
    await screen.findByText('Kenapa rupiah melemah?', { selector: 'span' });
    await user.click(screen.getByRole('button', { name: 'Render video' }));
    await waitFor(() => expect(ipc.updateProject).toHaveBeenCalledWith('p1', { status: 'rendered', durationSec: 12.5 }));
    expect(ipc.mediaRender).toHaveBeenCalledWith('p1');
    // the preview reloads after the render
    await waitFor(() => expect(vi.mocked(ipc.mediaLatestRender).mock.calls.length).toBeGreaterThan(1));
  });

  it('shows an inline error when the render fails', async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.mediaRender).mockRejectedValue(new Error('hyperframes render failed: no composition'));
    render(<ChatProject chatId="c1" />);
    await screen.findByText('Kenapa rupiah melemah?', { selector: 'span' });
    await user.click(screen.getByRole('button', { name: 'Render video' }));
    expect(await screen.findByText("Couldn't render: hyperframes render failed: no composition")).toBeInTheDocument();
    expect(ipc.updateProject).not.toHaveBeenCalled();
  });

  it('tracks a turn as a build job: working, needs you, done, failed', async () => {
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    await screen.findByText('Kenapa rupiah melemah?', { selector: 'span' });
    const statuses = () => vi.mocked(ipc.upsertJob).mock.calls.map(([j]) => j.status);
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'go');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(statuses()).toEqual(['working']));
    expect(vi.mocked(ipc.upsertJob).mock.calls[0]![0]).toMatchObject({
      id: 'build-c1',
      kind: 'build',
      projectId: 'p1',
      chatId: 'c1',
      title: 'Kenapa rupiah melemah?',
    });
    await act(async () =>
      handlers.perm.forEach((cb) =>
        cb({ chatId: 'c1', requestId: 'r1', title: 't', commands: ['x'], options: [{ id: 'a', label: 'Allow', kind: 'allow-once' }] }),
      ),
    );
    expect(statuses().at(-1)).toBe('needs-you');
    await user.click(screen.getByRole('button', { name: 'Allow' }));
    expect(statuses().at(-1)).toBe('working');
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    expect(statuses().at(-1)).toBe('done');

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'again');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await emit('c1', { kind: 'error', message: 'The agent reported an error: boom' });
    expect(vi.mocked(ipc.upsertJob).mock.calls.at(-1)![0]).toMatchObject({
      status: 'failed',
      note: 'The agent reported an error: boom',
    });
  });
});

describe('ChatProject preview refresh', () => {
  it('reloads the preview when a turn ends with done, not on error', async () => {
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    await screen.findByText('Nothing rendered yet');
    const loads = () => vi.mocked(ipc.mediaLatestRender).mock.calls.length;
    const before = loads();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'go');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    expect(loads()).toBe(before);
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    await waitFor(() => expect(loads()).toBe(before + 1));

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'again');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await emit('c1', { kind: 'error', message: 'x' });
    expect(loads()).toBe(before + 1);
  });
});

describe('chat failure handling', () => {
  const permission: PermissionRequest = {
    chatId: 'c1',
    requestId: 'r1',
    title: 'Install a font',
    commands: ['brew install font'],
    options: [{ id: 'opt-allow', label: 'Allow', kind: 'allow-once' }],
  };
  const sendFirst = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), text);
    await user.click(screen.getByRole('button', { name: 'Send' }));
  };

  it('restarts the agent session after an error', async () => {
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    await sendFirst(user, 'one');
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalledTimes(1));
    await emit('c1', { kind: 'error', message: 'crash' });
    const box = screen.getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(box).toBeEnabled());
    await user.type(box, 'two');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalledTimes(2));
    expect(ipc.agentStart).toHaveBeenCalledTimes(2);
  });

  it.each(['done', 'error'] as const)('clears an open permission card on %s', async (kind) => {
    render(<ChatProject chatId="c1" />);
    await screen.findByRole('textbox', { name: 'Message' });
    await act(async () => {
      handlers.perm.forEach((cb) => cb(permission));
    });
    expect(await screen.findByRole('button', { name: 'Allow' })).toBeInTheDocument();
    await emit('c1', kind === 'done' ? { kind: 'done', stopReason: 'end_turn' } : { kind: 'error', message: 'x' });
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
  });

  it('shows an inline error and keeps the draft and mention when the first send fails', async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.createChat).mockRejectedValue(new Error('disk full'));
    render(<ChatNew />);
    const box = await screen.findByRole('textbox', { name: 'Message' });
    await user.type(box, 'remix @');
    await user.keyboard('{Enter}');
    await user.type(box, 'faster');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText("Couldn't start the chat: disk full")).toBeInTheDocument();
    expect(box).toHaveValue('remix faster');
    expect(screen.getByText('1 video attached')).toBeInTheDocument();
    expect(ipc.agentPrompt).not.toHaveBeenCalled();
  });

  it('does not send on Enter when the @ menu has no matches', async () => {
    const user = userEvent.setup();
    render(<ChatNew />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), '@zzzz');
    await user.keyboard('{Enter}');
    expect(ipc.createChat).not.toHaveBeenCalled();
    expect(ipc.agentPrompt).not.toHaveBeenCalled();
  });
});


describe('Composer attachments', () => {
  const doc = { type: 'file', path: '/tmp/Tayang/p1/attachments/brief.pdf', name: 'brief.pdf', mime: 'application/pdf', size: 2048 } as const;
  const img = { type: 'file', path: '/tmp/Tayang/p1/attachments/shot.png', name: 'shot.png', mime: 'image/png', size: 10 } as const;

  it('opens the picker, copies the files and shows removable chips', async () => {
    const user = userEvent.setup();
    vi.mocked(openDialog).mockResolvedValue(['/Users/me/brief.pdf', '/Users/me/shot.png']);
    vi.mocked(ipc.attachFile).mockResolvedValueOnce(doc).mockResolvedValueOnce(img);
    render(<ChatProject chatId="c1" />);
    await user.click(await screen.findByRole('button', { name: 'Attach files' }));
    expect(openDialog).toHaveBeenCalledWith(expect.objectContaining({ multiple: true }));
    expect(await screen.findByText('brief.pdf')).toBeInTheDocument();
    expect(ipc.attachFile).toHaveBeenCalledWith('c1', '/Users/me/brief.pdf');
    expect(ipc.attachFile).toHaveBeenCalledWith('c1', '/Users/me/shot.png');
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'shot.png' })).toHaveAttribute('src', img.path);
    await user.click(screen.getAllByRole('button', { name: 'Remove file' })[0]!);
    expect(screen.queryByText('brief.pdf')).not.toBeInTheDocument();
    expect(screen.getByText('shot.png')).toBeInTheDocument();
  });

  it('shows the error when a file cannot be attached', async () => {
    const user = userEvent.setup();
    vi.mocked(openDialog).mockResolvedValue('/Users/me/big.mov');
    vi.mocked(ipc.attachFile).mockRejectedValue('That file is larger than 50 MB');
    render(<ChatProject chatId="c1" />);
    await user.click(await screen.findByRole('button', { name: 'Attach files' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That file is larger than 50 MB');
  });

  it('sends file parts to the agent with the message', async () => {
    const user = userEvent.setup();
    vi.mocked(openDialog).mockResolvedValue(['/Users/me/brief.pdf']);
    vi.mocked(ipc.attachFile).mockResolvedValue(doc);
    render(<ChatProject chatId="c1" />);
    await user.click(await screen.findByRole('button', { name: 'Attach files' }));
    await screen.findByText('brief.pdf');
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'use this');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    expect(vi.mocked(ipc.agentPrompt).mock.calls[0]![1]).toEqual([doc, { type: 'text', text: 'use this' }]);
    expect(screen.queryByRole('button', { name: 'Remove file' })).not.toBeInTheDocument();
  });

  it('can send attachments without any text', async () => {
    const user = userEvent.setup();
    vi.mocked(openDialog).mockResolvedValue(['/Users/me/brief.pdf']);
    vi.mocked(ipc.attachFile).mockResolvedValue(doc);
    render(<ChatProject chatId="c1" />);
    await user.click(await screen.findByRole('button', { name: 'Attach files' }));
    await screen.findByText('brief.pdf');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
  });

  it('creates the chat first when attaching in a new chat', async () => {
    const user = userEvent.setup();
    vi.mocked(openDialog).mockResolvedValue(['/Users/me/brief.pdf']);
    vi.mocked(ipc.attachFile).mockResolvedValue(doc);
    render(<ChatNew />);
    await user.click(await screen.findByRole('button', { name: 'Attach files' }));
    expect(await screen.findByText('brief.pdf')).toBeInTheDocument();
    expect(ipc.attachFile).toHaveBeenCalledWith('c-new', '/Users/me/brief.pdf');
  });

  it('is flat: no inner box around the textarea', async () => {
    render(<ChatProject chatId="c1" />);
    const box = await screen.findByRole('textbox', { name: 'Message' });
    expect(box.className).toContain('bg-transparent');
    expect(box.className).toContain('border-0');
    expect(box.className).toContain('focus-visible:ring-0');
    expect(box.className).toContain('focus-visible:border-transparent');
  });
});
