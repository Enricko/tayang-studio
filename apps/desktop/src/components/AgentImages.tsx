import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, FolderOpen, ImageOff } from 'lucide-react';
import { capabilities, revealInFolder } from '@/lib/platform';
import type { MessagePart } from '@tayang/shared';
import { Button } from '@/components/Button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { assetUrl } from '@/lib/ipc';

export type ImagePart = Extract<MessagePart, { type: 'file' }>;

/** At most this many thumbnails before a "+N more" tile. */
const VISIBLE = 8;

export const isImagePart = (p: MessagePart): p is ImagePart => p.type === 'file' && p.mime.startsWith('image/');

/** The file's URL, new again whenever the file was rewritten. */
const srcOf = (p: ImagePart) => {
  const base = assetUrl(p.path);
  return p.modifiedAt ? `${base}${base.includes('?') ? '&' : '?'}v=${encodeURIComponent(p.modifiedAt)}` : base;
};

/**
 * The image's URL and whether it is gone. A file still being written can fail to decode, so a failed
 * image is read once more (`r=1`) before it counts as gone. A new file starts over at once.
 */
function useImage(part: ImagePart) {
  const base = srcOf(part);
  const [failed, setFailed] = useState({ base, times: 0 });
  const times = failed.base === base ? failed.times : 0;
  return {
    src: times ? `${base}${base.includes('?') ? '&' : '?'}r=1` : base,
    gone: times > 1,
    onError: () => setFailed({ base, times: times + 1 }),
  };
}

function Missing({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-center text-xs text-text-3 ${className}`}>
      <ImageOff size={14} strokeWidth={1.5} aria-hidden="true" />
      {t('chat.images.gone')}
    </span>
  );
}

function Thumb({ part, onOpen }: { part: ImagePart; onOpen(thumb: HTMLElement): void }) {
  const { t } = useTranslation();
  const { src, gone, onError } = useImage(part);
  if (gone) return <Missing className="h-24 w-24" />;
  return (
    <button
      type="button"
      onClick={(e) => onOpen(e.currentTarget)}
      aria-label={t('chat.images.open', { name: part.name })}
      title={part.name}
      className="cursor-pointer overflow-hidden rounded-md border border-border bg-card p-0"
    >
      <img
        src={src}
        alt={part.name}
        loading="lazy"
        decoding="async"
        onError={onError}
        className="block h-24 w-auto max-w-[180px] min-w-12 object-cover"
      />
    </button>
  );
}

/**
 * The images an agent made during its turn, after the words and steps they followed: 96 px thumbnails,
 * 8 at most until "+N more" shows the rest. A click opens them full size.
 */
export function ImageStrip({ parts, all }: { parts: ImagePart[]; all: ImagePart[] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  /** The thumbnail that opened the lightbox: focus goes back to it when it closes. */
  const opener = useRef<HTMLElement | null>(null);
  // The clicked thumbnail itself: WebKit does not focus a button on a mouse click.
  const openAt = (i: number, thumb: HTMLElement) => {
    opener.current = thumb;
    setOpen(i);
  };
  const shown = expanded ? parts : parts.slice(0, VISIBLE);
  const more = parts.length - shown.length;
  return (
    <div role="group" aria-label={t('chat.images.label')} className="flex flex-wrap gap-2">
      {shown.map((p) => (
        <Thumb key={p.path} part={p} onOpen={(thumb) => openAt(all.indexOf(p), thumb)} />
      ))}
      {more > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex h-24 w-24 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-[13px] font-medium text-text-2 hover:text-foreground"
        >
          {t('chat.images.more', { count: more })}
        </button>
      )}
      <Lightbox images={all} index={open} onIndex={setOpen} returnFocus={() => opener.current?.focus()} />
    </div>
  );
}

/** One image at a time, fit to the window, with the message's other images a key press away. */
function Lightbox({
  images,
  index,
  onIndex,
  returnFocus,
}: {
  images: ImagePart[];
  index: number | null;
  onIndex(i: number | null): void;
  returnFocus(): void;
}) {
  const { t } = useTranslation();
  const part = index === null ? null : images[index];
  const step = (d: number) => index !== null && images.length > 1 && onIndex((index + d + images.length) % images.length);
  return (
    <Dialog open={!!part} onOpenChange={(o) => !o && onIndex(null)}>
      <DialogContent
        className="flex max-h-[95vh] w-auto max-w-[95vw] flex-col items-center gap-3 sm:max-w-[95vw]"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocus();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') step(1);
          else if (e.key === 'ArrowLeft') step(-1);
        }}
      >
        {part && (
          <>
            <DialogTitle className="max-w-full truncate pr-8 text-[14px] font-medium">{part.name}</DialogTitle>
            <DialogDescription className="sr-only">{t('chat.images.position', { n: index! + 1, count: images.length })}</DialogDescription>
            <FullImage part={part} />
            <div className="flex items-center gap-2">
              {images.length > 1 && (
                <Button variant="ghost" size="icon" aria-label={t('chat.images.previous')} onClick={() => step(-1)} className="size-8 px-0">
                  <ChevronLeft size={16} strokeWidth={1.5} />
                </Button>
              )}
              <Button variant="secondary" className="h-8 px-3 text-[13px]" onClick={() => void revealInFolder(part.path).catch(() => {})}>
                <FolderOpen size={14} strokeWidth={1.5} aria-hidden="true" />
                {t('chat.images.reveal')}
              </Button>
              {images.length > 1 && (
                <Button variant="ghost" size="icon" aria-label={t('chat.images.next')} onClick={() => step(1)} className="size-8 px-0">
                  <ChevronRight size={16} strokeWidth={1.5} />
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FullImage({ part }: { part: ImagePart }) {
  const { src, gone, onError } = useImage(part);
  if (gone) return <Missing className="h-40 w-64" />;
  return <img src={src} alt={part.name} onError={onError} className="max-h-[75vh] max-w-full object-contain" />;
}
