/**
 * Profile — display name and avatar. Saves instantly; the name falls back to
 * "You" when cleared. The input is controlled by a local draft so the store's
 * "You" fallback never overwrites a field the user just cleared (RN pushes a
 * changed defaultValue back into the native field on re-render).
 * Avatars are drawn chips (see Avatar.tsx), never emojis.
 */

import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TableBackground } from "../components/TableBackground";
import { Button } from "../components/Button";
import { AVATARS, AvatarGlyph } from "../components/Avatar";
import { useNav } from "../store/navStore";
import { MAX_NAME_LENGTH, useProfile } from "../store/profileStore";
import { font, palette, radius, space } from "../theme";

export function ProfileScreen() {
  const displayName = useProfile((s) => s.displayName);
  const avatarId = useProfile((s) => s.avatarId);
  const setName = useProfile((s) => s.setName);
  const setAvatar = useProfile((s) => s.setAvatar);
  const pop = useNav((s) => s.pop);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(displayName);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.tableBlue }}>
      <TableBackground />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.xl, paddingTop: space.sm }}>
        <Text style={{ fontFamily: font.display, fontSize: 22, color: palette.porcelain }}>Profile</Text>
        <Button label="Back" onPress={pop} variant="ghost" />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.xxl, gap: space.xl }}>
        {/* Identity preview */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
          <AvatarGlyph id={avatarId} size={64} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontFamily: font.display, fontSize: 20, color: palette.porcelain }}>{displayName}</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>Shown to friends in online rooms.</Text>
          </View>
        </View>

        <View style={{ gap: space.sm }}>
          <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel, letterSpacing: 0.5 }}>DISPLAY NAME</Text>
          <TextInput
            accessibilityLabel="Display name"
            value={draft}
            onChangeText={(t) => {
              setDraft(t);
              setName(t);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              if (draft.trim().length === 0) setDraft(displayName);
            }}
            placeholder="You"
            placeholderTextColor={palette.mutedSteel}
            maxLength={MAX_NAME_LENGTH}
            autoCorrect={false}
            style={{
              minHeight: 56,
              borderRadius: radius.md,
              borderWidth: focused ? 1.5 : 1,
              borderColor: focused ? palette.porcelain : palette.hairline,
              backgroundColor: palette.raisedSlate,
              color: palette.porcelain,
              fontFamily: font.medium,
              fontSize: 17,
              paddingHorizontal: space.lg,
            }}
          />
        </View>

        <View style={{ gap: space.sm }}>
          <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel, letterSpacing: 0.5 }}>AVATAR</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: space.lg }}>
            {AVATARS.map((a) => {
              const selected = a.id === avatarId;
              return (
                <Pressable
                  key={a.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Avatar ${a.motif}`}
                  onPress={() => setAvatar(a.id)}
                  style={({ pressed }) => ({
                    width: "22%",
                    alignItems: "center",
                    padding: space.xs,
                    borderRadius: radius.md,
                    borderWidth: 1.5,
                    borderColor: selected ? palette.porcelain : "transparent",
                    backgroundColor: selected ? palette.raisedSlate : "transparent",
                    transform: [{ scale: pressed ? 0.94 : 1 }],
                  })}
                >
                  <AvatarGlyph id={a.id} size={56} />
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
