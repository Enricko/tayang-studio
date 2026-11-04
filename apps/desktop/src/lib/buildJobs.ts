import type { Job } from '@tayang/shared';
import { latestRenderInfo, upsertJob } from '@/lib/ipc';
import { renderedSince, useChat } from '@/state/chat';
import { refreshJobs } from '@/state/jobs';

/** Each job's render is looked up at most once a minute. */
const EVERY_MS = 60_000;
const lastLook = new Map<string, number>();

/**
 * A build job that needs the user may have its video by now: the agent's render finished after its turn,
 * or the user rendered it themselves. Such a job is done. Only `needs-you` build jobs with a project are
 * looked at, never while their chat runs a turn (a permission request), one lookup per job a minute.
 * Runs on the Agents board, at startup and on every scheduler tick.
 */
export async function settleLateRenders(now: number = Date.now(), jobs?: Job[]): Promise<void> {
  const list = jobs ?? (await refreshJobs());
  let changed = false;
  for (const job of list) {
    if (job.kind !== 'build' || job.status !== 'needs-you' || !job.projectId) continue;
    if (job.chatId && useChat.getState().streaming[job.chatId]) continue;
    if (now - (lastLook.get(job.id) ?? -Infinity) < EVERY_MS) continue;
    lastLook.set(job.id, now);
    const info = await latestRenderInfo(job.projectId).catch(() => null);
    // The job turned needs-you when its turn ended without a video, so any video since then is a late one.
    if (!renderedSince(info, Date.parse(job.updatedAt))) continue;
    try {
      await upsertJob({ ...job, status: 'done', note: info!.name, updatedAt: new Date(now).toISOString() });
      changed = true;
    } catch {
      /* the job board is best effort */
    }
  }
  if (changed) await refreshJobs().catch(() => {});
}

/** For tests: forget when each job was last looked at. */
export const resetLateRenders = () => lastLook.clear();
