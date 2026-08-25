/**
 * Settings store: defaults, setters, and that persistence writes through the
 * (aliased) AsyncStorage without touching native code — the infra the app's
 * persisted stores rely on in Node tests.
 */

import { describe, it, expect } from "vitest";
import { migrateSettings, useSettings } from "../src/store/settingsStore";
import storage from "@react-native-async-storage/async-storage";

describe("settings store", () => {
  it("defaults to everything on with the classic board", () => {
    const s = useSettings.getState();
    expect(s.soundOn).toBe(true);
    expect(s.musicOn).toBe(true);
    expect(s.hapticsOn).toBe(true);
    expect(s.boardThemeId).toBe("classic");
  });

  it("updates and persists changes", async () => {
    useSettings.getState().setSound(false);
    useSettings.getState().setBoardTheme("night");
    expect(useSettings.getState().soundOn).toBe(false);
    expect(useSettings.getState().boardThemeId).toBe("night");

    // zustand persist writes asynchronously; flush microtasks.
    await new Promise((r) => setTimeout(r, 0));
    const raw = await storage.getItem("ludo-settings");
    expect(raw).toBeTruthy();
    const saved = JSON.parse(raw!) as { state: { soundOn: boolean; boardThemeId: string } };
    expect(saved.state.soundOn).toBe(false);
    expect(saved.state.boardThemeId).toBe("night");
  });
});

describe("motion preference", () => {
  it("defaults to auto so the device tier decides", () => {
    expect(useSettings.getState().motionPref).toBe("auto");
  });

  it("pins an explicit preference", () => {
    useSettings.getState().setMotionPref("reduced");
    expect(useSettings.getState().motionPref).toBe("reduced");
  });

  it("carries a v1 profile forward without disturbing what it already held", () => {
    // The migration runs against settings persisted before this field existed.
    // Anything it drops is a preference the player set and we lost.
    const migrated = migrateSettings({ soundOn: false, musicOn: true, boardThemeId: "night" }, 1) as {
      soundOn: boolean;
      boardThemeId: string;
      motionPref: string;
    };
    expect(migrated.soundOn).toBe(false);
    expect(migrated.boardThemeId).toBe("night");
    expect(migrated.motionPref).toBe("auto");
  });

  it("leaves a v2 profile's stored preference alone", () => {
    const migrated = migrateSettings({ motionPref: "reduced" }, 2) as { motionPref: string };
    expect(migrated.motionPref).toBe("reduced");
  });
});
