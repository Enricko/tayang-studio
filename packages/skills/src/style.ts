import type { Style, StyleAspect, VideoKind, VideoLanguage } from '@tayang/shared';

const KINDS: VideoKind[] = ['explainer', 'promo', 'quote', 'news', 'tutorial', 'data', 'event'];
const ASPECTS: StyleAspect[] = ['camera', 'pacing', 'type', 'color', 'captions', 'transitions'];

function firstJsonBlock(text: string): string | null {
  const m = /```json\s*\n([\s\S]*?)```/.exec(text);
  return m ? m[1]! : null;
}

export function buildTopicIdeasPrompt(kinds: VideoKind[], language: VideoLanguage): string {
  const lang = language === 'id' ? 'Indonesian' : 'English';
  return [
    `Suggest exactly 3 topic ideas for short videos. Allowed kinds: ${kinds.join(', ')}. Write titles in ${lang}.`,
    'Reply with a JSON array in a fenced ```json block, and nothing else needed outside it:',
    '```json',
    `[{ "title": string, "kind": ${kinds.map((k) => `"${k}"`).join(' | ')}, "lengthSec": number }]`,
    '```',
  ].join('\n');
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
        !KINDS.includes(item.kind) ||
        typeof item.lengthSec !== 'number' || !Number.isFinite(item.lengthSec)
      ) {
        return [];
      }
      out.push({ title: item.title, kind: item.kind, lengthSec: item.lengthSec });
    }
    return out;
  } catch {
    return [];
  }
}

export function buildStudyStylePrompt(url: string, outDir: string): string {
  return [
    `Study the visual style of this video: ${url}`,
    `1. Download it with \`yt-dlp\` into ${outDir}.`,
    '2. With ffmpeg, sample about 48 frames: use scene detection plus a regular interval, so you cover cuts and steady moments.',
    '3. Look at the frames and describe the camera, pacing, type, color, captions and transitions.',
    `4. Write ${outDir}/style.json as: { "name": string, "notes": { "camera": string, "pacing": string, "type": string, "color": string, "captions": string, "transitions": string }, "prompt": string }.`,
    '   "name" is a short style name. "prompt" is a few short lines of direct instructions another agent can follow to recreate the look with HyperFrames.',
    '5. Delete the downloaded video and the frames. Keep only style.json.',
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
