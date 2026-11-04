import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RecentChat } from '@tayang/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { listRecentChats } from '@/lib/ipc';
import { recentChats } from '@/lib/recentChats';

/** Every chat, newest activity first, with a search box: Recent's "See all". */
export function AllChats({ open, onOpenChange, onPick }: { open: boolean; onOpenChange(open: boolean): void; onPick(chat: RecentChat): void }) {
  const { t } = useTranslation();
  const [all, setAll] = useState<RecentChat[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setQuery('');
    let alive = true;
    listRecentChats()
      .then((list) => alive && setAll(recentChats(list)))
      .catch(() => alive && setAll([]));
    return () => {
      alive = false;
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const shown = q ? all.filter((c) => (c.projectTitle ?? c.title).toLowerCase().includes(q)) : all;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('sidebar.allChats')}</DialogTitle>
        </DialogHeader>
        <Input type="search" aria-label={t('sidebar.searchChats')} placeholder={t('sidebar.searchChats')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {shown.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onPick(c)}
              className="flex h-8 shrink-0 cursor-pointer items-center truncate rounded-md px-3 text-left text-[13px] text-foreground hover:bg-raised/50"
            >
              {c.projectTitle ?? c.title}
            </button>
          ))}
          {shown.length === 0 && <p className="m-0 px-3 py-2 text-[13px] text-text-3">{q ? t('sidebar.noChats') : t('sidebar.noChatsYet')}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
