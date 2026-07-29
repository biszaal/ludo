/**
 * Add a friend, two ways.
 *
 * 1. Friend codes — your own is always on screen to copy or share (sharing is
 *    the growth loop, and it works outside the app), and there's a field to
 *    enter someone else's. Codes are unguessable capabilities, so unlike a name
 *    directory they give spammers no entry point.
 * 2. Recently played with — opponents from your last games who aren't already
 *    friends. Server-filtered: hidden bots are stripped before this list is
 *    returned, because the client cannot see which seats were bots (0009).
 *
 * Deliberately no search-by-name: it's the one discovery path that turns the
 * profile directory into a targeting tool.
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
import { useNav } from "../store/navStore";
import { lookupFriendCode, type Profile } from "../net/api";
import { tapLight } from "../lib/haptics";
import { playSound } from "../lib/sound";
import { font, palette, radius, space } from "../theme";

const CODE_LENGTH = 6;

export function AddFriendScreen() {
  const pop = useNav((s) => s.pop);
  const myCode = useFriends((s) => s.myCode);
  const recentPlayers = useFriends((s) => s.recentPlayers);
  const sendRequest = useFriends((s) => s.sendRequest);
  const viewPlayer = useFriends((s) => s.viewPlayer);

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
      await Share.share({ message: `Add me on Ludo — my friend code is ${myCode}` });
    } catch {
      // user dismissed the sheet; nothing to report
    }
  };

  const onLookup = async () => {
    const code = entry.trim().toUpperCase();
    if (code.length !== CODE_LENGTH) return;
    setLooking(true);
    setError(null);
    setFound(null);
    try {
      const { user } = await lookupFriendCode(code);
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
          <SectionLabel>YOUR CODE</SectionLabel>
          <Surface3D faceStyle={{ padding: space.lg, gap: space.md, alignItems: "center" }}>
            {myCode ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Copy your friend code" onPress={() => void onCopy()}>
                <Text style={{ fontFamily: font.mono, fontSize: 30, color: palette.porcelain, letterSpacing: 6 }}>
                  {myCode}
                </Text>
              </Pressable>
            ) : (
              <ActivityIndicator color={palette.mutedSteel} />
            )}
            <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel, textAlign: "center" }}>
              {copied ? "Copied!" : "Share this so friends can add you."}
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

        {/* Enter a code */}
        <View style={{ gap: space.sm }}>
          <SectionLabel>ENTER A CODE</SectionLabel>
          <Surface3D faceStyle={{ padding: space.lg, gap: space.md }}>
            <TextInput
              value={entry}
              onChangeText={(t) => {
                setEntry(t.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH));
                setError(null);
                setFound(null);
              }}
              placeholder="ABC123"
              placeholderTextColor={palette.mutedSteel}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={CODE_LENGTH}
              returnKeyType="search"
              onSubmitEditing={() => void onLookup()}
              accessibilityLabel="Friend code"
              style={{
                fontFamily: font.mono,
                fontSize: 22,
                letterSpacing: 6,
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
              disabled={looking || entry.length !== CODE_LENGTH}
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
