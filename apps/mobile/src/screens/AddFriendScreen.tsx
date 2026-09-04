/**
 * Add a friend, three ways.
 *
 * 1. By username — one exact, case-insensitive match, resolved server-side
 *    (opFriendSearch). Exact-only is the point: you have to already know the
 *    name, so this is a lookup, not a browsable directory. 0015 originally
 *    refused name search for that reason, but the guard was never real —
 *    profiles is world-readable to any signed-in client — so the search now
 *    lives where the throttle, block check and bot filter can be applied.
 * 2. Friend codes — your own is always on screen to copy or share (sharing is
 *    the growth loop, and it works outside the app). Still useful for players
 *    who haven't picked a name yet.
 * 3. Recently played with — opponents from your last games who aren't already
 *    friends. Server-filtered: hidden bots are stripped before this list is
 *    returned, because the client cannot see which seats were bots (0009).
 *
 * The lookup field takes either: input shaped exactly like a 6-char code is
 * tried as one first, then falls back to a name. One field, because a player
 * handed "ABC123" shouldn't have to know which kind of thing it is.
 */

import { useEffect, useState } from "react";
import { Pressable, Share, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { TableBackground } from "../components/TableBackground";
import { Button } from "../components/Button";
import { Surface3D } from "../components/Surface3D";
import { AvatarGlyph } from "../components/Avatar";
import { SectionLabel } from "../components/SectionLabel";
import { SkeletonBlock, SkeletonGroup, SkeletonLine } from "../components/Skeleton";
import { useLoadPhase } from "../lib/useLoadPhase";
import { useFriends } from "../store/friendsStore";
import { useProfile } from "../store/profileStore";
import { useNav } from "../store/navStore";
import { lookupFriendCode, searchPlayerByName, type Profile } from "../net/api";
import { tapLight } from "../lib/haptics";
import { playSound } from "../lib/sound";
import { font, palette, radius, space } from "../theme";

const MAX_NAME_LENGTH = 20;
/** The friend-code alphabet (0015): no O/0/I/1. Input matching this exactly is
 *  worth trying as a code before treating it as a name. */
const CODE_SHAPE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export function AddFriendScreen() {
  const pop = useNav((s) => s.pop);
  const myCode = useFriends((s) => s.myCode);
  const recentPlayers = useFriends((s) => s.recentPlayers);
  const recentLoaded = useFriends((s) => s.recentLoaded);
  const sendRequest = useFriends((s) => s.sendRequest);
  const viewPlayer = useFriends((s) => s.viewPlayer);
  const displayName = useProfile((s) => s.displayName);

  const [entry, setEntry] = useState("");
  const [looking, setLooking] = useState(false);
  const [found, setFound] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sentTo, setSentTo] = useState<string[]>([]);

  useEffect(() => {
    void useFriends.getState().loadMyCode();
    void useFriends.getState().loadRecentPlayers();
  }, []);

  const onCopy = async () => {
    if (!myCode) return;
    tapLight();
    await Clipboard.setStringAsync(myCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const onShare = async () => {
    if (!myCode) return;
    tapLight();
    try {
      await Share.share({ message: `Add me on Ludo — I'm ${displayName} (friend code ${myCode})` });
    } catch {
      // user dismissed the sheet; nothing to report
    }
  };

  const onLookup = async () => {
    const raw = entry.trim();
    if (raw.length === 0) return;
    setLooking(true);
    setError(null);
    setFound(null);
    try {
      // Code-shaped input is tried as a code first. A miss falls through to a
      // name search, because a 6-character username is perfectly legal and
      // would otherwise be unreachable.
      if (CODE_SHAPE.test(raw.toUpperCase())) {
        try {
          const { user } = await lookupFriendCode(raw.toUpperCase());
          setFound(user);
          playSound("pop");
          return;
        } catch {
          // fall through to the name search
        }
      }
      const { user } = await searchPlayerByName(raw);
      setFound(user);
      playSound("pop");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't look that up.");
    } finally {
      setLooking(false);
    }
  };

  const onAdd = async (userId: string) => {
    setSentTo((prev) => [...prev, userId]);
    try {
      await sendRequest(userId);
    } catch (e) {
      setSentTo((prev) => prev.filter((id) => id !== userId));
      setError(e instanceof Error ? e.message : "Couldn't send that request.");
    }
  };

  // Two independent waits on one screen. Neither has anything to retry against
  // here — the code is fetched once and the recents section is optional — so
  // both simply resolve or quietly stay away.
  const codeView = useLoadPhase(!!myCode, false);
  const recentView = useLoadPhase(recentLoaded, false);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.tableBlue }}>
      <TableBackground />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.xl, paddingTop: space.sm }}>
        <Text style={{ fontFamily: font.display, fontSize: 22, color: palette.porcelain }}>Add a friend</Text>
        <Button label="Back" onPress={pop} variant="ghost" />
      </View>

      {/* Keyboard-aware because Android stopped resizing the window for the
          IME (see Sheet.tsx): a plain ScrollView never learned the keyboard was
          there, so the username field it scrolls to was left underneath it.
          bottomOffset keeps a little air between the field and the keys. */}
      <KeyboardAwareScrollView
        keyboardShouldPersistTaps="handled"
        bottomOffset={space.xl}
        contentContainerStyle={{ paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.xxl, gap: space.xl }}
      >
        {/* Your code */}
        <View style={{ gap: space.sm }}>
          <SectionLabel>HOW FRIENDS FIND YOU</SectionLabel>
          <Surface3D faceStyle={{ padding: space.lg, gap: space.md, alignItems: "center" }}>
            {/* The username leads: it's what people actually remember, and the
                code is the fallback for anyone still on a guest handle. */}
            <Text style={{ fontFamily: font.display, fontSize: 24, color: palette.porcelain }} numberOfLines={1}>
              {displayName}
            </Text>
            {/* `stalled` falls through to null, and that absence is the whole
                treatment. The username above is how friends actually find you
                and the line below documents the code as the fallback, so the
                card stays fully usable without it; getMyFriendCode swallows its
                error and loadMyCode only ever stores a code it got, so there is
                no loader here to retry against; and a block that shimmers
                forever is worse than one that is simply not there. */}
            {myCode ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Copy your friend code" onPress={() => void onCopy()}>
                <Text style={{ fontFamily: font.mono, fontSize: 20, color: palette.mutedSteel, letterSpacing: 5 }}>
                  {myCode}
                </Text>
              </Pressable>
            ) : codeView === "skeleton" ? (
              <SkeletonGroup label="Loading your friend code">
                {/* Six mono glyphs at 20pt plus five 5pt gaps — the width the
                    real code occupies, so nothing shifts when it lands. */}
                <SkeletonBlock width={97} height={20} rad={4} />
              </SkeletonGroup>
            ) : null}
            <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel, textAlign: "center" }}>
              {copied ? "Copied!" : "Friends can search your username, or use the code."}
            </Text>
            <View style={{ flexDirection: "row", gap: space.md, alignSelf: "stretch" }}>
              <View style={{ flex: 1 }}>
                <Button label="Copy" variant="ghost" onPress={() => void onCopy()} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Share" onPress={() => void onShare()} />
              </View>
            </View>
          </Surface3D>
        </View>

        {/* Find a player: username or code, one field */}
        <View style={{ gap: space.sm }}>
          <SectionLabel>FIND A PLAYER</SectionLabel>
          <Surface3D faceStyle={{ padding: space.lg, gap: space.md }}>
            <TextInput
              value={entry}
              onChangeText={(t) => {
                // Usernames are free-form, so no uppercasing and no stripping
                // here — that treatment belonged to a code-only field and would
                // mangle every name typed into it. The code path uppercases at
                // lookup time instead.
                setEntry(t.slice(0, MAX_NAME_LENGTH));
                setError(null);
                setFound(null);
              }}
              placeholder="Username or code"
              placeholderTextColor={palette.mutedSteel}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={MAX_NAME_LENGTH}
              returnKeyType="search"
              onSubmitEditing={() => void onLookup()}
              accessibilityLabel="Username or friend code"
              style={{
                fontFamily: font.regular,
                fontSize: 17,
                textAlign: "center",
                color: palette.porcelain,
                backgroundColor: palette.feltCharcoal,
                borderRadius: radius.sm,
                borderWidth: 1,
                borderColor: palette.hairline,
                paddingVertical: space.md,
              }}
            />
            <Button
              label={looking ? "Looking…" : "Find player"}
              onPress={() => void onLookup()}
              disabled={looking || entry.trim().length === 0}
            />
            {error ? (
              <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel, textAlign: "center" }}>
                {error}
              </Text>
            ) : null}
            {found ? (
              <PlayerRow
                profile={found}
                sent={sentTo.includes(found.user_id)}
                onAdd={() => void onAdd(found.user_id)}
                onOpen={() => void viewPlayer(found.user_id)}
              />
            ) : null}
          </Surface3D>
        </View>

        {/* Recently played with */}
        {recentView === "skeleton" ? (
          <View style={{ gap: space.sm }}>
            <SectionLabel>RECENTLY PLAYED WITH</SectionLabel>
            <SkeletonGroup label="Loading players you've played with" style={{ gap: space.sm }}>
              {[0, 1].map((i) => (
                // Geometry copied from <PlayerRow> at the bottom of this file:
                // edge={2}, padding space.md, a 36pt avatar, ONE 15pt name
                // line, and an "Add" chip at a compact Button's TOTAL height —
                // 44, its 40pt face plus depth.edge (4). Standing in at 40
                // would shift the row the moment the real chip lands.
                <Surface3D
                  key={`sk-${i}`}
                  edge={2}
                  faceStyle={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md }}
                >
                  <SkeletonBlock width={36} height={36} rad={radius.pill} index={i} />
                  <View style={{ flex: 1 }}>
                    <SkeletonLine width="55%" size={15} index={i} />
                  </View>
                  <SkeletonBlock width={52} height={44} rad={radius.md} index={i + 1} />
                </Surface3D>
              ))}
            </SkeletonGroup>
          </View>
        ) : recentPlayers.length > 0 ? (
          <View style={{ gap: space.sm }}>
            <SectionLabel>RECENTLY PLAYED WITH</SectionLabel>
            {recentPlayers.map((p) => (
              <PlayerRow
                key={p.user_id}
                profile={p}
                sent={sentTo.includes(p.user_id)}
                onAdd={() => void onAdd(p.user_id)}
                onOpen={() => void viewPlayer(p.user_id)}
              />
            ))}
          </View>
        ) : null}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

function PlayerRow({
  profile,
  sent,
  onAdd,
  onOpen,
}: {
  profile: Profile;
  sent: boolean;
  onAdd: () => void;
  onOpen: () => void;
}) {
  return (
    <Surface3D edge={2} faceStyle={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${profile.display_name}'s profile`}
        onPress={onOpen}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, flex: 1, opacity: pressed ? 0.85 : 1 })}
      >
        <AvatarGlyph id={profile.avatar_id} size={36} />
        <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 15, color: palette.porcelain }} numberOfLines={1}>
          {profile.display_name}
        </Text>
      </Pressable>
      {sent ? (
        <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel, paddingHorizontal: space.sm }}>
          Sent
        </Text>
      ) : (
        // Row scale, sized to its own label: a page-scale button boxed to a
        // fixed width wraps "Add" mid-word as soon as text scaling kicks in.
        <Button compact label="Add" onPress={onAdd} />
      )}
    </Surface3D>
  );
}
