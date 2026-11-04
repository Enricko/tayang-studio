import { invoke } from '@tauri-apps/api/core';
import type { Project } from '@tayang/shared';

// Typed stubs. Task 10 fills in the remaining commands.
export function listProjects(): Promise<Project[]> {
  return invoke<Project[]>('list_projects');
}
