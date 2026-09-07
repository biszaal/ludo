/**
 * In-room chat: recent messages, quick-message chips, and a short free-text
 * input. Everything is ephemeral broadcast — nothing is stored, so the list
 * only holds what arrived while you were in the room.
 */

import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { QUICK_MESSAGES, displayPhrase } from "../lib/chatPhrases";
import { useT } from "../i18n";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { Easing, FadeIn, FadeOut, SlideInDown, SlideOutDown } from "react-native-reanimated";
import { Button } from "./Button";
import type { ChatEvent } from "../store/onlineStore";
import { depth, font, palette, radius, space } from "../theme";


interface ChatSheetProps {
  events: ChatEvent[];
  /** Display name for a sender user_id ("You" for the local player). */
  nameForUser: (userId: string) => string;
  myUserId: string | null;
  onSend: (text: string) => void;
  /** Block the sender and file a report about this message. */
  onReport: (userId: string, message: string) => void;
  onClose: () => void;
}

export function ChatSheet({ events, nameForUser, myUserId, onSend, onReport, onClose }: ChatSheetProps) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const messages = events.filter((e) => e.kind === "text");

  const send = (text: string) => {
    onSend(text);
    setDraft("");
  };

  /**
   * Long-press someone else's message to block and report them.
   *
   * One action, not two. Someone who has just been abused wants it to stop —
   * offering "Block" and "Report" separately makes them do the reporting work
   * to get the silence, and most people take the silence and skip the report,
   * which is how a moderation queue ends up empty while players leave.
   *
   * The confirm spells out that it takes effect now, because it does: the store
   * mutes locally before the request goes out.
   */
  const confirmReport = (userId: string, name: string, message: string) => {
    Alert.alert(
      `Block ${name}?`,
      t("chat.blockBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("friends.blockAndReport"), style: "destructive", onPress: () => onReport(userId, message) },
      ],
    );
  };

  return (
    <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 30 }}>
      <Animated.View
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(160)}
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(20,23,28,0.6)" }}
      >
        <Pressable accessibilityLabel={t("chat.close")} style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>

      {/* Same reasoning as Sheet.tsx: RN's implementation is a no-op on Android
          now that edge-to-edge stops the window resizing, which left the chat
          composer under the keyboard. */}
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: "flex-end" }} pointerEvents="box-none">
        <Animated.View
          entering={SlideInDown.duration(260).easing(Easing.out(Easing.cubic))}
          exiting={SlideOutDown.duration(180)}
          style={{
            backgroundColor: palette.raisedSlate,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            borderWidth: 1,
            borderColor: palette.hairline,
            borderTopColor: depth.highlight,
            paddingHorizontal: space.xl,
            paddingTop: space.lg,
            paddingBottom: space.xl,
            gap: space.md,
            shadowColor: "#000",
            shadowOpacity: 0.4,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: -6 },
            elevation: 12,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontFamily: font.display, fontSize: 20, color: palette.porcelain }}>Chat</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t("chat.close")} onPress={onClose} hitSlop={8}>
              <Text style={{ fontFamily: font.semibold, fontSize: 22, color: palette.mutedSteel }}>×</Text>
            </Pressable>
          </View>

          {messages.length > 0 ? (
            <ScrollView style={{ maxHeight: 220 }} contentContainerStyle={{ gap: space.xs }}>
              {messages.map((m) => {
                const own = m.fromUserId === myUserId;
                const name = nameForUser(m.fromUserId);
                return (
                  <Pressable
                    key={m.id}
                    // Own messages have nothing to report, so they stay inert.
                    onLongPress={own ? undefined : () => confirmReport(m.fromUserId, name, m.value)}
                    delayLongPress={350}
                    accessibilityRole={own ? undefined : "button"}
                    accessibilityHint={own ? undefined : `Hold to block and report ${name}`}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      gap: space.sm,
                      alignItems: "baseline",
                      opacity: pressed && !own ? 0.6 : 1,
                    })}
                  >
                    <Text style={{ fontFamily: font.semibold, fontSize: 13, color: own ? palette.porcelain : palette.mutedSteel }}>
                      {name}
                    </Text>
                    <Text style={{ flex: 1, fontFamily: font.regular, fontSize: 15, color: palette.porcelain }}>{displayPhrase(m.value)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : (
            <Text style={{ fontFamily: font.regular, fontSize: 14, color: palette.mutedSteel }}>
              Say hi — messages stay in this room.
            </Text>
          )}

          {/* A long-press is invisible unless it is named. Only shown once there
              is somebody else's message to actually hold. */}
          {messages.some((m) => m.fromUserId !== myUserId) ? (
            <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>
              Hold a message to block and report it.
            </Text>
          ) : null}

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {QUICK_MESSAGES.map((q) => (
              <Pressable
                key={q}
                accessibilityRole="button"
                accessibilityLabel={displayPhrase(q)}
                onPress={() => send(q)}
                style={({ pressed }) => ({
                  paddingHorizontal: space.md,
                  paddingVertical: space.sm,
                  borderRadius: radius.pill,
                  backgroundColor: palette.liftedSlate,
                  borderTopWidth: 1,
                  borderTopColor: depth.highlight,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text style={{ fontFamily: font.medium, fontSize: 14, color: palette.porcelain }}>{displayPhrase(q)}</Text>
              </Pressable>
            ))}
          </View>

          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
            <TextInput
              accessibilityLabel={t("chat.message")}
              value={draft}
              onChangeText={setDraft}
              placeholder={t("chat.messagePlaceholder")}
              placeholderTextColor={palette.mutedSteel}
              maxLength={80}
              returnKeyType="send"
              onSubmitEditing={() => draft.trim() && send(draft)}
              style={{
                flex: 1,
                minHeight: 48,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: palette.hairline,
                paddingHorizontal: space.md,
                color: palette.porcelain,
                fontFamily: font.regular,
                fontSize: 15,
              }}
            />
            <View style={{ width: 96 }}>
              <Button label="Send" onPress={() => draft.trim() && send(draft)} disabled={draft.trim().length === 0} />
            </View>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}
