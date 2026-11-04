import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { File as FileIcon } from 'lucide-react';
import { formatTimecode, type ChatMessage, type MessagePart } from '@tayang/shared';
import { Markdown } from '@/components/Markdown';
import { Oyen } from '@/components/Oyen';
import { STICK_EVENT } from '@/components/ScrollToBottom';
import { ActivityGroup, isHiddenTool, WorkingLine, type ActivityItem } from '@/components/Activity';
import { localized } from '@/lib/stored';
import { messageKey, useChat, type SendOpts } from '@/state/chat';
import { splitTopicJson, stripFramesToken } from '@tayang/skills';
import { extractA2ui } from '@/a2ui/parse';
import { A2uiSurface, type A2uiAction } from '@/a2ui/render';
import { applyMessages, blockSurfaceId, emptySurfaces, type SurfaceSet } from '@/a2ui/surface';

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-sm border border-deep-orange bg-tint px-2 text-[13px] font-medium text-orange-light">
      {children}
    </span>
  );
}

export function FrameChip({ part }: { part: Extract<MessagePart, { type: 'frame' }> }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-2 rounded-sm border border-hairline bg-transparent px-2 py-1 text-xs text-text-2">
      <span className="font-medium text-foreground">{t('chat.frame', { time: formatTimecode(part.timeSec, 30) })}</span>
      {part.marks.length > 0 && <span className="text-text-3">{t('chat.marked', { count: part.marks.length })}</span>}
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

interface Actions {
  /** A screen can take an A2UI action itself (return true) instead of sending it to the agent. */
  handle?: (a: A2uiAction) => boolean;
  /** Surfaces take no input while the agent replies: one gate with the composer and agent picker. */
  locked: boolean;
  sendOptions?: SendOptions;
}

/** The screen's own send options for what the agent receives (its agent, build job, prompt prefix). */
export type SendOptions = (promptParts: MessagePart[]) => SendOpts;

const ActionsContext = createContext<Actions>({ locked: false });

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

function sendAction(chatId: string, a: A2uiAction, sendOptions?: SendOptions) {
  const { summary, ...rest } = a;
  const action: MessagePart = { type: 'a2ui-action', summary, action: { version: 'v0.9', action: rest } };
  // The agent gets the summary and the action JSON from the one a2ui-action part.
  const opts = { promptParts: [action], ...sendOptions?.([action]) };
  void useChat.getState().send(chatId, [{ type: 'text', text: summary }, action], opts);
}

/** An agent text part: prose, the surfaces it owns, and a placeholder for a block still streaming. */
function AgentText({ text, messageId, a2ui }: { text: string; messageId: string; a2ui: A2uiState }) {
  const { text: rawProse, blocks, pending: a2uiPending, invalid } = useMemo(() => extractA2ui(stripFramesToken(text)), [text]);
  const { t } = useTranslation();
  const { handle, locked, sendOptions } = useContext(ActionsContext);
  // Older agents answer topics with a ```json block. Where a screen shows topic cards (it provides the
  // handler), hide that block, also while it is still streaming; other chats keep it as written.
  const { prose, pending: jsonPending } = useMemo(() => {
    if (!handle) return { prose: rawProse, pending: false };
    const done = splitTopicJson(rawProse).text;
    const open = done.lastIndexOf('```json');
    if (open >= 0 && !done.includes('```', open + 7) && /^\s*\n\s*\[\s*(\{|$)/.test(done.slice(open + 7))) {
      return { prose: done.slice(0, open).trim(), pending: true };
    }
    return { prose: done, pending: false };
  }, [rawProse, handle]);
  const pending = a2uiPending || jsonPending;
  const ids: string[] = [];
  for (const b of blocks) {
    const sid = blockSurfaceId(b);
    if (sid && a2ui.owner[sid] === messageId && !ids.includes(sid) && a2ui.set.surfaces[sid]) ids.push(sid);
  }
  return (
    <>
      {prose && <Markdown text={prose} />}
      {ids.map((sid) => (
        <A2uiSurface
          key={`${sid}:${a2ui.version[sid]}`}
          surface={a2ui.set.surfaces[sid]!}
          disabled={a2ui.answered[sid]}
          locked={locked}
          onAction={(a) => {
            if (!handle?.(a)) sendAction(a2ui.chatId, a, sendOptions);
          }}
        />
      ))}
      {blocks.length > 0 && a2ui.set.notes.length > 0 && (
        <p className="m-0 text-[12px] text-text-3">{a2ui.set.notes[0]}</p>
      )}
      {invalid > 0 && <p className="m-0 text-[12px] text-text-3">{t('chat.brokenBlock')}</p>}
      {pending && <p className="m-0 text-[13px] text-text-3">{t('chat.loadingOptions')}</p>}
    </>
  );
}

function Parts({
  parts,
  live,
  messageId,
  a2ui,
}: {
  parts: MessagePart[];
  /** This message is the one the agent is still writing. */
  live: boolean;
  messageId: string;
  a2ui: A2uiState;
}) {
  // Tool calls and thoughts that run together become one activity line, where they happened.
  const out: React.ReactNode[] = [];
  let run: ActivityItem[] = [];
  const flush = (tail: boolean) => {
    if (run.length) out.push(<ActivityGroup key={`g${out.length}`} items={run} live={live && tail} />);
    run = [];
  };
  parts.forEach((p, i) => {
    if (p.type === 'tool' || p.type === 'thought') {
      if (p.type === 'thought' || !isHiddenTool(p)) run.push(p);
      return;
    }
    flush(false);
    if (p.type === 'text') out.push(<AgentText key={i} text={p.text} messageId={messageId} a2ui={a2ui} />);
    else if (p.type === 'mention') out.push(<Chip key={i}>@{p.title}</Chip>);
    else if (p.type === 'frame') out.push(<FrameChip key={i} part={p} />);
  });
  flush(true);
  return <>{out}</>;
}

/** Whether a message has anything to draw once hidden tools are dropped. */
function hasVisible(parts: MessagePart[]): boolean {
  return parts.some((p) => (p.type === 'tool' ? !isHiddenTool(p) : p.type !== 'a2ui' && p.type !== 'a2ui-action'));
}

export function MessageList({
  messages,
  streaming,
  children,
  onA2uiAction,
  sendOptions,
  busy = false,
  scrollRef,
}: {
  /** The scroll container the list lives in: it follows new messages only while the user is near the bottom. */
  scrollRef?: React.RefObject<HTMLElement | null>;
  messages: ChatMessage[];
  streaming: boolean;
  /** The screen is busy with an earlier action (setting up a topic): surfaces wait, like while streaming. */
  busy?: boolean;
  /** Return true when the screen handled the action itself. */
  onA2uiAction?: (a: A2uiAction) => boolean;
  /** How an answered surface is sent: the same options as the screen's composer. */
  sendOptions?: SendOptions;
  /** Extra blocks under the conversation (permission card, idea cards). */
  children?: React.ReactNode;
}) {
  const { t, i18n: inst } = useTranslation();
  const end = useRef<HTMLDivElement>(null);
  // Follow the conversation only while the reader is at the bottom (or just sent something), so jumping
  // to an earlier turn while the agent streams stays put.
  const stick = useRef(true);
  const prev = useRef({ count: messages.length, last: messages[messages.length - 1]?.id });
  useEffect(() => {
    const box = scrollRef?.current;
    if (!box) return;
    const onScroll = () => {
      stick.current = box.scrollHeight - box.scrollTop - box.clientHeight <= 80;
    };
    // The scroll-to-bottom pill asks to follow the conversation again.
    const onStick = () => {
      stick.current = true;
    };
    box.addEventListener('scroll', onScroll, { passive: true });
    box.addEventListener(STICK_EVENT, onStick);
    return () => {
      box.removeEventListener('scroll', onScroll);
      box.removeEventListener(STICK_EVENT, onStick);
    };
  }, [scrollRef]);
  useEffect(() => {
    const last = messages[messages.length - 1];
    const sent = last?.role === 'user' && (messages.length !== prev.current.count || last.id !== prev.current.last);
    prev.current = { count: messages.length, last: last?.id };
    if (sent) stick.current = true;
    if (stick.current) end.current?.scrollIntoView?.({ block: 'end' });
  }, [messages, streaming]);

  const a2ui = useMemo(() => deriveA2ui(messages), // the version note is in the language of the moment
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, inst.language]);
  const actions = useMemo(
    () => ({ handle: onA2uiAction, locked: streaming || busy, sendOptions }),
    [onA2uiAction, streaming, busy, sendOptions],
  );
  const last = messages[messages.length - 1];
  return (
    <ActionsContext.Provider value={actions}>
    <div className="flex flex-col gap-6" role="log" aria-label={t('chat.conversation')}>
      {messages.map((m, i) => {
        if (m.role === 'user') {
          return (
            <div key={messageKey(m)} data-turn={i} className="flex justify-end">
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
            <div key={messageKey(m)} className="flex items-center gap-3">
              <Oyen mood="surprised" size={28} />
              <p className="m-0 text-[14px] text-text-2">
                {localized(m.parts.map((p) => (p.type === 'text' ? p.text : '')).join(''))}
              </p>
            </div>
          );
        }
        const working = streaming && i === messages.length - 1;
        // An agent message that only updated an earlier surface has nothing of its own to show.
        if (
          !working &&
          m.parts.every(
            (p) =>
              (p.type === 'text' && isUpdateOnly(p.text, m.id, a2ui)) || (p.type === 'tool' && isHiddenTool(p)),
          )
        ) {
          return null;
        }
        return (
          <div key={messageKey(m)} data-testid="agent-message" className="flex items-start gap-3">
            <Oyen mood={working ? 'sleepy' : 'default'} size={28} />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <Parts parts={m.parts} live={working} messageId={m.id} a2ui={a2ui} />
              {working && !hasVisible(m.parts) && <WorkingLine />}
            </div>
          </div>
        );
      })}
      {streaming && (!last || last.role !== 'agent') && (
        <div className="flex items-center gap-3">
          <Oyen mood="sleepy" size={28} />
          <WorkingLine />
        </div>
      )}
      {children}
      <div ref={end} />
    </div>
    </ActionsContext.Provider>
  );
}

