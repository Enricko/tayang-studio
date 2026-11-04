import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Download, RefreshCw } from 'lucide-react';
import { requiredMissing, type SystemInfo, type ToolId, type ToolStatus } from '@tayang/shared';
import { installCommands } from '@tayang/skills';
import sleepy from '@/assets/brand/oyen-expr-sleepy.svg';
import { AgentLogo } from '@/components/AgentLogo';
import { Button } from '@/components/Button';
import { OnboardingHeader } from '@/components/OnboardingHeader';
import { PermissionCard } from '@/components/PermissionCard';
import { Input } from '@/components/ui/input';
import { AGENT_NAMES } from '@/lib/agents';
import { getSystemInfo, updateSettings } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import { useApp } from '@/state/app';
import { useInstall, type LogLine, type ToolInstall } from '@/state/install';

const ORDER: ToolId[] = ['node', 'ffmpeg', 'chrome', 'elevenlabs-mcp', 'ytdlp'];

const COPY: Record<ToolId, { detail: string; missing?: string; ask: string }> = {
  node: { detail: 'Runs the video engine · needs 22 or newer', ask: 'Install Node.js 22 or newer on this computer, then confirm node --version works.' },
  chrome: { detail: 'Draws each frame before it is encoded', ask: 'Install Google Chrome on this computer.' },
  ffmpeg: {
    detail: 'Encodes the final MP4 and reads frames',
    missing: 'Not found · encodes the final MP4 and reads frames',
    ask: 'Install FFmpeg on this computer with the system package manager, then confirm ffmpeg -version works.',
  },
  'elevenlabs-mcp': {
    detail: 'Lets your agent add voiceover, including in Bahasa Indonesia',
    ask: 'Add the ElevenLabs MCP server to your agent with this API key, then make one test call to list voices.',
  },
  ytdlp: {
    detail: 'Needed to copy a style from a TikTok, Reels or YouTube link',
    missing: 'Not found · needed to copy a style from a TikTok, Reels or YouTube link',
    ask: 'Install yt-dlp on this computer, then confirm yt-dlp --version works.',
  },
};

const PM: Record<string, string> = { brew: 'Homebrew', winget: 'winget', apt: 'apt', dnf: 'dnf', pacman: 'pacman' };
const OS: Record<string, string> = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };

function LogList({ log, done }: { log: LogLine[]; done: boolean }) {
  if (log.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-2 rounded-md border border-border bg-sidebar p-3">
      {log.map((l) => {
        const state = done || l.status === 'done' ? 'done' : l.status === 'failed' ? 'failed' : 'active';
        return (
          <li key={l.id} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden="true"
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                state === 'done' && 'bg-text-3',
                state === 'active' && 'bg-primary',
                state === 'failed' && 'border border-[#4A4A4A]',
              )}
            />
            <span className={cn(state === 'active' ? 'text-foreground' : 'font-mono text-text-2')}>{l.title}</span>
          </li>
        );
      })}
    </ul>
  );
}

