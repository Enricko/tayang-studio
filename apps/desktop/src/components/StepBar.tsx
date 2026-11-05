import { useTranslation } from 'react-i18next';
import type { ProjectStatus } from '@tayang/shared';
import { cn } from '@/lib/utils';

export const STEPS = ['topic', 'script', 'style', 'build', 'render'] as const;

/**
 * Index of the step the project is on. Topic is always done. draft → Script; building → Build (Script and
 * Style done); a render running for the project → Render; rendered (or scheduled) → 5: every step done,
 * none current. A rendered video that renders again is on Render.
 */
export function currentStep(status: ProjectStatus, rendering = false): number {
  if (rendering) return 4;
  if (status === 'draft') return 1;
  if (status === 'building') return 3;
  return STEPS.length;
}

type Props =
  | {
      status: ProjectStatus;
      /** A render of this project is running (state/render.ts). */
      rendering?: boolean;
    }
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
  const rendering = !own && !!props.rendering;
  const cur = own ? props.current : currentStep(props.status, rendering);
  const onPick = own ? props.onPick : undefined;
  return (
    // A project's steps sit in the chat header: one line always, and when its container (`@container/steps`)
    // is narrow, only the current step keeps its name.
    <ol
      aria-label={own ? props.label : t('stepBar.aria')}
      className={cn('m-0 flex list-none items-center gap-2 p-0', own ? 'flex-wrap' : 'flex-nowrap')}
    >
      {names.map((name, i) => {
        const done = i < cur;
        const active = i === cur;
        const pulse = active && rendering;
        const body = (
          <>
            <span
              aria-hidden="true"
              data-step-mark
              className={cn(
                'inline-flex size-5 items-center justify-center rounded-full font-mono text-[11px]',
                done && 'bg-deep-orange text-orange-light',
                active && 'bg-primary text-primary-foreground',
                !done && !active && 'border border-hairline text-text-3',
              )}
            >
              {done ? '✓' : i + 1}
            </span>
            <span
              data-step-name
              className={cn(
                'text-[13px] whitespace-nowrap',
                active ? 'font-medium text-foreground' : 'text-text-2',
                !own && !active && '@max-[34rem]/steps:sr-only',
              )}
            >
              {name}
            </span>
            {pulse && (
              <>
                {/* Still under reduced motion. */}
                <span aria-hidden="true" data-step-pulse className="size-1.5 rounded-full bg-primary motion-safe:animate-pulse" />
                <span className="sr-only">{t('stepBar.renderingNow')}</span>
              </>
            )}
          </>
        );
        return (
          <li key={name} title={name} aria-current={!onPick && active ? 'step' : undefined} className="flex shrink-0 items-center gap-2">
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
            {i < names.length - 1 && <span aria-hidden="true" className={cn('h-px w-4 shrink-0 bg-hairline', !own && '@max-[34rem]/steps:w-2')} />}
          </li>
        );
      })}
    </ol>
  );
}
