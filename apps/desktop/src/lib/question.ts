import type { AgentQuestion } from '@tayang/shared';

/** One choice of a select field. */
export interface Choice {
  value: string;
  label: string;
  description?: string;
}

/** One field of an agent's question, as Tayang draws it. */
export interface QuestionField {
  key: string;
  title: string;
  description?: string;
  required: boolean;
  kind: 'single' | 'multi' | 'text' | 'number' | 'boolean';
  choices: Choice[];
  /** The free-text companion of a select (Claude's `question_0_custom`): drawn under it as "Other". */
  other?: string;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** Choices from `oneOf`/`anyOf` ({const, title}) or `enum` (with `enumNames`). */
function choicesOf(s: Record<string, unknown>): Choice[] {
  const list = (s.oneOf ?? s.anyOf) as unknown;
  if (Array.isArray(list)) {
    return list
      .map(obj)
      .filter((o) => typeof o.const === 'string' || typeof o.const === 'number')
      .map((o) => ({ value: String(o.const), label: str(o.title) ?? String(o.const), description: str(o.description) }));
  }
  if (Array.isArray(s.enum)) {
    const names = Array.isArray(s.enumNames) ? (s.enumNames as unknown[]) : [];
    return s.enum.map((v, i) => ({ value: String(v), label: str(names[i]) ?? String(v) }));
  }
  return [];
}

/** The question's fields, in the schema's order; a select's "Other" text field joins it. */
export function questionFields(q: Pick<AgentQuestion, 'schema'>): QuestionField[] {
  const props = obj(q.schema?.properties);
  const required = new Set(Array.isArray(q.schema?.required) ? q.schema.required : []);
  const fields: QuestionField[] = [];
  for (const [key, raw] of Object.entries(props)) {
    const s = obj(raw);
    const base = { key, title: str(s.title) ?? key, description: str(s.description), required: required.has(key), choices: [] as Choice[] };
    if (s.type === 'array') fields.push({ ...base, kind: 'multi', choices: choicesOf(obj(s.items)) });
    else if (s.type === 'boolean') fields.push({ ...base, kind: 'boolean' });
    else if (s.type === 'number' || s.type === 'integer') fields.push({ ...base, kind: 'number' });
    else {
      const choices = choicesOf(s);
      fields.push({ ...base, kind: choices.length ? 'single' : 'text', choices });
    }
  }
  // `x_custom` next to a select `x` is that select's own "Other".
  for (const f of fields) {
    const companion = fields.find((c) => c.key === `${f.key}_custom` && c.kind === 'text');
    if (companion && (f.kind === 'single' || f.kind === 'multi')) f.other = companion.key;
  }
  const others = new Set(fields.map((f) => f.other).filter(Boolean));
  return fields.filter((f) => !others.has(f.key));
}

export type Answers = Record<string, string | number | boolean | string[]>;

/** Whether every required field has an answer (a select's "Other" text counts for it). */
export function answered(fields: QuestionField[], a: Answers): boolean {
  return fields.every((f) => {
    if (!f.required) return true;
    const v = a[f.key];
    const other = f.other ? String(a[f.other] ?? '').trim() : '';
    if (other) return true;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'string') return v.trim().length > 0;
    return v !== undefined;
  });
}

/** The content sent back: empty text left out, numbers as numbers. */
export function answerContent(fields: QuestionField[], a: Answers): Answers {
  const out: Answers = {};
  const put = (key: string, kind: QuestionField['kind']) => {
    const v = a[key];
    if (v === undefined) return;
    if (typeof v === 'string' && !v.trim()) return;
    if (Array.isArray(v) && !v.length) return;
    out[key] = kind === 'number' && typeof v === 'string' ? Number(v) : typeof v === 'string' ? v.trim() : v;
  };
  for (const f of fields) {
    put(f.key, f.kind);
    if (f.other) put(f.other, 'text');
  }
  return out;
}

/** "Volcanoes" / "Rainbows, Volcanoes" / the typed text: what the user answered, for the chat's record. */
export function answerSummary(fields: QuestionField[], a: Answers): string {
  return fields
    .map((f) => {
      const v = a[f.key];
      const label = (x: string) => f.choices.find((c) => c.value === x)?.label ?? x;
      const parts = [
        ...(Array.isArray(v) ? v.map(label) : typeof v === 'string' && v.trim() ? [f.choices.length ? label(v) : v.trim()] : v !== undefined && typeof v !== 'string' ? [String(v)] : []),
        ...(f.other && String(a[f.other] ?? '').trim() ? [String(a[f.other]).trim()] : []),
      ];
      return parts.join(', ');
    })
    .filter(Boolean)
    .join(' · ');
}
