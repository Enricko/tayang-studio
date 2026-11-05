import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { AgentQuestion } from '@tayang/shared';
import { QuestionCard } from '@/components/QuestionCard';
import { answerContent, answered, answerSummary, questionFields } from '@/lib/question';

/** What Claude's adapter sends for one AskUserQuestion: a select and its "Other" text. */
const claudeAsk: AgentQuestion = {
  chatId: 'c1',
  requestId: 'r1',
  message: 'Which topic should the video be about?',
  schema: {
    type: 'object',
    properties: {
      question_0: {
        type: 'string',
        title: 'Topic',
        oneOf: [
          { const: 'What if you never slept', title: 'What if you never slept', description: 'Biology, 60 s' },
          { const: 'What if the Moon vanished', title: 'What if the Moon vanished' },
        ],
      },
      question_0_custom: { type: 'string', title: 'Other', description: 'Type your own answer' },
    },
  },
};

describe('reading a question', () => {
  it("joins a select with its Other field, and reads choices, multi-select, text and numbers", () => {
    const fields = questionFields(claudeAsk);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ key: 'question_0', kind: 'single', other: 'question_0_custom' });
    expect(fields[0]!.choices[0]).toEqual({ value: 'What if you never slept', label: 'What if you never slept', description: 'Biology, 60 s' });

    const mixed = questionFields({
      schema: {
        properties: {
          tags: { type: 'array', title: 'Tags', items: { anyOf: [{ const: 'a', title: 'A' }, { const: 'b', title: 'B' }] } },
          lang: { type: 'string', enum: ['id', 'en'], enumNames: ['Indonesia', 'English'] },
          name: { type: 'string', title: 'Name' },
          secs: { type: 'integer', title: 'Seconds' },
          ok: { type: 'boolean', title: 'Voice-over' },
        },
        required: ['name'],
      },
    });
    expect(mixed.map((f) => [f.key, f.kind, f.required])).toEqual([
      ['tags', 'multi', false],
      ['lang', 'single', false],
      ['name', 'text', true],
      ['secs', 'number', false],
      ['ok', 'boolean', false],
    ]);
    expect(mixed[1]!.choices.map((c) => c.label)).toEqual(['Indonesia', 'English']);
    expect(answered(mixed, {})).toBe(false);
    expect(answered(mixed, { name: '  ' })).toBe(false);
    const a = { name: ' Oyen ', secs: '30', tags: ['a', 'b'], lang: 'en' };
    expect(answered(mixed, a)).toBe(true);
    expect(answerContent(mixed, a)).toEqual({ tags: ['a', 'b'], lang: 'en', name: 'Oyen', secs: 30 });
    expect(answerSummary(mixed, a)).toBe('A, B · English · Oyen · 30');
  });
});

describe('QuestionCard', () => {
  it('sends the picked option, with the picked label as the summary', async () => {
    const respond = vi.fn();
    render(<QuestionCard question={claudeAsk} agentId="opencode" onRespond={respond} />);
    expect(screen.getByText('opencode asks you')).toBeInTheDocument();
    expect(screen.getByText('Which topic should the video be about?')).toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Send' });
    await userEvent.click(screen.getByRole('radio', { name: /What if the Moon vanished/ }));
    await userEvent.click(send);
    expect(respond).toHaveBeenCalledWith(
      { action: 'accept', content: { question_0: 'What if the Moon vanished' } },
      'What if the Moon vanished',
    );
  });

  it('takes a typed answer as Other, and Skip declines', async () => {
    const respond = vi.fn();
    render(<QuestionCard question={claudeAsk} onRespond={respond} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Other (type your own)' }), 'What if dogs could talk');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(respond).toHaveBeenLastCalledWith(
      { action: 'accept', content: { question_0_custom: 'What if dogs could talk' } },
      'What if dogs could talk',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(respond).toHaveBeenLastCalledWith({ action: 'decline' }, '');
  });

  it("can't send until a required field has an answer", async () => {
    const respond = vi.fn();
    render(
      <QuestionCard
        question={{ chatId: 'c1', requestId: 'r', message: 'Your name?', schema: { properties: { name: { type: 'string', title: 'Name' } }, required: ['name'] } }}
        onRespond={respond}
      />,
    );
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Oyen');
    expect(send).toBeEnabled();
  });

  it("shows opencode's question text from the field, and no description that only repeats the label", async () => {
    const respond = vi.fn();
    render(
      <QuestionCard
        question={{
          chatId: 'c1',
          requestId: 'r',
          message: 'Questions',
          schema: {
            type: 'object',
            properties: {
              q0: { type: 'string', title: 'Fruit choice', description: 'Which fruit do you pick?', oneOf: [{ const: 'Apple', title: 'Apple', description: 'Apple' }, { const: 'Banana', title: 'Banana', description: 'Banana' }] },
              q0_custom: { type: 'string', title: 'Fruit choice (other)', description: 'Type your own answer' },
            },
            required: [],
          },
        }}
        onRespond={respond}
      />,
    );
    expect(screen.getByText('Which fruit do you pick?')).toBeInTheDocument();
    expect(screen.getAllByText('Apple')).toHaveLength(1);
    await userEvent.click(screen.getByRole('radio', { name: 'Banana' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(respond).toHaveBeenCalledWith({ action: 'accept', content: { q0: 'Banana' } }, 'Banana');
  });
});
