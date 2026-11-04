import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentUpdate, PermissionRequest, Settings, Style } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  createChat: vi.fn(),
  listStyles: vi.fn(),
  syncStyles: vi.fn().mockResolvedValue({ styles: [], offline: false }),
  listJobs: vi.fn().mockResolvedValue([]),
  upsertJob: vi.fn().mockResolvedValue(undefined),
  agentStart: vi.fn().mockResolvedValue(undefined),
  agentPrompt: vi.fn().mockResolvedValue(undefined),
  agentCancel: vi.fn(),
  agentStop: vi.fn().mockResolvedValue(undefined),
  agentRespondPermission: vi.fn(),
  listMessages: vi.fn().mockResolvedValue([]),
  addMessage: vi.fn().mockResolvedValue(null),
  installStyleTemplate: vi.fn(),
  writeBrief: vi.fn().mockResolvedValue(undefined),
  detectAgents: vi.fn().mockResolvedValue([]),
  assetUrl: (p: string) => p,
}));
const updateHandlers: ((e: { chatId: string; update: AgentUpdate }) => void)[] = [];
vi.mock('@/lib/events', () => ({
  onAgentUpdate: vi.fn(async (f: (e: { chatId: string; update: AgentUpdate }) => void) => {
    updateHandlers.push(f);
    return () => {};
  }),
  onPermission: vi.fn(async (_f: (r: PermissionRequest) => void) => () => {}),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

import * as ipc from '@/lib/ipc';
import { buildTopicIdeasPrompt } from '@tayang/skills';
import { extractA2ui } from '@/a2ui/parse';
import { applyMessages, emptySurfaces } from '@/a2ui/surface';
import { ideasFromReply } from '@/lib/topics';
import { MessageList } from '@/components/MessageList';
import { Calendar } from '@/screens/Calendar';
import { ChatNew } from '@/screens/ChatNew';
import { useApp } from '@/state/app';
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
  uiLanguage: null,
};

const atlas: Style = {
  id: 'atlas-journey',
  name: 'Atlas journey',
  source: 'builtin',
  sourceUrl: null,
  notes: {},
  prompt: 'maps',
  createdAt: '',
};

const V = 'v0.9';
const reply = (styleId: string) =>
  'Ini tiga ide yang cocok untuk video animasi.\n```a2ui\n' +
  [
    { version: V, createSurface: { surfaceId: 'topics', catalogId: 'basic' } },
    {
      version: V,
      updateComponents: {
        surfaceId: 'topics',
        components: [
          { id: 'root', component: 'Column', children: ['card1'] },
          { id: 'card1', component: 'Card', child: 'col1' },
          { id: 'col1', component: 'Column', children: ['t', 'why', 'b'] },
          { id: 't', component: 'Text', text: 'Mengapa Selat Malaka penting', variant: 'h4' },
          { id: 'why', component: 'Text', text: 'Peta animasi jalur kapal', variant: 'caption' },
          {
            id: 'b',
            component: 'Button',
            child: 'b-t',
            variant: 'primary',
            action: {
              event: { name: 'pick_topic', context: { title: 'Mengapa Selat Malaka penting', kind: 'data', lengthSec: 45, styleId } },
            },
          },
          { id: 'b-t', component: 'Text', text: 'Make this' },
        ],
      },
    },
  ]
    .map((m) => JSON.stringify(m))
    .join('\n') +
  '\n```';

const emit = (update: AgentUpdate) => updateHandlers.forEach((h) => h({ chatId: 'chat-1', update }));

async function askTopics(text: string) {
  render(<ChatNew />);
  await userEvent.click(screen.getByRole('button', { name: /From a topic/ }));
  await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
  await act(async () => {
    emit({ kind: 'text', text });
    emit({ kind: 'done', stopReason: 'end_turn' });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  updateHandlers.length = 0;
  useChat.getState().reset();
  useApp.setState({ settings, route: { name: 'chat-new' } });
  vi.mocked(ipc.listProjects).mockResolvedValue([]);
  vi.mocked(ipc.listStyles).mockResolvedValue([atlas]);
  vi.mocked(ipc.createChat).mockResolvedValue({ id: 'chat-1' } as never);
  vi.mocked(ipc.createProject).mockResolvedValue({ id: 'p1', title: 'Mengapa Selat Malaka penting' } as never);
});

describe('Calendar make it', () => {
  it('double click creates one project, with the style', async () => {
    localStorage.setItem(
      'tayang.ideas.2026-11-02',
      JSON.stringify([{ title: 'Ide Kalender', kind: 'explainer', lengthSec: 30, styleId: 'atlas-journey' }]),
    );
    vi.mocked(ipc.createProject).mockImplementation(
      () => new Promise((r) => setTimeout(() => r({ id: 'p1', title: 'Ide Kalender' } as never), 30)),
    );
    render(<Calendar today={new Date(2026, 10, 4)} />);
    await userEvent.dblClick(await screen.findByRole('button', { name: 'Make it' }));
    await waitFor(() => expect(ipc.createChat).toHaveBeenCalled());
    expect(ipc.createProject).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ipc.createProject).mock.calls[0]![0]).toMatchObject({ styleId: 'atlas-journey' });
    localStorage.clear();
  });
});

describe('Calendar make it with a template style', () => {
  const tmpl: Style = { ...atlas, id: 'tmpl', name: 'Paper cut', engine: 'remotion', template: { sha256: 'a', size: 1, version: 1 } };
  const makeIt = async () => {
    localStorage.setItem(
      'tayang.ideas.2026-11-02',
      JSON.stringify([{ title: 'Ide Kalender', kind: 'explainer', lengthSec: 30, styleId: 'tmpl' }]),
    );
    vi.mocked(ipc.listStyles).mockResolvedValue([atlas, tmpl]);
    vi.mocked(ipc.createProject).mockResolvedValue({ id: 'p1', title: 'Ide Kalender' } as never);
    render(<Calendar today={new Date(2026, 10, 4)} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Make it' }));
  };

  it('installs the template, with the system line and the template paragraph in the brief', async () => {
    vi.mocked(ipc.installStyleTemplate).mockResolvedValue({ installed: true });
    await makeIt();
    await waitFor(() => expect(ipc.installStyleTemplate).toHaveBeenCalledWith('p1'));
    expect(vi.mocked(ipc.createProject).mock.calls[0]![0]).toMatchObject({ styleId: 'tmpl' });
    expect(vi.mocked(ipc.createProject).mock.calls[0]![1]).toContain('This project starts from the Paper cut template.');
    expect(ipc.addMessage).toHaveBeenCalledWith('chat-1', 'system', [{ type: 'text', text: 'Setting up the Paper cut template…' }]);
    expect(ipc.writeBrief).not.toHaveBeenCalled();
    await waitFor(() => expect(useApp.getState().route).toEqual({ name: 'chat', chatId: 'chat-1' }));
    localStorage.clear();
  });

  it('rewrites the brief and says so when the template fails', async () => {
    vi.mocked(ipc.installStyleTemplate).mockRejectedValue('offline');
    await makeIt();
    await waitFor(() =>
      expect(ipc.addMessage).toHaveBeenCalledWith('chat-1', 'system', [
        { type: 'text', text: "Couldn't set up the Paper cut template: offline. Continuing without it." },
      ]),
    );
    expect(ipc.writeBrief).toHaveBeenCalledWith('p1', expect.not.stringContaining('This project starts from'));
    localStorage.clear();
  });
});

describe('the prompt example', () => {
  const prompt = buildTopicIdeasPrompt(['data'], 'id');
  const example = /```a2ui\n[\s\S]*?\n```/.exec(prompt.slice(prompt.indexOf('Example of the block')))![0];

  it('parses with extractA2ui and builds a surface with a Card, h4, caption and Make this button', () => {
    const { blocks } = extractA2ui(example);
    expect(blocks).toHaveLength(1);
    const set = applyMessages(emptySurfaces(), blocks[0]!);
    const c = set.surfaces.topics!.components;
    expect(set.surfaces.topics!.catalogId).toBe('https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json');
    expect(c.root).toMatchObject({ component: 'Column' });
    expect(c.card1).toMatchObject({ component: 'Card', child: 'col1' });
    expect(c.title1).toMatchObject({ variant: 'h4' });
    expect(c.why1).toMatchObject({ variant: 'caption' });
    expect(c['go1-text']).toMatchObject({ text: 'Make this' });
    expect(ideasFromReply(example)).toEqual([
      { title: 'Mengapa Selat Malaka begitu penting', kind: 'data', lengthSec: 45, styleId: 'atlas-journey' },
    ]);
  });

  it('adds fit hints for known styles and keeps unknown names', () => {
    const p = buildTopicIdeasPrompt(['data'], 'en', [
      { id: 'atlas-journey', name: 'Atlas journey' },
      { id: 'mine', name: 'My style' },
    ]);
    expect(p).toContain('best for places, routes, borders and trade');
    expect(p).toContain('My style (styleId "mine")');
  });
});

describe('ideasFromReply (Calendar ideas)', () => {
  it('reads Make this buttons from an a2ui reply, else a json block', () => {
    expect(ideasFromReply(reply('atlas-journey'))).toEqual([
      { title: 'Mengapa Selat Malaka penting', kind: 'data', lengthSec: 45, styleId: 'atlas-journey' },
    ]);
    expect(ideasFromReply('```json\n[{"title":"A","kind":"promo","lengthSec":20}]\n```')).toHaveLength(1);
    expect(ideasFromReply('nothing')).toEqual([]);
  });
});

describe('ideasFromReply limits and the json block in MessageList', () => {
  const idea = (t: string) => ({ title: t, kind: 'promo', lengthSec: 20 });
  const msg = (text: string) => [
    { id: 'm1', chatId: 'c1', role: 'agent' as const, parts: [{ type: 'text' as const, text }], createdAt: '' },
  ];

  it('caps at 3 and dedupes by title', () => {
    const json = JSON.stringify([idea('A'), idea('a'), idea('B'), idea('C'), idea('D')]);
    expect(ideasFromReply('```json\n' + json + '\n```').map((i) => i.title)).toEqual(['A', 'B', 'C']);
  });

  it('hides an unterminated topic json block while streaming when a screen handles topics', () => {
    const text = 'Halo\n```json\n[{"title":"Ide';
    render(<MessageList streaming messages={msg(text)} onA2uiAction={() => false} />);
    expect(screen.getByText('Halo')).toBeInTheDocument();
    expect(screen.getByText('Loading options…')).toBeInTheDocument();
    expect(screen.queryByText(/"title"/)).toBeNull();
  });

  it('keeps json blocks as written in chats without the topic handler', () => {
    const text = 'Halo\n```json\n[{"title":"Ide","kind":"promo","lengthSec":20}]\n```';
    render(<MessageList streaming={false} messages={msg(text)} />);
    expect(screen.getByText(/"title":"Ide"/)).toBeInTheDocument();
  });
});

describe('topic ideas in a new chat', () => {
  it('asks with the motion-only rules and the synced styles', async () => {
    render(<ChatNew />);
    await userEvent.click(screen.getByRole('button', { name: /From a topic/ }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    const sent = JSON.stringify(vi.mocked(ipc.agentPrompt).mock.calls[0]![1]);
    expect(sent).toContain('Never suggest anything that needs filming');
    expect(sent).toContain('atlas-journey');
    expect(sent).toContain('pick_topic');
  });

  it('keeps the intro sentence, shows cards and creates the project with the style on pick_topic', async () => {
    await askTopics(reply('atlas-journey'));
    expect(await screen.findByText('Ini tiga ide yang cocok untuk video animasi.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Make this' }));
    await waitFor(() => expect(ipc.createProject).toHaveBeenCalled());
    expect(vi.mocked(ipc.createProject).mock.calls[0]![0]).toMatchObject({
      title: 'Mengapa Selat Malaka penting',
      kind: 'data',
      styleId: 'atlas-journey',
    });
    expect(vi.mocked(ipc.createChat)).toHaveBeenCalledWith('p1', 'claude', 'Mengapa Selat Malaka penting');
    // The pick is handled by the screen, not forwarded to the agent as an answer.
    const sent = useChat.getState().messages['chat-1']!;
    expect(sent.some((m) => m.role === 'user' && m.parts.some((p) => p.type === 'a2ui-action'))).toBe(false);
  });

  it('asks for the script with the skip line when the frame check is off', async () => {
    useApp.setState({ settings: { ...settings, frameCheck: false } });
    await askTopics(reply('atlas-journey'));
    vi.mocked(ipc.agentPrompt).mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Make this' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    const parts = vi.mocked(ipc.agentPrompt).mock.calls[0]![1];
    const texts = parts.map((p) => (p.type === 'text' ? p.text : ''));
    expect(texts.indexOf('Skip the frame check this time.')).toBeGreaterThanOrEqual(0);
    expect(texts.indexOf('Skip the frame check this time.')).toBeLessThan(texts.findIndex((t) => t.startsWith('Write the script')));
    // The visible message is only the ask.
    const user = useChat.getState().messages['chat-1']!.filter((m) => m.role === 'user').at(-1)!;
    expect(JSON.stringify(user.parts)).not.toContain('Skip the frame check');
  });

  it('asks for the script without the skip line when the frame check is on', async () => {
    await askTopics(reply('atlas-journey'));
    vi.mocked(ipc.agentPrompt).mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Make this' }));
    await waitFor(() => expect(ipc.agentPrompt).toHaveBeenCalled());
    expect(JSON.stringify(vi.mocked(ipc.agentPrompt).mock.calls[0]![1])).not.toContain('Skip the frame check');
  });

  it('leaves styleId out when it is not a synced style', async () => {
    await askTopics(reply('unknown-style'));
    await userEvent.click(await screen.findByRole('button', { name: 'Make this' }));
    await waitFor(() => expect(ipc.createProject).toHaveBeenCalled());
    expect(vi.mocked(ipc.createProject).mock.calls[0]![0]).not.toHaveProperty('styleId');
  });

  it('syncs once and looks again when the idea names a style this computer does not have yet', async () => {
    const fresh: Style = { ...atlas, id: 'new-style', name: 'New style' };
    vi.mocked(ipc.listStyles).mockResolvedValue([atlas]);
    vi.mocked(ipc.syncStyles).mockImplementationOnce(async () => {
      vi.mocked(ipc.listStyles).mockResolvedValue([atlas, fresh]);
      return { styles: [atlas, fresh], offline: false };
    });
    await askTopics(reply('new-style'));
    vi.mocked(ipc.syncStyles).mockClear();
    await userEvent.click(await screen.findByRole('button', { name: 'Make this' }));
    await waitFor(() => expect(ipc.createProject).toHaveBeenCalled());
    expect(ipc.syncStyles).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ipc.createProject).mock.calls[0]![0]).toMatchObject({ styleId: 'new-style' });
  });

  it('a synced idea style wins over the template chip; otherwise the chip style is used', async () => {
    const tmpl: Style = { ...atlas, id: 'tmpl', name: 'Paper cut', template: { sha256: 'a', size: 1, version: 1 } };
    vi.mocked(ipc.listStyles).mockResolvedValue([atlas, tmpl]);
    vi.mocked(ipc.installStyleTemplate).mockResolvedValue({ installed: true });
    useApp.setState({ route: { name: 'chat-new', styleId: 'tmpl' } });
    await askTopics(reply('atlas-journey'));
    await userEvent.click(await screen.findByRole('button', { name: 'Make this' }));
    await waitFor(() => expect(ipc.createProject).toHaveBeenCalled());
    expect(vi.mocked(ipc.createProject).mock.calls[0]![0]).toMatchObject({ styleId: 'atlas-journey' });
    expect(ipc.installStyleTemplate).not.toHaveBeenCalled();
  });

  it('falls back to the template chip style when the idea style is unknown, and installs it', async () => {
    const tmpl: Style = { ...atlas, id: 'tmpl', name: 'Paper cut', template: { sha256: 'a', size: 1, version: 1 } };
    vi.mocked(ipc.listStyles).mockResolvedValue([atlas, tmpl]);
    vi.mocked(ipc.installStyleTemplate).mockResolvedValue({ installed: true });
    useApp.setState({ route: { name: 'chat-new', styleId: 'tmpl' } });
    await askTopics(reply('unknown-style'));
    await userEvent.click(await screen.findByRole('button', { name: 'Make this' }));
    await waitFor(() => expect(ipc.installStyleTemplate).toHaveBeenCalledWith('p1'));
    expect(vi.mocked(ipc.createProject).mock.calls[0]![0]).toMatchObject({ styleId: 'tmpl' });
  });

  it('json fallback shows cards and hides the raw block, keeping the intro', async () => {
    await askTopics('Halo, ini idenya.\n```json\n[{"title":"Ide JSON","kind":"promo","lengthSec":20}]\n```');
    expect(await screen.findByRole('button', { name: /Ide JSON/ })).toBeInTheDocument();
    expect(screen.getByText("Halo, ini idenya.")).toBeInTheDocument();
    expect(screen.queryByText(/"lengthSec"/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Ide JSON/ }));
    await waitFor(() => expect(ipc.createProject).toHaveBeenCalled());
    expect(vi.mocked(ipc.createProject).mock.calls[0]![0]).toMatchObject({ title: 'Ide JSON', kind: 'promo' });
  });
});
