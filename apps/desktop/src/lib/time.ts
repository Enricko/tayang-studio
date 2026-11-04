import { i18n, locale } from '@/i18n';

/** "now", "2h ago", "yesterday", then "Oct 30": in the active language, through `Intl`. */
export function ago(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  const min = Math.floor((now.getTime() - t.getTime()) / 60000);
  if (!Number.isFinite(min)) return '';
  if (min < 1) return i18n.t('common.now');
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto', style: 'narrow' });
  if (min < 60) return rtf.format(-min, 'minute');
  if (min < 60 * 24) return rtf.format(-Math.floor(min / 60), 'hour');
  if (min < 60 * 48) return rtf.format(-1, 'day');
  return new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric' }).format(t);
}

export function mmss(sec: number | null): string {
  if (sec == null) return '';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Time until a reset: "42m", "1h 41m", "3d 13h" (through `Intl`, so Indonesian reads "42 mnt", "1 j 41 mnt"). Past times read "now". */
export function formatResetIn(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - now.getTime();
  if (!Number.isFinite(ms)) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return i18n.t('common.now');
  const unit = (n: number, u: 'minute' | 'hour' | 'day') =>
    new Intl.NumberFormat(locale(), { style: 'unit', unit: u, unitDisplay: 'narrow' }).format(n);
  const m = (n: number) => unit(n, 'minute');
  const h = (n: number) => unit(n, 'hour');
  if (min < 60) return m(min);
  if (min < 60 * 24) return `${h(Math.floor(min / 60))} ${m(min % 60)}`;
  const days = Math.floor(min / 1440);
  return `${unit(days, 'day')} ${h(Math.floor((min % 1440) / 60))}`;
}

/** How far ahead a moment is: "now", "in 45 minutes", "in 3 hours", "tomorrow", "in 2 days" (through `Intl`). */
export function inTime(at: Date, now: Date = new Date()): string {
  const min = Math.floor((at.getTime() - now.getTime()) / 60000);
  if (!Number.isFinite(min)) return '';
  if (min < 1) return i18n.t('common.now');
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  if (min < 60) return rtf.format(min, 'minute');
  if (min < 60 * 24) return rtf.format(Math.floor(min / 60), 'hour');
  return rtf.format(Math.floor(min / 1440), 'day');
}

/** The computer's clock as the agent needs it: IANA zone, RFC 3339 offset, and the local date and time in English. */
export function localClock(now: Date = new Date()): { timeZone: string; offset: string; localNow: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const off = -now.getTimezoneOffset();
  const offset = `${off < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || `UTC${offset}`;
  // i18n-ignore: this goes to the agent, not the user
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now);
  const localNow = `${weekday} ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return { timeZone, offset, localNow };
}

/** How long something has run: "45s", "2m 10s", "1h 3m" (through `Intl`, so Indonesian reads "2 mnt 10 dtk"). */
export function elapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const unit = (n: number, u: 'second' | 'minute' | 'hour') =>
    new Intl.NumberFormat(locale(), { style: 'unit', unit: u, unitDisplay: 'narrow' }).format(n);
  if (sec < 60) return unit(sec, 'second');
  if (sec < 3600) return `${unit(Math.floor(sec / 60), 'minute')} ${unit(sec % 60, 'second')}`;
  return `${unit(Math.floor(sec / 3600), 'hour')} ${unit(Math.floor((sec % 3600) / 60), 'minute')}`;
}
