import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { Job, RecentChat } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({
  listRecentChats: vi.fn(),
  listArchivedChats: vi.fn(),
  setThreadArchived: vi.fn().mockResolvedValue(undefined),
  purgeArchive: vi.fn().mockResolvedValue({ chats: 1, cards: 1 }),
  setJobsArchived: vi.fn().mockResolvedValue(undefined),
  listJobs: vi.fn(),
  deleteJob: vi.fn().mockResolvedValue(undefined),
  detectAgents: vi.fn().mockResolvedValue([]),
  listProjects: vi.fn().mockResolvedValue([]),
  getChat: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/events', () => ({
  onQuestion: vi.fn(async () => () => {}),
  onAgentAction: vi.fn(async () => () => {}), onAgentUpdate: vi.fn(async () => () => {}) }));

import * as ipc from '@/lib/ipc';
import { ArchiveSection } from '@/components/ArchiveSection';
import { Sidebar } from '@/components/Sidebar';
import { Agents } from '@/screens/Agents';
import { useApp } from '@/state/app';
import { useChat } from '@/state/chat';
import { useJobs } from '@/state/jobs';

const chat = (id: string, title: string, extra: Partial<RecentChat> = {}): RecentChat => ({
  id,
  projectId: null,
  agentId: 'claude',
  title,
  createdAt: '2026-11-01T00:00:00Z',
  projectTitle: null,
  activeAt: '2026-11-01T00:00:00Z',
  ...extra,
});
const job = (id: string, status: Job['status'], extra: Partial<Job> = {}): Job => ({
  id,
  kind: 'build',
  title: `Video ${id}`,
  projectId: null,
  chatId: null,
  agentId: 'claude',
  status,
  progress: null,
  note: null,
  sourceUrl: null,
  updatedAt: '2026-11-01T00:00:00Z',
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  useChat.setState({ streaming: {}, permissions: {} } as never);
});

describe('archiving a thread from Recent', () => {
  it('archives on the hover button, drops the row and leaves the open chat', async () => {
    // After the archive the database leaves it out of Recent.
    vi.mocked(ipc.listRecentChats).mockResolvedValueOnce([chat('a', 'Kopi'), chat('b', 'Teh')]).mockResolvedValue([chat('b', 'Teh')]);
    useApp.setState({ route: { name: 'chat', chatId: 'a' }, leaveGuard: null });
    render(<Sidebar active="chat" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Archive Kopi' }));
    expect(ipc.setThreadArchived).toHaveBeenCalledWith('a', true);
    expect(screen.queryByText('Kopi')).not.toBeInTheDocument();
    expect(useApp.getState().route).toEqual({ name: 'chat-new' });
  });

  it('has no archive button while the chat\'s agent is working', async () => {
    vi.mocked(ipc.listRecentChats).mockResolvedValue([chat('a', 'Kopi')]);
    useChat.setState({ streaming: { a: true } } as never);
    render(<Sidebar active="chat" />);
    expect(await screen.findByText('Kopi')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive Kopi' })).not.toBeInTheDocument();
  });
});

describe('Settings › Archive', () => {
  it('lists archived chats and cards, restores one, and empties the rest after a confirm', async () => {
    vi.mocked(ipc.listArchivedChats).mockResolvedValue([chat('a', 'chat a', { projectTitle: 'Kopi', archivedAt: '2026-11-02T00:00:00Z' })]);
    vi.mocked(ipc.listJobs).mockResolvedValue([job('1', 'done', { archivedAt: '2026-11-02T00:00:00Z' }), job('2', 'done')]);
    render(<ArchiveSection />);
    expect(await screen.findByText('Kopi')).toBeInTheDocument();
    expect(screen.getByText('Video 1')).toBeInTheDocument();
    // A card still on the board is not in the archive.
    expect(screen.queryByText('Video 2')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Restore Kopi' }));
    expect(ipc.setThreadArchived).toHaveBeenCalledWith('a', false);
    await userEvent.click(screen.getByRole('button', { name: 'Restore Video 1' }));
    expect(ipc.setJobsArchived).toHaveBeenCalledWith(['1'], false);

    await userEvent.click(screen.getByRole('button', { name: 'Empty archive' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('deletes 1 chats and 1 cards');
    expect(ipc.purgeArchive).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete for good' }));
    expect(ipc.purgeArchive).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Archive emptied')).toBeInTheDocument();
  });

  it('says so when there is nothing archived, and cannot be emptied', async () => {
    vi.mocked(ipc.listArchivedChats).mockResolvedValue([]);
    vi.mocked(ipc.listJobs).mockResolvedValue([]);
    render(<ArchiveSection />);
    expect(await screen.findByText('No archived chats')).toBeInTheDocument();
    expect(screen.getByText('No archived cards')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Empty archive' })).toBeDisabled();
  });
});

describe('archiving finished cards on the board', () => {
  it('hides archived cards and archives one done card or all of them', async () => {
    const jobs = [job('1', 'done'), job('2', 'done'), job('3', 'done', { archivedAt: '2026-11-02T00:00:00Z' }), job('4', 'needs-you')];
    vi.mocked(ipc.listJobs).mockResolvedValue(jobs);
    useJobs.setState({ jobs } as never);
    render(<Agents />);
    const done = screen.getByRole('region', { name: 'Done' });
    expect(within(done).getByText('Video 1')).toBeInTheDocument();
    expect(within(done).queryByText('Video 3')).not.toBeInTheDocument();
    // Only finished cards can be archived.
    expect(screen.queryByRole('button', { name: 'Archive Video 4' })).not.toBeInTheDocument();

    await userEvent.click(within(done).getByRole('button', { name: 'Archive Video 1' }));
    expect(ipc.setJobsArchived).toHaveBeenCalledWith(['1'], true);
    await userEvent.click(within(done).getByRole('button', { name: 'Archive all' }));
    await waitFor(() => expect(ipc.setJobsArchived).toHaveBeenLastCalledWith(['1', '2'], true));
  });
});
