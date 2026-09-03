/**
 * The dock as ScreenStack renders it: one instance floating over the screen,
 * so it stays put while Shop / Friends / Account cross-fade beneath it instead
 * of re-entering with each one.
 *
 * It floats rather than taking a row of its own, matching how the hub's tray
 * reads, and carries no background of its own so the felt shows through. The
 * screens underneath pay for it with `dockClearance` padding, so nothing ends
 * up stranded behind the tray.
 *
 * Home is not in this set — the hub draws its own dock inside its measured
 * budget, above its ad strip. See `stackShowsDock`.
 *
 * HomeScreen decides what its dock shows from its own hooks; this wrapper does
 * the same job for the tab screens, which have no such state of their own.
 */

import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HomeDock } from "./HomeDock";
import { stillDieColors } from "./DieStill";
import { incomingRequests, onlineFriendCount } from "../lib/friendship";
import { activeTabFor, dockClearance, dockTrayHeight, tabNavOp, DOCK_PAD } from "../lib/tabs";
import type { TabName } from "../lib/tabs";
import { useLayout } from "../lib/useLayout";
import { resolveBoardTheme } from "../render/boardThemes";
import { resolveDiceSkin } from "../render/diceSkins";
import { useFriends } from "../store/friendsStore";
import { useNav, type ScreenName } from "../store/navStore";
import { useProfile } from "../store/profileStore";
import { useSettings } from "../store/settingsStore";
import { space } from "../theme";

/**
 * Apply a dock press. Which stack move it is depends on where you are — see
 * `tabNavOp`; the point is that hopping between doorways never stacks them.
 */
export function goToTab(target: TabName): void {
  go(useNav.getState().stack[useNav.getState().stack.length - 1]!.name, target);
}

function go(current: ScreenName, target: TabName): void {
  const nav = useNav.getState();
  const move = tabNavOp(current, target);
  if (move.op === "push") nav.push(move.name);
  else if (move.op === "replace") nav.replace(move.name);
  else if (move.op === "popTo") nav.popTo(move.name);
}

/**
 * Bottom padding a tab screen must add so its last row clears the floating
 * tray. Screens ask for this rather than hard-coding a number, so the dock's
 * height and the room made for it can never drift apart.
 */
export function useDockClearance(): number {
  const { scale } = useLayout();
  const insets = useSafeAreaInsets();
  return dockClearance(scale, insets.bottom);
}

export function TabDock({ current }: { current: ScreenName }) {
  const { scale } = useLayout();
  const insets = useSafeAreaInsets();

  const boardTheme = resolveBoardTheme(useSettings((s) => s.boardThemeId));
  const diceSkin = resolveDiceSkin(useProfile((s) => s.diceSkinId));

  const friendships = useFriends((s) => s.friendships);
  const myUserId = useFriends((s) => s.userId);
  const presence = useFriends((s) => s.presence);
  const requestCount = incomingRequests(friendships, myUserId).length;
  const onlineCount = onlineFriendCount(friendships, myUserId, presence, Date.now());

  return (
    // box-none: the padded frame spans the full width, so it must let taps
    // through to the screen everywhere except on the tray itself.
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: space.lg,
        paddingTop: DOCK_PAD,
        paddingBottom: Math.max(insets.bottom, DOCK_PAD),
      }}
    >
      <HomeDock
        onHome={() => go(current, "home")}
        onShop={() => go(current, "shop")}
        onFriends={() => go(current, "friends")}
        onAccount={() => go(current, "account")}
        requestCount={requestCount}
        onlineCount={onlineCount}
        equipped={stillDieColors(diceSkin, boardTheme)}
        height={dockTrayHeight(scale)}
        active={activeTabFor(current)}
      />
    </View>
  );
}
