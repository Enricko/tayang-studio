import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Clapperboard, X } from 'lucide-react';
import { FileView } from '@/components/workspace/FileView';
import { useProjectTabs, useWorkspace } from '@/state/workspace';
import { cn } from '@/lib/utils';

/**
 * The project chat's second pane: the video preview, plus a tab for each file opened from the file
 * sidebar. The preview stays mounted while a file is shown, so the video keeps its place.
 */
export function Workspace({ projectId, reloadKey, preview }: { projectId: string; reloadKey: number; preview: ReactNode }) {
  const { t } = useTranslation();
  const { files, active } = useProjectTabs(projectId);
  const show = useWorkspace((s) => s.show);
  const close = useWorkspace((s) => s.close);

  const tab = (key: string | null, label: ReactNode, title: string, closable: boolean) => {
    const selected = active === key;
    return (
      <div
        key={key ?? '__preview'}
        className={cn(
          'group flex h-full max-w-48 shrink-0 items-center border-r border-border',
          selected ? 'bg-[#101010] text-foreground' : 'text-text-3 hover:text-foreground',
        )}
      >
        <button
          type="button"
          role="tab"
          aria-selected={selected}
          title={title}
          onClick={() => show(projectId, key)}
          // Middle click closes a file tab, like an editor.
          onAuxClick={(e) => closable && key && e.button === 1 && close(projectId, key)}
          className={cn('flex h-full min-w-0 cursor-pointer items-center gap-1.5 text-[13px]', closable ? 'pl-3' : 'px-3')}
        >
          {label}
        </button>
        {closable && key && (
          <button
            type="button"
            aria-label={t('workspace.close', { name: title })}
            onClick={() => close(projectId, key)}
            className={cn(
              'mx-1 flex size-5 cursor-pointer items-center justify-center rounded-sm hover:bg-raised',
              selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
            )}
          >
            <X size={12} aria-hidden="true" />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label={t('workspace.tabs')} className="no-scrollbar flex h-9 shrink-0 overflow-x-auto border-b border-border bg-sidebar">
        {tab(
          null,
          <>
            <Clapperboard size={14} strokeWidth={1.5} aria-hidden="true" />
            {t('workspace.preview')}
          </>,
          t('workspace.preview'),
          false,
        )}
        {files.map((p) => tab(p, <span className="truncate">{p.split('/').pop()}</span>, p, true))}
      </div>
      <div className="relative min-h-0 flex-1">
        <div className={cn('h-full', active !== null && 'hidden')}>{preview}</div>
        {active !== null && <FileView projectId={projectId} path={active} reloadKey={reloadKey} />}
      </div>
    </div>
  );
}
