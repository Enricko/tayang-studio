import type { Style, StyleAspect, VideoKind, VideoLanguage } from '@tayang/shared';

export const VIDEO_KINDS: VideoKind[] = ['explainer', 'promo', 'quote', 'news', 'tutorial', 'data', 'event'];
const ASPECTS: StyleAspect[] = ['camera', 'pacing', 'type', 'color', 'captions', 'transitions'];

function firstJsonBlock(text: string): string | null {
  const m = /```json\s*\n([\s\S]*?)```/.exec(text);
  return m ? m[1]! : null;
}

export interface TopicStyleRef {
  id: string;
  name: string;
}

/** Used when no styles are synced yet. */
export const DEFAULT_TOPIC_STYLES: TopicStyleRef[] = [
  { id: 'atlas-journey', name: 'Atlas journey' },
  { id: 'cartoon-3d-world', name: 'Cartoon 3D world' },
  { id: 'cartoon-3d-what-if', name: 'Cartoon 3D what-if' },
];

const STYLE_FIT: Record<string, string> = {
  'atlas-journey': 'places, routes, borders and trade',
  'cartoon-3d-world': 'short true stories',
  'cartoon-3d-what-if': '"What if you…" escalations',
};

const A2UI_CATALOG = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

/** One idea in the exact shape the app draws, as the lines of an a2ui block. */
function topicExample(): string {
  const V = 'v0.9';
  const lines = [
    { version: V, createSurface: { surfaceId: 'topics', catalogId: A2UI_CATALOG } },
    {
      version: V,
      updateComponents: {
        surfaceId: 'topics',
        components: [
          { id: 'root', component: 'Column', children: ['card1'] },
          { id: 'card1', component: 'Card', child: 'col1' },
          { id: 'col1', component: 'Column', children: ['title1', 'why1', 'go1'] },
          { id: 'title1', component: 'Text', text: 'Mengapa Selat Malaka begitu penting', variant: 'h4' },
          { id: 'why1', component: 'Text', text: 'Peta animasi jalur kapal dan angka perdagangan', variant: 'caption' },
          { id: 'go1', component: 'Button', child: 'go1-text', variant: 'primary', action: { event: { name: 'pick_topic', context: { title: 'Mengapa Selat Malaka begitu penting', kind: 'data', lengthSec: 45, styleId: 'atlas-journey' } } } },
          { id: 'go1-text', component: 'Text', text: 'Make this' },
        ],
      },
    },
  ];
  return lines.map((l) => JSON.stringify(l)).join('\n');
}

/** What every topic must be: something Tayang can make in code. Shared by the ideas and autopilot prompts. */
export const MOTION_RULES = [
  '- Tayang makes videos built entirely in code, as motion design or animation: kinetic type, charts and data, maps and globes, illustrated or cartoon 3D worlds, diagrams.',
  "- Never suggest anything that needs filming, a camera, real footage, screen recordings, stock video of real people, a presenter, or a real person's likeness or voice.",
  '- Pick motion-design-friendly topics: explainers, "why" and "how" questions, data and comparisons, history and geography, science what-ifs, product or promo messages told with type and illustration.',
];
export const FACTS_RULE = '- Facts must be real and checkable. No made-up numbers.';

export function buildTopicIdeasPrompt(
  kinds: VideoKind[],
  language: VideoLanguage,
  styles: TopicStyleRef[] = DEFAULT_TOPIC_STYLES,
): string {
  const lang = language === 'id' ? 'Indonesian' : 'English';
  const list = styles.length ? styles : DEFAULT_TOPIC_STYLES;
  const action =
    '{"event":{"name":"pick_topic","context":{"title":"<the idea title>","kind":"<kind>","lengthSec":<number>,"styleId":"<style id or empty>"}}}';
  return [
    `Suggest exactly 3 topic ideas for short videos. Write them in ${lang}. Allowed kinds: ${kinds.join(', ')}.`,
    '',
    'Rules for every idea:',
    ...MOTION_RULES,
    '- Fit each idea to one of these styles, or to a plain kinetic-type explainer (empty styleId):',
    ...list.map((s) => `  - ${s.name} (styleId "${s.id}")${STYLE_FIT[s.id] ? `: best for ${STYLE_FIT[s.id]}` : ''}`),
    FACTS_RULE,
    '',
    'How to reply:',
    `1. Start with one short, friendly sentence in ${lang}, as normal text.`,
    '2. Then show the 3 ideas as options in one fenced ```a2ui block (A2UI v0.9, one JSON message per line): a createSurface, then an updateComponents with a Card per idea. Each Card holds a Text with variant "h4" (the title), a Text with variant "caption" (one line on why it works as a motion video), and a Button labeled "Make this" whose action is:',
    `   ${action}`,
    '   Example of the block, showing the first idea only (for 3 ideas, add card2 and card3 the same way with their own ids, and list all three in the root Column children):',
    '```a2ui',
    topicExample(),
    '```',
    '3. Never show raw JSON outside the a2ui block, and never add a separate JSON code block.',
  ].join('\n');
}

