import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, Lightbulb, Disc3 } from 'lucide-react';
import type { AgentId, MessagePart, Project, Style, VideoKind } from '@tayang/shared';
import { buildTopicIdeasPrompt } from '@tayang/skills';
import oyen from '@/assets/brand/oyen-expr-default.svg';
import { Composer, type MentionRef } from '@/components/Composer';
import { TemplateChip } from '@/components/TemplateChip';
import { createChat, listProjects, listStyles } from '@/lib/ipc';
import { mentionContext } from '@/lib/mentions';
import { useApp } from '@/state/app';
import { NEW_CHAT_DRAFT, useChat } from '@/state/chat';
import { useUsage } from '@/state/usage';

const KINDS: VideoKind[] = ['explainer', 'promo', 'quote', 'news', 'tutorial', 'data', 'event'];

/**
 * New chat: the start screen until the first send, topic ask or attachment makes the chat. Then the
 * route becomes that chat (ChatThread), so it is never lost when the user goes elsewhere.
 */
export function ChatNew() {
  const { t } = useTranslation();
  const settings = useApp((s) => s.settings);
  const navigate = useApp((s) => s.navigate);
  const routeStyleId = useApp((s) => (s.route.name === 'chat-new' ? (s.route.styleId ?? null) : null));
  // The template the user picked on the Style screen; it goes with the chat until a topic starts a project.
  const [styleId, setStyleId] = useState<string | null>(routeStyleId);
  const [projects, setProjects] = useState<Project[]>([]);
  const [mention, setMention] = useState<MentionRef | null>(null);
  const [signal, setSignal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const creating = useRef<Promise<string> | null>(null);
  const [picked, setPicked] = useState<AgentId | null>(null);
  const agent = picked ?? settings?.defaultAgent ?? 'claude';

  // An unsent Auto choice belongs to this screen only.
  useEffect(() => () => useChat.setState({ pendingAuto: null }), []);

  useEffect(() => {
    useUsage.getState().setChatAgent(agent);
    return () => useUsage.getState().setChatAgent(null);
  }, [agent]);

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

  /** The chat is made on the first send (or topic ask, or attachment); once, however many ask at the same time. */
  const ensureChat = (title: string) => {
    creating.current ??= createChat(null, agent, title).then(
      (c) => {
        useChat.getState().adoptPendingAuto(c.id);
        useChat.getState().rememberChat(c);
        useApp.setState({ newChatId: c.id });
        return c.id;
      },
      (e: unknown) => {
        creating.current = null;
        throw e;
      },
    );
    return creating.current;
  };

  /** The chat exists: the screen becomes that chat, so leaving and coming back finds it. */
  const openChat = (chatId: string, draft?: string) => {
    useChat.getState().setDraft(NEW_CHAT_DRAFT, '');
    navigate({ name: 'chat', chatId, ...(draft ? { draft } : {}), ...(styleId ? { styleId } : {}) });
  };

  const onSend = async (parts: MessagePart[]): Promise<boolean> => {
    setError(null);
    try {
      const text = parts.find((p) => p.type === 'text');
      const id = await ensureChat(text?.type === 'text' ? text.text.slice(0, 48) : t('chat.newChat'));
      const ctx = await mentionContext(parts, [], projects, settings);
      // The message is in the chat as soon as send starts; the chat screen shows the rest of the turn.
      void useChat
        .getState()
        .send(id, parts, { agentId: agent, ...(ctx.length ? { promptParts: [...ctx, ...parts] } : {}) });
      openChat(id);
      return true;
    } catch (e) {
      setError(t('chat.couldntStartChat', { message: e instanceof Error ? e.message : String(e) }));
      return false;
    }
  };

  const askTopics = async () => {
    if (!settings) return;
    setError(null);
    try {
      const id = await ensureChat(t('chat.topicIdeas'));
      const styles = await listStyles().catch(() => [] as Style[]);
      void useChat.getState().send(id, [{ type: 'text', text: t('chat.suggestTopics') }], {
        agentId: agent,
        promptParts: [{ type: 'text', text: buildTopicIdeasPrompt(KINDS, settings.language, styles.map((s) => ({ id: s.id, name: s.name }))) }],
      });
      openChat(id);
    } catch (e) {
      setError(t('chat.couldntStartChat', { message: e instanceof Error ? e.message : String(e) }));
    }
  };

  /** Attaching a file makes the chat: the typed text goes along, unsent. */
  const ensureForAttach = async () => {
    const id = await ensureChat(t('chat.newChat'));
    openChat(id, useChat.getState().drafts[NEW_CHAT_DRAFT]);
    return id;
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header
        data-tauri-drag-region
        className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-6"
      >
        <span className="text-[15px] font-medium">{t('chat.newChat')}</span>
        <span className="text-xs text-text-3">{mention ? t('chat.videosAttached', { count: 1 }) : t('chat.noVideo')}</span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center px-6">
        <div className="relative flex min-h-0 w-full flex-1 justify-center">
          <div className="no-scrollbar flex min-h-0 w-full max-w-[720px] flex-1 flex-col gap-6 overflow-y-auto py-6">
            <div className="my-auto flex flex-col gap-6">
              <div className="flex flex-col items-start gap-3">
                <img src={oyen} alt="Oyen" className="size-14" />
                <h1 className="m-0 text-[28px] font-semibold tracking-[-0.01em]">{t('chat.whatMaking')}</h1>
                <p className="m-0 text-[15px] leading-[1.6] text-text-2">{t('chat.intro')}</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <OptionCard icon={Lightbulb} title={t('chat.fromTopic')} body={t('chat.fromTopicBody')} onClick={() => void askTopics()} />
                <OptionCard icon={Disc3} title={t('chat.remix')} body={t('chat.remixBody')} onClick={() => setSignal((n) => n + 1)} />
                <OptionCard icon={Link2} title={t('chat.copyStyle')} body={t('chat.copyStyleBody')} onClick={() => navigate({ name: 'style' })} />
              </div>
            </div>
          </div>
        </div>

        <div className="w-full max-w-[720px] pb-6 pt-4">
          <TemplateChip styleId={styleId} onRemove={() => setStyleId(null)} />
          <Composer
            chatId={null}
            draftKey={NEW_CHAT_DRAFT}
            ensureChat={ensureForAttach}
            onSend={onSend}
            projects={projects}
            mention={mention}
            onMention={setMention}
            agentId={agent}
            onAgentChange={setPicked}
            mentionSignal={signal}
            placeholder={t('chat.placeholderNew')}
          />
          {error && (
            <p role="alert" className="m-0 mt-2 text-xs text-orange-light">
              {error}
            </p>
          )}
          <p className="m-0 mt-2 text-xs text-text-3">
            {t('chat.newChatNote')}
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
