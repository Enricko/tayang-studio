import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { AgentInfo, Settings as SettingsT, SystemInfo, ToolId } from '@tayang/shared';
import { AgentLogo } from '@/components/AgentLogo';
import { Button } from '@/components/Button';
import { Oyen } from '@/components/Oyen';
import { ToolRow, TOOL_ORDER } from '@/components/ToolRow';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AGENT_NAMES } from '@/lib/agents';
import { detectAgents, getSystemInfo, pickFolder, updateSettings } from '@/lib/ipc';
import { useApp } from '@/state/app';
import { useInstall } from '@/state/install';

const SECTIONS = [
  ['agents', 'Agents'],
  ['video', 'Video defaults'],
  ['render', 'Rendering'],
  ['tools', 'Tools'],
  ['account', 'Account'],
] as const;

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-border bg-card">{children}</div>;
}

function Row({ label, hint, note, children }: { label: string; hint?: string; note?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-[#222] px-4 py-3 last:border-b-0">
      <div className="mr-auto flex min-w-0 flex-col gap-1">
        <span className="text-sm">{label}</span>
        {hint && <span className="text-xs text-text-3">{hint}</span>}
        {note && <span className="text-xs text-text-3">{note}</span>}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange(v: T): void;
}) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as T)}>
      <TabsList aria-label={label} className="h-9 bg-background">
        {options.map((o) => (
          <TabsTrigger key={o.value} value={o.value} disabled={o.disabled} className="px-3 text-[13px]">
            {o.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

const section = (id: string) => () => document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth' });

export function Settings() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const navigate = useApp((s) => s.navigate);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statuses = useInstall((s) => s.statuses);
  const active = useInstall((s) => s.active);
  const closing = useInstall((s) => s.closing);
  const refresh = useInstall((s) => s.refresh);
  const start = useInstall((s) => s.start);
  const askKey = useInstall((s) => s.askKey);
  const agentId = settings?.defaultAgent ?? 'claude';
  const agentName = AGENT_NAMES[agentId];

  const check = useCallback(() => {
    refresh(agentId).catch(() => {});
  }, [refresh, agentId]);

  useEffect(() => {
    useInstall.getState().listen();
    detectAgents()
      .then(setAgents)
      .catch(() => {});
    getSystemInfo()
      .then(setSys)
      .catch(() => {});
  }, []);
  useEffect(check, [check]);

  const save = async (patch: Partial<SettingsT>) => {
    setError(null);
    try {
      setSettings(await updateSettings(patch));
    } catch (e) {
      setError(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const changeFolder = async () => {
    try {
      const path = await pickFolder();
      if (path) await save({ workingFolder: path });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!settings) return null;

  const install = (tool: ToolId, key?: string) => {
    if (sys) void start(tool, { sys, agent: agentId, elevenLabsKey: key });
  };
  const tools = [...statuses].sort((a, b) => TOOL_ORDER.indexOf(a.id) - TOOL_ORDER.indexOf(b.id));

  return (
    <div className="flex h-full flex-wrap content-start gap-8 overflow-y-auto p-8">
      <h1 data-tauri-drag-region className="m-0 flex-[1_1_100%] text-[28px] font-semibold tracking-[-0.01em]">
        Settings
      </h1>

      <nav aria-label="Settings sections" className="flex flex-[0_0_180px] flex-col gap-1">
        {SECTIONS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={section(id)}
            className="flex h-9 items-center rounded-md px-3 text-left text-sm font-medium text-text-2 hover:bg-raised hover:text-foreground"
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="flex max-w-[720px] min-w-0 flex-[999_1_460px] flex-col gap-8">
        {error && (
          <p role="alert" className="m-0 text-[13px] text-orange-light">
            {error}
          </p>
        )}

        <section id="agents" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="m-0 text-base font-medium">Agents</h2>
            <span className="text-[13px] text-text-2">
              Tayang talks to agents through ACP. Pick the one that builds your videos by default.
            </span>
          </div>
          <span id="default-agent-label" className="text-[13px] font-medium">
            Default agent for new chats
          </span>
          <Card>
            <RadioGroup
              aria-labelledby="default-agent-label"
              value={settings.defaultAgent}
              onValueChange={(v) => void save({ defaultAgent: v as SettingsT['defaultAgent'] })}
              className="gap-0"
            >
              {agents.map((a) => (
                <div key={a.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                  <RadioGroupItem value={a.id} id={`agent-${a.id}`} disabled={!a.installed} aria-label={`Use ${AGENT_NAMES[a.id]} by default`} />
                  <AgentLogo id={a.id} size={20} />
                  <div className="mr-auto flex min-w-0 flex-col gap-1">
                    <span className="text-sm font-medium">{AGENT_NAMES[a.id]}</span>
                    <span className="text-xs text-text-3">
                      {a.installed ? `Connected${a.version ? ` · ${a.version}` : ''}` : 'Not installed'}
                    </span>
                  </div>
                  <Button variant="ghost" className="h-8 px-2 text-[13px] text-primary hover:text-accent-hover" onClick={() => navigate({ name: 'connect' })}>
                    {a.installed ? 'Reconnect' : 'How to install'}
                  </Button>
                </div>
              ))}
            </RadioGroup>
          </Card>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className="mr-auto flex flex-col gap-1">
              <label htmlFor="frame-check" className="text-sm font-medium">
                Check every frame before showing me
              </label>
              <span className="text-xs text-text-3">
                The agent renders stills, looks for overlaps and cut-off text, and fixes them first
              </span>
            </div>
            <Switch
              id="frame-check"
              checked={settings.frameCheck}
              aria-label="Check every frame before showing me"
              onCheckedChange={(v) => void save({ frameCheck: v })}
            />
          </div>
        </section>

        <section id="video" className="flex flex-col gap-3">
          <h2 className="m-0 text-base font-medium">Video defaults</h2>
          <Card>
            <Row label="Language in videos">
              <Segmented
                label="Language in videos"
                value={settings.language}
                options={[
                  { value: 'id', label: 'Bahasa Indonesia' },
                  { value: 'en', label: 'English' },
                ]}
                onChange={(language) => void save({ language })}
              />
            </Row>
            <Row label="Format">
              <Segmented
                label="Format"
                value={settings.format}
                options={[
                  { value: '9:16', label: '9:16' },
                  { value: '1:1', label: '1:1' },
                  { value: '16:9', label: '16:9' },
                ]}
                onChange={(format) => void save({ format })}
              />
            </Row>
            <Row label="Frame rate">
              <Segmented
                label="Frame rate"
                value={String(settings.fps)}
                options={['24', '30', '60'].map((v) => ({ value: v, label: `${v} fps` }))}
                onChange={(v) => void save({ fps: Number(v) })}
              />
            </Row>
            <Row label="Voiceover">
              <span className="text-xs text-text-3">With a plan</span>
              <span className="text-sm text-[#D9D9D9]">Off</span>
            </Row>
          </Card>
        </section>

        <section id="render" className="flex flex-col gap-3">
          <h2 className="m-0 text-base font-medium">Rendering</h2>
          <Card>
            <Row
              label="Working folder"
              hint="Your projects live here, and your agent only works inside it"
              note="Existing projects stay where they are"
            >
              <span className="max-w-[220px] truncate font-mono text-xs text-[#D9D9D9]" title={settings.workingFolder}>
                {settings.workingFolder}
              </span>
              <Button variant="secondary" className="h-7 rounded-sm px-2 text-xs" onClick={() => void changeFolder()}>
                Change
              </Button>
            </Row>
            <Row label="Where to render" hint="Cloud rendering keeps your computer free while videos export">
              <Segmented
                label="Where to render"
                value="local"
                options={[
                  { value: 'local', label: 'This computer' },
                  { value: 'cloud', label: 'Cloud, with a plan', disabled: true },
                ]}
                onChange={() => {}}
              />
            </Row>
          </Card>
        </section>

        <section id="tools" className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="mr-auto flex flex-col gap-1">
              <h2 className="m-0 text-base font-medium">Tools</h2>
              <span className="text-[13px] text-text-2">
                Videos render on this computer. If something is missing, {agentName} installs it after you allow it.
              </span>
            </div>
            <Button
              variant="secondary"
              className="h-7 gap-1 rounded-sm bg-transparent px-2 text-xs text-[#D9D9D9]"
              disabled={!!active || closing}
              onClick={check}
            >
              <RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />
              Check again
            </Button>
          </div>
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

        <section id="account" className="flex flex-col gap-3">
          <h2 className="m-0 text-base font-medium">Account</h2>
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-4">
            <Oyen mood="default" size={40} />
            <div className="flex min-w-[280px] flex-1 flex-col gap-1">
              <span className="text-sm font-medium">You're on the free plan. Making videos is free.</span>
              <span className="text-[13px] leading-normal text-text-2">
                A tayang.app plan adds voiceover, cloud rendering, premium styles and Autopilot posting.
              </span>
            </div>
            <Button onClick={() => void openUrl('https://tayang.app')}>Sign in to tayang.app</Button>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className="mr-auto flex flex-col gap-1">
              <label htmlFor="share-install-stats" className="text-sm font-medium">
                Share anonymous install stats
              </label>
              <span className="text-xs text-text-3">
                Sends a random install ID, your system (macOS, Windows or Linux), its version, your computer's processor type and the app version once a day. Nothing about you or your videos.
              </span>
            </div>
            <Switch
              id="share-install-stats"
              checked={settings.shareInstallStats}
              aria-label="Share anonymous install stats"
              onCheckedChange={(v) => void save({ shareInstallStats: v })}
            />
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className="mr-auto flex flex-col gap-1">
              <label htmlFor="api-url" className="text-sm font-medium">
                API address
              </label>
              <span className="text-xs text-text-3">Used for built-in styles and install stats</span>
            </div>
            <Input
              id="api-url"
              key={settings.apiUrl}
              defaultValue={settings.apiUrl}
              spellCheck={false}
              className="h-8 w-[260px] bg-background font-mono text-xs"
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== settings.apiUrl) void save({ apiUrl: v });
              }}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
