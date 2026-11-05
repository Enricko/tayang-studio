import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

vi.mock('@/lib/ipc', () => ({
  projectFiles: vi.fn(),
  findProjectFiles: vi.fn(),
  readProjectFile: vi.fn(),
  assetUrl: (p: string) => `asset://${p}`,
}));
vi.mock('@/lib/highlight', () => ({ highlight: vi.fn(async () => null) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn(async () => {}) }));

import * as ipc from '@/lib/ipc';
import { highlight } from '@/lib/highlight';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { FileTree } from '@/components/workspace/FileTree';
import { Workspace } from '@/components/workspace/Workspace';
import { useWorkspace } from '@/state/workspace';

const f = (path: string, dir = false, dim = false) => ({ name: path.split('/').pop()!, path, dir, size: 10, dim });

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspace.setState({ byProject: {} });
  vi.mocked(ipc.projectFiles).mockImplementation(async (_p, dir = '') =>
    dir === '' ? [f('node_modules', true, true), f('src', true), f('AGENTS.md')] : dir === 'src' ? [f('src/Video.tsx')] : [],
  );
  vi.mocked(ipc.findProjectFiles).mockResolvedValue([f('src/scenes/intro.tsx')]);
});

describe('open file tabs', () => {
  it('opens once, shows the neighbour when the shown one closes, then the preview', () => {
    const w = useWorkspace.getState();
    w.open('p', 'a.ts');
    w.open('p', 'b.ts');
    w.open('p', 'a.ts');
    expect(useWorkspace.getState().byProject.p).toEqual({ files: ['a.ts', 'b.ts'], active: 'a.ts' });
    w.close('p', 'a.ts');
    expect(useWorkspace.getState().byProject.p).toEqual({ files: ['b.ts'], active: 'b.ts' });
    w.show('p', null);
    w.close('p', 'b.ts');
    expect(useWorkspace.getState().byProject.p).toEqual({ files: [], active: null });
    // Projects keep their own tabs.
    expect(useWorkspace.getState().byProject.q).toBeUndefined();
  });
});

describe('FileTree', () => {
  it('lists the top folder, opens a folder when clicked, and opens files', async () => {
    const onOpen = vi.fn();
    render(<FileTree projectId="p" folderName="my-video" activePath={null} reloadKey={0} onOpen={onOpen} />);
    const tree = await screen.findByRole('tree', { name: 'Files' });
    expect(within(tree).getAllByRole('treeitem').map((i) => i.textContent)).toEqual(['node_modules', 'src', 'AGENTS.md']);
    await userEvent.click(within(tree).getByRole('button', { name: 'src' }));
    expect(ipc.projectFiles).toHaveBeenCalledWith('p', 'src');
    await userEvent.click(await within(tree).findByRole('button', { name: 'Video.tsx' }));
    expect(onOpen).toHaveBeenCalledWith('src/Video.tsx');
    expect(within(tree).getByRole('treeitem', { name: /src/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('searches by name and goes back to the tree when the search is cleared', async () => {
    render(<FileTree projectId="p" folderName="my-video" activePath={null} reloadKey={0} onOpen={() => {}} />);
    await screen.findByRole('tree');
    const box = screen.getByRole('searchbox', { name: 'Find files' });
    await userEvent.type(box, 'intro');
    expect(await screen.findByRole('button', { name: /intro\.tsx/ })).toBeInTheDocument();
    expect(ipc.findProjectFiles).toHaveBeenCalledWith('p', 'intro');
    await userEvent.type(box, '{Escape}');
    expect(await screen.findByRole('button', { name: 'AGENTS.md' })).toBeInTheDocument();
  });

  it('reads the open folders again on a new reloadKey', async () => {
    const { rerender } = render(<FileTree projectId="p" folderName="v" activePath={null} reloadKey={0} onOpen={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'src' }));
    vi.mocked(ipc.projectFiles).mockClear();
    rerender(<FileTree projectId="p" folderName="v" activePath={null} reloadKey={1} onOpen={() => {}} />);
    await waitFor(() => expect(ipc.projectFiles).toHaveBeenCalledWith('p', 'src'));
    expect(ipc.projectFiles).toHaveBeenCalledWith('p', '');
  });
});

describe('Workspace', () => {
  const preview = <div data-testid="the-preview">video</div>;

  it('shows the preview first, a file in its own tab, and keeps the preview mounted', async () => {
    vi.mocked(ipc.readProjectFile).mockResolvedValue({ kind: 'text', absPath: '/x/src/Video.tsx', size: 20, text: 'const a = 1;\nconst b = 2;' });
    render(<Workspace projectId="p" reloadKey={0} preview={preview} />);
    expect(screen.getByRole('tab', { name: /Preview/ })).toHaveAttribute('aria-selected', 'true');
    useWorkspace.getState().open('p', 'src/Video.tsx');
    expect(await screen.findByRole('tab', { name: 'Video.tsx' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByTestId('code')).toHaveTextContent('const a = 1;');
    expect(highlight).toHaveBeenCalledWith('const a = 1;\nconst b = 2;', 'Video.tsx');
    // Still there, only hidden: the video keeps its place.
    expect(screen.getByTestId('the-preview').parentElement).toHaveClass('hidden');
    await userEvent.click(screen.getByRole('button', { name: 'Close src/Video.tsx' }));
    expect(screen.queryByRole('tab', { name: 'Video.tsx' })).not.toBeInTheDocument();
    expect(screen.getByTestId('the-preview').parentElement).not.toHaveClass('hidden');
  });

  it('shows images and videos from the project, and offers the folder for files it cannot show', async () => {
    vi.mocked(ipc.readProjectFile).mockImplementation(async (_p, path) =>
      path.endsWith('.png')
        ? { kind: 'image', absPath: '/x/a.png', size: 5, text: null }
        : path.endsWith('.mp4')
          ? { kind: 'video', absPath: '/x/v.mp4', size: 5, text: null }
          : { kind: 'tooLarge', absPath: '/x/big.json', size: 5 * 1024 * 1024, text: null },
    );
    render(<Workspace projectId="p" reloadKey={0} preview={preview} />);
    useWorkspace.getState().open('p', 'a.png');
    expect(await screen.findByRole('img', { name: 'a.png' })).toHaveAttribute('src', 'asset:///x/a.png');
    useWorkspace.getState().open('p', 'v.mp4');
    await waitFor(() => expect(document.querySelector('video')).toHaveAttribute('src', 'asset:///x/v.mp4'));
    useWorkspace.getState().open('p', 'big.json');
    expect(await screen.findByText('This file is too large to show here (5.0 MB).')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Show in folder' })[0]!);
    expect(revealItemInDir).toHaveBeenCalledWith('/x/big.json');
  });

  it('says so when a file cannot be opened', async () => {
    vi.mocked(ipc.readProjectFile).mockRejectedValue(new Error('That file isn\'t there any more'));
    render(<Workspace projectId="p" reloadKey={0} preview={preview} />);
    useWorkspace.getState().open('p', 'gone.ts');
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't open this file: That file isn't there any more");
  });
});
