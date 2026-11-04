import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { AgentUpdate, Chat, Job, PermissionRequest, Project, RecentChat, Settings } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  setProjectStatus: vi.fn(),
  listChats: vi.fn(),
  listRecentChats: vi.fn(),
  getChat: vi.fn(),
  createChat: vi.fn(),
  listMessages: vi.fn(),
  addMessage: vi.fn(),
  agentStart: vi.fn(),
  agentSetAuto: vi.fn().mockResolvedValue(undefined),
  agentPrompt: vi.fn(),
  agentCancel: vi.fn(),
  agentStop: vi.fn().mockResolvedValue(undefined),
  agentRespondPermission: vi.fn(),
  listStyles: vi.fn(),
  syncStyles: vi.fn().mockResolvedValue({ styles: [], offline: false }),
  mediaLatestRender: vi.fn().mockResolvedValue(null),
  latestRenderInfo: vi.fn().mockResolvedValue(null),
  mediaProbe: vi.fn().mockResolvedValue(null),
  upsertJob: vi.fn().mockResolvedValue(undefined),
  listJobs: vi.fn().mockResolvedValue([]),
  attachFile: vi.fn(),
  detectAgents: vi.fn(),
  updateChatAgent: vi.fn(),
  installStyleTemplate: vi.fn(),
  renderCommand: vi.fn().mockResolvedValue(null),
  writeBrief: vi.fn().mockResolvedValue(undefined),
  recentImages: vi.fn().mockResolvedValue([]),
  getAgentUsage: vi.fn().mockResolvedValue([]),
  assetUrl: (p: string) => p,
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

type UpdateCb = (e: { chatId: string; update: AgentUpdate }) => void;
const handlers: { update: UpdateCb[]; perm: ((r: PermissionRequest) => void)[] } = { update: [], perm: [] };
vi.mock('@/lib/events', () => ({
  onAgentUpdate: vi.fn(async (cb: UpdateCb) => {
    handlers.update.push(cb);
    return () => {};
  }),
  onPermission: vi.fn(async (cb: (r: PermissionRequest) => void) => {
    handlers.perm.push(cb);
    return () => {};
  }),
}));

import { open as openDialog } from '@tauri-apps/plugin-dialog';
import * as ipc from '@/lib/ipc';
import { Sidebar } from '@/components/Sidebar';
import { ChatRoute } from '@/screens/ChatRoute';
import { setUiLanguage } from '@/i18n';
import { useApp } from '@/state/app';
import { useChat } from '@/state/chat';
import { useJobs } from '@/state/jobs';

const settings: Settings = {
  workingFolder: '/tmp/Tayang',
  defaultAgent: 'claude',
  frameCheck: true,
  language: 'id',
  format: '9:16',
  fps: 30,
  onboarded: true,
  apiUrl: 'https://studio.tayang.app/api',
  installId: '',
  shareInstallStats: true,
  autoMode: false,
  lastPingAt: null,
  uiLanguage: null,
  backgroundMode: false,
  openAtLogin: false,
  buildJobsChecked: true,
  projectStatusChecked: true,
};

const mkProject = (id: string, title: string): Project => ({
  id,
  title,
  slug: id,
  folder: `/tmp/Tayang/${id}`,
  kind: 'explainer',
  format: '9:16',
  language: 'id',
  status: 'building',
  styleId: null,
  scheduledAt: null, reviewState: 'none', postedAt: null, remindedAt: null, reviewRemindedAt: null,
  durationSec: null,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
});

const chat = (id: string, projectId: string | null, title = 'chat'): Chat => ({
  id,
  projectId,
  agentId: 'claude',
  title,
  createdAt: '2026-11-01T00:00:00Z',
});
const recent = (id: string, projectId: string | null, title: string, projectTitle: string | null = null): RecentChat => ({
  ...chat(id, projectId, title),
  projectTitle,
  activeAt: '2026-11-04T00:00:00Z',
});

const emit = (chatId: string, update: AgentUpdate) =>
  act(async () => {
    handlers.update.forEach((cb) => cb({ chatId, update }));
  });

/** The sidebar and the main column, like the app's shell: Videos stands for any other screen. */
function Shell() {
  const name = useApp((s) => s.route.name);
  return (
    <>
      <Sidebar active="chat" />
      <main>{name === 'videos' ? <p>Videos screen</p> : <ChatRoute />}</main>
    </>
  );
}

