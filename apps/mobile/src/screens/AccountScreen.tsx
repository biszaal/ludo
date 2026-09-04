/**
 * Account — who you are and how your progress is kept: display name, the
 * optional save/sign-in that makes coins/gems/cosmetics survive a reinstall,
 * account deletion, and your play stats below.
 *
 * Reached from the Home dock (where Stats used to be). Play stays guest-first —
 * nothing here forces a login. Your LOOK (avatar/board/dice) is edited on the
 * Profile screen; this screen owns identity + account + stats, and links across
 * to the look rather than duplicating it.
 *
 * The page is a stack of labelled trays, one job each: WHO (avatar, name, the
 * doorway to your look) · USERNAME (only when there is a name to claim or
 * change) · ACCOUNT (save / sign in / sign out) · TOTALS · RECENT · the
 * destructive row, alone at the bottom. Delete used to share a card with Save
 * account and Sign in, which put an irreversible action a thumb-width from the
 * two most-pressed buttons on the screen.
 *
 * The name saves instantly; it falls back to this device's guest handle when
 * cleared. The input is a local draft so the store's fallback never overwrites
 * a field you just cleared. Registered names are unique server-side; a debounced
 * lookup warns when the name is already taken.
 *
 * Usernames change ONCE per account (0030), because they are how other players
 * find you. Three consequences for this screen:
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
 *  - Once it is spent there is no field to show. A read-only box holding the
 *    name already printed above it is a control that does nothing — the spent
 *    allowance is a one-line note under the name instead.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { TableBackground } from "../components/TableBackground";
import { ScreenHeader } from "../components/ScreenHeader";
import { useDockClearance } from "../components/TabDock";
import { ContentColumn } from "../components/ContentColumn";
import { SectionLabel } from "../components/SectionLabel";
import { Surface3D } from "../components/Surface3D";
import { Field } from "../components/Field";
import { Button } from "../components/Button";
import { AvatarGlyph } from "../components/Avatar";
import { ChevronGlyph } from "../components/HomeGlyphs";
import { CoinsPill } from "../components/CoinsPill";
import { GemsPill } from "../components/GemsPill";
import { AccountSheet } from "../components/AccountSheet";
import { StatsContent } from "../components/StatsContent";
import { getMyProfile, isNameTaken, type MyProfile } from "../net/api";
import { deleteAccount, getIdentity, signOutToGuest, type AuthIdentity } from "../lib/auth";
import { useNav } from "../store/navStore";
import { MAX_NAME_LENGTH, useProfile } from "../store/profileStore";
import { confirm } from "../store/confirmStore";
import { font, palette, radius, space, teamColor } from "../theme";

const NAME_CHECK_DEBOUNCE_MS = 600;

/** How close to the bottom counts as "reached the end" — one row's worth, so
 *  the next page of history is revealed just before it is needed. */
const END_REACH_SLOP = 96;

/** Mirrors makeGuestName() and 0030's trigger: renaming off one of these is
 *  the initial pick, not a change, and must not spend the allowance. */
const GUEST_NAME = /^guest[0-9]{6}$/;

