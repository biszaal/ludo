/**
 * Draws every open bottom sheet, mounted once at the app root.
 *
 * Sheets are written where their state lives — often deep inside a scroll view —
 * but must land on the SCREEN, over the floating tab dock. So `Sheet` publishes
 * its card to store/sheetHost and this renders the list, the same way
 * ConfirmDialog is mounted once rather than at each call site. Order is back to
 * front: a sheet opened later paints over one already up.
 */

import { StyleSheet, View } from "react-native";
import { useConfirm } from "../store/confirmStore";
import { useSheetHost } from "../store/sheetHost";

export function SheetHost() {
  const sheets = useSheetHost((s) => s.sheets);
  const confirming = useConfirm((s) => s.request !== null);
  return (
    <>
      {sheets.map(({ id, node }, index) => {
        const active = !confirming && index === sheets.length - 1;
        return (
          <View
            key={id}
            collapsable={false}
            style={StyleSheet.absoluteFill}
            pointerEvents={active ? "box-none" : "none"}
            accessibilityViewIsModal={active}
            accessibilityElementsHidden={!active}
            importantForAccessibility={active ? "auto" : "no-hide-descendants"}
          >
            {node}
          </View>
        );
      })}
    </>
  );
}
