import { useConfirm } from "../store/confirmStore";
import { useSheetHost } from "../store/sheetHost";

/** Resolve overlays before game leave interceptors or page navigation. */
export function dismissTopOverlay(): boolean {
  const confirmation = useConfirm.getState();
  if (confirmation.request) {
    confirmation.answer(!!confirmation.request.notice);
    return true;
  }
  return useSheetHost.getState().closeTop();
}
