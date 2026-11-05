import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { AgentUpdate, Chat, Job, PermissionRequest, Project, RecentChat, Settings, Style } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  makeStyleSheets: vi.fn(async () => []),
  keepStyleRefs: vi.fn(async () => []),
  copyStyleRefs: vi.fn(async () => 0),
  updateProject: vi.fn(),
  setProjectStatus: vi.fn(),
  listChats: vi.fn(),
  listRecentChats: vi.fn(),
  listArchivedChats: vi.fn().mockResolvedValue([]),
  setThreadArchived: vi.fn().mockResolvedValue(undefined),
  purgeArchive: vi.fn().mockResolvedValue({ chats: 0, cards: 0 }),
  setJobsArchived: vi.fn().mockResolvedValue(undefined),
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
  onQuestion: vi.fn(async () => () => {}),
  onAgentAction: vi.fn(async () => () => {}),
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
  agentModels: {},
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

  it('a chat whose row is not known yet waits for it instead of opening as a project chat', async () => {
    let found: (c: Chat | null) => void = () => {};
    vi.mocked(ipc.getChat).mockReturnValue(new Promise((r) => (found = r)));
    useApp.setState({ route: { name: 'chat', chatId: 'c0' } });
    render(<ChatRoute />);
    expect(screen.queryByRole('region', { name: 'Preview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument();
    await act(async () => found(chat('c0', null, 'Ngobrol santai')));
    expect(await screen.findByText('Ngobrol santai')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Preview' })).not.toBeInTheDocument();
  });

  it('a chat Rust does not know opens as before', async () => {
    useApp.setState({ route: { name: 'chat', chatId: 'gone' } });
    render(<ChatRoute />);
    expect(await screen.findByRole('textbox', { name: 'Message' })).toBeInTheDocument();
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

  it('the composer keeps focus across the first send, ready for the follow-up', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'halo{Enter}');
    await waitFor(() => expect(useApp.getState().route).toEqual({ name: 'chat', chatId: 'c-new' }));
    await emit('c-new', { kind: 'text', text: 'Hai' });
    await emit('c-new', { kind: 'done', stopReason: 'end_turn' });
    const box = within(main()).getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(box).toHaveFocus());
    // Opening the chat later from Recent does not grab focus.
    act(() => useApp.getState().navigate({ name: 'videos' }));
    act(() => useApp.getState().navigate({ name: 'chat', chatId: 'c-new' }));
    expect(within(main()).getByRole('textbox', { name: 'Message' })).not.toHaveFocus();
  });

  it('a double click on From a topic asks once', async () => {
    const user = userEvent.setup();
    let made: (c: Chat) => void = () => {};
    vi.mocked(ipc.createChat).mockReturnValue(new Promise((r) => (made = r)));
    render(<Shell />);
    const topic = await screen.findByRole('button', { name: /From a topic/ });
    await user.click(topic);
    await user.click(topic);
    await act(async () => made(chat('c-new', null, 'Topic ideas')));
    await waitFor(() => expect(useApp.getState().route).toEqual({ name: 'chat', chatId: 'c-new' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    expect(ipc.createChat).toHaveBeenCalledTimes(1);
    expect(ipc.agentPrompt).toHaveBeenCalledTimes(1);
    expect(useChat.getState().messages['c-new']!.filter((m) => m.role === 'user')).toHaveLength(1);
  });

  it('a chat that is made after the user left does not pull them back', async () => {
    const user = userEvent.setup();
    let made: (c: Chat) => void = () => {};
    vi.mocked(ipc.createChat).mockReturnValue(new Promise((r) => (made = r)));
    render(<Shell />);
    await user.click(await screen.findByRole('button', { name: /From a topic/ }));
    act(() => useApp.getState().navigate({ name: 'videos' }));
    await act(async () => made(chat('c-new', null, 'Topic ideas')));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    expect(useApp.getState().route).toEqual({ name: 'videos' });
    // It is still there to find.
    expect(useChat.getState().rows['c-new']).toBeDefined();
  });

  it('a picked topic stays picked after coming back, and a second pick makes no second project', async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.createChat).mockResolvedValueOnce(chat('c-new', null, 'Topic ideas')).mockResolvedValue(chat('c9', 'p9'));
    vi.mocked(ipc.createProject).mockResolvedValue(mkProject('p9', 'Ide satu'));
    render(<Shell />);
    await user.click(await screen.findByRole('button', { name: /From a topic/ }));
    await waitFor(() => expect(useApp.getState().route).toEqual({ name: 'chat', chatId: 'c-new' }));
    await emit('c-new', { kind: 'text', text: '```json\n[{"title":"Ide satu","kind":"explainer","lengthSec":30}]\n```' });
    await emit('c-new', { kind: 'done', stopReason: 'end_turn' });
    await user.click(await screen.findByRole('button', { name: /Ide satu/ }));
    await waitFor(() => expect(useApp.getState().route).toEqual({ name: 'chat', chatId: 'c9' }));
    // Back to the topic chat: the pick is recorded there and the cards are gone.
    act(() => useApp.getState().navigate({ name: 'chat', chatId: 'c-new' }));
    expect(await within(main()).findByText('Started "Ide satu" as a video')).toBeInTheDocument();
    expect(within(main()).queryByRole('button', { name: /Ide satu/ })).not.toBeInTheDocument();
    expect(ipc.createProject).toHaveBeenCalledTimes(1);
  });

  it('an A2UI topic card counts as answered once picked, and a pick in flight blocks another after a remount', async () => {
    const user = userEvent.setup();
    let made: (p: Project) => void = () => {};
    vi.mocked(ipc.createProject).mockReturnValue(new Promise((r) => (made = r)));
    vi.mocked(ipc.createChat).mockResolvedValue(chat('c9', 'p9'));
    vi.mocked(ipc.getChat).mockResolvedValue(chat('c0', null, 'Ide'));
    const card =
      '```a2ui\n' +
      [
        { version: 'v0.9', createSurface: { surfaceId: 'topics', catalogId: 'basic' } },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'topics',
            components: [
              { id: 'root', component: 'Column', children: ['b'] },
              { id: 'b', component: 'Button', child: 'b-t', action: { event: { name: 'pick_topic', context: { title: 'Ide dua', kind: 'data', lengthSec: 45 } } } },
              { id: 'b-t', component: 'Text', text: 'Make this' },
            ],
          },
        },
      ]
        .map((m) => JSON.stringify(m))
        .join('\n') +
      '\n```';
    vi.mocked(ipc.listMessages).mockResolvedValue([
      { id: 'm1', chatId: 'c0', role: 'agent', parts: [{ type: 'text', text: card }], createdAt: '' },
    ]);
    useApp.setState({ route: { name: 'chat', chatId: 'c0' } });
    const view = render(<ChatRoute />);
    await user.click(await screen.findByRole('button', { name: 'Make this' }));
    // The screen remounts while the project is still being made: a second pick does nothing.
    view.unmount();
    render(<ChatRoute />);
    await user.click(await screen.findByRole('button', { name: 'Make this' }));
    await act(async () => made(mkProject('p9', 'Ide dua')));
    await waitFor(() => expect(useApp.getState().route).toEqual({ name: 'chat', chatId: 'c9' }));
    expect(ipc.createProject).toHaveBeenCalledTimes(1);
    act(() => useApp.getState().navigate({ name: 'chat', chatId: 'c0' }));
    await waitFor(() => expect(screen.getByTestId('a2ui-surface')).toHaveAttribute('data-answered', 'true'));
  });

  it('the template chip stays put when New chat becomes the chat', async () => {
    const user = userEvent.setup();
    let reads = 0;
    const tmpl = { id: 'tmpl', name: 'Atlas', source: 'builtin', sourceUrl: null, notes: {}, prompt: 'p', createdAt: '', template: { sha256: 'a', size: 1, version: 1 } } as const;
    // New chat reads the styles; any later read hangs.
    vi.mocked(ipc.listStyles).mockImplementation(() => (++reads <= 1 ? Promise.resolve([tmpl]) : new Promise(() => {})));
    useApp.setState({ route: { name: 'chat-new', styleId: 'tmpl' } });
    render(<Shell />);
    expect(await screen.findByText('Starting from the Atlas template')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'halo{Enter}');
    await waitFor(() => expect(useApp.getState().route).toMatchObject({ name: 'chat', chatId: 'c-new' }));
    expect(within(main()).getByText('Starting from the Atlas template')).toBeInTheDocument();
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

  it('asks Rust for one more than it shows, so See all appears only when there is more', async () => {
    vi.mocked(ipc.listRecentChats).mockResolvedValue(Array.from({ length: 10 }, (_, i) => recent(`n${i}`, null, `Obrolan ${i + 1}`)));
    render(<Sidebar active="chat" />);
    await screen.findByRole('link', { name: 'Obrolan 10' });
    expect(ipc.listRecentChats).toHaveBeenCalledWith(11);
    expect(screen.queryByRole('button', { name: 'See all' })).not.toBeInTheDocument();
  });

  it('a stale Recent row never undoes an agent switch', async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.listRecentChats).mockResolvedValue([recent('c0', null, 'Ngobrol santai')]);
    useChat.getState().rememberChat({ ...chat('c0', null, 'Ngobrol santai'), agentId: 'codex' });
    render(<Sidebar active="chat" />);
    await user.click(await screen.findByRole('link', { name: /Ngobrol santai/ }));
    expect(useApp.getState().route).toEqual({ name: 'chat', chatId: 'c0' });
    expect(useChat.getState().rows.c0?.agentId).toBe('codex');
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

  it('See all with no chats says there are none yet, not that none match', async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.listRecentChats).mockImplementation(async (limit) =>
      limit ? Array.from({ length: 11 }, (_, i) => recent(`n${i}`, null, `Obrolan ${i + 1}`)) : [],
    );
    render(<Sidebar active="chat" />);
    await user.click(await screen.findByRole('button', { name: 'See all' }));
    const dialog = await screen.findByRole('dialog', { name: 'All chats' });
    expect(await within(dialog).findByText('No chats yet')).toBeInTheDocument();
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

describe('@mentioning a style in the chat screens', () => {
  const atlas: Style = {
    id: 'builtin-atlas',
    name: 'Atlas journey',
    source: 'builtin',
    sourceUrl: null,
    notes: { camera: 'Slow push-ins' },
    prompt: 'Animate a journey across a paper map.',
    createdAt: '',
    previewUrl: 'https://cdn.tayang.app/atlas.jpg',
    template: { sha256: 'a', size: 1, version: 1 },
  };
  const paper: Style = { ...atlas, id: 'paper', name: 'Paper cut', previewUrl: null };
  const mine: Style = { ...atlas, id: 'mine-1', name: 'Mine', source: 'mine', template: null, previewUrl: null };
  const sentText = () => JSON.stringify(vi.mocked(ipc.agentPrompt).mock.calls.at(-1)![1]);

  beforeEach(() => {
    vi.mocked(ipc.listStyles).mockResolvedValue([atlas, paper, mine]);
  });

  const mentionStyle = async (user: ReturnType<typeof userEvent.setup>, query: string) => {
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), `@${query}`);
    await screen.findByRole('option', { name: new RegExp(query, 'i') });
    await user.keyboard('{Enter}');
  };

  it('New chat: a style with a template becomes the chat template, with one chip, and the agent gets the style', async () => {
    const user = userEvent.setup();
    // The template from the Style screen, replaced by the one mentioned.
    useApp.setState({ route: { name: 'chat-new', styleId: 'paper' } });
    render(<Shell />);
    expect(await screen.findByText('Starting from the Paper cut template')).toBeInTheDocument();
    await mentionStyle(user, 'atlas');
    expect(screen.getByText('@Atlas journey')).toBeInTheDocument();
    expect(screen.queryByText(/^Starting from the/)).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'bikin ini');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(useApp.getState().route).toEqual({ name: 'chat', chatId: 'c-new', styleId: 'builtin-atlas' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    expect(sentText()).toContain('Use the style \\"Atlas journey\\" for this video:');
    expect(sentText()).toContain('Animate a journey across a paper map.');
    expect(sentText()).not.toContain('cdn.tayang.app');
    // The sent message shows the chip; the chat keeps the template for topic starts.
    expect(await within(main()).findByText('@Atlas journey')).toBeInTheDocument();
    expect(await within(main()).findByText('Starting from the Atlas journey template')).toBeInTheDocument();
  });

  it('New chat: a style without a template only adds context', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    await mentionStyle(user, 'mine');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(useApp.getState().route).toEqual({ name: 'chat', chatId: 'c-new' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    expect(sentText()).toContain('Use the style \\"Mine\\" for this video:');
  });

  it('New chat: a restored chip sent before the styles load still sends the style and sets the template', async () => {
    const user = userEvent.setup();
    let reads = 0;
    // The screen's own read hangs; the one the send makes answers.
    vi.mocked(ipc.listStyles).mockImplementation(() => (++reads <= 1 ? new Promise(() => {}) : Promise.resolve([atlas, paper, mine])));
    useChat.getState().setDraft('new', { text: 'bikin', style: { styleId: 'builtin-atlas', name: 'Atlas journey' } });
    render(<Shell />);
    expect(await screen.findByText('@Atlas journey')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(useApp.getState().route).toEqual({ name: 'chat', chatId: 'c-new', styleId: 'builtin-atlas' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    expect(sentText()).toContain('Use the style \\"Atlas journey\\" for this video:');
  });

  it('New chat: the style chip survives going elsewhere and back', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    await mentionStyle(user, 'atlas');
    act(() => useApp.getState().navigate({ name: 'videos' }));
    act(() => useApp.getState().navigate({ name: 'chat-new' }));
    expect(await screen.findByText('@Atlas journey')).toBeInTheDocument();
    expect(screen.queryByText(/^Starting from the/)).not.toBeInTheDocument();
  });

  it('a chat without a project sends the style with the message', async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.getChat).mockResolvedValue(chat('c0', null, 'Ngobrol'));
    useApp.setState({ route: { name: 'chat', chatId: 'c0' } });
    render(<ChatRoute />);
    await screen.findByText('Ngobrol');
    await mentionStyle(user, 'mine');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    expect(sentText()).toContain('Use the style \\"Mine\\" for this video:');
  });

  it('a project chat: the style is context only, with a hint when the project has no style yet', async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.getChat).mockResolvedValue(chat('c1', 'p1'));
    useApp.setState({ route: { name: 'chat', chatId: 'c1' } });
    render(<ChatRoute />);
    await screen.findByRole('list', { name: 'Progress' });
    await mentionStyle(user, 'atlas');
    expect(screen.getByText('This style is used for this message')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'ganti gaya');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    expect(sentText()).toContain('Use the style \\"Atlas journey\\" for this video:');
    expect(ipc.updateProject).not.toHaveBeenCalled();
    expect(ipc.installStyleTemplate).not.toHaveBeenCalled();
  });

  it('a project chat with a style shows no hint', async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.listProjects).mockResolvedValue([{ ...mkProject('p1', 'Kenapa rupiah melemah?'), styleId: 'paper' }]);
    vi.mocked(ipc.getChat).mockResolvedValue(chat('c1', 'p1'));
    useApp.setState({ route: { name: 'chat', chatId: 'c1' } });
    render(<ChatRoute />);
    await screen.findByRole('list', { name: 'Progress' });
    await mentionStyle(user, 'atlas');
    expect(screen.getByText('@Atlas journey')).toBeInTheDocument();
    expect(screen.queryByText('This style is used for this message')).not.toBeInTheDocument();
  });
});
