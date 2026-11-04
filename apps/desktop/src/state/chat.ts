import { create } from 'zustand';
import { buildSessionPreamble } from '@tayang/skills';
import type { AgentId, AgentUpdate, ChatMessage, JobStatus, MessagePart, PermissionRequest } from '@tayang/shared';
import {
  addMessage,
  agentCancel,
  agentRespondPermission,
  agentPrompt,
  agentStart,
  agentStop,
  getChat,
  listMessages,
  updateChatAgent,
  upsertJob,
} from '@/lib/ipc';
import { onAgentUpdate, onPermission } from '@/lib/events';
import { agentErrorText, AGENT_NAMES } from '@/lib/agents';
import { useApp } from '@/state/app';
import { refreshJobs } from '@/state/jobs';

export { AGENT_STOPPED } from '@/lib/agents';

/** A project chat's turns show up on the Agents board as this build job. */
export interface ChatJob {
  projectId: string;
  title: string;
}

export interface SendOpts {
  /** What the agent receives instead of the visible message (extra context, topic prompts). */
  promptParts?: MessagePart[];
  /** Track this chat's turns as a `build` job. */
  job?: ChatJob;
  /** The chat's own agent; defaults to the agent picked in Settings. */
  agentId?: AgentId;
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
  /** Stops the running turn; it ends with done (cancelled). */
  cancel(chatId: string): Promise<void>;
  /** Ends the chat's agent process; the next send starts a new one. */
  stop(chatId: string): Promise<void>;
  /** Moves the chat to another agent; it starts fresh on the next send. */
  switchAgent(chatId: string, agent: AgentId): Promise<void>;
  /** Adds a system line to the chat and stores it; resolves once it is stored (best effort). */
  appendSystem(chatId: string, text: string): Promise<void>;
  attach(chatId: string, part: MessagePart): void;
  detach(chatId: string, index: number): void;
  listen(): void;
  reset(): void;
}

const isLocal = (m: ChatMessage) => m.id.startsWith('local-');

/** Agent chats that have no chat row: the setup installs, style studies and calendar ideas. */
export const isScratchChat = (chatId: string) =>
  chatId === 'setup' || chatId.startsWith('study-') || chatId.startsWith('ideas-');

/** Sessions that never show A2UI (setup installs, style studies): no skills preamble. Same rule as Rust. */
const isInternalChat = (chatId: string) => chatId === 'setup' || chatId.startsWith('study-');

/** Chats this store loaded or sent to; updates for any other chat id are not ours. */
const tracked = new Set<string>();
/** The agent each chat last started with, for error copy. */
const chatAgent = new Map<string, AgentId>();
/** Project chats whose turns are tracked as a build job. */
const chatJobs = new Map<string, ChatJob>();

/** Recaps waiting for the first prompt after an agent switch. */
const pendingRecap = new Map<string, string>();

/** What `agent_prompt` says when a turn is still running; that turn goes on untouched. */
const BUSY = /still working/i;
export const BUSY_NOTE = 'Wait for the agent to finish, then try again';

const RECAP_MESSAGES = 6;
const RECAP_CHARS = 1500;

/** The last 6 text messages as "You:"/"Agent:" lines, oldest first, within 1,500 characters. */
export function buildRecap(messages: ChatMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    const text = m.parts
      .map((p) => (p.type === 'text' ? p.text : ''))
      .join('')
      .trim();
    if (text) lines.push(`${m.role === 'user' ? 'You' : 'Agent'}: ${text}`);
  }
  const kept: string[] = [];
  let used = 0;
  for (const line of lines.slice(-RECAP_MESSAGES).reverse()) {
    const room = RECAP_CHARS - used - (kept.length ? 1 : 0);
    if (room <= 0) break;
    const cut = line.length > room ? `${line.slice(0, Math.max(0, room - 1))}…` : line;
    kept.unshift(cut);
    used += cut.length + (kept.length > 1 ? 1 : 0);
    if (line.length > room) break;
  }
  return kept.join('\n');
}

/** A system line that shows in the live chat and is stored with it. */
export const appendSystem = (chatId: string, text: string) => useChat.getState().appendSystem(chatId, text);

export const buildJobId = (chatId: string) => `build-${chatId}`;

