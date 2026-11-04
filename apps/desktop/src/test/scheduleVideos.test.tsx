import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { AgentUpdate, ChatMessage, Project } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({
  listProjects: vi.fn(),
  setSchedule: vi.fn(),
  createProject: vi.fn(),
  listChats: vi.fn(),
  createChat: vi.fn(),
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
  assetUrl: (p: string) => p,
}));
vi.mock('@/lib/events', () => ({
  onAgentUpdate: vi.fn(async (_cb: (e: { chatId: string; update: AgentUpdate }) => void) => () => {}),
  onPermission: vi.fn(async () => () => {}),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

import { addMessage, agentPrompt, createChat, createProject, listChats, listProjects, setSchedule } from '@/lib/ipc';
import { MessageList } from '@/components/MessageList';
import { ScheduleDialog } from '@/components/ScheduleDialog';
import { onAutopilotChanged } from '@/lib/autopilotHooks';
import { checkScheduleItems } from '@/lib/scheduleVideos';
import { setUiLanguage } from '@/i18n';
import { useApp } from '@/state/app';
import { BUSY_NOTE, useChat } from '@/state/chat';

const proj = (extra: Partial<Project> = {}): Project => ({
  id: 'p1', title: 'Jalur Rempah', slug: 'jalur', folder: '/w/jalur', kind: 'explainer', format: '9:16', language: 'id',
  status: 'rendered', styleId: null, scheduledAt: null, reviewState: 'none', postedAt: null,
  remindedAt: null, reviewRemindedAt: null, durationSec: null, createdAt: 'c', updatedAt: 'u', ...extra,
});

const DAY = 24 * 60 * 60 * 1000;
const inDays = (d: number) => new Date(Date.now() + d * DAY).toISOString().replace(/\.\d+Z$/, 'Z');

const card = (items: unknown[], surfaceId = 'plan') =>
  '```a2ui\n' +
  [
    { version: 'v0.9', createSurface: { surfaceId, catalogId: 'basic' } },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Column', children: ['go'] },
          { id: 'go-t', component: 'Text', text: 'Schedule these' },
          { id: 'go', component: 'Button', child: 'go-t', action: { event: { name: 'schedule_videos', context: { items } } } },
        ],
      },
    },
  ]
    .map((m) => JSON.stringify(m))
    .join('\n') +
  '\n```';

const agentMsg = (chatId: string, text: string): ChatMessage => ({
  id: 'm1', chatId, role: 'agent', parts: [{ type: 'text', text }], createdAt: '2026-11-04T00:00:00Z',
});

/** Renders the chat from the store, as a screen does, so lines Tayang adds show up. */
function Chat({ chatId, onA2uiAction, withSendOptions }: { chatId: string; onA2uiAction?: () => boolean; withSendOptions?: boolean }) {
  const messages = useChat((s) => s.messages[chatId]) ?? [];
  return (
    <MessageList
      messages={messages}
      streaming={false}
      onA2uiAction={onA2uiAction}
      sendOptions={withSendOptions ? () => ({ agentId: 'claude', job: { projectId: 'p1', title: 'Jalur Rempah' } }) : undefined}
    />
  );
}

const seed = (chatId: string, text: string) => useChat.setState({ messages: { [chatId]: [agentMsg(chatId, text)] } });

beforeEach(() => {
  vi.clearAllMocks();
  useChat.getState().reset();
  useApp.setState({ route: { name: 'chat-new' }, settings: null });
  vi.mocked(listProjects).mockResolvedValue([proj()]);
  vi.mocked(setSchedule).mockImplementation(async (id, at) => proj({ id, scheduledAt: at }));
  vi.mocked(createProject).mockImplementation(async (input) => proj({ id: 'new1', title: input.title, kind: input.kind, status: 'draft' }));
  vi.mocked(addMessage).mockResolvedValue(null as unknown as ChatMessage);
});

