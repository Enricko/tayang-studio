import { useEffect, useState } from 'react';
import type { Chat, MessagePart, Project, VideoKind } from '@tayang/shared';
import { Button } from '@/components/Button';
import { Composer } from '@/components/Composer';
import { MessageList } from '@/components/MessageList';
import { PermissionCard } from '@/components/PermissionCard';
import { Preview } from '@/screens/preview/Preview';
import { StepBar } from '@/components/StepBar';
import { getChat, listProjects } from '@/lib/ipc';
import { useApp } from '@/state/app';
import { headPermission, useChat } from '@/state/chat';

const NO_MESSAGES: never[] = [];
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
  const agent = useApp((s) => s.settings?.defaultAgent ?? 'claude');
  const [project, setProject] = useState<Project | null>(null);
  const messages = useChat((s) => s.messages[chatId]) ?? NO_MESSAGES;
  const streaming = useChat((s) => !!s.streaming[chatId]);
  const permission = useChat((s) => headPermission(s, chatId));

  useEffect(() => {
    useChat.getState().listen();
    void useChat.getState().load(chatId);
    let alive = true;
    Promise.all([getChat(chatId), listProjects()])
      .then(([chat, projects]: [Chat | null, Project[]]) => {
        if (alive) setProject(projects.find((p) => p.id === chat?.projectId) ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [chatId]);

  const send = (parts: MessagePart[]) => void useChat.getState().send(chatId, parts);

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
        <Button variant="primary" disabled className={project ? '' : 'ml-auto'}>
          Render video
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <section aria-label="Conversation" className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <MessageList messages={messages} streaming={streaming}>
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
              quickChips
              sees={project?.title}
            />
          </div>
        </section>
        <section aria-label="Preview" className="w-[360px] shrink-0 border-l border-border">
          {project ? <Preview projectId={project.id} chatId={chatId} /> : <div data-testid="preview-slot" />}
        </section>
      </div>
    </div>
  );
}
