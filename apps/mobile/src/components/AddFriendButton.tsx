/**
 * Small friend-affordance shown next to another player (lobby, results). Its
 * label reflects the current relationship: add, accept a request they sent,
 * "Requested" once you've asked, or nothing when you're already friends (or it's
 * you). Compact by design — it rides at the end of an existing player row.
 */

import { Text, Pressable } from "react-native";
import { useFriends } from "../store/friendsStore";
import { relationshipTo } from "../lib/friendship";
import { font, palette, radius, space } from "../theme";

export function AddFriendButton({ userId }: { userId: string }) {
  const myUserId = useFriends((s) => s.userId);
  const friendships = useFriends((s) => s.friendships);
  const sendRequest = useFriends((s) => s.sendRequest);
  const accept = useFriends((s) => s.accept);
  const rel = relationshipTo(friendships, myUserId, userId);

  if (!myUserId || userId === myUserId || rel.kind === "friends") return null;

  const label = rel.kind === "incoming" ? "Accept" : rel.kind === "outgoing" ? "Requested" : "Add friend";
  const disabled = rel.kind === "outgoing";
  const onPress = () => {
    if (rel.kind === "incoming") void accept(rel.id);
    // sendRequest goes through the edge function and rejects on a block or a
    // rate limit. Swallowed here on purpose: this button rides inside a lobby
    // or results row mid-game, with nowhere to put an error — the label simply
    // won't advance to "Requested". The Friends and Add Friend screens do
    // surface the reason.
    else if (rel.kind === "none") void sendRequest(userId).catch(() => {});
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: space.md,
        paddingVertical: 6,
        borderRadius: radius.pill,
        backgroundColor: rel.kind === "incoming" ? palette.porcelain : palette.liftedSlate,
        borderTopWidth: 1,
        borderTopColor: "rgba(255,255,255,0.10)",
        opacity: disabled ? 0.6 : pressed ? 0.8 : 1,
      })}
    >
      <Text
        style={{
          fontFamily: font.semibold,
          fontSize: 12,
          color: rel.kind === "incoming" ? palette.feltCharcoal : palette.porcelain,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
