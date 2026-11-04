import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo, Autopilot, Settings, Style } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({
  listStyles: vi.fn(),
  detectAgents: vi.fn(),
  listAutopilots: vi.fn(),
  saveAutopilot: vi.fn(),
  assetUrl: (p: string) => p,
}));

import * as ipc from '@/lib/ipc';
import { setUiLanguage } from '@/i18n';
import { onAutopilotChanged } from '@/lib/autopilotHooks';
import { AutopilotWizard } from '@/screens/AutopilotWizard';
import { useApp } from '@/state/app';

const settings = { defaultAgent: 'claude', language: 'id', onboarded: true } as Settings;
const style = (id: string, name: string, previewUrl?: string): Style => ({
  id,
  name,
  source: 'builtin',
  sourceUrl: null,
  notes: {},
  prompt: '',
  createdAt: 'x',
  ...(previewUrl ? { previewUrl } : {}),
});
const agents: AgentInfo[] = [
  { id: 'claude', name: 'Claude Code', installed: true, version: '1', acpCommand: [], recommended: true },
  { id: 'codex', name: 'Codex', installed: false, version: null, acpCommand: [], recommended: false },
  { id: 'gemini', name: 'Gemini CLI', installed: true, version: '1', acpCommand: [], recommended: false },
];
const existing: Autopilot = {
  id: 'a1',
  name: 'Kopi',
  niche: 'Coffee tips',
  language: 'id',
  styleId: 's2',
  agentId: 'gemini',
  frequency: { kind: 'daily', times: ['19:00', '12:00'] },
  lengthSec: 45,
  review: false,
  posting: 'manual',
  status: 'active',
  createdAt: 'c',
  updatedAt: 'u',
};
/** Wed 4 Nov 2026, 10:00. */
const now = new Date(2026, 10, 4, 10, 0);

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ settings, route: { name: 'autopilot-wizard' }, leaveGuard: null });
  vi.mocked(ipc.listStyles).mockResolvedValue([style('s1', 'Atlas', '/p/atlas.png'), style('s2', 'Bold')]);
  vi.mocked(ipc.detectAgents).mockResolvedValue(agents);
  vi.mocked(ipc.listAutopilots).mockResolvedValue([existing]);
  vi.mocked(ipc.saveAutopilot).mockImplementation(async (input) => ({ ...existing, ...input, id: input.id ?? 'new1' }));
});

const next = () => screen.getByRole('button', { name: 'Next' });
const heading = () => screen.getByRole('heading', { level: 2 });

/** Fills step 1 and 2 and lands on the schedule step. */
async function toSchedule() {
  await userEvent.type(screen.getByLabelText('Name'), 'Kopi');
  await userEvent.click(screen.getByRole('button', { name: 'Home coffee brewing tips' }));
  await userEvent.click(next());
  await userEvent.click(await screen.findByRole('radio', { name: /Atlas/ }));
  await userEvent.click(next());
}

