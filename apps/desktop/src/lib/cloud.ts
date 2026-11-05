import { invoke } from '@tauri-apps/api/core';
import type { CreatePostResponse, PostDetails, SocialAccount, SocialPlatform, UsageResponse } from '@tayang/shared';

/** What a cloud call can fail with: the kebab-case `CloudError` from Rust, or `other`. */
export type CloudErrorCode =
  | 'signed-out'
  | 'plan-required'
  | 'quota-exceeded'
  | 'unavailable'
  | 'provider'
  | 'not-found'
  | 'in-progress'
  | 'already-posted'
  | 'invalid'
  | 'network'
  | 'server'
  | 'bad-url'
  | 'too-large'
  | 'other';

const CODES = new Set<CloudErrorCode>([
  'signed-out', 'plan-required', 'quota-exceeded', 'unavailable', 'provider', 'not-found', 'in-progress',
  'already-posted', 'invalid', 'network', 'server', 'bad-url', 'too-large',
]);

/** `cloud:plan-required` → `plan-required`; anything else is `other`. */
export function cloudErrorCode(e: unknown): CloudErrorCode {
  const m = /^cloud:([a-z-]+)$/.exec(e instanceof Error ? e.message : String(e));
  return m && CODES.has(m[1] as CloudErrorCode) ? (m[1] as CloudErrorCode) : 'other';
}

export const cloudUsage = () => invoke<UsageResponse>('cloud_usage');
export const socialAccounts = () => invoke<{ accounts: SocialAccount[] }>('social_accounts').then((r) => r.accounts ?? []);
/** Opens the platform's sign-in page in the browser. */
export const socialConnect = (platform: SocialPlatform) => invoke<void>('social_connect', { platform });
export const socialDisconnect = (id: string) => invoke<void>('social_disconnect', { id });
/** Uploads the project's latest render and posts it; pass the same `clientRequestId` to retry. */
export const socialPost = (o: { projectId: string; caption: string; accountIds: string[]; scheduledAt: string | null; clientRequestId: string }) =>
  invoke<CreatePostResponse>('social_post', o);
export const socialPostStatus = (postId: string) => invoke<PostDetails>('social_post_status', { postId });

export const PLATFORM_NAMES: Record<string, string> = {
  tiktok: 'TikTok',
  tiktok_business: 'TikTok Business',
  instagram: 'Instagram',
  youtube: 'YouTube',
  facebook: 'Facebook',
  x: 'X',
  threads: 'Threads',
  linkedin: 'LinkedIn',
  pinterest: 'Pinterest',
  bluesky: 'Bluesky',
};
export const platformName = (p: string) => PLATFORM_NAMES[p] ?? p;
