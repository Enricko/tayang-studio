import { create } from 'zustand';
import type { Job } from '@tayang/shared';
import { listJobs } from '@/lib/ipc';
import { useApp } from '@/state/app';

/** Jobs that wait on the user: the Agents badge in the sidebar. */
export const needsYou = (jobs: Job[]) => jobs.filter((j) => j.status === 'needs-you' || j.status === 'failed').length;

/** The job list every screen shows; `refreshJobs` is the only writer. */
export const useJobs = create<{ jobs: Job[] }>(() => ({ jobs: [] }));

export function syncNeedsYou(jobs: Job[]): Job[] {
  useJobs.setState({ jobs });
  useApp.setState({ needsYouCount: needsYou(jobs) });
  return jobs;
}

/** Load jobs and refresh the sidebar badge. */
export async function refreshJobs(): Promise<Job[]> {
  return syncNeedsYou(await listJobs());
}
