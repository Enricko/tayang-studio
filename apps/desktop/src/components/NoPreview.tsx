import type { ReactNode } from 'react';
import { Film } from 'lucide-react';
import { cn } from '@/lib/utils';

const SWATCHES: [string, string][] = [
  ['#0B1E3F', '#FFFFFF'],
  ['#F2470C', '#141414'],
  ['#E8ECF4', '#0B1E3F'],
  ['#3B1F14', '#FFE7D6'],
  ['#1F2A1A', '#F5E6A8'],
  ['#FFF0E0', '#3B1F14'],
];

/** A colour pair picked from `id`, the same every time. */
export function swatch(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SWATCHES[h % SWATCHES.length]!;
}

/**
 * The calm panel shown when there is no picture: a film icon on the `swatchId`'s colour (a style), or on ink
 * (a video). `children` is the muted line under the icon; without it the panel is decoration only.
 */
export function NoPreview({
  swatchId,
  className,
  testId = 'no-preview',
  children,
}: {
  swatchId?: string;
  className?: string;
  testId?: string;
  children?: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        'flex aspect-[9/16] w-full flex-col items-center justify-center gap-2 rounded-md border border-[#333]',
        !swatchId && 'bg-ink',
        className,
      )}
      style={swatchId ? { background: swatch(swatchId)[0] } : undefined}
      aria-hidden={children ? undefined : 'true'}
    >
      <Film size={24} strokeWidth={1.5} aria-hidden="true" className="text-text-3" />
      {children && <span className="inline-flex items-center gap-1.5 text-xs text-text-3">{children}</span>}
    </div>
  );
}
