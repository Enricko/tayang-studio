import type { PlanId } from './billing';
import { CREDIT_COSTS } from './billing';

// AI credits (fal image and voice) and auto-posts (PostForMe), metered per cycle.
// Prices and quotas live in billing.ts; this file has the rules and the wire shapes.

/** About one minute of speech, the cost basis of CREDIT_COSTS.voiceMinute. */
export const VOICE_CHARS_PER_MINUTE = 900;
/** fal's limit for one voice request. */
export const MAX_VOICE_CHARS = 5000;
export const MAX_IMAGES_PER_REQUEST = 4;
export const USAGE_CYCLE_DAYS = 30;

/** All at or under 1 megapixel. */
export const IMAGE_ASPECTS = {
  '9:16': { width: 720, height: 1280 },
  '16:9': { width: 1280, height: 720 },
  '1:1': { width: 960, height: 960 },
} as const;
export type ImageAspect = keyof typeof IMAGE_ASPECTS;

/** Voice is charged by characters (code points), before generation: at least 1 credit. */
export const voiceCredits = (text: string): number =>
  Math.max(1, Math.ceil(([...text].length * CREDIT_COSTS.voiceMinute) / VOICE_CHARS_PER_MINUTE));

const DAY_MS = 86_400_000;

/**
 * The usage cycle `now` falls in: 30-day steps from `anchor` (the running subscription's start),
 * or the UTC calendar month with no anchor. An anchor in the future starts the cycle at the anchor.
 */
export function usageCycle(anchor: string | null, now: Date): { start: string; end: string } {
  const t = now.getTime();
  const a = anchor === null ? NaN : Date.parse(anchor);
  if (Number.isNaN(a)) {
    return {
      start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
      end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
    };
  }
  const step = USAGE_CYCLE_DAYS * DAY_MS;
  const start = a + Math.max(0, Math.floor((t - a) / step)) * step;
  return { start: new Date(start).toISOString(), end: new Date(start + step).toISOString() };
}

export type Meter = 'credits' | 'posts';

export interface UsageMeter {
  allowance: number;
  used: number;
  remaining: number;
}

/** GET /v1/usage (Bearer). */
export interface UsageResponse {
  plan: PlanId;
  cycleStart: string;
  cycleEnd: string;
  credits: UsageMeter;
  posts: UsageMeter;
}

/** POST /v1/ai/image body. */
export interface ImageRequest {
  prompt: string;
  aspect?: ImageAspect;
  count?: number;
  clientRequestId?: string;
}

export interface ImageResponse {
  images: { url: string; width: number; height: number; flagged: boolean }[];
  creditsCharged: number;
  usage: UsageMeter;
}

/** POST /v1/ai/voice body. */
export interface VoiceRequest {
  text: string;
  voice?: string;
  language?: 'id' | 'en';
  clientRequestId?: string;
}

export interface VoiceResponse {
  audioUrl: string;
  contentType: string;
  creditsCharged: number;
  usage: UsageMeter;
}

/**
 * The platforms a user can connect. Bluesky is left out (it needs an app password, not OAuth); X,
 * LinkedIn and Pinterest are left out for now.
 */
export const SOCIAL_PLATFORMS = ['tiktok', 'tiktok_business', 'instagram', 'youtube', 'facebook', 'threads'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export interface SocialAccount {
  id: string;
  platform: string;
  username: string | null;
  profilePhotoUrl: string | null;
  status: 'connected' | 'disconnected';
}

export interface ConnectRequest {
  platform: SocialPlatform;
}

export interface ConnectResponse {
  url: string;
}

export interface UploadUrlResponse {
  uploadUrl: string;
  mediaUrl: string;
}

/** Each target account counts as 1 post. */
export interface CreatePostRequest {
  caption: string;
  socialAccountIds: string[];
  mediaUrl: string;
  scheduledAt?: string;
  platformConfigurations?: Record<string, unknown>;
  clientRequestId: string;
}

export interface CreatePostResponse {
  postId: string;
  status: string;
  postsCharged: number;
  usage: UsageMeter;
}

export interface PostDetails {
  postId: string;
  status: string;
  scheduledAt: string | null;
  results: { socialAccountId: string; success: boolean; error: string | null; url: string | null }[];
}
