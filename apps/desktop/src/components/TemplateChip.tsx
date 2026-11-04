import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { Style } from '@tayang/shared';
import { listStyles } from '@/lib/ipc';

/** The template picked on the Style screen, above the composer until a topic starts a project or the user removes it. */
export function TemplateChip({ styleId, onRemove }: { styleId: string | null; onRemove(): void }) {
  const { t } = useTranslation();
  const [style, setStyle] = useState<Style | null>(null);

  useEffect(() => {
    if (!styleId) return;
    let alive = true;
    listStyles()
      .then((all) => alive && setStyle(all.find((s) => s.id === styleId) ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [styleId]);

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
