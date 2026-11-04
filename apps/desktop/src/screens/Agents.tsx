import { useCallback, useEffect, useState } from 'react';
import type { AgentInfo, Job, JobStatus, Project } from '@tayang/shared';
import { AgentLogo } from '@/components/AgentLogo';
import { Button } from '@/components/Button';
import { Oyen, type OyenMood } from '@/components/Oyen';
import { AGENT_NAMES, CLOSED_DRAFT, CLOSED_NOTE } from '@/lib/agents';
import { onAgentUpdate } from '@/lib/events';
import { deleteJob, detectAgents, listProjects } from '@/lib/ipc';
import { ago } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useApp } from '@/state/app';
import { useStudy } from '@/state/study';
import { refreshJobs } from '@/state/jobs';

const COLUMNS: { name: string; mood: OyenMood; match(s: JobStatus): boolean }[] = [
  { name: 'Queued', mood: 'wink', match: (s) => s === 'queued' },
  { name: 'Working', mood: 'sleepy', match: (s) => s === 'working' },
  { name: 'Needs you', mood: 'default', match: (s) => s === 'needs-you' || s === 'failed' },
  { name: 'Done', mood: 'happy', match: (s) => s === 'done' },
];

function JobCard({ job, project, onDismiss }: { job: Job; project: string; onDismiss(): void }) {
  const navigate = useApp((s) => s.navigate);
  const studyRunning = useStudy((s) => s.phase === 'running');
  const [starting, setStarting] = useState(false);
  const failed = job.status === 'failed';
  const working = job.status === 'working';
  const tryDisabled = job.kind === 'study-style' && !!job.sourceUrl && (starting || studyRunning);
  const needs = failed || job.status === 'needs-you';
  const open = () => {
    if (job.kind === 'study-style') {
      if (!job.sourceUrl) {
        navigate({ name: 'style', focusLink: true });
        return;
      }
      if (starting || studyRunning) return;
      setStarting(true);
      // The old job goes away once the new study's job is written; a failed start leaves its own failed job.
      void useStudy
        .getState()
        .start(job.sourceUrl, job.agentId, job.id)
        .finally(() => {
          setStarting(false);
          navigate({ name: 'style' });
        });
    } else if (!job.chatId) navigate({ name: 'style' });
    else if (failed && job.note === CLOSED_NOTE) navigate({ name: 'chat', chatId: job.chatId, draft: CLOSED_DRAFT });
    else navigate({ name: 'chat', chatId: job.chatId });
  };
  return (
    <article
      className={cn(
        'relative flex flex-col gap-2 overflow-hidden rounded-md border bg-card p-3',
        failed ? 'border-deep-orange' : 'border-border',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-text-2">{AGENT_NAMES[job.agentId]}</span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-text-3">
          {working && <span aria-hidden="true" className="tayang-pulse size-1.5 rounded-full bg-primary" />}
          {working ? `working · ${ago(job.updatedAt)}` : ago(job.updatedAt)}
        </span>
      </div>
      <span className="text-sm leading-[1.4] font-medium">{job.title}</span>
      <span className="text-xs text-text-3">{project}</span>
      {job.progress != null && (
        <div className="flex flex-col gap-2">
          <div className="h-1 overflow-hidden rounded-[2px] bg-raised" aria-hidden="true">
            <div
              className={cn('h-full', job.status === 'done' ? 'bg-text-3' : 'bg-primary')}
              style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}
            />
          </div>
          {job.note && <span className="text-xs text-text-2">{job.note}</span>}
        </div>
      )}
      {job.progress == null && job.note && !needs && <span className="text-xs text-text-2">{job.note}</span>}
      {needs && (
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            {failed && <Oyen mood="surprised" size={24} />}
            {job.note && <span className="text-xs leading-normal text-[#D9D9D9]">{job.note}</span>}
          </div>
          <div className="flex items-center gap-2 self-start">
            <Button
              variant="secondary"
              className="h-8 rounded-sm px-3 text-[13px]"
              disabled={tryDisabled}
              title={tryDisabled && studyRunning ? 'Another study is running' : undefined}
              onClick={open}
            >
              {failed ? (job.kind === 'study-style' ? 'Try again' : 'Fix it') : 'Review'}
            </Button>
            {failed && (
              <Button variant="ghost" className="h-8 rounded-sm px-2 text-[13px]" onClick={onDismiss}>
                Dismiss
              </Button>
            )}
          </div>
        </div>
      )}
      {working && (
        <div
          role="progressbar"
          aria-label="Working"
          className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-raised"
        >
          <div className="tayang-indeterminate h-full bg-primary" />
        </div>
      )}
    </article>
  );
}

export function Agents() {
  const navigate = useApp((s) => s.navigate);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const load = useCallback(() => {
    refreshJobs()
      .then(setJobs)
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    detectAgents()
      .then(setAgents)
      .catch(() => {});
    listProjects()
      .then(setProjects)
      .catch(() => {});
    const un = onAgentUpdate(({ update }) => {
      if (update.kind === 'done' || update.kind === 'error') load();
    });
    return () => void un.then((fn) => fn());
  }, [load]);

  const projectName = (j: Job) =>
    j.projectId ? (projects.find((p) => p.id === j.projectId)?.title ?? '') : j.kind === 'study-style' ? 'Style library' : '';

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-8">
      <div data-tauri-drag-region className="flex flex-wrap items-center gap-4">
        <div className="mr-auto flex flex-col gap-1">
          <h1 className="m-0 text-[28px] font-semibold tracking-[-0.01em]">Agents</h1>
          <span className="text-sm text-text-2">What your AI agents are working on</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {agents
            .filter((a) => a.installed)
            .map((a) => {
              const working = jobs.some((j) => j.agentId === a.id && j.status === 'working');
              return (
                <span
                  key={a.id}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card pr-3 pl-2 text-[13px]"
                >
                  <AgentLogo id={a.id} size={20} />
                  {AGENT_NAMES[a.id]} · {working ? 'working' : 'idle'}
                </span>
              );
            })}
          <Button variant="ghost" className="h-9 px-3 text-[13px]" onClick={() => navigate({ name: 'settings' })}>
            Connect agent
          </Button>
        </div>
      </div>

      <div className="grid items-start gap-4 overflow-x-auto" style={{ gridTemplateColumns: 'repeat(4, minmax(220px, 1fr))' }}>
        {COLUMNS.map((col) => {
          const cards = jobs.filter((j) => col.match(j.status));
          return (
            <section
              key={col.name}
              aria-label={col.name}
              className="flex min-h-[600px] flex-col gap-2 rounded-2xl border border-border bg-[#101010] p-2"
            >
              <div className="flex items-center gap-2 p-1">
                <Oyen mood={col.mood} size={24} />
                <span className="text-[13px] font-medium">{col.name}</span>
                <span className="font-mono text-xs text-text-3">{cards.length}</span>
              </div>
              {cards.map((j) => (
                <JobCard
                  key={j.id}
                  job={j}
                  project={projectName(j)}
                  onDismiss={() => void deleteJob(j.id).then(load, load)}
                />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
