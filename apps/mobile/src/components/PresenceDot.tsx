/**
 * The little "is this friend around" dot, pinned to the corner of an avatar.
 *
 * Offline is drawn rather than omitted so a row's layout never shifts as
 * presence changes, and so "we know they're away" reads differently from "we
 * have no idea" — the latter never renders this at all (see FriendsScreen).
 * The ring matches the card face so the dot reads as sitting on top of the
 * avatar rather than punched into it.
 */

import { View } from "react-native";
import { palette } from "../theme";

const ONLINE_GREEN = "#4ADE80";

export function PresenceDot({ online, size = 12 }: { online: boolean; size?: number }) {
  return (
    <View
      accessibilityLabel={online ? "Online" : "Offline"}
      style={{
        position: "absolute",
        right: -1,
        bottom: -1,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: online ? ONLINE_GREEN : palette.mutedSteel,
        opacity: online ? 1 : 0.55,
        borderWidth: 2,
        borderColor: palette.raisedSlate,
      }}
    />
  );
}
