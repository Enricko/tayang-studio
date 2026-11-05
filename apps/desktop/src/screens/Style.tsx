import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, Loader2, Pause, Play } from 'lucide-react';
import type { Style as StyleT, StyleAspect } from '@tayang/shared';
import { Button } from '@/components/Button';
import { NoPreview } from '@/components/NoPreview';
import { Oyen } from '@/components/Oyen';
import { PermissionCard } from '@/components/PermissionCard';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { i18n } from '@/i18n';
import { localized } from '@/lib/stored';
import { posterOf, youtubeThumbnail } from '@/lib/styleInfo';
import { assetUrl, deleteStyle, listStyles, saveStyle, syncStyles } from '@/lib/ipc';
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

const ASPECTS: StyleAspect[] = ['camera', 'pacing', 'type', 'color', 'captions', 'transitions'];

type Tab = 'all' | 'builtin' | 'copied' | 'mine';
const TABS: Tab[] = ['all', 'builtin', 'copied', 'mine'];

export { posterOf, youtubeThumbnail };

/** The calm panel shown when a style has no picture at all. */
function StyleNoPreview({ id, text, className }: { id: string; text?: boolean; className?: string }) {
  const { t } = useTranslation();
  return (
    <NoPreview swatchId={id} data-testid="style-swatch" className={className}>
      {text ? t('style.noPreview') : null}
    </NoPreview>
  );
}

const ENGINE_LABEL = {
  remotion: 'Remotion',
  hyperframes: 'HyperFrames',
} as const;

function sourceLabel(s: StyleT): string {
  if (s.source === 'builtin') return i18n.t('style.builtIn');
  if (s.source === 'copied') {
    let host = '';
    try {
      host = s.sourceUrl ? new URL(s.sourceUrl).hostname.replace(/^www\./, '') : '';
    } catch {
      /* a link that doesn't parse shows no host */
    }
    return host ? i18n.t('style.copiedFrom', { host }) : i18n.t('style.copied');
  }
  return i18n.t('style.yours');
}

function StudyBox() {
  const { t } = useTranslation();
  const study = useStudy();
  const agent = useApp((s) => s.settings?.defaultAgent) ?? 'claude';
  const steps = (['downloaded', 'frames', 'reading', 'writing', 'preview'] as const).map((k) => t(`style.studySteps.${k}`));
  const active = study.phase === 'finishing' ? steps.length - 1 : Math.min(study.toolCalls, steps.length - 2);

  if (study.phase === 'idle') return null;
  if (study.phase === 'failed')
    return (
      <div role="alert" className="flex items-start gap-3 rounded-md border border-border bg-background p-3">
        <Oyen mood="surprised" size={32} />
        <div className="flex flex-1 flex-col gap-2">
          <span className="text-[13px] font-medium">{t('style.couldntCopy')}</span>
          <span className="text-xs text-text-2">{study.error}</span>
          <Button variant="secondary" className="h-8 self-start px-3 text-[13px]" onClick={study.dismiss}>
            {t('style.dismiss')}
          </Button>
        </div>
      </div>
    );
  if (study.phase === 'done')
    return (
      <div className="flex items-center gap-3 rounded-md border border-border bg-background p-3">
        <Oyen mood="happy" size={32} />
        <span className="mr-auto text-[13px] font-medium">{t('style.saved')}</span>
        <Button variant="ghost" className="h-8 px-2 text-[13px]" onClick={study.dismiss}>
          {t('style.dismiss')}
        </Button>
      </div>
    );
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-background p-3">
      <div className="flex items-start gap-3">
        <Oyen mood="sleepy" size={32} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium">{t('style.studying')}</span>
            <span className="truncate font-mono text-xs text-text-3">{study.url.replace(/^https?:\/\//, '')}</span>
            {study.phase === 'running' && (
              <Button variant="ghost" className="ml-auto h-7 px-2 text-xs" onClick={() => void study.cancel()}>
                {t('common.cancel')}
              </Button>
            )}
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
        <ul aria-label={t('style.ranAria')} className="m-0 flex list-none flex-col gap-1 p-0">
          {study.ranLog.slice(-4).map((line, i) => (
            <li key={`${study.ranLog.length}-${i}`} className="truncate font-mono text-xs text-text-3" title={localized(line)}>
              {localized(line)}
            </li>
          ))}
        </ul>
      )}
      {study.request && (
        <PermissionCard
          request={study.request}
          ask={t('style.studyAsk')}
          agentId={agent}
          allowLabel={t('permission.allow')}
          onRespond={(id) => void study.respond(id)}
        />
      )}
    </div>
  );
}

