import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Project } from '@tayang/shared';
import { NoPreview } from '@/components/NoPreview';
import { assetUrl, videoThumbnail, type VideoThumb } from '@/lib/ipc';
import { mmss } from '@/lib/time';
import { useRender } from '@/state/render';

/**
 * A video's card picture: a frame of its newest render (made and cached by Rust, never blocking), with its
 * length; the calm no-preview panel without one; while a render runs, the panel says so. A render that
 * ends fetches the new frame.
 */
export function VideoPoster({ project }: { project: Project }) {
  const { t } = useTranslation();
  const rendering = useRender((s) => !!s.runs[project.id]);
  const [thumb, setThumb] = useState<VideoThumb | null>(null);
  const [broken, setBroken] = useState<string | null>(null);

  useEffect(() => {
    if (rendering) return;
    let alive = true;
    (async () => {
      try {
        const found = await videoThumbnail(project.id);
        if (alive) setThumb(found);
      } catch {
        if (alive) setThumb(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [project.id, project.updatedAt, rendering]);

  if (rendering) {
    return (
      <NoPreview className="rounded-xl">
        <span aria-hidden="true" className="tayang-pulse inline-block size-1.5 shrink-0 rounded-full bg-primary" />
        {t('videos.renderingNow')}
      </NoPreview>
    );
  }
  const src = thumb ? `${assetUrl(thumb.path)}?v=${encodeURIComponent(thumb.modifiedAt)}` : null;
  if (!src || broken === src) return <NoPreview className="rounded-xl">{t('videos.noPreview')}</NoPreview>;
  const duration = thumb?.durationSec ?? project.durationSec;
  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl border border-[#333] bg-ink">
      <img data-testid="video-thumb" src={src} alt="" loading="lazy" className="size-full object-cover" onError={() => setBroken(src)} />
      {duration != null && duration > 0 && (
        <span className="absolute right-2 bottom-2 rounded-sm bg-black/60 px-1 font-mono text-[11px] text-white/80">{mmss(duration)}</span>
      )}
    </div>
  );
}
