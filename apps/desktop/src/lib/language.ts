import type { UiLanguage } from '@tayang/shared';
import { setUiLanguage } from '@/i18n';
import { updateSettings } from '@/lib/ipc';
import { useApp } from '@/state/app';

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
