import type { FileInfo, MediaInfo } from '@tayang/shared';
import { latestRenderInfo, mediaProbe } from '@/lib/ipc';

/** A render this close before the turn started still counts: file times can be coarse, or a little behind. */
const CLOCK_SLACK_MS = 2000;

/** How long a finished video's size and time stay the same between the two looks; tests set it to 0. */
export const renderTiming = { stableMs: 3000 };

/** Whether `info` is a non-empty video made since `since` (ms). */
export const renderedSince = (info: { size: number; modifiedAt: string } | null, since: number) =>
  !!info && info.size > 0 && Date.parse(info.modifiedAt) >= since - CLOCK_SLACK_MS;

const look = async (projectId: string): Promise<FileInfo | null> => {
  try {
    return await latestRenderInfo(projectId);
  } catch {
    return null;
  }
};

/** What Rust says when it can't start ffprobe at all (not installed), as opposed to a file it can't read. */
const NO_FFPROBE = /could not run ffprobe/i;
let toldNoProbe = false;

/** ffprobe's reading of the render; `missing` when ffprobe can't be run on this computer. */
const probe = async (projectId: string): Promise<MediaInfo | null | 'missing'> => {
  try {
    return await mediaProbe(projectId);
  } catch (e) {
    return NO_FFPROBE.test(e instanceof Error ? e.message : String(e)) ? 'missing' : null;
  }
};

/** For tests: log the missing ffprobe again. */
export const resetRenderCheck = () => {
  toldNoProbe = false;
};

const sameFile = (a: FileInfo, b: FileInfo | null) => !!b && a.path === b.path && a.size === b.size && a.modifiedAt === b.modifiedAt;

/**
 * The project's newest render when it is a finished video made since `since` (ms), else null. Finished:
 * ffprobe reads a video stream with a length, and its size and time are the same in two looks 3 s apart.
 * A render the agent left running in the background exists long before it is finished. Without ffprobe
 * (some ffmpeg builds ship without it) only the size and time are compared, so jobs can still finish.
 */
export async function finishedRender(projectId: string, since = -Infinity): Promise<FileInfo | null> {
  const first = await look(projectId);
  if (!first || !renderedSince(first, since)) return null;
  const info = await probe(projectId);
  if (info === 'missing') {
    if (!toldNoProbe) console.warn('Tayang: ffprobe could not be run, so renders are checked by size and time only');
    toldNoProbe = true;
  } else if (!info || !(info.durationSec > 0)) return null;
  await new Promise((r) => setTimeout(r, renderTiming.stableMs));
  const second = await look(projectId);
  return sameFile(first, second) ? second : null;
}
