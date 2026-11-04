import { useTranslation } from 'react-i18next';
import { ArrowRight, Cpu, Eye, Lightbulb } from 'lucide-react';
import banner from '@/assets/brand/dither-banner.png';
import wink from '@/assets/brand/oyen-expr-wink.svg';
import { Button } from '@/components/Button';
import { OnboardingHeader } from '@/components/OnboardingHeader';
import { LANGUAGES, uiLanguage } from '@/i18n';
import { chooseLanguage } from '@/lib/language';
import { cn } from '@/lib/utils';
import { useApp } from '@/state/app';

const POINTS = [
  { icon: Lightbulb, key: 'noPrompts' },
  { icon: Cpu, key: 'ownAgent' },
  { icon: Eye, key: 'checked' },
] as const;

function Post({ tag, className, children }: { tag: string; className: string; children: React.ReactNode }) {
  return (
    <div className={`absolute flex h-[340px] w-48 flex-col gap-3 rounded-xl border border-hairline bg-[#1F1F1F] p-4 ${className}`}>
      <span className="self-start rounded-md bg-primary px-2 py-0.5 font-mono text-[11px] font-medium tracking-[0.08em] text-primary-foreground">
        {tag}
      </span>
      {children}
    </div>
  );
}

/** The sample posts are made-up Indonesian captions: the same in both languages. */
const SAMPLE = {
  explainer: ['Kenapa rupiah melemah?', 'dolar menguat'],
  quote: ['Mulai', 'aja', 'dulu.'],
  promo: ['Buy 1 get 1. Cuma Jumat.', 'Kopi Senja'],
};

const chip = 'mt-auto self-start rounded-sm bg-foreground px-1.5 py-0.5 text-xs font-semibold text-ink';

export function Welcome() {
  const navigate = useApp((s) => s.navigate);
  const { t } = useTranslation();
  const lang = uiLanguage();
  return (
    <div className="relative flex min-h-full flex-wrap overflow-hidden bg-background text-foreground">
      <img
        src={banner}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute top-0 right-0 h-[360px] w-[960px]"
        style={{ imageRendering: 'pixelated' }}
      />
      <div role="group" aria-label={t('common.language')} className="absolute top-6 right-8 z-10 flex gap-1 rounded-md border border-hairline bg-background p-0.5">
        {LANGUAGES.map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={lang === l}
            onClick={() => void chooseLanguage(l)}
            className={cn(
              'h-7 rounded-sm px-2 font-mono text-xs font-medium',
              lang === l ? 'bg-raised text-foreground' : 'text-text-3 hover:text-foreground',
            )}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="relative flex min-w-0 flex-[1_1_540px] flex-col gap-10 px-16 pt-10 pb-12">
        <OnboardingHeader step={1} />
        <div data-tauri-drag-region className="mt-10 flex flex-col gap-5">
          <span className="font-mono text-[13px] font-medium tracking-[0.12em] text-primary">
            {t('onboarding.welcome.eyebrow')}
          </span>
          <h1 className="text-[56px] leading-[1.04] font-extrabold tracking-[-0.035em]">
            {t('onboarding.welcome.headline1')}
            <br />
            {t('onboarding.welcome.headline2')}
          </h1>
          <p className="max-w-[480px] text-[18px] leading-[1.6] text-text-2">
            {t('onboarding.welcome.lead')}
          </p>
        </div>
        <ul className="flex max-w-[500px] flex-col gap-4">
          {POINTS.map(({ icon: Icon, key }) => (
            <li key={key} className="flex items-start gap-3">
              <Icon size={18} strokeWidth={1.5} aria-hidden="true" className="mt-0.5 shrink-0 text-text-2" />
              <div className="flex flex-col gap-1">
                <span className="text-[15px] font-medium">{t(`onboarding.welcome.${key}Title`)}</span>
                <span className="text-sm leading-normal text-text-2">{t(`onboarding.welcome.${key}Text`)}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-auto flex flex-wrap items-center gap-6">
          <Button className="h-12 gap-2 px-5 text-base" onClick={() => navigate({ name: 'connect' })}>
            {t('onboarding.welcome.getStarted')}
            <ArrowRight size={18} strokeWidth={2} aria-hidden="true" />
          </Button>
          <Button variant="ghost" className="px-0" onClick={() => navigate({ name: 'videos' })}>
            {t('onboarding.welcome.openProject')}
          </Button>
        </div>
      </div>
      <div
        data-tauri-drag-region
        className="relative flex min-w-0 flex-[1_1_460px] items-center justify-center px-6 py-12"
      >
        <div className="relative h-[520px] w-[472px] max-w-full" aria-hidden="true">
          <Post tag={t('kinds.explainer').toUpperCase()} className="top-[72px] left-0 -rotate-10">
            <span className="mt-2 text-[26px] leading-[1.04] font-extrabold tracking-[-0.03em]">{SAMPLE.explainer[0]}</span>
            <span className={chip}>{SAMPLE.explainer[1]}</span>
          </Post>
          <Post tag={t('kinds.quote').toUpperCase()} className="top-3 left-[140px]">
            <span className="mt-3 text-[40px] leading-[0.98] font-extrabold tracking-[-0.035em]">
              {SAMPLE.quote[0]}
              <br />
              <span className="text-primary">{SAMPLE.quote[1]}</span>
              <br />
              {SAMPLE.quote[2]}
            </span>
          </Post>
          <Post tag={t('kinds.promo').toUpperCase()} className="top-[72px] right-0 rotate-10">
            <span className="mt-2 text-[26px] leading-[1.04] font-extrabold tracking-[-0.03em]">{SAMPLE.promo[0]}</span>
            <span className={chip}>{SAMPLE.promo[1]}</span>
          </Post>
          <img src={wink} alt={t('onboarding.welcome.oyenAlt')} className="absolute top-[300px] left-40 h-[152px] w-[152px]" />
        </div>
      </div>
    </div>
  );
}
