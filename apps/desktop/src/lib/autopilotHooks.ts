import type { AutopilotSlot } from '@tayang/shared';

/**
 * Where the autopilot engine (A4) plugs into the Calendar's panel. The panel shows "Stop now" next to
 * a slot that is making a video only while a handler is registered, and calls it with that slot.
 */
export type StopNowHandler = (slot: AutopilotSlot) => void | Promise<void>;

let handler: StopNowHandler | null = null;

/** Registers (or, with null, removes) the handler behind "Stop now". Returns a function that removes it. */
export function setStopNowHandler(next: StopNowHandler | null): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

export const canStopNow = () => handler !== null;

export async function stopNow(slot: AutopilotSlot): Promise<void> {
  await handler?.(slot);
}