const nav = () => screen.getByRole('navigation', { name: 'Main' });
const main = () => screen.getByRole('main');

beforeEach(() => {
  vi.clearAllMocks();
  handlers.update.length = 0;
  handlers.perm.length = 0;
  useChat.getState().reset();
  useJobs.setState({ jobs: [] });
  useApp.setState({ settings, route: { name: 'chat-new' }, leaveGuard: null, newChatId: null });
  vi.mocked(ipc.listProjects).mockResolvedValue([mkProject('p1', 'Kenapa rupiah melemah?')]);
  vi.mocked(ipc.listStyles).mockResolvedValue([]);
  vi.mocked(ipc.listRecentChats).mockResolvedValue([]);
  vi.mocked(ipc.getChat).mockResolvedValue(null);
  vi.mocked(ipc.listMessages).mockResolvedValue([]);
  vi.mocked(ipc.createChat).mockResolvedValue(chat('c-new', null, 'halo'));
  vi.mocked(ipc.addMessage).mockImplementation(async (chatId, role, parts) => ({
    id: `m-${Math.random()}`,
    chatId,
    role,
    parts,
    createdAt: '',
  }));
  vi.mocked(ipc.agentStart).mockResolvedValue(false);
  vi.mocked(ipc.agentPrompt).mockResolvedValue();
});

describe('chat store rows and drafts', () => {
  it('remembers chat rows and drafts until reset', () => {
    act(() => {
      useChat.getState().rememberChat({ id: 'c1', projectId: null, agentId: 'claude', title: 'Hi', createdAt: '' });
      useChat.getState().setDraft('new', { text: 'half a thought', style: null });
    });
    expect(useChat.getState().rows.c1?.projectId).toBeNull();
    expect(useChat.getState().drafts.new?.text).toBe('half a thought');
    useChat.getState().reset();
    expect(useChat.getState().rows).toEqual({});
    expect(useChat.getState().drafts).toEqual({});
  });
});

