import type { UiLanguage } from '@tayang/shared';
import { detectUiLanguage, setUiLanguage } from '@/i18n';
import { systemLocale, updateSettings } from '@/lib/ipc';
import { useApp } from '@/state/app';

/**
 * The language to start in: the operating system's (asked of Rust, because the webview's own
 * `navigator.language` follows the app bundle, not the system), else the webview's.
 */
export async function systemLanguage(): Promise<UiLanguage> {
  try {
    const locale = await systemLocale();
    if (locale) return detectUiLanguage(locale);
  } catch {
    /* fall back to the webview */
  }
  return detectUiLanguage(globalThis.navigator?.language);
}

/** Switches the interface now and remembers the choice. A failed save leaves the switch in place. */
export async function chooseLanguage(language: UiLanguage): Promise<void> {
  setUiLanguage(language);
  try {
    useApp.getState().setSettings(await updateSettings({ uiLanguage: language }));
  } catch {
    const s = useApp.getState().settings;
    if (s) useApp.getState().setSettings({ ...s, uiLanguage: language });
  }
}
