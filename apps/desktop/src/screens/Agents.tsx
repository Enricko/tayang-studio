import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentInfo, Job, JobStatus, Project } from '@tayang/shared';
import { AgentLogo } from '@/components/AgentLogo';
import { Button } from '@/components/Button';
import { Oyen, type OyenMood } from '@/components/Oyen';
import { AGENT_NAMES, CLOSED_NOTE } from '@/lib/agents';
import { onAgentUpdate } from '@/lib/events';
import { deleteJob, detectAgents, getChat, listProjects } from '@/lib/ipc';
import { settleLateRenders } from '@/lib/buildJobs';
import { sendInProjectChat } from '@/lib/openProject';
import { localized, stored } from '@/lib/stored';
import { ago } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useApp } from '@/state/app';
import { useStudy } from '@/state/study';
import { refreshJobs, useJobs } from '@/state/jobs';

const COLUMNS: { key: 'queued' | 'working' | 'needsYou' | 'done'; mood: OyenMood; match(s: JobStatus): boolean }[] = [
  { key: 'queued', mood: 'wink', match: (s) => s === 'queued' },
  { key: 'working', mood: 'sleepy', match: (s) => s === 'working' },
  { key: 'needsYou', mood: 'default', match: (s) => s === 'needs-you' || s === 'failed' },
  { key: 'done', mood: 'happy', match: (s) => s === 'done' },
];

/** The notes of a build job whose turn ended without a video: its card offers Continue. */
const isStoppedNote = (note: string) => note === stored('agents.noVideo') || note === stored('agents.waitingAnswer');

function JobCard({ job, project, onDismiss }: { job: Job; project: string; onDismiss(): void }) {
  const navigate = useApp((s) => s.navigate);
  const { t } = useTranslation();
  const studyRunning = useStudy((s) => s.phase === 'running' || s.phase === 'finishing');
  const [starting, setStarting] = useState(false);
  const failed = job.status === 'failed';
  const working = job.status === 'working';
  const tryDisabled = job.kind === 'study-style' && !!job.sourceUrl && (starting || studyRunning);
  const needs = failed || job.status === 'needs-you';
  // A build turn that ended without a video: open its chat, or tell the agent to go on and render.
  const stopped = job.kind === 'build' && job.status === 'needs-you' && !!job.chatId && !!job.note && isStoppedNote(job.note);
  const [continuing, setContinuing] = useState(false);
  const goOn = async () => {
    if (!job.chatId || !job.projectId || continuing) return;
    setContinuing(true);
    try {
      // The chat may have moved to another agent since the job was written: its row says which.
      let agent = job.agentId;
      try {
        agent = (await getChat(job.chatId))?.agentId ?? agent;
      } catch {
        /* the job's agent, then */
      }
      await sendInProjectChat(job.chatId, { id: job.projectId, title: job.title }, agent, t('agents.continuePrompt'));
    } finally {
      setContinuing(false);
    }
  };
  const open = () => {
    if (job.kind === 'study-style') {
      if (!job.sourceUrl) {
        navigate({ name: 'style', focusLink: true });
        return;
      }
      if (starting || studyRunning) return;
      setStarting(true);
      // The old job goes away once the new study's job is written; a failed start leaves its own failed job.
      // `start` marks the study running right away: show it without waiting for the agent.
      const started = useStudy.getState().start(job.sourceUrl, job.agentId, job.id);
      navigate({ name: 'style' });
      void started.finally(() => setStarting(false));
    } else if (!job.chatId) navigate({ name: 'style' });
    else if (failed && job.note === CLOSED_NOTE) navigate({ name: 'chat', chatId: job.chatId, draft: t('agents.closedDraft') });
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
          {working ? t('agents.workingAgo', { ago: ago(job.updatedAt) }) : ago(job.updatedAt)}
        </span>
      </div>
      <span className="text-sm leading-[1.4] font-medium">{job.kind === 'study-style' ? localized(job.title) : job.title}</span>
      <span className="text-xs text-text-3">{project}</span>
      {job.progress != null && (
        <div className="flex flex-col gap-2">
          <div className="h-1 overflow-hidden rounded-[2px] bg-raised" aria-hidden="true">
            <div
              className={cn('h-full', job.status === 'done' ? 'bg-text-3' : 'bg-primary')}
              style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}
            />
          </div>
          {job.note && <span className="text-xs text-text-2">{localized(job.note)}</span>}
        </div>
      )}
      {job.progress == null && job.note && !needs && <span className="text-xs text-text-2">{localized(job.note)}</span>}
      {needs && (
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            {failed && <Oyen mood="surprised" size={24} />}
            {job.note && <span className="text-xs leading-normal text-[#D9D9D9]">{localized(job.note)}</span>}
          </div>
          <div className="flex items-center gap-2 self-start">
            <Button
              variant="secondary"
              className="h-8 rounded-sm px-3 text-[13px]"
              disabled={tryDisabled}
              title={tryDisabled && studyRunning ? t('agents.anotherStudy') : undefined}
              onClick={open}
            >
              {failed ? (job.kind === 'study-style' ? t('agents.tryAgain') : t('agents.fixIt')) : stopped ? t('agents.openChat') : t('agents.review')}
            </Button>
            {stopped && job.projectId && (
              <Button variant="ghost" className="h-8 rounded-sm px-3 text-[13px]" disabled={continuing} onClick={() => void goOn()}>
                {t('agents.continue')}
              </Button>
            )}
            {failed && (
              <Button variant="ghost" className="h-8 rounded-sm px-2 text-[13px]" onClick={onDismiss}>
                {t('agents.dismiss')}
              </Button>
            )}
          </div>
        </div>
      )}
      {working && (
        <div
          role="progressbar"
          aria-label={t('agents.progressAria')}
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
  const { t } = useTranslation();
  const jobs = useJobs((s) => s.jobs);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const load = useCallback(() => {
    // A render that finished after its turn ended makes that job done.
    refreshJobs()
      .then((jobs) => settleLateRenders(Date.now(), jobs))
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
    j.projectId ? (projects.find((p) => p.id === j.projectId)?.title ?? '') : j.kind === 'study-style' ? t('agents.styleLibrary') : '';

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-8">
      <div data-tauri-drag-region className="flex flex-wrap items-center gap-4">
        <div className="mr-auto flex flex-col gap-1">
          <h1 className="m-0 text-[28px] font-semibold tracking-[-0.01em]">{t('agents.title')}</h1>
          <span className="text-sm text-text-2">{t('agents.subtitle')}</span>
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
                  {AGENT_NAMES[a.id]} · {working ? t('agents.working') : t('agents.idle')}
                </span>
              );
            })}
          <Button variant="ghost" className="h-9 px-3 text-[13px]" onClick={() => navigate({ name: 'settings' })}>
            {t('agents.connectAgent')}
          </Button>
        </div>
      </div>

      <div className="grid items-start gap-4 overflow-x-auto" style={{ gridTemplateColumns: 'repeat(4, minmax(220px, 1fr))' }}>
        {COLUMNS.map((col) => {
          const cards = jobs.filter((j) => col.match(j.status));
          const name = t(`agents.columns.${col.key}`);
          return (
            <section
              key={col.key}
              aria-label={name}
              className="flex min-h-[600px] flex-col gap-2 rounded-2xl border border-border bg-[#101010] p-2"
            >
              <div className="flex items-center gap-2 p-1">
                <Oyen mood={col.mood} size={24} />
                <span className="text-[13px] font-medium">{name}</span>
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
