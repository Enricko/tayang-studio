import { useSyncExternalStore } from 'react';
import type { AutopilotSlot } from '@tayang/shared';

/**
 * Where the autopilot engine (A4) plugs into the Calendar's panel.
 *
 * - `setStopNowHandler`: the panel shows "Stop now" next to a slot that is making a video only while a
 *   handler is registered, and calls it with that slot.
 * - `notifyAutopilotChanged` / `onAutopilotChanged`: call notify after every change to an autopilot or
 *   slot (the engine after each slot update, the panel after its own actions); the Calendar and the
 *   panel listen and reload.
 */
export type StopNowHandler = (slot: AutopilotSlot) => void | Promise<void>;

let handler: StopNowHandler | null = null;
const listeners = new Set<() => void>();

/** Tells listeners that autopilots or slots changed. A listener that throws never blocks the others. */
export function notifyAutopilotChanged(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  }
}

/** Returns a function that stops listening. */
export function onAutopilotChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Registers (or, with null, removes) the handler behind "Stop now". Returns a function that removes it. */
export function setStopNowHandler(next: StopNowHandler | null): () => void {
  handler = next;
  notifyAutopilotChanged();
  return () => {
    if (handler === next) {
      handler = null;
      notifyAutopilotChanged();
    }
  };
}

export const canStopNow = () => handler !== null;

/** Whether "Stop now" can be offered, reactive to the handler coming and going. */
export const useCanStopNow = () => useSyncExternalStore(onAutopilotChanged, canStopNow);

export async function stopNow(slot: AutopilotSlot): Promise<void> {
  await handler?.(slot);
}
