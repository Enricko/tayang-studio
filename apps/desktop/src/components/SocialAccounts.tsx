import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, Unplug } from 'lucide-react';
import { SOCIAL_PLATFORMS, type SocialAccount, type SocialPlatform, type UsageResponse } from '@tayang/shared';
import { Button } from '@/components/Button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cloudErrorCode, cloudUsage, platformName, socialAccounts, socialConnect, socialDisconnect, type CloudErrorCode } from '@/lib/cloud';
import { useApp } from '@/state/app';
import { useAuth } from '@/state/auth';

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
  const watch = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [u, a] = await Promise.allSettled([cloudUsage(), socialAccounts()]);
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
    try {
      await socialConnect(platform);
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
      setError(cloudErrorCode(e));
    }
  };

  const disconnect = async (a: SocialAccount) => {
    try {
      await socialDisconnect(a.id);
      setAccounts((list) => (list ?? []).filter((x) => x.id !== a.id));
    } catch (e) {
      setError(cloudErrorCode(e));
    }
  };

  const noPosts = usage !== null && usage.posts.allowance === 0;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{t('cloud.title')}</span>
        <button
          type="button"
          aria-label={t('cloud.refresh')}
          title={t('cloud.refresh')}
          onClick={() => void load()}
          className="ml-auto flex size-7 cursor-pointer items-center justify-center rounded-sm text-text-3 hover:bg-raised hover:text-foreground"
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </div>
      {usage && (
        <dl className="m-0 grid grid-cols-2 gap-3">
          {(['credits', 'posts'] as const).map((m) => (
            <div key={m} className="flex flex-col gap-0.5 rounded-md bg-raised/50 px-3 py-2">
              <dt className="text-xs text-text-3">{t(`cloud.${m}`)}</dt>
              <dd className="m-0 font-mono text-sm">{t('cloud.left', { left: usage[m].remaining, of: usage[m].allowance })}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex items-center gap-2 pt-1">
        <span className="text-[13px] text-text-2">{t('cloud.accounts')}</span>
        {!noPosts && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" className="ml-auto h-8 px-3 text-[13px]">
                <Plus size={14} aria-hidden="true" />
                {t('cloud.connect')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 border-hairline bg-card">
              {SOCIAL_PLATFORMS.map((p) => (
                <DropdownMenuItem key={p} onSelect={() => void connect(p)} className="h-9 text-[13px]">
                  {platformName(p)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {noPosts ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-text-3">{t('cloud.needsPlan')}</span>
          <Button variant="secondary" className="h-8 px-3 text-[13px]" onClick={() => navigate({ name: 'plans', from: 'settings' })}>
            {t('cloud.seePlans')}
          </Button>
        </div>
      ) : accounts && accounts.length === 0 ? (
        <span className="text-xs text-text-3">{t('cloud.noAccounts')}</span>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {(accounts ?? []).map((a) => (
            <li key={a.id} className="flex h-10 items-center gap-3 border-t border-[#222] first:border-t-0">
              {a.profilePhotoUrl ? (
                <img src={a.profilePhotoUrl} alt="" className="size-6 rounded-full" />
              ) : (
                <span aria-hidden="true" className="size-6 rounded-full bg-raised" />
              )}
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {a.username ? `@${a.username}` : platformName(a.platform)}
                <span className="pl-2 text-xs text-text-3">{platformName(a.platform)}</span>
              </span>
              {a.status === 'disconnected' && <span className="text-xs text-orange-light">{t('cloud.reconnect')}</span>}
              <Button
                variant="ghost"
                className="h-7 px-2 text-[13px]"
                aria-label={t('cloud.disconnectName', { name: a.username ?? platformName(a.platform) })}
                onClick={() => void disconnect(a)}
              >
                <Unplug size={14} aria-hidden="true" />
                {t('cloud.disconnect')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {connecting && (
        <p role="status" className="m-0 text-xs text-text-2">
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
