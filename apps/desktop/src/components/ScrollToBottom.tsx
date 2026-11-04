import { useEffect, useState, type RefObject } from 'react';
import { ArrowDown } from 'lucide-react';

const FAR = 200;

/** A pill at the bottom centre that appears once the chat is scrolled well above the end. */
export function ScrollToBottom({ scrollRef }: { scrollRef: RefObject<HTMLElement | null> }) {
  const [far, setFar] = useState(false);
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const check = () => setFar(box.scrollHeight - box.scrollTop - box.clientHeight > FAR);
    check();
    box.addEventListener('scroll', check, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check);
    ro?.observe(box);
    if (box.firstElementChild) ro?.observe(box.firstElementChild);
    return () => {
      box.removeEventListener('scroll', check);
      ro?.disconnect();
    };
  }, [scrollRef]);
  if (!far) return null;
  return (
    <button
      type="button"
      onClick={() => {
        const box = scrollRef.current;
        if (!box) return;
        const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
        box.scrollTo({ top: box.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
      }}
      className="absolute bottom-3 left-1/2 z-10 inline-flex h-8 -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[13px] text-foreground shadow-lg hover:bg-raised"
    >
      <ArrowDown size={14} strokeWidth={1.5} aria-hidden="true" />
      Scroll to bottom
    </button>
  );
}
