/**
 * Autopilot screens: enabled in the self-hosted web edition, where the server runs the engine.
 * The desktop app keeps this feature hidden until its own client-side engine ships again.
 */
import { isWeb } from '@/lib/platform';

export const AUTOPILOT_ENABLED = isWeb;

/**
 * Tayang cloud billing (QRIS, paid plans, plan reminders) is disabled in this fork. The optional
 * cloud account/social features can stay; none of their payment entry points should be reachable.
 */
export let BILLING_ENABLED = false;

/** Test seam for the cloud UI's own suite; production never turns billing back on. */
export function setBillingEnabledForTest(on: boolean): void {
  BILLING_ENABLED = on;
}
