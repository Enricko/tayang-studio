import { siBluesky, siFacebook, siInstagram, siPinterest, siThreads, siTiktok, siX, siYoutube, type SimpleIcon } from 'simple-icons';
import { cn } from '@/lib/utils';

/** Brand marks from simple-icons (CC0). LinkedIn isn't in it any more: it gets its letters on its blue. */
const ICONS: Record<string, SimpleIcon> = {
  tiktok: siTiktok,
  tiktok_business: siTiktok,
  instagram: siInstagram,
  youtube: siYoutube,
  facebook: siFacebook,
  x: siX,
  threads: siThreads,
  pinterest: siPinterest,
  bluesky: siBluesky,
};

/** A platform's logo in white on a tile of its brand colour (black brands get a dark tile with a border). */
export function PlatformLogo({ platform, size = 20, className }: { platform: string; size?: number; className?: string }) {
  const icon = ICONS[platform];
  const dark = !icon || icon.hex === '000000';
  const bg = platform === 'linkedin' ? '#0A66C2' : icon && !dark ? `#${icon.hex}` : '#0B0B0B';
  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex shrink-0 items-center justify-center rounded-[22%]', dark && platform !== 'linkedin' && 'border border-hairline', className)}
      style={{ width: size, height: size, background: bg }}
    >
      {icon ? (
        <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="#FFFFFF">
          <path d={icon.path} />
        </svg>
      ) : platform === 'linkedin' ? (
        // i18n-ignore: LinkedIn's letters are its mark, not words.
        <span className="font-sans font-bold text-white" style={{ fontSize: size * 0.5, lineHeight: 1 }}>
          {'in' /* i18n-ignore */}
        </span>
      ) : null}
    </span>
  );
}
