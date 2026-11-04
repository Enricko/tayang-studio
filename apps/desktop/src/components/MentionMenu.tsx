import type { Project } from '@tayang/shared';
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';

const STATUS: Record<Project['status'], string> = {
  draft: 'Draft',
  building: 'Building',
  rendered: 'Rendered',
  scheduled: 'Scheduled',
};

function meta(p: Project) {
  if (p.durationSec == null) return STATUS[p.status];
  const s = Math.round(p.durationSec);
  return `${STATUS[p.status]} · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function filterProjects(projects: Project[], query: string): Project[] {
  const q = query.trim().toLowerCase();
  return q ? projects.filter((p) => p.title.toLowerCase().includes(q)) : projects;
}

/** The list inside the @ popover. The textarea keeps focus and drives `value` with the arrow keys. */
export function MentionMenu({
  projects,
  value,
  onValueChange,
  onPick,
}: {
  projects: Project[];
  value: string;
  onValueChange(id: string): void;
  onPick(p: Project): void;
}) {
  return (
    <Command shouldFilter={false} value={value} onValueChange={onValueChange} className="bg-transparent">
      <CommandList aria-label="Mention a video" className="max-h-[240px]">
        <CommandGroup heading="Videos">
          {projects.length === 0 && <div className="px-2 py-3 text-[13px] text-text-3">No videos yet</div>}
          {projects.map((p) => (
            <CommandItem key={p.id} value={p.id} onSelect={() => onPick(p)} className="h-12 gap-3 px-2">
              <span aria-hidden="true" className="h-9 w-5 shrink-0 rounded-xs border border-hairline bg-raised" />
              <span className="flex min-w-0 flex-col text-left">
                <span className="truncate text-[13px] font-medium">{p.title}</span>
                <span className="text-xs text-text-3">{meta(p)}</span>
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      <div className="mt-1 flex items-center gap-2 border-t border-border px-2 pb-1 pt-2 text-xs text-text-3">
        {['↑', '↓'].map((k) => (
          <kbd key={k} className="rounded-xs border border-hairline border-b-2 px-1 font-mono text-[11px] text-[#D9D9D9]">
            {k}
          </kbd>
        ))}
        <span>move</span>
        <kbd className="ml-2 rounded-xs border border-hairline border-b-2 px-1 font-mono text-[11px] text-[#D9D9D9]">↵</kbd>
        <span>attach</span>
        <kbd className="ml-2 rounded-xs border border-hairline border-b-2 px-1 font-mono text-[11px] text-[#D9D9D9]">Esc</kbd>
        <span>close</span>
      </div>
    </Command>
  );
}
