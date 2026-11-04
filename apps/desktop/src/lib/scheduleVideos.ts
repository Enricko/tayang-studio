import { DEFAULT_SETTINGS, type ChatMessage, type MessagePart, type Project, type Settings, type VideoKind } from '@tayang/shared';
import { VIDEO_KINDS } from '@tayang/skills';
import type { A2uiAction } from '@/a2ui/render';
import { slotTime } from '@/lib/autopilot';
import { notifyAutopilotChanged } from '@/lib/autopilotHooks';
import { getChat, listProjects, scheduleVideos } from '@/lib/ipc';
import { stored, type StoredKey } from '@/lib/stored';
import { draftProject } from '@/lib/topics';
import { useApp } from '@/state/app';
import { appendSystem, isInternalChat, noteForAgent, useChat } from '@/state/chat';

/**
 * The reserved A2UI event of a schedule card. The agent's button only asks: Tayang shows what would be
 * scheduled in its own dialog, and only the user's confirmation there writes anything. The agent gets
 * no turn for it.
 */
export const SCHEDULE_ACTION = 'schedule_videos';

const MAX_ITEMS = 20;
const MAX_TITLE = 120;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
/** RFC 3339 with an offset; seconds may be left out (agents often do) and are filled in. */
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(?:(Z)|([+-])(\d{2}):(\d{2}))$/i;

export interface PlannedItem {
  /** An existing video; none for a new draft. */
  projectId?: string;
  title: string;
  /** RFC 3339 with the agent's offset, seconds filled in. */
  at: string;
  kind: VideoKind;
  /** When the existing video was due before this card (it moves). */
  previous?: string | null;
}

export type CheckedSchedule = { items: PlannedItem[] } | { reason: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The instant an RFC 3339 time names, or NaN. As strict as Rust's chrono: no 31 November, no 24:00,
 * no 60th second and no offset beyond 23:59 (JavaScript would roll those over).
 */
export function parseRfc3339(text: string): { at: string; time: number } {
  const m = RFC3339.exec(text.trim());
  if (!m) return { at: '', time: NaN };
  const [, y, mo, d, h, mi, s = '00', frac = '', z, sign, oh = '00', om = '00'] = m as unknown as string[];
  const n = Number;
  const day = new Date(Date.UTC(n(y), n(mo) - 1, n(d)));
  const realDay = day.getUTCFullYear() === n(y) && day.getUTCMonth() === n(mo) - 1 && day.getUTCDate() === n(d);
  if (!realDay || n(h) > 23 || n(mi) > 59 || n(s) > 59 || n(oh) > 23 || n(om) > 59) return { at: '', time: NaN };
  const offset = z ? 'Z' : `${sign}${oh}:${om}`;
  const at = `${y}-${mo}-${d}T${h}:${mi}:${s}${frac}${offset}`;
  return { at, time: Date.parse(at) };
}

const reason = (key: StoredKey, n?: number) => ({ reason: stored(key, n === undefined ? undefined : { n }) });

/**
 * The card's items, all valid or none: `reason` is the stored text for the first problem. A `projectId`
 * must be one of `allowed` (this chat's own video and the videos mentioned in it), not a posted one,
 * and a draft must not repeat a video that already exists.
 */
export function checkScheduleItems(
  raw: unknown,
  projects: Project[],
  allowed: ReadonlySet<string>,
  now: Date = new Date(),
): CheckedSchedule {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_ITEMS) return reason('schedule.agent.count');
  const items: PlannedItem[] = [];
  const seen = new Set<string>();
  const titles = new Set(projects.map((p) => p.title.trim().toLowerCase()));
  for (const [i, v] of raw.entries()) {
    const n = i + 1;
    if (!isObj(v)) return reason('schedule.agent.badItem', n);
    const { at, time } = typeof v.at === 'string' ? parseRfc3339(v.at) : { at: '', time: NaN };
    if (Number.isNaN(time)) return reason('schedule.agent.badTime', n);
    if (time <= now.getTime()) return reason('schedule.agent.past', n);
    if (time - now.getTime() > YEAR_MS) return reason('schedule.agent.tooFar', n);
    const kind = VIDEO_KINDS.includes(v.kind as VideoKind) ? (v.kind as VideoKind) : 'explainer';
    if (typeof v.projectId === 'string' && v.projectId) {
      const p = projects.find((x) => x.id === v.projectId);
      if (!p) return reason('schedule.agent.unknown', n);
      if (!allowed.has(p.id)) return reason('schedule.agent.foreign', n);
      if (p.postedAt) return reason('schedule.agent.posted', n);
      if (seen.has(p.id)) return reason('schedule.agent.twice', n);
      seen.add(p.id);
      items.push({ projectId: p.id, title: p.title, at, kind: p.kind, previous: p.scheduledAt });
      continue;
    }
    const title = typeof v.title === 'string' ? v.title.trim() : '';
    if (!title || title.length > MAX_TITLE) return reason('schedule.agent.title', n);
    const key = title.toLowerCase();
    if (titles.has(key)) return reason('schedule.agent.exists', n);
    if (seen.has(`title:${key}`)) return reason('schedule.agent.twice', n);
    seen.add(`title:${key}`);
    items.push({ title, at, kind });
  }
  return { items };
}

