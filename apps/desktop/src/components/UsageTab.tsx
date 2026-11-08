import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Loading';
import { UsageMeter } from '@/components/UsageBar';
import { AgentBlock } from '@/components/UsagePopover';
import { useCloudError } from '@/components/SocialAccounts';
import { locale } from '@/i18n';
import { giftDate, useGiftAmount } from '@/components/GiftCode';
import { useApp } from '@/state/app';
import { useAuth } from '@/state/auth';
import { useUsage } from '@/state/usage';
import { useTayangUsage } from '@/state/tayangUsage';
import { BILLING_ENABLED } from '@/lib/features';

/**
 * Settings › Usage: the Tayang plan's AI credits and auto-posts this cycle, and each agent's own
 * usage (Claude Code's limits, what opencode spent).
 */
export function UsageTab({ onAccount }: { onAccount(): void }) {
  const { t } = useTranslation();
  const explain = useCloudError();
  const signedIn = useAuth((s) => !!s.status?.signedIn);
  const agents = useUsage((s) => s.usage);
  const refreshAgents = useUsage((s) => s.refresh);
  const usage = useTayangUsage((s) => (signedIn ? s.usage : null));
  const error = useTayangUsage((s) => s.error);
  const loadingTayang = useTayangUsage((s) => s.loading);
  const loadingAgents = useUsage((s) => s.loading);
  const load = useTayangUsage((s) => s.load);
  const amount = useGiftAmount();
  const navigate = useApp((s) => s.navigate);

  useEffect(() => {
    void useAuth.getState().init();
    useUsage.getState().start();
  }, []);
  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn, load]);

  const reset = usage ? new Intl.DateTimeFormat(locale(), { dateStyle: 'medium' }).format(new Date(usage.cycleEnd)) : null;

  return (
    <div className="flex flex-col gap-6">
      {BILLING_ENABLED && (
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t('usageTab.tayang')}</span>
          {reset && <span className="text-xs text-text-3">{t('usageTab.resets', { date: reset })}</span>}
          {signedIn && (
            <button
              type="button"
              aria-label={t('cloud.refresh')}
              title={t('cloud.refresh')}
              onClick={() => void load()}
              disabled={loadingTayang}
              className="ml-auto flex size-7 cursor-pointer items-center justify-center rounded-sm text-text-3 hover:bg-raised hover:text-foreground disabled:cursor-default"
            >
              <RefreshCw size={14} aria-hidden="true" className={loadingTayang ? 'animate-spin motion-reduce:animate-none' : undefined} />
            </button>
          )}
        </div>
        {!signedIn ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-text-3">{t('usageTab.signedOut')}</span>
            <Button variant="secondary" className="h-8 px-3 text-[13px]" onClick={onAccount}>
              {t('usageTab.toAccount')}
            </Button>
          </div>
        ) : usage ? (
          <>
            {(['credits', 'posts'] as const).map((m) => (
              <div key={m} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between text-[13px]">
                  <span>{t(`cloud.${m}`)}</span>
                  <span className="font-mono text-xs text-text-2">{t('cloud.left', { left: usage[m].remaining, of: usage[m].allowance })}</span>
                </div>
                <UsageMeter
                  percent={usage[m].allowance > 0 ? (usage[m].used / usage[m].allowance) * 100 : 0}
                  label={t(`cloud.${m}`)}
                />
              </div>
            ))}
            {(usage.gifts ?? []).map((g) => (
              <p key={`${g.name}-${g.expiresAt}`} className="m-0 text-xs text-text-2">
                {t('gift.running', {
                  name: g.name,
                  what: amount(g, { credits: g.creditsLeft, posts: g.postsLeft }),
                  date: giftDate(g.expiresAt),
                })}
              </p>
            ))}
            {usage.credits.allowance === 0 && usage.posts.allowance === 0 && (
              <Button variant="secondary" className="h-8 self-start px-3 text-[13px]" onClick={() => navigate({ name: 'plans', from: 'settings' })}>
                {t('cloud.seePlans')}
              </Button>
            )}
          </>
        ) : error ? (
          <p role="alert" className="m-0 text-xs text-orange-light">
            {explain(error)}
          </p>
        ) : (
          <div role="status" aria-label={t('usage.loading')} className="flex flex-col gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <div className="flex justify-between">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="h-1 w-full" />
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t('usageTab.agents')}</span>
          <button
            type="button"
            aria-label={t('usage.refresh')}
            title={t('usage.refresh')}
            onClick={() => void refreshAgents(true)}
            disabled={loadingAgents}
            className="ml-auto flex size-7 cursor-pointer items-center justify-center rounded-sm text-text-3 hover:bg-raised hover:text-foreground disabled:cursor-default"
          >
            <RefreshCw size={14} aria-hidden="true" className={loadingAgents ? 'animate-spin motion-reduce:animate-none' : undefined} />
          </button>
        </div>
        {agents.length === 0 && loadingAgents ? (
          <div role="status" aria-label={t('usage.loading')} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-1 w-full" />
          </div>
        ) : agents.length === 0 ? (
          <span className="text-xs text-text-3">{t('usage.noAgents')}</span>
        ) : (
          // i18n-ignore: a view name, not text.
          agents.map((u) => <AgentBlock key={u.agentId} u={u} view="detailed" />)
        )}
      </div>
    </div>
  );
}
