/**
 * Localization.
 *
 * Ludo's biggest markets are not English-speaking ones, and every string in
 * this app was an English literal until now — which put a hard ceiling on who
 * could play it that had nothing to do with the game.
 *
 * HAND-ROLLED, AND THE REASON IS THE TYPE. `Strings` is inferred from the
 * English catalog, and every other locale is declared as `Strings`, so a
 * missing or misspelt key is a COMPILE error rather than a blank label
 * discovered by a player. With seven locales and several hundred keys that
 * property is worth more than anything a library adds — i18next and i18n-js
 * both resolve keys at runtime and answer a missing one with silence or the
 * key itself.
 *
 * WHAT IS NOT HERE, deliberately:
 *
 *   Layout mirroring. Urdu is written right-to-left, and React Native renders
 *   it correctly inside a Text without any help — the text engine does bidi.
 *   What `I18nManager.forceRTL` adds is FLEX MIRRORING, which would flip every
 *   row in the app, and the board is a Skia canvas with hand-placed geometry
 *   that knows nothing about it. That is a real project with real breakage,
 *   not a flag, so Urdu ships readable rather than mirrored. `isRtl` exists so
 *   the paragraphs that need aligning can align.
 *
 *   Runtime plural rules. Only a handful of strings count anything, and for
 *   these seven languages the distinction is one/other. Those keys carry an
 *   explicit `_one`/`_other` pair and go through {@link plural}; a language
 *   needing more forms would need this revisited, and the type would say so.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { getLocales } from "expo-localization";
import { kvStorage } from "../lib/storage";
import { en } from "./locales/en";
import { hi } from "./locales/hi";
import { ne } from "./locales/ne";
import { bn } from "./locales/bn";
import { ur } from "./locales/ur";
import { es } from "./locales/es";
import { ptBR } from "./locales/pt-BR";

/**
 * The shape every locale must fill: English's KEYS, with plain string values.
 *
 * A mapped type rather than `typeof en`, and that is the load-bearing detail.
 * The English catalog is `as const` so keys autocomplete, which also makes its
 * values literal types — and a locale declared as `typeof en` would then be
 * required to contain the English text verbatim. Mapping the values back to
 * `string` keeps the key check (the part worth having) and drops the value
 * check (which would make translation impossible).
 */
export type Strings = { readonly [K in keyof typeof en]: string };
export type StringKey = keyof Strings;

export const LOCALES = ["en", "hi", "ne", "bn", "ur", "es", "pt-BR"] as const;
export type Locale = (typeof LOCALES)[number];

const TABLES: Record<Locale, Strings> = { en, hi, ne, bn, ur, es, "pt-BR": ptBR };

/**
 * The language's own name for itself, for the picker.
 *
 * Endonyms, not English names. A player looking for their language scans for
 * the shape of their own script; "Hindi" is no use to somebody who reads
 * हिन्दी, and a list that names languages in a language you do not read is the
 * one list you cannot use.
 */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  hi: "हिन्दी",
  ne: "नेपाली",
  bn: "বাংলা",
  ur: "اردو",
  es: "Español",
  "pt-BR": "Português (Brasil)",
};

/** Locales written right to left. Affects text alignment only — see the header. */
const RTL: ReadonlySet<Locale> = new Set<Locale>(["ur"]);

export function isRtl(locale: Locale): boolean {
  return RTL.has(locale);
}

/**
 * Pick a locale from the device's preferences.
 *
 * Ordered by the player's own priority list, and matched on the LANGUAGE
 * before the region: a Brazilian Portuguese build should serve pt-PT too,
 * because Portuguese-with-the-wrong-idioms beats English. The exact tag still
 * wins when we have it, which is what keeps pt-BR distinguishable if a pt-PT
 * catalog is ever added.
 *
 * Pure and injectable so the matrix is testable — nothing here reads the
 * device.
 */
