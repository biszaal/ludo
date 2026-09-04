/**
 * Another player's public profile: who they are, whether they're around, and
 * what you can do about it (add / invite / unfriend / block).
 *
 * The record shows games played and games WON — never a loss count. In a party
 * game a visible "2 wins, 31 losses" is a churn driver and an argument for
 * sandbagging, and it's hidden entirely below MIN_GAMES_FOR_RECORD so a new
 * player doesn't read as empty.
 *
 * Only online games count, because only they reach the server (0016): local AI
 * and pass-and-play never leave the device. The label says so rather than
 * quietly disagreeing with the player's own stats screen.
 */

import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TableBackground } from "../components/TableBackground";
import { Button } from "../components/Button";
import { Surface3D } from "../components/Surface3D";
import { AvatarGlyph } from "../components/Avatar";
import { PresenceDot } from "../components/PresenceDot";
import { useFriends } from "../store/friendsStore";
import { useOnlineStore } from "../store/onlineStore";
import { useNav } from "../store/navStore";
import { confirm, type ConfirmRequest } from "../store/confirmStore";
import { formatRecord, isOnline, relationshipTo } from "../lib/friendship";
import { SkeletonBlock, SkeletonGroup, SkeletonLine } from "../components/Skeleton";
import { LoadFailed } from "../components/LoadFailed";
import { useLoadPhase } from "../lib/useLoadPhase";
import { font, palette, radius, space } from "../theme";