describe('a new chat never disappears', () => {
  it('the first send moves to the chat, which survives leaving and coming back through Recent', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'apa kabar');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(useApp.getState().route).toEqual({ name: 'chat', chatId: 'c-new' }));
    expect(await within(main()).findByText('apa kabar')).toBeInTheDocument();
    // The chat's title heads it.
    expect(within(main()).getByText('halo')).toBeInTheDocument();
    await emit('c-new', { kind: 'text', text: 'Sebentar, aku cek dulu' });
    expect(within(main()).getByText('Sebentar, aku cek dulu')).toBeInTheDocument();

    vi.mocked(ipc.listRecentChats).mockResolvedValue([recent('c-new', null, 'halo')]);
    act(() => useApp.getState().navigate({ name: 'videos' }));
    expect(within(main()).queryByText('Sebentar, aku cek dulu')).not.toBeInTheDocument();
    await emit('c-new', { kind: 'text', text: ' dan ini lanjutannya' });

    await user.click(await within(nav()).findByRole('link', { name: /halo/ }));
    expect(useApp.getState().route).toEqual({ name: 'chat', chatId: 'c-new' });
    // The reply kept streaming while the chat was closed.
    expect(await within(main()).findByText('Sebentar, aku cek dulu dan ini lanjutannya')).toBeInTheDocument();
    expect(within(main()).getByRole('textbox', { name: 'Message' })).toBeDisabled();
  });

  it('a chat without a project has no preview, step bar or render button; its title heads it', async () => {
    vi.mocked(ipc.getChat).mockResolvedValue(chat('c0', null, 'Ngobrol santai'));
    useApp.setState({ route: { name: 'chat', chatId: 'c0' } });
    render(<ChatRoute />);
    expect(await screen.findByText('Ngobrol santai')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Preview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Progress' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Render' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
  });

  it('a project chat still opens with its preview', async () => {
    vi.mocked(ipc.getChat).mockResolvedValue(chat('c1', 'p1'));
    useApp.setState({ route: { name: 'chat', chatId: 'c1' } });
    render(<ChatRoute />);
    expect(await screen.findByRole('list', { name: 'Progress' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Preview' })).toBeInTheDocument();
  });

  it('topic cards work in the chat the topic ask moved to, with the template from the Style screen', async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.createChat).mockResolvedValueOnce(chat('c-new', null, 'Topic ideas')).mockResolvedValueOnce(chat('c9', 'p9'));
    vi.mocked(ipc.createProject).mockResolvedValue(mkProject('p9', 'Ide satu'));
    vi.mocked(ipc.listStyles).mockResolvedValue([
      { id: 'tmpl', name: 'Atlas', source: 'builtin', sourceUrl: null, notes: {}, prompt: 'p', createdAt: '', engine: 'remotion', template: { sha256: 'a', size: 1, version: 1 } },
    ]);
    vi.mocked(ipc.installStyleTemplate).mockResolvedValue({ installed: true });
    useApp.setState({ route: { name: 'chat-new', styleId: 'tmpl' } });
    render(<Shell />);
    await user.click(await screen.findByRole('button', { name: /From a topic/ }));
    await waitFor(() => expect(useApp.getState().route).toEqual({ name: 'chat', chatId: 'c-new', styleId: 'tmpl' }));
    expect(await screen.findByText('Starting from the Atlas template')).toBeInTheDocument();
    await emit('c-new', { kind: 'text', text: '```json\n[{"title":"Ide satu","kind":"explainer","lengthSec":30}]\n```' });
    expect(screen.queryByRole('button', { name: /Ide satu/ })).not.toBeInTheDocument();
    await emit('c-new', { kind: 'done', stopReason: 'end_turn' });
    await user.click(await screen.findByRole('button', { name: /Ide satu/ }));
    await waitFor(() => expect(useApp.getState().route).toEqual({ name: 'chat', chatId: 'c9' }));
    expect(vi.mocked(ipc.createProject).mock.calls[0]![0]).toMatchObject({ title: 'Ide satu', styleId: 'tmpl' });
  });

  it('an unsent draft on New chat survives going elsewhere and back', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'setengah jadi');
    act(() => useApp.getState().navigate({ name: 'videos' }));
    act(() => useApp.getState().navigate({ name: 'chat-new' }));
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('setengah jadi');
  });

  it('attaching a file before sending moves to the chat and keeps the typed text', async () => {
    const user = userEvent.setup();
    vi.mocked(openDialog).mockResolvedValue('/tmp/a.png' as never);
    vi.mocked(ipc.attachFile).mockResolvedValue({ type: 'file', path: '/tmp/a.png', name: 'a.png', mime: 'image/png', size: 1 } as never);
    render(<Shell />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'pakai ini');
    await user.click(screen.getByRole('button', { name: 'Attach files' }));
    await waitFor(() => expect(useApp.getState().route).toMatchObject({ name: 'chat', chatId: 'c-new', draft: 'pakai ini' }));
    expect(await within(main()).findByRole('textbox', { name: 'Message' })).toHaveValue('pakai ini');
    await waitFor(() => expect(useChat.getState().attachments['c-new']).toHaveLength(1));
    // The draft went with the chat: a fresh New chat starts empty.
    act(() => useApp.getState().navigate({ name: 'chat-new' }));
    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('');
  });

  it('Chat goes back to the running new chat; once it is done, Chat starts fresh', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'halo');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(useApp.getState().route).toEqual({ name: 'chat', chatId: 'c-new' }));
    act(() => useApp.getState().navigate({ name: 'videos' }));
    await user.click(within(nav()).getByRole('link', { name: 'Chat' }));
    expect(useApp.getState().route).toEqual({ name: 'chat', chatId: 'c-new' });
    // New chat always starts a fresh one.
    await user.click(within(nav()).getByRole('button', { name: 'New chat' }));
    expect(useApp.getState().route).toEqual({ name: 'chat-new' });
    await emit('c-new', { kind: 'done', stopReason: 'end_turn' });
    act(() => useApp.getState().navigate({ name: 'videos' }));
    await user.click(within(nav()).getByRole('link', { name: 'Chat' }));
    expect(useApp.getState().route).toEqual({ name: 'chat-new' });
  });
});

