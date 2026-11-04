import type { Feature } from './api';

// Paid plans, paid monthly through SumoPod (QRIS). This file is the one place prices and quotas live:
// the API charges from it and the desktop shows it.

export const PAID_PLAN_IDS = ['lite', 'creator', 'pro'] as const;
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];
export type PlanId = 'free' | PaidPlanId;

/** Per month. Display and entitlement data only for now: nothing counts usage yet. */
export interface PlanQuotas {
  socialAccounts: 'unlimited';
  autoPosts: number;
  images: number;
  voiceMinutes: number;
}

export interface Plan {
  id: PaidPlanId;
  name: string;
  /** Rupiah per period, the fee included (Tayang pays the QRIS fee). */
  price: number;
  currency: 'IDR';
  interval: 'month';
  quotas: PlanQuotas;
  features: Feature[];
}

/** One paid period. Paying again before it ends adds another period on top. */
export const PLAN_PERIOD_DAYS = 30;

export const PLANS: readonly Plan[] = [
  {
    id: 'lite',
    name: 'Lite',
    price: 15000,
    currency: 'IDR',
    interval: 'month',
    quotas: { socialAccounts: 'unlimited', autoPosts: 30, images: 0, voiceMinutes: 0 },
    features: ['autopilot'],
  },
  {
    id: 'creator',
    name: 'Creator',
    price: 50000,
    currency: 'IDR',
    interval: 'month',
    quotas: { socialAccounts: 'unlimited', autoPosts: 90, images: 60, voiceMinutes: 15 },
    features: ['autopilot', 'voiceover'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 90000,
    currency: 'IDR',
    interval: 'month',
    quotas: { socialAccounts: 'unlimited', autoPosts: 150, images: 100, voiceMinutes: 30 },
    features: ['autopilot', 'voiceover'],
  },
];

export const isPaidPlanId = (v: unknown): v is PaidPlanId =>
  typeof v === 'string' && (PAID_PLAN_IDS as readonly string[]).includes(v);

export const findPlan = (id: unknown): Plan | null => (isPaidPlanId(id) ? (PLANS.find((p) => p.id === id) ?? null) : null);

/** What a plan unlocks; free unlocks nothing. */
export const planFeatures = (plan: PlanId): Feature[] => [...(findPlan(plan)?.features ?? [])];

/** GET /v1/billing/plans (public). */
export interface BillingPlansResponse {
  plans: Plan[];
}

/** POST /v1/billing/checkout body (Bearer). The price always comes from PLANS, never from here. */
export interface CheckoutRequest {
  plan: PaidPlanId;
}

/** POST /v1/billing/checkout, 200: open `paymentLinkUrl` to pay with QRIS. */
export interface CheckoutResponse {
  orderId: string;
  paymentLinkUrl: string;
  expiresAt: string;
  amount: number;
}

/** A started payment that hasn't been paid or run out yet. */
export interface PendingPayment {
  orderId: string;
  plan: PaidPlanId;
  paymentLinkUrl: string;
  expiresAt: string;
}

/** GET /v1/billing/status (Bearer). `plan` is the plan the account has now: free once a period ran out. */
export interface BillingStatus {
  plan: PlanId;
  /** The plan last paid for, also after it ran out (null if never paid). */
  lastPlan: PaidPlanId | null;
  currentPeriodEnd: string | null;
  active: boolean;
  pending: PendingPayment | null;
}

// ---- plan order and periods: the API applies these, and the app previews them ----

/** Lowest to highest. While a plan runs, only the same plan (renew) or a higher one (upgrade) can be bought. */
export const PLAN_RANK: readonly PlanId[] = ['free', 'lite', 'creator', 'pro'];

export const planRank = (plan: PlanId): number => PLAN_RANK.indexOf(plan);

/** Whether `plan` ranks below `than`. */
export const isLowerPlan = (plan: PlanId, than: PlanId): boolean => planRank(plan) < planRank(than);

const DAY_MS = 86_400_000;
/** Against float noise: 10 days × 15000 / 50000 must be exactly 3. */
const EPS = 1e-9;

/** Upgrade credit: the old plan's unused time, worth `floor(remaining days × old price / new price)` days of the new one. */
export function upgradeExtraDays(remainingMs: number, oldPrice: number, newPrice: number): number {
  if (remainingMs <= 0 || newPrice <= 0) return 0;
  return Math.floor((remainingMs / DAY_MS) * (oldPrice / newPrice) + EPS);
}

/** A lower plan paid while a higher one runs (a late link): `floor(30 × paid / current)` days on the higher plan. */
export function lowerPlanDays(paidPrice: number, currentPrice: number): number {
  if (currentPrice <= 0) return 0;
  return Math.floor(PLAN_PERIOD_DAYS * (paidPrice / currentPrice) + EPS);
}

export interface PeriodChange {
  /** new: nothing running; renew: same plan; upgrade: higher plan with credit; converted: lower plan turned into days. */
  kind: 'new' | 'renew' | 'upgrade' | 'converted';
  plan: PaidPlanId;
  /** ISO, with milliseconds. */
  end: string;
  /** Credit days on top of the 30 (upgrade), or the days a lower payment became (converted). */
  extraDays: number;
}

/** What paying for `paid` at `now` does to the running subscription `current` (null: none). */
export function nextPeriod(current: { plan: PaidPlanId; end: string } | null, paid: PaidPlanId, now: Date): PeriodChange {
  const t = now.getTime();
  const end = current ? Date.parse(current.end) : NaN;
  const iso = (ms: number) => new Date(ms).toISOString();
  if (!current || Number.isNaN(end) || end <= t) {
    return { kind: 'new', plan: paid, end: iso(t + PLAN_PERIOD_DAYS * DAY_MS), extraDays: 0 };
  }
  const price = (p: PaidPlanId) => findPlan(p)?.price ?? 0;
  if (paid === current.plan) return { kind: 'renew', plan: paid, end: iso(end + PLAN_PERIOD_DAYS * DAY_MS), extraDays: 0 };
  if (isLowerPlan(current.plan, paid)) {
    const extraDays = upgradeExtraDays(end - t, price(current.plan), price(paid));
    return { kind: 'upgrade', plan: paid, end: iso(t + (PLAN_PERIOD_DAYS + extraDays) * DAY_MS), extraDays };
  }
  const extraDays = lowerPlanDays(price(paid), price(current.plan));
  return { kind: 'converted', plan: current.plan, end: iso(end + extraDays * DAY_MS), extraDays };
}
