import { i18n } from '@/i18n';
import { isWeb, canNotify as platformCanNotify, notify, requestNotify } from '@/lib/platform';
import { onReminder } from '@/lib/events';
import { listProjects, updateProject } from '@/lib/ipc';
import { dueReminders } from '@/lib/reminders';
import { useApp } from '@/state/app';

/** Rust emits this to the main window every 30 s, also while the window is hidden. */
export const TICK_EVENT = 'scheduler://tick';

export type TickHandler = (now: Date) => void | Promise<void>;
const handlers = new Set<TickHandler>();
const inFlight = new WeakSet<TickHandler>();

/**
 * Runs `handler` on every tick (and once at startup). Returns the unsubscribe. A handler is never
 * re-entered while its previous call is pending. The web edition runs scheduling on the server, so
 * these client handlers are only used by the desktop build.
 */
export function onTick(handler: TickHandler): () => void {
  handlers.add(handler);
  return () => void handlers.delete(handler);
}

export async function canNotify(): Promise<boolean> {
  if (await platformCanNotify()) return true;
  return requestNotify();
}

/** Shows a system notification (desktop plugin, or the browser Notification API in web). */
export async function show(body: string): Promise<void> {
  await notify(i18n.t('reminders.title'), body);
}

export async function sendTestNotification(): Promise<boolean> {
  const granted = await canNotify();
  useApp.getState().setNotificationsBlocked(!granted);
  if (!granted) return false;
  await show(i18n.t('reminders.test'));
  return true;
}

/**
 * The server stamps and emits reminders once per project. It runs whether or not a tab is open;
 * the browser can only display the notification while a tab is connected, which is documented.
 */
async function reminderNotification(r: { kind: string; title: string }) {
  if (!(await platformCanNotify())) return;
  const body =
    r.kind === 'reviewLate'
      ? i18n.t('reminders.reviewLate', { title: r.title })
      : r.kind === 'review'
        ? i18n.t('reminders.review', { title: r.title })
        : i18n.t('reminders.post', { title: r.title });
  await show(body);
}

/**
 * Shows the reminders due now. Only the desktop app calls this: in web the server has already
 * stamped them, so a client pass would double-stamp or miss the server notification.
 */
export async function runReminders(now: Date): Promise<void> {
  if (isWeb) return;
  if (useApp.getState().notificationsBlocked) {
    void platformCanNotify()
      .then((ok) => ok && useApp.getState().setNotificationsBlocked(false))
      .catch(() => {});
  }
  const due = dueReminders(await listProjects(), now);
  if (!due.length) return;
  let granted: boolean;
  try {
    granted = await canNotify();
  } catch {
    return;
  }
  useApp.getState().setNotificationsBlocked(!granted);
  for (const { project, kind, late, stamp } of due) {
    try {
      await updateProject(project.id, { [stamp]: now.toISOString(), updatedAt: project.updatedAt });
    } catch {
      continue;
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

export async function startScheduler(): Promise<() => void> {
  if (isWeb) {
    // No client orchestration: show the server's reminder events while this tab is connected.
    return onReminder((r) => {
      void reminderNotification(r).catch(() => {});
    });
  }
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<string>(TICK_EVENT, () => void tick());
  void tick();
  return unlisten;
}
