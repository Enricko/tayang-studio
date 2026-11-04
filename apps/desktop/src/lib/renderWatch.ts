import type { FileInfo } from '@tayang/shared';
import { newestVideoInfo } from '@/lib/ipc';

/** How often the project's newest mp4 is looked at while a command runs. */
export const LOOK_EVERY_MS = 3000;
/** An mp4 written this recently is being rendered. */
const FRESH_MS = 10_000;
/** An mp4 that has not changed for this long is no longer being rendered. */
const IDLE_MS = 15_000;
/** File times can be coarse, or a little behind the turn's start. */
const CLOCK_SLACK_MS = 2000;

export interface WatchHooks {
  /** The command `toolCallId` is writing a video. */
  rendering(toolCallId: string): void;
  /** The video it was writing stopped changing (the command may go on). */
  idle(toolCallId: string): void;
}

interface Watch {
  projectId: string;
  /** When the turn started (ms): only an mp4 written since then is this turn's render. */
  since: number;
  /** The commands running, oldest first; a render found is the oldest one's. */
  tools: Set<string>;
  timer: ReturnType<typeof setInterval>;
  /** A look is running; the next waits for it. */
  busy: boolean;
  /** Whether the first look was taken: it only records what was already there. */
  seeded: boolean;
  /** The newest mp4 at the last look, whenever it was written. */
  last: FileInfo | null;
  /** When the mp4 was last seen to change (ms). */
  changedAt: number;
  /** The command the render was put on, while it is on. */
  marked: string | null;
  hooks: WatchHooks;
}

/** By chat. */
const watches = new Map<string, Watch>();

const isFresh = (info: FileInfo, since: number) => Date.parse(info.modifiedAt) >= since - CLOCK_SLACK_MS;

async function look(chatId: string, w: Watch) {
  if (w.busy) return;
  w.busy = true;
  let info: FileInfo | null = null;
  let failed = false;
  try {
    info = await newestVideoInfo(w.projectId);
  } catch {
    failed = true;
  } finally {
    w.busy = false;
  }
  // The commands ended while it looked; a look that failed tells nothing (the last one stands).
  if (watches.get(chatId) !== w || failed) return;
  const now = Date.now();
  const before = w.last;
  w.last = info;
  // The first look is the baseline: a render that just finished, or was just copied to renders/, is not a
  // new one. Only a change after it counts.
  if (!w.seeded) {
    w.seeded = true;
    return;
  }
  const changed = !!info && (!before || before.path !== info.path || before.size !== info.size || before.modifiedAt !== info.modifiedAt);
  if (changed) w.changedAt = now;
  const seen = info && isFresh(info, w.since) ? info : null;
  if (w.marked) {
    if (now - w.changedAt >= IDLE_MS) {
      const id = w.marked;
      w.marked = null;
      w.hooks.idle(id);
    }
    return;
  }
  if (!seen) return;
  const growing = !!before && before.path === seen.path && seen.size > before.size;
  const recent = now - Date.parse(seen.modifiedAt) <= FRESH_MS;
  if (changed && (growing || recent)) {
    const id = w.tools.values().next().value;
    if (!id) return;
    w.marked = id;
    w.hooks.rendering(id);
  }
}

/**
 * A command started in a video's chat: while it (or another command of the chat) runs, the project's
 * newest mp4 is looked at every 3 s, one look at a time. The first look is the baseline; after it, an mp4
 * written since the turn started that changes, and grows or was written in the last 10 s, is a render
 * (`hooks.rendering`), until it has not changed for 15 s (`hooks.idle`) or its command ends. For pipelines (`npm run make`) whose render the command line can't tell.
 */
export function watchCommand(chatId: string, projectId: string, toolCallId: string, since: number, hooks: WatchHooks) {
  const w = watches.get(chatId);
  if (w) {
    w.tools.add(toolCallId);
    return;
  }
  const next: Watch = {
    projectId,
    since,
    tools: new Set([toolCallId]),
    timer: setInterval(() => void look(chatId, next), LOOK_EVERY_MS),
    busy: false,
    seeded: false,
    last: null,
    changedAt: 0,
    marked: null,
    hooks,
  };
  watches.set(chatId, next);
}

/** A command ended: once none of the chat's run, the looks stop. Its render, if any, ends with it (the caller's). */
export function endCommand(chatId: string, toolCallId: string) {
  const w = watches.get(chatId);
  if (!w || !w.tools.delete(toolCallId)) return;
  if (w.marked === toolCallId) w.marked = null;
  if (!w.tools.size) stopWatching(chatId);
}

/** The turn is over: no more looks. */
export function stopWatching(chatId: string) {
  const w = watches.get(chatId);
  if (!w) return;
  clearInterval(w.timer);
  watches.delete(chatId);
}

/** For tests and reset: stop every watch. */
export function stopAllWatches() {
  for (const id of [...watches.keys()]) stopWatching(id);
}
