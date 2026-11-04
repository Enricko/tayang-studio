import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { UiLanguage } from '@tayang/shared';
import { en } from './en';
import { id } from './id';

export const LANGUAGES: UiLanguage[] = ['en', 'id'];

/** Each language named in itself, for the picker. */
export const LANGUAGE_NAMES: Record<UiLanguage, string> = { en: 'English', id: 'Bahasa Indonesia' };

const LOCALES: Record<UiLanguage, string> = { en: 'en-US', id: 'id-ID' };

export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, id: { translation: id } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
  initAsync: false,
});

/** The language the UI shows now. */
export function uiLanguage(): UiLanguage {
  return i18n.language === 'id' ? 'id' : 'en';
}

/** The `Intl` locale for the active language. */
export function locale(): string {
  return LOCALES[uiLanguage()];
}

/** First run: Indonesian when the system language is, otherwise English. */
export function detectUiLanguage(systemLanguage: string | undefined = globalThis.navigator?.language): UiLanguage {
  return systemLanguage?.toLowerCase().startsWith('id') ? 'id' : 'en';
}

/** Switches the interface at once, no restart. */
export function setUiLanguage(language: UiLanguage): void {
  void i18n.changeLanguage(language);
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}

export { type Translations } from './en';