/** The videos a card in this chat may name: the chat's own video, and every video mentioned in it. */
export async function allowedProjects(chatId: string, messages: ChatMessage[]): Promise<Set<string>> {
  const ids = new Set<string>();
  const own = await getChat(chatId).catch(() => null);
  if (own?.projectId) ids.add(own.projectId);
  for (const m of messages) for (const p of m.parts) if (p.type === 'mention') ids.add(p.projectId);
  return ids;
}

/** "Thu 5 Nov 19:00 — Jalur Rempah, Sat 7 Nov 12:00 — …", in the active language, soonest first. */
export function scheduleList(items: PlannedItem[]): string {
  return [...items]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .map((i) => `${slotTime(new Date(i.at))} — ${i.title}`)
    .join(', ');
}

/** Whether a stored part records a schedule card that was put on the calendar (its line shows Open calendar). */
export function isScheduleRecord(p: MessagePart): boolean {
  if (p.type !== 'a2ui-action') return false;
  const rec = p.action as { action?: { name?: unknown }; failed?: boolean };
  return rec.action?.name === SCHEDULE_ACTION && !rec.failed;
}

/** Rust's `schedule:<code>[:n]` errors as stored text; anything else is a failed save. */
export function batchReason(message: string): string {
  const m = /^schedule:(count|badTime|past|tooFar|unknown|badItem)(?::(\d+))?$/.exec(message);
  if (!m) return stored('schedule.agent.write');
  return stored(`schedule.agent.${m[1]}` as StoredKey, m[2] ? { n: Number(m[2]) } : undefined);
}

/**
 * Step one of a pressed schedule card: checks its items against this chat. Null in chats where Tayang
 * doesn't take the action (setup, style studies, autopilot topics). A card that can't be scheduled gets
 * one line saying why and stays answerable; nothing was written.
 */
export async function prepareSchedule(chatId: string, a: A2uiAction): Promise<PlannedItem[] | null> {
  if (!chatId || isInternalChat(chatId)) return null;
  try {
    const messages = useChat.getState().messages[chatId] ?? [];
    const [projects, allowed] = await Promise.all([listProjects(), allowedProjects(chatId, messages)]);
    const checked = checkScheduleItems(a.context.items, projects, allowed);
    if ('items' in checked) return checked.items;
    await appendSystem(chatId, stored('schedule.agent.failed', { reason: checked.reason }));
  } catch {
    await appendSystem(chatId, stored('schedule.agent.failed', { reason: stored('schedule.agent.write') }));
  }
  return null;
}

/**
 * Step two, after the user confirmed in Tayang's dialog: one all-or-nothing write in Rust. Either way
 * the card is answered from now on (a second press could only duplicate), and one line says what
 * happened; on success the agent hears about it with the next message.
 */
export async function confirmSchedule(chatId: string, a: A2uiAction, items: PlannedItem[]): Promise<void> {
  const settings: Pick<Settings, 'format' | 'language' | 'fps' | 'frameCheck'> = useApp.getState().settings ?? DEFAULT_SETTINGS;
  const { summary, ...rest } = a;
  const record: MessagePart = { type: 'a2ui-action', summary, action: { version: 'v0.9', action: rest } };
  try {
    await scheduleVideos(
      items.map((i) => (i.projectId ? { projectId: i.projectId, at: i.at } : { at: i.at, draft: draftProject(i.title, i.kind, settings) })),
    );
  } catch (e) {
    const why = batchReason(e instanceof Error ? e.message : String(e));
    // Still the card's answer, so it can't be pressed again; `failed` keeps Open calendar off its line.
    const tried: MessagePart = { ...record, action: { version: 'v0.9', action: rest, failed: true } };
    await appendSystem(chatId, stored('schedule.agent.failedAnswered', { reason: why }), [tried]);
    return;
  }
  useApp.getState().bumpProjects();
  notifyAutopilotChanged();
  const list = scheduleList(items);
  await appendSystem(chatId, stored('schedule.agent.done', { list }), [record]);
  // i18n-ignore: this goes to the agent, not the user
  noteForAgent(chatId, `The user confirmed your schedule card. Tayang put these videos on the calendar: ${list}.`);
}
