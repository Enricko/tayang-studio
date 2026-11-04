import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plus, X } from 'lucide-react';
import type { AgentInfo, Autopilot, AutopilotFrequency, AutopilotInput, Style, VideoLanguage } from '@tayang/shared';
import { AgentLogo } from '@/components/AgentLogo';
import { Button } from '@/components/Button';
import { StepBar } from '@/components/StepBar';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { AGENT_NAMES } from '@/lib/agents';
import { dayName, frequencyLabel, isTime, LENGTHS, MAX_TIMES, planSlots, slotTime, validTimes, WEEK } from '@/lib/autopilot';
import { notifyAutopilotChanged } from '@/lib/autopilotHooks';
import { detectAgents, listAutopilots, listStyles, saveAutopilot } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import { PreviewImage, posterOf } from '@/screens/Style';
import { useApp, type Route } from '@/state/app';

const STEP_KEYS = ['niche', 'style', 'schedule', 'agent', 'summary'] as const;
type StepKey = (typeof STEP_KEYS)[number];

interface Form {
  name: string;
  niche: string;
  language: VideoLanguage;
  styleId: string;
  agentId: AgentInfo['id'] | '';
  mode: 'daily' | 'weekly';
  times: string[];
  days: number[];
  time: string;
  lengthSec: number;
  review: boolean;
}

const fromAutopilot = (a: Autopilot): Form => ({
  name: a.name,
  niche: a.niche,
  language: a.language,
  styleId: a.styleId,
  agentId: a.agentId,
  mode: a.frequency.kind,
  times: a.frequency.kind === 'daily' ? a.frequency.times : ['12:00'],
  days: a.frequency.kind === 'weekly' ? a.frequency.days : [1, 3, 5],
  time: a.frequency.kind === 'weekly' ? a.frequency.time : '09:00',
  lengthSec: a.lengthSec,
  review: a.review,
});

const frequencyOf = (f: Form): AutopilotFrequency =>
  f.mode === 'daily' ? { kind: 'daily', times: [...f.times].sort() } : { kind: 'weekly', days: [...f.days].sort((a, b) => a - b), time: f.time };

