import { useRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@tayang/shared';
import { MessageList } from '@/components/MessageList';
import { TurnRail } from '@/components/TurnRail';

function user(id: string, text: string): ChatMessage {
  return { id, chatId: 'c', role: 'user', parts: [{ type: 'text', text }], createdAt: '2026-01-01' };
}
function agent(id: string, text: string): ChatMessage {
  return { id, chatId: 'c', role: 'agent', parts: [{ type: 'text', text }], createdAt: '2026-01-01' };
}

const MSGS: ChatMessage[] = [
  user('1', 'First prompt'),
  agent('2', 'ok'),
  user('3', 'Second prompt'),
  agent('4', 'done'),
  user('5', 'Third prompt'),
];

/** Scroll geometry: container top 0, height 500; each turn's top is given by tops[turn index]. */
function stubGeometry(box: HTMLElement, tops: Record<string, number>, overflow = true) {
  Object.defineProperty(box, 'clientHeight', { configurable: true, value: 500 });
  Object.defineProperty(box, 'scrollHeight', { configurable: true, value: overflow ? 2000 : 500 });
  box.getBoundingClientRect = () => ({ top: 0, bottom: 500, height: 500, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON() {} });
  box.scrollTo = vi.fn() as unknown as typeof box.scrollTo;
  for (const el of box.querySelectorAll<HTMLElement>('[data-turn]')) {
    const top = tops[el.dataset.turn!] ?? 0;
    el.getBoundingClientRect = () => ({ top, bottom: top + 40, height: 40, left: 0, right: 0, width: 0, x: 0, y: top, toJSON() {} });
  }
}

function Harness({ messages, overflow = true, tops }: { messages: ChatMessage[]; overflow?: boolean; tops: Record<string, number> }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div>
      <div ref={(el) => { ref.current = el; if (el) stubGeometry(el, tops, overflow); }} data-testid="box" className="no-scrollbar overflow-y-auto">
        <MessageList messages={messages} streaming={false} scrollRef={ref} />
      </div>
      <TurnRail messages={messages} scrollRef={ref} />
    </div>
  );
}

