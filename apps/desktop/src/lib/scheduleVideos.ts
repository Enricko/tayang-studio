import { DEFAULT_SETTINGS, type MessagePart, type Project, type Settings, type VideoKind } from '@tayang/shared';
import { VIDEO_KINDS } from '@tayang/skills';
import type { A2uiAction } from '@/a2ui/render';
import { slotTime } from '@/lib/autopilot';
import { notifyAutopilotChanged } from '@/lib/autopilotHooks';
import { listProjects, setSchedule } from '@/lib/ipc';
import { stored } from '@/lib/stored';
import { createDraftProject } from '@/lib/topics';
import { useApp } from '@/state/app';
import { appendSystem, isInternalChat } from '@/state/chat';

/**
 * The reserved A2UI event of a schedule card. Tayang takes it itself in every user-facing chat: the
 * user's click is the consent, and the agent gets no turn for it.
 */
export const SCHEDULE_ACTION = 'schedule_videos';

const MAX_ITEMS = 20;
const MAX_TITLE = 120;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
/** RFC 3339 with an offset; seconds may be left out (agents often do) and are filled in. */
const RFC3339 = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i;

export interface PlannedItem {
  /** An existing video; none for a new draft. */
  projectId?: string;
  title: string;
  /** RFC 3339 with the agent's offset, seconds filled in. */
  at: string;
  kind: VideoKind;
}

export type CheckedSchedule = { items: PlannedItem[] } | { reason: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The card's items, all valid or none: `reason` is the stored text for the first problem. */
export function checkScheduleItems(raw: unknown, projects: Project[], now: Date = new Date()): CheckedSchedule {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_ITEMS) return { reason: stored('schedule.agent.count') };
  const items: PlannedItem[] = [];
  const seen = new Set<string>();
  for (const [i, v] of raw.entries()) {
    const n = i + 1;
    if (!isObj(v)) return { reason: stored('schedule.agent.badTime', { n }) };
    const m = typeof v.at === 'string' ? RFC3339.exec(v.at.trim()) : null;
    const at = m ? `${m[1]}${m[2] ?? ':00'}${m[3]!.toUpperCase()}` : '';
    const time = at ? Date.parse(at) : NaN;
    if (Number.isNaN(time)) return { reason: stored('schedule.agent.badTime', { n }) };
    if (time <= now.getTime()) return { reason: stored('schedule.agent.past', { n }) };
    if (time - now.getTime() > YEAR_MS) return { reason: stored('schedule.agent.tooFar', { n }) };
    const kind = VIDEO_KINDS.includes(v.kind as VideoKind) ? (v.kind as VideoKind) : 'explainer';
    if (typeof v.projectId === 'string' && v.projectId) {
      const p = projects.find((x) => x.id === v.projectId);
      if (!p) return { reason: stored('schedule.agent.unknown', { n }) };
      if (seen.has(p.id)) return { reason: stored('schedule.agent.twice', { n }) };
      seen.add(p.id);
      items.push({ projectId: p.id, title: p.title, at, kind: p.kind });
      continue;
    }
    const title = typeof v.title === 'string' ? v.title.trim() : '';
    if (!title || title.length > MAX_TITLE) return { reason: stored('schedule.agent.title', { n }) };
    items.push({ title, at, kind });
  }
  return { items };
}

/** "Thu 5 Nov 19:00 — Jalur Rempah, Sat 7 Nov 12:00 — …", in the active language, soonest first. */
export function scheduleList(items: PlannedItem[]): string {
  return [...items]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .map((i) => `${slotTime(new Date(i.at))} — ${i.title}`)
    .join(', ');
}

/** Whether a stored part records a schedule card the user confirmed (its system line shows Open calendar). */
export function isScheduleRecord(p: MessagePart): boolean {
  return p.type === 'a2ui-action' && (p.action as { action?: { name?: unknown } }).action?.name === SCHEDULE_ACTION;
}

/** Surfaces being scheduled right now: a second click waits for the first. */
const inFlight = new Set<string>();

/**
 * Schedules a confirmed card's videos: existing ones by id, the rest as new drafts. Ends with one system
 * line in the chat: the schedule (which also marks the card answered), or why nothing was scheduled.
 * Returns false when the chat is not one where Tayang takes the action.
 */
export async function scheduleFromAction(chatId: string, a: A2uiAction): Promise<boolean> {
  if (!chatId || isInternalChat(chatId)) return false;
  const key = `${chatId}:${a.surfaceId}`;
  if (inFlight.has(key)) return true;
  inFlight.add(key);
  let touched = false;
  try {
    const checked = checkScheduleItems(a.context.items, await listProjects());
    if ('reason' in checked) {
      await appendSystem(chatId, stored('schedule.agent.failed', { reason: checked.reason }));
      return true;
    }
    const settings: Pick<Settings, 'format' | 'language' | 'fps' | 'frameCheck'> = useApp.getState().settings ?? DEFAULT_SETTINGS;
    for (const item of checked.items) {
      const id = item.projectId ?? (await createDraftProject(item.title, item.kind, settings)).id;
      touched = true;
      await setSchedule(id, item.at);
    }
    const { summary, ...rest } = a;
    const record: MessagePart = { type: 'a2ui-action', summary, action: { version: 'v0.9', action: rest } };
    await appendSystem(chatId, stored('schedule.agent.done', { list: scheduleList(checked.items) }), [record]);
    return true;
  } catch (e) {
    await appendSystem(chatId, stored('schedule.agent.failed', { reason: e instanceof Error ? e.message : String(e) }));
    return true;
  } finally {
    if (touched) {
      useApp.getState().bumpProjects();
      notifyAutopilotChanged();
    }
    inFlight.delete(key);
  }
}
