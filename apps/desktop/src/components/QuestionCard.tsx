import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentId, AgentQuestion, QuestionResponse } from '@tayang/shared';
import { AgentLogo } from '@/components/AgentLogo';
import { Button } from '@/components/Button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { AGENT_NAMES } from '@/lib/agents';
import { answerContent, answered, answerSummary, questionFields, type Answers, type QuestionField } from '@/lib/question';
import { cn } from '@/lib/utils';

/**
 * An agent's question (ACP elicitation): its message, then each field as choices, checkboxes or a
 * text box, and a select's "Other". Send answers it; Skip declines. `summary` is what the user
 * picked, for the chat's record.
 */
export function QuestionCard({
  question,
  agentId = 'claude',
  onRespond,
}: {
  question: AgentQuestion;
  agentId?: AgentId;
  onRespond(response: QuestionResponse, summary: string): void;
}) {
  const { t } = useTranslation();
  const fields = useMemo(() => questionFields(question), [question]);
  const [a, setA] = useState<Answers>({});
  const set = (key: string, v: Answers[string]) => setA((x) => ({ ...x, [key]: v }));
  const single = fields.length === 1;
  const ready = answered(fields, a);

  const field = (f: QuestionField) => (
    <fieldset key={f.key} className="m-0 flex flex-col gap-2 border-0 p-0">
      {/* The field's own question, unless the card's message already says it (opencode sends a bare "Questions"). */}
      {(f.description ?? f.title) !== question.message && (!single || !!f.description || !question.message) && (
        <legend className="pb-1.5 text-[13px] text-foreground">
          {f.description ?? f.title}
          {f.required && <span className="text-text-3"> *</span>}
        </legend>
      )}
      {f.kind === 'single' &&
        f.choices.map((c) => {
          const on = a[f.key] === c.value;
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => set(f.key, c.value)}
              className={cn(
                'flex cursor-pointer flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left text-[13px] transition-colors',
                on ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-sidebar text-text-2 hover:border-hairline hover:text-foreground',
              )}
            >
              <span>{c.label}</span>
              {c.description && c.description !== c.label && <span className="text-xs text-text-3">{c.description}</span>}
            </button>
          );
        })}
      {f.kind === 'multi' &&
        f.choices.map((c) => {
          const list = (a[f.key] as string[] | undefined) ?? [];
          const on = list.includes(c.value);
          return (
            <label key={c.value} className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-sidebar px-3 py-2 text-[13px]">
              <Checkbox
                checked={on}
                onCheckedChange={(v) => set(f.key, v === true ? [...list, c.value] : list.filter((x) => x !== c.value))}
              />
              <span className="flex flex-col gap-0.5">
                {c.label}
                {c.description && c.description !== c.label && <span className="text-xs text-text-3">{c.description}</span>}
              </span>
            </label>
          );
        })}
      {f.kind === 'boolean' && (
        <label className="flex cursor-pointer items-center gap-3 text-[13px]">
          <Checkbox checked={a[f.key] === true} onCheckedChange={(v) => set(f.key, v === true)} />
          {f.title}
        </label>
      )}
      {(f.kind === 'text' || f.kind === 'number') && (
        <Input
          aria-label={f.title}
          type={f.kind === 'number' ? 'number' : 'text'}
          value={String(a[f.key] ?? '')}
          onChange={(e) => set(f.key, e.target.value)}
          className="h-9"
        />
      )}
      {f.other && (
        <Input
          aria-label={t('question.other')}
          placeholder={t('question.other')}
          value={String(a[f.other] ?? '')}
          onChange={(e) => set(f.other!, e.target.value)}
          className="h-9"
        />
      )}
    </fieldset>
  );

  return (
    <div role="group" aria-label={t('question.aria')} className="flex flex-col gap-3 rounded-md border border-hairline bg-ink p-3">
      <span className="flex items-center gap-2 text-xs text-text-3">
        <AgentLogo id={agentId} size={14} />
        {t('question.asks', { agent: AGENT_NAMES[agentId] })}
      </span>
      {question.message && <p className="m-0 text-sm leading-normal text-foreground">{question.message}</p>}
      {fields.map(field)}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="light"
          className="h-9 px-3 text-[13px] font-semibold"
          disabled={!ready}
          onClick={() => onRespond({ action: 'accept', content: answerContent(fields, a) }, answerSummary(fields, a))}
        >
          {t('question.send')}
        </Button>
        <Button variant="ghost" className="h-9 px-2 text-[13px]" onClick={() => onRespond({ action: 'decline' }, '')}>
          {t('question.skip')}
        </Button>
      </div>
    </div>
  );
}
