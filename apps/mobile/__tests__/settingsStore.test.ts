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

describe("volume levels", () => {
  it("defaults both masters to full, so an existing mix is untouched", () => {
    // These multiply the per-sound levels in lib/sound rather than replacing
    // them: anything other than 1 here would quietly re-mix the whole game.
    expect(useSettings.getState().soundVolume).toBe(1);
    expect(useSettings.getState().musicVolume).toBe(1);
  });

  it("stores a chosen level", () => {
    useSettings.getState().setSoundVolume(0.4);
    useSettings.getState().setMusicVolume(0.15);
    expect(useSettings.getState().soundVolume).toBe(0.4);
    expect(useSettings.getState().musicVolume).toBe(0.15);
  });

  it("clamps rather than trusting its caller", () => {
    // The caller is a gesture. A value off the end of the track, or a NaN from
    // a zero-width layout, would otherwise persist and be silent forever.
    useSettings.getState().setSoundVolume(3);
    expect(useSettings.getState().soundVolume).toBe(1);
    useSettings.getState().setSoundVolume(-1);
    expect(useSettings.getState().soundVolume).toBe(0);
    useSettings.getState().setMusicVolume(Number.NaN);
    expect(useSettings.getState().musicVolume).toBe(1);
  });

  it("keeps the level across a mute, so unmuting returns to where it was", () => {
    useSettings.getState().setSoundVolume(0.3);
    useSettings.getState().setSound(false);
    useSettings.getState().setSound(true);
    expect(useSettings.getState().soundVolume).toBe(0.3);
  });

  it("gives an upgrading player full volume without disturbing their toggles", () => {
    // Someone who has played for months has no volume stored. Defaulting them
    // to anything but full would be a change they never asked for.
    const migrated = migrateSettings({ soundOn: false, musicOn: true, motionPref: "reduced" }, 2) as {
      soundOn: boolean;
      motionPref: string;
      soundVolume: number;
      musicVolume: number;
    };
    expect(migrated.soundOn).toBe(false);
    expect(migrated.motionPref).toBe("reduced");
    expect(migrated.soundVolume).toBe(1);
    expect(migrated.musicVolume).toBe(1);
  });

  it("carries a v1 profile all the way forward", () => {
    // v1 skips a version; the chain has to apply both steps, not just the last.
    const migrated = migrateSettings({ soundOn: false }, 1) as {
      soundOn: boolean;
      motionPref: string;
      soundVolume: number;
    };
    expect(migrated.soundOn).toBe(false);
    expect(migrated.motionPref).toBe("auto");
    expect(migrated.soundVolume).toBe(1);
  });

  it("leaves a v3 profile's stored levels alone", () => {
    const migrated = migrateSettings({ soundVolume: 0.2, musicVolume: 0 }, 3) as {
      soundVolume: number;
      musicVolume: number;
    };
    expect(migrated.soundVolume).toBe(0.2);
    expect(migrated.musicVolume).toBe(0);
  });
});
