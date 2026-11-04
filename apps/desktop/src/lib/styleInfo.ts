import type { Style } from '@tayang/shared';
import { i18n } from '@/i18n';

/** The public thumbnail of a YouTube link (watch?v=, youtu.be/, shorts/, embed/), null for anything else. */
export function youtubeThumbnail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1] ?? null;
  else if (host === 'youtube.com') {
    const m = /^\/(?:shorts|embed)\/([^/]+)/.exec(u.pathname);
    id = m ? m[1]! : u.pathname === '/watch' ? u.searchParams.get('v') : null;
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

/** The style's picture: its own preview, else the YouTube thumbnail of a copied video. */
export const posterOf = (s: Style): string | null => s.previewUrl || (s.source === 'copied' ? youtubeThumbnail(s.sourceUrl) : null);

/** Where a style comes from, in a few words: built in, copied from a video, or the user's own. */
export function styleSource(s: Pick<Style, 'source'>): string {
  if (s.source === 'builtin') return i18n.t('style.builtIn');
  if (s.source === 'copied') return i18n.t('style.copied');
  return i18n.t('style.yours');
}
