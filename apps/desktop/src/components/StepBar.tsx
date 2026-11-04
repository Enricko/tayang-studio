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

export function StepBar({ status }: { status: ProjectStatus }) {
  const { t } = useTranslation();
  const cur = currentStep(status);
  return (
    <ol aria-label={t('stepBar.aria')} className="m-0 flex list-none items-center gap-2 p-0">
      {STEPS.map((name, i) => {
        const done = i < cur;
        const active = i === cur;
        return (
          <li key={name} aria-current={active ? 'step' : undefined} className="flex items-center gap-2">
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
            <span className={cn('text-[13px]', active ? 'font-medium text-foreground' : 'text-text-2')}>{t(`stepBar.${name}`)}</span>
            {i < STEPS.length - 1 && <span aria-hidden="true" className="h-px w-4 bg-hairline" />}
          </li>
        );
      })}
    </ol>
  );
}
