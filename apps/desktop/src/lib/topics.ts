import type { Project, Settings, Style, VideoKind } from '@tayang/shared';
import { buildProjectBrief, splitTopicJson, topicIdeaFromAction } from '@tayang/skills';
import { extractA2ui } from '@/a2ui/parse';
import { addMessage, createChat, createProject, installStyleTemplate, listStyles, syncStyles, writeBrief } from '@/lib/ipc';
import { useApp } from '@/state/app';
import { useChat } from '@/state/chat';

export interface TopicIdea {
  title: string;
  kind: VideoKind;
  lengthSec: number;
  styleId?: string;
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

/**
 * Creates the project and its chat for a picked idea, sets up the style's template when it has one,
 * opens the chat and asks for the script. Shared by every screen that starts a topic (new chat, calendar).
 *
 * The style is the idea's own `styleId` when it names a synced style, else `opts.styleId` (a template the
 * user picked on the Style screen). A template that can't be set up is reported in the chat as a system
 * line and the brief is rewritten without it.
 */
export async function startTopic(
  idea: TopicIdea,
  opts: { settings: Settings; agent: Settings['defaultAgent']; styleId?: string | null },
): Promise<void> {
  const { settings, agent } = opts;
  const fallbackId = opts.styleId ?? null;
  let style: Style | null = null;
  let styleProblem: string | null = null;
  if (idea.styleId || fallbackId) {
    try {
      let styles = await listStyles();
      // A built-in style the agent named may not be synced yet: sync once, then look again.
      if (idea.styleId && !styles.some((s) => s.id === idea.styleId)) {
        const synced = await syncStyles().catch(() => null);
        if (synced) styles = await listStyles();
      }
      style =
        (idea.styleId ? styles.find((s) => s.id === idea.styleId) : undefined) ??
        (fallbackId ? styles.find((s) => s.id === fallbackId) : undefined) ??
        null;
      // An unknown style the agent suggested is ignored; a template the user picked is reported.
      if (!style && fallbackId) styleProblem = 'that style is no longer in your library';
    } catch (e) {
      styleProblem = e instanceof Error ? e.message : String(e);
    }
  }
  const input = {
    title: idea.title,
    kind: idea.kind,
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
    scheduledAt: null,
    durationSec: null,
    createdAt: '',
    updatedAt: '',
    ...input,
  };
  const project = await createProject(input, buildProjectBrief(draft, style, settings));
  useApp.getState().bumpProjects();
  const chat = await createChat(project.id, agent, idea.title);
  const say = (text: string) => addMessage(chat.id, 'system', [{ type: 'text', text }]).catch(() => {});
  if (styleProblem) await say(`Couldn't set up the template: ${styleProblem}. Continuing without it.`);
  if (style?.template) {
    await say(`Setting up the ${style.name} template…`);
    let reason: string | null = null;
    try {
      const r = await installStyleTemplate(project.id);
      if (!r.installed) reason = 'the template files were not added';
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
    }
    if (reason !== null) {
      // The brief promised a template: take that promise back.
      await writeBrief(project.id, buildProjectBrief(draft, { ...style, template: null }, settings)).catch(() => {});
      await say(`Couldn't set up the ${style.name} template: ${reason}. Continuing without it.`);
    }
  }
  useApp.getState().navigate({ name: 'chat', chatId: chat.id });
  void useChat
    .getState()
    .send(chat.id, [{ type: 'text', text: `Write the script for "${idea.title}", about ${idea.lengthSec} seconds.` }], {
      agentId: agent,
      job: { projectId: project.id, title: project.title },
    });
}