describe('checkScheduleItems', () => {
  const now = new Date('2026-11-04T10:00:00Z');
  it('takes existing videos by id and the rest as drafts, filling in seconds and the default kind', () => {
    expect(
      checkScheduleItems(
        [
          { projectId: 'p1', title: 'ignored', at: '2026-11-05T19:00:00+07:00', kind: 'promo' },
          { title: ' Kenapa rupiah melemah ', at: '2026-11-07T12:00+07:00' },
          { title: 'Data', at: '2026-11-08T12:00:00z', kind: 'data' },
        ],
        [proj()],
        now,
      ),
    ).toEqual({
      items: [
        { projectId: 'p1', title: 'Jalur Rempah', at: '2026-11-05T19:00:00+07:00', kind: 'explainer' },
        { title: 'Kenapa rupiah melemah', at: '2026-11-07T12:00:00+07:00', kind: 'explainer' },
        { title: 'Data', at: '2026-11-08T12:00:00Z', kind: 'data' },
      ],
    });
  });

  it.each([
    ['no items', [], 'a schedule needs 1 to 20 videos'],
    ['not a list', 'soon', 'a schedule needs 1 to 20 videos'],
    ['more than 20', Array.from({ length: 21 }, () => ({ title: 'x', at: '2026-11-05T19:00:00+07:00' })), 'a schedule needs 1 to 20 videos'],
    ['a time without an offset', [{ title: 'x', at: '2026-11-05T19:00:00' }], 'video 1 has no valid date and time'],
    ['words for a time', [{ title: 'x', at: 'tomorrow' }], 'video 1 has no valid date and time'],
    ['a past time', [{ title: 'x', at: '2026-11-05T19:00:00+07:00' }, { title: 'y', at: '2026-11-03T19:00:00+07:00' }], 'video 2 is in the past'],
    ['more than a year away', [{ title: 'x', at: '2027-11-05T19:00:00+07:00' }], 'video 1 is more than a year away'],
    ['an unknown video', [{ projectId: 'zz', title: 'x', at: '2026-11-05T19:00:00+07:00' }], 'video 1 is not on this computer'],
    ['the same video twice', [{ projectId: 'p1', at: '2026-11-05T19:00:00+07:00' }, { projectId: 'p1', at: '2026-11-06T19:00:00+07:00' }], 'video 2 is in the schedule twice'],
    ['no title', [{ at: '2026-11-05T19:00:00+07:00' }], 'video 1 needs a title of 1 to 120 characters'],
    ['a long title', [{ title: 'x'.repeat(121), at: '2026-11-05T19:00:00+07:00' }], 'video 1 needs a title of 1 to 120 characters'],
  ])('refuses %s', (_name, items, reason) => {
    expect(checkScheduleItems(items, [proj()], now)).toEqual({ reason });
  });
});

