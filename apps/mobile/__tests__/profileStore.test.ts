/**
 * Device identity: every install mints a guestNNNNNN handle and falls back to
 * it whenever no display name is set. The literal "You" default is gone — it
 * used to sync to the server and label every online seat "You".
 */

import { describe, expect, it } from "vitest";
import { useProfile } from "../src/store/profileStore";

describe("profile guest identity", () => {
  it("defaults the display name to this device's guest handle", () => {
    const { displayName, guestName } = useProfile.getState();
    expect(guestName).toMatch(/^guest\d{6}$/);
    expect(displayName).toBe(guestName);
  });

  it("keeps a chosen name and falls back to the guest handle when cleared", () => {
    const { setName, guestName } = useProfile.getState();

    setName("Bishal");
    expect(useProfile.getState().displayName).toBe("Bishal");

    setName("   ");
    expect(useProfile.getState().displayName).toBe(guestName);
  });
});

describe("dice skin", () => {
  it("defaults to classic (inherits the board theme, no purchase needed)", () => {
    expect(useProfile.getState().diceSkinId).toBe("classic");
  });

  it("equips a purchased skin and keeps it selected", () => {
    useProfile.getState().setDiceSkin("gold");
    expect(useProfile.getState().diceSkinId).toBe("gold");
  });
});
