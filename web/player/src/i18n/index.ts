import { useSyncExternalStore } from 'react';
import ruStrings from './ru.json';
import enStrings from './en.json';

export type Lang = 'ru' | 'en';
type Strings = Record<string, string>;

const catalogs: Record<Lang, Strings> = {
  ru: ruStrings as Strings,
  en: enStrings as Strings,
};

// Module-level language state.
let currentLang: Lang = 'ru';

// Subscribers for React re-render via useSyncExternalStore.
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Subscribe for React useSyncExternalStore. Returns unsubscribe fn. */
export function subscribeLang(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Snapshot for React useSyncExternalStore. */
export function getLangSnapshot(): Lang {
  return currentLang;
}

/** Set the active language and notify all subscribers. */
export function setLang(lang: Lang): void {
  if (lang === currentLang) return;
  currentLang = lang;
  emit();
}

/** Read the active language without subscribing. */
export function getLang(): Lang {
  return currentLang;
}

/**
 * Translate a key with optional {param} interpolation.
 * Fallback chain: current lang → English → key itself.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const catalog = catalogs[currentLang];
  let str: string | undefined = catalog[key];
  if (str === undefined) {
    str = catalogs['en'][key];
  }
  if (str === undefined) {
    return key;
  }
  if (params === undefined) return str;
  return str.replace(/\{(\w+)\}/g, (_, name: string) => {
    const val = params[name];
    return val !== undefined ? String(val) : `{${name}}`;
  });
}

/**
 * React hook: subscribes to language changes via useSyncExternalStore.
 * Call this in any component that renders localised strings; it ensures
 * the component re-renders when the language is switched.
 * Returns the `t` function (the module-level singleton is fine to use
 * directly in non-hook contexts too).
 */
export function useI18n(): typeof t {
  // We subscribe to the language atom; the snapshot is just the lang string
  // so React can detect changes. The returned `t` is always the same fn ref —
  // that's fine because the re-render is what triggers a fresh call of `t`.
  useSyncExternalStore(subscribeLang, getLangSnapshot);
  return t;
}
