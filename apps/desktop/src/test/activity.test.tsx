import { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, MessagePart } from '@tayang/shared';
import { MessageList } from '@/components/MessageList';
import { ScrollToBottom } from '@/components/ScrollToBottom';

const tool = (id: string, title: string, extra: Partial<Extract<MessagePart, { type: 'tool' }>> = {}): MessagePart => ({
  type: 'tool',
  toolCallId: id,
  title,
  status: 'done',
  ...extra,
});
const agent = (parts: MessagePart[]): ChatMessage => ({ id: 'a', chatId: 'c', role: 'agent', parts, createdAt: '' });
const text = (t: string): MessagePart => ({ type: 'text', text: t });

describe('inline activity', () => {
  const full = agent([
    text('Before'),
    tool('1', 'Run npm install', { toolKind: 'execute' }),
    { type: 'thought', text: 'hmm' },
    tool('2', 'Run `npm test`', { toolKind: 'execute' }),
    tool('3', 'Load skill: tayang-studio:tayang-studio', { toolKind: 'other' }),
    text('After'),
  ]);

  it('puts one summary between the texts, hides skill loading, has no card', () => {
    const { container } = render(<MessageList streaming={false} messages={[full]} />);
    const el = container.querySelector('[data-testid="agent-message"]')!;
    const order = ['Before', 'Thought process · Ran 2 commands', 'After'].map((t) => el.textContent!.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(1);
    expect(container.textContent).not.toMatch(/Load skill|finished|is working/i);
  });

  it('counts, pluralises and shows failures', () => {
    const m = agent([
      tool('1', 'Edit a.ts', { toolKind: 'edit', path: '/w/a.ts' }),
      tool('2', 'Read b.ts', { toolKind: 'read', path: '/w/b.ts' }),
      tool('3', 'Read c.ts', { toolKind: 'read', path: '/w/c.ts', status: 'failed' }),
      tool('4', 'Search x', { toolKind: 'search' }),
      tool('5', 'Fetch y', { toolKind: 'fetch' }),
      tool('6', 'Mystery'),
    ]);
    render(<MessageList streaming={false} messages={[m]} />);
    expect(screen.getByRole('button')).toHaveTextContent(
      'Edited 1 file · read 2 files · searched 1 time · fetched 1 page · called 1 tool · 1 failed',
    );
  });

  it('expands into rows with verbs, file chips, mono commands and error colour', async () => {
    const m = agent([
      tool('1', 'Run `ls -la`', { toolKind: 'execute' }),
      tool('2', 'Edit src', { toolKind: 'edit', path: '/w/src/App.tsx' }),
      tool('3', 'Read broken', { toolKind: 'read', path: '/w/x.md', status: 'failed' }),
      { type: 'thought', text: 'deep thoughts' },
    ]);
    render(<MessageList streaming={false} messages={[m]} />);
    await userEvent.click(screen.getByRole('button', { name: /Ran 1 command/ }));
    const cmd = screen.getByTitle('ls -la');
    expect(cmd).toHaveClass('font-mono');
    expect(screen.getByText('Run')).toBeInTheDocument();
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('App.tsx')).toBeInTheDocument();
    expect(screen.getByText('Read').closest('li')).toHaveClass('text-destructive');
    expect(screen.queryByText('deep thoughts')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Thought process' }));
    expect(screen.getByText('deep thoughts')).toBeInTheDocument();
  });

  it('shows the running tool with a pulse while streaming, and Working when empty', () => {
    const { container, rerender } = render(
      <MessageList streaming messages={[agent([tool('1', 'Run npm install', { toolKind: 'execute', status: 'running' })])]} />,
    );
    expect(screen.getByRole('button')).toHaveTextContent('Ran 1 command · Run npm install');
    expect(container.querySelector('.tayang-pulse')).not.toBeNull();
    rerender(<MessageList streaming messages={[agent([])]} />);
    expect(screen.getByText('Working')).toBeInTheDocument();
    expect(container.querySelector('.tayang-pulse')).not.toBeNull();
    rerender(<MessageList streaming messages={[agent([tool('1', 'Load skill: x')])]} />);
    expect(screen.getByText('Working')).toBeInTheDocument();
  });
});

describe('ScrollToBottom', () => {
  function Box() {
    const ref = useRef<HTMLDivElement>(null);
    return (
      <div>
        <div
          data-testid="box"
          ref={(el) => {
            ref.current = el;
            if (el) {
              Object.defineProperty(el, 'clientHeight', { configurable: true, value: 500 });
              Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 2000 });
              el.scrollTo = vi.fn() as unknown as typeof el.scrollTo;
            }
          }}
        />
        <ScrollToBottom scrollRef={ref} />
      </div>
    );
  }
  it('is hidden at the bottom, shown when scrolled up, and scrolls to the end on click', async () => {
    render(<Box />);
    const box = screen.getByTestId('box');
    box.scrollTop = 1500;
    fireEvent.scroll(box);
    expect(screen.queryByRole('button', { name: 'Scroll to bottom' })).toBeNull();
    box.scrollTop = 300;
    fireEvent.scroll(box);
    await userEvent.click(screen.getByRole('button', { name: 'Scroll to bottom' }));
    expect(box.scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: 'smooth' });
  });
});
