import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { ChatMessage } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({
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
vi.mock('@/lib/events', () => ({ onAgentUpdate: vi.fn(async () => () => {}), onPermission: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
import { agentPrompt, agentRespondPermission, agentStart, getChat, upsertJob } from '@/lib/ipc';
import { MessageList } from '@/components/MessageList';
import { BUSY_NOTE, useChat } from '@/state/chat';

const V = 'v0.9';
const block = (surfaceId: string, label: string) =>
  '```a2ui\n' +
  [
    { version: V, createSurface: { surfaceId, catalogId: 'basic' } },
    {
      version: V,
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Column', children: ['b'] },
          { id: 't', component: 'Text', text: label },
          { id: 'b', component: 'Button', child: 't', action: { event: { name: 'pick', context: { id: 1 } } } },
        ],
      },
    },
  ]
    .map((m) => JSON.stringify(m))
    .join('\n') +
  '\n```';

const msg = (id: string, role: ChatMessage['role'], parts: ChatMessage['parts']): ChatMessage => ({
  id,
  chatId: 'c1',
  role,
  parts,
  createdAt: '2026-11-04T00:00:00Z',
});

beforeEach(() => {
  useChat.getState().reset();
  vi.mocked(agentPrompt).mockClear();
});

describe('A2UI in the chat', () => {
  it('renders a block inline and hides the raw JSON', () => {
    render(
      <MessageList
        streaming={false}
        messages={[msg('1', 'agent', [{ type: 'text', text: `Which one?\n\n${block('s1', 'Kenapa rupiah melemah?')}` }])]}
      />,
    );
    expect(screen.getByText('Which one?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kenapa rupiah melemah?' })).toBeInTheDocument();
    expect(screen.queryByText(/createSurface/)).toBeNull();
  });

  it('shows a placeholder while a block is still streaming', () => {
    render(
      <MessageList
        streaming
        messages={[msg('1', 'agent', [{ type: 'text', text: 'Options\n```a2ui\n{"version":"v0.9","createSu' }])]}
      />,
    );
    expect(screen.getByText('Loading options…')).toBeInTheDocument();
    expect(screen.queryByText(/createSu/)).toBeNull();
  });

  it('sends the readable summary and the action JSON on click', async () => {
    render(
      <MessageList streaming={false} messages={[msg('1', 'agent', [{ type: 'text', text: block('s1', 'Pick me') }])]} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pick me' }));
    await waitFor(() => expect(agentPrompt).toHaveBeenCalled());
    const parts = vi.mocked(agentPrompt).mock.calls[0]![1];
    // The agent gets summary + action JSON from the single a2ui-action part (Rust turns it into text).
    expect(parts).toHaveLength(1);
    const act = parts[0]!;
    expect(act).toMatchObject({ type: 'a2ui-action', summary: 'Picked: Pick me' });
    // The visible user message carries the readable summary too.
    expect(useChat.getState().messages.c1!.at(-1)!.parts[0]).toEqual({ type: 'text', text: 'Picked: Pick me' });
    expect(JSON.stringify(act)).toContain('"surfaceId":"s1"');
    expect(JSON.stringify(act)).toContain('"version":"v0.9"');
  });

  it('shows the surface as answered until the agent updates it', () => {
    const answered = msg('2', 'user', [
      { type: 'text', text: 'Picked: Pick me' },
      { type: 'a2ui-action', summary: 'Picked: Pick me', action: { version: V, action: { name: 'pick', surfaceId: 's1' } } },
    ]);
    const first = msg('1', 'agent', [{ type: 'text', text: block('s1', 'Pick me') }]);
    const { rerender } = render(<MessageList streaming={false} messages={[first, answered]} />);
    expect(screen.getByRole('button', { name: 'Pick me' })).toBeDisabled();
    expect(screen.getByText('Picked: Pick me')).toBeInTheDocument();

    const update = msg('3', 'agent', [
      {
        type: 'text',
        text:
          '```a2ui\n' +
          JSON.stringify({
            version: V,
            updateComponents: { surfaceId: 's1', components: [{ id: 't', component: 'Text', text: 'Pick again' }] },
          }) +
          '\n```',
      },
    ]);
    rerender(<MessageList streaming={false} messages={[first, answered, update]} />);
    // Updated in place: still one surface, now live again with the new label.
    expect(screen.getAllByTestId('a2ui-surface')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Pick again' })).toBeEnabled();
  });
});

describe('one gate while the agent replies', () => {
  it('disables a live surface while the chat streams, without marking it answered', () => {
    const first = msg('1', 'agent', [{ type: 'text', text: block('s1', 'Pick me') }]);
    const { rerender } = render(<MessageList streaming messages={[first, msg('2', 'user', [{ type: 'text', text: 'hm' }])]} />);
    expect(screen.getByRole('button', { name: 'Pick me' })).toBeDisabled();
    expect(screen.getByTestId('a2ui-surface')).not.toHaveAttribute('data-answered');
    rerender(<MessageList streaming={false} messages={[first, msg('2', 'user', [{ type: 'text', text: 'hm' }])]} />);
    expect(screen.getByRole('button', { name: 'Pick me' })).toBeEnabled();
  });

  it('disables surfaces while the screen is busy', () => {
    render(<MessageList streaming={false} busy messages={[msg('1', 'agent', [{ type: 'text', text: block('s1', 'Make this') }])]} />);
    expect(screen.getByRole('button', { name: 'Make this' })).toBeDisabled();
  });

  it('a prompt refused because the agent is busy leaves the running turn alone', async () => {
    vi.mocked(agentStart).mockClear();
    await useChat.getState().send('c1', [{ type: 'text', text: 'first' }], {
      agentId: 'claude',
      job: { projectId: 'p1', title: 'Video' },
    });
    const perm = { chatId: 'c1', requestId: 'r1', title: 'Run', commands: [], options: [] };
    useChat.setState((s) => ({ permissions: { ...s.permissions, c1: [perm] } }));
    vi.mocked(upsertJob).mockClear();
    vi.mocked(agentRespondPermission).mockClear();
    vi.mocked(agentPrompt).mockRejectedValueOnce(new Error('The agent is still working on the last message'));
    expect(await useChat.getState().send('c1', [{ type: 'text', text: 'second' }])).toBeNull();
    const s = useChat.getState();
    expect(s.streaming.c1).toBe(true);
    expect(s.started.c1).toBe(true);
    expect(s.permissions.c1).toHaveLength(1);
    expect(agentRespondPermission).not.toHaveBeenCalled();
    expect(vi.mocked(upsertJob).mock.calls.map((c) => c[0].status)).not.toContain('failed');
    expect(s.messages.c1!.at(-1)).toMatchObject({ role: 'system', parts: [{ type: 'text', text: BUSY_NOTE }] });
    expect(agentStart).toHaveBeenCalledTimes(1);
  });
});

describe('answering a surface after a restart', () => {
  it("starts the chat's own agent from the chat row, not the default", async () => {
    vi.mocked(agentStart).mockClear();
    vi.mocked(getChat).mockResolvedValueOnce({ id: 'c1', projectId: 'p1', agentId: 'codex', title: 't', createdAt: '' });
    await useChat.getState().load('c1');
    render(<MessageList streaming={false} messages={[msg('1', 'agent', [{ type: 'text', text: block('s1', 'Pick me') }])]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Pick me' }));
    await waitFor(() => expect(agentStart).toHaveBeenCalledWith('c1', 'codex'));
  });

  it("sends with the screen's options: its agent, job and prompt prefix", async () => {
    vi.mocked(agentStart).mockClear();
    vi.mocked(upsertJob).mockClear();
    render(
      <MessageList
        streaming={false}
        sendOptions={(prompt) => ({
          agentId: 'gemini',
          job: { projectId: 'p1', title: 'Video' },
          promptParts: [{ type: 'text', text: 'SKIP' }, ...prompt],
        })}
        messages={[msg('1', 'agent', [{ type: 'text', text: block('s1', 'Pick me') }])]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pick me' }));
    await waitFor(() => expect(agentPrompt).toHaveBeenCalled());
    expect(agentStart).toHaveBeenCalledWith('c1', 'gemini');
    const parts = vi.mocked(agentPrompt).mock.calls[0]![1];
    expect(parts.at(-2)).toEqual({ type: 'text', text: 'SKIP' });
    expect(parts.at(-1)).toMatchObject({ type: 'a2ui-action', summary: 'Picked: Pick me' });
    expect(upsertJob).toHaveBeenCalledWith(expect.objectContaining({ kind: 'build', projectId: 'p1' }));
  });
});

describe('send agent fallback', () => {
  it("uses the chat's last agent, not the default, when none is given", async () => {
    vi.mocked(agentStart).mockClear();
    await useChat.getState().send('c1', [{ type: 'text', text: 'hi' }], { agentId: 'codex' });
    await useChat.getState().stop('c1');
    await useChat.getState().send('c1', [{ type: 'text', text: 'again' }]);
    expect(vi.mocked(agentStart).mock.calls.map((c) => c[1])).toEqual(['codex', 'codex']);
  });
});
