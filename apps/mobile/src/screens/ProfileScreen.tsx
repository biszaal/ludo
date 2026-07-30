/**
 * Profile — your identity (display name + the look you're wearing) and the
 * Customize locker: equip the avatars, boards and dice you already own, across
 * one set of tabs, with a live preview. "Shop for more" (inside the browser)
 * bridges to the store to buy new ones.
 *
 * The name saves instantly; it falls back to this device's guest handle
 * ("guest362829") when cleared. The input is a local draft so the store's
 * fallback never overwrites a field the user just cleared. Registered names are
 * unique server-side; a debounced lookup warns when the name is already taken.
 */

import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TableBackground } from "../components/TableBackground";
import { ScreenHeader } from "../components/ScreenHeader";
import { ContentColumn } from "../components/ContentColumn";
import { SectionLabel } from "../components/SectionLabel";
import { Surface3D } from "../components/Surface3D";
import { Field } from "../components/Field";
import { Button } from "../components/Button";
import { AvatarGlyph } from "../components/Avatar";
import { CoinsPill } from "../components/CoinsPill";
import { GemsPill } from "../components/GemsPill";
import { CosmeticsBrowser } from "../components/CosmeticsBrowser";
import { AccountSheet } from "../components/AccountSheet";
import { isNameTaken } from "../net/api";
import { deleteAccount, getIdentity, signOutToGuest, type AuthIdentity } from "../lib/auth";
import { MAX_NAME_LENGTH, useProfile } from "../store/profileStore";
import { font, palette, radius, space, teamColor } from "../theme";

const NAME_CHECK_DEBOUNCE_MS = 600;

export function ProfileScreen() {
  const displayName = useProfile((s) => s.displayName);
  const guestName = useProfile((s) => s.guestName);
  const avatarId = useProfile((s) => s.avatarId);
  const setName = useProfile((s) => s.setName);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(displayName);
  const [taken, setTaken] = useState(false);
  const [identity, setIdentity] = useState<AuthIdentity | null>(null);
  const [accountSheet, setAccountSheet] = useState<null | "save" | "signin">(null);

  const refreshIdentity = useCallback(() => {
    void getIdentity().then(setIdentity);
  }, []);
  useEffect(() => {
    refreshIdentity();
  }, [refreshIdentity]);

  useEffect(() => {
    const name = draft.trim();
    if (name.length === 0) {
      setTaken(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void isNameTaken(name).then((is) => {
        if (!cancelled) setTaken(is);
      });
    }, NAME_CHECK_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.tableBlue }}>
      <TableBackground />
      <ScreenHeader
        title="Profile"
        right={
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <GemsPill compact />
            <CoinsPill compact />
          </View>
        }
      />

      <ScrollView contentContainerStyle={{ paddingTop: space.lg, paddingBottom: space.xxl, alignItems: "center" }}>
        <ContentColumn style={{ paddingHorizontal: space.xl, gap: space.xl }}>
        {/* Identity tray */}
        <Surface3D rad={radius.lg} faceStyle={{ padding: space.lg, gap: space.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
            <AvatarGlyph id={avatarId} size={72} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontFamily: font.display, fontSize: 20, color: palette.porcelain }}>{displayName}</Text>
              <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
                Shown to friends in online rooms.
              </Text>
            </View>
          </View>

          <Field
            accessibilityLabel="Display name"
            value={draft}
            onChangeText={(t) => {
              setDraft(t);
              setName(t);
            }}
            focused={focused}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              if (draft.trim().length === 0) setDraft(displayName);
            }}
            placeholder={guestName}
            maxLength={MAX_NAME_LENGTH}
            autoCorrect={false}
          />
          {taken && (
            <Text style={{ fontFamily: font.regular, fontSize: 13, color: teamColor.red }}>
              That name is already taken — others will keep seeing your previous one until you pick another.
            </Text>
          )}
        </Surface3D>

        {/* Account: optional — guests keep playing without it. */}
        <View style={{ gap: space.sm }}>
          <SectionLabel>Account</SectionLabel>
          <Surface3D rad={radius.lg} faceStyle={{ padding: space.lg, gap: space.md }}>
            {identity && !identity.isGuest ? (
              <>
                <Text style={{ fontFamily: font.medium, fontSize: 15, color: palette.porcelain }}>
                  Signed in as {identity.email}
                </Text>
                <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
                  Your coins, gems and looks are backed up to this account.
                </Text>
                <Button
                  label="Sign out"
                  variant="ghost"
                  onPress={() => void signOutToGuest().then(refreshIdentity)}
                />
              </>
            ) : (
              <>
                <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
                  You're playing as a guest. Save an account so your coins, gems and looks survive a
                  reinstall or a new phone — no account needed to keep playing.
                </Text>
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button label="Save account" onPress={() => setAccountSheet("save")} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button label="Sign in" variant="ghost" onPress={() => setAccountSheet("signin")} />
                  </View>
                </View>
              </>
            )}

            <View style={{ height: 1, backgroundColor: palette.hairline }} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete account and data"
              onPress={() =>
                Alert.alert(
                  "Delete account?",
                  "This permanently deletes your account and all data — coins, gems, purchases, cosmetics and friends. This can't be undone.",
                  [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: () => void deleteAccount().then(refreshIdentity) },
                  ],
                )
              }
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, alignSelf: "flex-start" })}
            >
              <Text style={{ fontFamily: font.medium, fontSize: 14, color: teamColor.red }}>Delete account</Text>
            </Pressable>
          </Surface3D>
        </View>

        {/* Customize: equip the avatars, boards and dice you own. */}
        <View style={{ gap: space.sm }}>
          <SectionLabel>Customize</SectionLabel>
          <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel, marginTop: -4 }}>
            Your collection. Dice show to everyone at the table when you roll.
          </Text>
          <CosmeticsBrowser mode="locker" />
        </View>
      </ContentColumn>
      </ScrollView>

      {accountSheet ? (
        <AccountSheet
          initialMode={accountSheet}
          onClose={() => {
            setAccountSheet(null);
            refreshIdentity();
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}
