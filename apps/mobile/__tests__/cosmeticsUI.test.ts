import { describe, it, expect, afterEach } from "vitest";
import { useCosmeticsUI } from "../src/store/cosmeticsUI";

afterEach(() => {
  useCosmeticsUI.setState({ category: "avatar" });
});

describe("cosmeticsUI", () => {
  it("defaults to the avatar category", () => {
    expect(useCosmeticsUI.getState().category).toBe("avatar");
  });

  it("setCategory switches the active category (shared by Shop + Customize)", () => {
    useCosmeticsUI.getState().setCategory("dice");
    expect(useCosmeticsUI.getState().category).toBe("dice");
    useCosmeticsUI.getState().setCategory("board");
    expect(useCosmeticsUI.getState().category).toBe("board");
  });
});
