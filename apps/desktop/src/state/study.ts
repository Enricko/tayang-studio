import { create } from 'zustand';
import type { AgentId, AgentUpdate, Job, JobStatus, PermissionRequest } from '@tayang/shared';
import { buildStudyStylePrompt, parseStyleResult } from '@tayang/skills';
import {
  agentCancel,
  agentPrompt,
  agentRespondPermission,
  agentStart,
  readStyleResult,
  saveStyle,
  studyDir,
  upsertJob,
} from '@/lib/ipc';
import { onAgentUpdate, onPermission } from '@/lib/events';
import { refreshJobs } from '@/state/jobs';

export type StudyPhase = 'idle' | 'running' | 'done' | 'failed';

interface StudyState {
  phase: StudyPhase;
  url: string;
  studyId: string | null;
  /** Number of agent tool calls so far; drives the progress steps. */
  toolCalls: number;
  request: PermissionRequest | null;
  /** Requests that arrived while `request` was open, oldest first. */
  queue: PermissionRequest[];
  error: string | null;
  /** Bumped when a style was saved so the library reloads. */
  savedVersion: number;
  start(url: string, agent: AgentId): Promise<void>;
  /** Allow once only. Null cancels the study. */
  respond(optionId: string | null): Promise<void>;
  dismiss(): void;
}

export const studyChatId = (studyId: string) => `study-${studyId}`;

const newId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`)
    .replace(/-/g, '')
    .slice(0, 10);

let unlisten: Promise<() => void>[] = [];

export const useStudy = create<StudyState>((set, get) => {
  let agent: AgentId = 'claude';

  const writeJob = async (status: JobStatus, note: string | null) => {
    const { studyId, url } = get();
    if (!studyId) return;
    const job: Job = {
      id: studyChatId(studyId),
      kind: 'study-style',
      title: 'Study a video for a new style',
      projectId: null,
      chatId: studyChatId(studyId),
      agentId: agent,
      status,
      progress: null,
      note: note ?? (status === 'working' ? url : null),
      updatedAt: new Date().toISOString(),
    };
    try {
      await upsertJob(job);
      await refreshJobs();
    } catch {
      /* the job board is best effort */
    }
  };

  /** Answers every open request with null (cancelled) and empties the queue. */
  const dropRequests = () => {
    const { request, queue } = get();
    set({ request: null, queue: [] });
    for (const r of [...(request ? [request] : []), ...queue]) {
      void agentRespondPermission(r.requestId, null).catch(() => {});
    }
  };

  const fail = async (message: string) => {
    dropRequests();
    set({ phase: 'failed', error: message });
    await writeJob('failed', message);
  };

  const finish = async () => {
    const { studyId, url } = get();
    if (!studyId) return;
    dropRequests();
    try {
      const raw = await readStyleResult(studyId);
      const parsed = raw ? parseStyleResult(raw, url) : null;
      if (!parsed) return fail('The agent did not write a style Tayang could read. Try another video.');
      await saveStyle({ ...parsed, id: `copied-${studyId}`, createdAt: new Date().toISOString() });
      set((s) => ({ phase: 'done', request: null, error: null, savedVersion: s.savedVersion + 1 }));
      await writeJob('done', parsed.name);
    } catch (e) {
      await fail(e instanceof Error ? e.message : String(e));
    }
  };

  const listen = () => {
    if (unlisten.length) return;
    unlisten = [
      onAgentUpdate(({ chatId, update }: { chatId: string; update: AgentUpdate }) => {
        const id = get().studyId;
        if (!id || chatId !== studyChatId(id) || get().phase !== 'running') return;
        if (update.kind === 'tool') set((s) => ({ toolCalls: s.toolCalls + (update.status === 'done' ? 1 : 0) }));
        else if (update.kind === 'error') void fail(update.message);
        else if (update.kind === 'done') void finish();
      }),
      onPermission((req) => {
        const id = get().studyId;
        if (!id || req.chatId !== studyChatId(id) || get().phase !== 'running') return;
        if (get().request) set((s) => ({ queue: [...s.queue, req] }));
        else set({ request: req });
      }),
    ];
  };

  return {
    phase: 'idle',
    url: '',
    studyId: null,
    toolCalls: 0,
    request: null,
    queue: [],
    error: null,
    savedVersion: 0,

    async start(url, agentId) {
      if (get().phase === 'running') return;
      agent = agentId;
      const studyId = newId();
      set({ phase: 'running', url, studyId, toolCalls: 0, request: null, queue: [], error: null });
      listen();
      try {
        const dir = await studyDir(studyId);
        await writeJob('working', null);
        await agentStart(studyChatId(studyId), agentId);
        await agentPrompt(studyChatId(studyId), [{ type: 'text', text: buildStudyStylePrompt(url, dir) }]);
      } catch (e) {
        await fail(e instanceof Error ? e.message : String(e));
      }
    },

    async respond(optionId) {
      const { request, queue, studyId } = get();
      if (!request || !studyId) return;
      const [next = null, ...rest] = queue;
      set({ request: next, queue: rest });
      await agentRespondPermission(request.requestId, optionId).catch(() => {});
      if (optionId === null) {
        await agentCancel(studyChatId(studyId)).catch(() => {});
        await fail('You cancelled the study');
      }
    },

    dismiss: () => set({ phase: 'idle', error: null, studyId: null, url: '' }),
  };
});
