/**
 * Country flags (0083), app side: the ISO code becomes an emoji flag, and a
 * profile read survives a server that doesn't have the country column yet.
 */

import { describe, expect, it, vi } from "vitest";

const selects: string[] = [];
let countryColumnExists = true;

vi.mock("../src/lib/supabase", () => ({
  getSupabase: () => ({
    from: () => ({
      select: (cols: string) => {
        selects.push(cols);
        return {
          in: () =>
            Promise.resolve(
              cols.includes("country") && !countryColumnExists
                ? { data: null, error: { message: "column profiles.country does not exist" } }
                : {
                    data: [{ user_id: "u1", display_name: "Asha", avatar_id: "cap", dice_skin: null, ...(cols.includes("country") ? { country: "NP" } : {}) }],
                    error: null,
                  },
            ),
        };
      },
    }),
  }),
}));
vi.mock("../src/lib/identityClient", () => ({
  getIdentity: () => ({ ensureSignedIn: () => Promise.resolve("me") }),
}));

import { flagEmoji } from "../src/lib/flags";
import { getProfiles } from "../src/net/api";

describe("flagEmoji", () => {
  it("turns a two-letter code into its flag, in any case", () => {
    expect(flagEmoji("NP")).toBe("🇳🇵");
    expect(flagEmoji("in")).toBe("🇮🇳");
  });

  it("returns null for unknown, Tor, empty and malformed codes", () => {
    for (const code of ["XX", "T1", "", null, undefined, "USA", "1A"]) expect(flagEmoji(code), String(code)).toBeNull();
  });
});

describe("getProfiles", () => {
  it("reads the country with the profile", async () => {
    countryColumnExists = true;
    selects.length = 0;
    const rows = await getProfiles(["u1"]);
    expect(rows[0]!.country).toBe("NP");
    expect(selects).toHaveLength(1);
  });

  it("falls back to the old columns on a server without the country column", async () => {
    countryColumnExists = false;
    selects.length = 0;
    const rows = await getProfiles(["u1"]);
    expect(rows[0]!.display_name).toBe("Asha");
    expect(rows[0]!.country ?? null).toBeNull();
    expect(selects).toHaveLength(2);
    expect(selects[1]).not.toContain("country");
  });
});
