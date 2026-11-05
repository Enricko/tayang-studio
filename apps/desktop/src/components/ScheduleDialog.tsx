import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import type { Project } from '@tayang/shared';
import { Button } from '@/components/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { setSchedule } from '@/lib/ipc';
import { askAgentToSchedule } from '@/lib/openProject';
import { track } from '@/lib/analytics';

const pad = (n: number) => String(n).padStart(2, '0');
const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Date + time in the computer's own time zone, as the RFC 3339 instant Rust stores. */
export function localToIso(date: string, time: string): string | null {
  const d = new Date(`${date}T${time}`);
  return date && time && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

/**
 * Where the fields start: the video's own schedule when it has one; otherwise 19:00 today, or
 * 19:00 tomorrow once it's 18:00 or later (too late to make tonight's slot).
 */
export function defaultSlot(scheduledAt: string | null | undefined, now: Date = new Date()): Date {
  const at = scheduledAt ? new Date(scheduledAt) : null;
  if (at && !Number.isNaN(at.getTime())) return at;
  const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 0);
  if (now.getHours() >= 18) slot.setDate(slot.getDate() + 1);
  return slot;
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

  // Seed the fields when the dialog opens or its own video changes; picking one from the list keeps what was typed.
  const seedId = project?.id;
  useEffect(() => {
    if (!open) {
      setPickedId('');
      return;
    }
    const start = defaultSlot(target?.scheduledAt);
    setDate(dateValue(start));
    setTime(timeValue(start));
    setError(null);
  }, [open, seedId]);

  const iso = localToIso(date, time);
  // A moment that has already gone can't be a posting time.
  const past = iso !== null && Date.parse(iso) <= Date.now();

  const save = async (at: string | null) => {
    if (!target || busy || (at !== null && Date.parse(at) <= Date.now())) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await setSchedule(target.id, at));
      track(at ? 'video scheduled' : 'video unscheduled');
      onOpenChange(false);
    } catch {
      setError(t('schedule.cantSave'));
    } finally {
      setBusy(false);
    }
  };

  const agentPick = async () => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      await askAgentToSchedule(target, () => onOpenChange(false));
    } catch {
      setError(t('schedule.cantAsk'));
    } finally {
      setBusy(false);
    }
  };

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
        {past && <p className="m-0 text-xs text-orange-light">{t('schedule.past')}</p>}
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
          {target && (
            <Button variant="secondary" disabled={busy} onClick={() => void agentPick()}>
              <Sparkles size={16} strokeWidth={1.5} aria-hidden="true" />
              {t('schedule.agentPick')}
            </Button>
          )}
          <Button disabled={busy || !target || !iso || past} onClick={() => void save(iso)}>
            {t('schedule.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
