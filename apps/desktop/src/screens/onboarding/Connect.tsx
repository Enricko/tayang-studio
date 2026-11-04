import { useEffect, useState } from 'react';
import { ArrowRight, Plus } from 'lucide-react';
import type { AgentId, AgentInfo } from '@tayang/shared';
import defaultOyen from '@/assets/brand/oyen-expr-default.svg';
import { AgentLogo } from '@/components/AgentLogo';
import { Button } from '@/components/Button';
import { Oyen } from '@/components/Oyen';
import { OnboardingHeader } from '@/components/OnboardingHeader';
import { detectAgents, updateSettings } from '@/lib/ipc';
import { useApp } from '@/state/app';

const ROWS: { id: AgentId; name: string; installUrl?: string }[] = [
  { id: 'claude', name: 'Claude Code', installUrl: 'https://docs.claude.com/en/docs/claude-code' },
  { id: 'opencode', name: 'opencode', installUrl: 'https://opencode.ai' },
  { id: 'gemini', name: 'Gemini CLI', installUrl: 'https://github.com/google-gemini/gemini-cli' },
  { id: 'codex', name: 'Codex', installUrl: 'https://github.com/openai/codex' },
  { id: 'custom', name: 'Another ACP agent' },
];

export function Connect() {
  const { navigate, settings, setSettings } = useApp();
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);

  useEffect(() => {
    let live = true;
    detectAgents()
      .then((a) => live && setAgents(a))
      .catch(() => live && setAgents([]));
    return () => {
      live = false;
    };
  }, []);

  const connect = async (id: AgentId) => {
    const next = await updateSettings({ defaultAgent: id });
    setSettings(next);
  };

  const info = (id: AgentId) => agents?.find((a) => a.id === id);
  const connectedId = ROWS.find((r) => info(r.id)?.installed && settings?.defaultAgent === r.id)?.id;

  return (
    <div className="flex min-h-full flex-col items-center bg-background px-6 pt-10 pb-12 text-foreground">
      <div className="flex w-full max-w-[720px] flex-col gap-8">
        <OnboardingHeader step={2} bars />
        <div data-tauri-drag-region className="mt-4 flex flex-col gap-2">
          <h1 className="text-4xl font-semibold tracking-[-0.02em]">Connect your AI agent</h1>
          <p className="text-base leading-[1.6] text-text-2">
            Tayang doesn't run its own AI. It directs the agent you already use, so there's nothing extra to pay. We
            found these on this computer:
          </p>
        </div>

        <ul className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
          {ROWS.map((r) => {
            const a = info(r.id);
            const installed = !!a?.installed;
            const connected = installed && settings?.defaultAgent === r.id;
            const status = r.id === 'custom'
              ? 'Point Tayang at any agent that speaks ACP'
              : installed
                ? `Found on this computer${connected ? ' · ready' : ''}`
                : 'Not installed';
            return (
              <li key={r.id} className="flex items-center gap-4 border-b border-border p-4 last:border-b-0">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-raised text-text-2">
                  {r.id === 'custom' ? <Plus size={18} strokeWidth={1.5} aria-hidden="true" /> : <AgentLogo id={r.id} size={22} />}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-medium">{r.name}</span>
                    {a?.recommended && <span className="text-xs text-orange-light">Recommended</span>}
                  </div>
                  <span className="text-[13px] text-text-3">{status}</span>
                </div>
                {connected && (
                  <span className="inline-flex h-9 items-center gap-2 text-sm text-[#D9D9D9]">
                    <Oyen mood="happy" size={24} />
                    Connected
                  </span>
                )}
                {installed && !connected && (
                  <Button variant="secondary" className="h-9" onClick={() => connect(r.id)} aria-label={`Connect ${r.name}`}>
                    Connect
                  </Button>
                )}
                {!installed && (
                  <a
                    href={r.installUrl ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center px-1 text-sm font-medium text-primary hover:text-accent-hover"
                  >
                    {r.id === 'custom' ? 'Add manually' : 'How to install'}
                  </a>
                )}
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-4 px-1">
          <img src={defaultOyen} alt="" aria-hidden="true" className="size-10 shrink-0" />
          <span className="text-sm leading-[1.6] text-text-2">
            New to AI agents? Oyen walks you through installing Claude Code and signing in, step by step.{' '}
            <a href="https://docs.claude.com/en/docs/claude-code" target="_blank" rel="noreferrer" className="text-primary hover:text-accent-hover">
              Show me how
            </a>
          </span>
        </div>

        <div data-tauri-drag-region className="mt-2 flex items-center justify-between">
          <Button variant="ghost" className="h-12 px-0 text-[15px]" onClick={() => navigate({ name: 'welcome' })}>
            Back
          </Button>
          <Button className="h-12 gap-2 px-5 text-[15px]" disabled={!connectedId} onClick={() => navigate({ name: 'requirements' })}>
            Continue
            <ArrowRight size={18} strokeWidth={2} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
