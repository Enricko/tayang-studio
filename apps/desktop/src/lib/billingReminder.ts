import { i18n } from '@/i18n';
import { billingReminderDue } from '@/lib/billing';
import { canNotify, show } from '@/lib/scheduler';
import { useAuth } from '@/state/auth';
import { useBilling } from '@/state/billing';
import { BILLING_ENABLED } from '@/lib/features';

/** The period end the plan-ends-soon notification was last shown for (one per period). */
export const REMINDED_KEY = 'tayang.billing.remindedFor';
/** On ticks, the plan state is read from the API at most this often. */
const STATUS_MAX_AGE_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;

function remindedFor(): string | null {
  try {
    return localStorage.getItem(REMINDED_KEY);
  } catch {
    return null;
  }
}

function stamp(end: string): boolean {
  try {
    localStorage.setItem(REMINDED_KEY, end);
    return true;
  } catch {
    return false;
  }
}

/** Scheduler tick: "your plan ends in 3 days", once per period, while signed in. */
export async function runBillingReminder(now: Date): Promise<void> {
  if (!BILLING_ENABLED) return;
  await useAuth.getState().init();
  if (!useAuth.getState().status?.signedIn) return;
  const { status, loadedAt, refresh } = useBilling.getState();
  const s = !status || Date.now() - loadedAt > STATUS_MAX_AGE_MS ? await refresh() : status;
  if (!s || !billingReminderDue(s, now, remindedFor()) || !s.currentPeriodEnd) return;
  // Stamped first, so it shows once even if the notification fails; not stamped, not shown.
  if (!stamp(s.currentPeriodEnd)) return;
  if (!(await canNotify().catch(() => false))) return;
  const count = Math.max(1, Math.ceil((Date.parse(s.currentPeriodEnd) - now.getTime()) / DAY_MS));
  await show(i18n.t('billing.reminder', { count })).catch((e) => console.error('Tayang: plan reminder failed', e));
}
