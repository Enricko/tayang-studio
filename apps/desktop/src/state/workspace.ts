import { create } from 'zustand';

/** What a project's workspace pane shows: the video preview, or one of its open files. */
export interface ProjectTabs {
  /** Open files, relative paths, in the order they were opened. */
  files: string[];
  /** The open file shown, or null for the preview. */
  active: string | null;
}

const EMPTY: ProjectTabs = { files: [], active: null };

interface WorkspaceState {
  byProject: Record<string, ProjectTabs>;
  /** Opens a file (or shows it if it is open already). */
  open(projectId: string, path: string): void;
  /** Closes a file; closing the one shown shows its neighbour, or the preview. */
  close(projectId: string, path: string): void;
  /** Shows an open file, or the preview with null. */
  show(projectId: string, path: string | null): void;
}

export const useWorkspace = create<WorkspaceState>((set) => {
  const update = (projectId: string, fn: (t: ProjectTabs) => ProjectTabs) =>
    set((s) => ({ byProject: { ...s.byProject, [projectId]: fn(s.byProject[projectId] ?? EMPTY) } }));
  return {
    byProject: {},
    open: (projectId, path) =>
      update(projectId, (t) => ({ files: t.files.includes(path) ? t.files : [...t.files, path], active: path })),
    close: (projectId, path) =>
      update(projectId, (t) => {
        const i = t.files.indexOf(path);
        if (i < 0) return t;
        const files = t.files.filter((f) => f !== path);
        const active = t.active === path ? (files[i] ?? files[i - 1] ?? null) : t.active;
        return { files, active };
      }),
    show: (projectId, path) => update(projectId, (t) => ({ ...t, active: path !== null && !t.files.includes(path) ? t.active : path })),
  };
});

/** A project's tabs (never undefined). */
export const useProjectTabs = (projectId: string): ProjectTabs => useWorkspace((s) => s.byProject[projectId] ?? EMPTY);