describe('TurnRail', () => {
  it('is absent with fewer than two user messages', () => {
    render(<Harness messages={MSGS.slice(0, 2)} tops={{}} />);
    expect(screen.queryByRole('navigation', { name: 'Jump to a message' })).toBeNull();
  });

  it('is absent when the content does not overflow', () => {
    render(<Harness messages={MSGS} tops={{}} overflow={false} />);
    expect(screen.queryByRole('navigation', { name: 'Jump to a message' })).toBeNull();
  });

  it('has one button per user message and the container hides its scrollbar', () => {
    render(<Harness messages={MSGS} tops={{ 0: 0, 2: 600, 4: 1200 }} />);
    const nav = screen.getByRole('navigation', { name: 'Jump to a message' });
    expect(nav.querySelectorAll('button')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Jump to: Second prompt' })).toBeInTheDocument();
    expect(screen.getByTestId('box')).toHaveClass('no-scrollbar');
  });

  it('shows the message text on hover and focus, hides on leave', () => {
    render(<Harness messages={MSGS} tops={{ 0: 0, 2: 600, 4: 1200 }} />);
    const tick = screen.getByRole('button', { name: 'Jump to: Second prompt' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.mouseEnter(tick);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Second prompt');
    fireEvent.mouseLeave(tick);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(screen.getByRole('button', { name: 'Jump to: Third prompt' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Third prompt');
    fireEvent.blur(screen.getByRole('button', { name: 'Jump to: Third prompt' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('scrolls the container to the turn on click', () => {
    render(<Harness messages={MSGS} tops={{ 0: 0, 2: 600, 4: 1200 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Jump to: Second prompt' }));
    const box = screen.getByTestId('box');
    expect(box.scrollTo).toHaveBeenCalledWith({ top: 600 - 16, behavior: 'smooth' });
  });

  it('marks the active turn and moves it when the scroll position changes', async () => {
    render(<Harness messages={MSGS} tops={{ 0: 10, 2: 600, 4: 1200 }} />);
    const first = screen.getByRole('button', { name: 'Jump to: First prompt' });
    await waitFor(() => expect(first).toHaveAttribute('aria-current', 'true'));
    const box = screen.getByTestId('box');
    stubGeometry(box, { 0: -700, 2: 100, 4: 700 });
    act(() => { fireEvent.scroll(box); });
    const second = screen.getByRole('button', { name: 'Jump to: Second prompt' });
    await waitFor(() => expect(second).toHaveAttribute('aria-current', 'true'));
    expect(first).not.toHaveAttribute('aria-current');
  });
});

describe('TurnRail fix round 1', () => {
  const TOPS = { 0: 0, 2: 600, 4: 1200 };

  it('subscribes once per container, not on every message change', () => {
    const add = vi.spyOn(HTMLElement.prototype, 'addEventListener');
    const made: number[] = [];
    const Real = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor() { made.push(1); }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    try {
      const view = render(<Harness messages={MSGS} tops={TOPS} />);
      const scrollAdds = () => add.mock.calls.filter((c) => c[0] === 'scroll' && (c[1] as { toString(): string })).length;
      const before = { s: scrollAdds(), r: made.length };
      view.rerender(<Harness messages={[...MSGS, agent('6', 'x')]} tops={TOPS} />);
      view.rerender(<Harness messages={[...MSGS, agent('6', 'xy')]} tops={TOPS} />);
      expect(scrollAdds()).toBe(before.s);
      expect(made.length).toBe(before.r);
    } finally {
      globalThis.ResizeObserver = Real;
      add.mockRestore();
    }
  });

  it('has one tab stop (the active tick) and arrow keys, Home and End move focus', async () => {
    render(<Harness messages={MSGS} tops={{ 0: 10, 2: 600, 4: 1200 }} />);
    const [a, b, c] = screen.getAllByRole('button').filter((x) => x.getAttribute('aria-label')?.startsWith('Jump to'));
    await waitFor(() => expect(a).toHaveAttribute('tabindex', '0'));
    expect(b).toHaveAttribute('tabindex', '-1');
    expect(c).toHaveAttribute('tabindex', '-1');
    a!.focus();
    fireEvent.keyDown(a!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(b);
    fireEvent.keyDown(b!, { key: 'End' });
    expect(document.activeElement).toBe(c);
    fireEvent.keyDown(c!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(b);
    fireEvent.keyDown(b!, { key: 'Home' });
    expect(document.activeElement).toBe(a);
  });

  it('labels frame-only and file-only turns', () => {
    const frame: ChatMessage = {
      id: 'f', chatId: 'c', role: 'user', createdAt: '',
      parts: [{ type: 'frame', projectId: 'p', frame: 0, timeSec: 75, imagePath: '', marks: [] }],
    };
    const file: ChatMessage = {
      id: 'g', chatId: 'c', role: 'user', createdAt: '',
      parts: [{ type: 'file', path: '/a/brief.pdf', name: 'brief.pdf', mime: 'x', size: 1 }],
    };
    render(<Harness messages={[frame, agent('2', 'ok'), file]} tops={{ 0: 0, 2: 600 }} />);
    expect(screen.getByRole('button', { name: 'Jump to: Frame at 1:15' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jump to: brief.pdf' })).toBeInTheDocument();
  });

  it('puts the focus ring on the unscaled button, not the scaled tick', () => {
    render(<Harness messages={MSGS} tops={TOPS} />);
    const btn = screen.getByRole('button', { name: 'Jump to: First prompt' });
    expect(btn.className).toContain('focus-visible:outline-2');
    expect(btn.firstElementChild!.className).not.toMatch(/ring|outline/);
  });

  it('moves the preview card when the strip scrolls', () => {
    render(<Harness messages={MSGS} tops={TOPS} />);
    const tick = screen.getByRole('button', { name: 'Jump to: Second prompt' });
    let y = 100;
    tick.getBoundingClientRect = () => ({ top: y, height: 10, bottom: y + 10, left: 0, right: 0, width: 0, x: 0, y, toJSON() {} });
    fireEvent.mouseEnter(tick);
    const top0 = screen.getByRole('tooltip').style.top;
    y = 60;
    fireEvent.scroll(tick.parentElement!);
    expect(screen.getByRole('tooltip').style.top).not.toBe(top0);
  });
});

describe('MessageList auto-scroll', () => {
  function setup() {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const view = render(<Harness messages={MSGS.slice(0, 2)} tops={{}} />);
    const box = screen.getByTestId('box');
    spy.mockClear();
    return { spy, view, box };
  }
  const grown = [...MSGS.slice(0, 2), agent('9', 'more')];

  it('follows new messages while near the bottom', () => {
    const { spy, view, box } = setup();
    box.scrollTop = 1450; // 2000 - 500 - 1450 = 50 from the bottom
    fireEvent.scroll(box);
    view.rerender(<Harness messages={grown} tops={{}} />);
    expect(spy).toHaveBeenCalled();
  });

  it('stays put while scrolled up', () => {
    const { spy, view, box } = setup();
    box.scrollTop = 200;
    fireEvent.scroll(box);
    view.rerender(<Harness messages={grown} tops={{}} />);
    expect(spy).not.toHaveBeenCalled();
  });

  it('goes to the bottom when the user just sent a message', () => {
    const { spy, view, box } = setup();
    box.scrollTop = 200;
    fireEvent.scroll(box);
    view.rerender(<Harness messages={[...grown, user('10', 'new')]} tops={{}} />);
    expect(spy).toHaveBeenCalled();
  });
});
