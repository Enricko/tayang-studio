import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StepBar } from '@/components/StepBar';

describe('StepBar', () => {
  it('shows a project status as before', () => {
    render(<StepBar status="building" />);
    expect(screen.getByRole('list', { name: 'Progress' })).toBeInTheDocument();
    expect(screen.getByText('Build').closest('li')).toHaveAttribute('aria-current', 'step');
  });

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
