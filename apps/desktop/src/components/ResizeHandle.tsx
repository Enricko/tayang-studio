import { useEffect, useRef, useState } from 'react';
import { STEP } from '@/state/layout';
import { cn } from '@/lib/utils';

export interface ResizeHandleProps {
  /** What a screen reader calls the handle. */
  label: string;
  /** The panel's width now. */
  value: number;
  /** Keyboard limits (and the separator's aria range unless `ariaMin` says otherwise). */
  min: number;
  max: number;
  /** The lowest width the panel can show (a collapsed rail), when lower than `min`. */
  ariaMin?: number;
  /** The panel edge the handle sits on: a handle on the left edge grows its panel when moved left. */
  side: 'left' | 'right';
  /**
   * A new width. From the keyboard it is already within min and max; from a drag it is raw, so a
   * collapsible panel can snap. Drags report at most once per animation frame with `live` set, and
   * once more without it when they end (the width to save).
   */
  onResize(width: number, live?: boolean): void;
  /** Double-click: back to the default width. */
  onReset(): void;
  /** Enter: collapse or restore, for a panel that can. */
  onToggle?(): void;
  /** The id of the panel it resizes. */
  'aria-controls'?: string;
  className?: string;
}

/**
 * An 8 px drag strip on a panel's edge: invisible until hovered, focused or dragged, when a 1 px line
 * shows. Arrows move it by 16 px, Home/End go to min/max, double-click resets.
 */
export function ResizeHandle({
  label,
  value,
  min,
  max,
  ariaMin,
  side,
  onResize,
  onReset,
  onToggle,
  'aria-controls': controls,
  className,
}: ResizeHandleProps) {
  const dir = side === 'right' ? 1 : -1;
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    x: number;
    w: number;
    pending: number | null;
    last: number | null;
    frame: number;
    off: () => void;
  } | null>(null);
  const resize = useRef(onResize);
  resize.current = onResize;

  /** Stops listening and gives the page its selection and cursor back; reports nothing. */
  const release = () => {
    const d = drag.current;
    if (!d) return;
    if (d.frame) cancelAnimationFrame(d.frame);
    d.off();
    drag.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  };

  /** Ends a drag: the last width it reached is reported once more, final, so it is saved. */
  const end = () => {
    const d = drag.current;
    if (!d) return;
    const final = d.pending ?? d.last;
    release();
    setDragging(false);
    if (final !== null) resize.current(final);
  };
  const endRef = useRef(end);
  endRef.current = end;

  // Unmounting mid-drag must not leave the page unselectable.
  useEffect(() => release, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = value + STEP * dir;
    else if (e.key === 'ArrowLeft') next = value - STEP * dir;
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    else if (e.key === 'Enter' && onToggle) {
      e.preventDefault();
      onToggle();
      return;
    }
    if (next === null) return;
    e.preventDefault();
    // A collapsible panel: narrowing from its min collapses it, and a collapsed one can't get narrower.
    const narrowing = next < value || e.key === 'Home';
    if (onToggle && ariaMin !== undefined && ariaMin < min && narrowing && value <= min) {
      if (value === min) onToggle();
      return;
    }
    onResize(Math.min(max, Math.max(min, next)));
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={Math.round(value)}
      aria-valuemin={ariaMin ?? min}
      aria-valuemax={max}
      aria-controls={controls}
      data-no-drag
      data-dragging={dragging || undefined}
      onKeyDown={onKeyDown}
      onDoubleClick={(e) => {
        e.preventDefault();
        onReset();
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        // No text selection, no window drag: the press belongs to the handle.
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        e.currentTarget.focus({ preventScroll: true });
        release();
        // Switching apps or a system dialog can swallow the button-up: losing focus ends the drag.
        const lost = () => endRef.current();
        const hidden = () => document.hidden && lost();
        window.addEventListener('blur', lost);
        document.addEventListener('visibilitychange', hidden);
        const off = () => {
          window.removeEventListener('blur', lost);
          document.removeEventListener('visibilitychange', hidden);
        };
        drag.current = { x: e.clientX, w: value, pending: null, last: null, frame: 0, off };
        setDragging(true);
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        // No button down: the button-up never reached us.
        if (e.buttons === 0) return end();
        d.pending = d.w + (e.clientX - d.x) * dir;
        if (!d.frame) {
          d.frame = requestAnimationFrame(() => {
            d.frame = 0;
            if (d.pending === null) return;
            d.last = d.pending;
            d.pending = null;
            resize.current(d.last, true);
          });
        }
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      className={cn(
        'group absolute inset-y-0 z-20 flex w-2 cursor-col-resize touch-none justify-center outline-none',
        side === 'right' ? 'right-0 translate-x-1/2' : 'left-0 -translate-x-1/2',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none h-full w-px bg-transparent transition-colors duration-150',
          'group-hover:bg-hairline group-focus-visible:bg-ring',
          dragging && 'bg-foreground/70 group-hover:bg-foreground/70',
        )}
      />
    </div>
  );
}
