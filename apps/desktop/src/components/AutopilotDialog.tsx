import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import type { AgentInfo, Autopilot, AutopilotFrequency, AutopilotInput, Style, VideoLanguage } from '@tayang/shared';
import { Button } from '@/components/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { locale } from '@/i18n';
import { AGENT_NAMES } from '@/lib/agents';
import { cn } from '@/lib/utils';
import { PreviewImage, posterOf } from '@/screens/Style';

export const LENGTHS = [15, 30, 45, 60, 90];
export const MAX_TIMES = 6;

/** Monday first; the number is `Date.getDay()` (0 is Sunday), what the model stores. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

/** The short weekday name in the active language (2024-01-07 is a Sunday). */
export const dayName = (day: number) => new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(new Date(2024, 0, 7 + day));

const sameTimes = (times: string[]) => new Set(times).size === times.length;
const isTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

/** Create (no `autopilot`) or edit an autopilot. Calls `onSave` with the saved row. */
export function AutopilotDialog({
  open,
  onOpenChange,
  autopilot,
  styles,
  agents,
  defaults,
  onSave,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  autopilot?: Autopilot | null;
  styles: Style[];
  agents: AgentInfo[];
  defaults: { language: VideoLanguage; agentId: AgentInfo['id'] };
  onSave(input: AutopilotInput): Promise<void>;
}) {
  const { t } = useTranslation();
  const installed = agents.filter((a) => a.installed);
  const [name, setName] = useState('');
  const [niche, setNiche] = useState('');
  const [language, setLanguage] = useState<VideoLanguage>('id');
  const [styleId, setStyleId] = useState('');
  const [agentId, setAgentId] = useState<AgentInfo['id'] | ''>('');
  const [mode, setMode] = useState<'daily' | 'weekly'>('daily');
  const [times, setTimes] = useState<string[]>(['12:00']);
  const [days, setDays] = useState<number[]>([1, 3, 5]);
  const [time, setTime] = useState('09:00');
  const [lengthSec, setLengthSec] = useState(30);
  const [review, setReview] = useState(true);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editId = autopilot?.id;
  useEffect(() => {
    if (!open) return;
    const a = autopilot;
    setName(a?.name ?? '');
    setNiche(a?.niche ?? '');
    setLanguage(a?.language ?? defaults.language);
    setStyleId(a?.styleId ?? styles[0]?.id ?? '');
    setAgentId(a?.agentId ?? (installed.find((x) => x.id === defaults.agentId) ?? installed[0])?.id ?? '');
    setMode(a?.frequency.kind ?? 'daily');
    setTimes(a?.frequency.kind === 'daily' ? a.frequency.times : ['12:00']);
    setDays(a?.frequency.kind === 'weekly' ? a.frequency.days : [1, 3, 5]);
    setTime(a?.frequency.kind === 'weekly' ? a.frequency.time : '09:00');
    setLengthSec(a?.lengthSec ?? 30);
    setReview(a?.review ?? true);
    setTried(false);
    setError(null);
    // Seed when the dialog opens or switches to another autopilot, not on every list refresh.
  }, [open, editId]);

  // The style list can arrive after the dialog opens: fill the pick once it does.
  useEffect(() => {
    if (open && !styleId && styles[0]) setStyleId(styles[0].id);
    if (open && !agentId && installed[0]) setAgentId((installed.find((x) => x.id === defaults.agentId) ?? installed[0]).id);
  }, [open, styles, agents]);

  const problems = {
    name: !name.trim() && t('autopilot.dialog.errors.name'),
    niche: !niche.trim() && t('autopilot.dialog.errors.niche'),
    style: !styles.some((s) => s.id === styleId) && t('autopilot.dialog.errors.style'),
    agent: !installed.some((a) => a.id === agentId) && t('autopilot.dialog.errors.agent'),
    when:
      mode === 'daily'
        ? (times.length < 1 || times.length > MAX_TIMES || !times.every(isTime) || !sameTimes(times)) && t('autopilot.dialog.errors.times')
        : (!days.length && t('autopilot.dialog.errors.days')) || (!isTime(time) && t('autopilot.dialog.errors.times')),
  };
  const firstProblem = Object.values(problems).find(Boolean) || null;

  const save = async () => {
    setTried(true);
    if (firstProblem || busy || !agentId) return;
    const frequency: AutopilotFrequency = mode === 'daily' ? { kind: 'daily', times: [...times].sort() } : { kind: 'weekly', days: [...days].sort((a, b) => a - b), time };
    setBusy(true);
    setError(null);
    try {
      await onSave({ id: autopilot?.id, name: name.trim(), niche: niche.trim(), language, styleId, agentId, frequency, lengthSec, review, posting: 'manual' });
      onOpenChange(false);
    } catch {
      setError(t('autopilot.dialog.errors.cantSave'));
    } finally {
      setBusy(false);
    }
  };

  const style = styles.find((s) => s.id === styleId);
  const label = 'flex flex-col gap-1 text-xs text-text-2';
  const select = 'h-9 rounded-md border border-input bg-card px-2 text-sm text-foreground';
  const err = (msg: string | false) =>
    tried && msg ? (
      <span role="alert" className="text-xs text-orange-light">
        {msg}
      </span>
    ) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{autopilot ? t('autopilot.dialog.titleEdit') : t('autopilot.dialog.titleNew')}</DialogTitle>
          <DialogDescription>{t('autopilot.dialog.description')}</DialogDescription>
        </DialogHeader>

        <label className={label}>
          {t('autopilot.dialog.name')}
          <Input value={name} placeholder={t('autopilot.dialog.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
          {err(problems.name)}
        </label>

        <div className="flex flex-col gap-2">
          <label className={label}>
            {t('autopilot.dialog.niche')}
            <Textarea value={niche} rows={3} placeholder={t('autopilot.dialog.nichePlaceholder')} onChange={(e) => setNiche(e.target.value)} />
            {err(problems.niche)}
          </label>
          <div role="group" aria-label={t('autopilot.dialog.examples')} className="flex flex-wrap gap-2">
            {(['example1', 'example2', 'example3'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setNiche(t(`autopilot.dialog.${k}`))}
                className="rounded-full border border-border bg-card px-3 py-1 text-xs text-text-2 hover:text-foreground"
              >
                {t(`autopilot.dialog.${k}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            {t('autopilot.dialog.language')}
            <select value={language} onChange={(e) => setLanguage(e.target.value as VideoLanguage)} className={select}>
              <option value="id">Bahasa Indonesia</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className={label}>
            {t('autopilot.dialog.length')}
            <select value={lengthSec} onChange={(e) => setLengthSec(Number(e.target.value))} className={select}>
              {(LENGTHS.includes(lengthSec) ? LENGTHS : [...LENGTHS, lengthSec].sort((a, b) => a - b)).map((n) => (
                <option key={n} value={n}>
                  {t('chat.seconds', { n })}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-end gap-3">
          <label className={cn(label, 'min-w-0 flex-1')}>
            {t('autopilot.dialog.style')}
            <select value={styleId} onChange={(e) => setStyleId(e.target.value)} className={select} disabled={!styles.length}>
              {!styles.length && <option value="">{t('autopilot.dialog.noStyles')}</option>}
              {styles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {err(problems.style)}
          </label>
          {style && (
            <PreviewImage
              key={style.id}
              src={posterOf(style)}
              className="h-16 w-9 shrink-0 rounded-sm border border-[#333] object-cover"
              fallback={<span aria-hidden="true" className="h-16 w-9 shrink-0 rounded-sm border border-[#333] bg-raised" />}
            />
          )}
        </div>

        <label className={label}>
          {t('autopilot.dialog.agent')}
          <select value={agentId} onChange={(e) => setAgentId(e.target.value as AgentInfo['id'])} className={select} disabled={!installed.length}>
            {!installed.length && <option value="">{t('autopilot.dialog.noAgents')}</option>}
            {installed.map((a) => (
              <option key={a.id} value={a.id}>
                {AGENT_NAMES[a.id]}
              </option>
            ))}
          </select>
          {err(problems.agent)}
        </label>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 p-0 text-xs text-text-2">{t('autopilot.dialog.frequency')}</legend>
          <div className="flex gap-2">
            {(['daily', 'weekly'] as const).map((m) => (
              <Button
                key={m}
                type="button"
                variant={mode === m ? 'light' : 'secondary'}
                aria-pressed={mode === m}
                className="h-8 px-3 text-[13px]"
                onClick={() => setMode(m)}
              >
                {m === 'daily' ? t('autopilot.dialog.modeDaily') : t('autopilot.dialog.modeWeekly')}
              </Button>
            ))}
          </div>
          {mode === 'daily' ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-text-2">{t('autopilot.dialog.times')}</span>
              <div className="flex flex-wrap items-center gap-2">
                {times.map((v, i) => (
                  <span key={i} className="inline-flex items-center gap-1">
                    <Input
                      type="time"
                      aria-label={t('autopilot.dialog.timeN', { n: i + 1 })}
                      value={v}
                      className="h-9 w-[110px]"
                      onChange={(e) => setTimes((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
                    />
                    {times.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={t('autopilot.dialog.removeTime', { time: v || String(i + 1) })}
                        className="size-8 px-0"
                        onClick={() => setTimes((l) => l.filter((_, j) => j !== i))}
                      >
                        <X size={14} strokeWidth={1.5} aria-hidden="true" />
                      </Button>
                    )}
                  </span>
                ))}
                {times.length < MAX_TIMES && (
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 px-3 text-[13px]"
                    onClick={() => setTimes((l) => [...l, '18:00'])}
                  >
                    <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
                    {t('autopilot.dialog.addTime')}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div role="group" aria-label={t('autopilot.dialog.days')} className="flex flex-wrap gap-2">
                {WEEK.map((d) => (
                  <Button
                    key={d}
                    type="button"
                    variant={days.includes(d) ? 'light' : 'secondary'}
                    aria-pressed={days.includes(d)}
                    className="h-8 px-3 text-[13px]"
                    onClick={() => setDays((l) => (l.includes(d) ? l.filter((x) => x !== d) : [...l, d]))}
                  >
                    {dayName(d)}
                  </Button>
                ))}
              </div>
              <label className={label}>
                {t('autopilot.dialog.time')}
                <Input type="time" value={time} className="h-9 w-[110px]" onChange={(e) => setTime(e.target.value)} />
              </label>
            </div>
          )}
          {err(problems.when)}
        </fieldset>

        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="autopilot-review" className="text-sm">
              {t('autopilot.dialog.review')}
            </label>
            <span className="text-xs text-text-3">{t('autopilot.dialog.reviewHint')}</span>
          </div>
          <Switch id="autopilot-review" checked={review} onCheckedChange={setReview} />
        </div>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 p-0 text-xs text-text-2">{t('autopilot.dialog.posting')}</legend>
          <RadioGroup value="manual" className="gap-2">
            <label className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="manual" className="mt-0.5" />
              <span className="flex flex-col">
                {t('autopilot.dialog.manual')}
                <span className="text-xs text-text-3">{t('autopilot.dialog.manualHint')}</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-text-3">
              <RadioGroupItem value="automatic" disabled className="mt-0.5" />
              <span>
                {t('autopilot.dialog.automatic')} · {t('autopilot.dialog.comingSoon')}
              </span>
            </label>
          </RadioGroup>
        </fieldset>

        {error && (
          <p role="alert" className="m-0 text-xs text-orange-light">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? t('autopilot.dialog.saving') : t('autopilot.dialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
