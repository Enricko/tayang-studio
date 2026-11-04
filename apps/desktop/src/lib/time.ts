const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "now", "2h ago", "yesterday", then "Oct 30". */
export function ago(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  const min = Math.floor((now.getTime() - t.getTime()) / 60000);
  if (!Number.isFinite(min)) return '';
  if (min < 1) return 'now';
  if (min < 60) return `${min}m ago`;
  if (min < 60 * 24) return `${Math.floor(min / 60)}h ago`;
  if (min < 60 * 48) return 'yesterday';
  return `${MONTHS[t.getMonth()]} ${t.getDate()}`;
}

export function mmss(sec: number | null): string {
  if (sec == null) return '';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Time until a reset: "42m", "1h 41m", "3d 13h". Past times read "now". */
export function formatResetIn(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - now.getTime();
  if (!Number.isFinite(ms)) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  if (min < 60 * 24) return `${Math.floor(min / 60)}h ${min % 60}m`;
  const days = Math.floor(min / 1440);
  return `${days}d ${Math.floor((min % 1440) / 60)}h`;
}
