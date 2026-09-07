/**
 * Localization.
 *
 * Two things are worth pinning. The first is that a player's device language
 * actually reaches a catalog — the matching is the only place a subtle bug
 * (region tags, case, ordering) would silently drop somebody back to English
 * without anyone noticing, because English always looks like it works.
 *
 * The second is catalog completeness. TypeScript already makes a MISSING key a
 * build error, so the test here is for the failure the type system cannot
 * see: a key that is present but was never translated, i.e. still verbatim
 * English in a language that is not English.
 */

import { describe, expect, it } from "vitest";
import { LOCALES, LOCALE_NAMES, isRtl, resolveLocale, translate, type Locale } from "../src/i18n";
import { en } from "../src/i18n/locales/en";
import { hi } from "../src/i18n/locales/hi";
import { ne } from "../src/i18n/locales/ne";
import { bn } from "../src/i18n/locales/bn";
import { ur } from "../src/i18n/locales/ur";
import { es } from "../src/i18n/locales/es";
import { ptBR } from "../src/i18n/locales/pt-BR";

const TABLES: Record<Locale, Record<string, string>> = { en, hi, ne, bn, ur, es, "pt-BR": ptBR };

describe("resolveLocale", () => {
  it("takes an exact tag", () => {
    expect(resolveLocale(["pt-BR"])).toBe("pt-BR");
    expect(resolveLocale(["hi"])).toBe("hi");
  });

  it("matches the language when the region differs", () => {
    // A Portuguese speaker in Portugal gets Brazilian Portuguese rather than
    // English: the wrong idioms beat the wrong language.
    expect(resolveLocale(["pt-PT"])).toBe("pt-BR");
    expect(resolveLocale(["es-MX"])).toBe("es");
    expect(resolveLocale(["hi-IN"])).toBe("hi");
    expect(resolveLocale(["ur-PK"])).toBe("ur");
    expect(resolveLocale(["en-US"])).toBe("en");
  });

  it("respects the order the player put their languages in", () => {
    // Someone who lists Nepali first and English second wants Nepali, even
    // though both are supported.
    expect(resolveLocale(["ne-NP", "en-GB"])).toBe("ne");
    expect(resolveLocale(["en-GB", "ne-NP"])).toBe("en");
  });

  it("skips languages we do not have and keeps looking", () => {
    // The important one: an unsupported first preference must not short-
    // circuit to English when a later preference IS supported.
    expect(resolveLocale(["fr-FR", "de-DE", "bn-BD"])).toBe("bn");
  });

  it("is case-insensitive about tags", () => {
    expect(resolveLocale(["PT-br"])).toBe("pt-BR");
    expect(resolveLocale(["HI"])).toBe("hi");
  });

  it("falls back to English for anything unsupported or absent", () => {
    expect(resolveLocale(["fr-FR"])).toBe("en");
    expect(resolveLocale([])).toBe("en");
    expect(resolveLocale([""])).toBe("en");
  });
});

describe("translate", () => {
  it("returns the locale's own string", () => {
    expect(translate("es", "common.cancel")).toBe("Cancelar");
    expect(translate("pt-BR", "common.cancel")).toBe("Cancelar");
    expect(translate("hi", "common.cancel")).toBe("रद्द करें");
  });

  it("fills named placeholders", () => {
    expect(translate("en", "results.takesTopShare", { coins: 250 })).toContain("250");
    expect(translate("es", "results.takesTopShare", { coins: 250 })).toContain("250");
  });

  it("leaves an unfilled placeholder visible rather than printing undefined", () => {
    // A literal {coins} on screen is obviously a bug and gets reported.
    // "undefined coins" reads like a feature working badly.
    expect(translate("en", "results.takesTopShare")).toContain("{coins}");
  });
});

describe("catalogs", () => {
  it("covers every locale in LOCALES", () => {
    for (const l of LOCALES) {
      expect(TABLES[l], `${l} has no table`).toBeDefined();
      expect(LOCALE_NAMES[l], `${l} has no endonym`).toBeTruthy();
    }
  });

  it("names each language in its own script", () => {
    // A list that names languages in a language you cannot read is the one
    // list you cannot use.
    expect(LOCALE_NAMES.hi).toBe("हिन्दी");
    expect(LOCALE_NAMES.ur).toBe("اردو");
    expect(LOCALE_NAMES.bn).toBe("বাংলা");
  });

  it("marks Urdu as right-to-left and nothing else", () => {
    expect(isRtl("ur")).toBe(true);
    for (const l of LOCALES.filter((x) => x !== "ur")) expect(isRtl(l)).toBe(false);
  });

  it("has every key in every locale", () => {
    const keys = Object.keys(en);
    for (const l of LOCALES) {
      expect(Object.keys(TABLES[l]).sort(), `${l} key set differs`).toEqual(keys.slice().sort());
    }
  });

  it("leaves no string untranslated", () => {
    // The failure the types cannot catch: a key present but copied verbatim
    // from English because nobody got to it.
    //
    // Two kinds of string are legitimately identical and have to be listed, or
    // this test is just noise somebody learns to skip. Proper nouns are the
    // same everywhere; loanwords are the same only in the languages that
    // borrowed them, which is why the allowance is PER LOCALE — "Online" is
    // the right Portuguese word and would be a missing translation in Hindi.
    const PROPER_NOUNS = new Set(["account.google", "account.apple", "shop.avatar", "lobby.bot"]);
    const LOANWORDS: Partial<Record<Locale, string[]>> = {
      "pt-BR": ["friends.online", "friends.offline"],
      // "AI" is said and written as AI in all four — Spanish and Portuguese
      // are the ones that localise it (IA), and they are not listed here.
      hi: ["status.aiSeat"],
      ne: ["status.aiSeat"],
      bn: ["status.aiSeat"],
      ur: ["status.aiSeat"],
    };

    for (const l of LOCALES) {
      if (l === "en") continue;
      const allowed = new Set([...PROPER_NOUNS, ...(LOANWORDS[l] ?? [])]);
      const untranslated = Object.keys(en).filter(
        (k) => !allowed.has(k) && TABLES[l][k] === (en as Record<string, string>)[k],
      );
      expect(untranslated, `${l} still has English in: ${untranslated.join(", ")}`).toEqual([]);
    }
  });
});
