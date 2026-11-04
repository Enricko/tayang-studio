import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link2, Loader2 } from 'lucide-react';
import type { Style as StyleT, StyleAspect } from '@tayang/shared';
import { Button } from '@/components/Button';
import { Oyen } from '@/components/Oyen';
import { PermissionCard } from '@/components/PermissionCard';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { deleteStyle, listStyles, saveStyle, syncStyles } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import { useApp } from '@/state/app';
import { useStudy } from '@/state/study';

export function isVideoUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return true;
  if (host === 'instagram.com') return /^\/(reel|reels|p)\//.test(u.pathname);
  if (host === 'youtube.com') return true;
  return host === 'youtu.be';
}

const ASPECT_LABEL: Record<StyleAspect, string> = {
  camera: 'Camera',
  pacing: 'Pacing',
  type: 'Type',
  color: 'Color',
  captions: 'Captions',
  transitions: 'Transitions',
};

type Tab = 'all' | 'builtin' | 'copied' | 'mine';
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'builtin', label: 'Built in' },
  { id: 'copied', label: 'Copied from videos' },
  { id: 'mine', label: 'Yours' },
];

const SWATCHES: [string, string][] = [
  ['#0B1E3F', '#FFFFFF'],
  ['#F2470C', '#141414'],
  ['#E8ECF4', '#0B1E3F'],
  ['#3B1F14', '#FFE7D6'],
  ['#1F2A1A', '#F5E6A8'],
  ['#FFF0E0', '#3B1F14'],
];
function swatch(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SWATCHES[h % SWATCHES.length]!;
}

const ENGINE_LABEL = { remotion: 'Remotion', hyperframes: 'HyperFrames' } as const;

function sourceLabel(s: StyleT): string {
  if (s.source === 'builtin') return 'Built in';
  if (s.source === 'copied') return s.sourceUrl ? `Copied from a video · ${new URL(s.sourceUrl).hostname.replace(/^www\./, '')}` : 'Copied from a video';
  return 'Yours';
}

