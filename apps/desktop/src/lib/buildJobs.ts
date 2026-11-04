import type { Job } from '@tayang/shared';
import { listJobs, updateSettings, upsertJob } from '@/lib/ipc';
import { stored } from '@/lib/stored';
import { finishedRender } from '@/lib/renderCheck';
import { dropRenderBaseline, turnCount, useChat } from '@/state/chat';
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
    const turns = job.chatId ? turnCount(job.chatId) : 0;
    // Any finished video since the job's baseline (the first turn since it was last done) is its video.
    // Jobs saved before the baseline existed use when they were last written.
    const since = Date.parse(job.renderBaselineAt ?? job.updatedAt);
    const info = await finishedRender(job.projectId!, since);
    // A turn that started while it looked (even one that already ended) owns the job now.
    if (!info || turnRunning(job) || (job.chatId && turnCount(job.chatId) !== turns)) continue;
    try {
      await upsertJob({ ...job, status: 'done', note: info.name, renderBaselineAt: null, updatedAt: new Date(now).toISOString() });
      if (job.chatId) dropRenderBaseline(job.chatId);
      changed = true;
    } catch {
      /* the job board is best effort */
    }
  }
  if (changed) await refreshJobs().catch(() => {});
}

/**
 * Once per install, at startup: build jobs marked done before a build job could only be done with its
 * video. One whose project has no finished video goes back to needs-you with the "No video yet" note,
 * as it would be marked now. `checked` is the saved flag; it is saved only when every job was written.
 */
let rechecking: Promise<void> | null = null;

export function recheckDoneBuildJobs(checked: boolean | undefined, now: number = Date.now()): Promise<void> {
  if (checked) return Promise.resolve();
  // StrictMode (and a Try again) can start it twice; one run is enough.
  rechecking ??= recheck(now).finally(() => {
    rechecking = null;
  });
  return rechecking;
}

async function recheck(now: number): Promise<void> {
  try {
    const done = (await listJobs()).filter((j) => j.kind === 'build' && j.status === 'done' && !!j.projectId);
    const found = await Promise.all(done.map((j) => finishedRender(j.projectId!)));
    const stale = done.filter((_, i) => !found[i]);
    const updatedAt = new Date(now).toISOString();
    for (const job of stale) {
      await upsertJob({ ...job, status: 'needs-you', note: stored('agents.noVideo'), renderBaselineAt: null, updatedAt });
    }
    await updateSettings({ buildJobsChecked: true });
    if (stale.length) await refreshJobs();
  } catch {
    /* best effort: tried again at the next start */
  }
}

/** For tests: forget when each job was last looked at. */
export const resetLateRenders = () => {
  lastLook.clear();
  listed = false;
};
