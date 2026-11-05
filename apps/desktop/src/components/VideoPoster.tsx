import { useEffect, useState } from 'react';
import { Film } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Project } from '@tayang/shared';
import { NoPreview } from '@/components/NoPreview';
import { assetUrl, videoThumbnail, type VideoThumb } from '@/lib/ipc';
import { mmss } from '@/lib/time';
import { useRender } from '@/state/render';

/**
 * A video's newest render frame (made and cached by Rust, never blocking) and whether a render runs
 * now. A render that ends fetches the new frame. `src` is null without one, or when it failed to load
 * (`markBroken`).
 */
export function useVideoThumb(project: Project) {
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

  const raw = thumb ? `${assetUrl(thumb.path)}?v=${encodeURIComponent(thumb.modifiedAt)}` : null;
  const src = raw && broken !== raw ? raw : null;
  const durationSec = thumb?.durationSec ?? project.durationSec ?? null;
  return { rendering, src, durationSec, markBroken: () => setBroken(raw) };
}

/**
 * A video's card picture: a frame of its newest render with its length; the calm no-preview panel
 * without one; while a render runs, the panel says so.
 */
export function VideoPoster({ project }: { project: Project }) {
  const { t } = useTranslation();
  const { rendering, src, durationSec: duration, markBroken } = useVideoThumb(project);

  if (rendering) {
    return (
      <NoPreview className="rounded-xl">
        <span aria-hidden="true" className="tayang-pulse inline-block size-1.5 shrink-0 rounded-full bg-primary" />
        {t('videos.renderingNow')}
      </NoPreview>
    );
  }
  if (!src) return <NoPreview className="rounded-xl">{t('videos.noPreview')}</NoPreview>;
  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl border border-[#333] bg-ink">
      <img data-testid="video-thumb" src={src} alt="" loading="lazy" className="size-full object-cover" onError={markBroken} />
      {duration != null && duration > 0 && (
        <span className="absolute right-2 bottom-2 rounded-sm bg-black/60 px-1 font-mono text-[11px] text-white/80">{mmss(duration)}</span>
      )}
    </div>
  );
}

/** The list row's small picture, from `useVideoThumb`: the frame, a film icon, or a pulse while rendering. */
export function SmallPoster({ thumb }: { thumb: ReturnType<typeof useVideoThumb> }) {
  const box = 'relative flex aspect-[9/16] w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[#333] bg-ink';
  if (thumb.rendering) {
    return (
      <div className={box} aria-hidden="true">
        <span className="tayang-pulse size-1.5 rounded-full bg-primary" />
      </div>
    );
  }
  if (!thumb.src) {
    return (
      <div className={box} aria-hidden="true">
        <Film size={14} strokeWidth={1.5} className="text-text-3" />
      </div>
    );
  }
  return (
    <div className={box}>
      <img data-testid="video-thumb" src={thumb.src} alt="" loading="lazy" className="size-full object-cover" onError={thumb.markBroken} />
    </div>
  );
}
