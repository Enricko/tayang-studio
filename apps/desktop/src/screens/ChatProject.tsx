import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentId, Chat, MessagePart, Project } from '@tayang/shared';
import { Button } from '@/components/Button';
import { Composer } from '@/components/Composer';
import { MessageList } from '@/components/MessageList';
import { PermissionCard } from '@/components/PermissionCard';
import { ResizeHandle } from '@/components/ResizeHandle';
import { Preview } from '@/screens/preview/Preview';
import { ScheduleDialog } from '@/components/ScheduleDialog';
import { ScrollToBottom } from '@/components/ScrollToBottom';
import { TurnRail } from '@/components/TurnRail';
import { StepBar } from '@/components/StepBar';
import { useStyles } from '@/components/TemplateChip';
import { styleContext } from '@/lib/mentions';
import { getChat, listProjects, mediaProbe, mediaRender, renderCommand, updateProject, type RenderCommand } from '@/lib/ipc';
import { LANGUAGE_NAMES } from '@/i18n';
import { projectSendOptions } from '@/lib/openProject';
import { useApp } from '@/state/app';
import { headPermission, useChat, type SendOpts } from '@/state/chat';
import { useUsage } from '@/state/usage';
import { PREVIEW, useFittedLayout, useLayout } from '@/state/layout';
import { setRenderArgv, useRender } from '@/state/render';
import { advanceProject } from '@/lib/projectStatus';

