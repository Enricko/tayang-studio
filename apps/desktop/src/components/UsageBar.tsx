import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '@/i18n';
import { AgentLogo } from '@/components/AgentLogo';
import { UsagePopover } from '@/components/UsagePopover';
import { AGENT_NAMES } from '@/lib/agents';
import { formatResetIn } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useApp } from '@/state/app';
import { useUsage } from '@/state/usage';
import type { AgentUsage } from '@tayang/shared';

export const pct = (n: number) => `${Math.round(n)}%`;

/** `33% used 1h 41m · 48% used 3d 13h · 26% used Fable` */
export function usageLine(u: AgentUsage, now: Date = new Date()): string {
  const t = i18n.t;
  if (u.status !== 'ok') return u.message ?? t('usage.unavailable');
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

export function UsageBar() {
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

  return (
    <UsagePopover>
      <button
        type="button"
        aria-label={t('usage.aria', { agent: AGENT_NAMES[agent] })}
        className="relative flex w-full cursor-pointer flex-col gap-2 text-left"
      >
        <span className="flex items-center gap-2">
          <AgentLogo id={agent} size={20} />
          <span className="text-[13px] font-medium">{AGENT_NAMES[agent]}</span>
        </span>
        <UsageMeter percent={mine?.session?.usedPercent ?? 0} label={t('usage.fiveHour')} />
        <span className="font-mono text-[11px] leading-4 text-text-2">{text}</span>
      </button>
    </UsagePopover>
  );
}