/** The style's preview image; the swatch when it has none or the image can't load (offline). */
export function PreviewImage({
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

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const VIDEO_TIMEOUT_MS = 5000;

/**
 * The popup's media: the image (or swatch frames) is a layer under the muted looping video until the video has
 * data; the image alone shows when there is no clip, it errors, or it has no data after 5 s.
 */
function StylePreview({ style }: { style: StyleT }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);
  const [reduced] = useState(prefersReducedMotion);
  const video = useRef<HTMLVideoElement>(null);
  const src = style.previewVideoUrl;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  /** No data 5 s after playback was requested (blocked, offline, stalled): show the image instead of a black box. */
  const armTimer = () => {
    cancelTimer();
    if (!src || loadedRef.current) return;
    timer.current = setTimeout(() => {
      if (!loadedRef.current) setFailed(src);
    }, VIDEO_TIMEOUT_MS);
  };
  useEffect(() => {
    loadedRef.current = false;
    setLoaded(false);
    setPlaying(false);
    // Autoplay is the only thing the deadline covers: with reduced motion nothing was requested yet.
    if (!reduced) armTimer();
    return cancelTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Closing the popup pauses and unloads the clip so nothing keeps downloading. (A new clip remounts this
  // component, see the key where it is used, so this never strips a newer src.) React StrictMode runs this
  // cleanup once right after mount in development; the setup puts the clip back so the preview still plays.
  useEffect(() => {
    const el = video.current;
    if (el && src && !el.getAttribute('src')) {
      el.setAttribute('src', src);
      el.load();
    }
    return () => {
      if (!el) return;
      el.pause();
      el.removeAttribute('src');
      el.load();
    };
  }, []);

  const poster = posterOf(style);
  const frames = <StyleNoPreview id={style.id} text className="max-h-[60vh]" />;
  if (!src || failed === src) {
    return (
      <PreviewImage
        src={poster}
        className="aspect-[9/16] max-h-[60vh] w-full rounded-md border border-[#333] bg-black object-cover"
        fallback={frames}
      />
    );
  }

  const toggle = () => {
    const el = video.current;
    if (!el) return;
    if (el.paused) {
      armTimer(); // the user asked to play: give it 5 s from now
      void Promise.resolve(el.play()).catch(() => {});
    } else {
      cancelTimer();
      el.pause();
    }
  };
  return (
    <div className="relative mx-auto aspect-[9/16] max-h-[60vh] w-full max-w-[320px] overflow-hidden rounded-md border border-[#333] bg-black">
      <video
        ref={video}
        src={src}
        poster={poster ?? undefined}
        autoPlay={!reduced}
        muted
        loop
        playsInline
        preload="auto"
        aria-label={t('style.previewAria', { name: style.name })}
        className="size-full object-cover"
        onLoadedData={() => {
          loadedRef.current = true;
          cancelTimer();
          setLoaded(true);
        }}
        onPlaying={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => setFailed(src)}
      />
      {!loaded && (
        <div data-testid="preview-poster" className="pointer-events-none absolute inset-0 flex items-center bg-black">
          <PreviewImage src={poster} className="size-full object-cover" fallback={frames} />
        </div>
      )}
      <button
        type="button"
        aria-label={playing ? t('style.pausePreview') : t('style.playPreview')}
        onClick={toggle}
        className="absolute right-2 bottom-2 flex size-8 items-center justify-center rounded-full bg-black/60 text-foreground hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {playing ? <Pause size={16} strokeWidth={1.5} aria-hidden="true" /> : <Play size={16} strokeWidth={1.5} aria-hidden="true" />}
      </button>
    </div>
  );
}

type NotesDraft = Record<StyleAspect, string>;
const draftOf = (s: StyleT): NotesDraft =>
  Object.fromEntries(ASPECTS.map((a) => [a, s.notes[a] ?? ''])) as NotesDraft;

/** A textarea that grows with its text. */
function AutoTextarea({ value, ...props }: React.ComponentProps<typeof Textarea>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return <Textarea ref={ref} value={value} rows={1} {...props} />;
}

function Detail({
  style,
  startInEdit,
  onChanged,
  onDeleted,
  onDirty,
  onClone,
  onEditStarted,
  onRestudy,
}: {
  style: StyleT;
  /** A study of this style's source started again: the popup closes so the study box shows its progress. */
  onRestudy(): void;
  startInEdit: boolean;
  onChanged(): void;
  onDeleted(id: string): void;
  onDirty(dirty: boolean): void;
  onClone(clone: StyleT): Promise<void>;
  onEditStarted(): void;
}) {
  const { t } = useTranslation();
  const navigate = useApp((s) => s.navigate);
  const [editing, setEditing] = useState(startInEdit);
  const [name, setName] = useState(style.name);
  const [notes, setNotes] = useState<NotesDraft>(() => draftOf(style));
  const [prompt, setPrompt] = useState(style.prompt);
  const [error, setError] = useState<string | null>(null);
  const builtin = style.source === 'builtin';
  const studyBusy = useStudy((s) => s.phase === 'running' || s.phase === 'finishing');

  const reset = () => {
    setName(style.name);
    setNotes(draftOf(style));
    setPrompt(style.prompt);
    setError(null);
  };
  // A fresh clone opens in edit mode once; the parent forgets it right away.
  useEffect(() => {
    if (startInEdit) onEditStarted();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const original = draftOf(style);
  const dirty =
    editing && (name !== style.name || prompt !== style.prompt || ASPECTS.some((a) => notes[a] !== original[a]));
  // The stored style changed (a sync, another save): follow it, but never over unsaved edits.
  const storedKey = JSON.stringify([style.name, style.prompt, style.notes]);
  useEffect(() => {
    if (!dirty) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey]);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
    // onDirty only sets state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  const save = async () => {
    if (!name.trim() || !prompt.trim()) return;
    try {
      const kept: StyleT['notes'] = {};
      for (const a of ASPECTS) if (notes[a].trim()) kept[a] = notes[a].trim();
      await saveStyle({ ...style, name: name.trim(), notes: kept, prompt: prompt.trim() });
      setEditing(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const [cloning, setCloning] = useState(false);
  const clone = async () => {
    if (cloning) return;
    setCloning(true);
    try {
      await onClone({
        ...style,
        id: `mine-${Date.now().toString(36)}`,
        name: `${style.name} (${t('style.copySuffix')})`,
        source: 'mine',
        sourceUrl: null,
        createdAt: new Date().toISOString(),
        basedOn: style.id,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCloning(false);
    }
  };

  const remove = async () => {
    try {
      await deleteStyle(style.id);
      onDeleted(style.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Rust refuses while an autopilot uses the style, naming it.
      const inUse = /^style-in-use:([\s\S]+)$/.exec(message);
      setError(inUse ? t('style.inUse', { name: inUse[1]! }) : message);
    }
  };

  const shownNotes = ASPECTS.filter((a) => style.notes[a]);
  return (
    <div className="grid min-w-0 gap-6 sm:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
      <StylePreview key={style.previewVideoUrl ?? 'none'} style={style} />
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-1 pr-6">
          {editing ? (
            <>
              <DialogTitle className="sr-only">{style.name}</DialogTitle>
              <Input aria-label={t('style.nameAria')} value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
            </>
          ) : (
            <DialogTitle className="text-base leading-normal font-medium">{style.name}</DialogTitle>
          )}
          <DialogDescription className="text-xs text-text-3">{sourceLabel(style)}</DialogDescription>
          {style.engine && <span className="font-mono text-xs text-text-3">{ENGINE_LABEL[style.engine]}</span>}
        </div>
        {editing ? (
          <div className="flex flex-col gap-3">
            {ASPECTS.map((a) => (
              <div key={a} className="flex flex-col gap-1">
                <label htmlFor={`style-note-${a}`} className="text-xs text-text-3">
                  {t(`style.aspects.${a}`)}
                </label>
                <AutoTextarea
                  id={`style-note-${a}`}
                  value={notes[a]}
                  onChange={(e) => setNotes((n) => ({ ...n, [a]: e.target.value }))}
                  className="min-h-9 resize-none bg-background py-2 text-[13px] leading-normal"
                />
              </div>
            ))}
          </div>
        ) : (
          shownNotes.length > 0 && (
            <dl className="m-0 flex flex-col gap-2">
              {shownNotes.map((a) => (
                <div key={a} className="flex gap-3 text-[13px] leading-normal">
                  <dt className="w-[76px] shrink-0 text-text-3">{t(`style.aspects.${a}`)}</dt>
                  <dd className="m-0 text-[#D9D9D9]">{style.notes[a]}</dd>
                </div>
              ))}
            </dl>
          )
        )}
        {!editing && style.build && (
          <div className="flex gap-3 text-[13px] leading-normal">
            <span className="w-[76px] shrink-0 text-text-3">{t('style.build')}</span>
            <span className="m-0 text-[#D9D9D9]">{style.build}</span>
          </div>
        )}
        {!editing && !!style.palette?.length && (
          <div className="flex items-center gap-3 text-[13px]">
            <span className="w-[76px] shrink-0 text-text-3">{t('style.palette')}</span>
            <span className="flex flex-wrap gap-1.5">
              {style.palette.map((c) => (
                <span
                  key={c}
                  role="img"
                  aria-label={c}
                  title={c}
                  className="size-5 rounded-sm border border-border"
                  style={{ background: c }}
                />
              ))}
            </span>
          </div>
        )}
        {!editing && !!style.references?.length && (
          <div className="flex flex-col gap-2">
            <span className="text-xs text-text-3">{t('style.references')}</span>
            <div className="grid grid-cols-3 gap-1.5">
              {style.references.map((r, i) => (
                <img
                  key={r}
                  src={assetUrl(r)}
                  alt={t('style.referenceAlt', { n: i + 1 })}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[9/16] w-full rounded-sm border border-border bg-black object-cover"
                />
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <label htmlFor="style-prompt" className="text-xs text-text-3">
            {t('style.promptLabel')}
          </label>
          {editing ? (
            <AutoTextarea
              id="style-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-h-[9rem] resize-none bg-background font-mono text-xs leading-[1.6]"
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
              <Button
                variant="secondary"
                className="h-9 px-3 text-[13px]"
                disabled={!name.trim() || !prompt.trim()}
                onClick={() => void save()}
              >
                {t('style.save')}
              </Button>
              <Button
                variant="ghost"
                className="h-9 px-3 text-[13px]"
                onClick={() => {
                  reset();
                  setEditing(false);
                }}
              >
                {t('common.cancel')}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="secondary"
                className="h-9 px-3 text-[13px]"
                onClick={() =>
                  navigate({ name: 'chat-new', styleId: style.id })
                }
              >
                {t('style.useInChat')}
              </Button>
              {builtin ? (
                <Button variant="ghost" className="h-9 px-3 text-[13px]" disabled={cloning} onClick={() => void clone()}>
                  {t('style.clone')}
                </Button>
              ) : (
                <Button variant="ghost" className="h-9 px-3 text-[13px]" onClick={() => setEditing(true)}>
                  {t('style.edit')}
                </Button>
              )}
              {style.source === 'copied' && style.sourceUrl && (
                <Button
                  variant="ghost"
                  className="h-9 px-3 text-[13px]"
                  title={t('style.studyAgainHint')}
                  disabled={studyBusy}
                  onClick={() => {
                    const agent = useApp.getState().settings?.defaultAgent ?? 'claude';
                    void useStudy.getState().start(style.sourceUrl!, agent, undefined, style.id);
                    onRestudy();
                  }}
                >
                  {t('style.studyAgain')}
                </Button>
              )}
              {!builtin && (
                <Button variant="ghost" className="h-9 px-3 text-[13px]" onClick={() => void remove()}>
                  {t('style.delete')}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function Style() {
  const { t } = useTranslation();
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
  const current = sel ? all.find((s) => s.id === sel) : undefined;
  const card = useRef<HTMLElement | null>(null);
  const library = useRef<HTMLElement>(null);
  const [dirty, setDirty] = useState(false);
  const [blocked, setBlocked] = useState(false);
  /** The clone that just opened: its popup starts in edit mode. */
  const [editNew, setEditNew] = useState<string | null>(null);
  /** After a delete, the card to focus once the list has updated (null: the library itself). */
  const refocus = useRef<{ id: string | null } | null>(null);
  useEffect(() => {
    if (!dirty) setBlocked(false);
  }, [dirty]);
  const applyRefocus = () => {
    const want = refocus.current;
    if (!want) return;
    const cards = [...(library.current?.querySelectorAll<HTMLElement>('[data-style-id]') ?? [])];
    const el = cards.find((c) => c.dataset.styleId === want.id) ?? null;
    if (want.id && !el) return; // the list has not caught up yet
    refocus.current = null;
    (el ?? library.current)?.focus();
  };
  useEffect(() => {
    if (!current) applyRefocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored, current]);

  const study = () => {
    if (!isVideoUrl(url)) {
      setUrlError(t('style.badLink'));
      return;
    }
    setUrlError(null);
    void startStudy(url.trim(), agent);
  };

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-8">
      <div data-tauri-drag-region className="flex flex-col gap-1">
        <h1 className="m-0 text-[28px] font-semibold tracking-[-0.01em]">{t('style.title')}</h1>
        <span className="text-sm text-text-2">{t('style.subtitle')}</span>
      </div>

      <section aria-label={t('style.copyTitle')} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="style-url" className="mr-auto text-sm font-medium">
            {t('style.copyTitle')}
          </label>
          <span className="text-xs text-text-3">{t('style.sites')}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[320px] flex-1">
            <Link2 size={16} strokeWidth={1.5} aria-hidden="true" className="absolute top-1/2 left-3 -translate-y-1/2 text-text-3" />
            <Input
              id="style-url"
              ref={input}
              aria-label={t('style.linkAria')}
              aria-invalid={!!urlError}
              placeholder={t('style.linkPlaceholder')}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && study()}
              className="h-10 bg-background pl-9"
            />
          </div>
          <Button className="h-10" disabled={phase === 'running' || phase === 'finishing'} onClick={study}>
            {t('style.studyVideo')}
          </Button>
        </div>
        {urlError && (
          <p role="alert" className="m-0 text-xs text-orange-light">
            {urlError}
          </p>
        )}
        <StudyBox />
        <span className="text-xs text-text-3">
          {t('style.privacy')}
        </span>
      </section>

      <div className="flex flex-col gap-6">
        <section ref={library} tabIndex={-1} aria-label={t('style.libraryAria')} className="flex min-w-0 flex-col gap-4 outline-none">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList variant="line" aria-label={t('style.filterAria')} className="h-10 w-full justify-start border-b border-border p-0">
              {TABS.map((id) => (
                <TabsTrigger key={id} value={id} className="h-10 flex-none px-3 text-sm">
                  {t(`style.tabs.${id}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {syncing && (
            <p role="status" className="m-0 flex items-center gap-2 text-xs text-text-3">
              <Loader2 size={14} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />
              {t('style.updating')}
            </p>
          )}
          {!syncing && offline && (
            <p className="m-0 text-xs text-text-3">
              {hasBuiltin ? t('style.fromLastSync') : t('style.goOnline')}
            </p>
          )}
          {shown.length === 0 && !syncing && <p className="m-0 text-sm text-text-3">{t('style.empty')}</p>}
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))',
            }}
          >
            {shown.map((s) => {
              return (
                <button
                  key={s.id}
                  data-style-id={s.id}
                  type="button"
                  aria-haspopup="dialog"
                  onClick={(e) => {
                    card.current = e.currentTarget;
                    setSel(s.id);
                  }}
                  className="flex flex-col gap-1 rounded-xl border border-transparent bg-transparent p-2 text-left text-foreground hover:border-border hover:bg-card focus-visible:border-primary focus-visible:outline-none"
                >
                  <PreviewImage
                    src={posterOf(s)}
                    lazy
                    className="mb-1 aspect-[9/16] w-full rounded-md border border-[#333] object-cover"
                    fallback={<StyleNoPreview id={s.id} className="mb-1" />}
                  />
                  <span className="text-[13px] font-medium">{s.name}</span>
                  <span className="text-xs text-text-3">{sourceLabel(s)}</span>
                  {s.template && <span className="text-xs text-text-3">{t('style.startsFromProject')}</span>}
                </button>
              );
            })}
          </div>
        </section>
      </div>
      <Dialog
        open={!!current}
        onOpenChange={(open) => {
          if (open) return;
          if (dirty) setBlocked(true);
          else setSel(null);
        }}
      >
        {current && (
          <DialogContent
            className="max-h-[90vh] overflow-y-auto p-5 sm:max-w-[720px]"
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              if (refocus.current) applyRefocus();
              else card.current?.focus();
            }}
          >
            <Detail
              key={current.id}
              style={current}
              startInEdit={editNew === current.id}
              onChanged={() => setVersion((v) => v + 1)}
              onDirty={setDirty}
              onEditStarted={() => setEditNew(null)}
              onRestudy={() => setSel(null)}
              onClone={async (clone) => {
                await saveStyle(clone);
                setStored((prev) => (prev.some((x) => x.id === clone.id) ? prev : [...prev, clone]));
                setEditNew(clone.id);
                setSel(clone.id);
                if (tab === 'builtin' || tab === 'copied') setTab('mine');
                setVersion((v) => v + 1);
              }}
              onDeleted={(id) => {
                const i = shown.findIndex((x) => x.id === id);
                const next = shown[i + 1] ?? shown[i - 1];
                refocus.current = { id: next?.id ?? null };
                card.current = null; // the deleted card is going away
                setSel(null);
                setVersion((v) => v + 1);
              }}
            />
            {blocked && dirty && (
              <p role="status" className="m-0 text-xs text-orange-light">
                {t('style.unsaved')}
              </p>
            )}
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
