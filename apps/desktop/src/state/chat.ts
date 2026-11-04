import { create } from 'zustand';
import type { AgentId, AgentUpdate, ChatMessage, MessagePart, PermissionRequest } from '@tayang/shared';
import { addMessage, agentRespondPermission, agentPrompt, agentStart, agentStop, listMessages } from '@/lib/ipc';
import { onAgentUpdate, onPermission } from '@/lib/events';
import { agentErrorText } from '@/lib/agents';
import { useApp } from '@/state/app';

export { AGENT_STOPPED } from '@/lib/agents';

export interface SendOpts {
  /** What the agent receives instead of the visible message (extra context, topic prompts). */
  promptParts?: MessagePart[];
}

interface ChatState {
  messages: Record<string, ChatMessage[]>;
  streaming: Record<string, boolean>;
  /** Open permission requests per chat, oldest first. The card shows the head. */
  permissions: Record<string, PermissionRequest[]>;
  attachments: Record<string, MessagePart[]>;
  /** Chats whose agent session was started in this app session. */
  started: Record<string, boolean>;

  load(chatId: string): Promise<void>;
  /** Resolves to an error message when the agent could not be reached, otherwise null. */
  send(chatId: string, parts: MessagePart[], opts?: SendOpts): Promise<string | null>;
  respondPermission(chatId: string, optionId: string | null): Promise<void>;
  /** Ends the chat's agent process; the next send starts a new one. */
  stop(chatId: string): Promise<void>;
  attach(chatId: string, part: MessagePart): void;
  detach(chatId: string, index: number): void;
  listen(): void;
  reset(): void;
}

const isLocal = (m: ChatMessage) => m.id.startsWith('local-');

/** Agent chats that have no chat row: the setup installs, style studies and calendar ideas. */
export const isScratchChat = (chatId: string) =>
  chatId === 'setup' || chatId.startsWith('study-') || chatId.startsWith('ideas-');

/** Chats this store loaded or sent to; updates for any other chat id are not ours. */
const tracked = new Set<string>();
/** The agent each chat last started with, for error copy. */
const chatAgent = new Map<string, AgentId>();
let seq = 0;
const localMessage = (chatId: string, role: ChatMessage['role'], parts: MessagePart[]): ChatMessage => ({
  id: `local-${++seq}`,
  chatId,
  role,
  parts,
  createdAt: new Date().toISOString(),
});

let unlisten: Promise<() => void>[] = [];

const NO_PERMISSION = null;
/** The permission request a chat's card shows: the oldest open one. */
export const headPermission = (s: { permissions: Record<string, PermissionRequest[]> }, chatId: string | null) =>
  (chatId ? s.permissions[chatId]?.[0] : undefined) ?? NO_PERMISSION;

