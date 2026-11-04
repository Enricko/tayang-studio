import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2 } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { PLANS, findPlan, type PaidPlanId, type Plan, type PlanId } from '@tayang/shared';
import { Button } from '@/components/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { uiLanguage } from '@/i18n';
import { formatDay, formatIdr, planCard, type BillingErrorCode } from '@/lib/billing';
import { cn } from '@/lib/utils';
import { useBilling } from '@/state/billing';

const ERROR_KEYS = {
  'signed-out': 'billing.errors.signedOut',
  'invalid-plan': 'billing.errors.invalidPlan',
  network: 'billing.errors.network',
  server: 'billing.errors.server',
  'payment-provider': 'billing.errors.paymentProvider',
} as const satisfies Record<BillingErrorCode, string>;

const planName = (id: PlanId, free: string) => findPlan(id)?.name ?? free;

/** What a plan includes, one line each. */
function Quotas({ plan }: { plan: Plan }) {
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

/** The plan picker and, after "Pay with QRIS", the wait for the payment. */
export function PlanDialog({ initialPlan }: { initialPlan: PaidPlanId }) {
  const { t } = useTranslation();
  const lang = uiLanguage();
  const flow = useBilling((s) => s.flow);
  const status = useBilling((s) => s.status);
  const pay = useBilling((s) => s.pay);
  const close = useBilling((s) => s.close);
  const checkAgain = useBilling((s) => s.checkAgain);
  const [chosen, setChosen] = useState<PaidPlanId>(initialPlan);
  const open = flow.phase !== 'closed';
  useEffect(() => {
    if (open) setChosen(initialPlan);
  }, [open, initialPlan]);

  const current = status?.active && status.plan !== 'free' ? status.plan : null;
  const picking = flow.phase === 'picking' || flow.phase === 'starting' || flow.phase === 'failed';
  const error =
    flow.phase !== 'failed'
      ? null
      : typeof flow.error === 'string'
        ? t(ERROR_KEYS[flow.error])
        : t('billing.errors.unexpected', { message: flow.error.message });

  let title: string = t('billing.dialog.title');
  let description: string = t('billing.dialog.body');
  if (flow.phase === 'waiting') [title, description] = [t('billing.dialog.waitingTitle'), t('billing.dialog.waiting')];
  if (flow.phase === 'timeout') [title, description] = [t('billing.dialog.timeoutTitle'), t('billing.dialog.timeout')];
  if (flow.phase === 'done') {
    const name = planName(flow.plan, '');
    title = t('billing.dialog.doneTitle');
    description = flow.currentPeriodEnd
      ? t('billing.dialog.done', { plan: name, date: formatDay(flow.currentPeriodEnd, lang) })
      : t('billing.dialog.doneNoEnd', { plan: name });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {picking && (
          <RadioGroup
            value={chosen}
            onValueChange={(v) => setChosen(v as PaidPlanId)}
            aria-label={t('billing.dialog.plans')}
            className="grid gap-3 sm:grid-cols-3"
          >
            {PLANS.map((p) => (
              <label
                key={p.id}
                htmlFor={`plan-${p.id}`}
                className={cn(
                  'flex cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4',
                  chosen === p.id ? 'border-primary' : 'border-border',
                )}
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value={p.id} id={`plan-${p.id}`} aria-labelledby={`plan-${p.id}-name`} />
                  <span id={`plan-${p.id}-name`} className="text-sm font-semibold">
                    {p.name}
                  </span>
                </div>
                {current === p.id && <span className="text-xs text-orange-light">{t('billing.current')}</span>}
                <span className="font-mono text-[15px]">{t('billing.perMonth', { price: formatIdr(p.price, lang) })}</span>
                <Quotas plan={p} />
              </label>
            ))}
          </RadioGroup>
        )}

        {flow.phase === 'starting' && (
          <p role="status" className="m-0 text-[13px] text-text-2">
            {t('billing.dialog.starting')}
          </p>
        )}
        {flow.phase === 'waiting' && (
          <p role="status" className="m-0 flex items-center gap-2 text-[13px] text-text-2">
            <Loader2 size={16} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />
            {t('billing.dialog.checking')}
          </p>
        )}
        {error && (
          <p role="alert" className="m-0 text-[13px] leading-normal text-orange-light">
            {error}
          </p>
        )}

        <DialogFooter>
          {flow.phase === 'done' ? (
            <Button onClick={close}>{t('billing.dialog.finish')}</Button>
          ) : (
            <Button variant="secondary" onClick={close}>
              {picking ? t('common.cancel') : t('common.close')}
            </Button>
          )}
          {(flow.phase === 'waiting' || flow.phase === 'timeout') && (
            <Button variant="secondary" onClick={() => void openUrl(flow.checkout.paymentLinkUrl).catch(() => {})}>
              {t('billing.dialog.openAgain')}
            </Button>
          )}
          {flow.phase === 'timeout' && <Button onClick={checkAgain}>{t('billing.dialog.checkAgain')}</Button>}
          {picking && (
            <Button disabled={flow.phase === 'starting'} onClick={() => void pay(chosen)}>
              {t('billing.dialog.pay')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Settings › Account, signed in: the plan, until when, and the way to pay. */
export function PlanCard() {
  const { t } = useTranslation();
  const lang = uiLanguage();
  const status = useBilling((s) => s.status);
  const openDialog = useBilling((s) => s.open);
  const pay = useBilling((s) => s.pay);
  const [initial, setInitial] = useState<PaidPlanId>('lite');
  useEffect(() => {
    void useBilling.getState().refresh();
  }, []);

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
  const choose = (plan: PaidPlanId) => {
    setInitial(plan);
    openDialog();
  };

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
          <Button
            variant="secondary"
            onClick={() => {
              setInitial(pending.plan);
              openDialog();
              void pay(pending.plan);
            }}
          >
            {t('billing.resume')}
          </Button>
        )}
        {paidPlan && (
          <Button variant="secondary" onClick={() => choose(paidPlan)}>
            {t('billing.changePlan')}
          </Button>
        )}
        <Button variant="secondary" onClick={() => choose(paidPlan ?? 'lite')}>
          {paidPlan ? t('billing.renew') : t('billing.upgrade')}
        </Button>
      </div>
      <PlanDialog initialPlan={initial} />
    </div>
  );
}
