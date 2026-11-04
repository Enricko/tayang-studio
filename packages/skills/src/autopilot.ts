import type { Style, VideoKind, VideoLanguage } from '@tayang/shared';
import { clampTopicLength, FACTS_RULE, MOTION_RULES, VIDEO_KINDS } from './style';

// Everything here goes to the agent, never to the user, so it stays in English (i18n-ignore).

const LANGUAGE: Record<VideoLanguage, string> = { id: 'Indonesian', en: 'English' };

export interface AutopilotTopicInput {
  niche: string;
  style: Pick<Style, 'name'> & Partial<Pick<Style, 'prompt'>>;
  language: VideoLanguage;
  lengthSec: number;
  /** The autopilot's earlier video titles, newest first; the new topic must not repeat them. */
  previousTitles: string[];
}

export interface AutopilotTopic {
  title: string;
  kind: VideoKind;
  lengthSec: number;
}

/** Asks the autopilot's internal chat for the next video: exactly one motion-design topic as a json block. */
export function buildAutopilotTopicPrompt({ niche, style, language, lengthSec, previousTitles }: AutopilotTopicInput): string {
  const lang = LANGUAGE[language];
  const styleLine = style.prompt?.trim() ? `${style.name}: ${style.prompt.trim()}` : style.name;
  return [
    `Suggest exactly ONE topic for a short motion video in this niche: "${niche}". Write the title in ${lang}.`,
    `The video will be about ${lengthSec} seconds long and made in this style: ${styleLine}`,
    '',
    'Rules:',
    ...MOTION_RULES,
    '- The topic must fit the niche and suit the style.',
    FACTS_RULE,
    previousTitles.length
      ? '- It must not repeat, or be a close variation of, any of these earlier titles:'
      : '- There are no earlier titles yet.',
    ...previousTitles.map((t) => `  - ${t}`),
    '',
    'How to reply:',
    '- Do not use any tools, create files or run commands. Just answer.',
    `- Reply with only one fenced \`\`\`json block and nothing else, like this (kind is one of: ${VIDEO_KINDS.join(', ')}):`,
    '```json',
    `{"title": "<the title>", "kind": "<kind>", "lengthSec": ${lengthSec}}`,
    '```',
  ].join('\n');
}

/** Sent once when the topic reply could not be read (or repeated an earlier title). */
export const AUTOPILOT_TOPIC_RETRY =
  'I could not use that. Reply again with only one fenced ```json block, {"title": "...", "kind": "...", "lengthSec": ...}, ' +
  'with a new title that is not one of the earlier titles. Nothing else.';

const jsonBlock = (text: string): string | null => /```json\s*([\s\S]*?)```/.exec(text)?.[1] ?? null;

/** The topic in an autopilot reply (a ```json block, or bare json), or null when it has no title. */
export function parseAutopilotTopic(text: string): AutopilotTopic | null {
  const raw = jsonBlock(text) ?? text.trim();
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (Array.isArray(data)) data = data[0];
  if (!data || typeof data !== 'object') return null;
  const item = data as { title?: unknown; kind?: unknown; lengthSec?: unknown };
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  if (!title) return null;
  const kind = VIDEO_KINDS.includes(item.kind as VideoKind) ? (item.kind as VideoKind) : 'explainer';
  const len = Number(item.lengthSec);
  return { title, kind, lengthSec: Number.isFinite(len) && len > 0 ? clampTopicLength(len) : 30 };
}

/** The autopilot's one message to the project chat: make the whole video on its own, ending with a rendered file. */
export function buildAutopilotBuildPrompt(
  title: string,
  lengthSec: number,
  opts: { language?: VideoLanguage; frameCheck?: boolean } = {},
): string {
  const lang = opts.language ? ` in ${LANGUAGE[opts.language]}` : '';
  const steps = [
    `Write the script for "${title}", about ${lengthSec} seconds${lang}.`,
    'Build the video in this project, following AGENTS.md and its style.',
    "Render it to an MP4 with the render command in tayang.json (or the project's own render setup).",
    ...(opts.frameCheck === false ? [] : ['Check frames of the render, fix anything that looks wrong and render again.']),
    'Finish by saying the path of the rendered file.',
  ];
  return [
    'This video is made by an autopilot: work through every step on your own, without asking questions or waiting for a reply.',
    ...steps.map((s, i) => `${i + 1}. ${s}`),
  ].join('\n');
}

/** Sent once when the build turn ended without a rendered file. */
export const AUTOPILOT_RENDER_NOW =
  "Render it now: no rendered video file was found in this project. Use the render command in tayang.json (or the project's own render setup), then finish by saying the path of the rendered file.";
