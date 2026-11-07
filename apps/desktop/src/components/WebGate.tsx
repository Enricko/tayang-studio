import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LockKeyhole } from 'lucide-react';
import { Button } from '@/components/Button';
import { Input } from '@/components/ui/input';
import { clearEventCursor, disconnectEvents } from '@/lib/events';
import { isWeb } from '@/lib/platform';
import { fetchMe, login, setCsrfToken } from '@/lib/webRpc';

type Phase = 'loading' | 'login' | 'ready';

/**
 * The self-hosted web edition's sign-in gate. Desktop renders its children directly. This is the
 * server account (one owner), deliberately separate from the optional Tayang cloud account.
 */
export function WebGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>(isWeb ? 'loading' : 'ready');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isWeb) return;
    let alive = true;
    fetchMe()
      .then((me) => alive && setPhase(me.authenticated ? 'ready' : 'login'))
      .catch(() => alive && setPhase('login'));
    const unauthorized = () => {
      disconnectEvents();
      setCsrfToken(null);
      setPhase('login');
    };
    window.addEventListener('tayang:unauthorized', unauthorized);
    return () => {
      alive = false;
      window.removeEventListener('tayang:unauthorized', unauthorized);
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(password);
      clearEventCursor();
      setPassword('');
      setPhase('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'ready') return <>{children}</>;
  if (phase === 'loading') {
    return <div className="flex h-full items-center justify-center bg-background" aria-busy="true" />;
  }
  return (
    <div className="flex min-h-full items-center justify-center bg-background px-6 py-12 text-foreground">
      <div className="w-full max-w-[400px] rounded-xl border border-border bg-card p-7">
        <div className="mb-6 flex flex-col gap-2">
          {/* i18n-ignore: brand name */}
          <span className="font-mono text-[12px] font-medium tracking-[0.12em] text-primary">TAYANG STUDIO</span>
          <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">{t('webLogin.title')}</h1>
          <p className="m-0 text-[13px] leading-relaxed text-text-2">{t('webLogin.intro')}</p>
        </div>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <label htmlFor="web-password" className="text-[13px] font-medium">
            {t('webLogin.password')}
          </label>
          <Input
            id="web-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-10 bg-background"
          />
          {error && (
            <p role="alert" className="m-0 text-xs text-orange-light">
              {error}
            </p>
          )}
          <Button type="submit" className="mt-2 h-10 w-full" disabled={busy || !password}>
            <LockKeyhole size={15} strokeWidth={1.5} aria-hidden="true" />
            {t('webLogin.signIn')}
          </Button>
        </form>
        <p className="m-0 mt-5 text-[11px] leading-relaxed text-text-3">{t('webLogin.note')}</p>
      </div>
    </div>
  );
}
