import { Fragment, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  Check,
  Clock,
  Info,
  Lightbulb,
  Mail,
  Search,
  Settings,
  Star,
  type LucideIcon,
} from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { i18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { getAt, setAt } from './pointer';
import type { A2uiComponent, Surface } from './surface';

/** What a Button's event action reports, plus the readable line the chat shows. */
export interface A2uiAction {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  timestamp: string;
  context: Record<string, unknown>;
  /** "Picked: Kenapa rupiah melemah?" */
  summary: string;
}

const MAX_DEPTH = 24;
/** Most nodes one surface render may produce; keeps cycles and repeated children cheap. */
const NODE_BUDGET = 500;

const ICONS: Record<string, LucideIcon> = {
  check: Check,
  info: Info,
  warning: AlertCircle,
  error: AlertCircle,
  idea: Lightbulb,
  lightbulb: Lightbulb,
  star: Star,
  search: Search,
  mail: Mail,
  settings: Settings,
  calendar: Calendar,
  clock: Clock,
  arrowForward: ArrowRight,
  arrowRight: ArrowRight,
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isBinding = (v: unknown): v is { path: string } => isObj(v) && typeof v.path === 'string';

/** Paths without a leading slash are relative to the template item being rendered. */
const absPath = (path: string, base: string) => (path.startsWith('/') ? path : `${base}/${path}`.replace(/\/+/g, '/'));

/** The API origins the app's CSP `img-src`/`media-src` allow (tauri.conf.json); keep the two in step. */
export const API_IMAGE_ORIGINS = ['https://studio.tayang.app', 'http://localhost:8787', 'http://127.0.0.1:8787'];
/** The API owns only this path on those origins; other studio.tayang.app pages are not ours to embed. */
const API_PATH_PREFIX = '/api/';

/** Image URLs the agent may show: the app's own asset protocol, or the Tayang API. Nothing else loads. */
export function safeImageUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    if (u.protocol === 'asset:') return url;
    if (u.protocol === 'http:' && u.hostname === 'asset.localhost') return url;
    // `pathname` is already normalised: `/api/../x` and `/api/%2e%2e/x` come out as `/x`.
    if (API_IMAGE_ORIGINS.includes(u.origin) && u.pathname.startsWith(API_PATH_PREFIX)) return url;
  } catch {
    /* not a URL */
  }
  return null;
}

interface Ctx {
  surface: Surface;
  data: unknown;
  setData: (path: string, value: unknown) => void;
  disabled: boolean;
  fire: (component: A2uiComponent, base: string) => void;
  budget: { used: number; over: boolean };
}

const stringOf = (v: unknown): string => (v === undefined || v === null ? '' : typeof v === 'string' ? v : String(v));

function resolve(ctx: Ctx, v: unknown, base: string): unknown {
  return isBinding(v) ? getAt(ctx.data, absPath(v.path, base)) : v;
}

const TEXT_VARIANTS: Record<string, string> = {
  h1: 'text-[24px] font-semibold leading-tight',
  h2: 'text-[20px] font-semibold leading-tight',
  h3: 'text-[17px] font-semibold leading-snug',
  h4: 'text-[15px] font-semibold leading-snug',
  h5: 'text-[14px] font-semibold leading-snug',
  body: 'text-[14px] leading-[1.6] text-[#D9D9D9]',
  caption: 'text-[12px] leading-snug text-text-3',
};

const JUSTIFY: Record<string, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  spaceBetween: 'justify-between',
  spaceAround: 'justify-around',
  spaceEvenly: 'justify-evenly',
};
const ALIGN: Record<string, string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
};

/** Child ids of a container, with the base path each one renders under. */
function childList(ctx: Ctx, c: A2uiComponent, base: string): { id: string; base: string }[] {
  const ch = c.children;
  if (Array.isArray(ch)) return ch.filter((x): x is string => typeof x === 'string').map((id) => ({ id, base }));
  if (isObj(ch) && typeof ch.componentId === 'string' && typeof ch.path === 'string') {
    const path = absPath(ch.path, base);
    const items = getAt(ctx.data, path);
    if (!Array.isArray(items)) return [];
    return items.map((_, i) => ({ id: ch.componentId as string, base: `${path}/${i}` }));
  }
  return [];
}