/** Best effort: the job board must never break a chat. */
function writeJob(chatId: string, status: JobStatus, note: string | null = null) {
  const job = chatJobs.get(chatId);
  if (!job) return;
  void upsertJob({
    id: buildJobId(chatId),
    kind: 'build',
    title: job.title,
    projectId: job.projectId,
    chatId,
    agentId: chatAgent.get(chatId) ?? 'claude',
    status,
    progress: null,
    note,
    updatedAt: new Date().toISOString(),
  })
    .then(() => refreshJobs())
    .catch(() => {});
}
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
      writeJob(chatId, 'done');
      finish(chatId);
      const last = (get().messages[chatId] ?? []).at(-1);
      if (last && last.role === 'agent' && isLocal(last)) void persist(chatId, last);
      return;
    }
    // error: the session is gone, so the next send must start a new one
    finish(chatId);
    set((s) => ({ started: { ...s.started, [chatId]: false } }));
    const text = agentErrorText(u.message, chatAgent.get(chatId) ?? 'claude');
    writeJob(chatId, 'failed', text);
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
      if (isScratchChat(chatId)) return;
      tracked.add(chatId);
      const agent = (async () => {
        try {
          // After a restart the chat row is the only record of the chat's agent.
          const row = await getChat(chatId);
          if (row && !chatAgent.has(chatId)) chatAgent.set(chatId, row.agentId);
        } catch {
          /* the next send falls back to the default agent */
        }
      })();
      try {
        const list = await listMessages(chatId);
        // Never clobber a conversation that is already live in memory.
        if (!get().messages[chatId]?.length) set((s) => ({ messages: { ...s.messages, [chatId]: list } }));
      } catch {
        /* an empty chat is fine */
      }
      await agent;
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
        const agent = opts?.agentId ?? chatAgent.get(chatId) ?? useApp.getState().settings?.defaultAgent ?? 'claude';
        chatAgent.set(chatId, agent);
        if (opts?.job) chatJobs.set(chatId, opts.job);
        writeJob(chatId, 'working');
        let fresh = false;
        let noPlugin = false;
        if (!get().started[chatId]) {
          noPlugin = (await agentStart(chatId, agent)) === true;
          set((s) => ({ started: { ...s.started, [chatId]: true } }));
          fresh = true;
        }
        const sent = opts?.promptParts ? [...attached, ...opts.promptParts] : visible;
        const lead: MessagePart[] = [];
        // Claude loads the Tayang plugin itself (unless the app shipped without it); other agents get
        // the skills as text, once per session.
        if (fresh && !isInternalChat(chatId) && (agent !== 'claude' || noPlugin)) lead.push({ type: 'text', text: buildSessionPreamble() });
        const recap = pendingRecap.get(chatId);
        if (recap) {
          lead.push({ type: 'text', text: `Earlier in this chat, with another agent:\n${recap}\n\nContinue from here.` });
        }
        await agentPrompt(chatId, [...lead, ...sent]);
        pendingRecap.delete(chatId);
        return null;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (BUSY.test(message)) {
          // The running turn is fine: leave its permissions, job and session alone and just say so.
          append(chatId, localMessage(chatId, 'system', [{ type: 'text', text: BUSY_NOTE }]));
          return null;
        }
        onUpdate(chatId, { kind: 'error', message });
        return agentErrorText(message, chatAgent.get(chatId) ?? 'claude');
      }
    },

    async respondPermission(chatId, optionId) {
      const [req, ...rest] = get().permissions[chatId] ?? [];
      if (!req) return;
      set((s) => ({ permissions: { ...s.permissions, [chatId]: rest } }));
      if (!rest.length && get().streaming[chatId]) writeJob(chatId, 'working');
      await agentRespondPermission(req.requestId, optionId);
    },

    async cancel(chatId) {
      await agentCancel(chatId).catch(() => {});
    },

    async stop(chatId) {
      set((s) => ({ started: { ...s.started, [chatId]: false } }));
      await agentStop(chatId).catch(() => {});
    },

    async switchAgent(chatId, agent) {
      const earlier = get().messages[chatId] ?? [];
      await updateChatAgent(chatId, agent);
      await get().stop(chatId);
      chatAgent.set(chatId, agent);
      pendingRecap.set(chatId, buildRecap(earlier));
      const sys = localMessage(chatId, 'system', [
        {
          type: 'text',
          text: `Switched to ${AGENT_NAMES[agent]}. It starts fresh: it sees this project's files but not the earlier messages.`,
        },
      ]);
      append(chatId, sys);
      void persist(chatId, sys);
    },

    async appendSystem(chatId, text) {
      const sys = localMessage(chatId, 'system', [{ type: 'text', text }]);
      append(chatId, sys);
      await persist(chatId, sys);
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
          writeJob(req.chatId, 'needs-you');
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
      chatJobs.clear();
      pendingRecap.clear();
      set({ messages: {}, streaming: {}, permissions: {}, attachments: {}, started: {} });
    },
  };
});
