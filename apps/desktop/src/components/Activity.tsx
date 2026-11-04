import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, FileText, Globe, MessageSquare, Pencil, Search, SquareTerminal, Wrench, type LucideIcon } from 'lucide-react';
import type { MessagePart } from '@tayang/shared';
import { i18n } from '@/i18n';
import { localized } from '@/lib/stored';

export type ToolPart = Extract<MessagePart, { type: 'tool' }>;
export type ThoughtPart = Extract<MessagePart, { type: 'thought' }>;
export type ActivityItem = ToolPart | ThoughtPart;

/** Skill loading is plumbing: never shown, never counted. */
/** Tayang approved a command itself; it annotates the real tool call, so it is a note, not a tool. */
export const isAutoNote = (p: ToolPart) => p.toolCallId.startsWith('auto-');

export function isHiddenTool(p: ToolPart): boolean {
  return p.toolKind === 'switch_mode' || /^\s*(load skill|skill)\b/i.test(p.title);
}

type Group = 'thought' | 'execute' | 'edit' | 'read' | 'search' | 'fetch' | 'other';

function groupOf(p: ActivityItem): Group {
  if (p.type === 'thought') return 'thought';
  switch (p.toolKind) {
    case 'think':
      return 'thought';
    case 'execute':
    case 'read':
    case 'search':
    case 'fetch':
      return p.toolKind;
    case 'edit':
    case 'delete':
    case 'move':
      return 'edit';
    default:
      return 'other';
  }
}

/** Summary segments, in order; the first starts with a capital, the rest are lower-case. `failed` is kept apart. */
export function summarize(items: ActivityItem[]): { segments: string[]; failed: number } {
  const n: Record<Group, number> = { thought: 0, execute: 0, edit: 0, read: 0, search: 0, fetch: 0, other: 0 };
  let failed = 0;
  for (const it of items) {
    if (it.type === 'tool' && isAutoNote(it)) continue;
    n[groupOf(it)]++;
    if (it.type === 'tool' && it.status === 'failed') failed++;
  }
  const segments: string[] = [];
  const t = i18n.t;
  if (n.thought) segments.push(t('activity.thought', { count: n.thought }));
  if (n.execute) segments.push(t('activity.ran', { count: n.execute }));
  if (n.edit) segments.push(t('activity.edited', { count: n.edit }));
  if (n.read) segments.push(t('activity.read', { count: n.read }));
  if (n.search) segments.push(t('activity.searched', { count: n.search }));
  if (n.fetch) segments.push(t('activity.fetched', { count: n.fetch }));
  if (n.other) segments.push(t('activity.called', { count: n.other }));
  if (segments[0]) segments[0] = segments[0][0]!.toUpperCase() + segments[0].slice(1);
  return { segments, failed };
}

const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const VERB = /^\s*(read|edit|write|update|delete|remove|move|rename|create|modify)\s+/i;

