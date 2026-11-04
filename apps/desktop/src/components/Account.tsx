import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { Account, AuthErrorCode } from '@tayang/shared';
import { Button } from '@/components/Button';
import { Oyen } from '@/components/Oyen';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useApp } from '@/state/app';
import { useAuth, type SignInFlow } from '@/state/auth';

const ERROR_KEYS = {
  expired: 'account.errors.expired',
  denied: 'account.errors.denied',
  network: 'account.errors.network',
  server: 'account.errors.server',
  'rate-limited': 'account.errors.rateLimited',
  storage: 'account.errors.storage',
  insecure: 'account.errors.insecure',
  keychain: 'account.errors.keychain',
} as const satisfies Record<AuthErrorCode, string>;

/** Google's "G", in its own colours, as Google asks sign-in buttons to show it. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="16" height="16" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** "Ana Putri" → "AP"; with no name, the email's first letter. */
export function initials(a: Pick<Account, 'name' | 'email'>): string {
  const words = (a.name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length) return words.slice(0, 2).map((w) => [...w][0]!.toUpperCase()).join('');
  const first = [...(a.email ?? '').trim()][0];
  return first ? first.toUpperCase() : '?';
}

function SignInDialog({ flow, apiUrl }: { flow: SignInFlow; apiUrl: string }) {
  const { t } = useTranslation();
  const signIn = useAuth((s) => s.signIn);
  const cancel = useAuth((s) => s.cancel);
  const error =
    flow.phase !== 'failed'
      ? null
      : typeof flow.error === 'string'
        ? t(ERROR_KEYS[flow.error], { url: apiUrl })
        : t('account.errors.unexpected', { message: flow.error.message });
  return (
    <Dialog open={flow.phase !== 'closed'} onOpenChange={(o) => !o && cancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('account.dialog.title')}</DialogTitle>
          <DialogDescription>{t('account.dialog.body')}</DialogDescription>
        </DialogHeader>
        {flow.phase === 'starting' && (
          <p role="status" className="m-0 text-[13px] text-text-2">
            {t('account.dialog.starting')}
          </p>
        )}
        {flow.phase === 'waiting' && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-background px-4 py-5">
            <p aria-label={t('account.dialog.code')} className="m-0 font-mono text-[32px] font-medium tracking-[0.12em]">
              {flow.start.userCode}
            </p>
            <p role="status" className="m-0 text-[13px] text-text-2">
              {t('account.dialog.waiting')}
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className="m-0 text-[13px] leading-normal text-orange-light">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={cancel}>
            {t('common.cancel')}
          </Button>
          {flow.phase === 'waiting' && (
            <Button variant="secondary" onClick={() => void openUrl(flow.start.verificationUriComplete).catch(() => {})}>
              {t('account.dialog.openAgain')}
            </Button>
          )}
          {flow.phase === 'failed' && <Button onClick={() => void signIn()}>{t('common.tryAgain')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SignOutDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const { t } = useTranslation();
  const logout = useAuth((s) => s.logout);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (open) setFailed(false);
  }, [open]);
  const confirm = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await logout();
      onClose();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('account.signOutTitle')}</DialogTitle>
          <DialogDescription>{t('account.signOutBody')}</DialogDescription>
        </DialogHeader>
        {failed && (
          <p role="alert" className="m-0 text-[13px] text-orange-light">
            {t('account.signOutFailed')}
          </p>
        )}
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy} onClick={() => void confirm()}>
            {t('account.signOut')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Settings › Account: sign in with Google, or the signed-in account with its plan. */
export function AccountSection() {
  const { t } = useTranslation();
  const status = useAuth((s) => s.status);
  const flow = useAuth((s) => s.flow);
  const signIn = useAuth((s) => s.signIn);
  const settingsApi = useApp((s) => s.settings?.apiUrl);
  const [confirmOut, setConfirmOut] = useState(false);
  useEffect(() => {
    void useAuth.getState().init();
  }, []);

  const apiUrl = status?.apiUrl || settingsApi || '';
  const account = status?.signedIn ? status.account : undefined;
  return (
    <>
      {status?.signedIn ? (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-4">
          <div
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-raised text-sm font-semibold text-foreground"
          >
            {account ? initials(account) : '?'}
          </div>
          <div className="flex min-w-[220px] flex-1 flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{account?.name || account?.email || t('account.yourAccount')}</span>
              {account && (
                <Badge variant={account.plan === 'pro' ? 'default' : 'secondary'}>
                  {account.plan === 'pro' ? t('account.plan.pro') : t('account.plan.free')}
                </Badge>
              )}
            </div>
            {account?.name && account.email && <span className="truncate text-[13px] text-text-2">{account.email}</span>}
            {status.offline && <span className="text-xs text-text-3">{t('account.offline')}</span>}
          </div>
          <Button variant="secondary" onClick={() => setConfirmOut(true)}>
            {t('account.signOut')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-4">
          <Oyen mood="default" size={40} />
          <div className="flex min-w-[280px] flex-1 flex-col gap-1">
            <span className="text-sm font-medium">{t('settings.freePlan')}</span>
            <span className="text-[13px] leading-normal text-text-2">{t('settings.planText')}</span>
          </div>
          <Button variant="secondary" className="gap-2" onClick={() => void signIn()}>
            <GoogleMark />
            {t('account.signInGoogle')}
          </Button>
        </div>
      )}
      <SignInDialog flow={flow} apiUrl={apiUrl} />
      <SignOutDialog open={confirmOut} onClose={() => setConfirmOut(false)} />
    </>
  );
}
