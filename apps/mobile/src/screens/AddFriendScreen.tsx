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
import { ActivityIndicator, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { TableBackground } from "../components/TableBackground";
import { Button } from "../components/Button";
import { Surface3D } from "../components/Surface3D";
import { AvatarGlyph } from "../components/Avatar";
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.tableBlue }}>
      <TableBackground />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.xl, paddingTop: space.sm }}>
        <Text style={{ fontFamily: font.display, fontSize: 22, color: palette.porcelain }}>Add a friend</Text>
        <Button label="Back" onPress={pop} variant="ghost" />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
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
            {myCode ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Copy your friend code" onPress={() => void onCopy()}>
                <Text style={{ fontFamily: font.mono, fontSize: 20, color: palette.mutedSteel, letterSpacing: 5 }}>
                  {myCode}
                </Text>
              </Pressable>
            ) : (
              <ActivityIndicator color={palette.mutedSteel} />
            )}
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
        {recentPlayers.length > 0 ? (
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
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel, letterSpacing: 0.5 }}>
      {children}
    </Text>
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
        <View style={{ width: 84 }}>
          <Button label="Add" onPress={onAdd} />
        </View>
      )}
    </Surface3D>
  );
}
