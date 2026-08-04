/**
 * Last line of defence against a white screen.
 *
 * Everything below this renders through Skia and Reanimated, where a single bad
 * value — a null theme after a bad config merge, a token position the layout
 * has no pixel for — throws during render. React's response to an uncaught
 * render error is to unmount the whole tree, so without a boundary the app
 * becomes a blank screen with no way back except a force-quit. That is the
 * worst review a store build can earn, and it is the one failure mode the rest
 * of the app's careful `try/catch`-and-degrade style cannot reach: render-phase
 * throws don't pass through promise handlers.
 *
 * Recovery is a remount, not a reload: `retry` bumps a key so the subtree is
 * rebuilt from scratch, and the caller drops any state that could have caused
 * the throw. Zustand stores survive, so the player keeps their profile, wallet
 * and settings — only the view is rebuilt.
 *
 * This is a class component because there is still no hook equivalent of
 * componentDidCatch.
 */

import { Component, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { TableBackground } from "./TableBackground";
import { font, palette, radius, space } from "../theme";

interface Props {
  children: ReactNode;
  /** Called before the remount, to clear state that may have caused the throw. */
  onReset?: () => void;
}

interface State {
  error: Error | null;
  /** Remount key — bumping it rebuilds the whole subtree. */
  generation: number;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, generation: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // No crash reporter wired up yet; this at least surfaces in a dev console
    // and in device logs from a release build.
    console.error("[ErrorBoundary]", error?.message, info?.componentStack ?? "");
  }

  private retry = () => {
    this.props.onReset?.();
    this.setState((s) => ({ error: null, generation: s.generation + 1 }));
  };

  render() {
    if (!this.state.error) {
      return <View key={this.state.generation} style={{ flex: 1 }}>{this.props.children}</View>;
    }

    return (
      <View style={{ flex: 1, backgroundColor: palette.tableBlue }}>
        <TableBackground />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.md }}>
          <Text style={{ fontFamily: font.display, fontSize: 24, color: palette.porcelain, textAlign: "center" }}>
            That didn't go to plan
          </Text>
          {/* Deliberately no error text: it would be a stack trace to a player,
              and it is already in the logs. */}
          <Text
            style={{
              fontFamily: font.regular,
              fontSize: 15,
              color: palette.mutedSteel,
              textAlign: "center",
              maxWidth: 300,
            }}
          >
            Something broke while drawing the screen. Your coins and profile are safe.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to the home screen"
            onPress={this.retry}
            style={({ pressed }) => ({
              marginTop: space.md,
              paddingVertical: space.md,
              paddingHorizontal: space.xxl,
              borderRadius: radius.pill,
              backgroundColor: palette.porcelain,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            })}
          >
            <Text style={{ fontFamily: font.semibold, fontSize: 16, color: palette.feltCharcoal }}>
              Back to home
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }
}
