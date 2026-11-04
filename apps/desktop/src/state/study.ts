import { create } from 'zustand';
import type { AgentId, AgentUpdate, Job, JobStatus, PermissionRequest } from '@tayang/shared';
import { buildStudyStylePrompt, parseStyleResult } from '@tayang/skills';
import {
  agentCancel,
  agentPrompt,
  agentRespondPermission,
  agentStart,
  agentStop,
  assetUrl,
  deleteJob,
  makeStylePreview,
  readStyleResult,
  saveStyle,
  studyDir,
  upsertJob,
} from '@/lib/ipc';
import { agentErrorText } from '@/lib/agents';
import { onAgentUpdate, onPermission } from '@/lib/events';
import { refreshJobs } from '@/state/jobs';

export type StudyPhase = 'idle' | 'running' | 'done' | 'failed';

interface StudyState {
  phase: StudyPhase;
  url: string;
  studyId: string | null;
  /** Number of agent tool calls so far; drives the progress steps. */
  toolCalls: number;
  /** "Ran without asking: …" lines from auto mode, oldest first. */
  ranLog: string[];
  request: PermissionRequest | null;
  /** Requests that arrived while `request` was open, oldest first. */
  queue: PermissionRequest[];
  error: string | null;
  /** True while the finished study's preview is being made. */
  finishing: boolean;
  /** Bumped when a style was saved so the library reloads. */
  savedVersion: number;
  /** `replaceJobId`: a failed study's job, deleted once this study's own job is written. */
  start(url: string, agent: AgentId, replaceJobId?: string): Promise<void>;
  /** Allow once only. Null cancels the study. */
  respond(optionId: string | null): Promise<void>;
  /** Stop a running study; its job ends failed "Cancelled". */
  cancel(): Promise<void>;
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

  /** A failed study's job that this one replaces: deleted once this study's own job is written. */
  let staleJobId: string | null = null;

  const dropStaleJob = async () => {
    const old = staleJobId;
    if (!old) return;
    staleJobId = null;
    await deleteJob(old).catch(() => {});
    await refreshJobs().catch(() => {});
  };

  /** Resolves true when the job was written. */
  const writeJob = async (status: JobStatus, note: string | null): Promise<boolean> => {
    const { studyId, url } = get();
    if (!studyId) return false;
    const job: Job = {
      id: studyChatId(studyId),
      kind: 'study-style',
      title: 'Study a video for a new style',
      projectId: null,
      chatId: studyChatId(studyId),
      agentId: agent,
      status,
      progress: null,
      sourceUrl: url,
      note: note ?? (status === 'working' ? url : null),
      updatedAt: new Date().toISOString(),
    };
    try {
      await upsertJob(job);
    } catch {
      /* the job board is best effort */
      return false;
    }
    await refreshJobs().catch(() => {});
    return true;
  };

  /** Answers every open request with null (cancelled) and empties the queue. */
  const dropRequests = () => {
    const { request, queue } = get();
    set({ request: null, queue: [] });
    for (const r of [...(request ? [request] : []), ...queue]) {
      void agentRespondPermission(r.requestId, null).catch(() => {});
    }
  };

  /** The study's agent has nothing left to do once it ends, however it ends. */
  const stopAgent = () => {
    const { studyId } = get();
    if (studyId) void agentStop(studyChatId(studyId)).catch(() => {});
  };

  const fail = async (message: string) => {
    dropRequests();
    stopAgent();
    set({ phase: 'failed', finishing: false, error: message });
    if (await writeJob('failed', message)) await dropStaleJob();
  };

  const finish = async () => {
    const { studyId, url } = get();
    if (!studyId) return;
    dropRequests();
    stopAgent();
    try {
      const raw = await readStyleResult(studyId);
      const parsed = raw ? parseStyleResult(raw, url) : null;
      if (!parsed) return fail('The agent did not write a style Tayang could read. Try another video.');
      const style = { ...parsed, id: `copied-${studyId}`, createdAt: new Date().toISOString() };
      await saveStyle(style);
      // A short silent preview from the downloaded video. Never fails the study.
      set({ finishing: true });
      try {
        const made = await makeStylePreview(studyId, style.id);
        if (made) {
          await saveStyle({
            ...style,
            previewUrl: assetUrl(made.posterPath),
            previewVideoUrl: made.previewPath ? assetUrl(made.previewPath) : null,
          });
        }
      } catch {
        /* the style is saved without a preview */
      }
      set((s) => ({ phase: 'done', finishing: false, request: null, error: null, savedVersion: s.savedVersion + 1 }));
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
        if (update.kind === 'tool') {
          if (update.toolCallId.startsWith('auto-')) set((s) => ({ ranLog: [...s.ranLog, update.title] }));
          else set((s) => ({ toolCalls: s.toolCalls + (update.status === 'done' ? 1 : 0) }));
        }
        else if (update.kind === 'error') void fail(agentErrorText(update.message, agent));
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
    ranLog: [],
    request: null,
    queue: [],
    error: null,
    finishing: false,
    savedVersion: 0,

    async start(url, agentId, replaceJobId) {
      if (get().phase === 'running') return;
      agent = agentId;
      const studyId = newId();
      set({ phase: 'running', finishing: false, url, studyId, toolCalls: 0, ranLog: [], request: null, queue: [], error: null });
      staleJobId = replaceJobId ?? null;
      listen();
      try {
        const dir = await studyDir(studyId);
        if (await writeJob('working', null)) await dropStaleJob();
        // Style studies always run in auto mode (the app enforces it too).
        await agentStart(studyChatId(studyId), agentId, true);
        await agentPrompt(studyChatId(studyId), [{ type: 'text', text: buildStudyStylePrompt(url, dir) }]);
      } catch (e) {
        await fail(agentErrorText(e instanceof Error ? e.message : String(e), agentId));
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

    async cancel() {
      const { phase, studyId } = get();
      if (phase !== 'running' || !studyId) return;
      await agentCancel(studyChatId(studyId)).catch(() => {});
      await fail('Cancelled');
    },

    dismiss: () => set({ phase: 'idle', error: null, studyId: null, url: '' }),
  };
});
