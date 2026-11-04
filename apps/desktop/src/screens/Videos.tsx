import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Search } from 'lucide-react';
import type { Project, ProjectStatus } from '@tayang/shared';
import { Button } from '@/components/Button';
import { Oyen } from '@/components/Oyen';
import { ScheduleDialog } from '@/components/ScheduleDialog';
import { VideoPoster } from '@/components/VideoPoster';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { locale } from '@/i18n';
import { listProjects } from '@/lib/ipc';
import { openProjectChat } from '@/lib/openProject';
import { ago } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useApp } from '@/state/app';

type Tab = 'all' | 'progress' | 'rendered' | 'scheduled';

const TABS: { id: Tab; match(p: Project): boolean }[] = [
  { id: 'all', match: () => true },
  { id: 'progress', match: (p) => p.status === 'draft' || p.status === 'building' },
  { id: 'rendered', match: (p) => p.status === 'rendered' },
  // Scheduling leaves `status` alone, so the tab follows the schedule itself.
  { id: 'scheduled', match: (p) => p.status === 'scheduled' || (!!p.scheduledAt && !p.postedAt) },
];

const DOT: Record<ProjectStatus, string> = {
  building: 'bg-primary',
  draft: 'border border-text-3',
  rendered: 'bg-text-3',
  scheduled: 'bg-foreground',
};

export function Videos() {
  const { t } = useTranslation();
  const navigate = useApp((s) => s.navigate);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [scheduleFor, setScheduleFor] = useState<Project | null>(null);
  // Statuses move on by themselves (a chat builds, a render finishes): follow them.
  const version = useApp((s) => s.projectsVersion);

  useEffect(() => {
    let alive = true;
    listProjects()
      .then((p) => alive && setProjects(p))
      .catch(() => alive && setProjects((l) => l ?? []));
    return () => {
      alive = false;
    };
  }, [version]);

  const list = projects ?? [];
  const shown = useMemo(() => {
    const current = TABS.find((x) => x.id === tab)!;
    const needle = q.trim().toLowerCase();
    return list.filter((p) => current.match(p) && (!needle || p.title.toLowerCase().includes(needle)));
  }, [list, tab, q]);

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-8">
      <div data-tauri-drag-region className="flex flex-wrap items-center gap-4">
        <div className="mr-auto flex flex-col gap-1">
          <h1 className="m-0 text-[28px] font-semibold tracking-[-0.01em]">{t('videos.title')}</h1>
          <span className="text-sm text-text-2">{t('videos.subtitle')}</span>
        </div>
        <div className="relative w-60">
          <Search size={16} strokeWidth={1.5} aria-hidden="true" className="absolute top-1/2 left-3 -translate-y-1/2 text-text-3" />
          <Input
            type="search"
            aria-label={t('videos.searchAria')}
            placeholder={t('videos.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 bg-card pl-9"
          />
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList variant="line" aria-label={t('videos.filterAria')} className="h-10 w-full justify-start border-b border-border p-0">
          {TABS.map((tb) => (
            <TabsTrigger key={tb.id} value={tb.id} className="h-10 flex-none px-3 text-sm">
              {t(`videos.tabs.${tb.id}`)}
              <span className="ml-1 font-mono text-xs text-text-3">{list.filter((p) => tb.match(p)).length}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {projects && list.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16">
          <Oyen mood="default" size={64} />
          <span className="text-base font-medium">{t('videos.empty')}</span>
          <Button onClick={() => navigate({ name: 'chat-new' })}>{t('videos.newChat')}</Button>
        </div>
      ) : (
        <div className="grid gap-x-5 gap-y-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(176px, 1fr))' }}>
          {shown.map((p) => {
            return (
              <div key={p.id} className="relative">
              <button
                type="button"
                onClick={() => void openProjectChat(p).catch(() => {})}
                className="flex w-full flex-col gap-3 bg-transparent p-0 text-left text-foreground"
              >
                <VideoPoster project={p} />
                <div className="flex flex-col gap-1">
                  <span className="text-sm leading-[1.3] font-medium">{p.title}</span>
                  <div className="flex items-center gap-2 text-xs">
                    <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', DOT[p.status])} />
                    <span className="text-text-2">{t(`videos.status.${p.status}`)}</span>
                    <span className="text-text-3">· {p.format} · {ago(p.updatedAt)}</span>
                  </div>
                  {p.scheduledAt && !Number.isNaN(new Date(p.scheduledAt).getTime()) && (
                    <span className="font-mono text-[11px] text-text-3">
                      {new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(p.scheduledAt))}
                    </span>
                  )}
                </div>
              </button>
              <button
                type="button"
                aria-label={t('schedule.actionFor', { title: p.title })}
                title={t('schedule.action')}
                onClick={() => setScheduleFor(p)}
                className="absolute top-2 right-2 inline-flex size-8 items-center justify-center rounded-md bg-black/60 text-white hover:bg-black/80"
              >
                <CalendarClock size={16} strokeWidth={1.5} aria-hidden="true" />
              </button>
              </div>
            );
          })}
        </div>
      )}
      <ScheduleDialog
        open={scheduleFor !== null}
        onOpenChange={(o) => !o && setScheduleFor(null)}
        project={scheduleFor}
        onSaved={(saved) => setProjects((l) => l && l.map((x) => (x.id === saved.id ? saved : x)))}
      />
    </div>
  );
}
