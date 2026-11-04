import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { i18n } from '@/i18n';
import { listProjects, updateProject } from '@/lib/ipc';
import { dueReminders } from '@/lib/reminders';
import { useApp } from '@/state/app';

/** Rust emits this to the main window every 30 s, also while the window is hidden. */
export const TICK_EVENT = 'scheduler://tick';

export type TickHandler = (now: Date) => void | Promise<void>;
const handlers = new Set<TickHandler>();
/** Handlers whose previous call has not finished yet. */
const inFlight = new WeakSet<TickHandler>();

/**
 * Runs `handler` on every tick (and once at startup). Returns the unsubscribe. A4's engine hooks in here.
 * Handlers may be long-running: a handler is never re-entered while its previous call is pending (it just
 * skips those ticks), and a slow handler never delays reminders or other handlers. Errors are logged.
 */
export function onTick(handler: TickHandler): () => void {
  handlers.add(handler);
  return () => void handlers.delete(handler);
}

/** Whether notifications may show, asking the first time. */
export async function canNotify(): Promise<boolean> {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === 'granted';
}

/**
 * Shows a system notification. Called through the plugin's command (not `sendNotification`, which fires
 * and forgets) so a failure can be caught. Note: on desktop the plugin always reports permission as
 * granted, so a user who turned Tayang's notifications off in the OS is not detected; the banner only
 * appears where the plugin does report a denial, and Settings has a test button for the rest.
 */
export async function show(body: string): Promise<void> {
  await invoke('plugin:notification|notify', { options: { title: i18n.t('reminders.title'), body } });
}

/** Settings' test button: sends a notification now. Returns false when the system reports a denial. */
export async function sendTestNotification(): Promise<boolean> {
  const granted = await canNotify();
  useApp.getState().setNotificationsBlocked(!granted);
  if (!granted) return false;
  await show(i18n.t('reminders.test'));
  return true;
}

/**
 * Shows the reminders that are due. Each is stamped on its project first, so it fires once even if
 * the notification fails. The permission is only requested when a reminder is actually needed; if the
 * system says no, the Calendar shows a banner instead.
 */
export async function runReminders(now: Date): Promise<void> {
  if (useApp.getState().notificationsBlocked) {
    // Notifications may have been turned back on since.
    void isPermissionGranted()
      .then((ok) => ok && useApp.getState().setNotificationsBlocked(false))
      .catch(() => {});
  }
  const due = dueReminders(await listProjects(), now);
  if (!due.length) return;
  let granted: boolean;
  try {
    granted = await canNotify();
  } catch {
    return; // unknown: change nothing, stamp nothing, look again next tick
  }
  useApp.getState().setNotificationsBlocked(!granted);
  for (const { project, kind, late, stamp } of due) {
    try {
      // updatedAt is passed through so a reminder does not reorder Videos and Recent.
      await updateProject(project.id, { [stamp]: now.toISOString(), updatedAt: project.updatedAt });
    } catch {
      continue; // not stamped: try again on the next tick rather than risk a repeat
    }
    if (!granted) continue;
    const key = kind === 'review' && late ? 'reviewLate' : kind;
    try {
      await show(i18n.t(`reminders.${key}`, { title: project.title }));
    } catch (e) {
      console.error('Tayang: reminder notification failed', e);
    }
  }
}

let remindersRunning = false;

/** One pass: reminders (never overlapping), and every handler that is not still busy, each on its own. */
export async function tick(now: Date = new Date()): Promise<void> {
  for (const h of [...handlers]) {
    if (inFlight.has(h)) continue;
    inFlight.add(h);
    void Promise.resolve()
      .then(() => h(now))
      .catch((e) => console.error('Tayang: tick handler failed', e))
      .finally(() => inFlight.delete(h));
  }
  if (remindersRunning) return;
  remindersRunning = true;
  try {
    await runReminders(now);
  } catch (e) {
    console.error('Tayang: reminders failed', e);
  } finally {
    remindersRunning = false;
  }
}

/** Subscribes to the Rust tick and runs a pass right away (this catches reminders missed while closed). */
export async function startScheduler(): Promise<UnlistenFn> {
  const unlisten = await listen<string>(TICK_EVENT, () => void tick());
  void tick();
  return unlisten;
}
