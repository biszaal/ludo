/**
 * Renders the top entry of the nav stack with game-feel transitions (fade +
 * vertical drift, timing-based — deliberately not an iOS edge-slide, and no
 * spring overshoot). Only the top screen is mounted; screen state lives in
 * stores, so remounting is safe.
 *
 * Android back: a registered interceptor (pause menu, room cleanup) wins;
 * otherwise pop, and let the OS exit the app at the root.
 */

import { useEffect, type ComponentType } from "react";
import { BackHandler } from "react-native";
import Animated, { Easing, FadeIn, FadeInDown, FadeInUp, FadeOut } from "react-native-reanimated";
import { HomeScreen } from "../screens/HomeScreen";
import { GameScreen } from "../screens/GameScreen";
import { LobbyScreen } from "../screens/LobbyScreen";
import { OnlineGameScreen } from "../screens/OnlineGameScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { HowToPlayScreen } from "../screens/HowToPlayScreen";
import { StatsScreen } from "../screens/StatsScreen";
import { FriendsScreen } from "../screens/FriendsScreen";
import { getBackInterceptor, useNav, type ScreenName } from "../store/navStore";

const SCREENS: Partial<Record<ScreenName, ComponentType>> = {
  home: HomeScreen,
  localGame: GameScreen,
  lobby: LobbyScreen,
  onlineGame: OnlineGameScreen,
  settings: SettingsScreen,
  profile: ProfileScreen,
  howToPlay: HowToPlayScreen,
  stats: StatsScreen,
  friends: FriendsScreen,
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

  const entering =
    lastOp === "push"
      ? FadeInUp.duration(220).easing(Easing.out(Easing.cubic))
      : lastOp === "pop"
        ? FadeInDown.duration(220).easing(Easing.out(Easing.cubic))
        : FadeIn.duration(180);

  return (
    <Animated.View key={top.key} style={{ flex: 1 }} entering={entering} exiting={FadeOut.duration(120)}>
      {Screen ? <Screen /> : null}
    </Animated.View>
  );
}
