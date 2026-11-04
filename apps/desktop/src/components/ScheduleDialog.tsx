import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Project } from '@tayang/shared';
import { Button } from '@/components/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { setSchedule } from '@/lib/ipc';

const pad = (n: number) => String(n).padStart(2, '0');
const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Date + time in the computer's own time zone, as the RFC 3339 instant Rust stores. */
export function localToIso(date: string, time: string): string | null {
  const d = new Date(`${date}T${time}`);
  return date && time && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

/**
 * Sets or clears when a video is due to be posted. With `project` it schedules that video; with
 * only `choices` (the Calendar's own entry) it first asks which one.
 */
export function ScheduleDialog({
  open,
  onOpenChange,
  project,
  choices = [],
  onSaved,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  project?: Project | null;
  choices?: Project[];
  onSaved(project: Project): void;
}) {
  const { t } = useTranslation();
  const [pickedId, setPickedId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = project ?? choices.find((p) => p.id === pickedId) ?? null;

  useEffect(() => {
    if (!open) return;
    const at = target?.scheduledAt ? new Date(target.scheduledAt) : null;
    const start = at && !Number.isNaN(at.getTime()) ? at : null;
    setDate(start ? dateValue(start) : dateValue(new Date()));
    setTime(start ? timeValue(start) : '09:00');
    setError(null);
    // Re-seed when the dialog opens or the video changes, not on every keystroke.
  }, [open, target?.id]);

  const save = async (at: string | null) => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await setSchedule(target.id, at));
      onOpenChange(false);
    } catch {
      setError(t('schedule.cantSave'));
    } finally {
      setBusy(false);
    }
  };

  const iso = localToIso(date, time);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('schedule.title')}</DialogTitle>
          <DialogDescription>{project ? project.title : t('schedule.description')}</DialogDescription>
        </DialogHeader>
        {!project && (
          <label className="flex flex-col gap-1 text-xs text-text-2">
            {t('schedule.video')}
            <select
              value={pickedId}
              onChange={(e) => setPickedId(e.target.value)}
              className="h-9 rounded-md border border-input bg-card px-2 text-sm text-foreground"
            >
              <option value="">{t('schedule.choose')}</option>
              {choices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-text-2">
            {t('schedule.date')}
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-2">
            {t('schedule.time')}
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        {error && (
          <p role="alert" className="m-0 text-xs text-orange-light">
            {error}
          </p>
        )}
        <DialogFooter>
          {target?.scheduledAt && (
            <Button variant="ghost" className="mr-auto" disabled={busy} onClick={() => void save(null)}>
              {t('schedule.clear')}
            </Button>
          )}
          <Button disabled={busy || !target || !iso} onClick={() => void save(iso)}>
            {t('schedule.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
