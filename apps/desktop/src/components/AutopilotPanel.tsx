import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Plus } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { Autopilot, AutopilotSlot } from '@tayang/shared';
import { Button } from '@/components/Button';
import { dayName } from '@/components/AutopilotDialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { locale } from '@/i18n';
import { planSlots } from '@/lib/autopilot';
import { canStopNow, stopNow } from '@/lib/autopilotHooks';
import { cn } from '@/lib/utils';

const WEEK = [1, 2, 3, 4, 5, 6, 0];

/** "2 a day · 12:00, 19:00" or "3 a week · Mon, Wed, Fri · 09:00". */
export function frequencyLabel(a: Pick<Autopilot, 'frequency'>, t: TFunction) {
  const f = a.frequency;
  if (f.kind === 'daily') return t('autopilot.daily', { count: f.times.length, times: [...f.times].sort().join(', ') });
  const days = WEEK.filter((d) => f.days.includes(d)).map(dayName).join(', ');
  return t('autopilot.weekly', { count: f.days.length, days, time: f.time });
}

const when = (d: Date) =>
  new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);

/** The Calendar's Autopilots panel: one row per autopilot, plus "New autopilot". Actions are the caller's. */
export function AutopilotPanel({
  autopilots,
  slots,
  now,
  onNew,
  onEdit,
  onToggle,
  onDelete,
}: {
  autopilots: Autopilot[];
  /** Slots around today; a `making` one puts "Stop now" on its autopilot's row. */
  slots: AutopilotSlot[];
  now: Date;
  onNew(): void;
  onEdit(a: Autopilot): void;
  onToggle(a: Autopilot): void | Promise<void>;
  onDelete(a: Autopilot): void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [deleting, setDeleting] = useState<Autopilot | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-2">
        <div className="mr-auto flex flex-col gap-1">
          <span className="text-sm font-medium">{t('calendar.autopilotsTitle')}</span>
          <span className="text-xs text-text-3">{t('autopilot.hint')}</span>
        </div>
      </div>
      {!autopilots.length && <p className="m-0 text-xs text-text-2">{t('autopilot.empty')}</p>}
      {autopilots.map((a) => {
        const paused = a.status === 'paused';
        const making = slots.find((s) => s.autopilotId === a.id && s.status === 'making');
        const next = paused ? undefined : planSlots(a, now, 8)[0];
        const act = (key: 'pause' | 'resume' | 'edit' | 'delete') => t('autopilot.actionAria', { action: t(`autopilot.${key}`), name: a.name });
        return (
          <div key={a.id} data-testid="autopilot-row" className="flex flex-col gap-2 rounded-md bg-[#222] p-3">
            <div className="flex items-center gap-2">
              <span className="mr-auto truncate text-[13px] font-medium">{a.name}</span>
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 text-[11px]',
                  paused ? 'text-text-3' : 'text-orange-light',
                )}
              >
                <span aria-hidden="true" className={cn('size-1.5 rounded-full', paused ? 'border border-text-3' : 'bg-primary')} />
                {paused ? t('autopilot.paused') : t('autopilot.active')}
              </span>
            </div>
            <span className="line-clamp-2 text-xs text-text-2">{a.niche}</span>
            <span className="font-mono text-[11px] text-text-3">{frequencyLabel(a, t)}</span>
            {making ? (
              <div className="flex items-center gap-2 text-xs text-text-2">
                <span className="mr-auto">{t('autopilot.makingNow')}</span>
                {canStopNow() && (
                  <Button variant="secondary" className="h-7 rounded-sm px-2 text-xs" onClick={() => void stopNow(making)}>
                    {t('autopilot.stopNow')}
                  </Button>
                )}
              </div>
            ) : (
              <span className="text-xs text-text-3">{next ? t('autopilot.next', { when: when(next) }) : paused ? '' : t('autopilot.noNext')}</span>
            )}
            <div className="flex flex-wrap gap-1">
              <Button variant="ghost" className="h-7 px-2 text-xs" aria-label={act(paused ? 'resume' : 'pause')} onClick={() => void onToggle(a)}>
                {paused ? t('autopilot.resume') : t('autopilot.pause')}
              </Button>
              <Button variant="ghost" className="h-7 px-2 text-xs" aria-label={act('edit')} onClick={() => onEdit(a)}>
                {t('autopilot.edit')}
              </Button>
              <Button variant="ghost" className="h-7 px-2 text-xs" aria-label={act('delete')} onClick={() => setDeleting(a)}>
                {t('autopilot.delete')}
              </Button>
            </div>
          </div>
        );
      })}
      <Button className="h-9 self-start px-3 text-[13px]" onClick={onNew}>
        <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
        {t('autopilot.add')}
      </Button>
      <p className="m-0 border-t border-border pt-3 text-xs leading-[1.6] text-text-3">
        {t('autopilot.plansLine')}{' '}
        <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-xs text-orange-light underline" onClick={() => void openUrl('https://tayang.app')}>
          {t('calendar.plans')}
        </button>
      </p>

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('autopilot.deleteTitle', { name: deleting?.name ?? '' })}</DialogTitle>
            <DialogDescription>{t('autopilot.deleteText')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (!deleting) return;
                setBusy(true);
                try {
                  await onDelete(deleting);
                } finally {
                  setBusy(false);
                  setDeleting(null);
                }
              }}
            >
              {t('autopilot.deleteConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
