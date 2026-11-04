import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Project, ProjectStatus } from '@tayang/shared';
import { Button } from '@/components/Button';
import { Oyen } from '@/components/Oyen';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { listProjects } from '@/lib/ipc';
import { openProjectChat } from '@/lib/openProject';
import { ago, mmss } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useApp } from '@/state/app';

type Tab = 'all' | 'progress' | 'rendered' | 'scheduled';

const TABS: { id: Tab; label: string; match(s: ProjectStatus): boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'progress', label: 'In progress', match: (s) => s === 'draft' || s === 'building' },
  { id: 'rendered', label: 'Rendered', match: (s) => s === 'rendered' },
  { id: 'scheduled', label: 'Scheduled', match: (s) => s === 'scheduled' },
];

const STATUS: Record<ProjectStatus, { label: string; dot: string }> = {
  building: { label: 'Building', dot: 'bg-primary' },
  draft: { label: 'Draft', dot: 'border border-text-3' },
  rendered: { label: 'Rendered', dot: 'bg-text-3' },
  scheduled: { label: 'Scheduled', dot: 'bg-foreground' },
};

const THUMBS: [string, string][] = [
  ['#0B1E3F', '#FFFFFF'],
  ['#FFD23F', '#141414'],
  ['#3B1F14', '#FFE7D6'],
  ['#1F1F1F', '#FDFDFD'],
  ['#E8ECF4', '#0B1E3F'],
  ['#1F2A1A', '#F5E6A8'],
  ['#2B1B3F', '#F2E9FF'],
  ['#F2470C', '#141414'],
];

function thumbFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return THUMBS[h % THUMBS.length]!;
}

export function Videos() {
  const navigate = useApp((s) => s.navigate);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    listProjects()
      .then((p) => alive && setProjects(p))
      .catch(() => alive && setProjects([]));
    return () => {
      alive = false;
    };
  }, []);

  const list = projects ?? [];
  const shown = useMemo(() => {
    const t = TABS.find((x) => x.id === tab)!;
    const needle = q.trim().toLowerCase();
    return list.filter((p) => t.match(p.status) && (!needle || p.title.toLowerCase().includes(needle)));
  }, [list, tab, q]);

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-8">
      <div data-tauri-drag-region className="flex flex-wrap items-center gap-4">
        <div className="mr-auto flex flex-col gap-1">
          <h1 className="m-0 text-[28px] font-semibold tracking-[-0.01em]">Videos</h1>
          <span className="text-sm text-text-2">Everything you've made, saved on this computer</span>
        </div>
        <div className="relative w-60">
          <Search size={16} strokeWidth={1.5} aria-hidden="true" className="absolute top-1/2 left-3 -translate-y-1/2 text-text-3" />
          <Input
            type="search"
            aria-label="Search videos"
            placeholder="Search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 bg-card pl-9"
          />
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList variant="line" aria-label="Filter videos" className="h-10 w-full justify-start border-b border-border p-0">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="h-10 flex-none px-3 text-sm">
              {t.label}
              <span className="ml-1 font-mono text-xs text-text-3">{list.filter((p) => t.match(p.status)).length}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {projects && list.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16">
          <Oyen mood="default" size={64} />
          <span className="text-base font-medium">No videos yet</span>
          <Button onClick={() => navigate({ name: 'chat-new' })}>New chat</Button>
        </div>
      ) : (
        <div className="grid gap-x-5 gap-y-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(176px, 1fr))' }}>
          {shown.map((p) => {
            const [bg, fg] = thumbFor(p.id);
            const st = STATUS[p.status];
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => void openProjectChat(p).catch(() => {})}
                className="flex flex-col gap-3 bg-transparent p-0 text-left text-foreground"
              >
                <div
                  className="relative flex aspect-[9/16] w-full flex-col justify-between overflow-hidden rounded-xl border border-[#333] p-4"
                  style={{ background: bg, color: fg }}
                >
                  <span className="font-mono text-[9px] uppercase opacity-80">{p.kind}</span>
                  <span className="text-[22px] leading-[1.02] font-extrabold tracking-[-0.03em]">{p.title}</span>
                  {p.durationSec != null && (
                    <span className="absolute right-2 bottom-2 rounded-sm bg-black/60 px-1 font-mono text-[11px] text-white">
                      {mmss(p.durationSec)}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-sm leading-[1.3] font-medium">{p.title}</span>
                  <div className="flex items-center gap-2 text-xs">
                    <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', st.dot)} />
                    <span className="text-text-2">{st.label}</span>
                    <span className="text-text-3">· {p.format} · {ago(p.updatedAt)}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
