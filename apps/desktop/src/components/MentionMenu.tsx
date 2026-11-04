import { useTranslation } from 'react-i18next';
import type { Project, Style } from '@tayang/shared';
import { i18n } from '@/i18n';
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { swatch } from '@/components/NoPreview';
import { posterOf, styleSource } from '@/lib/styleInfo';

function meta(p: Project) {
  const status = i18n.t(`mention.status.${p.status}`);
  if (p.durationSec == null) return status;
  const s = Math.round(p.durationSec);
  return `${status} · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function filterProjects(projects: Project[], query: string): Project[] {
  const q = query.trim().toLowerCase();
  return q ? projects.filter((p) => p.title.toLowerCase().includes(q)) : projects;
}

export function filterStyles(styles: Style[], query: string): Style[] {
  const q = query.trim().toLowerCase();
  return q ? styles.filter((s) => s.name.toLowerCase().includes(q)) : styles;
}

/** The menu's value for an item: videos and styles share one list the arrow keys move through. */
export const videoKey = (p: Pick<Project, 'id'>) => `video:${p.id}`;
export const styleKey = (s: Pick<Style, 'id'>) => `style:${s.id}`;

/** A 9:16 mini of the style: its picture, or its swatch. */
function StyleThumb({ style }: { style: Style }) {
  const src = posterOf(style);
  if (src) return <img src={src} alt="" aria-hidden="true" className="h-9 w-5 shrink-0 rounded-xs border border-hairline object-cover" />;
  const [bg, fg] = swatch(style.id);
  return (
    <span
      aria-hidden="true"
      data-testid="style-swatch"
      className="h-9 w-5 shrink-0 rounded-xs border border-hairline"
      style={{ background: `linear-gradient(160deg, ${bg} 60%, ${fg})` }}
    />
  );
}

/**
 * The list inside the @ popover: videos, then styles. Leave `projects` or `styles` out to leave out its
 * group. The textarea keeps focus and drives `value` with the arrow keys.
 */
export function MentionMenu({
  projects,
  styles,
  query,
  value,
  onValueChange,
  onPick,
  onPickStyle,
}: {
  projects?: Project[];
  styles?: Style[];
  /** What was typed after @: an empty group then says nothing matches rather than that there is nothing. */
  query: string;
  value: string;
  onValueChange(key: string): void;
  onPick(p: Project): void;
  onPickStyle(s: Style): void;
}) {
  const { t } = useTranslation();
  const empty = (none: string, noMatch: string) => (
    <div className="px-2 py-3 text-[13px] text-text-3">{query.trim() ? noMatch : none}</div>
  );
  return (
    <Command shouldFilter={false} value={value} onValueChange={onValueChange} className="bg-transparent">
      <CommandList aria-label={t('mention.aria')} className="max-h-[300px]">
        {projects && (
          <CommandGroup heading={t('mention.videos')}>
            {projects.length === 0 && empty(t('mention.none'), t('mention.noVideosMatch'))}
            {projects.map((p) => (
              <CommandItem key={p.id} value={videoKey(p)} onSelect={() => onPick(p)} className="h-12 gap-3 px-2">
                <span aria-hidden="true" className="h-9 w-5 shrink-0 rounded-xs border border-hairline bg-raised" />
                <span className="flex min-w-0 flex-col text-left">
                  <span className="truncate text-[13px] font-medium">{p.title}</span>
                  <span className="text-xs text-text-3">{meta(p)}</span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {styles && (
          <CommandGroup heading={t('mention.styles')}>
            {styles.length === 0 && empty(t('mention.noStyles'), t('mention.noStylesMatch'))}
            {styles.map((s) => (
              <CommandItem key={s.id} value={styleKey(s)} onSelect={() => onPickStyle(s)} className="h-12 gap-3 px-2">
                <StyleThumb style={s} />
                <span className="flex min-w-0 flex-col text-left">
                  <span className="truncate text-[13px] font-medium">{s.name}</span>
                  <span className="text-xs text-text-3">{styleSource(s)}</span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
      <div className="mt-1 flex items-center gap-2 border-t border-border px-2 pb-1 pt-2 text-xs text-text-3">
        {['↑', '↓'].map((k) => (
          <kbd key={k} className="rounded-xs border border-hairline border-b-2 px-1 font-mono text-[11px] text-[#D9D9D9]">
            {k}
          </kbd>
        ))}
        <span>{t('mention.move')}</span>
        <kbd className="ml-2 rounded-xs border border-hairline border-b-2 px-1 font-mono text-[11px] text-[#D9D9D9]">↵</kbd>
        <span>{t('mention.attach')}</span>
        <kbd className="ml-2 rounded-xs border border-hairline border-b-2 px-1 font-mono text-[11px] text-[#D9D9D9]">Esc</kbd>
        <span>{t('mention.close')}</span>
      </div>
    </Command>
  );
}
