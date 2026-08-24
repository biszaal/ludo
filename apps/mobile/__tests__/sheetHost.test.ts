/**
 * The sheet host registry.
 *
 * Bottom sheets are declared deep inside whatever screen owns the state that
 * opens them — the Shop's buy sheet lives in CosmeticsBrowser, halfway down a
 * scroll view. React Native has no `position: fixed`, so an absolutely
 * positioned overlay anchors to its PARENT's box: declared there, the sheet
 * pinned itself to the bottom of the scrolling column instead of the screen,
 * and you had to scroll to reach it. This registry is the escape hatch — every
 * Sheet publishes its card here and one host at the app root renders them, so
 * where a sheet is declared no longer decides where it lands.
 *
 * Order is the contract: entries paint in the order they were presented, and a
 * re-render must not move one. A moved entry is a remount, which would restart
 * the slide-in animation mid-life.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useSheetHost } from "../src/store/sheetHost";

const reset = () => useSheetHost.setState({ sheets: [] });
const ids = () => useSheetHost.getState().sheets.map((s) => s.id);
const nodeOf = (id: string) => useSheetHost.getState().sheets.find((s) => s.id === id)?.node;

describe("sheet host", () => {
  beforeEach(reset);

  it("starts with nothing mounted", () => {
    expect(useSheetHost.getState().sheets).toEqual([]);
  });

  it("keeps sheets in the order they were presented", () => {
    const { present } = useSheetHost.getState();
    present("a", "card-a");
    present("b", "card-b");
    expect(ids()).toEqual(["a", "b"]);
  });

  it("replaces a sheet's card in place when it re-renders", () => {
    const { present } = useSheetHost.getState();
    present("a", "card-a");
    present("b", "card-b");
    present("a", "card-a-updated");
    // Same slot, new content: re-rendering an open sheet must not remount it
    // (that would restart its slide-in) or lift it over a later sheet.
    expect(ids()).toEqual(["a", "b"]);
    expect(nodeOf("a")).toBe("card-a-updated");
  });

  it("dismisses only the named sheet", () => {
    const { present, dismiss } = useSheetHost.getState();
    present("a", "card-a");
    present("b", "card-b");
    dismiss("a");
    expect(ids()).toEqual(["b"]);
  });

  it("ignores a dismiss for a sheet that is already gone", () => {
    const { dismiss } = useSheetHost.getState();
    expect(() => dismiss("ghost")).not.toThrow();
    expect(useSheetHost.getState().sheets).toEqual([]);
  });
});
