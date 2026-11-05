import type { Chat, MessagePart, NewProject, Project, Settings, Style, VideoKind } from '@tayang/shared';
import { buildProjectBrief, SKIP_FRAME_CHECK, splitTopicJson, topicIdeaFromAction } from '@tayang/skills';
import { extractA2ui } from '@/a2ui/parse';
import { copyStyleRefs, createChat, createProject, installStyleTemplate, listStyles, syncStyles, writeBrief } from '@/lib/ipc';
import { advanceProject } from '@/lib/projectStatus';
import { i18n } from '@/i18n';
import { stored } from '@/lib/stored';
import { useApp } from '@/state/app';
import { appendSystem, useChat } from '@/state/chat';

export interface TopicIdea {
  title: string;
  kind: VideoKind;
  lengthSec: number;
  styleId?: string;
  /** What the user asked for that the title doesn't say (no voice-over, a fact to include). */
  notes?: string;
}

/** The three ideas of a reply: A2UI "Make this" buttons first, then the older ```json block. */
export function ideasFromReply(text: string): TopicIdea[] {
  const out: TopicIdea[] = [];
  for (const block of extractA2ui(text).blocks) {
    for (const m of block) {
      const comps = (m as { updateComponents?: { components?: unknown } }).updateComponents?.components;
      if (!Array.isArray(comps)) continue;
      for (const c of comps as { component?: string; action?: { event?: { name?: string; context?: Record<string, unknown> } } }[]) {
        const ev = c?.component === 'Button' ? c.action?.event : undefined;
        if (ev?.name !== 'pick_topic' || !ev.context) continue;
        const idea = topicIdeaFromAction(ev.context);
        if (idea) out.push(idea);
      }
    }
  }
  const found = out.length ? out : splitTopicJson(text).ideas;
  const seen = new Set<string>();
  return found
    .filter((i) => {
      const k = i.title.trim().toLowerCase();
      return seen.has(k) ? false : (seen.add(k), true);
    })
    .slice(0, 3);
}

export interface TopicProjectOpts {
  settings: Settings;
  agent: Settings['defaultAgent'];
  styleId?: string | null;
  /** What setup is doing right now, for a busy line on the calling screen. */
  onStatus?: (text: string) => void;
}

/** What `createProject` takes for a new video, and the not-yet-saved project its brief is written from. */
function projectDraft(title: string, kind: VideoKind, settings: Pick<Settings, 'format' | 'language'>, style: Style | null) {
  const input: NewProject = {
    title,
    kind,
    format: settings.format,
    language: settings.language,
    ...(style ? { styleId: style.id } : {}),
  };
  const draft: Project = {
    id: '',
    slug: '',
    folder: '',
    status: 'draft',
    styleId: style?.id ?? null,
    scheduledAt: null, reviewState: 'none', postedAt: null, remindedAt: null, reviewRemindedAt: null,
    durationSec: null,
    createdAt: '',
    updatedAt: '',
    ...input,
  };
  return { input, draft };
}

/**
 * What a draft video with the plain brief is made from, and no chat or agent turn (a schedule the agent
 * proposed names topics that aren't made yet). Its chat is created when the user opens it.
 */
export function draftProject(
  title: string,
  kind: VideoKind,
  settings: Pick<Settings, 'format' | 'language' | 'fps' | 'frameCheck'>,
): { input: NewProject; brief: string } {
  const { input, draft } = projectDraft(title, kind, settings, null);
  return { input, brief: buildProjectBrief(draft, null, settings) };
}

/**
 * Creates the project and its chat for a picked idea and sets up the style's template when it has one.
 * It neither opens the chat nor sends anything: `startTopic` does that for the screens, the autopilot
 * sends its own prompt. The video language and format come from `opts.settings`.
 *
 * The style is the idea's own `styleId` when it names a synced style, else `opts.styleId` (a template the
 * user picked on the Style screen, or the autopilot's style). A template that can't be set up is reported
 * in the chat as a system line and the brief is rewritten without it.
 */
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** A style by its id, or (agents sometimes write the name instead) by its name or a slug of it. */
function findStyle(styles: Style[], ref: string): Style | undefined {
  return styles.find((s) => s.id === ref) ?? styles.find((s) => slug(s.name) === slug(ref));
}

