import { useState } from 'react';
import { ChevronRight, FileText, Globe, MessageSquare, Pencil, Search, SquareTerminal, Wrench, type LucideIcon } from 'lucide-react';
import type { MessagePart } from '@tayang/shared';

export type ToolPart = Extract<MessagePart, { type: 'tool' }>;
export type ThoughtPart = Extract<MessagePart, { type: 'thought' }>;
export type ActivityItem = ToolPart | ThoughtPart;

/** Skill loading is plumbing: never shown, never counted. */
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

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** Summary segments, in order; the first starts with a capital, the rest are lower-case. `failed` is kept apart. */
export function summarize(items: ActivityItem[]): { segments: string[]; failed: number } {
  const n: Record<Group, number> = { thought: 0, execute: 0, edit: 0, read: 0, search: 0, fetch: 0, other: 0 };
  let failed = 0;
  for (const it of items) {
    n[groupOf(it)]++;
    if (it.type === 'tool' && it.status === 'failed') failed++;
  }
  const segments: string[] = [];
  if (n.thought) segments.push(n.thought === 1 ? 'Thought process' : `Thought ${n.thought} times`);
  if (n.execute) segments.push(`Ran ${plural(n.execute, 'command', 'commands')}`);
  if (n.edit) segments.push(`edited ${plural(n.edit, 'file', 'files')}`);
  if (n.read) segments.push(`read ${plural(n.read, 'file', 'files')}`);
  if (n.search) segments.push(`searched ${plural(n.search, 'time', 'times')}`);
  if (n.fetch) segments.push(`fetched ${plural(n.fetch, 'page', 'pages')}`);
  if (n.other) segments.push(`called ${plural(n.other, 'tool', 'tools')}`);
  if (segments[0] && !segments[0][0]!.match(/[A-Z]/)) segments[0] = segments[0][0]!.toUpperCase() + segments[0].slice(1);
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
    <span className="inline-flex items-center gap-1 rounded-sm bg-raised px-1.5 py-0.5 text-[12px] text-foreground">
      <FileText size={12} strokeWidth={1.5} aria-hidden="true" />
      {name}
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
      verb: 'Run',
      detail: (
        <span title={cmd} className="min-w-0 truncate font-mono text-[12px]">
          {cmd}
        </span>
      ),
      label: `Run ${cmd}`,
    };
  }
  if (kind === 'edit' || kind === 'delete' || kind === 'move') {
    const verb = kind === 'edit' ? 'Edit' : kind === 'delete' ? 'Delete' : 'Move';
    return { Icon: Pencil, verb, detail: <FileChip name={fileName(p)} />, label: `${verb} ${fileName(p)}` };
  }
  if (kind === 'read') return { Icon: FileText, verb: 'Read', detail: <FileChip name={fileName(p)} />, label: `Read ${fileName(p)}` };
  if (kind === 'search') {
    const q = p.title.replace(/^\s*search(ing)?\s*(for)?\s*/i, '').trim() || p.title;
    return { Icon: Search, verb: 'Search', detail: <span className="min-w-0 truncate">{q}</span>, label: `Search ${q}` };
  }
  if (kind === 'fetch') {
    const t = p.title.replace(/^\s*fetch(ing)?\s*/i, '').trim() || p.title;
    return { Icon: Globe, verb: 'Fetch', detail: <span className="min-w-0 truncate">{t}</span>, label: `Fetch ${t}` };
  }
  return { Icon: Wrench, verb: p.title, detail: null, label: p.title };
}

function ThoughtRow({ text }: { text: string }) {
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
        Thought process
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
    <li className={`flex min-w-0 items-center gap-2 text-[13px] ${failed ? 'text-destructive' : 'text-text-2'}`} data-status={part.status}>
      <Icon size={16} strokeWidth={1.5} className="shrink-0" aria-hidden="true" />
      <span className="shrink-0">{verb}</span>
      {detail}
      {running && <PulseDot />}
    </li>
  );
}

/** One run of tool calls and thoughts between text: a muted summary line that opens into a list. */
export function ActivityGroup({ items, live }: { items: ActivityItem[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const { segments, failed } = summarize(items);
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
              <span className="text-destructive">{failed} failed</span>
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
          {items.map((it, i) =>
            it.type === 'thought' ? <ThoughtRow key={i} text={it.text} /> : <ToolRow key={it.toolCallId} part={it} />,
          )}
        </ul>
      )}
    </div>
  );
}

/** "● Working": shown while a reply has nothing else to show yet. */
export function WorkingLine() {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-text-3">
      <PulseDot />
      Working
    </span>
  );
}