describe('Autopilot wizard', () => {
  it('is a full screen with the steps, and Next is blocked until the step is valid, with the reason', async () => {
    render(<AutopilotWizard now={now} />);
    expect(screen.getByRole('heading', { level: 1, name: 'New autopilot' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    const steps = screen.getByRole('list', { name: 'Autopilot steps' });
    expect(within(steps).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1Niche', '2Style', '3Schedule', '4Agent & review', '5Summary']);
    // New: the steps are not jump buttons.
    expect(within(steps).queryByRole('button')).toBeNull();
    expect(heading()).toHaveTextContent('What are the videos about?');
    expect(next()).toBeDisabled();
    expect(screen.getByText('Give it a name')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Name'), 'Kopi');
    expect(screen.getByText('Say what the videos are about')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Home coffee brewing tips' }));
    expect(screen.getByLabelText('Niche')).toHaveValue('Home coffee brewing tips');
    expect(next()).toBeEnabled();
    await userEvent.click(next());
    expect(heading()).toHaveTextContent('Pick a style');
    expect(heading()).toHaveFocus();
    expect(next()).toBeDisabled();
    expect(screen.getByText('Pick a style', { selector: 'span' })).toBeInTheDocument();
  });

  it('picks one style from the grid with thumbnails, and links to Style', async () => {
    render(<AutopilotWizard now={now} />);
    await userEvent.type(screen.getByLabelText('Name'), 'Kopi');
    await userEvent.type(screen.getByLabelText('Niche'), 'Coffee');
    await userEvent.click(next());
    const group = await screen.findByRole('radiogroup', { name: 'Style' });
    expect(group.querySelector('img')).toHaveAttribute('src', '/p/atlas.png');
    await userEvent.click(within(group).getByRole('radio', { name: /Atlas/ }));
    await userEvent.click(within(group).getByRole('radio', { name: /Bold/ }));
    expect(within(group).getByRole('radio', { name: /Bold/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(group).getByRole('radio', { name: /Atlas/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: 'Clone or edit styles in Style' })).toBeInTheDocument();
  });

  it('schedule: daily times with a live preview, weekly days, length; bad input blocks Next', async () => {
    render(<AutopilotWizard now={now} />);
    await toSchedule();
    expect(heading()).toHaveTextContent('How often?');
    expect(screen.getByTestId('first-videos')).toHaveTextContent('First videos: Wed 4 Nov 12:00, Thu 5 Nov 12:00, Fri 6 Nov 12:00');
    await userEvent.click(screen.getByRole('button', { name: 'Add a time' }));
    fireEvent.change(screen.getByLabelText('Time 2'), { target: { value: '19:00' } });
    expect(screen.getByTestId('first-videos')).toHaveTextContent('First videos: Wed 4 Nov 12:00, Wed 4 Nov 19:00, Thu 5 Nov 12:00');
    fireEvent.change(screen.getByLabelText('Time 2'), { target: { value: '12:00' } });
    expect(next()).toBeDisabled();
    expect(screen.getByText('Use 1 to 6 different times')).toBeInTheDocument();
    for (let i = 0; i < 4; i++) await userEvent.click(screen.getByRole('button', { name: 'Add a time' }));
    expect(screen.queryByRole('button', { name: 'Add a time' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Certain days' }));
    // Mon, Wed, Fri start picked.
    for (const d of ['Mon', 'Wed', 'Fri']) await userEvent.click(screen.getByRole('button', { name: d }));
    expect(next()).toBeDisabled();
    expect(screen.getByText('Pick at least one day')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Thu' }));
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '19:00' } });
    expect(screen.getByTestId('first-videos')).toHaveTextContent('First videos: Thu 5 Nov 19:00, Thu 12 Nov 19:00');
    await userEvent.click(screen.getByRole('radio', { name: '60s' }));
    expect(screen.getByRole('radio', { name: '60s' })).toHaveAttribute('aria-checked', 'true');
    expect(next()).toBeEnabled();
  });

  it('agent & review: only installed agents, the default first; review explains both choices; automatic is coming soon', async () => {
    render(<AutopilotWizard now={now} />);
    await toSchedule();
    await userEvent.click(next());
    const group = screen.getByRole('radiogroup', { name: 'Agent' });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Claude Code', 'Gemini CLI']);
    expect(within(group).getByRole('radio', { name: 'Claude Code' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/^On: each finished video waits/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: "Review before it's ready" }));
    expect(screen.getByText('Off: finished videos go straight to Ready.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Manual/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Automatic · Coming soon/ })).toBeDisabled();
    // The user decides here, so they learn here that it never stops to ask.
    expect(screen.getByTestId('autopilot-auto-mode')).toHaveTextContent(
      "Autopilot runs your agent in Auto mode so it can work without you: it won't stop to ask before running commands.",
    );
  });

  it('summary shows everything, Edit links jump back, and Start creates it and opens its detail', async () => {
    const changed = vi.fn();
    const off = onAutopilotChanged(changed);
    render(<AutopilotWizard now={now} />);
    await toSchedule();
    await userEvent.click(next());
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Agent' })).getByRole('radio', { name: 'Gemini CLI' }));
    await userEvent.click(next());
    expect(heading()).toHaveTextContent('Check and start');
    expect(screen.getByTestId('summary-niche')).toHaveTextContent('Kopi');
    expect(screen.getByTestId('summary-style')).toHaveTextContent('Atlas');
    expect(screen.getByTestId('summary-schedule')).toHaveTextContent('1 a day · 12:00');
    expect(screen.getByTestId('summary-agent')).toHaveTextContent('Gemini CLI');
    expect(screen.getByTestId('summary-agent')).toHaveTextContent('Waits for your Approve');
    expect(screen.getByTestId('summary-agent')).toHaveTextContent('Auto modeAlways on: the agent runs commands without asking');
    await userEvent.click(screen.getByRole('button', { name: 'Edit Style' }));
    expect(heading()).toHaveTextContent('Pick a style');
    await userEvent.click(screen.getByRole('radio', { name: /Bold/ }));
    await userEvent.click(next());
    await userEvent.click(next());
    await userEvent.click(next());
    await userEvent.click(screen.getByRole('button', { name: 'Start autopilot' }));
    await waitFor(() => expect(ipc.saveAutopilot).toHaveBeenCalledTimes(1));
    expect(ipc.saveAutopilot).toHaveBeenCalledWith({
      id: undefined,
      name: 'Kopi',
      niche: 'Home coffee brewing tips',
      language: 'id',
      styleId: 's2',
      agentId: 'gemini',
      frequency: { kind: 'daily', times: ['12:00'] },
      lengthSec: 30,
      review: true,
      posting: 'manual',
    });
    await waitFor(() => expect(useApp.getState().route).toEqual({ name: 'autopilot', id: 'new1' }));
    expect(changed).toHaveBeenCalled();
    expect(useApp.getState().leaveGuard).toBeNull();
    off();
  });

  it('saves a weekly autopilot with sorted days, language and review off', async () => {
    render(<AutopilotWizard now={now} />);
    await userEvent.type(screen.getByLabelText('Name'), 'Mingguan');
    await userEvent.type(screen.getByLabelText('Niche'), 'Finance');
    await userEvent.selectOptions(screen.getByLabelText('Video language'), 'en');
    await userEvent.click(next());
    await userEvent.click(await screen.findByRole('radio', { name: /Atlas/ }));
    await userEvent.click(next());
    await userEvent.click(screen.getByRole('button', { name: 'Certain days' }));
    await userEvent.click(screen.getByRole('button', { name: 'Wed' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sun' }));
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '08:15' } });
    await userEvent.click(next());
    await userEvent.click(screen.getByRole('switch', { name: "Review before it's ready" }));
    await userEvent.click(next());
    await userEvent.click(screen.getByRole('button', { name: 'Start autopilot' }));
    await waitFor(() => expect(ipc.saveAutopilot).toHaveBeenCalled());
    expect(ipc.saveAutopilot).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'en', frequency: { kind: 'weekly', days: [0, 1, 5], time: '08:15' }, review: false, agentId: 'claude' }),
    );
  });

  it('keeps the summary with an error when saving fails', async () => {
    vi.mocked(ipc.saveAutopilot).mockRejectedValue(new Error('no'));
    render(<AutopilotWizard id="a1" now={now} />);
    await screen.findByRole('heading', { level: 1, name: 'Edit Kopi' });
    await userEvent.click(screen.getByRole('button', { name: /Summary/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText("Couldn't save the autopilot. Try again")).toBeInTheDocument();
    expect(useApp.getState().route).toEqual({ name: 'autopilot-wizard' });
  });

  it('edit: prefilled, any step can be picked, and Save changes keeps the id', async () => {
    render(<AutopilotWizard id="a1" now={now} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit Kopi' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Kopi');
    const steps = screen.getByRole('list', { name: 'Autopilot steps' });
    await userEvent.click(within(steps).getByRole('button', { name: /Schedule/ }));
    expect(heading()).toHaveTextContent('How often?');
    expect(screen.getByLabelText('Time 1')).toHaveValue('19:00');
    expect(screen.getByRole('radio', { name: '45s' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(steps).getByRole('button', { name: /Style/ }));
    expect(await screen.findByRole('radio', { name: /Bold/ })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(steps).getByRole('button', { name: /Agent/ }));
    expect(screen.getByRole('radio', { name: 'Gemini CLI' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch')).not.toBeChecked();
    await userEvent.click(within(steps).getByRole('button', { name: /Niche/ }));
    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.type(screen.getByLabelText('Name'), 'Kopi baru');
    await userEvent.click(within(steps).getByRole('button', { name: /Summary/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(ipc.saveAutopilot).toHaveBeenCalled());
    expect(ipc.saveAutopilot).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1', name: 'Kopi baru', styleId: 's2', agentId: 'gemini', lengthSec: 45, review: false, frequency: { kind: 'daily', times: ['12:00', '19:00'] } }),
    );
    await waitFor(() => expect(useApp.getState().route).toEqual({ name: 'autopilot', id: 'a1' }));
  });

  it('refuses an agent that is no longer installed', async () => {
    vi.mocked(ipc.listAutopilots).mockResolvedValue([{ ...existing, agentId: 'codex' }]);
    render(<AutopilotWizard id="a1" now={now} />);
    await screen.findByRole('heading', { level: 1, name: 'Edit Kopi' });
    await userEvent.click(screen.getByRole('button', { name: /Summary/ }));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.getByText('Pick an agent')).toBeInTheDocument();
  });

  it('asks before leaving with unsaved input, from the sidebar, Cancel and Esc', async () => {
    render(<AutopilotWizard now={now} />);
    // Nothing typed yet: leaving just goes.
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useApp.getState().route).toEqual({ name: 'autopilot' });
    useApp.setState({ route: { name: 'autopilot-wizard' } });
    await userEvent.type(screen.getByLabelText('Name'), 'K');
    useApp.getState().navigate({ name: 'videos' });
    expect(await screen.findByRole('dialog')).toHaveTextContent('Discard this autopilot?');
    expect(useApp.getState().route).toEqual({ name: 'autopilot-wizard' });
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByLabelText('Name')).toHaveValue('K');
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(useApp.getState().route).toEqual({ name: 'autopilot' });
    expect(useApp.getState().leaveGuard).toBeNull();
  });

  it('Add a time picks a free hour, so the times stay valid', async () => {
    render(<AutopilotWizard now={now} />);
    await toSchedule();
    await userEvent.click(screen.getByRole('button', { name: 'Add a time' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add a time' }));
    expect(screen.getByLabelText('Time 2')).toHaveValue('13:00');
    expect(screen.getByLabelText('Time 3')).toHaveValue('14:00');
    expect(next()).toBeEnabled();
  });

  it('radio groups: arrow keys move the choice and the focus; only the checked option is a Tab stop', async () => {
    render(<AutopilotWizard now={now} />);
    await toSchedule();
    const thirty = screen.getByRole('radio', { name: '30s' });
    expect(thirty).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: '45s' })).toHaveAttribute('tabindex', '-1');
    thirty.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: '45s' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '45s' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('radio', { name: '90s' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(next());
    const claude = screen.getByRole('radio', { name: 'Claude Code' });
    claude.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Gemini CLI' })).toHaveAttribute('aria-checked', 'true');
  });

  it('editing asks to discard your changes, not the autopilot', async () => {
    render(<AutopilotWizard id="a1" now={now} />);
    await userEvent.type(await screen.findByLabelText('Name'), ' baru');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Discard your changes?');
  });

  it('speaks Indonesian', async () => {
    setUiLanguage('id');
    render(<AutopilotWizard now={now} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Autopilot baru' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Videonya tentang apa?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lanjut' })).toBeDisabled();
    expect(screen.getByText('Beri nama dulu')).toBeInTheDocument();
  });
});
