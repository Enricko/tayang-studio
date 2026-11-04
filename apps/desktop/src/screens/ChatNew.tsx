import { useEffect, useRef, useState } from 'react';
import { Link2, Lightbulb, Disc3 } from 'lucide-react';
import type { MessagePart, Project, Style, VideoKind } from '@tayang/shared';
import { BUILTIN_STYLES, buildProjectBrief, buildTopicIdeasPrompt, parseTopicIdeas } from '@tayang/skills';
import oyen from '@/assets/brand/oyen-expr-default.svg';
import { Composer, type MentionRef } from '@/components/Composer';
import { MessageList } from '@/components/MessageList';
import { PermissionCard } from '@/components/PermissionCard';
import { createChat, createProject, listProjects, listStyles } from '@/lib/ipc';
import { useApp } from '@/state/app';
import { headPermission, useChat } from '@/state/chat';

const KINDS: VideoKind[] = ['explainer', 'promo', 'quote', 'news', 'tutorial', 'data', 'event'];
const NO_MESSAGES: never[] = [];

type Idea = { title: string; kind: VideoKind; lengthSec: number };

function agentText(parts: MessagePart[]) {
  return parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
}

export function ChatNew() {
  const settings = useApp((s) => s.settings);
  const navigate = useApp((s) => s.navigate);
  const [projects, setProjects] = useState<Project[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [mention, setMention] = useState<MentionRef | null>(null);
  const [seen, setSeen] = useState<string[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [signal, setSignal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const topicPending = useRef(false);

  const messages = useChat((s) => (chatId ? s.messages[chatId] : undefined)) ?? NO_MESSAGES;
  const streaming = useChat((s) => (chatId ? !!s.streaming[chatId] : false));
  const permission = useChat((s) => headPermission(s, chatId));
  const agent = settings?.defaultAgent ?? 'claude';

  useEffect(() => {
    useChat.getState().listen();
    let alive = true;
    listProjects()
      .then((p) => alive && setProjects(p))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // When the topic turn ends, turn the agent's JSON into clickable cards.
  useEffect(() => {
    if (!chatId || streaming || !topicPending.current) return;
    const last = messages[messages.length - 1];
    if (last?.role === 'system') topicPending.current = false; // the turn failed
    if (last?.role !== 'agent') return;
    topicPending.current = false;
    setIdeas(parseTopicIdeas(agentText(last.parts)));
  }, [chatId, streaming, messages]);

  const ensureChat = async (title: string) => {
    if (chatId) return chatId;
    const c = await createChat(null, agent, title);
    setChatId(c.id);
    return c.id;
  };

  const context = async (parts: MessagePart[]): Promise<MessagePart[]> => {
    const out: MessagePart[] = [];
    const styles: Style[] = await listStyles().catch(() => []);
    for (const part of parts) {
      if (part.type !== 'mention' || seen.includes(part.projectId)) continue;
      const p = projects.find((x) => x.id === part.projectId);
      if (!p || !settings) continue;
      const style = [...styles, ...BUILTIN_STYLES].find((s) => s.id === p.styleId) ?? null;
      out.push({
        type: 'text',
        text: `The user attached the video "${p.title}". Its project folder is ${p.folder}.\n\n${buildProjectBrief(p, style, settings)}`,
      });
    }
    return out;
  };

  const onSend = async (parts: MessagePart[]): Promise<boolean> => {
    setError(null);
    const sentMention = mention;
    setMention(null);
    try {
      const text = parts.find((p) => p.type === 'text');
      const id = await ensureChat(text?.type === 'text' ? text.text.slice(0, 48) : 'New chat');
      const ctx = await context(parts);
      const failure = await useChat
        .getState()
        .send(id, parts, ctx.length ? { promptParts: [...ctx, ...parts] } : undefined);
      if (failure) throw new Error(failure);
      const ids = parts.flatMap((p) => (p.type === 'mention' ? [p.projectId] : []));
      setSeen((s) => [...new Set([...s, ...ids])]);
      return true;
    } catch (e) {
      setMention(sentMention);
      setError(`Couldn't start the chat: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  };

  const askTopics = async () => {
    if (!settings || streaming) return;
    const id = await ensureChat('Topic ideas');
    topicPending.current = true;
    setIdeas([]);
    void useChat.getState().send(id, [{ type: 'text', text: 'Suggest video topics for my channel' }], {
      promptParts: [{ type: 'text', text: buildTopicIdeasPrompt(KINDS, settings.language) }],
    });
  };

  const pickIdea = async (idea: Idea) => {
    if (!settings || busy) return;
    setBusy(true);
    try {
      const input = { title: idea.title, kind: idea.kind, format: settings.format, language: settings.language };
      const draft: Project = {
        id: '',
        slug: '',
        folder: '',
        status: 'draft',
        styleId: null,
        scheduledAt: null,
        durationSec: null,
        createdAt: '',
        updatedAt: '',
        ...input,
      };
      const project = await createProject(input, buildProjectBrief(draft, null, settings));
      useApp.getState().bumpProjects();
      const chat = await createChat(project.id, agent, idea.title);
      navigate({ name: 'chat', chatId: chat.id });
      void useChat
        .getState()
        .send(chat.id, [{ type: 'text', text: `Write the script for "${idea.title}", about ${idea.lengthSec} seconds.` }], {
          job: { projectId: project.id, title: project.title },
        });
    } catch {
      setBusy(false);
    }
  };

  const attached = new Set([...seen, ...(mention ? [mention.projectId] : [])]).size;
  const started = chatId !== null;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header
        data-tauri-drag-region
        className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-6"
      >
        <span className="text-[15px] font-medium">New chat</span>
        <span className="text-xs text-text-3">{attached === 0 ? 'No video attached' : `${attached} video attached`}</span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center px-6">
        <div className="flex min-h-0 w-full max-w-[720px] flex-1 flex-col justify-center gap-6 overflow-y-auto py-6">
          {!started ? (
            <>
              <div className="flex flex-col items-start gap-3">
                <img src={oyen} alt="Oyen" className="size-14" />
                <h1 className="m-0 text-[28px] font-semibold tracking-[-0.01em]">What are we making?</h1>
                <p className="m-0 text-[15px] leading-[1.6] text-text-2">
                  Start from a topic, remix a video you already made, or copy a style from a link.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <OptionCard icon={Lightbulb} title="From a topic" body="Oyen suggests ideas for your channel" onClick={askTopics} />
                <OptionCard icon={Disc3} title="Remix a video" body="Type @ and pick the video to work from" onClick={() => setSignal((n) => n + 1)} />
                <OptionCard icon={Link2} title="Copy a style" body="Paste a TikTok, Reels or YouTube link" onClick={() => navigate({ name: 'style' })} />
              </div>
            </>
          ) : (
            <div className="my-auto">
              <MessageList messages={messages} streaming={streaming}>
                {permission && chatId && (
                  <PermissionCard
                    request={permission}
                    agentId={agent}
                    allowLabel="Allow"
                    onRespond={(o) => void useChat.getState().respondPermission(chatId, o)}
                  />
                )}
                {ideas.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {ideas.map((idea) => (
                      <button
                        key={idea.title}
                        type="button"
                        disabled={busy}
                        onClick={() => void pickIdea(idea)}
                        className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left text-foreground transition-colors hover:bg-raised disabled:cursor-default disabled:opacity-60"
                      >
                        <span className="text-[14px] font-medium">{idea.title}</span>
                        <span className="font-mono text-xs text-text-3">
                          {idea.kind} · {idea.lengthSec}s
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </MessageList>
            </div>
          )}
        </div>

        <div className="w-full max-w-[720px] pb-6 pt-4">
          <Composer
            chatId={chatId}
            onSend={onSend}
            disabled={streaming}
            onStop={chatId ? () => void useChat.getState().cancel(chatId) : undefined}
            projects={projects}
            mention={mention}
            onMention={setMention}
            mentionSignal={signal}
            placeholder="Describe the video you want, or type @ to start from one you made"
          />
          {error && (
            <p role="alert" className="m-0 mt-2 text-xs text-orange-light">
              {error}
            </p>
          )}
          <p className="m-0 mt-2 text-xs text-text-3">
            A new chat doesn't see any of your videos until you mention one with @
          </p>
        </div>
      </div>
    </div>
  );
}

function OptionCard({
  icon: Icon,
  title,
  body,
  onClick,
}: {
  icon: typeof Lightbulb;
  title: string;
  body: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer flex-col items-start gap-2 rounded-xl border border-border bg-card p-4 text-left text-foreground transition-colors hover:bg-raised"
    >
      <Icon size={18} strokeWidth={1.5} className="text-text-2" aria-hidden="true" />
      <span className="text-[14px] font-medium">{title}</span>
      <span className="text-[13px] leading-normal text-text-3">{body}</span>
    </button>
  );
}
