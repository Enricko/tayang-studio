// Gift codes: a promo gives an account extra AI credits and auto-posts for a while.

/** A redeemed gift as the account sees it: what is left of it and until when. */
export interface Gift {
  /** The promo's name, such as "Launch gift". */
  name: string;
  credits: number;
  posts: number;
  creditsLeft: number;
  postsLeft: number;
  expiresAt: string;
}

/** POST /v1/promos/redeem (Bearer). `deviceId`: hex SHA-256 of this computer's machine id. */
export interface RedeemRequest {
  code: string;
  deviceId: string;
}

export interface RedeemResponse {
  gift: Gift;
}

/** Why a code wasn't redeemed (the `error` of a non-2xx answer). */
export type RedeemError =
  | 'invalid_code'
  | 'code_expired'
  | 'code_used'
  | 'already_redeemed'
  | 'device_used'
  | 'rate_limited';

/** A promo as the owner creates it (admin API). */
export interface PromoInput {
  /** Lower-case letters, digits and dashes, such as "launch-2026-11". */
  id: string;
  name: string;
  credits: number;
  posts: number;
  /** A gift lasts this many days from when it is redeemed. */
  validDays: number;
  /** Codes can't be redeemed after this; null: no end. */
  redeemUntil?: string | null;
}

export interface PromoSummary extends Required<PromoInput> {
  createdAt: string;
  /** How many codes it has, and how many gifts were redeemed. */
  codes: number;
  redeemed: number;
}

/** "abcd efgh-jkmn" → "ABCDEFGHJKMN": what a code is stored and compared as. */
export const normalizeGiftCode = (input: string): string => input.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** "ABCDEFGHJKMN" → "ABCD-EFGH-JKMN" for showing; other lengths as they are. */
export const formatGiftCode = (code: string): string =>
  code.length === 12 ? `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}` : code;