/** Shortest and longest video a topic may ask for, in seconds. */
export const TOPIC_LENGTH = { min: 5, max: 600 } as const;
export const clampTopicLength = (sec: number) => Math.min(TOPIC_LENGTH.max, Math.max(TOPIC_LENGTH.min, Math.round(sec)));

/** What a pick_topic button press carries, or null when it has no title. */
export function topicIdeaFromAction(
  context: Record<string, unknown>,
): { title: string; kind: VideoKind; lengthSec: number; styleId?: string } | null {
  const title = typeof context.title === 'string' ? context.title.trim() : '';
  if (!title) return null;
  const kind = VIDEO_KINDS.includes(context.kind as VideoKind) ? (context.kind as VideoKind) : 'explainer';
  const len = Number(context.lengthSec);
  const lengthSec = Number.isFinite(len) && len > 0 ? clampTopicLength(len) : 30;
  const styleId = typeof context.styleId === 'string' && context.styleId ? context.styleId : undefined;
  return { title, kind, lengthSec, ...(styleId ? { styleId } : {}) };
}

/** Agents that still answer with a ```json block: pull the ideas out and drop the block from the text. */
export function splitTopicJson(text: string): {
  text: string;
  ideas: { title: string; kind: VideoKind; lengthSec: number }[];
} {
  const m = /```json\s*\n([\s\S]*?)```/.exec(text);
  if (!m) return { text, ideas: [] };
  const ideas = parseTopicIdeas(text);
  if (!ideas.length) return { text, ideas: [] };
  const rest = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\n{3,}/g, '\n\n').trim();
  return { text: rest, ideas };
}

export function parseTopicIdeas(agentText: string): { title: string; kind: VideoKind; lengthSec: number }[] {
  const raw = firstJsonBlock(agentText);
  if (raw === null) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const out: { title: string; kind: VideoKind; lengthSec: number }[] = [];
    for (const item of data) {
      if (
        !item || typeof item !== 'object' ||
        typeof item.title !== 'string' || !item.title ||
        !VIDEO_KINDS.includes(item.kind) ||
        typeof item.lengthSec !== 'number' || !Number.isFinite(item.lengthSec)
      ) {
        return [];
      }
      out.push({ title: item.title, kind: item.kind, lengthSec: clampTopicLength(item.lengthSec) });
    }
    return out;
  } catch {
    return [];
  }
}

export function buildStudyStylePrompt(url: string, outDir: string): string {
  // Paths are in backticks and quoted for the shell: the folder can contain spaces.
  const sep = outDir.includes('\\') && !outDir.includes('/') ? '\\' : '/';
  const base = outDir.replace(/[\\/]+$/, '');
  const stylePath = `${base}${sep}style.json`;
  const sourceTemplate = `${base}${sep}source.%(ext)s`;
  return [
    `Study the visual style of this video: ${url}`,
    `1. Download it with \`yt-dlp\` into the folder \`"${outDir}"\`: \`yt-dlp -f "bv*[height<=1080]+ba/b[height<=1080]/b" -o "${sourceTemplate}" <the link>\`.`,
    '2. With ffmpeg, sample about 48 frames: use scene detection plus a regular interval, so you cover cuts and steady moments.',
    '3. Look at the frames and describe the camera, pacing, type, color, captions and transitions.',
    `4. Write \`"${stylePath}"\` as: { "name": string, "notes": { "camera": string, "pacing": string, "type": string, "color": string, "captions": string, "transitions": string }, "prompt": string }.`,
    '   "name" is a short style name. "prompt" is a few short lines of direct instructions another agent can follow to recreate the look with HyperFrames.',
    '5. Delete the frames. Leave source.* in place; Tayang makes a short preview from it and then deletes it.',
    'Copy the look, never the footage: no text, logos, music or clips from the source in the prompt.',
  ].join('\n');
}

export function parseStyleResult(json: string, url: string): Omit<Style, 'id' | 'createdAt'> | null {
  try {
    const d: unknown = JSON.parse(json);
    if (!d || typeof d !== 'object') return null;
    const o = d as Record<string, unknown>;
    if (typeof o.name !== 'string' || !o.name.trim()) return null;
    if (typeof o.prompt !== 'string' || !o.prompt.trim()) return null;
    if (!o.notes || typeof o.notes !== 'object') return null;
    const notes: Partial<Record<StyleAspect, string>> = {};
    for (const a of ASPECTS) {
      const v = (o.notes as Record<string, unknown>)[a];
      if (typeof v === 'string' && v.trim()) notes[a] = v;
    }
    return { name: o.name, source: 'copied', sourceUrl: url, notes, prompt: o.prompt };
  } catch {
    return null;
  }
}
