/**
 * Account — who you are and how your progress is kept: display name, the
 * optional save/sign-in that makes coins/gems/cosmetics survive a reinstall,
 * account deletion, and your play stats below.
 *
 * Reached from the Home dock (where Stats used to be). Play stays guest-first —
 * nothing here forces a login. Your LOOK (avatar/board/dice) is edited on the
 * Profile screen; this screen owns identity + account + stats.
 *
 * The name saves instantly; it falls back to this device's guest handle when
 * cleared. The input is a local draft so the store's fallback never overwrites
 * a field you just cleared. Registered names are unique server-side; a debounced
 * lookup warns when the name is already taken.
 *
 * Usernames change ONCE per account (0030), because they are how other players
 * find you. Two consequences for this screen:
 *
 *  - Availability is only asked about, and only reported, for a name you are
 *    actually trying to claim — a draft that differs from the name you already
 *    hold. Checking an unedited name is what produced a false "already taken"
 *    on open, for anyone whose name sits on an orphaned row from a previous
 *    guest account. "The name you hold" is the SERVER's, since that is what
 *    other players see; the local store only stands in while that read is in
 *    flight, and reading the unknown as "" is how an untouched field used to
 *    look edited.
 *  - Claiming a name off the minted guestNNNNNN handle is free; only a real
 *    rename spends the allowance, and we say so before it is spent.
 */

import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
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
import { AccountSheet } from "../components/AccountSheet";
import { StatsContent } from "../components/StatsContent";
import { getMyProfile, isNameTaken, type MyProfile } from "../net/api";
import { deleteAccount, getIdentity, signOutToGuest, type AuthIdentity } from "../lib/auth";
import { MAX_NAME_LENGTH, useProfile } from "../store/profileStore";
import { confirm } from "../store/confirmStore";
import { font, palette, radius, space, teamColor } from "../theme";

const NAME_CHECK_DEBOUNCE_MS = 600;

/** Mirrors makeGuestName() and 0030's trigger: renaming off one of these is
 *  the initial pick, not a change, and must not spend the allowance. */
const GUEST_NAME = /^guest[0-9]{6}$/;

