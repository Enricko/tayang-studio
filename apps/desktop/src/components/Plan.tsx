import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type React from 'react';
import { Check, Info } from 'lucide-react';
import { CREDIT_COSTS, creditReach, findPlan, planCredits, type PaidPlanId, type Plan, type PlanId } from '@tayang/shared';
import { Button } from '@/components/Button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
  downgrade_not_allowed: 'billing.errors.downgrade',
} as const satisfies Record<BillingErrorCode, string>;

export const planName = (id: PlanId, free: string) => findPlan(id)?.name ?? free;

/** "165 AI credits a month", "Enough to generate up to 165 images, or up to 23 minutes of AI voice", from CREDIT_COSTS. */
export function CreditsLine({ credits }: { credits: number }) {
  const { t } = useTranslation();
  const reach = creditReach(credits);
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5">
        {t('billing.quota.credits', { count: credits })}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t('billing.quota.whatAreCredits')}
              // Inside a plan card's label: explaining credits must not pick the card.
              onClick={(e) => e.stopPropagation()}
              className="inline-flex cursor-pointer items-center rounded-full border-0 bg-transparent p-0 text-text-3 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
            >
              <Info size={14} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 text-[13px] leading-normal text-text-2">
            {t('billing.quota.creditsExplain', { image: CREDIT_COSTS.image, voice: CREDIT_COSTS.voiceMinute })}
          </PopoverContent>
        </Popover>
      </span>
      <span className="text-xs text-text-3">{t('billing.quota.creditsReach', { images: reach.images, minutes: reach.voiceMinutes })}</span>
    </div>
  );
}

/** What a plan includes, one line each: AI credits (one pool), auto-posts, social accounts. */
export function Quotas({ plan }: { plan: Plan }) {
  const { t } = useTranslation();
  const q = plan.quotas;
  const lines: { key: string; body: React.ReactNode; muted?: boolean }[] = [
    q.credits
      ? { key: 'credits', body: <CreditsLine credits={q.credits} /> }
      : { key: 'credits', body: t('billing.quota.noCredits'), muted: true },
    { key: 'posts', body: t('billing.quota.autoPosts', { count: q.autoPosts }) },
    { key: 'social', body: t('billing.quota.socialAccounts') },
  ];
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {lines.map((l) => (
        <li key={l.key} className={cn('flex items-start gap-2 text-[13px] leading-normal', l.muted ? 'text-text-3' : 'text-text-2')}>
          <Check size={16} strokeWidth={1.5} aria-hidden="true" className={cn('mt-0.5 shrink-0', l.muted ? 'opacity-0' : 'text-text-3')} />
          {l.body}
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
        {state === 'active' && paidPlan && planCredits(paidPlan) > 0 && (
          <div className="text-[13px] text-text-2">
            <CreditsLine credits={planCredits(paidPlan)} />
          </div>
        )}
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
        {/* While a plan runs only a higher one can be bought: Upgrade (none above Pro). After it ends, any. */}
        {paidPlan && state === 'active' && paidPlan !== 'pro' && (
          <Button variant="secondary" onClick={() => choose()}>
            {t('billing.upgrade')}
          </Button>
        )}
        {paidPlan && state === 'ended' && (
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
