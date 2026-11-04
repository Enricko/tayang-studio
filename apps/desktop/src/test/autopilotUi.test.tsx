import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo, Autopilot, AutopilotSlot, Settings, Style } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({
  listAutopilots: vi.fn(),
  listSlots: vi.fn(),
  saveAutopilot: vi.fn(),
  setAutopilotStatus: vi.fn(),
  deleteAutopilot: vi.fn(),
  updateSlot: vi.fn(),
  listProjects: vi.fn(),
  listStyles: vi.fn(),
  detectAgents: vi.fn(),
  setSchedule: vi.fn(),
  setPosted: vi.fn(),
  approveProject: vi.fn(),
  assetUrl: (p: string) => p,
}));
vi.mock('@/lib/events', () => ({
  onAgentUpdate: vi.fn(async () => () => {}),
  onPermission: vi.fn(async () => () => {}),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

import * as ipc from '@/lib/ipc';
import { Calendar } from '@/screens/Calendar';
import { notifyAutopilotChanged, setStopNowHandler } from '@/lib/autopilotHooks';
import { setUiLanguage } from '@/i18n';
import { useApp } from '@/state/app';

const settings: Settings = {
  workingFolder: '/w/Tayang',
  defaultAgent: 'claude',
  frameCheck: true,
  language: 'id',
  format: '9:16',
  fps: 30,
  onboarded: true,
  apiUrl: 'https://api.tayang.app',
  installId: '',
  shareInstallStats: true,
  autoMode: false,
  lastPingAt: null,
  uiLanguage: null,
  backgroundMode: false,
  openAtLogin: false,
};

const style = (id: string, name: string): Style => ({ id, name, source: 'builtin', sourceUrl: null, notes: {}, prompt: '', createdAt: 'x' });
const agents: AgentInfo[] = [
  { id: 'claude', name: 'Claude Code', installed: true, version: '1', acpCommand: [], recommended: true },
  { id: 'codex', name: 'Codex', installed: false, version: null, acpCommand: [], recommended: false },
  { id: 'gemini', name: 'Gemini CLI', installed: true, version: '1', acpCommand: [], recommended: false },
];

const today = new Date(2026, 10, 4, 10, 0);
const autopilot = (extra: Partial<Autopilot> = {}): Autopilot => ({
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
  ...extra,
});
const slot = (id: string, at: Date, extra: Partial<AutopilotSlot> = {}): AutopilotSlot => ({
  id,
  autopilotId: 'a1',
  dueAt: at.toISOString(),
  status: 'planned',
  projectId: null,
  error: null,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  setStopNowHandler(null);
  useApp.setState({ settings });
  vi.mocked(ipc.listAutopilots).mockResolvedValue([]);
  vi.mocked(ipc.listSlots).mockResolvedValue([]);
  vi.mocked(ipc.listProjects).mockResolvedValue([]);
  vi.mocked(ipc.listStyles).mockResolvedValue([style('s1', 'Atlas'), style('s2', 'Bold')]);
  vi.mocked(ipc.detectAgents).mockResolvedValue(agents);
  vi.mocked(ipc.saveAutopilot).mockResolvedValue(autopilot());
});

const open = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'New autopilot' }));
  return await screen.findByRole('dialog');
};

