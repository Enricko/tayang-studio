import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StepBar, currentStep } from '@/components/StepBar';
import { setUiLanguage } from '@/i18n';

/** Each step as "<name>:<done|active|todo>". */
const states = () =>
  screen.getAllByRole('listitem').map((li) => {
    const name = li.querySelector('[data-step-name]')!.textContent;
    const mark = li.querySelector('[data-step-mark]')!.textContent;
    const state = li.getAttribute('aria-current') === 'step' ? 'active' : mark === '✓' ? 'done' : 'todo';
    return `${name}:${state}`;
  });

describe('StepBar for a project', () => {
  it('draft: Topic is done, Script is the step', () => {
    render(<StepBar status="draft" />);
    expect(screen.getByRole('list', { name: 'Progress' })).toBeInTheDocument();
    expect(states()).toEqual(['Topic:done', 'Script:active', 'Style:todo', 'Build:todo', 'Render:todo']);
  });

  it('building: Script and Style are done, Build is the step', () => {
    render(<StepBar status="building" />);
    expect(states()).toEqual(['Topic:done', 'Script:done', 'Style:done', 'Build:active', 'Render:todo']);
  });

  it('a render running: Render is the step, with a pulsing dot that holds still under reduced motion', () => {
    render(<StepBar status="building" rendering />);
    expect(states()).toEqual(['Topic:done', 'Script:done', 'Style:done', 'Build:done', 'Render:active']);
    const step = screen.getByText('Render').closest('li')!;
    const dot = step.querySelector('[data-step-pulse]')!;
    expect(dot).toHaveClass('motion-safe:animate-pulse');
    expect(dot.className).not.toMatch(/(^|\s)animate-pulse/);
    expect(within(step).getByText('Rendering now')).toHaveClass('sr-only');
    // Only the render step pulses.
    expect(document.querySelectorAll('[data-step-pulse]')).toHaveLength(1);
  });

  it('rendered: all five are done and none is the current step', () => {
    render(<StepBar status="rendered" />);
    expect(states()).toEqual(['Topic:done', 'Script:done', 'Style:done', 'Build:done', 'Render:done']);
    expect(document.querySelector('[aria-current]')).toBeNull();
    expect(document.querySelector('[data-step-pulse]')).toBeNull();
  });

  it('a rendered video rendering again shows Render as the step', () => {
    render(<StepBar status="rendered" rendering />);
    expect(states().at(-1)).toBe('Render:active');
  });

  it('reads in Indonesian', () => {
    setUiLanguage('id');
    render(<StepBar status="building" rendering />);
    expect(screen.getByRole('list', { name: 'Progres' })).toBeInTheDocument();
    expect(states()).toEqual(['Topik:done', 'Skrip:done', 'Gaya:done', 'Buat:done', 'Render:active']);
    expect(screen.getByText('Sedang merender')).toHaveClass('sr-only');
  });

  it('currentStep: 5 means every step is done', () => {
    expect(currentStep('draft')).toBe(1);
    expect(currentStep('building')).toBe(3);
    expect(currentStep('draft', true)).toBe(4);
    expect(currentStep('rendered')).toBe(5);
    expect(currentStep('scheduled')).toBe(5);
  });
});

describe('StepBar with its own steps', () => {
  it('takes its own steps; without onPick they are plain text', () => {
    render(<StepBar steps={['Niche', 'Style', 'Schedule']} current={1} label="Autopilot steps" />);
    expect(screen.getByRole('list', { name: 'Autopilot steps' })).toBeInTheDocument();
    expect(screen.getByText('Style').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('with onPick every step is a button', async () => {
    const pick = vi.fn();
    render(<StepBar steps={['Niche', 'Style', 'Schedule']} current={0} label="Autopilot steps" onPick={pick} />);
    await userEvent.click(screen.getByRole('button', { name: /Schedule/ }));
    expect(pick).toHaveBeenCalledWith(2);
    expect(screen.getByRole('button', { name: /Niche/ })).toHaveAttribute('aria-current', 'step');
  });
});