function ToolRow({ tool, sys, agentName, busy, onInstall, onAskKey }: {
  tool: ToolStatus;
  sys: SystemInfo | null;
  agentName: string;
  busy: boolean;
  onInstall(key?: string): void;
  onAskKey(): void;
}) {
  const inst: ToolInstall | undefined = useInstall((s) => s.tools[tool.id]);
  const request = useInstall((s) => s.request);
  const respond = useInstall((s) => s.respond);
  const cancel = useInstall((s) => s.cancel);
  const dismiss = useInstall((s) => s.dismiss);
  const agent = useApp((s) => s.settings?.defaultAgent) ?? 'claude';
  const [key, setKey] = useState('');
  const copy = COPY[tool.id];
  const isEleven = tool.id === 'elevenlabs-mcp';

  const status = inst?.status ?? 'missing';
  const ok = tool.ok || status === 'done';
  const showMissing = !ok && (status === 'missing' || status === 'failed' || status === 'key');
  const detail = ok
    ? status === 'done'
      ? isEleven ? `Added to ${agentName} · voiceover is on` : `Installed by ${agentName}`
      : copy.detail
    : copy.missing ?? (isEleven ? copy.detail : tool.detail || copy.detail);
  const label = isEleven ? `Add to ${agentName}` : 'Install';
  const expected = sys ? installCommands(tool.id, sys, agent) : [];

  return (
    <li className="flex flex-col gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex items-center gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-raised text-text-2">
          {tool.id === 'ytdlp' ? <Download size={20} strokeWidth={1.5} aria-hidden="true" /> : <AgentLogo id={tool.id} size={22} />}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[15px] font-medium">{tool.name}</span>
          <span className="text-[13px] text-text-3">{detail}</span>
        </div>
        {ok && (
          <span className="inline-flex items-center gap-2 text-sm text-[#D9D9D9] tabular-nums">
            <Check size={16} strokeWidth={1.5} aria-hidden="true" className="text-foreground" />
            {status === 'done' && isEleven ? 'Added' : tool.version ?? 'Found'}
          </span>
        )}
        {showMissing && status !== 'key' && (
          <Button
            variant={tool.required ? 'primary' : 'secondary'}
            className="h-9 px-3 text-[13px]"
            disabled={busy}
            aria-label={status === 'failed' ? undefined : `${label} ${tool.name}`}
            onClick={() => (isEleven ? onAskKey() : onInstall())}
          >
            {status === 'failed' ? 'Try again' : label}
          </Button>
        )}
        {(status === 'running' || status === 'confirm') && !ok && (
          <span className="inline-flex items-center gap-2 text-[13px] text-text-2">
            <img src={sleepy} alt="" aria-hidden="true" className="size-6" />
            {status === 'running' ? 'Installing' : 'Waiting for permission'}
          </span>
        )}
      </div>

      {isEleven && !ok && (status === 'missing' || status === 'key') && (
        <div role="alert" className="flex items-start gap-3 rounded-md border border-deep-orange bg-tint p-3">
          <AlertTriangle size={18} strokeWidth={1.5} aria-hidden="true" className="mt-px shrink-0 text-orange-light" />
          <div className="flex flex-col gap-1 text-[13px] leading-normal">
            <span className="font-medium text-orange-light">No voiceover without ElevenLabs</span>
            <span className="text-[#D9C2B8]">
              {agentName} doesn't have the ElevenLabs MCP yet. Your videos will have captions and music, but no narration.
            </span>
          </div>
        </div>
      )}

      {status === 'failed' && inst?.error && (
        <p role="alert" className="m-0 text-[13px] text-orange-light">{inst.error}</p>
      )}

      {status === 'key' && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-ink p-3">
          <label htmlFor="elkey" className="text-[13px] text-[#D9D9D9]">
            ElevenLabs API key{' '}
            <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer" className="ml-1 text-xs text-primary hover:text-accent-hover">
              Get a key
            </a>
          </label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="elkey"
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk_…"
              autoComplete="off"
              className="h-9 min-w-60 flex-1 bg-card font-mono text-[13px]"
            />
            <Button variant="light" className="h-9 px-3 text-[13px] font-semibold" disabled={!key.trim() || busy} onClick={() => onInstall(key.trim())}>
              Continue
            </Button>
            <Button variant="ghost" className="h-9 px-2 text-[13px]" onClick={() => dismiss(tool.id)}>
              Cancel
            </Button>
          </div>
          <span className="text-xs text-text-3">Stored in your agent's MCP settings on this computer. Tayang never uploads it</span>
        </div>
      )}

      {status === 'confirm' && request && (
        <PermissionCard request={request} ask={copy.ask} agentId={agent} onRespond={(id) => void respond(id)} />
      )}

      {status === 'confirm' && !request && (
        <div className="flex flex-col gap-2 rounded-md border border-hairline bg-ink p-3">
          <span className="text-xs text-text-3">{agentName} will ask to run</span>
          <pre className="m-0 rounded-sm border border-border bg-sidebar px-3 py-2 font-mono text-xs leading-[1.7] whitespace-pre-line text-foreground">
            {expected.join('\n')}
          </pre>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-3">Nothing runs until you allow it</span>
            <Button variant="ghost" className="ml-auto h-9 px-2 text-[13px]" onClick={() => void cancel(tool.id)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {(status === 'running' || (status === 'done' && !!inst?.log.length)) && (
        <LogList log={inst?.log ?? []} done={status === 'done'} />
      )}
    </li>
  );
}

export function Requirements() {
  const { navigate, settings, setSettings } = useApp();
  const statuses = useInstall((s) => s.statuses);
  const active = useInstall((s) => s.active);
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

  const sorted = [...statuses].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
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
            busy={!!active || !sys}
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
            it. You approve every command first.
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
            disabled={!!active}
            onClick={() => void check()}
          >
            <RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />
            Check again
          </Button>
        </div>

        {checkError && <p role="alert" className="m-0 text-[13px] text-orange-light">{checkError}</p>}

        {group('Required', missing.length ? `${missing.length} missing` : 'all ready', required)}
        {group('Recommended', 'you can add these later in Settings', recommended)}

        <div data-tauri-drag-region className="mt-2 flex items-center gap-4">
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