const NO_MESSAGES: never[] = [];
/** One argv as a shell-looking line: arguments with spaces or quotes are double-quoted. */
const shellDisplay = (argv: string[]) =>
  argv.map((a) => (/[\s"']/.test(a) ? `"${a.replace(/(["\\])/g, '\\$1')}"` : a)).join(' ');

export function ChatProject({ chatId, draft }: { chatId: string; draft?: string }) {
  const { t } = useTranslation();
  const defaultAgent = useApp((s) => s.settings?.defaultAgent ?? 'claude');
  const [chat, setChat] = useState<Chat | null>(null);
  const agent = chat?.agentId ?? defaultAgent;
  const [project, setProject] = useState<Project | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [runs, setRuns] = useState<RenderCommand | null>(null);
  const messages = useChat((s) => s.messages[chatId]) ?? NO_MESSAGES;
  const streaming = useChat((s) => !!s.streaming[chatId]);
  const permission = useChat((s) => headPermission(s, chatId));
  const fitted = useFittedLayout(true);
  const renderRunning = useRender((s) => (project ? !!s.runs[project.id] : false));
  const projectsVersion = useApp((s) => s.projectsVersion);
  const seenVersion = useRef(projectsVersion);
  const styles = useStyles();

  useEffect(() => {
    useChat.getState().listen();
    void useChat.getState().load(chatId);
    let alive = true;
    Promise.all([getChat(chatId), listProjects()])
      .then(([found, projects]: [Chat | null, Project[]]) => {
        if (!alive) return;
        setChat(found);
        setProject(projects.find((p) => p.id === found?.projectId) ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [chatId]);

  // The project moved on (its status, a schedule): the header follows.
  useEffect(() => {
    if (!project || projectsVersion === seenVersion.current) return;
    seenVersion.current = projectsVersion;
    let alive = true;
    listProjects()
      .then((all) => {
        const found = all.find((p) => p.id === project.id);
        if (alive && found) setProject(found);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectsVersion, project?.id]);

  // A project with a tayang.json renders with its own command: show it before the user presses Render.
  useEffect(() => {
    if (!project) return;
    let alive = true;
    renderCommand(project.id)
      .then((c) => {
        // The chat spots the agent running this exact command as a render.
        setRenderArgv(project.id, c?.render ?? null);
        if (alive) setRuns(c);
      })
      .catch(() => alive && setRuns(null));
    return () => {
      alive = false;
    };
    // the agent may add tayang.json or node_modules during a turn, and a render installs: refetch on both
  }, [project?.id, reloadKey]);

  useEffect(() => {
    useUsage.getState().setChatAgent(agent);
    return () => useUsage.getState().setChatAgent(null);
  }, [agent]);

  const switchAgent = async (next: AgentId) => {
    if (next === agent || streaming) return;
    try {
      await useChat.getState().switchAgent(chatId, next);
      setChat((c) => (c ? { ...c, agentId: next } : c));
    } catch {
      /* the chat keeps its agent */
    }
  };

  // When a turn ends well the agent may have rendered a new version: reload the preview.
  const wasStreaming = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (wasStreaming.current && !streaming && messages.at(-1)?.role !== 'system') setReloadKey((k) => k + 1);
    wasStreaming.current = streaming;
  }, [streaming, messages]);

  /** What every send from this screen carries: the composer's and an answered A2UI surface's alike. */
  const sendOptions = (prompt: MessagePart[]): SendOpts => projectSendOptions(project, agent, prompt);

  const send = (parts: MessagePart[]) => {
    const opts = sendOptions(parts);
    // A mentioned style is context for this message; the project keeps its own style and template.
    const ctx = styleContext(parts, styles);
    if (ctx.length) opts.promptParts = [...ctx, ...(opts.promptParts ?? parts)];
    void useChat.getState().send(chatId, parts, opts);
  };

  const renderVideo = async () => {
    if (!project || rendering) return;
    setRendering(true);
    setRenderError(null);
    useRender.getState().start(project.id, { source: 'tayang' });
    try {
      await mediaRender(project.id);
      const info = await mediaProbe(project.id).catch(() => null);
      await advanceProject(project.id, 'rendered');
      setProject(await updateProject(project.id, { durationSec: info?.durationSec ?? null }));
      useApp.getState().bumpProjects();
      setReloadKey((k) => k + 1);
    } catch (e) {
      setRenderError(t('chat.couldntRender', { message: e instanceof Error ? e.message : String(e) }));
    } finally {
      setRendering(false);
      useRender.getState().end(project.id);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header data-tauri-drag-region className="flex h-16 shrink-0 items-center gap-6 border-b border-border px-6">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-medium">{project?.title ?? t('chat.title')}</span>
          {project && (
            <span className="text-xs text-text-3">
              {t(`kinds.${project.kind}`)} · {project.format} · {LANGUAGE_NAMES[project.language]}
            </span>
          )}
        </div>
        {project && (
          <div className="ml-auto">
            <StepBar status={project.status} rendering={renderRunning} />
          </div>
        )}
        {project && (
          <Button variant="secondary" onClick={() => setScheduling(true)}>
            {t('schedule.action')}
          </Button>
        )}
        <Button
          variant="primary"
          disabled={!project || rendering || streaming}
          className={project ? '' : 'ml-auto'}
          onClick={() => void renderVideo()}
        >
          {rendering ? t('chat.rendering') : t('chat.render')}
        </Button>
      </header>
      <ScheduleDialog open={scheduling} onOpenChange={setScheduling} project={project} onSaved={setProject} />
      {runs && runs.render.length > 0 && (
        <p className="m-0 border-b border-border px-6 py-2 font-mono text-xs break-words text-text-3">
          {t('chat.renderCommand', { commands: [...(runs.install?.length ? [runs.install] : []), runs.render].map(shellDisplay).join(' && ') })}
        </p>
      )}
      {renderError && (
        <p role="alert" className="m-0 border-b border-border px-6 py-2 text-xs text-orange-light">
          {renderError}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <section aria-label={t('chat.conversation')} className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} className="no-scrollbar h-full overflow-y-auto px-6 py-6">
            <MessageList messages={messages} streaming={streaming} sendOptions={sendOptions} scrollRef={scrollRef}>
              {permission && (
                <PermissionCard
                  request={permission}
                  agentId={agent}
                  allowLabel={t('permission.allow')}
                  onRespond={(o) => void useChat.getState().respondPermission(chatId, o)}
                />
              )}
            </MessageList>
          </div>
          <TurnRail messages={messages} scrollRef={scrollRef} />
          <ScrollToBottom scrollRef={scrollRef} />
          </div>
          <div className="px-6 pb-6 pt-2">
            <Composer
              chatId={chatId}
              initialText={draft}
              onSend={send}
              disabled={streaming}
              onStop={() => void useChat.getState().cancel(chatId)}
              agentId={agent}
              onAgentChange={(a) => void switchAgent(a)}
              quickChips
              sees={project?.title}
              styles={styles}
              styleHint={project && !project.styleId ? t('composer.styleForMessage') : undefined}
            />
          </div>
        </section>
        <section
          id="chat-preview"
          aria-label={t('chat.preview')}
          className="relative shrink-0 border-l border-border"
          style={{ width: fitted.preview }}
        >
          <ResizeHandle
            label={t('layout.resizePreview')}
            side="left"
            aria-controls="chat-preview"
            value={fitted.preview}
            min={PREVIEW.min}
            max={fitted.previewMax}
            onResize={(w, live) => useLayout.getState().setPreview(Math.min(w, fitted.previewMax), live)}
            onReset={() => useLayout.getState().resetPreview()}
          />
          {project ? (
            <Preview
              projectId={project.id}
              chatId={chatId}
              reloadKey={reloadKey}
              onRender={() => void renderVideo()}
              rendering={rendering}
            />
          ) : (
            <div data-testid="preview-slot" />
          )}
        </section>
      </div>
    </div>
  );
}
