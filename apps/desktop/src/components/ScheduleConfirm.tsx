import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { slotTime } from '@/lib/autopilot';
import type { PlannedItem } from '@/lib/scheduleVideos';

/**
 * Tayang's own confirmation of a schedule card: what would be scheduled, read from the card's items (not
 * from the words the agent drew), in the user's local time. Only "Schedule N videos" here writes.
 */
export function ScheduleConfirm({
  items,
  busy,
  onConfirm,
  onCancel,
}: {
  items: PlannedItem[] | null;
  busy: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  const { t } = useTranslation();
  const list = items ?? [];
  return (
    <Dialog open={items !== null} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('schedule.confirm.title')}</DialogTitle>
          <DialogDescription>{t('schedule.confirm.description')}</DialogDescription>
        </DialogHeader>
        <ul aria-label={t('schedule.confirm.list')} className="m-0 flex max-h-[320px] list-none flex-col gap-2 overflow-y-auto p-0">
          {[...list]
            .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
            .map((i) => (
              <li key={`${i.projectId ?? i.title}-${i.at}`} className="flex flex-col gap-0.5 rounded-md border border-border px-3 py-2">
                <span className="text-[13px] text-text-2">{slotTime(new Date(i.at))}</span>
                <span className="text-[14px] font-medium">{i.title}</span>
                {!i.projectId ? (
                  <span className="text-xs text-orange-light">{t('schedule.confirm.newDraft')}</span>
                ) : i.previous && !Number.isNaN(Date.parse(i.previous)) ? (
                  <span className="text-xs text-text-3">{t('schedule.confirm.moves', { time: slotTime(new Date(i.previous)) })}</span>
                ) : null}
              </li>
            ))}
        </ul>
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy} onClick={onConfirm}>
            {t('schedule.confirm.go', { count: list.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
