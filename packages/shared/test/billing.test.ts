import { describe, expect, it } from 'vitest';
import { CREDIT_COSTS, PAID_PLAN_IDS, PLANS, PLAN_PERIOD_DAYS, creditReach, findPlan, isPaidPlanId, planCredits, planFeatures } from '../src/index';

describe('plans', () => {
  it('has the three monthly plans from docs/monetization.md, in IDR', () => {
    expect(PAID_PLAN_IDS).toEqual(['lite', 'creator', 'pro']);
    expect(PLANS.map((p) => [p.id, p.name, p.price, p.currency, p.interval])).toEqual([
      ['lite', 'Lite', 15000, 'IDR', 'month'],
      ['creator', 'Creator', 50000, 'IDR', 'month'],
      ['pro', 'Pro', 90000, 'IDR', 'month'],
    ]);
    expect(PLAN_PERIOD_DAYS).toBe(30);
  });

  it('carries the quotas per month', () => {
    expect(findPlan('lite')?.quotas).toEqual({ socialAccounts: 'unlimited', autoPosts: 30, credits: 0 });
    expect(findPlan('creator')?.quotas).toEqual({ socialAccounts: 'unlimited', autoPosts: 90, credits: 165 });
    expect(findPlan('pro')?.quotas).toEqual({ socialAccounts: 'unlimited', autoPosts: 150, credits: 310 });
  });

  it('credits are one pool for images and voice (docs/monetization.md)', () => {
    expect(CREDIT_COSTS).toEqual({ image: 1, voiceMinute: 7 });
    // Creator = 60 images + 15 min × 7; Pro = 100 + 30 × 7.
    expect(findPlan('creator')?.quotas.credits).toBe(60 * CREDIT_COSTS.image + 15 * CREDIT_COSTS.voiceMinute);
    expect(findPlan('pro')?.quotas.credits).toBe(100 * CREDIT_COSTS.image + 30 * CREDIT_COSTS.voiceMinute);
    expect(creditReach(165)).toEqual({ images: 165, voiceMinutes: 23 });
    expect(creditReach(310)).toEqual({ images: 310, voiceMinutes: 44 });
    expect(creditReach(0)).toEqual({ images: 0, voiceMinutes: 0 });
    expect(planCredits('free')).toBe(0);
    expect(planCredits('creator')).toBe(165);
  });

  it('finds paid plans only', () => {
    expect(findPlan('free')).toBeNull();
    expect(findPlan('PRO')).toBeNull();
    expect(findPlan(undefined)).toBeNull();
    expect(findPlan({})).toBeNull();
    expect(isPaidPlanId('creator')).toBe(true);
    expect(isPaidPlanId('toString')).toBe(false);
  });

  it('gives each plan its features; free has none', () => {
    expect(planFeatures('free')).toEqual([]);
    expect(planFeatures('lite')).toEqual(['autopilot']);
    expect(planFeatures('creator')).toEqual(['autopilot', 'voiceover']);
    expect(planFeatures('pro')).toEqual(['autopilot', 'voiceover']);
  });
});

import { PLAN_RANK, isLowerPlan, lowerPlanDays, nextPeriod, planRank, upgradeExtraDays } from '../src/index';

describe('plan rank', () => {
  it('free < lite < creator < pro', () => {
    expect(PLAN_RANK).toEqual(['free', 'lite', 'creator', 'pro']);
    expect(planRank('free')).toBeLessThan(planRank('lite'));
    expect(planRank('lite')).toBeLessThan(planRank('creator'));
    expect(planRank('creator')).toBeLessThan(planRank('pro'));
    expect(isLowerPlan('lite', 'creator')).toBe(true);
    expect(isLowerPlan('creator', 'creator')).toBe(false);
    expect(isLowerPlan('pro', 'creator')).toBe(false);
    expect(isLowerPlan('lite', 'free')).toBe(false);
  });
});

describe('period arithmetic', () => {
  const DAY = 86_400_000;
  const now = new Date('2026-11-04T12:00:00.000Z');
  const at = (days: number) => new Date(now.getTime() + days * DAY).toISOString();

  it('upgrade credit: floor(remaining days × old price / new price)', () => {
    expect(upgradeExtraDays(10 * DAY, 15000, 50000)).toBe(3);
    expect(upgradeExtraDays(29.9 * DAY, 50000, 90000)).toBe(16);
    expect(upgradeExtraDays(0, 15000, 90000)).toBe(0);
    expect(upgradeExtraDays(-DAY, 15000, 90000)).toBe(0);
  });

  it('a late lower-plan payment: floor(30 × paid / current) days', () => {
    expect(lowerPlanDays(15000, 90000)).toBe(5);
    expect(lowerPlanDays(50000, 90000)).toBe(16);
    expect(lowerPlanDays(15000, 50000)).toBe(9);
  });

  it('nextPeriod: new, lapsed, renew, upgrade with credit, late lower plan converted', () => {
    expect(nextPeriod(null, 'lite', now)).toEqual({ kind: 'new', plan: 'lite', end: at(30), extraDays: 0 });
    expect(nextPeriod({ plan: 'pro', end: at(-1) }, 'lite', now)).toEqual({ kind: 'new', plan: 'lite', end: at(30), extraDays: 0 });
    expect(nextPeriod({ plan: 'creator', end: at(10) }, 'creator', now)).toEqual({ kind: 'renew', plan: 'creator', end: at(40), extraDays: 0 });
    expect(nextPeriod({ plan: 'lite', end: at(10) }, 'creator', now)).toEqual({ kind: 'upgrade', plan: 'creator', end: at(33), extraDays: 3 });
    expect(nextPeriod({ plan: 'pro', end: at(20) }, 'lite', now)).toEqual({ kind: 'converted', plan: 'pro', end: at(25), extraDays: 5 });
    // Ends stored without milliseconds still read.
    expect(nextPeriod({ plan: 'lite', end: '2026-11-14T12:00:00Z' }, 'lite', now).end).toBe(at(40));
  });
});
