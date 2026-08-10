/**
 * A top banner shown when a friend invites you to a room while the app is open.
 * Tapping Join enters their room; Dismiss clears it. Only the newest invite is
 * shown (older ones remain in the Friends screen list until acted on). Sits
 * above the whole app so it can surface from any screen.
 */

import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { Easing, FadeInUp, FadeOut } from "react-native-reanimated";
import { AvatarGlyph } from "./Avatar";
import { Button } from "./Button";
import { CoinGlyph } from "./CoinsPill";
import { useFriends } from "../store/friendsStore";
import { formatCompact } from "../lib/format";
import { depth, font, palette, radius, space } from "../theme";

export function InviteBanner() {
  const invites = useFriends((s) => s.invites);
  const profiles = useFriends((s) => s.profiles);
  const acceptInvite = useFriends((s) => s.acceptInvite);
  const dismissInvite = useFriends((s) => s.dismissInvite);

  const invite = invites[0];
  if (!invite) return null;

  const name = profiles[invite.from_user_id]?.display_name ?? "A friend";
  const avatar = profiles[invite.from_user_id]?.avatar_id ?? "orbit-moss";

  return (
    <SafeAreaView pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, top: 0 }}>
      <Animated.View
        key={invite.id}
        entering={FadeInUp.duration(240).easing(Easing.out(Easing.cubic))}
        exiting={FadeOut.duration(160)}
        style={{ paddingHorizontal: space.lg, paddingTop: space.sm }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.md,
            padding: space.md,
            borderRadius: radius.lg,
            backgroundColor: palette.liftedSlate,
            borderWidth: 1,
            borderColor: palette.hairline,
            borderTopColor: depth.highlight,
            ...depth.shadow,
          }}
        >
          <AvatarGlyph id={avatar} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: font.semibold, fontSize: 15, color: palette.porcelain }} numberOfLines={1}>
              {name} invited you
            </Text>
            {/* The pot is on the banner deliberately: Join is one tap from
                here, and nobody should be able to walk a friend into a
                10,000-coin table with a message that just says "Room ABCD". */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ fontFamily: font.mono, fontSize: 13, color: palette.mutedSteel, letterSpacing: 2 }}>
                {invite.room_code}
              </Text>
              {invite.stake > 0 ? (
                <>
                  <CoinGlyph size={11} />
                  <Text style={{ fontFamily: font.mono, fontSize: 12, color: "#F5C542" }}>
                    {formatCompact(invite.stake)}
                  </Text>
                </>
              ) : (
                <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>Friendly</Text>
              )}
            </View>
          </View>
          <View style={{ width: 92 }}>
            <Button label="Join" onPress={() => void acceptInvite(invite)} />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss invite"
            onPress={() => void dismissInvite(invite.id)}
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, paddingHorizontal: 4 })}
          >
            <Text style={{ fontFamily: font.semibold, fontSize: 20, color: palette.mutedSteel }}>×</Text>
          </Pressable>
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}