describe('a confirmed schedule card', () => {
  it.each([
    ['a new chat (screen handler for topics)', 'c1', true, false],
    ['a project chat (send options)', 'c2', false, true],
  ])('in %s: schedules, makes drafts, refreshes, records the answer and sends no agent turn', async (_n, chatId, withHandler, withSendOptions) => {
    const handler = vi.fn(() => true);
    const changed = vi.fn();
    const stop = onAutopilotChanged(changed);
    const version = useApp.getState().projectsVersion;
    const existing = inDays(1);
    const draft = inDays(3);
    seed(chatId, `Here is a plan.\n\n${card([{ projectId: 'p1', title: 'Jalur Rempah', at: existing }, { title: 'Kenapa rupiah melemah', at: draft, kind: 'news' }])}`);
    render(<Chat chatId={chatId} onA2uiAction={withHandler ? handler : undefined} withSendOptions={withSendOptions} />);
    await userEvent.click(screen.getByRole('button', { name: 'Schedule these' }));

    await screen.findByText(/^Scheduled on the calendar: /);
    expect(setSchedule).toHaveBeenCalledWith('p1', existing);
    expect(createProject).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createProject).mock.calls[0]![0]).toMatchObject({ title: 'Kenapa rupiah melemah', kind: 'news' });
    expect(vi.mocked(createProject).mock.calls[0]![1]).toContain('# Kenapa rupiah melemah');
    expect(setSchedule).toHaveBeenCalledWith('new1', draft);
    expect(createChat).not.toHaveBeenCalled();
    expect(agentPrompt).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(useApp.getState().projectsVersion).toBe(version + 1);
    expect(changed).toHaveBeenCalled();
    stop();

    const line = screen.getByText(/^Scheduled on the calendar: /).textContent!;
    expect(line).toContain('— Jalur Rempah, ');
    expect(line).toMatch(/— Kenapa rupiah melemah$/);
    // Stored with the record of the answer, so the card stays answered after a reload.
    const stored = vi.mocked(addMessage).mock.calls.find(([, role]) => role === 'system')!;
    expect(stored[2]).toContainEqual(expect.objectContaining({ type: 'a2ui-action' }));
    expect(screen.getByTestId('a2ui-surface')).toHaveAttribute('data-answered', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Open calendar' }));
    expect(useApp.getState().route).toEqual({ name: 'calendar' });
  });

  it('schedules nothing for an invalid card, says why, and keeps the card answerable', async () => {
    seed('c1', card([{ projectId: 'p1', at: inDays(1) }, { title: 'Old', at: inDays(-1) }]));
    render(<Chat chatId="c1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Schedule these' }));
    await screen.findByText('Nothing was scheduled: video 2 is in the past');
    expect(setSchedule).not.toHaveBeenCalled();
    expect(createProject).not.toHaveBeenCalled();
    expect(agentPrompt).not.toHaveBeenCalled();
    expect(screen.getByTestId('a2ui-surface')).not.toHaveAttribute('data-answered');
    expect(screen.queryByRole('button', { name: 'Open calendar' })).toBeNull();
  });

  it('shows the reason in Indonesian', async () => {
    setUiLanguage('id');
    seed('c1', card([{ projectId: 'gone', at: inDays(1) }]));
    render(<Chat chatId="c1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Schedule these' }));
    await screen.findByText('Belum ada yang dijadwalkan: video ke-1 tidak ada di komputer ini');
  });

  it('is ignored in internal chats (style studies, autopilot topics)', async () => {
    seed('study-s1', card([{ projectId: 'p1', at: inDays(1) }]));
    render(<Chat chatId="study-s1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Schedule these' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(listProjects).not.toHaveBeenCalled();
    expect(setSchedule).not.toHaveBeenCalled();
    expect(agentPrompt).not.toHaveBeenCalled();
  });
});

describe('Let the agent pick', () => {
  beforeEach(() => {
    vi.mocked(listChats).mockResolvedValue([{ id: 'c7', projectId: 'p1', agentId: 'codex', title: 'Jalur Rempah', createdAt: 'c', updatedAt: 'u' } as never]);
  });

  it("opens the video's chat and asks its agent, as the user, with the local time", async () => {
    const onOpenChange = vi.fn();
    render(<ScheduleDialog open onOpenChange={onOpenChange} project={proj()} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Let the agent pick' }));
    await waitFor(() => expect(agentPrompt).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(useApp.getState().route).toEqual({ name: 'chat', chatId: 'c7' });
    const visible = useChat.getState().messages.c7!.find((m) => m.role === 'user')!.parts[0];
    expect(visible).toMatchObject({ type: 'text' });
    expect((visible as { text: string }).text).toMatch(
      /^Pick the best time to post this video in the next 7 days and show me a schedule card\. It's \w+ \d+ \w+ \d\d:\d\d \(.+, UTC[+-]\d\d:\d\d\)\.$/,
    );
    const [chatId, parts] = vi.mocked(agentPrompt).mock.calls[0]!;
    expect(chatId).toBe('c7');
    // The chat's own agent (codex) gets the skills, the clock and this video's id.
    expect(JSON.stringify(parts)).toContain("This video's Tayang id is p1.");
  });

  it('asks in Indonesian when the interface is Indonesian', async () => {
    setUiLanguage('id');
    render(<ScheduleDialog open onOpenChange={() => {}} project={proj()} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Biar agent yang pilih' }));
    await waitFor(() => expect(agentPrompt).toHaveBeenCalled());
    const user = useChat.getState().messages.c7!.find((m) => m.role === 'user')!.parts[0] as { text: string };
    expect(user.text).toMatch(/^Pilih waktu terbaik untuk memposting video ini dalam 7 hari ke depan/);
  });

  it('only says to wait when a turn is running in that chat', async () => {
    useChat.setState({ streaming: { c7: true }, messages: { c7: [agentMsg('c7', 'working')] } });
    render(<ScheduleDialog open onOpenChange={() => {}} project={proj()} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Let the agent pick' }));
    await waitFor(() => expect(useChat.getState().messages.c7!.at(-1)!.parts[0]).toEqual({ type: 'text', text: BUSY_NOTE }));
    expect(agentPrompt).not.toHaveBeenCalled();
  });

  it('is hidden on the Calendar until a video is picked', async () => {
    render(<ScheduleDialog open onOpenChange={() => {}} choices={[proj()]} onSaved={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Let the agent pick' })).toBeNull();
    await userEvent.selectOptions(screen.getByRole('combobox'), 'p1');
    expect(screen.getByRole('button', { name: 'Let the agent pick' })).toBeInTheDocument();
  });
});
