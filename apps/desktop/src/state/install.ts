import { create } from 'zustand';
import type { AgentId, AgentUpdate, PermissionRequest, SystemInfo, ToolId, ToolStatus } from '@tayang/shared';
import { buildInstallPrompt } from '@tayang/skills';
import { agentCancel, agentPrompt, agentRespondPermission, agentStart, checkTools } from '@/lib/ipc';
import { onAgentUpdate, onPermission } from '@/lib/events';

/** Every install runs in one shared agent chat. */
export const SETUP_CHAT = 'setup';

export type InstallStatus = 'missing' | 'key' | 'confirm' | 'running' | 'done' | 'failed';

export interface LogLine {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'done' | 'failed';
}

export interface ToolInstall {
  status: InstallStatus;
  log: LogLine[];
  error?: string;
}

export interface StartOpts {
  sys: SystemInfo;
  agent: AgentId;
  elevenLabsKey?: string;
}

interface InstallState {
  /** Latest `check_tools` result. */
  statuses: ToolStatus[];
  tools: Partial<Record<ToolId, ToolInstall>>;
  /** The tool the setup chat is working on, if any. */
  active: ToolId | null;
  /** Open permission request of the setup chat. */
  request: PermissionRequest | null;
  agent: AgentId | null;

  refresh(agent: AgentId): Promise<ToolStatus[]>;
  /** Show the API key step for a tool. */
  askKey(tool: ToolId): void;
  start(tool: ToolId, opts: StartOpts): Promise<void>;
  respond(optionId: string | null): Promise<void>;
  /** Back to the plain "Install" button. */
  dismiss(tool: ToolId): void;
  /** Stop an install that has not been approved yet and free the setup chat. */
  cancel(tool: ToolId): Promise<void>;
  listen(): void;
  reset(): void;
}

let unlisten: Promise<() => void>[] = [];

export const useInstall = create<InstallState>((set, get) => {
  const patch = (tool: ToolId, p: Partial<ToolInstall>) =>
    set((s) => ({ tools: { ...s.tools, [tool]: { status: 'missing', log: [], ...s.tools[tool], ...p } } }));

  const fail = (tool: ToolId, error: string) => {
    patch(tool, { status: 'failed', error });
    set({ active: null, request: null });
  };

  const onUpdate = async (update: AgentUpdate) => {
    const tool = get().active;
    if (!tool) return;
    const cur = get().tools[tool];
    if (update.kind === 'tool') {
      const log = [...(cur?.log ?? [])];
      const line: LogLine = { id: update.toolCallId, title: update.title, status: update.status };
      const i = log.findIndex((l) => l.id === line.id);
      if (i >= 0) log[i] = line;
      else log.push(line);
      const promote = cur?.status === 'confirm' && !get().request && update.status !== 'pending';
      patch(tool, { log, ...(promote ? { status: 'running' as const } : {}) });
    } else if (update.kind === 'error') {
      fail(tool, update.message);
    } else if (update.kind === 'done') {
      // The session answers any open permission request as cancelled.
      set({ request: null });
      const agent = get().agent;
      try {
        const statuses = agent ? await get().refresh(agent) : get().statuses;
        if (statuses.find((t) => t.id === tool)?.ok) {
          patch(tool, { status: 'done', error: undefined });
          set({ active: null });
        } else {
          fail(tool, 'Tayang still can’t find it on this computer. Try again.');
        }
      } catch (e) {
        fail(tool, e instanceof Error ? e.message : String(e));
      }
    }
  };

  return {
    statuses: [],
    tools: {},
    active: null,
    request: null,
    agent: null,

    async refresh(agent) {
      const statuses = await checkTools(agent);
      set({ statuses, agent });
      return statuses;
    },

    askKey: (tool) => patch(tool, { status: 'key', error: undefined }),

    async start(tool, opts) {
      if (get().active) return;
      set({ active: tool, request: null, agent: opts.agent });
      patch(tool, { status: 'confirm', log: [], error: undefined });
      try {
        await agentStart(SETUP_CHAT, opts.agent);
        const text = buildInstallPrompt(tool, opts.sys, opts.agent, { elevenLabsKey: opts.elevenLabsKey });
        await agentPrompt(SETUP_CHAT, [{ type: 'text', text }]);
      } catch (e) {
        if (get().active === tool) fail(tool, e instanceof Error ? e.message : String(e));
      }
    },

    async respond(optionId) {
      const { request, active } = get();
      if (!request) return;
      set({ request: null });
      if (active) {
        if (optionId === null) patch(active, { status: 'missing', log: [] });
        else patch(active, { status: 'running' });
        if (optionId === null) set({ active: null });
      }
      await agentRespondPermission(request.requestId, optionId);
    },

    dismiss: (tool) => patch(tool, { status: 'missing', log: [], error: undefined }),

    async cancel(tool) {
      const wasActive = get().active === tool;
      patch(tool, { status: 'missing', log: [], error: undefined });
      if (!wasActive) return;
      set({ active: null, request: null });
      await agentCancel(SETUP_CHAT).catch(() => {});
    },

    listen() {
      if (unlisten.length) return;
      unlisten = [
        onAgentUpdate(({ chatId, update }) => {
          if (chatId === SETUP_CHAT) void onUpdate(update);
        }),
        onPermission((req) => {
          if (req.chatId === SETUP_CHAT && get().active) set({ request: req });
        }),
      ];
    },

    reset() {
      unlisten.forEach((p) => void p.then((fn) => fn()));
      unlisten = [];
      set({ statuses: [], tools: {}, active: null, request: null, agent: null });
    },
  };
});
