import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ExternalLink, X as Cross } from 'lucide-react';
import type { PostDetails, Project } from '@tayang/shared';
import { Button } from '@/components/Button';
import { Oyen } from '@/components/Oyen';
import { SignInDialog } from '@/components/Account';
import { SocialAccounts } from '@/components/SocialAccounts';
import { Skeleton, Spinner } from '@/components/Loading';
import { SmallPoster, useVideoThumb } from '@/components/VideoPoster';
import { locale } from '@/i18n';
import { socialPostStatus } from '@/lib/cloud';
import { listProjects } from '@/lib/ipc';
import { capabilities } from '@/lib/platform';
import { openProjectChat } from '@/lib/openProject';
import { useApp } from '@/state/app';
import { useAuth } from '@/state/auth';

const when = (iso: string | null | undefined) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(d) : null;
};

/**
 * Social media: the accounts videos go out to (connect, disconnect, auto-posts left), and every video
 * posted or scheduled from Tayang with how it went on each account. A row opens the video's chat.
 */
export function Social() {
  const { t } = useTranslation();
  const status = useAuth((s) => s.status);
  const flow = useAuth((s) => s.flow);
  const signIn = useAuth((s) => s.signIn);
  const apiUrl = useApp((s) => s.settings?.apiUrl ?? '');
  const version = useApp((s) => s.projectsVersion);
  const [posted, setPosted] = useState<Project[] | null>(null);

  useEffect(() => {
    void useAuth.getState().init();
  }, []);

  const signedIn = !!status?.signedIn;
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    listProjects()
      .then((all) => {
        if (!alive) return;
        const at = (p: Project) => p.postedAt ?? p.scheduledAt ?? p.updatedAt;
        setPosted(all.filter((p) => p.socialPostId).sort((a, b) => at(b).localeCompare(at(a))));
      })
      .catch(() => alive && setPosted([]));
    return () => {
      alive = false;
    };
  }, [signedIn, version]);

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-8">
      <div data-tauri-drag-region className="flex flex-col gap-1">
        <h1 className="m-0 text-[28px] font-semibold tracking-[-0.01em]">{t('social.title')}</h1>
        <span className="text-sm text-text-2">{t('social.subtitle')}</span>
      </div>

      {!capabilities.tayangCloud ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <Oyen mood="sleepy" size={56} />
          <span className="text-base font-medium">{t('settings.webNoticeCloud')}</span>
        </div>
      ) : !signedIn ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <Oyen mood="wink" size={56} />
          <span className="text-base font-medium">{t('social.signedOutTitle')}</span>
          <span className="max-w-md text-sm text-text-2">{t('social.signedOutBody')}</span>
          <Button onClick={() => void signIn()}>{t('onboarding.account.signIn')}</Button>
          <SignInDialog flow={flow} apiUrl={apiUrl} />
        </div>
      ) : (
        <>
          <section className="flex max-w-3xl flex-col gap-3">
            <h2 className="m-0 text-base font-medium">{t('social.accounts')}</h2>
            <SocialAccounts />
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="m-0 text-base font-medium">{t('social.posts')}</h2>
            {posted === null ? (
              <div role="status" aria-label={t('social.loadingPosts')} className="flex flex-col gap-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-4 px-3 py-2">
                    <Skeleton className="h-14 w-8" />
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Skeleton className="h-3.5 w-64 max-w-full" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                  </div>
                ))}
              </div>
            ) : posted.length === 0 ? (
              <p className="m-0 text-sm text-text-3">{t('social.noPosts')}</p>
            ) : (
              <ul aria-label={t('social.posts')} className="m-0 flex list-none flex-col p-0">
                {(posted ?? []).map((p) => (
                  <PostRow key={p.id} project={p} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** One posted (or scheduled) video and how it went on each account; the row opens its chat. */
function PostRow({ project: p }: { project: Project }) {
  const { t } = useTranslation();
  const thumb = useVideoThumb(p);
  const [details, setDetails] = useState<PostDetails | null>(null);
  const [unknown, setUnknown] = useState(false);
  useEffect(() => {
    if (!p.socialPostId) return;
    let alive = true;
    socialPostStatus(p.socialPostId)
      .then((d) => alive && setDetails(d))
      .catch(() => alive && setUnknown(true));
    return () => {
      alive = false;
    };
  }, [p.socialPostId]);

  const scheduled = details?.status === 'scheduled';
  const time = when(scheduled ? (details?.scheduledAt ?? p.scheduledAt) : (p.postedAt ?? p.updatedAt)) ?? '';
  const ok = details?.results.filter((r) => r.success) ?? [];
  const failed = details?.results.filter((r) => !r.success) ?? [];
  return (
    <li className="group relative flex items-center gap-4 rounded-lg px-3 py-2 hover:bg-raised/50">
      <button
        type="button"
        aria-label={t('videos.open', { title: p.title })}
        onClick={() => void openProjectChat(p).catch(() => {})}
        className="absolute inset-0 cursor-pointer rounded-lg border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-ring"
      />
      <SmallPoster thumb={thumb} />
      <div className="pointer-events-none flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{p.title}</span>
        <span className="truncate text-xs text-text-3">
          {scheduled ? t('social.scheduledFor', { time }) : t('social.postedAt', { time })}
        </span>
      </div>
      <span className="pointer-events-none flex shrink-0 items-center gap-3 text-xs">
        {!details ? (
          unknown ? (
            <span className="text-text-3">{t('social.statusUnknown')}</span>
          ) : (
            <span role="status" aria-label={t('social.checkingStatus')}>
              <Spinner size={12} />
            </span>
          )
        ) : scheduled || details.status === 'processing' ? (
          <span className="text-text-2">{scheduled ? t('social.waiting') : t('social.processing')}</span>
        ) : (
          <>
            {ok.length > 0 && (
              <span className="inline-flex items-center gap-1 text-text-2">
                <Check size={14} aria-hidden="true" />
                {t('social.okCount', { count: ok.length })}
              </span>
            )}
            {failed.length > 0 && (
              <span className="inline-flex items-center gap-1 text-orange-light" title={failed.map((f) => f.error).filter(Boolean).join('\n') || undefined}>
                <Cross size={14} aria-hidden="true" />
                {t('social.failedCount', { count: failed.length })}
              </span>
            )}
          </>
        )}
      </span>
      {ok.find((r) => r.url) && (
        <a
          href={ok.find((r) => r.url)!.url!}
          target="_blank"
          rel="noreferrer"
          aria-label={t('social.openPost', { title: p.title })}
          className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-md text-text-3 hover:bg-raised hover:text-foreground"
        >
          <ExternalLink size={15} aria-hidden="true" />
        </a>
      )}
    </li>
  );
}
