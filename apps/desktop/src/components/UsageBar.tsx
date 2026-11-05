import { useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { i18n } from '@/i18n';
import { AgentLogo } from '@/components/AgentLogo';
import { UsagePopover } from '@/components/UsagePopover';
import { AGENT_NAMES } from '@/lib/agents';
import { formatResetIn } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useApp } from '@/state/app';
import { useUsage } from '@/state/usage';
import { useAuth } from '@/state/auth';
import { TAYANG_USAGE_EVERY_MS, useTayangUsage } from '@/state/tayangUsage';
import type { AgentUsage, Spend } from '@tayang/shared';

export const pct = (n: number) => `${Math.round(n)}%`;

/** $0.00, or more decimals for a small but not zero cost ($0.0042). */
export function formatCost(usd: number): string {
  const digits = usd > 0 && usd < 0.01 ? 4 : 2;
  return new Intl.NumberFormat(i18n.language || 'en', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(usd);
}

/** 186K, 1.2M: in the interface language. */
export const formatTokens = (n: number) => new Intl.NumberFormat(i18n.language || 'en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/** `$0.00 · 262.3K tokens`; the reply count goes in `spendTitle`, so the row fits the popover. */
export const spendRow = (s: Spend) => i18n.t('usage.spendRow', { cost: formatCost(s.costUsd), tokens: formatTokens(s.tokens) });
export const spendTitle = (s: Spend) => i18n.t('usage.spendTitle', { count: s.replies });

/** Why there is no usage, in the interface language (the agent's own words only for errors). */
export function usageMessage(u: AgentUsage): string {
  if (u.status === 'unavailable') return i18n.t('usage.notYet', { agent: AGENT_NAMES[u.agentId] });
  return u.message ?? i18n.t('usage.unavailable');
}

/** `33% used 1h 41m · 48% used 3d 13h · 26% used Fable` */
export function usageLine(u: AgentUsage, now: Date = new Date()): string {
  const t = i18n.t;
  if (u.status !== 'ok') return usageMessage(u);
  if (u.spend) return t('usage.spendLine', { cost: formatCost(u.spend.today.costUsd), tokens: formatTokens(u.spend.today.tokens) });
  const parts: string[] = [];
  if (u.session) parts.push(t('usage.used', { pct: pct(u.session.usedPercent), what: formatResetIn(u.session.resetsAt, now) }).trim());
  if (u.weekly) parts.push(t('usage.used', { pct: pct(u.weekly.usedPercent), what: formatResetIn(u.weekly.resetsAt, now) }).trim());
  if (u.modelWeekly) parts.push(t('usage.used', { pct: pct(u.modelWeekly.window.usedPercent), what: u.modelWeekly.label }));
  return parts.join(' · ') || t('usage.none');
}

export function UsageMeter({ percent, label, className }: { percent: number; label: string; className?: string }) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(p)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-1 w-full overflow-hidden rounded-full bg-raised', className)}
    >
      <div className={cn('h-full rounded-full', p >= 80 ? 'bg-primary' : 'bg-text-2')} style={{ width: `${p}%` }} />
    </div>
  );
}

/** The usage of the agent the sidebar shows: the open chat's, or the default one. */
function useShownUsage() {
  const { t } = useTranslation();
  const usage = useUsage((s) => s.usage);
  const loaded = useUsage((s) => s.loaded);
  const start = useUsage((s) => s.start);
  const chatAgent = useUsage((s) => s.chatAgent);
  const defaultAgent = useApp((s) => s.settings?.defaultAgent) ?? 'claude';
  const agent = chatAgent ?? defaultAgent;

  useEffect(() => {
    start();
  }, [start]);

  const mine = usage.find((u) => u.agentId === agent);
  const text = mine ? usageLine(mine) : loaded ? t('usage.unavailable') : t('usage.loading');
  return { agent, mine, text };
}

/**
 * The sidebar's agent usage on one line, like a status bar: logo, a small meter of the 5 hour
 * window, and `18% used 1h 37m · 89% used 2d 7h` (cut short when narrow; the popover and the
 * tooltip have all of it).
 */
export function UsageLineCompact() {
  const { t } = useTranslation();
  const { agent, mine, text } = useShownUsage();

  return (
    <UsagePopover>
      <button
        type="button"
        aria-label={t('usage.aria', { agent: AGENT_NAMES[agent] })}
        title={text}
        className="flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left hover:bg-raised/50"
      >
        <AgentLogo id={agent} size={14} />
        {!mine?.spend && <UsageMeter percent={mine?.session?.usedPercent ?? 0} label={t('usage.fiveHour')} className="w-8 shrink-0" />}
        <span className="min-w-0 truncate text-[11px] text-text-2">{text}</span>
      </button>
    </UsagePopover>
  );
}

/**
 * The Tayang account's AI credits and auto-posts left (gifts included), under the agent's usage;
 * opens Settings › Usage. Nothing signed out, or before the first answer.
 */
export function TayangCreditsCompact() {
  const { t } = useTranslation();
  const signedIn = useAuth((s) => !!s.status?.signedIn);
  const usage = useTayangUsage((s) => s.usage);
  const navigate = useApp((s) => s.navigate);

  useEffect(() => {
    if (!signedIn) {
      useTayangUsage.getState().clear();
      return;
    }
    const load = () => void useTayangUsage.getState().load();
    load();
    const every = setInterval(load, TAYANG_USAGE_EVERY_MS);
    return () => clearInterval(every);
  }, [signedIn]);

  if (!signedIn || !usage) return null;
  const line = t('usage.creditsLine', { count: usage.credits.remaining, posts: usage.posts.remaining });
  return (
    <button
      type="button"
      aria-label={`${t('usage.credits')}: ${line}`}
      title={t('usage.credits')}
      onClick={() => navigate({ name: 'settings', tab: 'usage' })}
      className="flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left hover:bg-raised/50"
    >
      <Sparkles size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-orange-light" />
      <span className="min-w-0 truncate text-[11px] text-text-2">{line}</span>
    </button>
  );
}

const RING_R = 17;
const RING_C = 2 * Math.PI * RING_R;

/** The collapsed sidebar's usage: the agent's logo inside a ring of its 5 hour usage. */
export function UsageRing() {
  const { t } = useTranslation();
  const { agent, mine, text } = useShownUsage();
  // Unknown usage (loading, unavailable) is a dashed track, not an empty one that reads as 0%.
  const used = mine?.session?.usedPercent;
  const p = used === undefined ? null : Math.max(0, Math.min(100, used));
  const name = AGENT_NAMES[agent];

  return (
    <UsagePopover>
      <button
        type="button"
        aria-label={p === null ? t('usage.aria', { agent: name }) : t('usage.ringAria', { agent: name, pct: pct(p) })}
        title={text}
        className="relative flex size-10 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <svg viewBox="0 0 40 40" className="absolute inset-0 size-10 -rotate-90" aria-hidden="true">
          <circle
            cx="20"
            cy="20"
            r={RING_R}
            fill="none"
            strokeWidth="2.5"
            className={cn('stroke-raised', p === null && '[stroke-dasharray:3_4]')}
          />
          {p !== null && (
            <circle
              data-testid="usage-ring-progress"
              cx="20"
              cy="20"
              r={RING_R}
              fill="none"
              strokeWidth="2.5"
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - p / 100)}
              className={cn('[stroke-linecap:round]', p >= 80 ? 'stroke-primary' : 'stroke-text-2')}
            />
          )}
        </svg>
        <AgentLogo id={agent} size={18} />
      </button>
    </UsagePopover>
  );
}
