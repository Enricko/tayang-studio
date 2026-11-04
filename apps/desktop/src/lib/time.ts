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
