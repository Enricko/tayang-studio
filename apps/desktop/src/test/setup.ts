import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { setUiLanguage } from '@/i18n';

// Existing tests assert English copy; tests that want Indonesian switch inside the test.
setUiLanguage('en');
afterEach(() => {
  cleanup();
  setUiLanguage('en');
});

// jsdom lacks these; Radix popovers and cmdk rely on them.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= RO as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};

// jsdom has no media playback.
HTMLMediaElement.prototype.play = () => Promise.resolve();
HTMLMediaElement.prototype.pause = () => {};
HTMLMediaElement.prototype.load = () => {};