export function PlayerProfileScreen() {
  const pop = useNav((s) => s.pop);
  const userId = useFriends((s) => s.viewingUserId);
  const profiles = useFriends((s) => s.profiles);
  const stats = useFriends((s) => s.stats);
  const presence = useFriends((s) => s.presence);
  const friendships = useFriends((s) => s.friendships);
  const me = useFriends((s) => s.userId);
  const sendRequest = useFriends((s) => s.sendRequest);
  const viewPlayer = useFriends((s) => s.viewPlayer);
  const accept = useFriends((s) => s.accept);
  const remove = useFriends((s) => s.remove);
  const block = useFriends((s) => s.block);
  const inviteToRoom = useFriends((s) => s.inviteToRoom);
  const stake = useOnlineStore((s) => s.stake);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roomCode = useOnlineStore((s) => s.roomCode);
  const onlineStatus = useOnlineStore((s) => s.status);
  const canInvite = !!roomCode && (onlineStatus === "lobby" || onlineStatus === "active");

  useEffect(() => {
    if (!userId) pop(); // opened without a target (e.g. state cleared) — bail out
  }, [userId, pop]);

  const profile = userId ? profiles[userId] : undefined;
  // viewPlayer navigates first and fetches second, so a stranger reached by
  // friend code has no cached card — and the fallback name is someone else's.
  // Above the bail-out below, because a hook that only sometimes runs is a
  // crash the first time this screen is opened without a target.
  const view = useLoadPhase(!!profile, false);

  if (!userId) return null;

  const name = profile?.display_name ?? "Ludo player";
  const record = stats[userId] ? formatRecord(stats[userId]!.games_played, stats[userId]!.games_won) : null;
  // Derived from the subscribed rows, not getState(): accepting a request has
  // to flip these buttons without needing a remount.
  const rel = relationshipTo(friendships, me, userId);
  const online = isOnline(presence[userId], Date.now());
  const known = me != null && rel.kind !== "none";

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  /** Ask first, then run. Every action on this screen is one a mis-tap should
   *  not be able to complete — they all sever something. */
  const confirmThen = async (request: ConfirmRequest, fn: () => Promise<void>) => {
    if (await confirm(request)) await run(fn);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.tableBlue }}>
      <TableBackground />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.xl, paddingTop: space.sm }}>
        <Text style={{ fontFamily: font.display, fontSize: 22, color: palette.porcelain }}>Profile</Text>
        <Button label="Back" onPress={pop} variant="ghost" />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.xxl, gap: space.xl }}>
        {/* Three arms, and only the third reaches the real card. `hidden` is
            blank rather than the fallback name: two frames of nothing costs
            nothing, whereas two frames of "Ludo player" names a stranger
            something they are not. `stalled` replaces the card outright — a
            profile that shimmers forever above live Add and Block buttons is
            the exact failure the stalled phase exists to end, and viewPlayer
            is the loader that did not land, so it is the one to retry. */}
        {view === "hidden" ? null : view === "stalled" ? (
          <LoadFailed
            message="We couldn't load this player. Check your connection and try again."
            onRetry={() => void viewPlayer(userId)}
          />
        ) : (
          <Surface3D faceStyle={{ padding: space.xl, gap: space.md, alignItems: "center" }}>
            {view === "skeleton" ? (
              <SkeletonGroup label="Loading this player" style={{ alignItems: "center", gap: space.md }}>
                <SkeletonBlock width={88} height={88} rad={radius.pill} index={0} />
                <SkeletonLine width={140} size={22} index={1} />
                <SkeletonLine width={72} size={13} index={2} />
              </SkeletonGroup>
            ) : (
              <>
                <View>
                  <AvatarGlyph id={profile?.avatar_id ?? "orbit-moss"} size={88} />
                  {known ? <PresenceDot online={online} size={20} /> : null}
                </View>
                <Text style={{ fontFamily: font.display, fontSize: 22, color: palette.porcelain }} numberOfLines={1}>
                  {name}
                </Text>
                {known ? (
                  <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
                    {online ? "Online now" : "Offline"}
                  </Text>
                ) : null}
              </>
            )}
          </Surface3D>
        )}

        {/* Record — hidden until there's enough of one to be worth showing. */}
        {record ? (
          <View style={{ gap: space.sm }}>
            <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel, letterSpacing: 0.5 }}>
              ONLINE RECORD
            </Text>
            <Surface3D faceStyle={{ padding: space.lg, gap: 6 }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 17, color: palette.porcelain }}>{record}</Text>
              <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>
                Online games only.
              </Text>
            </Surface3D>
          </View>
        ) : null}

        {/* Actions */}
        <View style={{ gap: space.md }}>
          {rel.kind === "none" ? (
            <Button label="Add friend" disabled={busy} onPress={() => void run(() => sendRequest(userId))} />
          ) : null}
          {rel.kind === "outgoing" ? (
            <>
              <Button label="Request sent" disabled onPress={() => {}} />
              <Button
                label="Cancel request"
                variant="ghost"
                disabled={busy}
                onPress={() =>
                  void confirmThen(
                    {
                      title: "Cancel this request?",
                      message: `${name} won't see it. You can send it again any time.`,
                      confirmLabel: "Cancel request",
                      cancelLabel: "Keep it",
                    },
                    async () => { await remove(rel.id); pop(); },
                  )
                }
              />
            </>
          ) : null}
          {rel.kind === "incoming" ? (
            <>
              <Button label="Accept request" disabled={busy} onPress={() => void run(() => accept(rel.id))} />
              <Button
                label="Ignore"
                variant="ghost"
                disabled={busy}
                onPress={() =>
                  void confirmThen(
                    {
                      title: `Ignore ${name}?`,
                      message: "Their request disappears. They can send another one later.",
                      confirmLabel: "Ignore",
                      destructive: true,
                    },
                    async () => { await remove(rel.id); pop(); },
                  )
                }
              />
            </>
          ) : null}
          {rel.kind === "friends" ? (
            <>
              {canInvite ? (
                <Button label="Invite to room" disabled={busy} onPress={() => void run(() => inviteToRoom(userId, roomCode!, stake))} />
              ) : null}
              <Button
                label="Remove friend"
                variant="ghost"
                disabled={busy}
                onPress={() =>
                  void confirmThen(
                    {
                      title: `Remove ${name}?`,
                      message:
                        "You'll both drop off each other's friends list, and you'll need their friend code to add them back.",
                      confirmLabel: "Remove",
                      destructive: true,
                    },
                    async () => { await remove(rel.id); pop(); },
                  )
                }
              />
            </>
          ) : null}

          {/* Guarded, because blocking also severs the friendship server-side
              (0015 cascade) and there is no undo in this screen. This used to
              be a bespoke "tap again to block" button — the same question the
              rest of the app now asks through one dialog. */}
          <Button
            label="Block"
            variant="ghost"
            disabled={busy}
            onPress={() =>
              void confirmThen(
                {
                  title: `Block ${name}?`,
                  message:
                    "They can't invite you, message you or send you a friend request. If you're friends, that ends too.",
                  confirmLabel: "Block",
                  destructive: true,
                },
                async () => { await block(userId); pop(); },
              )
            }
          />
        </View>

        {error ? (
          <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel, textAlign: "center" }}>
            {error}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
