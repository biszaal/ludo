/**
 * The confirmation prompt's promise contract.
 *
 * Every destructive action in the app is now written as `if (!(await
 * confirm(...))) return;`, so the one thing that must never happen is a prompt
 * that resolves neither way — that would strand the caller's await and leave
 * the action silently un-done with no dialog on screen to explain why.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { confirm, useConfirm } from "../src/store/confirmStore";

const request = { title: "Remove Ada?" };

describe("confirm store", () => {
  beforeEach(() => useConfirm.setState({ request: null, resolve: null }));

  it("starts with nothing on screen", () => {
    expect(useConfirm.getState().request).toBeNull();
  });

  it("shows the request and resolves true when confirmed", async () => {
    const answer = confirm(request);
    expect(useConfirm.getState().request).toEqual(request);
    useConfirm.getState().answer(true);
    expect(await answer).toBe(true);
  });

  it("resolves false when cancelled", async () => {
    const answer = confirm(request);
    useConfirm.getState().answer(false);
    expect(await answer).toBe(false);
  });

  it("clears the dialog once answered, either way", async () => {
    const answer = confirm(request);
    useConfirm.getState().answer(true);
    await answer;
    expect(useConfirm.getState().request).toBeNull();
    expect(useConfirm.getState().resolve).toBeNull();
  });

  it("answers a superseded prompt 'no' rather than orphaning it", async () => {
    // Two asks racing (a double tap, or one screen prompting as another does).
    // The older await must settle, and "no" is the safe reading: its dialog is
    // gone, so nobody consented to anything.
    const first = confirm({ title: "First" });
    const second = confirm({ title: "Second" });
    expect(await first).toBe(false);
    expect(useConfirm.getState().request).toEqual({ title: "Second" });
    useConfirm.getState().answer(true);
    expect(await second).toBe(true);
  });

  it("ignores an answer when nothing is being asked", () => {
    expect(() => useConfirm.getState().answer(true)).not.toThrow();
    expect(useConfirm.getState().request).toBeNull();
  });
});
