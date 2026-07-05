/**
 * Settings store: defaults, setters, and that persistence writes through the
 * (aliased) AsyncStorage without touching native code — the infra the app's
 * persisted stores rely on in Node tests.
 */

import { describe, it, expect } from "vitest";
import { useSettings } from "../src/store/settingsStore";
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
