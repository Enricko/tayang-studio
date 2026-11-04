import type { ToolStatus } from './types';

export function slugify(title: string): string {
  const s = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return s || 'video';
}

export function uniqueSlug(base: string, taken: string[]): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  let n = 2;
  while (set.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function parseVersion(raw: string): string | null {
  const m = raw.match(/\d+(?:\.\d+)+/);
  return m ? m[0] : null;
}

export function versionAtLeast(v: string | null, min: number): boolean {
  if (!v) return false;
  const major = parseInt(v.split('.')[0] ?? '', 10);
  return Number.isFinite(major) && major >= min;
}

export function requiredMissing(tools: ToolStatus[]): ToolStatus[] {
  return tools.filter((t) => t.required && !t.ok);
}

export function formatTimecode(sec: number, fps: number): string {
  const total = Math.max(0, sec);
  const whole = Math.floor(total);
  const frame = Math.min(Math.round((total - whole) * fps), fps - 1);
  const cc = Math.floor((frame / fps) * 100);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, '0')}.${String(cc).padStart(2, '0')}`;
}

export function frameAt(sec: number, fps: number): number {
  return Math.round(sec * fps);
}

export function secAt(frame: number, fps: number): number {
  return frame / fps;
}
