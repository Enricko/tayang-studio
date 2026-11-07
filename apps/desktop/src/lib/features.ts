/**
 * Autopilot screens: enabled in the self-hosted web edition, where the server runs the engine.
 * The desktop app keeps this feature hidden until its own client-side engine ships again.
 */
import { isWeb } from '@/lib/platform';

export const AUTOPILOT_ENABLED = isWeb;