function StudyBox() {
  const study = useStudy();
  const agent = useApp((s) => s.settings?.defaultAgent) ?? 'claude';
  const steps = ['Downloaded', 'Frames sampled', 'Reading camera, pacing and type', 'Writing the style prompt'];
  const active = Math.min(study.toolCalls, steps.length - 1);

  if (study.phase === 'idle') return null;
  if (study.phase === 'failed')
    return (
      <div role="alert" className="flex items-start gap-3 rounded-md border border-border bg-background p-3">
        <Oyen mood="surprised" size={32} />
        <div className="flex flex-1 flex-col gap-2">
          <span className="text-[13px] font-medium">Couldn't copy this style</span>
          <span className="text-xs text-text-2">{study.error}</span>
          <Button variant="secondary" className="h-8 self-start px-3 text-[13px]" onClick={study.dismiss}>
            Dismiss
          </Button>
        </div>
      </div>
    );
  if (study.phase === 'done')
    return (
      <div className="flex items-center gap-3 rounded-md border border-border bg-background p-3">
        <Oyen mood="happy" size={32} />
        <span className="mr-auto text-[13px] font-medium">Style saved to your library</span>
        <Button variant="ghost" className="h-8 px-2 text-[13px]" onClick={study.dismiss}>
          Dismiss
        </Button>
      </div>
    );
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-background p-3">
      <div className="flex items-start gap-3">
        <Oyen mood="sleepy" size={32} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium">Studying a video</span>
            <span className="truncate font-mono text-xs text-text-3">{study.url.replace(/^https?:\/\//, '')}</span>
            <Button variant="ghost" className="ml-auto h-7 px-2 text-xs" onClick={() => void study.cancel()}>
              Cancel
            </Button>
          </div>
          <div className="flex flex-wrap gap-4 text-xs">
            {steps.map((s, i) => (
              <span key={s} className="inline-flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-1.5 rounded-full',
                    i < active && 'bg-text-3',
                    i === active && 'tayang-pulse bg-primary',
                    i > active && 'border border-[#4A4A4A]',
                  )}
                />
                <span className={i < active ? 'text-text-2' : i === active ? 'text-foreground' : 'text-text-3'}>{s}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
      {study.ranLog.length > 0 && (
        <ul aria-label="Commands run without asking" className="m-0 flex list-none flex-col gap-1 p-0">
          {study.ranLog.slice(-4).map((line, i) => (
            <li key={`${study.ranLog.length}-${i}`} className="truncate font-mono text-xs text-text-3" title={line}>
              {line}
            </li>
          ))}
        </ul>
      )}
      {study.request && (
        <PermissionCard
          request={study.request}
          ask="Study this video on this computer: download it, sample frames and write the style."
          agentId={agent}
          allowLabel="Allow"
          onRespond={(id) => void study.respond(id)}
        />
      )}
    </div>
  );
}

/** The style's preview image; the swatch when it has none or the image can't load (offline). */
function PreviewImage({
  src,
  className,
  fallback,
  lazy = false,
}: {
  src?: string | null;
  className: string;
  fallback: ReactNode;
  lazy?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return <>{fallback}</>;
  return <img src={src} alt="" loading={lazy ? 'lazy' : undefined} className={className} onError={() => setFailed(src)} />;
}

function Detail({ style, onChanged }: { style: StyleT; onChanged(): void }) {
  const navigate = useApp((s) => s.navigate);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(style.name);
  const [prompt, setPrompt] = useState(style.prompt);
  const [error, setError] = useState<string | null>(null);
  const [bg] = swatch(style.id);

  useEffect(() => {
    setEditing(false);
    setName(style.name);
    setPrompt(style.prompt);
    setError(null);
  }, [style.id, style.name, style.prompt]);

  const save = async () => {
    if (!name.trim() || !prompt.trim()) return;
    try {
      const next: StyleT =
        style.source === 'mine'
          ? { ...style, name: name.trim(), prompt: prompt.trim() }
          : {
              id: `mine-${Date.now().toString(36)}`,
              name: name.trim(),
              source: 'mine',
              sourceUrl: null,
              notes: style.notes,
              prompt: prompt.trim(),
              createdAt: new Date().toISOString(),
            };
      await saveStyle(next);
      setEditing(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async () => {
    try {
      await deleteStyle(style.id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const notes = (Object.keys(ASPECT_LABEL) as StyleAspect[]).filter((a) => style.notes[a]);
  return (
    <aside
      aria-label="Style details"
      className="flex min-w-0 max-w-[360px] flex-1 basis-[300px] flex-col gap-4 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex flex-col gap-1">
        {editing ? (
          <Input aria-label="Style name" value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
        ) : (
          <span className="text-base font-medium">{style.name}</span>
        )}
        <span className="text-xs text-text-3">{sourceLabel(style)}</span>
        {style.engine && <span className="font-mono text-xs text-text-3">{ENGINE_LABEL[style.engine]}</span>}
      </div>
      <PreviewImage
        src={style.previewUrl}
        className="aspect-video w-full rounded-md border border-[#333] object-cover"
        fallback={
          <div className="flex gap-1" aria-label="Sampled frames">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span
                key={i}
                className="aspect-[9/16] flex-1 rounded-sm border border-[#333]"
                style={{ background: bg, opacity: 1 - i * 0.08 }}
              />
            ))}
          </div>
        }
      />
      {notes.length > 0 && (
        <dl className="m-0 flex flex-col gap-2">
          {notes.map((a) => (
            <div key={a} className="flex gap-3 text-[13px] leading-normal">
              <dt className="w-[76px] shrink-0 text-text-3">{ASPECT_LABEL[a]}</dt>
              <dd className="m-0 text-[#D9D9D9]">{style.notes[a]}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex flex-col gap-2">
        <label htmlFor="style-prompt" className="text-xs text-text-3">
          Prompt your agent gets
        </label>
        {editing ? (
          <Textarea
            id="style-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={8}
            className="bg-background font-mono text-xs leading-[1.6]"
          />
        ) : (
          <div
            id="style-prompt"
            className="rounded-md border border-border bg-background p-3 font-mono text-xs leading-[1.6] whitespace-pre-line text-[#D9D9D9]"
          >
            {style.prompt}
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="m-0 text-xs text-orange-light">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {editing ? (
          <>
            <Button variant="secondary" className="h-9 px-3 text-[13px]" disabled={!name.trim() || !prompt.trim()} onClick={() => void save()}>
              Save
            </Button>
            <Button variant="ghost" className="h-9 px-3 text-[13px]" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" className="h-9 px-3 text-[13px]" onClick={() => navigate({ name: 'chat-new', ...(style.template ? { styleId: style.id } : {}) })}>
              Use in a new chat
            </Button>
            <Button variant="ghost" className="h-9 px-3 text-[13px]" onClick={() => setEditing(true)}>
              Edit prompt
            </Button>
            {style.source !== 'builtin' && (
              <Button variant="ghost" className="h-9 px-3 text-[13px]" onClick={() => void remove()}>
                Delete
              </Button>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

export function Style() {
  const agent = useApp((s) => s.settings?.defaultAgent) ?? 'claude';
  const savedVersion = useStudy((s) => s.savedVersion);
  const phase = useStudy((s) => s.phase);
  const startStudy = useStudy((s) => s.start);
  const [stored, setStored] = useState<StyleT[]>([]);
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<Tab>('all');
  const [sel, setSel] = useState<string | null>(null);
  const focusLink = useApp((s) => s.route.name === 'style' && !!s.route.focusLink);
  const [url, setUrl] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusLink) input.current?.focus();
    // Only when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(true);
  const [offline, setOffline] = useState(false);

  // Built-in styles come from the API: refresh them whenever the screen opens.
  useEffect(() => {
    let alive = true;
    syncStyles()
      .then((r) => {
        if (!alive) return;
        setOffline(r.offline);
        setVersion((v) => v + 1);
      })
      .catch(() => alive && setOffline(true))
      .finally(() => alive && setSyncing(false));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    listStyles()
      .then((s) => alive && setStored(s))
      .catch(() => alive && setStored([]));
    return () => {
      alive = false;
    };
  }, [version, savedVersion]);

  const all = stored;
  const hasBuiltin = useMemo(() => stored.some((s) => s.source === 'builtin'), [stored]);
  const shown = all.filter((s) => tab === 'all' || s.source === tab);
  const current = all.find((s) => s.id === sel) ?? shown[0] ?? all[0];

  const study = () => {
    if (!isVideoUrl(url)) {
      setUrlError('Paste a TikTok, Reels or YouTube link');
      return;
    }
    setUrlError(null);
    void startStudy(url.trim(), agent);
  };

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-8">
      <div data-tauri-drag-region className="flex flex-col gap-1">
        <h1 className="m-0 text-[28px] font-semibold tracking-[-0.01em]">Style</h1>
        <span className="text-sm text-text-2">
          Saved looks your agent follows. Pick one, write your own, or copy one from a video.
        </span>
      </div>

      <section aria-label="Copy a style from a video" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="style-url" className="mr-auto text-sm font-medium">
            Copy a style from a video
          </label>
          <span className="text-xs text-text-3">TikTok · Instagram Reels · YouTube</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[320px] flex-1">
            <Link2 size={16} strokeWidth={1.5} aria-hidden="true" className="absolute top-1/2 left-3 -translate-y-1/2 text-text-3" />
            <Input
              id="style-url"
              ref={input}
              aria-label="Video link"
              aria-invalid={!!urlError}
              placeholder="Paste a video link"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && study()}
              className="h-10 bg-background pl-9"
            />
          </div>
          <Button className="h-10" disabled={phase === 'running'} onClick={study}>
            Study video
          </Button>
        </div>
        {urlError && (
          <p role="alert" className="m-0 text-xs text-orange-light">
            {urlError}
          </p>
        )}
        <StudyBox />
        <span className="text-xs text-text-3">
          Frames are studied on your computer and deleted after. Tayang copies the look, not the footage
        </span>
      </section>

      <div className="flex flex-wrap items-start gap-6">
        <section aria-label="Library" className="flex min-w-0 flex-[999_1_440px] flex-col gap-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList variant="line" aria-label="Filter styles" className="h-10 w-full justify-start border-b border-border p-0">
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id} className="h-10 flex-none px-3 text-sm">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {syncing && (
            <p role="status" className="m-0 flex items-center gap-2 text-xs text-text-3">
              <Loader2 size={14} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />
              Updating built-in styles
            </p>
          )}
          {!syncing && offline && (
            <p className="m-0 text-xs text-text-3">
              {hasBuiltin ? 'Built-in styles are from your last sync' : 'Connect to the internet to load built-in styles'}
            </p>
          )}
          {shown.length === 0 && !syncing && <p className="m-0 text-sm text-text-3">Nothing here yet</p>}
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))' }}>
            {shown.map((s) => {
              const on = current?.id === s.id;
              const [bg, fg] = swatch(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSel(s.id)}
                  className={cn(
                    'flex flex-col gap-1 rounded-xl border p-2 text-left text-foreground',
                    on ? 'border-primary bg-card' : 'border-transparent bg-transparent',
                  )}
                >
                  <PreviewImage
                    src={s.previewUrl}
                    lazy
                    className="mb-1 aspect-[9/16] w-full rounded-md border border-[#333] object-cover"
                    fallback={
                      <div
                        data-testid="style-swatch"
                        className="mb-1 flex aspect-[9/16] flex-col justify-between rounded-md border border-[#333] p-3"
                        style={{ background: bg, color: fg }}
                      >
                        <span className="font-mono text-[9px] uppercase opacity-80">{s.source === 'builtin' ? 'Style' : s.source}</span>
                        <span className="text-xl leading-[1.02] font-extrabold tracking-[-0.02em]">{s.name}</span>
                      </div>
                    }
                  />
                  <span className="text-[13px] font-medium">{s.name}</span>
                  <span className="text-xs text-text-3">{sourceLabel(s)}</span>
                  {s.template && <span className="text-xs text-text-3">Starts from a working project</span>}
                </button>
              );
            })}
          </div>
        </section>
        {current && <Detail style={current} onChanged={() => setVersion((v) => v + 1)} />}
      </div>
    </div>
  );
}
