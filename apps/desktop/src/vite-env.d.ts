/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** PostHog project token (public, write-only); unset means no analytics. */
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
