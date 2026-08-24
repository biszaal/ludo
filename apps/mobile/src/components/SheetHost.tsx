/**
 * Draws every open bottom sheet, mounted once at the app root.
 *
 * Sheets are written where their state lives — often deep inside a scroll view —
 * but must land on the SCREEN, over the floating tab dock. So `Sheet` publishes
 * its card to store/sheetHost and this renders the list, the same way
 * ConfirmDialog is mounted once rather than at each call site. Order is back to
 * front: a sheet opened later paints over one already up.
 */

import { Fragment } from "react";
import { useSheetHost } from "../store/sheetHost";

export function SheetHost() {
  const sheets = useSheetHost((s) => s.sheets);
  return (
    <>
      {sheets.map(({ id, node }) => (
        <Fragment key={id}>{node}</Fragment>
      ))}
    </>
  );
}