function fileName(p: ToolPart): string {
  if (p.path) return basename(p.path);
  const rest = p.title.replace(VERB, '').replace(/[`'"]/g, '').trim();
  return basename(rest.split(/\s+/)[0] ?? rest);
}

function command(p: ToolPart): string {
  return p.title.replace(/^\s*run\s+/i, '').replace(/^`+|`+$/g, '').trim();
}

const PulseDot = () => (
  <span aria-hidden="true" className="tayang-pulse inline-block size-1.5 shrink-0 rounded-full bg-primary" />
);

function FileChip({ name }: { name: string }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-sm bg-raised px-1.5 py-0.5 text-[12px] text-current">
      <FileText size={12} strokeWidth={1.5} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{name}</span>
    </span>
  );
}

interface Row {
  Icon: LucideIcon;
  verb: string;
  detail: React.ReactNode;
  /** One short line for the live tail of the summary. */
  label: string;
}

function rowOf(p: ToolPart): Row {
  const kind = p.toolKind;
  if (kind === 'execute') {
    const cmd = command(p);
    return {
      Icon: SquareTerminal,
      verb: i18n.t('activity.run'),
      detail: (
        <span title={cmd} className="min-w-0 truncate font-mono text-[12px]">
          {cmd}
        </span>
      ),
      label: `${i18n.t('activity.run')} ${cmd}`,
    };
  }
  if (kind === 'edit' || kind === 'delete' || kind === 'move') {
    const verb = i18n.t(kind === 'edit' ? 'activity.edit' : kind === 'delete' ? 'activity.delete' : 'activity.move');
    return { Icon: Pencil, verb, detail: <FileChip name={fileName(p)} />, label: `${verb} ${fileName(p)}` };
  }
  if (kind === 'read') return { Icon: FileText, verb: i18n.t('activity.read'), detail: <FileChip name={fileName(p)} />, label: `${i18n.t('activity.read')} ${fileName(p)}` };
  if (kind === 'search') {
    const q = p.title.replace(/^\s*search(ing)?\s*(for)?\s*/i, '').trim() || p.title;
    return { Icon: Search, verb: i18n.t('activity.search'), detail: <span className="min-w-0 truncate">{q}</span>, label: `${i18n.t('activity.search')} ${q}` };
  }
  if (kind === 'fetch') {
    const t = p.title.replace(/^\s*fetch(ing)?\s*/i, '').trim() || p.title;
    return { Icon: Globe, verb: i18n.t('activity.fetch'), detail: <span className="min-w-0 truncate">{t}</span>, label: `${i18n.t('activity.fetch')} ${t}` };
  }
  return { Icon: Wrench, verb: p.title, detail: null, label: p.title };
}

function ThoughtRow({ text }: { text: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <li className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-[13px] text-text-2 hover:text-foreground"
      >
        <MessageSquare size={16} strokeWidth={1.5} aria-hidden="true" />
        {t('activity.thoughtProcess')}
      </button>
      {open && (
        <p className="m-0 max-h-[216px] overflow-y-auto pl-6 text-[12px] leading-[1.5] whitespace-pre-wrap text-text-3">{text}</p>
      )}
    </li>
  );
}

function ToolRow({ part }: { part: ToolPart }) {
  if (part.toolKind === 'think') return <ThoughtRow text="" />;
  const { Icon, verb, detail } = rowOf(part);
  const failed = part.status === 'failed';
  const running = part.status === 'running' || part.status === 'pending';
  return (
    <li className={`flex min-w-0 items-center gap-2 text-[13px] ${failed ? 'text-error' : 'text-text-2'}`} data-status={part.status}>
      <Icon size={16} strokeWidth={1.5} className="shrink-0" aria-hidden="true" />
      <span className="shrink-0">{verb}</span>
      {detail}
      {running && <PulseDot />}
    </li>
  );
}

/** One run of tool calls and thoughts between text: a muted summary line that opens into a list. */
export function ActivityGroup({ items, live }: { items: ActivityItem[]; live: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const notes = items.filter((i): i is ToolPart => i.type === 'tool' && isAutoNote(i));
  const rows = items.filter((i) => !(i.type === 'tool' && isAutoNote(i)));
  const { segments, failed } = summarize(items);
  if (!segments.length && notes.length) segments.push(t('activity.ranWithoutAsking').replace(/^./, (c) => c.toUpperCase()));
  const running = live ? [...items].reverse().find((i): i is ToolPart => i.type === 'tool' && (i.status === 'running' || i.status === 'pending')) : undefined;
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex w-fit max-w-full cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-left text-[13px] text-text-3 hover:text-text-2"
      >
        <ChevronRight
          size={14}
          strokeWidth={1.5}
          aria-hidden="true"
          className={`shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
        />
        <span className="min-w-0 truncate">
          {segments.join(' · ')}
          {failed > 0 && (
            <>
              {segments.length > 0 && ' · '}
              <span className="text-error">{t('activity.failed', { count: failed })}</span>
            </>
          )}
          {running && (
            <>
              {' · '}
              <PulseDot /> {rowOf(running).label}
            </>
          )}
        </span>
      </button>
      {open && (
        <ul className="m-0 ml-[7px] flex list-none flex-col gap-2 border-l border-border py-1 pl-4">
          {rows.map((it, i) =>
            it.type === 'thought' ? <ThoughtRow key={i} text={it.text} /> : <ToolRow key={it.toolCallId} part={it} />,
          )}
          {notes.map((n) => (
            <li key={n.toolCallId} title={localized(n.title)} className="min-w-0 truncate font-mono text-[12px] text-text-3">
              {localized(n.title)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "● Working": shown while a reply has nothing else to show yet. */
export function WorkingLine() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-text-3">
      <PulseDot />
      {t('activity.working')}
    </span>
  );
}