export function AccountScreen() {
  const displayName = useProfile((s) => s.displayName);
  const guestName = useProfile((s) => s.guestName);
  const avatarId = useProfile((s) => s.avatarId);
  const setName = useProfile((s) => s.setName);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(displayName);
  /** Whether the player has actually typed in the field. Until they have, the
   *  draft is only a mirror of the name they hold, so nothing here is a name
   *  they are "trying to claim" and nothing about availability is asked or
   *  said. A restored account is the case a plain draft-vs-name comparison
   *  misses: the local store is back to a fresh guest handle while the server
   *  still holds the real name, so the two differ with nobody having typed. */
  const [edited, setEdited] = useState(false);
  const [taken, setTaken] = useState(false);
  const [identity, setIdentity] = useState<AuthIdentity | null>(null);
  const [accountSheet, setAccountSheet] = useState<null | "save" | "signin">(null);
  /** The server's registered identity. Null while loading, offline or signed
   *  out — `currentName` stands in with the local name there, and every gate
   *  below stays permissive rather than locking the field on a failed read. */
  const [mine, setMine] = useState<MyProfile | null>(null);

  const refreshIdentity = useCallback(() => {
    void getIdentity().then(setIdentity);
  }, []);
  useEffect(() => {
    refreshIdentity();
    void getMyProfile().then(setMine);
  }, [refreshIdentity]);

  /** The name that is already yours. The server's copy is the authority, but
   *  until that read lands the local store holds the same name — and treating
   *  the unknown as "" made an untouched field look edited. Never empty:
   *  displayName falls back to this device's guest handle. */
  const currentName = mine?.displayName || displayName;
  const onGuestHandle = GUEST_NAME.test(currentName);

  // While untouched, the field just mirrors the name we hold — so the server's
  // copy landing (or the persisted store rehydrating) fills it in rather than
  // leaving a stale name behind that would read as an edit. Never over
  // something the player is in the middle of typing.
  useEffect(() => {
    if (!edited) setDraft(currentName);
  }, [edited, currentName]);

  /** Allowance is only spent once you've moved off the guest handle. */
  const nameLocked = !!mine?.nameChangedAt && !onGuestHandle;
  /** A name the player is actually trying to claim: typed by them, and
   *  different from the one they hold. Everything about the draft — the
   *  availability lookup, its warning, the save button — hangs off this. */
  const claiming = edited && draft.trim().toLowerCase() !== currentName.trim().toLowerCase();
  /** A real rename — the one that costs the allowance. */
  const spendsAllowance = claiming && !onGuestHandle && !nameLocked;

  /** Commit the first real name off this device's guest handle. Free — 0030's
   *  trigger carries name_changed_at through untouched — so no confirmation,
   *  but it is still an explicit press. Saving this one per keystroke is what
   *  spent people's allowance on a half-typed name: the debounced sync pushed
   *  "Bisha" as its own UPDATE, which left the guest handle behind, so the very
   *  next keystroke's push was a rename FROM "Bisha" and the trigger charged
   *  for it. One field, one write, one name. */
  const onClaimName = useCallback(() => {
    const next = draft.trim();
    if (next.length === 0 || taken) return;
    setName(next);
    // The allowance is untouched by a claim off the guest handle, so carry
    // nameChangedAt through rather than stamping it.
    setMine({ displayName: next, nameChangedAt: mine?.nameChangedAt ?? null });
    setEdited(false);
  }, [draft, taken, setName, mine]);

  /** Commit a real rename. Irreversible and one-per-account, so it is confirmed
   *  explicitly and names both sides — never saved out from under a keystroke. */
  const onCommitName = useCallback(() => {
    const next = draft.trim();
    if (next.length === 0 || taken) return;
    void (async () => {
      const ok = await confirm({
        title: "Change your username?",
        message: `"${currentName}" becomes "${next}". You can only do this once, so this is your last change.`,
        confirmLabel: "Change it",
        destructive: true,
      });
      if (!ok) return;
      setName(next);
      // Reflect the spend immediately; profileSync's readback is the authority
      // and will correct this if the server refused.
      setMine({ displayName: next, nameChangedAt: new Date().toISOString() });
      setEdited(false);
    })();
  }, [draft, taken, currentName, setName]);

  useEffect(() => {
    const name = draft.trim();
    // Only ever ask about a name you're actually trying to claim, and only
    // report the answer then. Checking the name you already own is what raised
    // a false "taken" the moment this screen opened: an old row of your own can
    // still carry your guest handle, and the answer is meaningless either way.
    if (name.length === 0 || !claiming) {
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
  }, [draft, claiming]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.tableBlue }}>
      <TableBackground />
      <ScreenHeader
        title="Account"
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

            {nameLocked ? (
              <>
                <View
                  style={{
                    minHeight: 56,
                    justifyContent: "center",
                    paddingHorizontal: 16,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: palette.hairline,
                    backgroundColor: palette.feltCharcoal,
                  }}
                >
                  <Text style={{ fontFamily: font.regular, fontSize: 16, color: palette.mutedSteel }}>
                    {currentName}
                  </Text>
                </View>
                <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
                  Usernames can only be changed once, and you've used yours.
                </Text>
              </>
            ) : (
              <>
                <Field
                  accessibilityLabel="Display name"
                  value={draft}
                  onChangeText={(t) => {
                    setEdited(true);
                    setDraft(t);
                  }}
                  focused={focused}
                  onFocus={() => setFocused(true)}
                  onBlur={() => {
                    setFocused(false);
                    if (draft.trim().length === 0) {
                      setDraft(currentName);
                      setEdited(false);
                    }
                  }}
                  placeholder={guestName}
                  maxLength={MAX_NAME_LENGTH}
                  autoCorrect={false}
                />

                {taken ? (
                  <Text style={{ fontFamily: font.regular, fontSize: 13, color: teamColor.red }}>
                    That name is already taken — others will keep seeing your previous one until you pick another.
                  </Text>
                ) : onGuestHandle ? (
                  <>
                    <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
                      Pick your username — friends find you by it. You can change it once after this.
                    </Text>
                    {claiming ? <Button label="Save username" onPress={onClaimName} /> : null}
                  </>
                ) : spendsAllowance ? (
                  <>
                    <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
                      You can only change your username once. This is your one change.
                    </Text>
                    <Button label="Save username" onPress={onCommitName} />
                  </>
                ) : (
                  <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
                    You can change your username once. Friends find you by it.
                  </Text>
                )}
              </>
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
                  void (async () => {
                    const ok = await confirm({
                      title: "Delete account?",
                      message:
                        "This permanently deletes your account and all data — coins, gems, purchases, cosmetics and friends. This can't be undone.",
                      confirmLabel: "Delete",
                      cancelLabel: "Keep it",
                      destructive: true,
                    });
                    if (ok) await deleteAccount().then(refreshIdentity);
                  })()
                }
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, alignSelf: "flex-start" })}
              >
                <Text style={{ fontFamily: font.medium, fontSize: 14, color: teamColor.red }}>Delete account</Text>
              </Pressable>
            </Surface3D>
          </View>

          {/* Stats below */}
          <StatsContent />
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
