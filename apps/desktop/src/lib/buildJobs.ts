import type { Job } from '@tayang/shared';
import { upsertJob } from '@/lib/ipc';
import { finishedRender } from '@/lib/renderCheck';
import { useChat } from '@/state/chat';
import { refreshJobs, useJobs } from '@/state/jobs';

/** Each job's render is looked up at most once a minute. */
const EVERY_MS = 60_000;
const lastLook = new Map<string, number>();
/** Whether the job list was read once; after that a tick reads it only when a job may be settled. */
let listed = false;

const waitsOnVideo = (job: Job) => job.kind === 'build' && job.status === 'needs-you' && !!job.projectId;

/**
 * A build job that needs the user may have its video by now: the agent's render finished after its turn,
 * or the user rendered it themselves. Such a job is done. Only `needs-you` build jobs with a project are
 * looked at, never while their chat runs a turn (a permission request), one lookup per job a minute.
 * Runs on the Agents board, at startup and on every scheduler tick.
 */
export async function settleLateRenders(now: number = Date.now(), jobs?: Job[]): Promise<void> {
  const known = useJobs.getState().jobs;
  if (!jobs && listed && !known.some(waitsOnVideo)) return;
  listed = true;
  const list = jobs ?? (await refreshJobs());
  const turnRunning = (job: Job) => !!job.chatId && !!useChat.getState().streaming[job.chatId];
  let changed = false;
  for (const job of list) {
    if (!waitsOnVideo(job) || turnRunning(job)) continue;
    if (now - (lastLook.get(job.id) ?? -Infinity) < EVERY_MS) continue;
    lastLook.set(job.id, now);
    // The job turned needs-you when its turn ended without a finished video, so any since then is a late one.
    const info = await finishedRender(job.projectId!, Date.parse(job.updatedAt));
    // A turn that started while it looked owns the job now.
    if (!info || turnRunning(job)) continue;
    try {
      await upsertJob({ ...job, status: 'done', note: info.name, updatedAt: new Date(now).toISOString() });
      changed = true;
    } catch {
      /* the job board is best effort */
    }
  }
  if (changed) await refreshJobs().catch(() => {});
}

/** For tests: forget when each job was last looked at. */
export const resetLateRenders = () => {
  lastLook.clear();
  listed = false;
};
