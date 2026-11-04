import { create } from 'zustand';
import type { BillingStatus, CheckoutResponse, PaidPlanId } from '@tayang/shared';
import { POLL_LIMIT_MS, POLL_MS, billingCheckout, billingErrorCode, billingStatus, isPaymentLink, type BillingErrorCode } from '@/lib/billing';

/** The plan dialog. `failed` holds an error code, or the raw message of an unexpected failure. */
export type PayFlow =
  | { phase: 'closed' }
  | { phase: 'picking' }
  | { phase: 'starting'; plan: PaidPlanId }
  | { phase: 'waiting'; plan: PaidPlanId; checkout: CheckoutResponse; endBefore: string | null }
  | { phase: 'done'; plan: PaidPlanId; currentPeriodEnd: string | null }
  | { phase: 'timeout'; plan: PaidPlanId; checkout: CheckoutResponse; endBefore: string | null }
  | { phase: 'failed'; plan: PaidPlanId; error: BillingErrorCode | { message: string } };

interface BillingStore {
  /** What the API last said; null until it has (or when signed out). */
  status: BillingStatus | null;
  /** When `status` was read (ms), 0 if never. */
  loadedAt: number;
  /** The last read failed (other than signed out): the plan is unknown, not free. */
  failed: boolean;
  flow: PayFlow;
  /** Bumped by every pay, close and reopen, so a late answer or poll from an old one is dropped. */
  attempt: number;
  /** Reads the plan state. Resolves to it, or null when it couldn't. */
  refresh(): Promise<BillingStatus | null>;
  open(): void;
  close(): void;
  /** Starts (or picks up) paying for `plan`: Rust opens the browser, then this polls until it's paid. */
  pay(plan: PaidPlanId): Promise<void>;
  /** After a timeout: look again for a while. */
  checkAgain(): void;
  /** Forget everything (signed out). */
  reset(): void;
}

let pollTimer: ReturnType<typeof setTimeout> | undefined;
const stopPolling = () => {
  if (pollTimer !== undefined) clearTimeout(pollTimer);
  pollTimer = undefined;
};

/** The payment went through once the plan runs with a different end than before paying. */
const paid = (s: BillingStatus, plan: PaidPlanId, endBefore: string | null) =>
  s.active && s.plan === plan && s.currentPeriodEnd !== endBefore;

export const useBilling = create<BillingStore>((set, get) => {
  /** Asks every POLL_MS until paid, the dialog closes or another attempt starts, for at most POLL_LIMIT_MS. */
  const poll = (attempt: number, plan: PaidPlanId, endBefore: string | null, checkout: CheckoutResponse) => {
    stopPolling();
    const until = Date.now() + POLL_LIMIT_MS;
    const step = async () => {
      if (get().attempt !== attempt) return;
      const s = await get().refresh();
      if (get().attempt !== attempt) return;
      if (s && paid(s, plan, endBefore)) {
        set({ flow: { phase: 'done', plan, currentPeriodEnd: s.currentPeriodEnd } });
        return;
      }
      if (Date.now() >= until) {
        set({ flow: { phase: 'timeout', plan, checkout, endBefore } });
        return;
      }
      pollTimer = setTimeout(() => void step(), POLL_MS);
    };
    pollTimer = setTimeout(() => void step(), POLL_MS);
  };

  return {
    status: null,
    loadedAt: 0,
    failed: false,
    flow: { phase: 'closed' },
    attempt: 0,

    async refresh() {
      try {
        const s = await billingStatus();
        set({ status: s, loadedAt: Date.now(), failed: false });
        return s;
      } catch (e) {
        if (billingErrorCode(e) === 'signed-out') set({ status: null, loadedAt: Date.now(), failed: false });
        else set({ failed: true });
        return null;
      }
    },

    open() {
      stopPolling();
      set((s) => ({ attempt: s.attempt + 1, flow: { phase: 'picking' } }));
      void get().refresh();
    },

    close() {
      stopPolling();
      set((s) => ({ attempt: s.attempt + 1, flow: { phase: 'closed' } }));
    },

    async pay(plan) {
      stopPolling();
      const attempt = get().attempt + 1;
      set({ attempt, flow: { phase: 'starting', plan } });
      // The end before paying is what "paid" is measured against, so it must be known first.
      if (!get().loadedAt) await get().refresh();
      if (get().attempt !== attempt) return;
      const endBefore = get().status?.currentPeriodEnd ?? null;
      try {
        const checkout = await billingCheckout(plan);
        if (get().attempt !== attempt) return;
        if (!isPaymentLink(checkout.paymentLinkUrl)) {
          set({ flow: { phase: 'failed', plan, error: 'bad_link' } });
          return;
        }
        set({ flow: { phase: 'waiting', plan, checkout, endBefore } });
        poll(attempt, plan, endBefore, checkout);
      } catch (e) {
        if (get().attempt !== attempt) return;
        set({ flow: { phase: 'failed', plan, error: billingErrorCode(e) ?? { message: e instanceof Error ? e.message : String(e) } } });
      }
    },

    checkAgain() {
      const { flow } = get();
      if (flow.phase !== 'timeout') return;
      const attempt = get().attempt + 1;
      set({ attempt, flow: { ...flow, phase: 'waiting' } });
      poll(attempt, flow.plan, flow.endBefore, flow.checkout);
    },

    reset() {
      stopPolling();
      set((s) => ({ status: null, loadedAt: 0, failed: false, attempt: s.attempt + 1, flow: { phase: 'closed' } }));
    },
  };
});