export function AccountScreen() {
  const displayName = useProfile((s) => s.displayName);
  const guestName = useProfile((s) => s.guestName);
  const avatarId = useProfile((s) => s.avatarId);
  const setName = useProfile((s) => s.setName);
  const push = useNav((s) => s.push);
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

  const onDeleteAccount = useCallback(() => {
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
    })();
  }, [refreshIdentity]);

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

  /** Match history pages in as you reach the bottom. Edge-triggered: the tick
   *  rises once per ARRIVAL at the end, not once per scroll frame, so a page
   *  is revealed, the content grows past the slop, and the next scroll is what
   *  asks for the one after. Holding at the bottom never runs the list out. */
  const [loadMoreSignal, setLoadMoreSignal] = useState(0);
  /** Where the last scroll event left us. KeyboardAwareScrollView pins
   *  scrollEventThrottle to 16 for its own use, so this runs per frame while
   *  dragging — a comparison and a ref write, nothing that touches state
   *  unless the edge is actually crossed. */
  const atEnd = useRef(false);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const near = contentOffset.y + layoutMeasurement.height >= contentSize.height - END_REACH_SLOP;
    if (near && !atEnd.current) setLoadMoreSignal((n) => n + 1);
    atEnd.current = near;
  }, []);

  const dockPad = useDockClearance();
  const signedIn = !!identity && !identity.isGuest;

  // No bottom edge: the dock floats over this screen and pays that inset
  // itself. The scroll content buys its own room back with dockClearance.
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: palette.tableBlue }}>
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

      {/* Keyboard-aware: the display-name field lives in here, and Android no
          longer resizes the window for the IME (see Sheet.tsx). */}
      <KeyboardAwareScrollView
        keyboardShouldPersistTaps="handled"
        bottomOffset={space.xl}
        onScroll={onScroll}
        contentContainerStyle={{ paddingTop: space.lg, paddingBottom: space.xxl + dockPad, alignItems: "center" }}
      >
        <ContentColumn style={{ paddingHorizontal: space.xl, gap: space.xl }}>
          {/* Who you are — the page's one unlabelled tray, and the doorway to
              the look that the rest of the app shows alongside this name. */}
          <Surface3D rad={radius.lg} faceStyle={{ paddingHorizontal: space.lg }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg, paddingVertical: space.lg }}>
              <AvatarGlyph id={avatarId} size={64} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontFamily: font.display, fontSize: 20, color: palette.porcelain }}>{displayName}</Text>
                <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
                  Shown to friends in online rooms.
                </Text>
                {nameLocked ? (
                  <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
                    Usernames change once, and you've used yours.
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={{ height: 1, backgroundColor: palette.hairline }} />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Change your look"
              onPress={() => push("profile")}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                minHeight: 52,
                gap: space.md,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontFamily: font.medium, fontSize: 16, color: palette.porcelain }}>Change your look</Text>
                <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
                  Avatar, board and dice
                </Text>
              </View>
              <ChevronGlyph size={16} />
            </Pressable>
          </Surface3D>

          {/* Username — only while there is one to claim or change. Once the
              allowance is spent the note under your name says everything a
              read-only field would have, without pretending to be editable. */}
          {nameLocked ? null : (
            <View style={{ gap: space.sm }}>
              <SectionLabel>Username</SectionLabel>
              <Surface3D rad={radius.lg} faceStyle={{ padding: space.lg, gap: space.md }}>
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
              </Surface3D>
            </View>
          )}

          {/* Account: optional — guests keep playing without it. */}
          <View style={{ gap: space.sm }}>
            <SectionLabel>Account</SectionLabel>
            <Surface3D rad={radius.lg} faceStyle={{ padding: space.lg, gap: space.md }}>
              {signedIn ? (
                <>
                  {/* The email can be null — an Apple link makes an account
                      recoverable without ever handing us an address. */}
                  <Text style={{ fontFamily: font.medium, fontSize: 15, color: palette.porcelain }}>
                    {identity?.email ? `Signed in as ${identity.email}` : "Signed in"}
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
            </Surface3D>
          </View>

          {/* Stats below */}
          <StatsContent loadMoreSignal={loadMoreSignal} />

          {/* The one irreversible action on the screen, alone at the bottom
              where nothing is pressed by accident on the way past. */}
          <Surface3D rad={radius.lg} faceStyle={{ paddingHorizontal: space.lg }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete account and data"
              onPress={onDeleteAccount}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                minHeight: 52,
                gap: space.md,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontFamily: font.medium, fontSize: 16, color: teamColor.red }}>Delete account</Text>
                <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
                  Removes your coins, gems, cosmetics and friends for good.
                </Text>
              </View>
              {/* No chevron. This row does not go anywhere — it raises a
                  confirmation — and borrowing the navigation mark for the one
                  irreversible action on the screen invites a casual press. */}
            </Pressable>
          </Surface3D>
        </ContentColumn>
      </KeyboardAwareScrollView>

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
