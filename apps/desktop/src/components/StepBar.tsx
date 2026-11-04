import { useTranslation } from 'react-i18next';
import type { ProjectStatus } from '@tayang/shared';
import { cn } from '@/lib/utils';

export const STEPS = ['topic', 'script', 'style', 'build', 'render'] as const;

/** Index of the step the project is on: draft→Script, building→Build, rendered→Render. */
export function currentStep(status: ProjectStatus): number {
  if (status === 'draft') return 1;
  if (status === 'building') return 3;
  return 4;
}

type Props =
  | { status: ProjectStatus }
  | {
      /** Visible step names, in order. */
      steps: string[];
      current: number;
      /** The list's accessible name. */
      label: string;
      /** When given, every step is a button that jumps to it. */
      onPick?: (index: number) => void;
    };

/** A project's progress (`status`), or any numbered steps (`steps`), such as the autopilot wizard's. */
export function StepBar(props: Props) {
  const { t } = useTranslation();
  const own = 'steps' in props;
  const names = own ? props.steps : STEPS.map((s) => t(`stepBar.${s}`));
  const cur = own ? props.current : currentStep(props.status);
  const onPick = own ? props.onPick : undefined;
  return (
    <ol aria-label={own ? props.label : t('stepBar.aria')} className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
      {names.map((name, i) => {
        const done = i < cur;
        const active = i === cur;
        const body = (
          <>
            <span
              aria-hidden="true"
              className={cn(
                'inline-flex size-5 items-center justify-center rounded-full font-mono text-[11px]',
                done && 'bg-deep-orange text-orange-light',
                active && 'bg-primary text-primary-foreground',
                !done && !active && 'border border-hairline text-text-3',
              )}
            >
              {done ? '✓' : i + 1}
            </span>
            <span className={cn('text-[13px]', active ? 'font-medium text-foreground' : 'text-text-2')}>{name}</span>
          </>
        );
        return (
          <li key={name} aria-current={!onPick && active ? 'step' : undefined} className="flex items-center gap-2">
            {onPick ? (
              <button
                type="button"
                aria-current={active ? 'step' : undefined}
                onClick={() => onPick(i)}
                className="inline-flex cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-primary"
              >
                {body}
              </button>
            ) : (
              body
            )}
            {i < names.length - 1 && <span aria-hidden="true" className="h-px w-4 bg-hairline" />}
          </li>
        );
      })}
    </ol>
  );
}
