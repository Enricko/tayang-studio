import { create } from 'zustand';

/** A video render in progress for one project. */
export interface RenderRun {
  /** ms since the epoch. */
  startedAt: number;
  /** The agent's own render command, or Tayang's Render button. */
  source: 'agent' | 'tayang';
  /** The chat whose turn runs it (agent renders). */
  chatId?: string;
  /** The tool call that runs it (agent renders). */
  toolCallId?: string;
}

interface RenderState {
  /** By project id. */
  runs: Record<string, RenderRun>;
  start(projectId: string, run: Omit<RenderRun, 'startedAt'> & { startedAt?: number }): void;
  /** Ends the project's render; with `toolCallId`, only when that call is the one running. */
  end(projectId: string, toolCallId?: string): void;
  /** Ends every agent render a chat's turn started (the turn ended). */
  endChat(chatId: string): void;
}

export const useRender = create<RenderState>((set, get) => ({
  runs: {},
  start(projectId, run) {
    if (get().runs[projectId]) return; // keep the first start time while it goes on
    set((s) => ({ runs: { ...s.runs, [projectId]: { ...run, startedAt: run.startedAt ?? Date.now() } } }));
  },
  end(projectId, toolCallId) {
    const run = get().runs[projectId];
    if (!run || (toolCallId && run.toolCallId !== toolCallId)) return;
    set((s) => {
      const { [projectId]: _, ...rest } = s.runs;
      return { runs: rest };
    });
  },
  endChat(chatId) {
    const ids = Object.entries(get().runs).filter(([, r]) => r.chatId === chatId).map(([id]) => id);
    if (!ids.length) return;
    set((s) => ({ runs: Object.fromEntries(Object.entries(s.runs).filter(([id]) => !ids.includes(id))) }));
  },
}));

/** The render command each project's tayang.json names, for spotting the agent's own render. */
const renderArgv = new Map<string, string[]>();
export const setRenderArgv = (projectId: string, argv: string[] | null) =>
  argv?.length ? renderArgv.set(projectId, argv) : renderArgv.delete(projectId);
export const renderArgvOf = (projectId: string) => renderArgv.get(projectId);
