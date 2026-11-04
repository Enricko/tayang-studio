import type { Style } from './types';

export type Feature = 'voiceover' | 'cloud-render' | 'premium-styles' | 'autopilot';

export interface HealthResponse {
  ok: true;
  version: string;
}

export interface Entitlements {
  plan: 'free' | 'pro';
  features: Feature[];
}

/** GET /v1/styles */
export interface StylesResponse {
  styles: Style[];
}

/** `tayang.json` at the root of a style template zip. */
export interface TemplateManifest {
  engine: 'remotion' | 'hyperframes';
  /** argv; "{output}" is replaced with the output mp4 path. */
  render: string[];
  install?: string[];
  readme: 'STYLE.md';
}