export const useChat = create<ChatState>((set, get) => {
  const append = (chatId: string, m: ChatMessage) =>
    set((s) => ({ messages: { ...s.messages, [chatId]: [...(s.messages[chatId] ?? []), m] } }));

  const replaceLast = (chatId: string, fn: (m: ChatMessage) => ChatMessage) =>
    set((s) => {
      const list = [...(s.messages[chatId] ?? [])];
      list[list.length - 1] = fn(list[list.length - 1]!);
      return { messages: { ...s.messages, [chatId]: list } };
    });

  /** Persist a local message and swap in the stored one. Best effort. */
  const persist = async (chatId: string, m: ChatMessage) => {
    if (isScratchChat(chatId)) return;
    try {
      const saved = await addMessage(chatId, m.role, m.parts);
      if (!saved) return;
      set((s) => ({
        messages: {
          ...s.messages,
          [chatId]: (s.messages[chatId] ?? []).map((x) => (x.id === m.id ? { ...saved } : x)),
        },
      }));
    } catch {
      /* keep the local copy */
    }
  };

  /** The turn is over: answer whatever is still queued with null and clear the queue. */
  const finish = (chatId: string) => {
    const open = get().permissions[chatId] ?? [];
    set((s) => ({
      streaming: { ...s.streaming, [chatId]: false },
      permissions: { ...s.permissions, [chatId]: [] },
    }));
    for (const req of open) void agentRespondPermission(req.requestId, null).catch(() => {});
  };

  const onUpdate = (chatId: string, u: AgentUpdate) => {
    if (!tracked.has(chatId) || u.kind === 'thought') return;
    if (u.kind === 'text' || u.kind === 'tool') {
      const list = get().messages[chatId] ?? [];
      const last = list[list.length - 1];
      if (!last || last.role !== 'agent') {
        append(chatId, localMessage(chatId, 'agent', []));
      }
      replaceLast(chatId, (m) => {
        const parts = [...m.parts];
        if (u.kind === 'text') {
          const tail = parts[parts.length - 1];
          if (tail?.type === 'text') parts[parts.length - 1] = { type: 'text', text: tail.text + u.text };
          else parts.push({ type: 'text', text: u.text });
        } else {
          const part: MessagePart = { type: 'tool', toolCallId: u.toolCallId, title: u.title, status: u.status };
          const i = parts.findIndex((p) => p.type === 'tool' && p.toolCallId === u.toolCallId);
          if (i >= 0) parts[i] = part;
          else parts.push(part);
        }
        return { ...m, parts };
      });
      return;
    }
    if (u.kind === 'done') {
      finish(chatId);
      const last = (get().messages[chatId] ?? []).at(-1);
      if (last && last.role === 'agent' && isLocal(last)) void persist(chatId, last);
      return;
    }
    // error: the session is gone, so the next send must start a new one
    finish(chatId);
    set((s) => ({ started: { ...s.started, [chatId]: false } }));
    const text = agentErrorText(u.message, chatAgent.get(chatId) ?? 'claude');
    const sys = localMessage(chatId, 'system', [{ type: 'text', text }]);
    append(chatId, sys);
    void persist(chatId, sys);
  };

  return {
    messages: {},
    streaming: {},
    permissions: {},
    attachments: {},
    started: {},

    async load(chatId) {
      if (!isScratchChat(chatId)) tracked.add(chatId);
      try {
        const list = await listMessages(chatId);
        // Never clobber a conversation that is already live in memory.
        if (!get().messages[chatId]?.length) set((s) => ({ messages: { ...s.messages, [chatId]: list } }));
      } catch {
        /* an empty chat is fine */
      }
    },

    async send(chatId, parts, opts) {
      tracked.add(chatId);
      const attached = get().attachments[chatId] ?? [];
      const visible = [...attached, ...parts];
      set((s) => ({
        attachments: { ...s.attachments, [chatId]: [] },
        streaming: { ...s.streaming, [chatId]: true },
      }));
      const user = localMessage(chatId, 'user', visible);
      append(chatId, user);
      void persist(chatId, user);
      try {
        const agent = useApp.getState().settings?.defaultAgent ?? 'claude';
        chatAgent.set(chatId, agent);
        if (!get().started[chatId]) {
          await agentStart(chatId, agent);
          set((s) => ({ started: { ...s.started, [chatId]: true } }));
        }
        await agentPrompt(chatId, opts?.promptParts ? [...attached, ...opts.promptParts] : visible);
        return null;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        onUpdate(chatId, { kind: 'error', message });
        return agentErrorText(message, chatAgent.get(chatId) ?? 'claude');
      }
    },

    async respondPermission(chatId, optionId) {
      const [req, ...rest] = get().permissions[chatId] ?? [];
      if (!req) return;
      set((s) => ({ permissions: { ...s.permissions, [chatId]: rest } }));
      await agentRespondPermission(req.requestId, optionId);
    },

    async stop(chatId) {
      set((s) => ({ started: { ...s.started, [chatId]: false } }));
      await agentStop(chatId).catch(() => {});
    },

    attach: (chatId, part) =>
      set((s) => ({ attachments: { ...s.attachments, [chatId]: [...(s.attachments[chatId] ?? []), part] } })),

    detach: (chatId, index) =>
      set((s) => ({
        attachments: { ...s.attachments, [chatId]: (s.attachments[chatId] ?? []).filter((_, i) => i !== index) },
      })),

    listen() {
      if (unlisten.length) return;
      unlisten = [
        onAgentUpdate(({ chatId, update }) => onUpdate(chatId, update)),
        onPermission((req) => {
          if (!tracked.has(req.chatId)) return;
          set((s) => ({
            permissions: { ...s.permissions, [req.chatId]: [...(s.permissions[req.chatId] ?? []), req] },
          }));
        }),
      ];
    },

    reset() {
      unlisten.forEach((p) => void p.then((fn) => fn()));
      unlisten = [];
      tracked.clear();
      chatAgent.clear();
      set({ messages: {}, streaming: {}, permissions: {}, attachments: {}, started: {} });
    },
  };
});