describe('Recent in the sidebar', () => {
  const list = [
    recent('c0', null, 'Ngobrol santai'),
    recent('c1', 'p1', 'Video chat', 'Kenapa rupiah melemah?'),
    recent('study-x', null, 'Study'),
    recent('c2', 'p1', 'Older video chat', 'Kenapa rupiah melemah?'),
    recent('c3', 'p3', 'x', 'Promo Kopi Senja'),
  ];

  it('lists chats with and without a project in the order Rust gives, once per project, without internal chats', async () => {
    vi.mocked(ipc.listRecentChats).mockResolvedValue(list);
    render(<Sidebar active="chat" />);
    await screen.findByRole('link', { name: /Ngobrol santai/ });
    const recentLinks = screen.getAllByRole('link').filter((l) => l.closest('[data-recent]'));
    expect(recentLinks.map((l) => l.textContent)).toEqual(['Ngobrol santai', 'Kenapa rupiah melemah?', 'Promo Kopi Senja']);
    expect(screen.queryByText('Study')).not.toBeInTheDocument();
  });

  it('pulses for a running chat and shows the orange dot for one that needs you', async () => {
    vi.mocked(ipc.listRecentChats).mockResolvedValue(list);
    useChat.setState({ streaming: { c0: true } });
    useJobs.setState({ jobs: [{ id: 'build-c3', chatId: 'c3', status: 'needs-you' } as Job] });
    render(<Sidebar active="chat" />);
    const running = await screen.findByRole('link', { name: /Ngobrol santai/ });
    expect(running.querySelector('[data-status]')).toHaveAttribute('data-status', 'working');
    expect(running).toHaveTextContent('Working');
    const waiting = screen.getByRole('link', { name: /Promo Kopi Senja/ });
    expect(waiting.querySelector('[data-status]')).toHaveAttribute('data-status', 'needs-you');
    expect(waiting).toHaveTextContent('Needs you');
    expect(screen.getByRole('link', { name: /Kenapa rupiah/ }).querySelector('[data-status]')).toHaveAttribute('data-status', 'idle');
  });

  it('opens a chat on click', async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.listRecentChats).mockResolvedValue(list);
    render(<Sidebar active="chat" />);
    await user.click(await screen.findByRole('link', { name: /Kenapa rupiah/ }));
    expect(useApp.getState().route).toEqual({ name: 'chat', chatId: 'c1' });
    expect(useChat.getState().rows.c1?.projectId).toBe('p1');
  });

  it('shows ten, and See all opens a searchable list of every chat', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 12 }, (_, i) => recent(`n${i}`, null, `Obrolan ${i + 1}`));
    vi.mocked(ipc.listRecentChats).mockResolvedValue(many);
    render(<Sidebar active="chat" />);
    await screen.findByRole('link', { name: 'Obrolan 1' });
    expect(screen.queryByRole('link', { name: 'Obrolan 11' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'See all' }));
    const dialog = await screen.findByRole('dialog', { name: 'All chats' });
    expect(within(dialog).getByRole('button', { name: 'Obrolan 12' })).toBeInTheDocument();
    await user.type(within(dialog).getByRole('searchbox', { name: 'Search chats' }), 'obrolan 11');
    expect(within(dialog).getAllByRole('button', { name: /^Obrolan/ }).map((b) => b.textContent)).toEqual(['Obrolan 11']);
    await user.click(within(dialog).getByRole('button', { name: 'Obrolan 11' }));
    expect(useApp.getState().route).toEqual({ name: 'chat', chatId: 'n10' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('speaks Indonesian', async () => {
    const user = userEvent.setup();
    setUiLanguage('id');
    vi.mocked(ipc.listRecentChats).mockResolvedValue(Array.from({ length: 12 }, (_, i) => recent(`n${i}`, null, `Obrolan ${i + 1}`)));
    useChat.setState({ streaming: { n0: true } });
    render(<Sidebar active="chat" />);
    expect(await screen.findByRole('link', { name: /^Obrolan 1 / })).toHaveTextContent('Sedang dikerjakan');
    await user.click(screen.getByRole('button', { name: 'Lihat semua' }));
    const dialog = await screen.findByRole('dialog', { name: 'Semua chat' });
    await user.type(within(dialog).getByRole('searchbox', { name: 'Cari chat' }), 'zzz');
    expect(within(dialog).getByText('Tidak ada chat yang cocok')).toBeInTheDocument();
  });
});