describe('Autopilots panel', () => {
  it('invites the first autopilot and keeps the tayang.app line', async () => {
    render(<Calendar today={today} />);
    expect(await screen.findByText(/No autopilots yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'See plans' })).toBeInTheDocument();
    expect(screen.queryByText(/Tayang reminds you/)).toBeNull();
    expect(screen.getByText(/Automatic posting to TikTok, Reels and Shorts is coming to tayang.app plans/)).toBeInTheDocument();
  });

  it('shows name, niche, how often, status and the next slot, and pauses and resumes', async () => {
    vi.mocked(ipc.listAutopilots).mockResolvedValue([autopilot()]);
    vi.mocked(ipc.setAutopilotStatus).mockImplementation(async (_id, status) => {
      vi.mocked(ipc.listAutopilots).mockResolvedValue([autopilot({ status })]);
      return autopilot({ status });
    });
    render(<Calendar today={today} />);
    const row = await screen.findByTestId('autopilot-row');
    expect(within(row).getByText('Kopi')).toBeInTheDocument();
    expect(within(row).getByText('Coffee tips')).toBeInTheDocument();
    expect(within(row).getByText('2 a day · 12:00, 19:00')).toBeInTheDocument();
    expect(within(row).getByText('Active')).toBeInTheDocument();
    expect(within(row).getByText(/^Next: .*12:00/)).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Pause Kopi' }));
    expect(ipc.setAutopilotStatus).toHaveBeenCalledWith('a1', 'paused');
    expect(await within(row).findByRole('button', { name: 'Resume Kopi' })).toBeInTheDocument();
    expect(within(row).getByText('Paused')).toBeInTheDocument();
    expect(within(row).queryByText(/^Next:/)).toBeNull();
    await userEvent.click(within(row).getByRole('button', { name: 'Resume Kopi' }));
    expect(ipc.setAutopilotStatus).toHaveBeenLastCalledWith('a1', 'active');
  });

  it('describes a weekly autopilot', async () => {
    vi.mocked(ipc.listAutopilots).mockResolvedValue([autopilot({ frequency: { kind: 'weekly', days: [0, 3, 1], time: '09:00' } })]);
    render(<Calendar today={today} />);
    expect(await screen.findByText('3 a week · Mon, Wed, Sun · 09:00')).toBeInTheDocument();
  });

  it('asks before deleting, and deleting removes the row', async () => {
    vi.mocked(ipc.listAutopilots).mockResolvedValue([autopilot()]);
    vi.mocked(ipc.deleteAutopilot).mockImplementation(async () => {
      vi.mocked(ipc.listAutopilots).mockResolvedValue([]);
    });
    render(<Calendar today={today} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Kopi' }));
    expect(await screen.findByText('Delete Kopi?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(ipc.deleteAutopilot).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete Kopi' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete autopilot' }));
    expect(ipc.deleteAutopilot).toHaveBeenCalledWith('a1');
    await waitFor(() => expect(screen.queryByTestId('autopilot-row')).toBeNull());
  });

  it('shows an error line when an action fails', async () => {
    vi.mocked(ipc.listAutopilots).mockResolvedValue([autopilot()]);
    vi.mocked(ipc.setAutopilotStatus).mockRejectedValue(new Error('x'));
    render(<Calendar today={today} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Pause Kopi' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't update the autopilot");
  });

  it('shows Stop now on a making slot only when the engine has registered a handler', async () => {
    const making = slot('s', new Date(2026, 10, 4, 12, 0), { status: 'making' });
    vi.mocked(ipc.listAutopilots).mockResolvedValue([autopilot()]);
    vi.mocked(ipc.listSlots).mockResolvedValue([making]);
    const { unmount } = render(<Calendar today={today} />);
    expect(await screen.findByText('Making a video now')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop now' })).toBeNull();
    unmount();
    const stop = vi.fn();
    setStopNowHandler(stop);
    render(<Calendar today={today} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Stop now' }));
    expect(stop).toHaveBeenCalledWith(making);
  });

  it('speaks Indonesian', async () => {
    setUiLanguage('id');
    vi.mocked(ipc.listAutopilots).mockResolvedValue([autopilot()]);
    render(<Calendar today={today} />);
    expect(await screen.findByText('2 sehari · 12:00, 19:00')).toBeInTheDocument();
    expect(screen.getByText('Aktif')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Autopilot baru' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Segera hadir/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Simpan autopilot' })).toBeInTheDocument();
  });
});

describe('Autopilot dialog', () => {
  it('rejects an empty form without saving, then names what is missing', async () => {
    render(<Calendar today={today} />);
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save autopilot' }));
    expect(ipc.saveAutopilot).not.toHaveBeenCalled();
    expect(within(dialog).getByText('Give it a name')).toBeInTheDocument();
    expect(within(dialog).getByText('Say what the videos are about')).toBeInTheDocument();
  });

  it('saves a daily autopilot with the defaults, an example chip and a second time', async () => {
    render(<Calendar today={today} />);
    const dialog = await open();
    await userEvent.type(within(dialog).getByLabelText('Name'), '  Kopi  ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Home coffee brewing tips' }));
    expect(within(dialog).getByLabelText('Niche')).toHaveValue('Home coffee brewing tips');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add a time' }));
    fireEvent.change(within(dialog).getByLabelText('Time 2'), { target: { value: '19:30' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save autopilot' }));
    await waitFor(() => expect(ipc.saveAutopilot).toHaveBeenCalledTimes(1));
    expect(ipc.saveAutopilot).toHaveBeenCalledWith({
      id: undefined,
      name: 'Kopi',
      niche: 'Home coffee brewing tips',
      language: 'id',
      styleId: 's1',
      agentId: 'claude',
      frequency: { kind: 'daily', times: ['12:00', '19:30'] },
      lengthSec: 30,
      review: true,
      posting: 'manual',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(ipc.listAutopilots).toHaveBeenCalledTimes(2);
  });

  it('limits times to six, removes one, and refuses a repeated time', async () => {
    render(<Calendar today={today} />);
    const dialog = await open();
    for (let i = 0; i < 5; i++) await userEvent.click(within(dialog).getByRole('button', { name: 'Add a time' }));
    expect(within(dialog).queryByRole('button', { name: 'Add a time' })).toBeNull();
    expect(within(dialog).getAllByLabelText(/^Time \d$/)).toHaveLength(6);
    await userEvent.click(within(dialog).getAllByRole('button', { name: /^Remove / })[0]!);
    expect(within(dialog).getAllByLabelText(/^Time \d$/)).toHaveLength(5);
    // The other five were all added as 18:00: the same time twice is refused.
    await userEvent.type(within(dialog).getByLabelText('Name'), 'A');
    await userEvent.type(within(dialog).getByLabelText('Niche'), 'B');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save autopilot' }));
    expect(ipc.saveAutopilot).not.toHaveBeenCalled();
    expect(within(dialog).getByText('Use 1 to 6 different times')).toBeInTheDocument();
  });

  it('saves a weekly autopilot with the chosen days, length, language and review off', async () => {
    render(<Calendar today={today} />);
    const dialog = await open();
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Mingguan');
    await userEvent.type(within(dialog).getByLabelText('Niche'), 'Finance');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Certain days' }));
    // Mon, Wed, Fri start picked; drop Wed, add Sun.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wed' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sun' }));
    fireEvent.change(within(dialog).getByLabelText('Time'), { target: { value: '08:15' } });
    await userEvent.selectOptions(within(dialog).getByLabelText('Length'), '60');
    await userEvent.selectOptions(within(dialog).getByLabelText('Video language'), 'en');
    await userEvent.selectOptions(within(dialog).getByLabelText('Style'), 's2');
    await userEvent.selectOptions(within(dialog).getByLabelText('Agent'), 'gemini');
    await userEvent.click(within(dialog).getByRole('switch', { name: "Review before it's ready" }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save autopilot' }));
    await waitFor(() => expect(ipc.saveAutopilot).toHaveBeenCalled());
    expect(ipc.saveAutopilot).toHaveBeenCalledWith({
      id: undefined,
      name: 'Mingguan',
      niche: 'Finance',
      language: 'en',
      styleId: 's2',
      agentId: 'gemini',
      frequency: { kind: 'weekly', days: [0, 1, 5], time: '08:15' },
      lengthSec: 60,
      review: false,
      posting: 'manual',
    });
  });

  it('needs a day in weekly mode', async () => {
    render(<Calendar today={today} />);
    const dialog = await open();
    await userEvent.type(within(dialog).getByLabelText('Name'), 'A');
    await userEvent.type(within(dialog).getByLabelText('Niche'), 'B');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Certain days' }));
    for (const d of ['Mon', 'Wed', 'Fri']) await userEvent.click(within(dialog).getByRole('button', { name: d }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save autopilot' }));
    expect(ipc.saveAutopilot).not.toHaveBeenCalled();
    expect(within(dialog).getByText('Pick at least one day')).toBeInTheDocument();
  });

  it('offers only installed agents, and shows automatic posting as coming soon', async () => {
    render(<Calendar today={today} />);
    const dialog = await open();
    const agent = within(dialog).getByLabelText('Agent');
    expect(within(agent).getAllByRole('option').map((o) => o.textContent)).toEqual(['Claude Code', 'Gemini CLI']);
    expect(within(dialog).getByRole('radio', { name: /Manual/ })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: /Automatic/ })).toBeDisabled();
    expect(within(dialog).getByText(/Coming soon/)).toBeInTheDocument();
  });

  it('edits an existing autopilot: prefilled, saved with its id', async () => {
    vi.mocked(ipc.listAutopilots).mockResolvedValue([autopilot()]);
    render(<Calendar today={today} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Kopi' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Edit autopilot')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Kopi');
    expect(within(dialog).getByLabelText('Style')).toHaveValue('s2');
    expect(within(dialog).getByLabelText('Agent')).toHaveValue('gemini');
    expect(within(dialog).getByLabelText('Length')).toHaveValue('45');
    expect(within(dialog).getByLabelText('Time 1')).toHaveValue('19:00');
    await userEvent.clear(within(dialog).getByLabelText('Name'));
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Kopi baru');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save autopilot' }));
    await waitFor(() => expect(ipc.saveAutopilot).toHaveBeenCalled());
    expect(ipc.saveAutopilot).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1', name: 'Kopi baru', styleId: 's2', agentId: 'gemini', lengthSec: 45, review: false, frequency: { kind: 'daily', times: ['12:00', '19:00'] } }),
    );
  });

  it('keeps the dialog open with an error when saving fails', async () => {
    vi.mocked(ipc.saveAutopilot).mockRejectedValue(new Error('no'));
    render(<Calendar today={today} />);
    const dialog = await open();
    await userEvent.type(within(dialog).getByLabelText('Name'), 'A');
    await userEvent.type(within(dialog).getByLabelText('Niche'), 'B');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save autopilot' }));
    expect(await within(dialog).findByText("Couldn't save the autopilot. Try again")).toBeInTheDocument();
  });
});

describe('Planned slots on the calendar', () => {
  it('draws planned, making and failed slots as ghost entries on their day', async () => {
    vi.mocked(ipc.listAutopilots).mockResolvedValue([autopilot()]);
    vi.mocked(ipc.listSlots).mockResolvedValue([
      slot('p', new Date(2026, 10, 5, 12, 0)),
      slot('m', new Date(2026, 10, 4, 12, 0), { status: 'making' }),
      slot('f', new Date(2026, 10, 6, 12, 0), { status: 'failed', error: 'No video file was rendered' }),
      slot('d', new Date(2026, 10, 7, 12, 0), { status: 'done', projectId: 'x' }),
      slot('k', new Date(2026, 10, 8, 12, 0), { status: 'skipped' }),
    ]);
    render(<Calendar today={today} />);
    await screen.findAllByTestId('cal-ghost');
    const cell = (d: string) => document.querySelector(`[data-date="${d}"]`) as HTMLElement;
    expect(within(cell('2026-11-05')).getByText('Planned · Kopi')).toBeInTheDocument();
    expect(within(cell('2026-11-05')).getByText('12:00')).toBeInTheDocument();
    expect(within(cell('2026-11-04')).getByText('Making · Kopi')).toBeInTheDocument();
    expect(within(cell('2026-11-06')).getByText('Failed · Kopi')).toBeInTheDocument();
    expect(within(cell('2026-11-06')).getByText('No video file was rendered')).toBeInTheDocument();
    expect(screen.getAllByTestId('cal-ghost')).toHaveLength(3);
  });

  it('a failed slot in the future has Try again, which sets it back to planned', async () => {
    vi.mocked(ipc.listAutopilots).mockResolvedValue([autopilot()]);
    const failed = slot('f', new Date(2026, 10, 6, 12, 0), { status: 'failed', error: 'x' });
    vi.mocked(ipc.listSlots).mockResolvedValue([failed]);
    vi.mocked(ipc.updateSlot).mockImplementation(async () => {
      const next = { ...failed, status: 'planned' as const, error: null, projectId: null };
      vi.mocked(ipc.listSlots).mockResolvedValue([next]);
      return next;
    });
    render(<Calendar today={today} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again: Kopi' }));
    expect(ipc.updateSlot).toHaveBeenCalledWith('f', { status: 'planned', error: null, projectId: null });
    expect(await screen.findByText('Planned · Kopi')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again: Kopi' })).toBeNull();
  });

  it('a failed slot that is already past has no Try again; a ghost in Indonesian reads Direncanakan', async () => {
    vi.mocked(ipc.listAutopilots).mockResolvedValue([autopilot()]);
    vi.mocked(ipc.listSlots).mockResolvedValue([slot('f', new Date(2026, 10, 3, 12, 0), { status: 'failed' }), slot('p', new Date(2026, 10, 5, 12, 0))]);
    setUiLanguage('id');
    render(<Calendar today={today} />);
    expect(await screen.findByText('Direncanakan · Kopi')).toBeInTheDocument();
    expect(screen.getByText('Gagal · Kopi')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Coba lagi/ })).toBeNull();
  });

  it('a slot whose autopilot is gone, or that already has a video, draws nothing', async () => {
    vi.mocked(ipc.listAutopilots).mockResolvedValue([autopilot()]);
    vi.mocked(ipc.listSlots).mockResolvedValue([
      slot('orphan', new Date(2026, 10, 5, 12, 0), { autopilotId: 'gone' }),
      slot('has', new Date(2026, 10, 5, 13, 0), { projectId: 'p' }),
    ]);
    render(<Calendar today={today} />);
    await screen.findByTestId('autopilot-row');
    await act(async () => {});
    expect(screen.queryByTestId('cal-ghost')).toBeNull();
  });
});

describe('Autopilot fix round', () => {
  it('shows a failed slot that kept its project, with the project title, and Try again clears the project', async () => {
    vi.mocked(ipc.listAutopilots).mockResolvedValue([autopilot()]);
    vi.mocked(ipc.listProjects).mockResolvedValue([
      { id: 'pr', title: 'Kopi susu', slug: 'k', folder: '/w/k', kind: 'explainer', format: '9:16', language: 'id', status: 'draft', styleId: null, scheduledAt: null, reviewState: 'none', postedAt: null, remindedAt: null, reviewRemindedAt: null, durationSec: null, createdAt: 'c', updatedAt: 'u' },
    ]);
    vi.mocked(ipc.listSlots).mockResolvedValue([slot('f', new Date(2026, 10, 6, 12, 0), { status: 'failed', projectId: 'pr', error: 'x' })]);
    vi.mocked(ipc.updateSlot).mockResolvedValue(slot('f', new Date(2026, 10, 6, 12, 0)));
    render(<Calendar today={today} />);
    expect(await screen.findByText('Failed · Kopi')).toBeInTheDocument();
    expect(await screen.findByText('Kopi susu')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again: Kopi' }));
    expect(ipc.updateSlot).toHaveBeenCalledWith('f', { status: 'planned', error: null, projectId: null });
  });

  it('draws no planned ghosts for a paused autopilot', async () => {
    vi.mocked(ipc.listAutopilots).mockResolvedValue([autopilot({ status: 'paused' })]);
    vi.mocked(ipc.listSlots).mockResolvedValue([slot('p', new Date(2026, 10, 5, 12, 0))]);
    render(<Calendar today={today} />);
    await screen.findByTestId('autopilot-row');
    await act(async () => {});
    expect(screen.queryByTestId('cal-ghost')).toBeNull();
  });

  it('reloads autopilots and slots when something announces a change', async () => {
    vi.mocked(ipc.listAutopilots).mockResolvedValue([autopilot()]);
    const making = slot('s', new Date(2026, 10, 4, 12, 0), { status: 'making' });
    vi.mocked(ipc.listSlots).mockResolvedValue([making]);
    render(<Calendar today={today} />);
    expect(await screen.findByText('Making · Kopi')).toBeInTheDocument();
    vi.mocked(ipc.listSlots).mockResolvedValue([{ ...making, status: 'done', projectId: 'x' }]);
    await act(async () => notifyAutopilotChanged());
    await waitFor(() => expect(screen.queryByText('Making · Kopi')).toBeNull());
    expect(screen.queryByText('Making a video now')).toBeNull();
  });

  it('Stop now appears when the handler registers after mount, runs, then the panel reloads and drops it', async () => {
    vi.mocked(ipc.listAutopilots).mockResolvedValue([autopilot()]);
    const making = slot('s', new Date(2026, 10, 4, 12, 0), { status: 'making' });
    vi.mocked(ipc.listSlots).mockResolvedValue([making]);
    render(<Calendar today={today} />);
    await screen.findByText('Making a video now');
    expect(screen.queryByRole('button', { name: 'Stop now' })).toBeNull();
    const stop = vi.fn(async () => {
      vi.mocked(ipc.listSlots).mockResolvedValue([{ ...making, status: 'failed', error: 'Stopped' }]);
    });
    act(() => void setStopNowHandler(stop));
    await userEvent.click(await screen.findByRole('button', { name: 'Stop now' }));
    expect(stop).toHaveBeenCalledWith(making);
    await waitFor(() => expect(screen.queryByText('Making a video now')).toBeNull());
    expect(screen.getByText('Failed · Kopi')).toBeInTheDocument();
  });

  it('a Stop now that fails shows an error instead of an unhandled rejection', async () => {
    vi.mocked(ipc.listAutopilots).mockResolvedValue([autopilot()]);
    vi.mocked(ipc.listSlots).mockResolvedValue([slot('s', new Date(2026, 10, 4, 12, 0), { status: 'making' })]);
    setStopNowHandler(async () => {
      throw new Error('boom');
    });
    render(<Calendar today={today} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Stop now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't update the autopilot");
  });

  it('deleting an autopilot that is making a video stops it first', async () => {
    const order: string[] = [];
    vi.mocked(ipc.listAutopilots).mockResolvedValue([autopilot()]);
    const making = slot('s', new Date(2026, 10, 4, 12, 0), { status: 'making' });
    vi.mocked(ipc.listSlots).mockResolvedValue([making]);
    setStopNowHandler(async () => void order.push('stop'));
    vi.mocked(ipc.deleteAutopilot).mockImplementation(async () => void order.push('delete'));
    render(<Calendar today={today} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Kopi' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete autopilot' }));
    await waitFor(() => expect(order).toEqual(['stop', 'delete']));
  });

  it('fetches slots once per reload, not again when the autopilots arrive', async () => {
    vi.mocked(ipc.listAutopilots).mockResolvedValue([autopilot()]);
    vi.mocked(ipc.listSlots).mockResolvedValue([slot('p', new Date(2026, 10, 5, 12, 0))]);
    render(<Calendar today={today} />);
    await screen.findByText('Planned · Kopi');
    await act(async () => {});
    expect(ipc.listSlots).toHaveBeenCalledTimes(1);
    await act(async () => notifyAutopilotChanged());
    await act(async () => {});
    expect(ipc.listSlots).toHaveBeenCalledTimes(2);
  });

  it('clears the load error once a later load succeeds', async () => {
    vi.mocked(ipc.listAutopilots).mockRejectedValueOnce(new Error('busy'));
    render(<Calendar today={today} />);
    expect(await screen.findByText("Couldn't load your autopilots. Try again")).toBeInTheDocument();
    vi.mocked(ipc.listAutopilots).mockResolvedValue([autopilot()]);
    await act(async () => notifyAutopilotChanged());
    await waitFor(() => expect(screen.queryByText("Couldn't load your autopilots. Try again")).toBeNull());
  });

  it('shows an error when the autopilots cannot be loaded', async () => {
    vi.mocked(ipc.listAutopilots).mockRejectedValue(new Error('no table'));
    render(<Calendar today={today} />);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your autopilots");
  });

  it('a new autopilot starts on the default agent, not the first installed one', async () => {
    useApp.setState({ settings: { ...settings, defaultAgent: 'gemini' } });
    render(<Calendar today={today} />);
    const dialog = await open();
    await waitFor(() => expect(within(dialog).getByLabelText('Agent')).toHaveValue('gemini'));
  });

  it('refuses to save an autopilot whose agent is no longer installed', async () => {
    vi.mocked(ipc.listAutopilots).mockResolvedValue([autopilot({ agentId: 'codex' })]);
    render(<Calendar today={today} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Kopi' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save autopilot' }));
    expect(ipc.saveAutopilot).not.toHaveBeenCalled();
    expect(within(dialog).getByText('Pick an agent')).toBeInTheDocument();
  });

  it('a saved autopilot closes the dialog even when the refresh afterwards fails, and a retry cannot duplicate it', async () => {
    render(<Calendar today={today} />);
    const dialog = await open();
    await userEvent.type(within(dialog).getByLabelText('Name'), 'A');
    await userEvent.type(within(dialog).getByLabelText('Niche'), 'B');
    vi.mocked(ipc.listAutopilots).mockRejectedValue(new Error('x'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save autopilot' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(ipc.saveAutopilot).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('autopilot-row')).toBeInTheDocument();
  });

  it('the clock moves on: a failed slot loses Try again once its time has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    try {
      vi.setSystemTime(new Date(2026, 10, 4, 10, 0));
      vi.mocked(ipc.listAutopilots).mockResolvedValue([autopilot()]);
      vi.mocked(ipc.listSlots).mockResolvedValue([slot('f', new Date(2026, 10, 4, 10, 0, 30), { status: 'failed' })]);
      render(<Calendar />);
      await act(async () => {});
      expect(screen.getByRole('button', { name: 'Try again: Kopi' })).toBeInTheDocument();
      await act(async () => {
        vi.advanceTimersByTime(61_000);
      });
      expect(screen.queryByRole('button', { name: 'Try again: Kopi' })).toBeNull();
      expect(screen.getByText('Failed · Kopi')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