function optionList(v: unknown): { label: string; value: string }[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((o) =>
    isObj(o) && o.value !== undefined ? [{ label: stringOf(o.label ?? o.value), value: stringOf(o.value) }] : [],
  );
}

/** A plain function (not a component) so the node budget is counted once per surface render. */
function renderNode(id: string, base: string, ctx: Ctx, anc: string[]): ReactNode {
  const c = ctx.surface.components[id];
  if (!c || anc.length > MAX_DEPTH || anc.includes(id)) return null;
  if (ctx.budget.used >= NODE_BUDGET) {
    ctx.budget.over = true;
    return null;
  }
  ctx.budget.used++;
  const chain = [...anc, id];
  const sub = (cid: unknown, b = base) =>
    typeof cid === 'string' ? <Fragment key={`${cid}@${b}`}>{renderNode(cid, b, ctx, chain)}</Fragment> : null;
  const text = (v: unknown) => stringOf(resolve(ctx, v, base));
  const bindPath = (v: unknown) => (isBinding(v) ? absPath(v.path, base) : null);

  switch (c.component) {
    case 'Card':
      return <div className="rounded-lg border border-border bg-card p-4">{sub(c.child)}</div>;
    case 'Column':
    case 'Row':
    case 'List': {
      const row = c.component === 'Row';
      return (
        <div
          className={cn(
            'flex gap-3',
            row ? 'flex-row flex-wrap' : 'flex-col',
            c.component === 'List' && 'gap-2',
            JUSTIFY[stringOf(c.justify)],
            ALIGN[stringOf(c.align)],
          )}
        >
          {childList(ctx, c, base).map((ch) => sub(ch.id, ch.base))}
        </div>
      );
    }
    case 'Text': {
      const v = stringOf(c.variant) in TEXT_VARIANTS ? stringOf(c.variant) : 'body';
      const Tag = (/^h[1-5]$/.test(v) ? v : 'p') as 'p';
      return <Tag className={cn('m-0 whitespace-pre-wrap', TEXT_VARIANTS[v])}>{text(c.text)}</Tag>;
    }
    case 'Image': {
      const src = safeImageUrl(resolve(ctx, c.url, base));
      if (!src) return null;
      const fit = stringOf(c.fit);
      return (
        <img
          src={src}
          alt=""
          className={cn('max-h-64 w-full rounded-md', fit === 'cover' ? 'object-cover' : 'object-contain')}
        />
      );
    }
    case 'Icon': {
      const Icon = ICONS[stringOf(resolve(ctx, c.name, base))];
      return Icon ? <Icon size={18} strokeWidth={1.5} aria-hidden="true" /> : null;
    }
    case 'Divider':
      return <Separator orientation={c.axis === 'vertical' ? 'vertical' : 'horizontal'} />;
    case 'Button': {
      const primary = c.variant === 'primary';
      return (
        <Button
          type="button"
          variant={primary ? 'default' : 'secondary'}
          disabled={ctx.disabled}
          onClick={() => ctx.fire(c, base)}
          className="h-auto min-h-9 justify-start whitespace-normal text-left [&_p]:text-inherit [&_p]:text-[14px]"
        >
          {sub(c.child)}
        </Button>
      );
    }
    case 'ChoicePicker': {
      const path = bindPath(c.selections);
      const options = optionList(resolve(ctx, c.options, base));
      const raw = path ? getAt(ctx.data, path) : resolve(ctx, c.selections, base);
      const selected = Array.isArray(raw) ? raw.map(stringOf) : [];
      const max = typeof c.maxAllowedSelections === 'number' ? c.maxAllowedSelections : undefined;
      const set = (next: string[]) => path && ctx.setData(path, next);
      const label = c.label ? text(c.label) : null;
      if (max === 1) {
        return (
          <div className="flex flex-col gap-2">
            {label && <span className="text-[13px] font-medium">{label}</span>}
            <RadioGroup value={selected[0] ?? ''} onValueChange={(v) => set([v])} disabled={ctx.disabled}>
              {options.map((o) => (
                <label key={o.value} className="flex items-center gap-2 text-[14px]">
                  <RadioGroupItem value={o.value} aria-label={o.label} />
                  {o.label}
                </label>
              ))}
            </RadioGroup>
          </div>
        );
      }
      return (
        <div className="flex flex-col gap-2">
          {label && <span className="text-[13px] font-medium">{label}</span>}
          <div className="flex flex-wrap gap-2">
            {options.map((o) => {
              const on = selected.includes(o.value);
              return (
                <Button
                  key={o.value}
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-pressed={on}
                  disabled={ctx.disabled}
                  className={cn(on && 'border-deep-orange bg-tint text-orange-light hover:bg-tint')}
                  onClick={() => {
                    if (on) set(selected.filter((x) => x !== o.value));
                    else if (max === undefined || selected.length < max) set([...selected, o.value]);
                  }}
                >
                  {o.label}
                </Button>
              );
            })}
          </div>
        </div>
      );
    }
    case 'TextField': {
      const path = bindPath(c.value);
      const value = stringOf(resolve(ctx, c.value, base));
      const type = stringOf(c.textFieldType);
      const label = text(c.label);
      const onChange = (v: string) => path && ctx.setData(path, type === 'number' && v !== '' && !isNaN(Number(v)) ? Number(v) : v);
      return (
        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
          {label}
          {type === 'longText' ? (
            <Textarea value={value} disabled={ctx.disabled} onChange={(e) => onChange(e.target.value)} />
          ) : (
            <Input
              type={type === 'number' ? 'number' : type === 'obscured' ? 'password' : 'text'}
              value={value}
              disabled={ctx.disabled}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </label>
      );
    }
    case 'CheckBox': {
      const path = bindPath(c.value);
      return (
        <label className="flex items-center gap-2 text-[14px]">
          <Checkbox
            checked={resolve(ctx, c.value, base) === true}
            disabled={ctx.disabled}
            onCheckedChange={(v) => path && ctx.setData(path, v === true)}
          />
          {text(c.label)}
        </label>
      );
    }
    case 'Slider': {
      const path = bindPath(c.value);
      const min = typeof c.minValue === 'number' ? c.minValue : 0;
      const max = typeof c.maxValue === 'number' ? c.maxValue : 100;
      const n = Number(resolve(ctx, c.value, base));
      const value = Number.isFinite(n) ? n : min;
      return (
        <div className="flex flex-col gap-1.5">
          {c.label ? <span className="text-[13px] font-medium">{text(c.label)}</span> : null}
          <div className="flex items-center gap-3">
            <Slider
              min={min}
              max={max}
              value={[value]}
              disabled={ctx.disabled}
              aria-label={c.label ? text(c.label) : i18n.t('a2ui.value')}
              onValueChange={([v]) => path && v !== undefined && ctx.setData(path, v)}
            />
            <span className="w-10 text-right font-mono text-[12px] text-text-2">{value}</span>
          </div>
        </div>
      );
    }
    case 'Tabs': {
      const items = Array.isArray(c.tabItems) ? c.tabItems.filter(isObj) : [];
      if (!items.length) return null;
      return (
        <Tabs defaultValue="0">
          <TabsList>
            {items.map((t, i) => (
              <TabsTrigger key={i} value={String(i)}>
                {text(t.title)}
              </TabsTrigger>
            ))}
          </TabsList>
          {items.map((t, i) => (
            <TabsContent key={i} value={String(i)}>
              {sub(t.child)}
            </TabsContent>
          ))}
        </Tabs>
      );
    }
    default:
      return <p className="m-0 text-[13px] text-text-3">{i18n.t('a2ui.unsupported')}</p>;
  }
}

/** The readable line for an action: its `title` (a picked topic), the chosen option labels, else the button's label. */
function summarize(ctx: Ctx, button: A2uiComponent, base: string, context: Record<string, unknown>): string {
  const title = typeof context.title === 'string' ? context.title.trim() : '';
  if (title) return i18n.t('a2ui.picked', { what: title });
  const labels: string[] = [];
  // Only pickers the button's own context reads count as its choice.
  const ev = (button.action as { event?: { context?: unknown } } | undefined)?.event;
  const bound = new Set<string>();
  if (isObj(ev?.context)) for (const v of Object.values(ev.context)) if (isBinding(v)) bound.add(absPath(v.path, base));
  for (const c of Object.values(ctx.surface.components)) {
    if (c.component !== 'ChoicePicker' || !isBinding(c.selections) || !bound.has(absPath(c.selections.path, base))) continue;
    const sel = getAt(ctx.data, absPath(c.selections.path, base));
    if (!Array.isArray(sel)) continue;
    const options = optionList(c.options);
    for (const v of sel) labels.push(options.find((o) => o.value === stringOf(v))?.label ?? stringOf(v));
  }
  if (labels.length) return i18n.t('a2ui.picked', { what: labels.join(', ') });
  const child = typeof button.child === 'string' ? ctx.surface.components[button.child] : undefined;
  const label = child ? stringOf(resolve(ctx, child.text, base)) : '';
  return label ? i18n.t('a2ui.picked', { what: label }) : i18n.t('a2ui.sentReply');
}

export function A2uiSurface({
  surface,
  onAction,
  disabled = false,
  locked = false,
}: {
  surface: Surface;
  onAction: (action: A2uiAction) => void;
  /** The surface was answered; inputs stay visible but can't be changed. */
  disabled?: boolean;
  /** Not now: the agent is still replying or the screen is busy. Same look as answered, without the mark. */
  locked?: boolean;
}) {
  const [data, setDataState] = useState<unknown>(surface.data);
  const [confirmUrl, setConfirmUrl] = useState<string | null>(null);

  const ctx: Ctx = {
    budget: { used: 0, over: false },
    surface,
    data,
    disabled: disabled || locked,
    setData: (path, value) => setDataState((d: unknown) => setAt(d, path, value)),
    fire(c, base) {
      if (disabled || locked) return;
      const action = c.action;
      if (!isObj(action)) return;
      if (isObj(action.functionCall)) {
        const { call, args } = action.functionCall as { call?: unknown; args?: unknown };
        const url = call === 'openUrl' && isObj(args) ? resolve(ctx, args.url, base) : null;
        if (typeof url === 'string' && /^https:\/\//i.test(url)) setConfirmUrl(url);
        return;
      }
      const ev = isObj(action.event) ? action.event : null;
      if (!ev || typeof ev.name !== 'string') return;
      const context: Record<string, unknown> = {};
      if (isObj(ev.context)) for (const [k, v] of Object.entries(ev.context)) context[k] = resolve(ctx, v, base);
      onAction({
        name: ev.name,
        surfaceId: surface.surfaceId,
        sourceComponentId: c.id,
        timestamp: new Date().toISOString(),
        context,
        summary: summarize(ctx, c, base, context),
      });
    },
  };

  if (!surface.components.root) return null;
  return (
    <div data-testid="a2ui-surface" data-answered={disabled || undefined} className="flex max-w-[520px] flex-col gap-3">
      {renderNode('root', '', ctx, [])}
      {ctx.budget.over && <p className="m-0 text-[12px] text-text-3">{i18n.t('a2ui.truncated')}</p>}
      <Dialog open={confirmUrl !== null} onOpenChange={(o) => !o && setConfirmUrl(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{i18n.t('a2ui.openLinkTitle')}</DialogTitle>
            <DialogDescription className="break-all font-mono">{confirmUrl}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmUrl(null)}>
              {i18n.t('common.cancel')}
            </Button>
            <Button
              onClick={() => {
                const url = confirmUrl;
                setConfirmUrl(null);
                if (url) void openUrl(url).catch(() => {});
              }}
            >
              {i18n.t('a2ui.openLink')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
