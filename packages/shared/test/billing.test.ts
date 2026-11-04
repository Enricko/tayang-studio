import { describe, expect, it } from 'vitest';
import { PAID_PLAN_IDS, PLANS, PLAN_PERIOD_DAYS, findPlan, isPaidPlanId, planFeatures } from '../src/index';

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
    expect(findPlan('lite')?.quotas).toEqual({ socialAccounts: 'unlimited', autoPosts: 30, images: 0, voiceMinutes: 0 });
    expect(findPlan('creator')?.quotas).toEqual({ socialAccounts: 'unlimited', autoPosts: 90, images: 60, voiceMinutes: 15 });
    expect(findPlan('pro')?.quotas).toEqual({ socialAccounts: 'unlimited', autoPosts: 150, images: 100, voiceMinutes: 30 });
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