/** New (no `id`) or edit an autopilot, one step at a time, on its own screen. */
export function AutopilotWizard({ id, now = new Date() }: { id?: string; now?: Date }) {
  const { t } = useTranslation();
  const settings = useApp((s) => s.settings);
  const [form, setForm] = useState<Form>(() => ({
    name: '',
    niche: '',
    language: settings?.language ?? 'id',
    styleId: '',
    agentId: '',
    mode: 'daily',
    times: ['12:00'],
    days: [1, 3, 5],
    time: '09:00',
    lengthSec: 30,
    review: true,
  }));
  const [step, setStep] = useState(0);
  const [styles, setStyles] = useState<Style[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [editing, setEditing] = useState<Autopilot | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState<Route | null>(null);
  const touched = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);
  const installed = agents.filter((a) => a.installed);

  const change = (patch: Partial<Form>) => {
    touched.current = true;
    setForm((f) => ({ ...f, ...patch }));
  };

  useEffect(() => {
    listStyles()
      .then(setStyles)
      .catch(() => setStyles([]));
    detectAgents()
      .then((list) => {
        setAgents(list);
        // A new autopilot starts on the default agent when it is installed (not a user change).
        const ok = list.filter((a) => a.installed);
        setForm((f) => (f.agentId ? f : { ...f, agentId: (ok.find((a) => a.id === settings?.defaultAgent) ?? ok[0])?.id ?? '' }));
      })
      .catch(() => setAgents([]));
    if (!id) return;
    listAutopilots()
      .then((list) => {
        const a = list.find((x) => x.id === id);
        if (!a) throw new Error('gone');
        setEditing(a);
        setForm(fromAutopilot(a));
      })
      .catch(() => setLoadError(t('autopilot.cantLoad')))
      .finally(() => setLoading(false));
  }, [id]);

  // Leaving with unsaved input asks first, wherever the navigation comes from (sidebar, Cancel, Esc).
  useEffect(() => {
    const store = useApp.getState();
    store.setLeaveGuard((next) => {
      if (!touched.current) return true;
      setLeaving(next);
      return false;
    });
    return () => {
      if (useApp.getState().leaveGuard) useApp.getState().setLeaveGuard(null);
    };
  }, []);

  const backTo: Route = id ? { name: 'autopilot', id } : { name: 'autopilot' };
  const cancel = () => useApp.getState().navigate(backTo);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !leaving && !e.defaultPrevented) cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [leaving]);

  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  const problems: Record<StepKey, string | null> = {
    niche: !form.name.trim() ? t('autopilot.dialog.errors.name') : !form.niche.trim() ? t('autopilot.dialog.errors.niche') : null,
    style: styles.some((s) => s.id === form.styleId) ? null : t('autopilot.dialog.errors.style'),
    schedule:
      form.mode === 'daily'
        ? validTimes(form.times)
          ? null
          : t('autopilot.dialog.errors.times')
        : !form.days.length
          ? t('autopilot.dialog.errors.days')
          : isTime(form.time)
            ? null
            : t('autopilot.dialog.errors.times'),
    agent: installed.some((a) => a.id === form.agentId) ? null : t('autopilot.dialog.errors.agent'),
    summary: null,
  };
  const key = STEP_KEYS[step]!;
  const firstBad = STEP_KEYS.findIndex((k) => problems[k]);
  const problem = key === 'summary' ? (firstBad >= 0 ? problems[STEP_KEYS[firstBad]!] : null) : problems[key];

  const save = async () => {
    if (busy || firstBad >= 0 || !form.agentId) return;
    setBusy(true);
    setSaveError(null);
    const input: AutopilotInput = {
      id: editing?.id,
      name: form.name.trim(),
      niche: form.niche.trim(),
      language: form.language,
      styleId: form.styleId,
      agentId: form.agentId,
      frequency: frequencyOf(form),
      lengthSec: form.lengthSec,
      review: form.review,
      posting: 'manual',
    };
    try {
      const saved = await saveAutopilot(input);
      touched.current = false;
      useApp.getState().setLeaveGuard(null);
      notifyAutopilotChanged();
      useApp.getState().navigate({ name: 'autopilot', id: saved.id });
    } catch {
      setSaveError(t('autopilot.dialog.errors.cantSave'));
      setBusy(false);
    }
  };

  const stepNames = STEP_KEYS.map((k) => t(`autopilot.wizard.steps.${k}`));
  const style = styles.find((s) => s.id === form.styleId);
  const label = 'flex flex-col gap-1 text-xs text-text-2';
  const chip = (on: boolean) =>
    cn(
      'inline-flex h-8 cursor-pointer items-center rounded-md border px-3 text-[13px] motion-safe:transition-colors',
      on ? 'border-foreground bg-foreground text-ink' : 'border-hairline bg-card text-text-2 hover:text-foreground',
    );
  const first = planSlots({ frequency: frequencyOf(form) }, now, 14).slice(0, 3);

  const body: Record<StepKey, () => ReactNode> = {
    niche: () => (
      <div className="flex flex-col gap-4">
        <label className={label}>
          {t('autopilot.dialog.name')}
          <Input value={form.name} placeholder={t('autopilot.dialog.namePlaceholder')} onChange={(e) => change({ name: e.target.value })} />
        </label>
        <label className={label}>
          {t('autopilot.dialog.niche')}
          <Textarea value={form.niche} rows={3} placeholder={t('autopilot.dialog.nichePlaceholder')} onChange={(e) => change({ niche: e.target.value })} />
        </label>
        <div role="group" aria-label={t('autopilot.dialog.examples')} className="flex flex-wrap gap-2">
          {(['example1', 'example2', 'example3'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => change({ niche: t(`autopilot.dialog.${k}`) })}
              className="cursor-pointer rounded-full border border-border bg-card px-3 py-1 text-xs text-text-2 hover:text-foreground"
            >
              {t(`autopilot.dialog.${k}`)}
            </button>
          ))}
        </div>
        <label className={cn(label, 'max-w-[240px]')}>
          {t('autopilot.dialog.language')}
          <select
            value={form.language}
            onChange={(e) => change({ language: e.target.value as VideoLanguage })}
            className="h-9 rounded-md border border-input bg-card px-2 text-sm text-foreground"
          >
            <option value="id">Bahasa Indonesia</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>
    ),
    style: () => (
      <div className="flex flex-col gap-3">
        {!styles.length && <p className="m-0 text-xs text-text-2">{t('autopilot.dialog.noStyles')}</p>}
        <div role="radiogroup" aria-label={t('autopilot.dialog.style')} className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))' }}>
          {styles.map((s) => {
            const on = s.id === form.styleId;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => change({ styleId: s.id })}
                className={cn(
                  'relative flex cursor-pointer flex-col gap-2 rounded-xl border bg-card p-2 text-left',
                  on ? 'border-primary' : 'border-border hover:border-hairline',
                )}
              >
                <PreviewImage
                  key={s.id}
                  src={posterOf(s)}
                  className="aspect-[9/16] w-full rounded-md object-cover"
                  fallback={<span aria-hidden="true" className="block aspect-[9/16] w-full rounded-md bg-raised" />}
                />
                <span className="truncate text-xs text-foreground">{s.name}</span>
                {on && (
                  <span aria-hidden="true" className="absolute top-3 right-3 inline-flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check size={12} strokeWidth={2} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => useApp.getState().navigate({ name: 'style' })}
          className="cursor-pointer self-start border-0 bg-transparent p-0 text-xs text-orange-light underline"
        >
          {t('autopilot.wizard.styleHint')}
        </button>
      </div>
    ),
    schedule: () => (
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          {(['daily', 'weekly'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={form.mode === m} className={chip(form.mode === m)} onClick={() => change({ mode: m })}>
              {m === 'daily' ? t('autopilot.dialog.modeDaily') : t('autopilot.dialog.modeWeekly')}
            </button>
          ))}
        </div>
        {form.mode === 'daily' ? (
          <div className="flex flex-col gap-2">
            <span className="text-xs text-text-2">{t('autopilot.dialog.times')}</span>
            <div className="flex flex-wrap items-center gap-2">
              {form.times.map((v, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  <Input
                    type="time"
                    aria-label={t('autopilot.dialog.timeN', { n: i + 1 })}
                    value={v}
                    className="h-9 w-[110px]"
                    onChange={(e) => change({ times: form.times.map((x, j) => (j === i ? e.target.value : x)) })}
                  />
                  {form.times.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={t('autopilot.dialog.removeTime', { time: v || String(i + 1) })}
                      className="size-8 px-0"
                      onClick={() => change({ times: form.times.filter((_, j) => j !== i) })}
                    >
                      <X size={14} strokeWidth={1.5} aria-hidden="true" />
                    </Button>
                  )}
                </span>
              ))}
              {form.times.length < MAX_TIMES && (
                <Button type="button" variant="secondary" className="h-8 px-3 text-[13px]" onClick={() => change({ times: [...form.times, '18:00'] })}>
                  <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
                  {t('autopilot.dialog.addTime')}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div role="group" aria-label={t('autopilot.dialog.days')} className="flex flex-wrap gap-2">
              {WEEK.map((d) => {
                const on = form.days.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    className={chip(on)}
                    onClick={() => change({ days: on ? form.days.filter((x) => x !== d) : [...form.days, d] })}
                  >
                    {dayName(d)}
                  </button>
                );
              })}
            </div>
            <label className={label}>
              {t('autopilot.dialog.time')}
              <Input type="time" value={form.time} className="h-9 w-[110px]" onChange={(e) => change({ time: e.target.value })} />
            </label>
          </div>
        )}
        <div role="radiogroup" aria-label={t('autopilot.dialog.length')} className="flex flex-col gap-2">
          <span className="text-xs text-text-2">{t('autopilot.dialog.length')}</span>
          <div className="flex flex-wrap gap-2">
            {(LENGTHS.includes(form.lengthSec) ? LENGTHS : [...LENGTHS, form.lengthSec].sort((a, b) => a - b)).map((n) => (
              <button key={n} type="button" role="radio" aria-checked={form.lengthSec === n} className={chip(form.lengthSec === n)} onClick={() => change({ lengthSec: n })}>
                {t('chat.seconds', { n })}
              </button>
            ))}
          </div>
        </div>
        {!problems.schedule && first.length > 0 && (
          <p data-testid="first-videos" className="m-0 font-mono text-xs text-text-2">
            {t('autopilot.wizard.firstVideos', { list: first.map(slotTime).join(', ') })}
          </p>
        )}
      </div>
    ),
    agent: () => (
      <div className="flex flex-col gap-5">
        {!installed.length && <p className="m-0 text-xs text-text-2">{t('autopilot.dialog.noAgents')}</p>}
        <div role="radiogroup" aria-label={t('autopilot.dialog.agent')} className="flex flex-wrap gap-2">
          {installed.map((a) => {
            const on = a.id === form.agentId;
            return (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => change({ agentId: a.id })}
                className={cn(
                  'inline-flex cursor-pointer items-center gap-2 rounded-xl border bg-card px-3 py-2 text-[13px] text-foreground',
                  on ? 'border-primary' : 'border-border hover:border-hairline',
                )}
              >
                <AgentLogo id={a.id} size={20} />
                {AGENT_NAMES[a.id]}
              </button>
            );
          })}
        </div>
        <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="autopilot-review" className="text-sm">
              {t('autopilot.dialog.review')}
            </label>
            <span className="text-xs text-text-3">{form.review ? t('autopilot.wizard.reviewOn') : t('autopilot.wizard.reviewOff')}</span>
          </div>
          <Switch id="autopilot-review" checked={form.review} onCheckedChange={(review) => change({ review })} />
        </div>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 p-0 text-xs text-text-2">{t('autopilot.dialog.posting')}</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="posting" checked readOnly className="mt-1 accent-[var(--color-primary)]" />
            <span className="flex flex-col">
              {t('autopilot.dialog.manual')}
              <span className="text-xs text-text-3">{t('autopilot.dialog.manualHint')}</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-text-3">
            <input type="radio" name="posting" disabled className="mt-1" />
            <span>
              {t('autopilot.dialog.automatic')} · {t('autopilot.dialog.comingSoon')}
            </span>
          </label>
        </fieldset>
      </div>
    ),
    summary: () => {
      const rows: [StepKey, string, string][] = [
        ['niche', t('autopilot.dialog.name'), form.name.trim()],
        ['niche', t('autopilot.dialog.niche'), form.niche.trim()],
        ['niche', t('autopilot.dialog.language'), form.language === 'id' ? 'Bahasa Indonesia' : 'English'],
        ['style', t('autopilot.dialog.style'), style?.name ?? ''],
        ['schedule', t('autopilot.dialog.frequency'), validTimes(form.times) || form.mode === 'weekly' ? frequencyLabel({ frequency: frequencyOf(form) }) : ''],
        ['schedule', t('autopilot.dialog.length'), t('chat.seconds', { n: form.lengthSec })],
        ['agent', t('autopilot.dialog.agent'), form.agentId ? AGENT_NAMES[form.agentId] : ''],
        ['agent', t('autopilot.dialog.review'), form.review ? t('autopilot.wizard.reviewValueOn') : t('autopilot.wizard.reviewValueOff')],
        ['agent', t('autopilot.dialog.posting'), t('autopilot.dialog.manual')],
      ];
      return (
        <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
          {(['niche', 'style', 'schedule', 'agent'] as const).map((section) => (
            <div key={section} data-testid={`summary-${section}`} className="flex items-start gap-4 p-4">
              <dl className="m-0 grid flex-1 grid-cols-[120px_1fr] gap-x-4 gap-y-1 text-[13px]">
                {rows
                  .filter(([s]) => s === section)
                  .map(([, k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-text-3">{k}</dt>
                      <dd className="m-0 min-w-0 break-words text-foreground">{v}</dd>
                    </div>
                  ))}
              </dl>
              <Button
                variant="ghost"
                className="h-7 px-2 text-xs"
                aria-label={t('autopilot.wizard.editAria', { section: t(`autopilot.wizard.steps.${section}`) })}
                onClick={() => setStep(STEP_KEYS.indexOf(section))}
              >
                {t('autopilot.wizard.edit')}
              </Button>
            </div>
          ))}
        </div>
      );
    },
  };

  const last = step === STEP_KEYS.length - 1;
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-8">
      <div data-tauri-drag-region className="flex flex-wrap items-center gap-4">
        <h1 className="m-0 mr-auto text-[28px] font-semibold tracking-[-0.01em]">
          {editing ? t('autopilot.wizard.titleEdit', { name: editing.name }) : t('autopilot.wizard.titleNew')}
        </h1>
        <Button variant="ghost" onClick={cancel}>
          {t('common.cancel')}
        </Button>
      </div>
      {loadError && (
        <p role="alert" className="m-0 text-xs text-orange-light">
          {loadError}
        </p>
      )}
      {!loading && !loadError && (
        <>
          <StepBar steps={stepNames} current={step} label={t('autopilot.wizard.stepsAria')} onPick={editing ? setStep : undefined} />
          <section aria-labelledby="wizard-heading" className="flex max-w-[720px] flex-col gap-5">
            <h2 id="wizard-heading" ref={heading} tabIndex={-1} className="m-0 text-xl font-medium outline-none">
              {t(`autopilot.wizard.headings.${key}`)}
            </h2>
            {body[key]()}
            {saveError && (
              <p role="alert" className="m-0 text-xs text-orange-light">
                {saveError}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              {step > 0 && (
                <Button variant="secondary" onClick={() => setStep((s) => s - 1)}>
                  {t('common.back')}
                </Button>
              )}
              {problem && (
                <span id="wizard-problem" className="text-xs text-orange-light">
                  {problem}
                </span>
              )}
              {last ? (
                <Button className="ml-auto" disabled={busy || !!problem} aria-describedby={problem ? 'wizard-problem' : undefined} onClick={() => void save()}>
                  {busy ? t('autopilot.wizard.saving') : editing ? t('autopilot.wizard.saveChanges') : t('autopilot.wizard.start')}
                </Button>
              ) : (
                <Button className="ml-auto" disabled={!!problem} aria-describedby={problem ? 'wizard-problem' : undefined} onClick={() => setStep((s) => s + 1)}>
                  {t('autopilot.wizard.next')}
                </Button>
              )}
            </div>
          </section>
        </>
      )}

      <Dialog open={leaving !== null} onOpenChange={(o) => !o && setLeaving(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('autopilot.wizard.discardTitle')}</DialogTitle>
            <DialogDescription>{t('autopilot.wizard.discardText')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLeaving(null)}>
              {t('autopilot.wizard.keepEditing')}
            </Button>
            <Button
              onClick={() => {
                const next = leaving;
                setLeaving(null);
                touched.current = false;
                useApp.getState().setLeaveGuard(null);
                if (next) useApp.getState().navigate(next);
              }}
            >
              {t('autopilot.wizard.discard')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
