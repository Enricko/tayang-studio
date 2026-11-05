import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { MessagePart, Style } from '@tayang/shared';
import { listStyles } from '@/lib/ipc';
import { useChat } from '@/state/chat';

/**
 * The styles the @ menu lists, the Style screen's list, read again on each mount. Kept in the chat store,
 * so the next chat screen starts with the last list (no template chip blinking). Best effort.
 */
export function useStyles(): Style[] {
  useEffect(() => {
    void Promise.resolve()
      .then(() => listStyles())
      .then((styles) => useChat.setState({ styles }))
      .catch(() => {});
  }, []);
  return useChat((s) => s.styles);
}

/** The styles a message's context is built from: the loaded ones, or a fresh read when a restored chip is sent before they load. */
export async function stylesFor(parts: MessagePart[], styles: Style[]): Promise<Style[]> {
  if (styles.length || !parts.some((p) => p.type === 'style-mention')) return styles;
  return listStyles().catch(() => styles);
}

/** `ref`'s style when it has a starter template, else null. */
export const templateOf = (ref: { styleId: string } | null | undefined, styles: Style[]): string | null =>
  ref && styles.some((s) => s.id === ref.styleId && s.template) ? ref.styleId : null;

/**
 * The composer's style chip when it is a template: it is the chat's template then, and the template chip
 * steps aside so there is one chip, not two.
 */
export const useChipTemplate = (draftKey: string, styles: Style[]): string | null =>
  templateOf(
    useChat((s) => s.drafts[draftKey]?.style),
    styles,
  );

/** The template picked on the Style screen, above the composer until a topic starts a project or the user removes it. */
export function TemplateChip({ styleId, onRemove, styles }: { styleId: string | null; onRemove(): void; styles?: Style[] }) {
  const { t } = useTranslation();
  const [read, setStyle] = useState<Style | null>(null);
  // The screen's styles when it has them; else a read of its own.
  const style = styles ? (styles.find((s) => s.id === styleId) ?? null) : read;

  useEffect(() => {
    if (!styleId || styles) return;
    let alive = true;
    listStyles()
      .then((all) => alive && setStyle(all.find((s) => s.id === styleId) ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [styleId, styles]);

  if (!styleId || !style?.template) return null;
  return (
    <div
      title={t('chat.templateChipTitle')}
      className="mb-2 inline-flex items-center gap-1 rounded-full border border-border bg-card py-1 pr-1 pl-3 text-xs text-text-2"
    >
      <span>{t('chat.startingFrom', { name: style.name })}</span>
      <button
        type="button"
        aria-label={t('chat.removeTemplate', { name: style.name })}
        onClick={onRemove}
        className="inline-flex size-5 cursor-pointer items-center justify-center rounded-full text-text-3 hover:text-foreground"
      >
        <X size={12} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );
}
