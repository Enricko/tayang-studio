import type { Project } from '@tayang/shared';

export type CalendarState = 'making' | 'needs-review' | 'ready' | 'posted' | 'draft';

/**
 * Where a video is in its life, for the Calendar chips. Planned autopilot slots (no video yet)
 * are not projects and come with the autopilot. `now` is part of the signature for the states
 * that depend on time later; none of today's states do.
 */
export function calendarState(project: Project, _now: Date = new Date()): CalendarState {
  if (project.reviewState === 'pending') return 'needs-review';
  if (project.postedAt) return 'posted';
  if (project.status === 'building') return 'making';
  if (project.status === 'rendered' || project.status === 'scheduled') return 'ready';
  return 'draft';
}
