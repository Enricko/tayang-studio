import { act, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import type { ChatMessage, MessagePart } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({ assetUrl: (p: string) => p }));
vi.mock('@/lib/events', () => ({
  onQuestion: vi.fn(async () => () => {}), onAgentUpdate: vi.fn(async () => () => {}), onPermission: vi.fn(async () => () => {}) }));

import { MessageList } from '@/components/MessageList';
import { setUiLanguage } from '@/i18n';
import { useChat } from '@/state/chat';
import { useRender } from '@/state/render';

const T0 = new Date('2026-11-04T10:00:00Z').getTime();
const agent = (parts: MessagePart[]): ChatMessage => ({ id: 'a1', chatId: 'c1', role: 'agent', parts, createdAt: '' });
const user: ChatMessage = { id: 'u1', chatId: 'c1', role: 'user', parts: [{ type: 'text', text: 'go' }], createdAt: '' };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(T0);
  useChat.getState().reset();
  useChat.setState({ turnStartedAt: { c1: T0 } });
});
afterEach(() => vi.useRealTimers());

describe('the live working line', () => {
  it('shows at the end of a reply whose tail is text, with the time since the turn started, and goes when it ends', () => {
    vi.setSystemTime(T0 + 130_000);
    const messages = [user, agent([{ type: 'text', text: 'Pipeline sedang berjalan…' }])];
    const { rerender } = render(<MessageList messages={messages} streaming />);
    expect(screen.getByRole('status')).toHaveTextContent('Working · 2m 10s');
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByRole('status')).toHaveTextContent('Working · 2m 15s');
    useChat.setState({ turnStartedAt: {} });
    rerender(<MessageList messages={messages} streaming={false} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/Working/)).toBeNull();
  });

  it('reads in Indonesian', () => {
    setUiLanguage('id');
    vi.setSystemTime(T0 + 130_000);
    render(<MessageList messages={[user, agent([{ type: 'text', text: 'Oke' }])]} streaming />);
    expect(screen.getByRole('status')).toHaveTextContent('Sedang bekerja · 2 mnt 10 dtk');
  });

  it('shows before the agent has written anything', () => {
    vi.setSystemTime(T0 + 4000);
    render(<MessageList messages={[user]} streaming />);
    expect(screen.getByRole('status')).toHaveTextContent('Working · 4s');
  });

  it('is not repeated under a live activity line that shows a running step: that line carries the time', () => {
    vi.setSystemTime(T0 + 61_000);
    const parts: MessagePart[] = [
      { type: 'text', text: 'Building' },
      { type: 'tool', toolCallId: 't1', title: 'Run npm install', status: 'running', toolKind: 'execute' },
    ];
    render(<MessageList messages={[user, agent(parts)]} streaming />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Ran 1 command' })).toBeInTheDocument();
    expect(screen.getByTestId('activity-running')).toHaveTextContent(/Run\s*npm install · 1m 1s/);
  });

  it('a finished step at the tail still gets the working line', () => {
    const parts: MessagePart[] = [{ type: 'tool', toolCallId: 't1', title: 'Run ls', status: 'done', toolKind: 'execute' }];
    render(<MessageList messages={[user, agent(parts)]} streaming />);
    expect(screen.getByRole('status')).toHaveTextContent('Working · 0s');
  });

  it('reads "Rendering video" with the render\'s own time while the render runs', () => {
    vi.setSystemTime(T0 + 200_000);
    useRender.setState({ runs: { p1: { startedAt: T0 + 120_000, source: 'agent', chatId: 'c1', toolCallId: 't1' } } });
    const parts: MessagePart[] = [
      { type: 'tool', toolCallId: 't1', title: 'Run npx hyperframes render', status: 'running', toolKind: 'execute' },
    ];
    render(<MessageList messages={[user, agent(parts)]} streaming />);
    expect(screen.getByTestId('activity-running')).toHaveTextContent(/Rendering video · 1m 20s/);
    expect(screen.queryByText(/npx hyperframes render/)).toBeNull();
  });

  it('reads "Sedang merender video" in Indonesian when the tail is text', () => {
    setUiLanguage('id');
    vi.setSystemTime(T0 + 80_000);
    useRender.setState({ runs: { p1: { startedAt: T0, source: 'agent', chatId: 'c1', toolCallId: 't1' } } });
    render(<MessageList messages={[user, agent([{ type: 'text', text: 'Render…' }])]} streaming />);
    expect(screen.getByRole('status')).toHaveTextContent('Sedang merender video · 1 mnt 20 dtk');
  });

  it('says why after two minutes without a word from the agent', () => {
    vi.setSystemTime(T0 + 119_000);
    const { rerender } = render(<MessageList messages={[user]} streaming />);
    expect(screen.queryByText(/Nothing from the agent yet/)).toBeNull();
    vi.setSystemTime(T0 + 121_000);
    rerender(<MessageList messages={[user]} streaming />);
    expect(screen.getByText(/Nothing from the agent yet/)).toBeInTheDocument();
    // Once the agent has said something, the turn isn't silent.
    rerender(<MessageList messages={[user, agent([{ type: 'text', text: 'Halo' }])]} streaming />);
    expect(screen.queryByText(/Nothing from the agent yet/)).toBeNull();
  });
});
