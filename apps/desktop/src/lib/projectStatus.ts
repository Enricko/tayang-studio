import type { MessagePart, ProjectStatus } from '@tayang/shared';
import { listChats, listMessages, listProjects, setProjectStatus, updateSettings } from '@/lib/ipc';
import { finishedRender } from '@/lib/renderCheck';
import { useApp } from '@/state/app';

const RANK: Record<ProjectStatus, number> = { draft: 0, building: 1, rendered: 2, scheduled: 3 };

/** Tool kinds that change the project: the agent has started building once one of them finished. */
const WORK_KINDS = new Set(['edit', 'delete', 'move', 'execute']);

/** A finished tool call that edited, deleted or moved files, or ran a command. */
export const isWorkTool = (p: MessagePart) => p.type === 'tool' && p.status === 'done' && !!p.toolKind && WORK_KINDS.has(p.toolKind);

/** The status each project is known to have in this app session; a move to it or behind it asks nothing. */
const known = new Map<string, ProjectStatus>();
/** Remembers a status, never lower than one already known (a live move may land while the backfill runs). */
const remember = (id: string, status: ProjectStatus) => {
  const at = known.get(id);
  if (!at || RANK[status] > RANK[at]) known.set(id, status);
};
const moving = new Map<string, Promise<void>>();

/**
 * Moves a project forward to `status` (Rust never moves it back) and refreshes the project lists.
 * Best effort: a failure is tried again on the next call. Never throws.
 */
export function advanceProject(projectId: string, status: 'building' | 'rendered'): Promise<void> {
  const at = known.get(projectId);
  if (at && RANK[at] >= RANK[status]) return Promise.resolve();
  const key = `${projectId}:${status}`;
  const running = moving.get(key);
  if (running) return running;
  const run = (async () => {
    try {
      const project = await setProjectStatus(projectId, status);
      remember(projectId, project.status);
      useApp.getState().bumpProjects();
    } catch {
      /* the step bar is best effort: a chat or a job never breaks over it */
    }
  })().finally(() => moving.delete(key));
  moving.set(key, run);
  return run;
}

/** Whether any of the project's chats has a finished tool call that edited files or ran a command. */
async function didWork(projectId: string): Promise<boolean> {
  for (const chat of await listChats(projectId)) {
    const messages = await listMessages(chat.id);
    if (messages.some((m) => m.parts.some(isWorkTool))) return true;
  }
  return false;
}

/**
 * Once per install, at startup: projects made before the status moved on its own. One with a finished
 * render is rendered; a draft whose chat edited files or ran commands is building. `checked` is the saved
 * flag; it is saved only when every write went through.
 */
let backfilling: Promise<void> | null = null;

export function backfillProjectStatus(checked: boolean | undefined): Promise<void> {
  if (checked) return Promise.resolve();
  // StrictMode can start it twice; one run is enough.
  backfilling ??= backfill().finally(() => {
    backfilling = null;
  });
  return backfilling;
}

async function backfill(): Promise<void> {
  try {
    const open = (await listProjects()).filter((p) => p.status === 'draft' || p.status === 'building');
    const moved = await Promise.all(
      open.map(async (p) => {
        if (await finishedRender(p.id)) return setProjectStatus(p.id, 'rendered');
        if (p.status === 'draft' && (await didWork(p.id))) return setProjectStatus(p.id, 'building');
        return null;
      }),
    );
    for (const p of moved) if (p) remember(p.id, p.status);
    await updateSettings({ projectStatusChecked: true });
    if (moved.some(Boolean)) useApp.getState().bumpProjects();
  } catch {
    /* best effort: tried again at the next start */
  }
}

/** For tests: forget what is known. */
export const resetProjectStatus = () => {
  known.clear();
  moving.clear();
  backfilling = null;
};
