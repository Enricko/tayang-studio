import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Check, ImageIcon, Mic, Send } from 'lucide-react';
import { Button } from '@/components/Button';
import { OnboardingHeader } from '@/components/OnboardingHeader';
import { SignInDialog, initials } from '@/components/Account';
import { updateSettings } from '@/lib/ipc';
import { capabilities } from '@/lib/platform';
import { useApp } from '@/state/app';
import { useAuth } from '@/state/auth';
import { track } from '@/lib/analytics';

/**
 * The last onboarding step, optional: sign in to a Tayang account (AI images and voice, auto-post,
 * premium styles) or skip it. Either way it finishes onboarding; Settings › Account signs in later.
 */
export function AccountStep() {
  const { t } = useTranslation();
  const navigate = useApp((s) => s.navigate);
  const setSettings = useApp((s) => s.setSettings);
  const apiUrl = useApp((s) => s.settings?.apiUrl ?? '');
  const status = useAuth((s) => s.status);
  const flow = useAuth((s) => s.flow);
  const signIn = useAuth((s) => s.signIn);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void useAuth.getState().init();
  }, []);

  const account = status?.signedIn ? status.account : undefined;

  const finish = async () => {
    setFinishing(true);
    setError(null);
    try {
      setSettings(await updateSettings({ onboarded: true }));
      track('onboarding completed', { signed_in: !!account });
      navigate({ name: 'chat-new' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setFinishing(false);
    }
  };

  const perks = [
    { icon: ImageIcon, text: t('onboarding.account.perkImages') },
    { icon: Mic, text: t('onboarding.account.perkVoice') },
    { icon: Send, text: t('onboarding.account.perkPost') },
  ];

  return (
    <div className="flex min-h-full flex-col items-center bg-background px-6 pt-10 pb-12 text-foreground">
      <div className="flex w-full max-w-[720px] flex-col gap-8">
        <OnboardingHeader step={4} bars />
        <div data-tauri-drag-region className="mt-4 flex flex-col gap-2">
          <h1 className="text-4xl font-semibold tracking-[-0.02em]">{t('onboarding.account.title')}</h1>
          <p className="text-base leading-[1.6] text-text-2">{t('onboarding.account.intro')}</p>
        </div>

        <ul className="m-0 flex list-none flex-col gap-3 rounded-xl border border-border bg-card p-5">
          {perks.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-[15px]">
              <Icon size={18} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-orange-light" />
              {text}
            </li>
          ))}
        </ul>

        {!capabilities.tayangCloud ? (
          <p role="note" className="m-0 rounded-xl border border-border bg-card p-4 text-[13px] leading-relaxed text-text-2">
            {t('settings.webNoticeCloud')}
          </p>
        ) : account ? (
          <div role="status" className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
            <div aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-raised text-sm font-semibold">
              {initials(account)}
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{account.name || account.email}</span>
              <span className="truncate text-xs text-text-3">{account.email}</span>
            </div>
            <span className="ml-auto inline-flex items-center gap-1 text-[13px] text-text-2">
              <Check size={16} aria-hidden="true" />
              {t('onboarding.account.signedIn')}
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <Button className="h-12 px-5 text-[15px]" onClick={() => void signIn()}>
              {t('onboarding.account.signIn')}
            </Button>
            <span className="text-[13px] text-text-3">{t('onboarding.account.later')}</span>
          </div>
        )}

        {error && (
          <p role="alert" className="m-0 text-[13px] text-orange-light">
            {error}
          </p>
        )}

        <div className="mt-2 flex items-center gap-4">
          <Button variant="ghost" className="mr-auto h-12 px-0 text-[15px]" onClick={() => navigate({ name: 'requirements' })}>
            {t('common.back')}
          </Button>
          <Button
            variant={account ? 'primary' : 'secondary'}
            className="h-12 gap-2 px-5 text-[15px]"
            disabled={finishing}
            onClick={() => void finish()}
          >
            {account ? t('onboarding.account.start') : t('onboarding.account.skip')}
            <ArrowRight size={18} strokeWidth={2} aria-hidden="true" />
          </Button>
        </div>
      </div>
      <SignInDialog flow={flow} apiUrl={apiUrl} />
    </div>
  );
}
