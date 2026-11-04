import type { Project, Settings, Style, VideoKind } from '@tayang/shared';
import { buildProjectBrief, splitTopicJson, topicIdeaFromAction } from '@tayang/skills';
import { extractA2ui } from '@/a2ui/parse';
import { createChat, createProject } from '@/lib/ipc';
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
  return out.length ? out : splitTopicJson(text).ideas;
}

/** Creates the project and its chat for a picked idea, opens the chat and asks for the script. */
export async function startTopic(
  idea: TopicIdea,
  opts: { settings: Settings; agent: Settings['defaultAgent']; styles: Style[] },
): Promise<void> {
  const { settings, agent, styles } = opts;
  const style = idea.styleId ? (styles.find((s) => s.id === idea.styleId) ?? null) : null;
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
  useApp.getState().navigate({ name: 'chat', chatId: chat.id });
  void useChat
    .getState()
    .send(chat.id, [{ type: 'text', text: `Write the script for "${idea.title}", about ${idea.lengthSec} seconds.` }], {
      agentId: agent,
      job: { projectId: project.id, title: project.title },
    });
}
