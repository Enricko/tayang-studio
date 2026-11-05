import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { AgentLogo } from '@/components/AgentLogo';
import { UsagePopover } from '@/components/UsagePopover';
import { TayangCreditsCompact, UsageMeter, usageLine } from '@/components/UsageBar';
import { AGENT_NAMES } from '@/lib/agents';
import { cn } from '@/lib/utils';
import { useApp } from '@/state/app';
import { useUsage } from '@/state/usage';

/**
 * The bar along the bottom of the window: the usage of the agent in use (the open chat's, else the
 * default one): logo, a small meter of its 5 hour window, `56% used 4h 39m · 7% used 6d 17h`; then
 * a refresh button, and the Tayang account's credits on the right. Clicking the usage opens the
 * popover with every agent.
 */
export function StatusBar() {
  const { t } = useTranslation();
  const usage = useUsage((s) => s.usage);
  const loaded = useUsage((s) => s.loaded);
  const loading = useUsage((s) => s.loading);
  const chatAgent = useUsage((s) => s.chatAgent);
  const defaultAgent = useApp((s) => s.settings?.defaultAgent) ?? 'claude';
  const first = chatAgent ?? defaultAgent;

  useEffect(() => {
    useUsage.getState().start();
  }, []);

  // Only the agent in use; the popover lists every agent.
  const shown = usage.find((u) => u.agentId === first);

  return (
    <footer
      aria-label={t('usage.statusBar')}
      className="flex h-7 shrink-0 items-center gap-1 border-t border-border bg-background px-2 text-[12px] text-text-2"
    >
      <UsagePopover>
        <button
          type="button"
          aria-label={t('usage.aria', { agent: AGENT_NAMES[first] })}
          className="flex h-6 min-w-0 cursor-pointer items-center overflow-hidden rounded px-1.5 text-left hover:bg-raised/50"
        >
          <span data-testid="status-agent" className="flex min-w-0 items-center gap-2">
            <AgentLogo id={first} size={14} />
            {/* An agent without plan limits (opencode) has nothing to fill a meter with. */}
            {shown?.status === 'ok' && !shown.spend && (
              <UsageMeter percent={shown.session?.usedPercent ?? 0} label={t('usage.aria', { agent: AGENT_NAMES[first] })} className="w-14 shrink-0" />
            )}
            <span className="truncate">{shown ? usageLine(shown) : loaded ? t('usage.unavailable') : t('usage.loading')}</span>
          </span>
        </button>
      </UsagePopover>
      <button
        type="button"
        aria-label={t('usage.refresh')}
        title={t('usage.refresh')}
        onClick={() => void useUsage.getState().refresh(true)}
        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-raised/50 hover:text-foreground"
      >
        <RefreshCw size={13} aria-hidden="true" className={cn(loading && 'animate-spin motion-reduce:animate-none')} />
      </button>
      <div className="ml-auto flex shrink-0 items-center">
        <TayangCreditsCompact />
      </div>
    </footer>
  );
}
