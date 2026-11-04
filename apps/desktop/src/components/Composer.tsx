import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, X } from 'lucide-react';
import type { MessagePart, Project } from '@tayang/shared';
import { AgentLogo } from '@/components/AgentLogo';
import { FrameChip } from '@/components/MessageList';
import { filterProjects, MentionMenu } from '@/components/MentionMenu';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { AGENT_NAMES } from '@/lib/agents';
import { useApp } from '@/state/app';
import { useChat } from '@/state/chat';

export const QUICK_CHIPS = ['Faster pace', 'Bigger text', 'Change colors', 'Add music', 'Make it 15s'];

const TOKEN = /(^|\s)@(\S*)$/;
const NONE: MessagePart[] = [];

export interface MentionRef {
  projectId: string;
  title: string;
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
}) {
  const agent = useApp((s) => s.settings?.defaultAgent ?? 'claude');
  const attachments = useChat((s) => (chatId ? s.attachments[chatId] : undefined)) ?? NONE;
  const [text, setText] = useState('');
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [active, setActive] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

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

  const canSend = !disabled && (text.trim().length > 0 || !!mention);
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
          <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-card p-3">
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
              className="min-h-12 resize-none border-none bg-transparent p-0 text-[14px] leading-[1.6] shadow-none focus-visible:ring-0"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-sm border border-hairline bg-raised px-2 text-xs font-medium text-[#D9D9D9]"
              >
                <AgentLogo id={agent} size={14} />
                {AGENT_NAMES[agent]}
                <ChevronDown size={12} strokeWidth={1.5} aria-hidden="true" />
              </button>
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
              <button
                type="button"
                aria-label="Send"
                disabled={!canSend}
                onClick={() => void send()}
                className="ml-auto inline-flex size-8 cursor-pointer items-center justify-center rounded-md border-none bg-primary text-primary-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
              >
                <ArrowUp size={16} strokeWidth={2} aria-hidden="true" />
              </button>
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
