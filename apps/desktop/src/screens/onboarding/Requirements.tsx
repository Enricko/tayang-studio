import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { requiredMissing, type SystemInfo, type ToolId, type ToolStatus } from '@tayang/shared';
import { AgentLogo } from '@/components/AgentLogo';
import { Button } from '@/components/Button';
import { OnboardingHeader } from '@/components/OnboardingHeader';
import { AGENT_NAMES } from '@/lib/agents';
import { getSystemInfo, updateSettings } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import { useApp } from '@/state/app';
import { useInstall } from '@/state/install';
import { ToolRow, TOOL_ORDER } from '@/components/ToolRow';

const PM: Record<string, string> = { brew: 'Homebrew', winget: 'winget', apt: 'apt', dnf: 'dnf', pacman: 'pacman' };
const OS: Record<string, string> = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };

export function Requirements() {
  const { navigate, settings, setSettings } = useApp();
  const statuses = useInstall((s) => s.statuses);
  const active = useInstall((s) => s.active);
  const closing = useInstall((s) => s.closing);
  const refresh = useInstall((s) => s.refresh);
  const start = useInstall((s) => s.start);
  const askKey = useInstall((s) => s.askKey);
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const agentId = settings?.defaultAgent ?? 'claude';
  const agentName = AGENT_NAMES[agentId];

  const check = useCallback(async () => {
    setCheckError(null);
    try {
      await refresh(agentId);
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, [refresh, agentId]);

  useEffect(() => {
    useInstall.getState().listen();
    getSystemInfo().then(setSys).catch(() => {});
    void check();
  }, [check]);

  const sorted = [...statuses].sort((a, b) => TOOL_ORDER.indexOf(a.id) - TOOL_ORDER.indexOf(b.id));
  const required = sorted.filter((t) => t.required);
  const recommended = sorted.filter((t) => !t.required);
  const missing = requiredMissing(statuses);
  const blocked = !loaded || missing.length > 0;

  const install = (tool: ToolId, key?: string) => {
    if (!sys) return;
    void start(tool, { sys, agent: agentId, elevenLabsKey: key });
  };

  const begin = async () => {
    const next = await updateSettings({ onboarded: true });
    setSettings(next);
    navigate({ name: 'chat-new' });
  };

  const group = (title: string, note: string, tools: ToolStatus[]) => (
    <section className="flex flex-col gap-3" key={title}>
      <span className="text-sm font-medium">
        {title} <span className="font-normal text-text-3">· {note}</span>
      </span>
      <ul className="m-0 flex list-none flex-col overflow-hidden rounded-xl border border-border bg-card p-0">
        {tools.map((t) => (
          <ToolRow
            key={t.id}
            tool={t}
            sys={sys}
            agentName={agentName}
            busy={!!active || closing || !sys}
            onInstall={(key) => install(t.id, key)}
            onAskKey={() => askKey(t.id)}
          />
        ))}
      </ul>
    </section>
  );

  return (
    <div className="flex min-h-full flex-col items-center bg-background px-6 pt-10 pb-12 text-foreground">
      <div className="flex w-full max-w-[720px] flex-col gap-8">
        <OnboardingHeader step={3} bars />
        <div data-tauri-drag-region className="mt-4 flex flex-col gap-2">
          <h1 className="text-4xl font-semibold tracking-[-0.02em]">Check your computer</h1>
          <p className="text-base leading-[1.6] text-text-2">
            Videos render on your computer, so Tayang needs a few tools. If something is missing, your agent installs
            it. Tayang shows you every command your agent asks to run, and nothing it asks about runs until you allow
            it. Installs always ask, even if you turn on Auto mode for chats.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <span className="text-[13px] text-text-3">Installs run through</span>
          <span className="inline-flex h-7 items-center gap-2 rounded-sm bg-raised px-2 text-[13px] font-medium">
            <AgentLogo id={agentId} size={16} />
            {agentName}
          </span>
          {sys && (
            <span className="ml-auto text-[13px] text-text-3">
              Detected{' '}
              <span className="text-[#D9D9D9]">
                {OS[sys.os]} {sys.osVersion}
                {sys.packageManager ? ` · ${PM[sys.packageManager]}` : ''}
              </span>
            </span>
          )}
          <Button
            variant="secondary"
            className="h-7 gap-1 rounded-sm bg-transparent px-2 text-xs text-[#D9D9D9]"
            disabled={!!active || closing}
            onClick={() => void check()}
          >
            <RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />
            Check again
          </Button>
        </div>

        {checkError && <p role="alert" className="m-0 text-[13px] text-orange-light">{checkError}</p>}

        {group('Required', missing.length ? `${missing.length} missing` : 'all ready', required)}
        {group('Recommended', 'you can add these later in Settings', recommended)}

        <div className="mt-2 flex items-center gap-4">
          <Button variant="ghost" className="mr-auto h-12 px-0 text-[15px]" onClick={() => navigate({ name: 'connect' })}>
            Back
          </Button>
          {blocked && missing.length > 0 && (
            <span className="text-[13px] text-text-3">Install {missing.map((m) => m.name).join(' and ')} to continue</span>
          )}
          <Button
            variant={blocked ? 'secondary' : 'primary'}
            className={cn('h-12 gap-2 px-5 text-[15px]', blocked && 'border-border bg-transparent text-text-3')}
            disabled={blocked}
            onClick={() => void begin()}
          >
            Start my first video
            {!blocked && <ArrowRight size={18} strokeWidth={2} aria-hidden="true" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
