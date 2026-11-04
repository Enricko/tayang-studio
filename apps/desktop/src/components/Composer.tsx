import { useEffect, useRef, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { ArrowUp, Check, ChevronDown, File as FileIcon, Paperclip, Square, X, Zap } from 'lucide-react';
import type { AgentId, AgentInfo, MessagePart, Project } from '@tayang/shared';
import { AgentLogo } from '@/components/AgentLogo';
import { FrameChip } from '@/components/MessageList';
import { filterProjects, MentionMenu } from '@/components/MentionMenu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { AGENT_NAMES } from '@/lib/agents';
import { assetUrl, attachFile, detectAgents } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import { useApp } from '@/state/app';
import { autoOn, useChat } from '@/state/chat';

export const QUICK_CHIPS = ['Faster pace', 'Bigger text', 'Change colors', 'Add music', 'Make it 15s'];

const TOKEN = /(^|\s)@(\S*)$/;
const NONE: MessagePart[] = [];

type FilePart = Extract<MessagePart, { type: 'file' }>;

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface MentionRef {
  projectId: string;
  title: string;
}

function FileChip({ part, onRemove }: { part: FilePart; onRemove(): void }) {
  const image = part.mime.startsWith('image/');
  return (
    <span className="inline-flex h-8 max-w-60 items-center gap-2 rounded-sm border border-hairline bg-transparent pl-2 pr-1 text-xs text-text-2">
      {image ? (
        <img src={assetUrl(part.path)} alt={part.name} className="size-5 shrink-0 rounded-[4px] object-cover" />
      ) : (
        <FileIcon size={14} strokeWidth={1.5} className="shrink-0" aria-hidden="true" />
      )}
      <span className="truncate font-medium text-foreground">{part.name}</span>
      <span className="shrink-0 font-mono text-text-3">{fileSize(part.size)}</span>
      <button
        type="button"
        aria-label="Remove file"
        onClick={onRemove}
        className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center border-none bg-transparent p-0 text-text-3"
      >
        <X size={14} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </span>
  );
}

const AGENT_ORDER: AgentId[] = ['claude', 'opencode', 'codex', 'gemini'];

const TRIGGER =
  'inline-flex h-7 cursor-pointer items-center gap-1 rounded-sm border border-hairline bg-transparent px-2 text-xs font-medium text-[#D9D9D9] hover:bg-raised disabled:cursor-default disabled:opacity-50';

function AgentPicker({
  agent,
  disabled,
  onChange,
}: {
  agent: AgentId;
  disabled?: boolean;
  onChange(id: AgentId): void;
}) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const load = (open: boolean) => {
    if (!open) return;
    detectAgents()
      .then(setAgents)
      .catch(() => {});
  };
  const listed = AGENT_ORDER.map((id) => agents.find((a) => a.id === id)).filter((a): a is AgentInfo => !!a);
  return (
    <DropdownMenu onOpenChange={load}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" disabled={disabled} className={TRIGGER}>
          <AgentLogo id={agent} size={14} />
          {AGENT_NAMES[agent]}
          <ChevronDown size={12} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-64 border-hairline bg-card">
        {listed.map((a) => (
          <DropdownMenuItem
            key={a.id}
            disabled={!a.installed}
            onSelect={() => onChange(a.id)}
            className="h-9 gap-2 text-[13px]"
          >
            <AgentLogo id={a.id} size={16} />
            <span className="font-medium">{AGENT_NAMES[a.id]}</span>
            <span className="ml-auto font-mono text-[11px] text-text-3">
              {a.installed ? (a.version ?? '') : 'Not installed'}
            </span>
            {a.id === agent && <Check data-testid="agent-check" size={14} strokeWidth={1.5} aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => useApp.getState().navigate({ name: 'settings' })}
          className="h-9 text-[13px]"
        >
          Set up agents
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Composer({
  chatId,
  onSend,
  disabled,
  projects,
  mention = null,
  onMention,
  quickChips,
  sees,
  placeholder = 'Say what to change. Bahasa Indonesia is fine',
  mentionSignal = 0,
  onStop,
  agentId,
  onAgentChange,
  ensureChat,
  initialText,
}: {
  chatId: string | null;
  /** Resolve to false when sending failed: the draft is then kept. */
  onSend(parts: MessagePart[]): void | boolean | Promise<void | boolean>;
  disabled?: boolean;
  /** Videos the @ menu can list. Omit to turn the menu off. */
  projects?: Project[];
  mention?: MentionRef | null;
  onMention?(m: MentionRef | null): void;
  quickChips?: boolean;
  /** Project chat only: the title shown in "This chat sees ...". */
  sees?: string;
  placeholder?: string;
  /** Bump to open the @ menu from outside. */
  mentionSignal?: number;
  /** While the agent is working (`disabled`), show a Stop button that calls this. */
  onStop?(): void;
  /** The agent this chat talks to; defaults to the one picked in Settings. */
  agentId?: AgentId;
  /** Turns the agent button into a picker. Disabled while a turn runs. */
  onAgentChange?(id: AgentId): void;
  /** A new chat has no id until its first send: attaching creates it. */
  ensureChat?(): Promise<string>;
  /** Starts the box with this text (not sent). */
  initialText?: string;
}) {
  const defaultAgent = useApp((s) => s.settings?.defaultAgent ?? 'claude');
  const agent = agentId ?? defaultAgent;
  const settingsAuto = useApp((s) => s.settings?.autoMode ?? false);
  const auto = useChat((s) => autoOn(s, chatId, settingsAuto));
  const autoBusy = useChat((s) => !!chatId && !!s.autoBusy[chatId]);
  const attachments = useChat((s) => (chatId ? s.attachments[chatId] : undefined)) ?? NONE;
  const [text, setText] = useState(initialText ?? '');
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [active, setActive] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  const attachPaths = async (paths: string[]) => {
    if (paths.length === 0) return;
    setAttachError(null);
    try {
      const id = chatId ?? (await ensureChat?.());
      if (!id) return;
      for (const path of paths) {
        try {
          useChat.getState().attach(id, await attachFile(id, path));
        } catch (e) {
          setAttachError(errorText(e));
        }
      }
    } catch (e) {
      setAttachError(errorText(e));
    }
  };
  // Dropped paths arrive from the window, so the latest closure goes through a ref.
  const attachRef = useRef(attachPaths);
  attachRef.current = attachPaths;

  const pickFiles = async () => {
    try {
      const picked = await openDialog({ multiple: true, directory: false });
      if (!picked) return;
      await attachPaths(Array.isArray(picked) ? picked : [picked]);
    } catch (e) {
      setAttachError(errorText(e));
    }
  };

  useEffect(() => {
    let off: (() => void) | undefined;
    let gone = false;
    const over = (pos: { x: number; y: number }) => {
      const r = box.current?.getBoundingClientRect();
      if (!r) return false;
      const x = pos.x / window.devicePixelRatio;
      const y = pos.y / window.devicePixelRatio;
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    try {
      getCurrentWebview()
        .onDragDropEvent((e) => {
          const p = e.payload;
          if (p.type === 'leave') setDragging(false);
          else if (p.type === 'drop') {
            const hit = over(p.position);
            setDragging(false);
            if (hit && !disabledRef.current) void attachRef.current(p.paths);
          } else setDragging(over(p.position) && !disabledRef.current);
        })
        .then((fn) => (gone ? fn() : (off = fn)))
        .catch(() => {});
    } catch {
      /* not running inside Tauri */
    }
    return () => {
      gone = true;
      off?.();
    };
  }, []);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  useEffect(() => {
    if (mentionSignal > 0) {
      setText((t) => (t && !/\s$/.test(t) ? `${t} @` : `${t}@`));
      setDismissed(null);
      ref.current?.focus();
    }
  }, [mentionSignal]);

  const token = projects ? TOKEN.exec(text) : null;
  const matches = token && projects ? filterProjects(projects, token[2] ?? '') : [];
  const open = !!token && dismissed !== text;
  const current = matches.find((p) => p.id === active) ?? matches[0];

  const pick = (p: Project) => {
    onMention?.({ projectId: p.id, title: p.title });
    setText((t) => t.replace(TOKEN, '$1'));
    ref.current?.focus();
  };

  const canSend = !disabled && (text.trim().length > 0 || !!mention || attachments.length > 0);
  const sending = useRef(false);
  const send = async () => {
    if (!canSend || sending.current) return;
    const parts: MessagePart[] = [];
    if (text.trim()) parts.push({ type: 'text', text: text.trim() });
    if (mention) parts.push({ type: 'mention', ...mention });
    sending.current = true;
    const draft = text;
    setText('');
    try {
      // The prompt may run for the whole turn, so clear now and give the draft back on failure.
      if ((await onSend(parts)) === false) setText((t) => t || draft);
    } catch {
      setText((t) => t || draft);
    } finally {
      sending.current = false;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (open && matches.length > 0) {
      const i = Math.max(0, matches.findIndex((p) => p.id === current?.id));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = matches.length;
        setActive(matches[(i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n]!.id);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (current) pick(current);
        return;
      }
    }
    if (open && e.key === 'Escape') {
      e.preventDefault();
      setDismissed(text);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (open) setDismissed(text);
      else void send();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {quickChips && (
        <div className="flex flex-wrap gap-2">
          {QUICK_CHIPS.map((q) => (
            <button
              key={q}
              type="button"
              disabled={disabled}
              onClick={() => void onSend([{ type: 'text', text: q }])}
              className="h-8 cursor-pointer rounded-full border border-hairline bg-transparent px-3 text-[13px] text-text-2 transition-colors hover:bg-raised hover:text-foreground disabled:cursor-default disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      )}
      <Popover open={open}>
        <PopoverAnchor asChild>
          <div
            ref={box}
            data-no-drag
            className={`flex flex-col gap-3 rounded-lg border bg-card p-3 transition-colors ${dragging ? 'border-primary' : 'border-hairline focus-within:border-[#3A3A3A]'}`}
          >
            {attachError && (
              <p role="alert" className="m-0 text-xs text-orange-light">
                {attachError}
              </p>
            )}
            {(mention || attachments.length > 0) && (
              <div className="flex flex-wrap gap-2">
                {mention && (
                  <span className="inline-flex h-6 items-center gap-1 rounded-sm border border-deep-orange bg-tint pl-2 pr-1 text-[13px] font-medium text-orange-light">
                    @{mention.title}
                    <button
                      type="button"
                      aria-label="Remove video"
                      onClick={() => onMention?.(null)}
                      className="inline-flex size-4 cursor-pointer items-center justify-center border-none bg-transparent p-0 text-orange-light"
                    >
                      <X size={12} strokeWidth={1.5} aria-hidden="true" />
                    </button>
                  </span>
                )}
                {attachments.map((a, i) =>
                  a.type === 'frame' ? (
                    <span key={i} className="inline-flex items-center gap-1">
                      <FrameChip part={a} />
                      <button
                        type="button"
                        aria-label="Remove frame"
                        onClick={() => chatId && useChat.getState().detach(chatId, i)}
                        className="inline-flex size-5 cursor-pointer items-center justify-center border-none bg-transparent p-0 text-text-3"
                      >
                        <X size={14} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    </span>
                  ) : a.type === 'file' ? (
                    <FileChip key={i} part={a} onRemove={() => chatId && useChat.getState().detach(chatId, i)} />
                  ) : null,
                )}
              </div>
            )}
            <label htmlFor="composer-message" className="sr-only">
              Message
            </label>
            <Textarea
              id="composer-message"
              ref={ref}
              rows={2}
              value={text}
              disabled={disabled}
              placeholder={placeholder}
              onChange={(e) => {
                setText(e.target.value);
                setActive('');
              }}
              onKeyDown={onKeyDown}
              className="min-h-12 resize-none rounded-none border-0 bg-transparent p-0 text-[14px] leading-[1.6] shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Attach files"
                disabled={disabled}
                onClick={() => void pickFiles()}
                className="inline-flex size-7 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent p-0 text-text-2 hover:text-foreground disabled:cursor-default disabled:opacity-50"
              >
                <Paperclip size={16} strokeWidth={1.5} aria-hidden="true" />
              </button>
              {onAgentChange ? (
                <AgentPicker agent={agent} disabled={disabled} onChange={onAgentChange} />
              ) : (
                <button type="button" className={TRIGGER}>
                  <AgentLogo id={agent} size={14} />
                  {AGENT_NAMES[agent]}
                  <ChevronDown size={12} strokeWidth={1.5} aria-hidden="true" />
                </button>
              )}
              {onAgentChange && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={auto}
                  aria-label="Auto"
                  title="Your agent runs commands without asking"
                  disabled={disabled || autoBusy}
                  onClick={() => void useChat.getState().setAuto(chatId, !auto)}
                  className={cn(
                    'inline-flex h-7 cursor-pointer items-center gap-1 rounded-sm border-none px-2 text-xs font-medium disabled:cursor-default disabled:opacity-50',
                    auto ? 'bg-tint text-orange-light' : 'bg-transparent text-text-2 hover:text-foreground',
                  )}
                >
                  <Zap size={14} strokeWidth={1.5} aria-hidden="true" />
                  Auto
                </button>
              )}
              {projects && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setText((t) => (t && !/\s$/.test(t) ? `${t} @` : `${t}@`));
                    setDismissed(null);
                    ref.current?.focus();
                  }}
                  className="h-7 cursor-pointer rounded-sm border-none bg-transparent px-2 text-xs font-medium text-text-2 hover:text-foreground"
                >
                  @ Mention a video
                </button>
              )}
              {sees && <span className="truncate text-xs text-text-3">This chat sees {sees}</span>}
              {disabled && onStop ? (
                <button
                  type="button"
                  aria-label="Stop"
                  onClick={onStop}
                  className="ml-auto inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-hairline bg-raised text-foreground transition-colors hover:bg-[#333333]"
                >
                  <Square size={12} strokeWidth={1.5} fill="currentColor" aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="Send"
                  disabled={!canSend}
                  onClick={() => void send()}
                  className="ml-auto inline-flex size-8 cursor-pointer items-center justify-center rounded-md border-none bg-primary text-primary-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
                >
                  <ArrowUp size={16} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </PopoverAnchor>
        <PopoverContent
          side="top"
          align="start"
          className="w-[400px] border-hairline bg-card p-2"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <MentionMenu
            projects={matches}
            value={current?.id ?? ''}
            onValueChange={setActive}
            onPick={pick}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