export async function createTopicProject(idea: TopicIdea, opts: TopicProjectOpts): Promise<{ project: Project; chat: Chat }> {
  const { settings, agent } = opts;
  const fallbackId = opts.styleId ?? null;
  let style: Style | null = null;
  let styleProblem: string | null = null;
  let unknownStyle: string | null = null;
  if (idea.styleId || fallbackId) {
    try {
      let styles = await listStyles();
      // A built-in style the agent named may not be synced yet: sync once, then look again.
      if (idea.styleId && !styles.some((s) => s.id === idea.styleId)) {
        const synced = await syncStyles().catch(() => null);
        if (synced) styles = await listStyles();
      }
      style =
        (idea.styleId ? findStyle(styles, idea.styleId) : undefined) ??
        (fallbackId ? styles.find((s) => s.id === fallbackId) : undefined) ??
        null;
      // A style the user picked that is gone, or one the agent named that nobody has, is said in the chat.
      if (!style && fallbackId) styleProblem = stored('chat.templateGone');
      else if (!style && idea.styleId) unknownStyle = idea.styleId;
    } catch (e) {
      styleProblem = e instanceof Error ? e.message : String(e);
    }
  }
  const { input, draft } = projectDraft(idea.title, idea.kind, settings, style);
  const project = await createProject(input, buildProjectBrief(draft, style, settings));
  useApp.getState().bumpProjects();
  const chat = await createChat(project.id, agent, idea.title);
  const say = (text: string) => appendSystem(chat.id, text);
  // The look's reference frames go into the project (style-refs/), where the brief points the agent.
  if (style?.references?.length) await copyStyleRefs(style.id, project.id).catch(() => 0);
  if (styleProblem) await say(stored('chat.templateProblem', { problem: styleProblem }));
  if (unknownStyle) await say(stored('chat.styleUnknown', { id: unknownStyle }));
  if (style?.template) {
    opts.onStatus?.(i18n.t('chat.settingTemplate', { name: style.name }));
    await say(stored('chat.settingTemplate', { name: style.name }));
    let reason: string | null = null;
    try {
      const r = await installStyleTemplate(project.id);
      if (!r.installed) reason = stored('chat.templateFilesMissing');
      // The style is in place: the project is being built.
      else await advanceProject(project.id, 'building');
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
    }
    if (reason !== null) {
      // The brief promised a template: take that promise back.
      await writeBrief(project.id, buildProjectBrief(draft, { ...style, template: null }, settings)).catch(() => {});
      await say(stored('chat.templateFailed', { name: style.name, reason }));
    }
  }
  return { project, chat };
}

/** Creates the project and its chat for a picked idea, opens the chat and asks for the script. Shared by every screen that starts a topic (new chat, calendar). */
export async function startTopic(idea: TopicIdea, opts: TopicProjectOpts): Promise<void> {
  const { settings, agent } = opts;
  const { project, chat } = await createTopicProject(idea, opts);
  useApp.getState().navigate({ name: 'chat', chatId: chat.id });
  // The project chat is new: what the user asked for on the card goes along, or it is lost.
  const ask: MessagePart[] = [
    {
      type: 'text',
      text: [
        i18n.t('chat.writeScript', { title: idea.title, seconds: idea.lengthSec }),
        ...(idea.notes ? [i18n.t('chat.topicNotes', { notes: idea.notes })] : []),
      ].join('\n\n'),
    },
  ];
  void useChat.getState().send(chat.id, ask, {
    agentId: agent,
    job: { projectId: project.id, title: project.title },
    // Same as every later message in the project chat when the check is off in Settings.
    ...(settings.frameCheck === false ? { promptParts: [{ type: 'text', text: SKIP_FRAME_CHECK }, ...ask] } : {}),
  });
}
