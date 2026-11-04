import { useEffect, useMemo, useRef } from 'react';
import { Check, File as FileIcon, Loader2, X } from 'lucide-react';
import { formatTimecode, type ChatMessage, type MessagePart } from '@tayang/shared';
import { Oyen } from '@/components/Oyen';
import { AGENT_NAMES } from '@/lib/agents';
import { useApp } from '@/state/app';
import { useChat } from '@/state/chat';
import { extractA2ui } from '@/a2ui/parse';
import { A2uiSurface, type A2uiAction } from '@/a2ui/render';
import { applyMessages, blockSurfaceId, emptySurfaces, type SurfaceSet } from '@/a2ui/surface';

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
    <span className="inline-flex items-center gap-2 rounded-sm border border-hairline bg-transparent px-2 py-1 text-xs text-text-2">
      <span className="font-medium text-foreground">Frame {formatTimecode(part.timeSec, 30)}</span>
      {part.marks.length > 0 && <span className="text-text-3">{part.marks.length} marked</span>}
    </span>
  );
}

function SentFile({ part }: { part: Extract<MessagePart, { type: 'file' }> }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-text-2">
      <FileIcon size={14} strokeWidth={1.5} aria-hidden="true" />
      <span className="font-medium text-foreground">{part.name}</span>
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

/** What the chat's A2UI surfaces look like after every agent block, in order. */
interface A2uiState {
  chatId: string;
  set: SurfaceSet;
  /** The message that first showed each surface; later blocks update it in place. */
  owner: Record<string, string>;
  version: Record<string, number>;
  /** Answered by the user and not updated by the agent since. */
  answered: Record<string, boolean>;
}

function deriveA2ui(messages: ChatMessage[]): A2uiState {
  const st: A2uiState = { chatId: messages[0]?.chatId ?? '', set: emptySurfaces(), owner: {}, version: {}, answered: {} };
  for (const m of messages) {
    if (m.role === 'agent') {
      for (const p of m.parts) {
        if (p.type !== 'text') continue;
        for (const block of extractA2ui(p.text).blocks) {
          st.set = applyMessages(st.set, block);
          const sid = blockSurfaceId(block);
          if (!sid) continue;
          st.owner[sid] ??= m.id;
          st.version[sid] = (st.version[sid] ?? 0) + 1;
          st.answered[sid] = false;
        }
      }
    } else if (m.role === 'user') {
      for (const p of m.parts) {
        if (p.type !== 'a2ui-action') continue;
        const sid = (p.action as { action?: { surfaceId?: unknown } }).action?.surfaceId;
        if (typeof sid === 'string') st.answered[sid] = true;
      }
    }
  }
  return st;
}

function isUpdateOnly(text: string, messageId: string, a2ui: A2uiState): boolean {
  const { text: prose, blocks, pending } = extractA2ui(text);
  if (prose || pending || !blocks.length) return false;
  return blocks.every((b) => {
    const sid = blockSurfaceId(b);
    return !sid || a2ui.owner[sid] !== messageId;
  });
}

function sendAction(chatId: string, a: A2uiAction) {
  const { summary, ...rest } = a;
  const action: MessagePart = { type: 'a2ui-action', summary, action: { version: 'v0.9', action: rest } };
  // The agent gets the summary and the action JSON from the one a2ui-action part.
  void useChat.getState().send(chatId, [{ type: 'text', text: summary }, action], { promptParts: [action] });
}

/** An agent text part: prose, the surfaces it owns, and a placeholder for a block still streaming. */
function AgentText({ text, messageId, a2ui }: { text: string; messageId: string; a2ui: A2uiState }) {
  const { text: prose, blocks, pending } = useMemo(() => extractA2ui(text), [text]);
  const ids: string[] = [];
  for (const b of blocks) {
    const sid = blockSurfaceId(b);
    if (sid && a2ui.owner[sid] === messageId && !ids.includes(sid) && a2ui.set.surfaces[sid]) ids.push(sid);
  }
  return (
    <>
      {prose && <p className="m-0 whitespace-pre-wrap text-[14px] leading-[1.6] text-[#D9D9D9]">{prose}</p>}
      {ids.map((sid) => (
        <A2uiSurface
          key={`${sid}:${a2ui.version[sid]}`}
          surface={a2ui.set.surfaces[sid]!}
          disabled={a2ui.answered[sid]}
          onAction={(a) => sendAction(a2ui.chatId, a)}
        />
      ))}
      {blocks.length > 0 && a2ui.set.notes.length > 0 && (
        <p className="m-0 text-[12px] text-text-3">{a2ui.set.notes[0]}</p>
      )}
      {pending && <p className="m-0 text-[13px] text-text-3">Loading options…</p>}
    </>
  );
}

function Parts({
  parts,
  working,
  messageId,
  a2ui,
}: {
  parts: MessagePart[];
  working: boolean;
  messageId: string;
  a2ui: A2uiState;
}) {
  const tools = parts.filter((p): p is Tool => p.type === 'tool');
  return (
    <>
      {parts.map((p, i) => {
        if (p.type === 'text') return <AgentText key={i} text={p.text} messageId={messageId} a2ui={a2ui} />;
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

  const a2ui = useMemo(() => deriveA2ui(messages), [messages]);
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
                  ) : p.type === 'file' ? (
                    <SentFile key={j} part={p} />
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
        // An agent message that only updated an earlier surface has nothing of its own to show.
        if (!working && m.parts.length > 0 && m.parts.every((p) => p.type === 'text' && isUpdateOnly(p.text, m.id, a2ui))) {
          return null;
        }
        return (
          <div key={m.id} data-testid="agent-message" className="flex items-start gap-3">
            <Oyen mood={working ? 'sleepy' : 'default'} size={28} />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <Parts parts={m.parts} working={working} messageId={m.id} a2ui={a2ui} />
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

