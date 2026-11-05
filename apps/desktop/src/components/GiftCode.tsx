import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Gift as GiftIcon } from 'lucide-react';
import type { Gift } from '@tayang/shared';
import { Button } from '@/components/Button';
import { Spinner } from '@/components/Loading';
import { Input } from '@/components/ui/input';
import { useCloudError } from '@/components/SocialAccounts';
import { locale } from '@/i18n';
import { cloudErrorCode, redeemGiftCode, type CloudErrorCode } from '@/lib/cloud';
import { track } from '@/lib/analytics';
import { useAuth } from '@/state/auth';
import { useTayangUsage } from '@/state/tayangUsage';

export const giftDate = (iso: string) => new Intl.DateTimeFormat(locale(), { dateStyle: 'medium' }).format(new Date(iso));

/**
 * "14 AI credits and 5 auto-posts": the parts the gift has (`g`), with the numbers from `n` (what is
 * left of it, 0 too), or the gift's own.
 */
export function useGiftAmount() {
  const { t } = useTranslation();
  return (g: Pick<Gift, 'credits' | 'posts'>, n: Pick<Gift, 'credits' | 'posts'> = g) => {
    const parts = [
      g.credits > 0 ? t('gift.credits', { count: n.credits }) : null,
      g.posts > 0 ? t('gift.posts', { count: n.posts }) : null,
    ].filter(Boolean);
    return parts.join(t('gift.and'));
  };
}

/**
 * Settings › Account, signed in: type a gift code to add its AI credits and auto-posts to the
 * account. A promo gives one gift per account and one per computer.
 */
export function GiftCode() {
  const { t } = useTranslation();
  const explain = useCloudError();
  const amount = useGiftAmount();
  const signedIn = useAuth((s) => !!s.status?.signedIn);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [gift, setGift] = useState<Gift | null>(null);
  const [error, setError] = useState<CloudErrorCode | null>(null);
  if (!signedIn) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    setGift(null);
    try {
      const r = await redeemGiftCode(code);
      setGift(r.gift);
      setCode('');
      track('gift code redeemed', { credits: r.gift.credits, posts: r.gift.posts });
      void useTayangUsage.getState().load();
    } catch (err) {
      const c = cloudErrorCode(err);
      setError(c);
      track('gift code refused', { reason: c });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="gift-code" className="flex items-center gap-2 text-sm font-medium">
          <GiftIcon size={16} strokeWidth={1.5} aria-hidden="true" className="text-orange-light" />
          {t('gift.title')}
        </label>
        <span className="text-xs text-text-3">{t('gift.hint')}</span>
      </div>
      <div className="flex gap-2">
        <Input
          id="gift-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          // i18n-ignore: the shape of a code, not words.
          placeholder="XXXX-XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
          maxLength={64}
          className="h-9 flex-1 font-mono uppercase"
        />
        <Button type="submit" variant="secondary" className="h-9 px-4 text-[13px]" disabled={busy || !code.trim()}>
          {busy && <Spinner />}
          {busy ? t('gift.redeeming') : t('gift.redeem')}
        </Button>
      </div>
      {gift && (
        <p role="status" className="m-0 text-[13px] text-foreground">
          {t('gift.done', { what: amount(gift), date: giftDate(gift.expiresAt) })}
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 text-xs text-orange-light">
          {explain(error)}
        </p>
      )}
    </form>
  );
}
