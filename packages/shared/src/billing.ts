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
