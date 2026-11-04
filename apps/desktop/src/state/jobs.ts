import type { Job } from '@tayang/shared';
import { listJobs } from '@/lib/ipc';
import { useApp } from '@/state/app';

/** Jobs that wait on the user: the Agents badge in the sidebar. */
export const needsYou = (jobs: Job[]) => jobs.filter((j) => j.status === 'needs-you' || j.status === 'failed').length;

export function syncNeedsYou(jobs: Job[]): Job[] {
  useApp.setState({ needsYouCount: needsYou(jobs) });
  return jobs;
}

/** Load jobs and refresh the sidebar badge. */
export async function refreshJobs(): Promise<Job[]> {
  return syncNeedsYou(await listJobs());
}
