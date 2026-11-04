import type { ChatMessage, MessagePart, Project, Settings, Style, StyleAspect } from '@tayang/shared';
import { buildProjectBrief } from '@tayang/skills';
import { listStyles } from '@/lib/ipc';

/** The videos the user mentioned in the chat so far: the agent already has their briefs. */
export const mentionedIn = (messages: ChatMessage[]): string[] => [
  ...new Set(messages.flatMap((m) => (m.role === 'user' ? m.parts.flatMap((p) => (p.type === 'mention' ? [p.projectId] : [])) : []))),
];

/** What the agent gets in front of a message for each video it mentions for the first time: its folder and brief. */
export async function mentionContext(
  parts: MessagePart[],
  seen: string[],
  projects: Project[],
  settings: Settings | null,
): Promise<MessagePart[]> {
  const out: MessagePart[] = [];
  if (!settings || !parts.some((p) => p.type === 'mention' && !seen.includes(p.projectId))) return out;
  const styles: Style[] = await listStyles().catch(() => []);
  for (const part of parts) {
    if (part.type !== 'mention' || seen.includes(part.projectId)) continue;
    const p = projects.find((x) => x.id === part.projectId);
    if (!p) continue;
    const style = styles.find((s) => s.id === p.styleId) ?? null;
    out.push({
      type: 'text',
      // i18n-ignore: this goes to the agent, not the user
      text: `The user attached the video "${p.title}". Its Tayang id is ${p.id}. Its project folder is ${p.folder}.\n\n${buildProjectBrief(p, style, settings)}`,
    });
  }
  return out;
}

const ASPECT_NAMES: [StyleAspect, string][] = [
  ['camera', 'Camera'],
  ['pacing', 'Pacing'],
  ['type', 'Type'],
  ['color', 'Color'],
  ['captions', 'Captions'],
  ['transitions', 'Transitions'],
];

/**
 * What the agent gets in front of a message for each style it mentions: the style's prompt, its non-empty
 * notes and whether it has a starter template. Never its preview or source links.
 */
export function styleContext(parts: MessagePart[], styles: Style[]): MessagePart[] {
  const out: MessagePart[] = [];
  for (const part of parts) {
    if (part.type !== 'style-mention') continue;
    const style = styles.find((s) => s.id === part.styleId);
    if (!style) continue;
    const notes = ASPECT_NAMES.flatMap(([k, label]) => {
      const note = style.notes[k]?.trim();
      return note ? [`${label}: ${note}`] : [];
    });
    const lines = [
      // i18n-ignore: this goes to the agent, not the user
      `Use the style "${style.name}" for this video:`,
      style.prompt.trim(),
      ...notes,
      // i18n-ignore: this goes to the agent, not the user
      style.template ? 'This style has a starter template; Tayang sets it up when a new video starts from it.' : '',
    ].filter(Boolean);
    out.push({ type: 'text', text: lines.join('\n') });
  }
  return out;
}
