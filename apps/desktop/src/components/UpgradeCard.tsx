import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, X } from 'lucide-react';
import dither from '@/assets/brand/dither-card.png';
import { findPlan, type BillingStatus } from '@tayang/shared';
import { Button } from '@/components/Button';
import { Oyen } from '@/components/Oyen';
import { formatIdr } from '@/lib/billing';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { uiLanguage } from '@/i18n';
import { useApp } from '@/state/app';
import { useAuth } from '@/state/auth';
import { useBilling } from '@/state/billing';

/** The cheapest plan with AI voice and image credits: what the card sells. */
const PLAN = 'creator' as const;
/** A dismissed card stays away this long. */
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const SNOOZE_KEY = 'tayang.upgradeCard.dismissedAt';

/** Whether a plan state lacks AI voice-overs: free, run out, or a plan without them (Lite). */
export function lacksVoice(status: BillingStatus | null): boolean {
  if (!status) return true;
  if (!status.active) return true;
  return !findPlan(status.plan)?.features.includes('voiceover');
}

function snoozed(now = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(SNOOZE_KEY));
    return Number.isFinite(at) && at > 0 && now - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

/**
 * Asks a user without AI voice-overs to upgrade: ElevenLabs voices and cheap AI images come with a
 * plan. Hidden for anyone whose plan has them, while a signed-in user's plan is still unknown, and
 * for a week after Close. `where` names the spot for analytics and picks the look.
 */
export function UpgradeCard({ where, className }: { where: 'sidebar' | 'calendar'; className?: string }) {
  const { t } = useTranslation();
  const navigate = useApp((s) => s.navigate);
  const signedIn = useAuth((s) => !!s.status?.signedIn);
  const { status, loadedAt, failed } = useBilling();
  const [hidden, setHidden] = useState(snoozed);

  // Signed in with no plan state yet: ask, so a paying user never sees the card.
  useEffect(() => {
    if (signedIn && loadedAt === 0 && !failed) void useBilling.getState().refresh();
  }, [signedIn, loadedAt, failed]);

  const known = !signedIn || (loadedAt > 0 && !failed);
  if (hidden || !known || !lacksVoice(signedIn ? status : null)) return null;

  const plan = findPlan(PLAN);
  const price = plan ? formatIdr(plan.price, uiLanguage()) : '';
  const close = () => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now()));
    } catch {
      // No storage: it just comes back next time.
    }
    track('upgrade card dismissed', { where });
    setHidden(true);
  };
  const open = () => {
    track('upgrade card clicked', { where });
    navigate({ name: 'plans', plan: PLAN });
  };

  const big = where === 'calendar';
  return (
    <section
      aria-label={t('upgradeCard.title')}
      className={cn(
        'group relative flex flex-col gap-2 overflow-hidden rounded-xl border border-deep-orange bg-tint p-3 pr-14',
        big && 'gap-3 p-4 pr-20',
        className,
      )}
    >
      <img src={dither} alt="" aria-hidden="true" className="pointer-events-none absolute top-0 right-0 w-24 opacity-70 select-none" />
      {/* Oyen peeks in from the corner, and leans out a little more on hover. */}
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute -right-3 -bottom-3 rotate-[-12deg] transition-transform duration-300 ease-out group-hover:-translate-y-1 group-hover:rotate-[-4deg] motion-reduce:transition-none',
        )}
      >
        <Oyen mood="wink" size={big ? 84 : 64} />
      </div>
      <button
        type="button"
        aria-label={t('upgradeCard.close')}
        onClick={close}
        className="absolute top-2 right-2 z-10 flex size-6 items-center justify-center rounded-sm text-text-3 hover:bg-raised hover:text-foreground"
      >
        <X size={14} aria-hidden="true" />
      </button>
      <span className={cn('relative text-[13px] leading-[1.3] font-semibold text-foreground', big && 'text-sm')}>{t('upgradeCard.title')}</span>
      <p className="relative m-0 text-xs leading-[1.5] text-text-2">{t('upgradeCard.body', { price })}</p>
      <Button className="relative h-8 gap-1.5 self-start px-3 text-[13px]" onClick={open}>
        <Sparkles size={14} aria-hidden="true" />
        {t('upgradeCard.cta')}
      </Button>
    </section>
  );
}
