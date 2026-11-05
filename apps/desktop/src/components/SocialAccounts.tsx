import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, Unplug } from 'lucide-react';
import { SOCIAL_PLATFORMS, type SocialAccount, type SocialPlatform, type UsageResponse } from '@tayang/shared';
import { Button } from '@/components/Button';
import { Skeleton, Spinner } from '@/components/Loading';
import { PlatformLogo } from '@/components/PlatformLogo';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cloudErrorCode, cloudUsage, platformName, socialAccounts, socialConnect, socialDisconnect, type CloudErrorCode } from '@/lib/cloud';
import { useApp } from '@/state/app';
import { useAuth } from '@/state/auth';
import { track } from '@/lib/analytics';

/** After "Connect", look for the new account this often, for this long (the user signs in in the browser). */
const WATCH_EVERY_MS = 4000;
const WATCH_FOR_MS = 3 * 60_000;

/** One error line in the user's language, from a cloud error code. */
export function useCloudError() {
  const { t } = useTranslation();
  return (code: CloudErrorCode) => t(`cloud.errors.${code}`, { defaultValue: t('cloud.errors.other') });
}

/**
 * Settings › Account, signed in: AI credits and auto-posts left this cycle, and the social accounts
 * videos can be posted to. Connecting opens the platform's page in the browser; the account appears
 * here when the user has finished there.
 */
export function SocialAccounts() {
  const { t } = useTranslation();
  const signedIn = useAuth((s) => !!s.status?.signedIn);
  const navigate = useApp((s) => s.navigate);
  const explain = useCloudError();
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [accounts, setAccounts] = useState<SocialAccount[] | null>(null);
  const [error, setError] = useState<CloudErrorCode | null>(null);
  const [connecting, setConnecting] = useState<SocialPlatform | null>(null);
  // Requests under way: the list, opening a platform's sign-in page, disconnecting an account.
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<SocialPlatform | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const watch = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    const [u, a] = await Promise.allSettled([cloudUsage(), socialAccounts()]);
    setLoading(false);
    if (u.status === 'fulfilled') setUsage(u.value);
    if (a.status === 'fulfilled') setAccounts(a.value);
    else setError(cloudErrorCode(a.reason));
  }, []);

  useEffect(() => {
    if (signedIn) void load();
    return () => {
      if (watch.current) clearInterval(watch.current);
    };
  }, [signedIn, load]);

  if (!signedIn) return null;

  const connect = async (platform: SocialPlatform) => {
    setError(null);
    setOpening(platform);
    try {
      await socialConnect(platform);
      setOpening(null);
      track('social account connect started', { platform });
      setConnecting(platform);
      const known = new Set((accounts ?? []).map((a) => a.id));
      const until = Date.now() + WATCH_FOR_MS;
      if (watch.current) clearInterval(watch.current);
      watch.current = setInterval(() => {
        void socialAccounts()
          .then((list) => {
            setAccounts(list);
            if (list.some((a) => !known.has(a.id)) || Date.now() > until) {
              setConnecting(null);
              if (watch.current) clearInterval(watch.current);
            }
          })
          .catch(() => {});
      }, WATCH_EVERY_MS);
    } catch (e) {
      setOpening(null);
      setError(cloudErrorCode(e));
    }
  };

  const disconnect = async (a: SocialAccount) => {
    setRemoving(a.id);
    try {
      await socialDisconnect(a.id);
      setAccounts((list) => (list ?? []).filter((x) => x.id !== a.id));
    } catch (e) {
      setError(cloudErrorCode(e));
    } finally {
      setRemoving(null);
    }
  };

  const noPosts = usage !== null && usage.posts.allowance === 0;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{t('cloud.accounts')}</span>
        {usage && usage.posts.allowance > 0 && (
          <span className="text-xs text-text-3">{t('cloud.postsLeftShort', { count: usage.posts.remaining })}</span>
        )}
        <button
          type="button"
          aria-label={t('cloud.refresh')}
          title={t('cloud.refresh')}
          onClick={() => void load()}
          disabled={loading}
          className="ml-auto flex size-7 cursor-pointer items-center justify-center rounded-sm text-text-3 hover:bg-raised hover:text-foreground disabled:cursor-default"
        >
          <RefreshCw size={14} aria-hidden="true" className={loading ? 'animate-spin motion-reduce:animate-none' : undefined} />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" className="h-8 px-3 text-[13px]" disabled={opening !== null}>
              {opening ? <Spinner /> : <Plus size={14} aria-hidden="true" />}
              {opening ? t('cloud.opening', { platform: platformName(opening) }) : t('cloud.connect')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 border-hairline bg-card">
            {SOCIAL_PLATFORMS.map((p) => (
              <DropdownMenuItem key={p} onSelect={() => void connect(p)} className="h-9 gap-2.5 text-[13px]">
                <PlatformLogo platform={p} size={18} />
                {platformName(p)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* Connecting is free; posting needs a plan, so a free account learns that here, not on Post. */}
      {noPosts && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-text-3">{t('cloud.needsPlan')}</span>
          <Button variant="ghost" className="h-7 px-2 text-[13px]" onClick={() => navigate({ name: 'plans', from: 'settings' })}>
            {t('cloud.seePlans')}
          </Button>
        </div>
      )}
      {accounts === null && !error ? (
        <div role="status" aria-label={t('cloud.loadingAccounts')} className="flex flex-col">
          {[0, 1].map((i) => (
            <div key={i} className="flex h-10 items-center gap-3">
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="h-3 w-40" />
            </div>
          ))}
        </div>
      ) : accounts && accounts.length === 0 ? (
        <span className="text-xs text-text-3">{t('cloud.noAccounts')}</span>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {(accounts ?? []).map((a) => (
            <li key={a.id} className="flex h-10 items-center gap-3 border-t border-[#222] first:border-t-0">
              {/* The profile photo with the platform's logo on its corner. */}
              <span className="relative shrink-0">
                {a.profilePhotoUrl ? (
                  <img src={a.profilePhotoUrl} alt="" className="size-7 rounded-full" />
                ) : (
                  <span aria-hidden="true" className="block size-7 rounded-full bg-raised" />
                )}
                <PlatformLogo platform={a.platform} size={14} className="absolute -right-1 -bottom-1 ring-2 ring-card" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {a.username ? `@${a.username}` : platformName(a.platform)}
                <span className="pl-2 text-xs text-text-3">{platformName(a.platform)}</span>
              </span>
              {a.status === 'disconnected' && <span className="text-xs text-orange-light">{t('cloud.reconnect')}</span>}
              <Button
                variant="ghost"
                className="h-7 px-2 text-[13px]"
                aria-label={t('cloud.disconnectName', { name: a.username ?? platformName(a.platform) })}
                disabled={removing !== null}
                onClick={() => void disconnect(a)}
              >
                {removing === a.id ? <Spinner /> : <Unplug size={14} aria-hidden="true" />}
                {removing === a.id ? t('cloud.disconnecting') : t('cloud.disconnect')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {connecting && (
        <p role="status" className="m-0 flex items-center gap-2 text-xs text-text-2">
          <Spinner size={12} />
          {t('cloud.finishInBrowser', { platform: platformName(connecting) })}
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 text-xs text-orange-light">
          {explain(error)}
        </p>
      )}
    </div>
  );
}
