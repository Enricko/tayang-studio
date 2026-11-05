import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, RotateCw } from 'lucide-react';
import { Button } from '@/components/Button';
import { useChat } from '@/state/chat';
import { useUpdater } from '@/state/updater';

/** The sidebar's note that a new version is out: download it, then restart into it. Hidden otherwise. */
export function UpdateBanner() {
  const { t } = useTranslation();
  const { phase, version, percent, error, download, restart } = useUpdater();
  // Restarting stops every agent turn that is running.
  const working = useChat((s) => Object.values(s.streaming).filter(Boolean).length);
  if (phase !== 'available' && phase !== 'downloading' && phase !== 'ready') return null;

  return (
    <div role="status" className="flex flex-col gap-2 rounded-lg border border-deep-orange bg-tint p-3 text-[13px]">
      <p className="m-0 font-medium text-foreground">
        {phase === 'ready' ? t('updates.ready', { version: version ?? '' }) : t('updates.available', { version: version ?? '' })}
      </p>
      {phase === 'downloading' && (
        <p className="m-0 text-text-2">
          {percent === null ? t('updates.downloadingNoPercent') : t('updates.downloading', { percent })}
        </p>
      )}
      {error && phase === 'available' && (
        <p role="alert" className="m-0 text-orange-light">
          {t('updates.failed', { message: error })}
        </p>
      )}
      {phase === 'ready' && working > 0 && <p className="m-0 text-text-2">{t('updates.agentsWorking', { count: working })}</p>}
      {phase === 'available' && (
        <Button className="h-8 text-[13px]" onClick={() => void download()}>
          <ArrowDownToLine size={14} aria-hidden="true" />
          {error ? t('updates.retry') : t('updates.update')}
        </Button>
      )}
      {phase === 'ready' && (
        <Button className="h-8 text-[13px]" onClick={() => void restart()}>
          <RotateCw size={14} aria-hidden="true" />
          {t('updates.restart')}
        </Button>
      )}
    </div>
  );
}
