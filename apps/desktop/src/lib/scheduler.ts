import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { i18n } from '@/i18n';
import { listProjects, updateProject } from '@/lib/ipc';
import { dueReminders } from '@/lib/reminders';
import { useApp } from '@/state/app';

/** Rust emits this to the main window every 30 s, also while the window is hidden. */
export const TICK_EVENT = 'scheduler://tick';

export type TickHandler = (now: Date) => void | Promise<void>;
const handlers = new Set<TickHandler>();

/** Runs `handler` on every tick (and once at startup). Returns the unsubscribe. A4's engine hooks in here. */
export function onTick(handler: TickHandler): () => void {
  handlers.add(handler);
  return () => void handlers.delete(handler);
}

async function canNotify(): Promise<boolean> {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === 'granted';
}

/**
 * Shows the reminders that are due. Each is stamped on its project first, so it fires once even if
 * the notification fails. The permission is only requested when a reminder is actually needed; if the
 * system says no, the Calendar shows a banner instead.
 */
export async function runReminders(now: Date): Promise<void> {
  const due = dueReminders(await listProjects(), now);
  if (!due.length) return;
  const granted = await canNotify().catch(() => false);
  useApp.getState().setNotificationsBlocked(!granted);
  for (const { project, kind, stamp } of due) {
    try {
      await updateProject(project.id, { [stamp]: now.toISOString() });
    } catch {
      continue; // not stamped: try again on the next tick rather than risk a repeat
    }
    if (!granted) continue;
    try {
      sendNotification({ title: i18n.t('reminders.title'), body: i18n.t(`reminders.${kind}`, { title: project.title }) });
    } catch {
      /* the reminder is best effort */
    }
  }
}

let running = false;

/** One pass: reminders, then every registered handler. Passes never overlap. */
export async function tick(now: Date = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    await runReminders(now).catch(() => {});
    for (const h of [...handlers]) await Promise.resolve(h(now)).catch(() => {});
  } finally {
    running = false;
  }
}

/** Subscribes to the Rust tick and runs a pass right away (this catches reminders missed while closed). */
export async function startScheduler(): Promise<UnlistenFn> {
  const unlisten = await listen<string>(TICK_EVENT, () => void tick());
  void tick();
  return unlisten;
}
