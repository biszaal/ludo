/**
 * Renders the top entry of the nav stack with game-feel transitions: a soft
 * focus pull — opacity cross-fade plus a slight scale — deliberately not an
 * iOS edge-slide, and no spring overshoot. Only the top screen is mounted;
 * screen state lives in stores, so remounting is safe.
 *
 * The felt is painted HERE, behind the screens, not only inside them. Both
 * screens are partly transparent midway through a cross-fade, so without a
 * backdrop of its own this container let the bare white root show through —
 * which is what made every navigation flash.
 *
 * Android back: a registered interceptor (pause menu, room cleanup) wins;
 * otherwise pop, and let the OS exit the app at the root.
 */

import { useEffect, type ComponentType } from "react";
import { BackHandler, View } from "react-native";
import Animated, { Easing, withTiming } from "react-native-reanimated";
import { HomeScreen } from "../screens/HomeScreen";
import { GameScreen } from "../screens/GameScreen";
import { LobbyScreen } from "../screens/LobbyScreen";
import { OnlineGameScreen } from "../screens/OnlineGameScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { ShopScreen } from "../screens/ShopScreen";
import { HowToPlayScreen } from "../screens/HowToPlayScreen";
import { AccountScreen } from "../screens/AccountScreen";
import { FriendsScreen } from "../screens/FriendsScreen";
import { AddFriendScreen } from "../screens/AddFriendScreen";
import { PlayerProfileScreen } from "../screens/PlayerProfileScreen";
import { TabDock } from "./TabDock";
import { stackShowsDock } from "../lib/tabs";
import { getBackInterceptor, useNav, type ScreenName } from "../store/navStore";
import { palette } from "../theme";

const SCREENS: Partial<Record<ScreenName, ComponentType>> = {
  home: HomeScreen,
  localGame: GameScreen,
  lobby: LobbyScreen,
  onlineGame: OnlineGameScreen,
  settings: SettingsScreen,
  profile: ProfileScreen,
  shop: ShopScreen,
  howToPlay: HowToPlayScreen,
  account: AccountScreen,
  friends: FriendsScreen,
  addFriend: AddFriendScreen,
  playerProfile: PlayerProfileScreen,
};

export function ScreenStack() {
  const stack = useNav((s) => s.stack);
  const lastOp = useNav((s) => s.lastOp);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (getBackInterceptor()?.()) return true;
      const nav = useNav.getState();
      if (nav.stack.length > 1) {
        nav.pop();
        return true;
      }
      return false; // at the root — let Android exit the app
    });
    return () => sub.remove();
  }, []);

  const top = stack[stack.length - 1]!;
  const Screen = SCREENS[top.name];

  // Matched durations in and out: an uneven pair leaves a gap where neither
  // screen is opaque, which reads as a blink even over a painted backdrop.
  const entering = lastOp === "pop" ? focusInFromBehind : lastOp === "push" ? focusInFromFront : focusInFlat;

  // The dock is a sibling of the screen, not part of it: mounted once for the
  // whole tab set, it holds still while the screens above it cross-fade.
  return (
    <View style={{ flex: 1, backgroundColor: palette.tableBlue }}>
      <Animated.View key={top.key} style={{ flex: 1 }} entering={entering} exiting={focusOut}>
        {Screen ? <Screen /> : null}
      </Animated.View>
      {stackShowsDock(top.name) ? <TabDock current={top.name} /> : null}
    </View>
  );
}

// --- Transitions ---------------------------------------------------------
// A focus pull rather than a slide: the outgoing screen settles back and
// dissolves while the incoming one comes forward into place. Depth carries the
// direction — pushing arrives from slightly in front, going back from behind —
// so the motion still says which way you went without a drift that fights the
// dock holding still underneath.

const DURATION = 260;
/** How far off 1.0 a screen sits at the far end of the pull. */
const DEPTH = 0.03;

function focusInFromFront() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: 1 + DEPTH }] },
    animations: {
      opacity: withTiming(1, { duration: DURATION, easing: Easing.out(Easing.cubic) }),
      transform: [{ scale: withTiming(1, { duration: DURATION, easing: Easing.out(Easing.cubic) }) }],
    },
  };
}

function focusInFromBehind() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: 1 - DEPTH }] },
    animations: {
      opacity: withTiming(1, { duration: DURATION, easing: Easing.out(Easing.cubic) }),
      transform: [{ scale: withTiming(1, { duration: DURATION, easing: Easing.out(Easing.cubic) }) }],
    },
  };
}

function focusInFlat() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: 1 }] },
    animations: {
      opacity: withTiming(1, { duration: DURATION, easing: Easing.out(Easing.cubic) }),
      transform: [{ scale: withTiming(1, { duration: DURATION, easing: Easing.out(Easing.cubic) }) }],
    },
  };
}

function focusOut() {
  "worklet";
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: {
      opacity: withTiming(0, { duration: DURATION, easing: Easing.in(Easing.cubic) }),
      transform: [{ scale: withTiming(1 - DEPTH, { duration: DURATION, easing: Easing.in(Easing.cubic) }) }],
    },
  };
}
