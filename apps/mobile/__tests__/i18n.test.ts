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
import { LOCALES, LOCALE_NAMES, isRtl, resolveLocale, translate, useLocale, type Locale } from "../src/i18n";
import { en } from "../src/i18n/locales/en";
import { hi } from "../src/i18n/locales/hi";
import { ne } from "../src/i18n/locales/ne";
import { bn } from "../src/i18n/locales/bn";
import { ur } from "../src/i18n/locales/ur";
import { es } from "../src/i18n/locales/es";
import { ptBR } from "../src/i18n/locales/pt-BR";
import { QUICK_MESSAGES, displayPhrase } from "../src/lib/chatPhrases";

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
      // "Blitz" is the chess word, borrowed as-is in Portuguese and Spanish.
      "pt-BR": ["friends.online", "friends.offline", "stats.modeOnline", "mode.blitz", "rules.blitz"],
      es: ["mode.blitz", "rules.blitz"],
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

describe("friend-code share message", () => {
  it("carries the name, the code and the landing link in every language", () => {
    // The link is what turns a shared code into an install: without it the
    // friend has to go and find the game before the code is any use.
    const url = "https://www.biszaaltech.com/games/ludo";
    for (const l of LOCALES) {
      const msg = translate(l, "invite.friendMessage", { name: "Asha", code: "K7PXQ2", url });
      expect(msg, l).toContain("Asha");
      expect(msg, l).toContain("K7PXQ2");
      expect(msg, l).toContain(url);
    }
  });
});

describe("purchase footnotes", () => {
  it("says coins and gems never affect how a game plays out", () => {
    expect(en["coins.neverAffectsPlay"]).toBe(
      "Coins are for entering matches and unlocking looks. They never affect how a game plays out.",
    );
    expect(en["gems.neverAffectsPlay"]).toBe(
      "Gems unlock premium looks and convert to coins. They never affect how a game plays out.",
    );
    // Nothing in the app describes bots or the dice.
    expect(en["coins.neverAffectsPlay"]).not.toMatch(/bot|dice|assist/i);
    expect(en["gems.neverAffectsPlay"]).not.toMatch(/bot|dice|assist/i);
  });
});

describe("chat phrases", () => {
  it("translates a canned line for display", () => {
    // The wire value is English; what a reader sees is their own language.
    expect(displayPhrase("Good luck!")).toBe(translate("en", "chat.q.goodLuck"));
  });

  it("passes free text through untouched", () => {
    // Somebody's typed message. We cannot translate it and must not try.
    expect(displayPhrase("meet me in the friends room")).toBe("meet me in the friends room");
    expect(displayPhrase("")).toBe("");
  });

  it("covers every canned line except GG", () => {
    // Driven in Hindi on purpose: in English the wire value and the displayed
    // value are the same string, so an English run would pass even with the
    // whole lookup table missing.
    const previous = useLocale.getState().chosen;
    useLocale.getState().setLocale("hi");
    try {
      for (const wire of QUICK_MESSAGES) {
        if (wire === "GG") continue;
        expect(displayPhrase(wire), `${wire} has no catalog entry`).not.toBe(wire);
      }
      // GG is the same in every language this ships in, and giving it a catalog
      // entry would invite someone to "translate" it into something nobody says.
      expect(displayPhrase("GG")).toBe("GG");
    } finally {
      useLocale.getState().setLocale(previous);
    }
  });
});
