import { beforeEach, describe, expect, it, vi } from "vitest";
import { dismissTopOverlay } from "../src/lib/dismissTopOverlay";
import { useConfirm } from "../src/store/confirmStore";
import { useSheetHost } from "../src/store/sheetHost";

beforeEach(() => {
  useConfirm.getState().answer(false);
  useSheetHost.setState({ sheets: [] });
});

describe("overlay Back priority", () => {
  it("cancels confirmation before closing the sheet underneath", async () => {
    const close = vi.fn(() => useSheetHost.getState().dismiss("buy"));
    useSheetHost.getState().present("buy", "buy", close);
    const answer = useConfirm.getState().ask({ title: "Leave?", destructive: true });
    expect(dismissTopOverlay()).toBe(true);
    await expect(answer).resolves.toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(dismissTopOverlay()).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(dismissTopOverlay()).toBe(false);
  });

  it("acknowledges a notice without falling through to navigation", async () => {
    const answer = useConfirm.getState().ask({ title: "Done", notice: true });
    expect(dismissTopOverlay()).toBe(true);
    await expect(answer).resolves.toBe(true);
    expect(dismissTopOverlay()).toBe(false);
  });
});
