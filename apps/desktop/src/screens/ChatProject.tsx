import { useEffect, useRef, useState } from 'react';
import type { AgentId, Chat, MessagePart, Project, VideoKind } from '@tayang/shared';
import { SKIP_FRAME_CHECK } from '@tayang/skills';
import { Button } from '@/components/Button';
import { Composer } from '@/components/Composer';
import { MessageList } from '@/components/MessageList';
import { PermissionCard } from '@/components/PermissionCard';
import { Preview } from '@/screens/preview/Preview';
import { StepBar } from '@/components/StepBar';
import { getChat, listProjects, mediaProbe, mediaRender, renderCommand, updateProject, type RenderCommand } from '@/lib/ipc';
import { useApp } from '@/state/app';
import { headPermission, useChat, type SendOpts } from '@/state/chat';
import { useUsage } from '@/state/usage';

const NO_MESSAGES: never[] = [];
/** One argv as a shell-looking line: arguments with spaces or quotes are double-quoted. */
const shellDisplay = (argv: string[]) =>
  argv.map((a) => (/[\s"']/.test(a) ? `"${a.replace(/(["\\])/g, '\\$1')}"` : a)).join(' ');
const KIND: Record<VideoKind, string> = {
  explainer: 'Explainer',
  promo: 'Promo',
  quote: 'Quote',
  news: 'News',
  tutorial: 'Tutorial',
  data: 'Data',
  event: 'Event',
};

export function ChatProject({ chatId }: { chatId: string }) {
  const defaultAgent = useApp((s) => s.settings?.defaultAgent ?? 'claude');
  const [chat, setChat] = useState<Chat | null>(null);
  const agent = chat?.agentId ?? defaultAgent;
  const [project, setProject] = useState<Project | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [runs, setRuns] = useState<RenderCommand | null>(null);
  const messages = useChat((s) => s.messages[chatId]) ?? NO_MESSAGES;
  const streaming = useChat((s) => !!s.streaming[chatId]);
  const permission = useChat((s) => headPermission(s, chatId));

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

  // A project with a tayang.json renders with its own command: show it before the user presses Render.
  useEffect(() => {
    if (!project) return;
    let alive = true;
    renderCommand(project.id)
      .then((c) => alive && setRuns(c))
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
  useEffect(() => {
    if (wasStreaming.current && !streaming && messages.at(-1)?.role !== 'system') setReloadKey((k) => k + 1);
    wasStreaming.current = streaming;
  }, [streaming, messages]);

  /** What every send from this screen carries: the composer's and an answered A2UI surface's alike. */
  const sendOptions = (prompt: MessagePart[]): SendOpts => {
    // The brief's frame check applies to projects made while it was on; this covers turning it off later.
    const skip = useApp.getState().settings?.frameCheck === false;
    const job = project ? { projectId: project.id, title: project.title } : undefined;
    return {
      job,
      agentId: agent,
      ...(skip ? { promptParts: [{ type: 'text', text: SKIP_FRAME_CHECK }, ...prompt] } : {}),
    };
  };

  const send = (parts: MessagePart[]) => {
    void useChat.getState().send(chatId, parts, sendOptions(parts));
  };

  const renderVideo = async () => {
    if (!project || rendering) return;
    setRendering(true);
    setRenderError(null);
    try {
      await mediaRender(project.id);
      const info = await mediaProbe(project.id).catch(() => null);
      setProject(await updateProject(project.id, { status: 'rendered', durationSec: info?.durationSec ?? null }));
      useApp.getState().bumpProjects();
      setReloadKey((k) => k + 1);
    } catch (e) {
      setRenderError(`Couldn't render: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRendering(false);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header data-tauri-drag-region className="flex h-16 shrink-0 items-center gap-6 border-b border-border px-6">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-medium">{project?.title ?? 'Chat'}</span>
          {project && (
            <span className="text-xs text-text-3">
              {KIND[project.kind]} · {project.format} · {project.language === 'id' ? 'Bahasa Indonesia' : 'English'}
            </span>
          )}
        </div>
        {project && (
          <div className="ml-auto">
            <StepBar status={project.status} />
          </div>
        )}
        <Button
          variant="primary"
          disabled={!project || rendering || streaming}
          className={project ? '' : 'ml-auto'}
          onClick={() => void renderVideo()}
        >
          {rendering ? 'Rendering…' : 'Render video'}
        </Button>
      </header>
      {runs && runs.render.length > 0 && (
        <p className="m-0 border-b border-border px-6 py-2 font-mono text-xs break-words text-text-3">
          Runs: {[...(runs.install?.length ? [runs.install] : []), runs.render].map(shellDisplay).join(' && ')}
        </p>
      )}
      {renderError && (
        <p role="alert" className="m-0 border-b border-border px-6 py-2 text-xs text-orange-light">
          {renderError}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <section aria-label="Conversation" className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <MessageList messages={messages} streaming={streaming} sendOptions={sendOptions}>
              {permission && (
                <PermissionCard
                  request={permission}
                  agentId={agent}
                  allowLabel="Allow"
                  onRespond={(o) => void useChat.getState().respondPermission(chatId, o)}
                />
              )}
            </MessageList>
          </div>
          <div className="px-6 pb-6 pt-2">
            <Composer
              chatId={chatId}
              onSend={send}
              disabled={streaming}
              onStop={() => void useChat.getState().cancel(chatId)}
              agentId={agent}
              onAgentChange={(a) => void switchAgent(a)}
              quickChips
              sees={project?.title}
            />
          </div>
        </section>
        <section aria-label="Preview" className="w-[360px] shrink-0 border-l border-border">
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
