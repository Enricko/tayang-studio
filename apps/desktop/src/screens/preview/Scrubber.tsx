import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { formatTimecode } from '@tayang/shared';

export interface Scene {
  name: string;
  startSec: number;
  endSec: number;
  /** Unbuilt scenes are drawn hatched. Defaults to built. */
  built?: boolean;
}

export interface ScrubberProps {
  durationSec: number;
  fps: number;
  frame: number;
  thumbnails: string[];
  onSeek(frame: number): void;
  scenes?: Scene[];
}

const HATCH = 'repeating-linear-gradient(135deg, #1A1A1A 0 6px, #202020 6px 12px)';

export function Scrubber({ durationSec, fps, frame, thumbnails, onSeek, scenes }: ScrubberProps) {
  const { t } = useTranslation();
  const total = Math.max(1, Math.round(durationSec * fps));
  const last = total - 1;
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const clamp = (f: number) => Math.min(last, Math.max(0, f));
  const time = formatTimecode(frame / fps, fps);
  const pct = (frame / last) * 100;
  const sceneAt = (sec: number) => scenes?.find((s) => sec < s.endSec) ?? scenes?.at(-1);
  const scene = sceneAt(frame / fps);

  const seekFromX = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    if (r.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    onSeek(clamp(Math.round(ratio * last)));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? fps : 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = frame + step;
    else if (e.key === 'ArrowLeft') next = frame - step;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    onSeek(clamp(next));
  };

  return (
    <div className="relative pt-8">
      <div
        className="pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-md border border-[#333333] bg-[#262626] px-2 py-0.5 font-mono text-[11px] text-foreground"
        style={{ left: `${Math.min(Math.max(pct, 14), 86)}%` }}
      >
        {scene ? `${time} · ${scene.name}` : time}
      </div>
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={t('preview.framesAria')}
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={frame}
        aria-valuetext={time}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          seekFromX(e.clientX);
        }}
        onPointerMove={(e) => dragging.current && seekFromX(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        className="relative flex h-14 cursor-pointer touch-none gap-0.5 overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {thumbnails.map((src, i) => {
          const sec = ((i + 0.5) / thumbnails.length) * durationSec;
          const built = sceneAt(sec)?.built !== false;
          return (
            <div
              key={src + i}
              className="min-w-0 flex-1 bg-cover bg-center"
              style={built ? { backgroundImage: `url("${src}")` } : { backgroundImage: HATCH }}
            />
          );
        })}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-8 h-14 w-0.5 -translate-x-1/2 bg-foreground"
        style={{ left: `${pct}%` }}
      >
        <div className="absolute -left-1.5 -top-1.5 flex h-5 w-3.5 items-center justify-center gap-0.5 rounded bg-foreground">
          <span className="h-2 w-px bg-text-3" />
          <span className="h-2 w-px bg-text-3" />
        </div>
      </div>
      {scenes && scenes.length > 0 && (
        <div className="mt-2 flex gap-0.5">
          {scenes.map((s) => (
            <span
              key={s.name + s.startSec}
              className={`min-w-0 truncate text-[11px] ${s === scene ? 'text-foreground' : 'text-text-3'}`}
              style={{ flex: `${s.endSec - s.startSec} 1 0` }}
            >
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
