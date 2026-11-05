import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArchiveRestore } from 'lucide-react';
import type { Job, RecentChat } from '@tayang/shared';
import { Button } from '@/components/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { listArchivedChats, listJobs, purgeArchive, setJobsArchived, setThreadArchived } from '@/lib/ipc';
import { ago } from '@/lib/time';
import { useApp } from '@/state/app';
import { refreshJobs } from '@/state/jobs';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Settings › Archive: archived threads and board cards, each restorable, and a way to empty it all. */
export function ArchiveSection() {
  const { t } = useTranslation();
  const [chats, setChats] = useState<RecentChat[]>([]);
  const [cards, setCards] = useState<Job[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const version = useApp((s) => s.projectsVersion);

  const load = useCallback(() => {
    Promise.all([listArchivedChats(), listJobs()])
      .then(([c, j]) => {
        setChats(c);
        setCards(j.filter((x) => x.archivedAt).sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? '')));
      })
      .catch((e) => setError(t('archive.failed', { message: message(e) })));
  }, [t]);

  useEffect(load, [load, version]);

  const act = async (run: () => Promise<unknown>) => {
    setError(null);
    setNotice(null);
    try {
      await run();
    } catch (e) {
      setError(t('archive.failed', { message: message(e) }));
    }
    load();
    useApp.getState().bumpProjects();
    void refreshJobs().catch(() => {});
  };

  const empty = () =>
    act(async () => {
      setBusy(true);
      try {
        await purgeArchive();
        setConfirming(false);
        setNotice(t('archive.emptied'));
      } finally {
        setBusy(false);
      }
    });

  const nothing = chats.length === 0 && cards.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-xs text-text-3">{t('archive.hint')}</p>
      <div className="rounded-xl border border-border bg-card">
        <List
          title={t('archive.chats')}
          emptyText={t('archive.noChats')}
          items={chats.map((c) => ({ id: c.id, name: c.projectTitle ?? c.title, at: c.archivedAt ?? c.activeAt }))}
          onRestore={(id) => void act(() => setThreadArchived(id, false))}
        />
        <List
          title={t('archive.cards')}
          emptyText={t('archive.noCards')}
          items={cards.map((j) => ({ id: j.id, name: j.title, at: j.archivedAt ?? j.updatedAt }))}
          onRestore={(id) => void act(() => setJobsArchived([id], false))}
        />
      </div>
      <div className="flex items-center gap-3">
        <Button variant="secondary" disabled={nothing} onClick={() => setConfirming(true)}>
          {t('archive.empty')}
        </Button>
        {notice && (
          <span role="status" className="text-xs text-text-2">
            {notice}
          </span>
        )}
        {error && (
          <span role="alert" className="text-xs text-orange-light">
            {error}
          </span>
        )}
      </div>

      <Dialog open={confirming} onOpenChange={(o) => !busy && setConfirming(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('archive.confirmTitle')}</DialogTitle>
            <DialogDescription>{t('archive.confirmBody', { chats: chats.length, cards: cards.length })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
              {t('archive.cancel')}
            </Button>
            <Button disabled={busy} onClick={() => void empty()}>
              {t('archive.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function List({
  title,
  emptyText,
  items,
  onRestore,
}: {
  title: string;
  emptyText: string;
  items: { id: string; name: string; at: string }[];
  onRestore(id: string): void;
}) {
  const { t } = useTranslation();
  return (
    <section aria-label={title} className="flex flex-col border-b border-[#222] px-4 py-3 last:border-b-0">
      <span className="pb-2 text-sm">
        {title} <span className="font-mono text-xs text-text-3">{items.length}</span>
      </span>
      {items.length === 0 ? (
        <span className="text-xs text-text-3">{emptyText}</span>
      ) : (
        <ul className="m-0 flex max-h-64 list-none flex-col overflow-y-auto p-0">
          {items.map((it) => (
            <li key={it.id} className="flex h-9 items-center gap-3 border-t border-[#1c1c1c] first:border-t-0">
              <span className="min-w-0 flex-1 truncate text-[13px]">{it.name}</span>
              <span className="shrink-0 text-xs text-text-3">{t('archive.archivedAgo', { ago: ago(it.at) })}</span>
              <Button
                variant="ghost"
                className="h-7 shrink-0 px-2 text-[13px]"
                aria-label={t('archive.restoreName', { name: it.name })}
                onClick={() => onRestore(it.id)}
              >
                <ArchiveRestore size={14} aria-hidden="true" />
                {t('archive.restore')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
