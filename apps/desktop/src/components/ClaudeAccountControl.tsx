import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Button } from '@/components/Button';
import { useClaudeAccount } from '@/state/claudeAccount';

/**
 * Tayang's own Claude sign-in: who is signed in, and a button to sign in (Claude Code opens the
 * browser) or out. `onSignedIn` runs once a sign-in from here succeeds.
 */
export function ClaudeAccountControl({ onSignedIn, showSignOut = false }: { onSignedIn?: () => void; showSignOut?: boolean }) {
  const { t } = useTranslation();
  const { account, signingIn, url, error, refresh, signIn, cancel, signOut } = useClaudeAccount();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const start = async () => {
    if (await signIn()) onSignedIn?.();
  };

  if (!account && !signingIn) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      {signingIn ? (
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-text-2" role="status">
            {t('claudeAccount.signingIn')}
          </span>
          <Button variant="ghost" className="h-8 px-2 text-[13px]" onClick={() => void cancel()}>
            {t('common.cancel')}
          </Button>
        </div>
      ) : account?.signedIn ? (
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-text-2">
            {account.email ? t('claudeAccount.signedInAs', { email: account.email }) : t('claudeAccount.signedIn')}
          </span>
          {showSignOut && (
            <Button variant="ghost" className="h-8 px-2 text-[13px]" onClick={() => void signOut()}>
              {t('claudeAccount.signOut')}
            </Button>
          )}
        </div>
      ) : (
        <Button variant="secondary" className="h-9" onClick={() => void start()}>
          {t('claudeAccount.signIn')}
        </Button>
      )}
      {signingIn && url && (
        <button type="button" className="text-xs text-primary hover:text-accent-hover" onClick={() => void openUrl(url)}>
          {t('claudeAccount.openPage')}
        </button>
      )}
      {error && !signingIn && (
        <span role="alert" className="text-xs text-orange-light">
          {t('claudeAccount.failed', { reason: error })}
        </span>
      )}
    </div>
  );
}
