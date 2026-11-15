/** Keep mounted screen state, but hide it from input while an overlay is open. */
import type { ReactNode } from "react";
import { View } from "react-native";
import { useSheetHost } from "../store/sheetHost";
import { useConfirm } from "../store/confirmStore";

export function OverlayBackground({ children }: { children: ReactNode }) {
  const sheetOpen = useSheetHost((s) => s.sheets.length > 0);
  const confirmOpen = useConfirm((s) => s.request !== null);
  const blocked = sheetOpen || confirmOpen;
  return (
    <View
      collapsable={false}
      style={{ flex: 1 }}
      pointerEvents={blocked ? "none" : "auto"}
      accessibilityElementsHidden={blocked}
      importantForAccessibility={blocked ? "no-hide-descendants" : "auto"}
    >
      {children}
    </View>
  );
}
