export type Feature = 'voiceover' | 'cloud-render' | 'premium-styles' | 'autopilot';

export interface HealthResponse {
  ok: true;
  version: string;
}

export interface Entitlements {
  plan: 'free' | 'pro';
  features: Feature[];
}
