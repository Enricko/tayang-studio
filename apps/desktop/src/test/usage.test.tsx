import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { AgentUsage } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({ getAgentUsage: vi.fn() }));

import { getAgentUsage } from '@/lib/ipc';
import { UsageBar, usageLine } from '@/components/UsageBar';
import { formatResetIn } from '@/lib/time';
import { mergeUsage, stopUsagePolling, useUsage } from '@/state/usage';
import { useApp } from '@/state/app';

const NOW = new Date('2026-11-04T10:00:00Z');

const claude: AgentUsage = {
  agentId: 'claude',
  status: 'ok',
  session: { usedPercent: 33, resetsAt: '2026-11-04T11:41:00Z' },
  weekly: { usedPercent: 48, resetsAt: '2026-11-08T00:00:00Z' },
  modelWeekly: { label: 'Fable', window: { usedPercent: 85, resetsAt: null } },
  updatedAt: '2026-11-04T10:00:00Z',
  message: null,
};
const gemini: AgentUsage = {
  agentId: 'gemini',
  status: 'unavailable',
  session: null,
  weekly: null,
  modelWeekly: null,
  updatedAt: '2026-11-04T10:00:00Z',
  message: "Usage isn't available for Gemini CLI yet",
};

describe('formatResetIn', () => {
  it('formats minutes, hours and days', () => {
    expect(formatResetIn('2026-11-04T10:42:30Z', NOW)).toBe('42m');
    expect(formatResetIn('2026-11-04T11:41:00Z', NOW)).toBe('1h 41m');
    expect(formatResetIn('2026-11-08T00:00:00Z', NOW)).toBe('3d 14h');
    expect(formatResetIn('2026-11-04T09:00:00Z', NOW)).toBe('now');
    expect(formatResetIn(null, NOW)).toBe('');
  });
});

describe('usageLine', () => {
  it('joins the windows', () => {
    expect(usageLine(claude, NOW)).toBe('33% used 1h 41m · 48% used 3d 14h · 85% used Fable');
  });
  it('shows the message when not ok', () => {
    expect(usageLine(gemini, NOW)).toBe("Usage isn't available for Gemini CLI yet");
  });
});

describe('mergeUsage', () => {
  it('keeps the last good value when a refresh errors', () => {
    const err: AgentUsage = { ...claude, status: 'error', session: null, weekly: null, modelWeekly: null, message: 'Usage is busy, try again in a minute' };
    const out = mergeUsage([claude], [err]);
    expect(out[0]!.session?.usedPercent).toBe(33);
    expect(mergeUsage([], [err])[0]!.status).toBe('error');
  });
});

describe('UsageBar and popover', () => {
  beforeEach(() => {
    stopUsagePolling();
    useUsage.setState({ usage: [], loaded: false, loading: false });
    useApp.setState({ settings: { defaultAgent: 'claude' } as never, route: { name: 'chat-new' } });
    vi.mocked(getAgentUsage).mockResolvedValue([claude, gemini]);
    localStorage.clear();
  });
  afterEach(() => stopUsagePolling());

  it('shows the status line and opens the popover with one row per agent', async () => {
    render(<UsageBar />);
    expect(await screen.findByText(/33% used .* · 48% used .* · 85% used Fable/)).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: '5 hour usage' });
    expect(bar).toHaveAttribute('aria-valuenow', '33');

    await userEvent.click(screen.getByRole('button', { name: /usage$/i }));
    expect(await screen.findByText('Usage')).toBeInTheDocument();
    expect(screen.getByText('all agents')).toBeInTheDocument();
    expect(screen.getAllByTestId('usage-row')).toHaveLength(2);
    expect(screen.getByText(/^Resets in /)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Fable usage' })).toHaveAttribute('aria-valuenow', '85');

    await userEvent.click(screen.getByRole('button', { name: 'Compact' }));
    expect(localStorage.getItem('tayang.usageView')).toBe('compact');
    expect(screen.queryByText(/^Resets in /)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Refresh usage' }));
    await waitFor(() => expect(getAgentUsage).toHaveBeenLastCalledWith(true));

    await userEvent.click(screen.getByRole('button', { name: /Manage accounts/ }));
    expect(useApp.getState().route).toEqual({ name: 'settings' });
  });

  it('goes to the Agents screen from usage details', async () => {
    render(<UsageBar />);
    await userEvent.click(screen.getByRole('button', { name: /usage$/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Usage details & history/ }));
    expect(useApp.getState().route).toEqual({ name: 'agents' });
  });
});
