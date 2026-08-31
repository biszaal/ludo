/**
 * First launch: ask what to call this player, once.
 *
 * Every device mints a `guest481920` handle and, until now, silently kept it —
 * so most players were labelled by a random number at every table and were
 * unfindable by name. This asks, once, and then never again.
 *
 * SKIPPABLE on purpose. It sits between a new player and their first game, and
 * a uniqueness check is the worst possible thing to put there — skipping keeps
 * the guest handle, which still works everywhere. Nothing is lost by skipping
 * either: claiming a name off the minted handle does not spend the one username
 * change 0030 allows, so "Maybe later" stays free for as long as they like.
 *
 * The prompt is one-time regardless of the answer — `markNamePromptSeen` runs
 * on both paths — and existing installs are migrated past it (profileStore v3),
 * so nobody mid-way through playing meets an onboarding screen after an update.
 *
 * Drawn as an overlay from App.tsx rather than as a nav screen: it is not
 * somewhere you can navigate back to, and the stack should not hold an entry
 * that can never be returned to.
 */

import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { Button } from "./Button";
import { Field } from "./Field";
import { TableBackground } from "./TableBackground";
import { ContentColumn } from "./ContentColumn";
import { claimName } from "../net/profileSync";
import { MAX_NAME_LENGTH, useProfile } from "../store/profileStore";
import { font, palette, space, teamColor } from "../theme";

/** Names must be typeable back by a friend searching for them, so the same
 *  character set the rest of the app uses for handles: letters, digits, and a
 *  couple of separators. Trimmed rather than rejected while typing. */
const clean = (raw: string): string => raw.replace(/[^A-Za-z0-9 _-]/g, "").slice(0, MAX_NAME_LENGTH);

export function ChooseNameScreen() {
  const guestName = useProfile((s) => s.guestName);
  const setName = useProfile((s) => s.setName);
  const markSeen = useProfile((s) => s.markNamePromptSeen);

  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = value.trim();
  // Two characters is the shortest thing worth searching for; the guest handle
  // is always available as the alternative, so this can afford to be strict.
  const usable = trimmed.length >= 2 && !busy;

  const confirm = async () => {
    if (!usable) return;
    setBusy(true);
    setError(null);
    const result = await claimName(trimmed);
    if (result === "taken") {
      setBusy(false);
      setError("Someone already has that name. Try another.");
      return;
    }
    // "offline" counts as done: the name is set locally and profileSync pushes
    // it when the connection returns. Holding a player at this screen because
    // the network is down would be the one thing worse than not asking at all.
    if (result === "offline") setName(trimmed);
    markSeen();
  };

  const skip = () => {
    markSeen();
  };

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: palette.tableBlue }}
    >
      <TableBackground />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }}>
          <ContentColumn style={{ flex: 1, justifyContent: "center", paddingHorizontal: space.xl, gap: space.lg }}>
            <View style={{ gap: space.sm }}>
              <Text style={{ fontFamily: font.display, fontSize: 30, color: palette.porcelain }}>
                What should we call you?
              </Text>
              <Text style={{ fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: palette.mutedSteel }}>
                This is the name other players see at the table, and how friends find you.
              </Text>
            </View>

            <View style={{ gap: space.sm }}>
              <Field
                accessibilityLabel="Your name"
                value={value}
                onChangeText={(t) => {
                  setValue(clean(t));
                  if (error) setError(null);
                }}
                placeholder={guestName}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={MAX_NAME_LENGTH}
                autoFocus
              />
              {error ? (
                <Text style={{ fontFamily: font.regular, fontSize: 13, color: teamColor.red }}>{error}</Text>
              ) : (
                <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>
                  You can change this once later, so pick one you like.
                </Text>
              )}
            </View>

            <Button label={busy ? "Saving…" : "Continue"} disabled={!usable} onPress={() => void confirm()} />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose a name later"
              onPress={skip}
              disabled={busy}
              style={({ pressed }) => ({ alignSelf: "center", opacity: pressed ? 0.7 : 1, paddingVertical: space.sm })}
            >
              <Text style={{ fontFamily: font.semibold, fontSize: 14, color: palette.mutedSteel }}>Maybe later</Text>
            </Pressable>
          </ContentColumn>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}
