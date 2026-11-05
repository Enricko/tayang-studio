import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, File, FileCode, FileImage, FileText, FileVideo, Folder, FolderOpen, RefreshCw, Search } from 'lucide-react';
import { findProjectFiles, projectFiles, type ProjectFile } from '@/lib/ipc';
import { cn } from '@/lib/utils';

const CODE = /\.(tsx?|jsx?|mjs|cjs|json|css|html?|ya?ml|toml|rs|py|sh)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
const VIDEO = /\.(mp4|webm|mov|m4v)$/i;
const DOC = /\.(md|txt)$/i;

function FileIcon({ name }: { name: string }) {
  const Icon = IMAGE.test(name) ? FileImage : VIDEO.test(name) ? FileVideo : CODE.test(name) ? FileCode : DOC.test(name) ? FileText : File;
  return <Icon size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-text-3" />;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The project's files on the right of the project chat: a lazily loaded tree (a folder is read when it
 * is opened) and a name search. Picking a file opens it in the workspace. `reloadKey` reads the open
 * folders again (the agent may have changed them).
 */
export function FileTree({
  projectId,
  folderName,
  activePath,
  reloadKey,
  onOpen,
}: {
  projectId: string;
  folderName: string;
  activePath: string | null;
  reloadKey: number;
  onOpen(path: string): void;
}) {
  const { t } = useTranslation();
  const [dirs, setDirs] = useState<Record<string, ProjectFile[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<ProjectFile[] | null>(null);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const loadDir = useCallback(
    async (dir: string) => {
      try {
        const list = await projectFiles(projectId, dir);
        setDirs((d) => ({ ...d, [dir]: list }));
        if (dir === '') setError(null);
      } catch (e) {
        // A folder that went away just closes; the top failing is worth saying.
        if (dir === '') setError(t('workspace.loadFailed', { message: message(e) }));
        else
          setExpanded((x) => {
            const n = new Set(x);
            n.delete(dir);
            return n;
          });
      }
    },
    [projectId, t],
  );

  const reload = useCallback(() => {
    void loadDir('');
    for (const d of expandedRef.current) void loadDir(d);
  }, [loadDir]);

  useEffect(() => {
    setDirs({});
    setExpanded(new Set());
    void loadDir('');
  }, [projectId, loadDir]);

  useEffect(() => {
    if (reloadKey > 0) reload();
  }, [reloadKey, reload]);

  // The search runs a moment after typing stops.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setFound(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      findProjectFiles(projectId, q)
        .then((r) => alive && setFound(r))
        .catch(() => alive && setFound([]));
    }, 180);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, projectId]);

  const toggle = (dir: string) => {
    const opening = !expanded.has(dir);
    setExpanded((x) => {
      const n = new Set(x);
      if (opening) n.add(dir);
      else n.delete(dir);
      return n;
    });
    if (opening) void loadDir(dir);
  };

  const rows: { entry: ProjectFile; depth: number }[] = [];
  const walk = (dir: string, depth: number) => {
    for (const entry of dirs[dir] ?? []) {
      rows.push({ entry, depth });
      if (entry.dir && expanded.has(entry.path)) walk(entry.path, depth + 1);
    }
  };
  walk('', 0);

  const row = (entry: ProjectFile, depth: number, showPath = false) => {
    const open = entry.dir && expanded.has(entry.path);
    const active = !entry.dir && entry.path === activePath;
    return (
      <li key={entry.path} role="treeitem" aria-level={depth + 1} aria-expanded={entry.dir ? open : undefined} aria-selected={active || undefined}>
        <button
          type="button"
          title={entry.path}
          onClick={() => (entry.dir ? toggle(entry.path) : onOpen(entry.path))}
          className={cn(
            'flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-sm pr-2 text-left text-[13px] hover:bg-raised/60',
            active ? 'bg-raised text-foreground' : entry.dim ? 'text-text-3' : 'text-[#D9D9D9]',
          )}
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          {entry.dir ? (
            <>
              <ChevronRight size={13} aria-hidden="true" className={cn('shrink-0 text-text-3 transition-transform', open && 'rotate-90')} />
              {open ? (
                <FolderOpen size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-text-3" />
              ) : (
                <Folder size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-text-3" />
              )}
            </>
          ) : (
            <>
              <span className="w-[13px] shrink-0" aria-hidden="true" />
              <FileIcon name={entry.name} />
            </>
          )}
          <span className={cn('min-w-0 truncate', entry.dim && 'italic')}>{entry.name}</span>
          {showPath && entry.path !== entry.name && (
            <span className="ml-auto min-w-0 truncate pl-2 text-[11px] text-text-3">{entry.path.slice(0, -entry.name.length - 1)}</span>
          )}
        </button>
      </li>
    );
  };

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border pr-2 pl-3">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={folderName}>
          {folderName}
        </span>
        <button
          type="button"
          aria-label={t('workspace.refresh')}
          title={t('workspace.refresh')}
          onClick={reload}
          className="flex size-7 cursor-pointer items-center justify-center rounded-sm text-text-3 hover:bg-raised hover:text-foreground"
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="shrink-0 p-2">
        <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2 text-text-3 focus-within:border-text-3">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            placeholder={t('workspace.findFiles')}
            aria-label={t('workspace.findFiles')}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-text-3"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {error ? (
          <p role="alert" className="m-0 px-2 text-xs text-orange-light">
            {error}
          </p>
        ) : found ? (
          found.length ? (
            <ul role="tree" aria-label={t('workspace.files')} className="m-0 list-none p-0">
              {found.map((f) => row(f, 0, true))}
            </ul>
          ) : (
            <p className="m-0 px-2 text-xs text-text-3">{t('workspace.noMatches')}</p>
          )
        ) : dirs[''] && rows.length === 0 ? (
          <p className="m-0 px-2 text-xs text-text-3">{t('workspace.empty')}</p>
        ) : (
          <ul role="tree" aria-label={t('workspace.files')} className="m-0 list-none p-0">
            {rows.map(({ entry, depth }) => row(entry, depth))}
          </ul>
        )}
      </div>
    </div>
  );
}
