import { readProjectFile } from '@/lib/ipc';

/** The file in a project's folder where the agent leaves what to post with the video. */
export const POST_FILE = 'post.json';
/** YouTube's longest title. */
export const TITLE_MAX = 100;

/** What the agent suggests for a post: the user sees and edits all of it in the Post dialog. */
export interface PostDraft {
  title: string;
  description: string;
  hashtags: string[];
  /** A suggested time to post (ISO 8601), or null. */
  scheduledAt: string | null;
}

/** post.json as the agent wrote it, or null when it isn't a usable draft. */
export function parsePostDraft(text: string | null | undefined): PostDraft | null {
  if (!text) return null;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
  const title = str(o.title).slice(0, TITLE_MAX);
  const description = str(o.description ?? o.caption);
  if (!title && !description) return null;
  const hashtags = Array.isArray(o.hashtags)
    ? o.hashtags.map(str).map((h) => h.replace(/^#+/, '').replace(/\s+/g, '')).filter(Boolean).slice(0, 10)
    : [];
  const at = str(o.scheduledAt);
  const when = at && !Number.isNaN(Date.parse(at)) && Date.parse(at) > Date.now() ? new Date(at).toISOString() : null;
  return { title, description, hashtags, scheduledAt: when };
}

/** The caption the platforms get: the description, then the hashtags. */
export function captionOf(d: PostDraft): string {
  const tags = d.hashtags.map((h) => `#${h}`).join(' ');
  return [d.description, tags].filter(Boolean).join('\n\n');
}

/** The project's post.json, or null (no file yet, or not a draft). */
export async function readPostDraft(projectId: string): Promise<PostDraft | null> {
  try {
    return parsePostDraft((await readProjectFile(projectId, POST_FILE)).text);
  } catch {
    return null;
  }
}
