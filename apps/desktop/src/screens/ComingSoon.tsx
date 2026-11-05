import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { Oyen } from '@/components/Oyen';
import { useApp } from '@/state/app';

/** A feature that isn't ready yet: what it will do, and where to go meanwhile. */
export function ComingSoon({ feature }: { feature: 'autopilot' }) {
  const { t } = useTranslation();
  const navigate = useApp((s) => s.navigate);
  return (
    <div data-tauri-drag-region className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <Oyen mood="sleepy" size={56} />
      <span className="rounded-full border border-deep-orange bg-tint px-3 py-1 text-xs font-medium text-orange-light">{t('comingSoon.badge')}</span>
      <h1 className="m-0 text-2xl font-semibold">{t(`comingSoon.${feature}.title`)}</h1>
      <p className="m-0 max-w-md text-sm text-text-2">{t(`comingSoon.${feature}.body`)}</p>
      <Button variant="secondary" onClick={() => navigate({ name: 'calendar' })}>
        {t(`comingSoon.${feature}.meanwhile`)}
      </Button>
    </div>
  );
}
