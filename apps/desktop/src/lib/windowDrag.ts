import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

/** The window has no native title bar (titleBarStyle Overlay): this strip along the top drags it. */
export const DRAG_EDGE_PX = 32;

const INTERACTIVE =
  'button, a, input, textarea, select, [role=button], [role=tab], [role=slider], [contenteditable], [data-no-drag]';

/**
 * True when a press at `clientY` on `target` should move the window: within the top edge or
 * anywhere inside a `data-tauri-drag-region` element, but never on something interactive.
 */
export function shouldStartDrag(target: EventTarget | null, clientY: number): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(INTERACTIVE)) return false;
  return clientY <= DRAG_EDGE_PX || target.closest('[data-tauri-drag-region]') !== null;
}

/**
 * Tauri only drags when the pressed element itself has `data-tauri-drag-region`; our
 * headers are mostly covered by their children. Mount once.
 */
export function useWindowDrag() {
  useEffect(() => {
    // Tauri's own script already handles presses right on a drag-region element.
    const ours = (e: MouseEvent) =>
      shouldStartDrag(e.target, e.clientY) &&
      !(e.target instanceof Element && e.target.hasAttribute('data-tauri-drag-region'));
    const down = (e: MouseEvent) => {
      if (e.button !== 0 || e.detail > 1 || !ours(e)) return;
      void getCurrentWindow().startDragging().catch(() => {});
    };
    const dbl = (e: MouseEvent) => {
      if (e.button !== 0 || !ours(e)) return;
      void getCurrentWindow().toggleMaximize().catch(() => {});
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('dblclick', dbl);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('dblclick', dbl);
    };
  }, []);
}
