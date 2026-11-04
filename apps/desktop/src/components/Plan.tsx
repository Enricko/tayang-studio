import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { findPlan, type PaidPlanId, type Plan, type PlanId } from '@tayang/shared';
import { Button } from '@/components/Button';
import { uiLanguage } from '@/i18n';
import { formatDay, planCard, type BillingErrorCode } from '@/lib/billing';
import { cn } from '@/lib/utils';
import { useApp } from '@/state/app';
import { useAuth } from '@/state/auth';
import { useBilling } from '@/state/billing';

/** The copy for each `billing:<code>` a payment can fail with. */
export const BILLING_ERROR_KEYS = {
  'signed-out': 'billing.errors.signedOut',
  'invalid-plan': 'billing.errors.invalidPlan',
  network: 'billing.errors.network',
  server: 'billing.errors.server',
  'payment-provider': 'billing.errors.paymentProvider',
  unavailable: 'billing.errors.unavailable',
  'rate-limited': 'billing.errors.rateLimited',
  bad_link: 'billing.errors.badLink',
} as const satisfies Record<BillingErrorCode, string>;

export const planName = (id: PlanId, free: string) => findPlan(id)?.name ?? free;

/** What a plan includes, one line each. */
export function Quotas({ plan }: { plan: Plan }) {
  const { t } = useTranslation();
  const q = plan.quotas;
  const lines = [
    t('billing.quota.socialAccounts'),
    t('billing.quota.autoPosts', { count: q.autoPosts }),
    ...(q.images ? [t('billing.quota.images', { count: q.images })] : []),
    ...(q.voiceMinutes ? [t('billing.quota.voice', { count: q.voiceMinutes })] : []),
  ];
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {lines.map((l) => (
        <li key={l} className="flex items-start gap-2 text-[13px] leading-normal text-text-2">
          <Check size={16} strokeWidth={1.5} aria-hidden="true" className="mt-0.5 shrink-0 text-text-3" />
          {l}
        </li>
      ))}
    </ul>
  );
}

/** Settings › Account, signed in: the plan, until when, and the way to pay. */
export function PlanCard() {
  const { t } = useTranslation();
  const lang = uiLanguage();
  const status = useBilling((s) => s.status);
  const navigate = useApp((s) => s.navigate);
  useEffect(() => {
    void useBilling.getState().refresh();
  }, []);

  const loadedAt = useBilling((s) => s.loadedAt);
  const failed = useBilling((s) => s.failed);
  const account = useAuth((s) => (s.status?.signedIn ? s.status.account : undefined));

  // Not read yet, or the read failed: the plan is unknown, which is not the same as free.
  if (!status && (failed || !loadedAt)) {
    const known = findPlan(account?.plan);
    return (
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-4">
        <div className="flex min-w-[220px] flex-1 flex-col gap-1">
          {known && <span className="text-sm font-medium">{known.name}</span>}
          <span role="status" className="text-[13px] leading-normal text-text-2">
            {failed ? t('billing.unknown') : t('billing.checking')}
          </span>
        </div>
        {failed && (
          <Button variant="secondary" onClick={() => void useBilling.getState().refresh()}>
            {t('common.tryAgain')}
          </Button>
        )}
      </div>
    );
  }

  const state = planCard(status);
  // The plan to renew: the running one, else the one that ran out.
  const paidPlan = state === 'active' && status?.plan !== 'free' ? (status?.plan ?? null) : (status?.lastPlan ?? null);
  const end = status?.currentPeriodEnd ?? null;
  const pending = status?.pending ?? null;
  const line =
    state === 'free'
      ? t('billing.freeNote')
      : state === 'active'
        ? end
          ? t('billing.activeUntil', { date: formatDay(end, lang) })
          : t('billing.active')
        : end
          ? t('billing.endedOn', { date: formatDay(end, lang) })
          : t('billing.ended');
  /** The plans screen; a pending payment there picks up where it was. */
  const choose = (plan?: PaidPlanId) => navigate({ name: 'plans', from: 'settings', plan });

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-4">
      <div className="flex min-w-[220px] flex-1 flex-col gap-1">
        <span className="text-sm font-medium">{planName(paidPlan ?? 'free', t('billing.free'))}</span>
        <span className={cn('text-[13px] leading-normal', state === 'ended' ? 'text-orange-light' : 'text-text-2')}>{line}</span>
        {pending && (
          <span className="text-xs text-text-3">
            {t('billing.pendingNote', {
              plan: planName(pending.plan, ''),
              time: new Intl.DateTimeFormat(lang === 'id' ? 'id-ID' : 'en-US', { hour: '2-digit', minute: '2-digit' }).format(new Date(pending.expiresAt)),
            })}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {pending && (
          <Button variant="secondary" onClick={() => choose(pending.plan)}>
            {t('billing.resume')}
          </Button>
        )}
        {paidPlan && (
          <Button variant="secondary" onClick={() => choose()}>
            {t('billing.changePlan')}
          </Button>
        )}
        <Button variant="secondary" onClick={() => choose(paidPlan ?? undefined)}>
          {paidPlan ? t('billing.renew') : t('billing.upgrade')}
        </Button>
      </div>
    </div>
  );
}