export function resolveLocale(deviceTags: readonly string[]): Locale {
  const exact = new Map<string, Locale>(LOCALES.map((l) => [l.toLowerCase(), l]));
  const byLanguage = new Map<string, Locale>();
  // First locale wins a language, so "pt-BR" claims "pt" rather than a later
  // entry silently taking it.
  for (const l of LOCALES) {
    const lang = l.split("-")[0]!.toLowerCase();
    if (!byLanguage.has(lang)) byLanguage.set(lang, l);
  }

  for (const tag of deviceTags) {
    const lower = tag.toLowerCase();
    const hit = exact.get(lower) ?? byLanguage.get(lower.split("-")[0]!);
    if (hit) return hit;
  }
  return "en";
}

/** The device's languages, most preferred first. Guarded: this is a native
 *  call and a failure here must not stop the app choosing English. */
function deviceTags(): string[] {
  try {
    return getLocales().map((l) => l.languageTag);
  } catch {
    return [];
  }
}

interface LocaleStore {
  /** The player's explicit choice, or null to follow the device. */
  chosen: Locale | null;
  /** What we are actually rendering in. Always a real locale. */
  locale: Locale;
  setLocale: (next: Locale | null) => void;
}

export const useLocale = create<LocaleStore>()(
  persist(
    (set) => ({
      chosen: null,
      locale: resolveLocale(deviceTags()),
      setLocale: (next) =>
        set({ chosen: next, locale: next ?? resolveLocale(deviceTags()) }),
    }),
    {
      name: "ludo-locale",
      version: 1,
      storage: createJSONStorage(kvStorage),
      // Only the CHOICE is persisted. `locale` is derived, and storing it would
      // freeze a player who has since changed their phone's language into the
      // one they had when they first opened the app.
      partialize: (s) => ({ chosen: s.chosen }) as unknown as LocaleStore,
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.locale = state.chosen ?? resolveLocale(deviceTags());
      },
    },
  ),
);

/** Values substituted into a string's `{placeholders}`. */
export type Params = Record<string, string | number>;

/**
 * Fill `{name}` placeholders.
 *
 * A placeholder with no matching param is left as it stands rather than
 * replaced with "undefined": the literal `{count}` on screen is obviously a
 * bug and gets reported, while "undefined games played" reads like a real
 * feature working badly.
 */
function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in params ? String(params[key]) : whole,
  );
}

/**
 * Look a key up in `locale`, falling back to English.
 *
 * The fallback should be unreachable — the types make a missing key a build
 * error — but it is here because the catalogs are also the thing most likely
 * to be edited in a hurry, and English is always better than blank.
 */
export function translate(locale: Locale, key: StringKey, params?: Params): string {
  const table = TABLES[locale] ?? en;
  return interpolate(table[key] ?? en[key] ?? key, params);
}

/**
 * Translate outside React — message builders, stores, anything not rendering.
 *
 * Reads the store at call time, so a string built during a render is in the
 * current language and one built earlier is not retranslated. Components
 * should use {@link useT} instead, which re-renders on a language change.
 */
export function t(key: StringKey, params?: Params): string {
  return translate(useLocale.getState().locale, key, params);
}

/** The subscribing form. A language change re-renders every component holding
 *  one of these, which is what makes the picker take effect immediately. */
export function useT(): (key: StringKey, params?: Params) => string {
  const locale = useLocale((s) => s.locale);
  return (key, params) => translate(locale, key, params);
}

/**
 * Choose between a one/other pair and fill `{count}`.
 *
 * Takes the two keys explicitly rather than deriving `${key}_one` by string
 * concatenation, because a derived key is exactly the kind the type checker
 * cannot see — and the whole point of this module is that it can.
 */
export function plural(
  one: StringKey,
  other: StringKey,
  count: number,
  params?: Params,
): string {
  return t(count === 1 ? one : other, { count, ...params });
}

/**
 * A seat's colour, in the player's language.
 *
 * Five files each carried their own `COLOR_LABEL` map before this, which is
 * five places to forget — and the label is not decoration: it is the NAME a
 * seat wears whenever there is no profile to show, which is every bot in a
 * friend room and every player whose profile has not loaded yet.
 *
 * Non-reactive `t`, because every caller is a component that already holds a
 * `useT()` for its own strings and so re-renders when the language changes.
 */
export function colorLabel(color: "red" | "green" | "yellow" | "blue"): string {
  return t(`color.${color}` as StringKey);
}
