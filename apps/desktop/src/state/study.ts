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
  removeStudyDir,
  studyDir,
  upsertJob,
} from '@/lib/ipc';
import { agentErrorText } from '@/lib/agents';
import { onAgentUpdate, onPermission } from '@/lib/events';
import { refreshJobs } from '@/state/jobs';

/** `finishing`: the agent is done and Tayang is saving the style and making its preview; it can't be cancelled. */
export type StudyPhase = 'idle' | 'running' | 'finishing' | 'done' | 'failed';

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
  const writeJob = async (
    status: JobStatus,
    note: string | null,
    studyId: string | null = get().studyId,
    url: string = get().url,
  ): Promise<boolean> => {
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
  const stopAgent = async (studyId: string | null) => {
    if (studyId) await agentStop(studyChatId(studyId)).catch(() => {});
  };

  /** The study folder (download, frames, result) is only ever needed while the study runs. */
  const cleanUp = async (studyId: string | null) => {
    if (studyId) await removeStudyDir(studyId).catch(() => {});
  };

  const fail = async (message: string) => {
    const { studyId, url } = get();
    dropRequests();
    set({ phase: 'failed', error: message });
    // Stop the agent first (it may still be writing the download), then delete what it left behind.
    await stopAgent(studyId);
    await cleanUp(studyId);
    // Another study may have started meanwhile: never write the old one's state over it.
    if (get().studyId !== studyId) return;
    if (await writeJob('failed', message, studyId, url)) await dropStaleJob();
  };

  const finish = async () => {
    const { studyId, url } = get();
    if (!studyId || get().phase !== 'running') return;
    // From here the study can't be cancelled and late agent events are ignored.
    set({ phase: 'finishing' });
    dropRequests();
    await stopAgent(studyId);
    const mine = () => get().studyId === studyId && get().phase === 'finishing';
    try {
      const raw = await readStyleResult(studyId);
      const parsed = raw ? parseStyleResult(raw, url) : null;
      if (!mine()) return;
      if (!parsed) return fail('The agent did not write a style Tayang could read. Try another video.');
      const style = { ...parsed, id: `copied-${studyId}`, createdAt: new Date().toISOString() };
      await saveStyle(style);
      // A short silent preview from the downloaded video. Never fails the study.
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
      await cleanUp(studyId);
      if (!mine()) return;
      set((s) => ({ phase: 'done', request: null, error: null, savedVersion: s.savedVersion + 1 }));
      await writeJob('done', parsed.name, studyId, url);
    } catch (e) {
      if (mine()) await fail(e instanceof Error ? e.message : String(e));
      else await cleanUp(studyId);
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
    savedVersion: 0,

    async start(url, agentId, replaceJobId) {
      if (get().phase === 'running' || get().phase === 'finishing') return;
      agent = agentId;
      const studyId = newId();
      set({ phase: 'running', url, studyId, toolCalls: 0, ranLog: [], request: null, queue: [], error: null });
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
