import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { AgentUpdate, Chat, PermissionRequest, Project, Settings } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  listChats: vi.fn(),
  createChat: vi.fn(),
  listMessages: vi.fn(),
  addMessage: vi.fn(),
  agentStart: vi.fn(),
  agentPrompt: vi.fn(),
  agentCancel: vi.fn(),
  agentRespondPermission: vi.fn(),
  getSettings: vi.fn(),
  listStyles: vi.fn(),
  mediaLatestRender: vi.fn().mockResolvedValue(null),
  mediaProbe: vi.fn().mockResolvedValue(null),
  mediaThumbnails: vi.fn().mockResolvedValue([]),
  mediaExtractFrame: vi.fn(),
  mediaRender: vi.fn(),
  assetUrl: (p: string) => p,
}));

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
  vi.mocked(ipc.listChats).mockResolvedValue([chat('c1', 'p1')]);
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
    expect(screen.getByTestId('preview-slot')).toBeInTheDocument();
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

  it('shows an error message and re-enables the composer', async () => {
    const user = userEvent.setup();
    render(<ChatProject chatId="c1" />);
    const box = await screen.findByRole('textbox', { name: 'Message' });
    await user.type(box, 'faster');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(box).toBeDisabled());
    await emit('c1', { kind: 'error', message: 'boom' });
    expect(await screen.findByText('The agent stopped unexpectedly')).toBeInTheDocument();
    expect(box).toBeEnabled();
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
