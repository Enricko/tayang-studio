import { useState } from 'react';
import { AlertTriangle, Check, Download } from 'lucide-react';
import type { SystemInfo, ToolId, ToolStatus } from '@tayang/shared';
import { installCommands } from '@tayang/skills';
import sleepy from '@/assets/brand/oyen-expr-sleepy.svg';
import { AgentLogo } from '@/components/AgentLogo';
import { Button } from '@/components/Button';
import { PermissionCard } from '@/components/PermissionCard';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useApp } from '@/state/app';
import { useInstall, type LogLine, type ToolInstall } from '@/state/install';

export const TOOL_ORDER: ToolId[] = ['node', 'ffmpeg', 'chrome', 'elevenlabs-mcp', 'ytdlp'];

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

export function ToolRow({ tool, sys, agentName, busy, onInstall, onAskKey }: {
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
  const active = useInstall((s) => s.active);
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
        {status === 'running' && !ok && (
          <Button variant="ghost" className="h-9 px-2 text-[13px]" onClick={() => void cancel(tool.id)}>
            Cancel
          </Button>
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

      {request && active === tool.id && (
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
