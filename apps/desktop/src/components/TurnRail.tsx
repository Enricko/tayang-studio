import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { ChatMessage } from '@tayang/shared';

/** What a user message says, for the preview and the label: text, @mentions, attached file names. */
export function turnText(m: ChatMessage): string {
  return m.parts
    .map((p) => (p.type === 'text' ? p.text : p.type === 'mention' ? `@${p.title}` : p.type === 'file' ? p.name : ''))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The last turn whose top is at or above 40% of the viewport; the first one at the top. */
function activeTurn(box: HTMLElement, indexes: number[]): number {
  const top = box.getBoundingClientRect().top;
  const line = top + box.clientHeight * 0.4;
  let active = 0;
  indexes.forEach((mi, t) => {
    const el = box.querySelector<HTMLElement>(`[data-turn="${mi}"]`);
    if (el && el.getBoundingClientRect().top <= line) active = t;
  });
  return active;
}

/** A column of ticks at the pane's edge, one per user message, in place of the scrollbar. */
export function TurnRail({
  messages,
  scrollRef,
  className = 'right-0',
}: {
  messages: ChatMessage[];
  scrollRef: RefObject<HTMLElement | null>;
  /** Where the rail sits horizontally inside its positioned parent. */
  className?: string;
}) {
  const turns = useMemo(
    () =>
      messages.flatMap((m, i) => (m.role === 'user' ? [{ index: i, text: turnText(m) }] : [])),
    [messages],
  );
  const indexes = useMemo(() => turns.map((t) => t.index), [turns]);
  const [overflow, setOverflow] = useState(false);
  const [active, setActive] = useState(0);
  const [hover, setHover] = useState<{ turn: number; top: number } | null>(null);
  const nav = useRef<HTMLElement>(null);
  const strip = useRef<HTMLDivElement>(null);

  const measure = useCallback(() => {
    const box = scrollRef.current;
    if (!box) return;
    setOverflow(box.scrollHeight > box.clientHeight + 1);
    setActive(activeTurn(box, indexes));
  }, [scrollRef, indexes]);

  // Re-measure when the messages change, and on scroll (at most once per frame; setState bails out when unchanged).
  useLayoutEffect(measure, [measure, messages]);
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    box.addEventListener('scroll', onScroll, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onScroll);
    ro?.observe(box);
    if (box.firstElementChild) ro?.observe(box.firstElementChild);
    return () => {
      box.removeEventListener('scroll', onScroll);
      ro?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scrollRef, measure, overflow]);

  // A long rail scrolls itself and keeps the active tick in view.
  useEffect(() => {
    const el = strip.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active, overflow]);

  if (turns.length < 2 || !overflow) return null;

  const jump = (mi: number) => {
    const box = scrollRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-turn="${mi}"]`);
    if (!box || !el) return;
    const top = box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - 16;
    box.scrollTo({ top: Math.max(0, top), behavior: reduced() ? 'auto' : 'smooth' });
  };

  const show = (turn: number, btn: HTMLElement) => {
    const n = nav.current?.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    setHover({ turn, top: n ? b.top - n.top + b.height / 2 : 0 });
  };

  return (
    <nav
      ref={nav}
      aria-label="Jump to a message"
      className={`absolute top-1/2 z-10 flex w-6 -translate-y-1/2 justify-end ${className}`}
      style={{ maxHeight: '70%' }}
    >
      <div ref={strip} className="no-scrollbar flex max-h-full flex-col items-end overflow-y-auto py-1">
        {turns.map((t, i) => {
          const isActive = i === active;
          const isHover = hover?.turn === i;
          return (
            <button
              key={t.index}
              type="button"
              aria-label={`Jump to: ${t.text.slice(0, 80)}`}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => jump(t.index)}
              onMouseEnter={(e) => show(i, e.currentTarget)}
              onMouseLeave={() => setHover(null)}
              onFocus={(e) => show(i, e.currentTarget)}
              onBlur={() => setHover(null)}
              className="group flex h-[10px] w-6 shrink-0 cursor-pointer items-center justify-end border-0 bg-transparent p-0 outline-none"
            >
              <span
                className="block h-[2px] w-5 origin-right rounded-full transition-[transform,background-color] duration-[120ms] motion-reduce:transition-none group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background"
                style={{
                  background: isActive ? '#EDEDED' : isHover ? '#A3A3A3' : '#404040',
                  transform: `scaleX(${isActive ? 1 : isHover ? 0.8 : 0.6})`,
                }}
              />
            </button>
          );
        })}
      </div>
      {hover && (
        <div
          role="tooltip"
          className="pointer-events-none absolute right-full mr-2 w-max max-w-[280px] -translate-y-1/2 rounded-lg border border-border bg-card px-3 py-[10px] text-[13px] leading-[1.5] opacity-100 transition-opacity duration-[80ms] motion-reduce:transition-none starting:opacity-0"
          style={{ top: hover.top }}
        >
          <span className="line-clamp-4 break-words">{turns[hover.turn]?.text}</span>
        </div>
      )}
    </nav>
  );
}
