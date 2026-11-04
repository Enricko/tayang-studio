import { useEffect, useRef } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { formatTimecode, type ChatMessage, type MessagePart } from '@tayang/shared';
import { Oyen } from '@/components/Oyen';
import { AGENT_NAMES } from '@/lib/agents';
import { useApp } from '@/state/app';
import { cn } from '@/lib/utils';

type Tool = Extract<MessagePart, { type: 'tool' }>;

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-sm border border-deep-orange bg-tint px-2 text-[13px] font-medium text-orange-light">
      {children}
    </span>
  );
}

export function FrameChip({ part }: { part: Extract<MessagePart, { type: 'frame' }> }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-sm border border-hairline bg-raised px-2 py-1 text-xs text-text-2">
      <span className="font-medium text-foreground">Frame {formatTimecode(part.timeSec, 30)}</span>
      {part.marks.length > 0 && <span className="text-text-3">{part.marks.length} marked</span>}
    </span>
  );
}

function ActivityCard({ tools, working }: { tools: Tool[]; working: boolean }) {
  const agent = useApp((s) => s.settings?.defaultAgent ?? 'claude');
  const done = tools.filter((t) => t.status === 'done').length;
  const pct = tools.length ? Math.round((done / tools.length) * 100) : 0;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      <span className="text-[13px] font-medium">
        {working ? `${AGENT_NAMES[agent]} is working` : `${AGENT_NAMES[agent]} finished`}
      </span>
      <div className="h-1 overflow-hidden rounded-full bg-raised" aria-hidden="true">
        <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {tools.map((t) => (
          <li key={t.toolCallId} className="flex items-center gap-2 text-[13px] text-text-2">
            {t.status === 'done' ? (
              <Check size={14} strokeWidth={1.5} className="text-orange-light" aria-hidden="true" />
            ) : t.status === 'failed' ? (
              <X size={14} strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <Loader2 size={14} strokeWidth={1.5} className="animate-spin" aria-hidden="true" />
            )}
            {t.title}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Parts({ parts, working }: { parts: MessagePart[]; working: boolean }) {
  const tools = parts.filter((p): p is Tool => p.type === 'tool');
  return (
    <>
      {parts.map((p, i) => {
        if (p.type === 'text') {
          return (
            <p key={i} className="m-0 whitespace-pre-wrap text-[14px] leading-[1.6] text-[#D9D9D9]">
              {p.text}
            </p>
          );
        }
        if (p.type === 'mention') return <Chip key={i}>@{p.title}</Chip>;
        if (p.type === 'frame') return <FrameChip key={i} part={p} />;
        return null;
      })}
      {tools.length > 0 && <ActivityCard tools={tools} working={working} />}
    </>
  );
}

export function MessageList({
  messages,
  streaming,
  children,
}: {
  messages: ChatMessage[];
  streaming: boolean;
  /** Extra blocks under the conversation (permission card, idea cards). */
  children?: React.ReactNode;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [messages, streaming]);

  const last = messages[messages.length - 1];
  return (
    <div className="flex flex-col gap-6" role="log" aria-label="Conversation">
      {messages.map((m, i) => {
        if (m.role === 'user') {
          return (
            <div key={m.id} className="flex justify-end">
              <div className="flex max-w-[80%] flex-wrap items-center gap-2 rounded-lg bg-raised px-3 py-2 text-[14px] leading-[1.6]">
                {m.parts.map((p, j) =>
                  p.type === 'text' ? (
                    <span key={j} className="whitespace-pre-wrap">
                      {p.text}
                    </span>
                  ) : p.type === 'mention' ? (
                    <Chip key={j}>@{p.title}</Chip>
                  ) : p.type === 'frame' ? (
                    <FrameChip key={j} part={p} />
                  ) : null,
                )}
              </div>
            </div>
          );
        }
        if (m.role === 'system') {
          return (
            <div key={m.id} className="flex items-center gap-3">
              <Oyen mood="surprised" size={28} />
              <p className="m-0 text-[14px] text-text-2">
                {m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')}
              </p>
            </div>
          );
        }
        const working = streaming && i === messages.length - 1;
        return (
          <div key={m.id} data-testid="agent-message" className="flex items-start gap-3">
            <Oyen mood={working ? 'sleepy' : 'default'} size={28} />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <Parts parts={m.parts} working={working} />
            </div>
          </div>
        );
      })}
      {streaming && (!last || last.role !== 'agent') && (
        <div className="flex items-center gap-3">
          <Oyen mood="sleepy" size={28} />
          <span className="text-[13px] text-text-3">Working on it</span>
        </div>
      )}
      {children}
      <div ref={end} />
    </div>
  );
}

export { cn };
