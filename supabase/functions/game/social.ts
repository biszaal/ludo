/**
 * Friends: discovery, and account deletion.
 *
 * Most of the friends system is direct-to-table under RLS (0005) and stays that
 * way — accept/decline/cancel/unfriend are already correctly constrained and
 * expose no discovery surface. Only these four ops need service role:
 *
 *  - friendCode / friendLookup: a lookup by code must read a row the caller is
 *    not party to, and must be throttled. RLS cannot express either.
 *  - friendRequest: needs to see game_bots to set auto_decline_at.
 *  - friendsRecent: MUST subtract bots, and the client cannot read game_bots
 *    (0009). This is the op that forces the whole group server-side.
 *
 * Errors follow the file convention: HTTP 200 with an { error } body.
 */

import { afterResponse, json, LIMITS, rateLimited, rateOk, type SupabaseClient } from "./lib.ts";
import { displayNameOf, sendPush } from "./push.ts";

const FRIEND_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const FRIEND_LOOKUPS_PER_HOUR = 40;
const FRIEND_REQUESTS_PER_HOUR = 20;
const RECENT_OPPONENT_LIMIT = 20;

/**
 * "Your friend is online" pacing. Every number here is a spam control, and
 * they matter more than the feature does: the notification competes for the
 * same permission grant as room invites, which are the ones a player actually
 * asked for. Get this wrong and they lose both.
 */
/** How stale a presence row must be before coming back counts as NEWS. Below
 *  this it is the same session — backgrounding to read a message and coming
 *  straight back must not tell thirty people you have arrived. */
const ONLINE_AWAY_MINUTES = 45;
/** Per pair. A friend who plays all evening is worth one notification. */
const ONLINE_PAIR_COOLDOWN_HOURS = 8;
/** Per recipient per day, across ALL friends. The pair cooldown alone does
 *  nothing for someone with forty friends; this is the cap that does. */
const ONLINE_MAX_PER_DAY = 3;
/** Recipients per announcement. A large friends list should not turn one app
 *  launch into a fan-out, and the people who care are a short list anyway. */
const ONLINE_FANOUT_MAX = 10;

/**
 * Permanently delete the caller's account and every trace of their data. Each
 * app table references auth.users(id) ON DELETE CASCADE, so removing the auth
 * user removes their wallet, gems, entitlements, purchases, profile, friends,
 * blocks, and seats in one transaction. Required by the App Store and Google
 * Play for any app that lets a user create an account. The caller can only ever
 * delete themselves — userId comes from the verified JWT, never the request body.
 */
export async function opDeleteAccount(admin: SupabaseClient, userId: string): Promise<Response> {
  // Irreversible, and an account can only ever delete itself once — so a low
  // ceiling costs a real user nothing and stops a retry loop from hammering the
  // Auth admin API.
  if (!(await rateOk(admin, userId, "deleteAccount", LIMITS.deleteAccount))) return rateLimited();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return json({ error: "Could not delete your account. Please try again." });
  return json({ ok: true });
}

/** Delete bot-targeted requests whose randomized decline delay has elapsed.
 *  pg_cron is the primary reaper; this covers environments without it. */
function reapAutoDeclines(admin: SupabaseClient): void {
  afterResponse(
    admin.from("friendships").delete().not("auto_decline_at", "is", null).lt("auto_decline_at", new Date().toISOString()),
  );
}

/** The caller's own code, minted on first read if the 0015 trigger missed it. */
export async function opFriendCode(admin: SupabaseClient, userId: string): Promise<Response> {
  if (!(await rateOk(admin, userId, "friendCode", LIMITS.friendCode))) return rateLimited();
  const { data: existing } = await admin.from("friend_codes").select("code").eq("user_id", userId).maybeSingle();
  if (existing?.code) return json({ code: existing.code });

  // Retry on collision — the unique index is the real guarantee, mirroring how
  // wallet_apply handles a lost ext_id race (0013).
  for (let attempt = 0; attempt < 5; attempt++) {
    let code = "";
    const buf = new Uint8Array(6);
    crypto.getRandomValues(buf);
    for (const b of buf) code += FRIEND_CODE_ALPHABET[b % 32];
    const { data, error } = await admin
      .from("friend_codes")
      .insert({ user_id: userId, code })
      .select("code")
      .maybeSingle();
    if (data?.code) return json({ code: data.code });
    // Someone assigned ours concurrently — take theirs and stop.
    if (error) {
      const { data: raced } = await admin.from("friend_codes").select("code").eq("user_id", userId).maybeSingle();
      if (raced?.code) return json({ code: raced.code });
    }
  }
  return json({ error: "Could not create your friend code. Try again." });
}

/**
 * Resolve a friend code to a player card.
 *
 * Malformed and not-found return the identical message on purpose, so the
 * response shape cannot be used to tell "this code is well-formed but unused"
 * from "this is not a code" — that difference is what makes scanning cheap.
 */
export async function opFriendLookup(admin: SupabaseClient, userId: string, rawCode: string): Promise<Response> {
  const notFound = { error: "No player with that code." };
  if (!(await rateOk(admin, userId, "friendLookup", FRIEND_LOOKUPS_PER_HOUR))) {
    return json({ error: "Too many lookups. Try again later." });
  }
  const code = rawCode.trim().toUpperCase();
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code)) return json(notFound);

  const { data: row } = await admin.from("friend_codes").select("user_id").eq("code", code).maybeSingle();
  const targetId = row?.user_id as string | undefined;
  if (!targetId || targetId === userId) return json(notFound);

  const { data: blocked } = await admin.rpc("is_blocked", { a: userId, b: targetId });
  if (blocked === true) return json(notFound); // don't confirm the account exists

  const [{ data: profile }, { data: stats }] = await Promise.all([
    admin.from("profiles").select("user_id, display_name, avatar_id, dice_skin").eq("user_id", targetId).maybeSingle(),
    admin.from("player_stats").select("games_played, games_won").eq("user_id", targetId).maybeSingle(),
  ]);
  if (!profile) return json(notFound);

  return json({
    user: profile,
    stats: stats ?? { games_played: 0, games_won: 0 },
  });
}

/**
 * Resolve an exact username to a player card.
 *
 * 0015 deliberately shipped without this, on the grounds that name search turns
 * the profile directory into a targeting tool. That reasoning was sound but the
 * guard never existed: profiles is `select using (true)` (0003:18), so any
 * signed-in client could already enumerate every name straight through
 * PostgREST. Only the UI declined to. Usernames are now how players find each
 * other, so this lands here instead — where the throttle, the block check and
 * the bot subtraction can all be applied.
 *
 * EXACT match only, never a prefix or a fuzzy scan: you have to already know
 * the name. That is what keeps it a lookup rather than a browsable directory,
 * and it rides the unique index profiles_display_name_ci_unique (0006) so the
 * cost is one index probe no matter how the input is shaped.
 *
 * Shares the friendLookup throttle on purpose — otherwise a scanner blocked on
 * codes would just switch to names for a second 40/hour budget.
 */
export async function opFriendSearch(admin: SupabaseClient, userId: string, rawName: string): Promise<Response> {
  const notFound = { error: "No player with that username." };
  if (!(await rateOk(admin, userId, "friendLookup", FRIEND_LOOKUPS_PER_HOUR))) {
    return json({ error: "Too many lookups. Try again later." });
  }
  const name = rawName.trim();
  if (name.length === 0 || name.length > 20) return json(notFound);

  // ilike with the wildcards escaped is case-insensitive equality — the same
  // comparison lower(display_name) is uniquely indexed on.
  const escaped = name.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data: profile } = await admin
    .from("profiles")
    .select("user_id, display_name, avatar_id, dice_skin")
    .ilike("display_name", escaped)
    .limit(1)
    .maybeSingle();

  const targetId = profile?.user_id as string | undefined;
  if (!targetId || targetId === userId) return json(notFound);

  // Hidden bots have ordinary profiles rows (0009). A findable bot handle is a
  // tell, and a "friend" who never answers unravels the quick-match illusion.
  const { data: bot } = await admin
    .from("bot_identities")
    .select("user_id")
    .eq("user_id", targetId)
    .maybeSingle();
  if (bot) return json(notFound);

  const { data: blocked } = await admin.rpc("is_blocked", { a: userId, b: targetId });
  if (blocked === true) return json(notFound); // don't confirm the account exists

  const { data: stats } = await admin
    .from("player_stats")
    .select("games_played, games_won")
    .eq("user_id", targetId)
    .maybeSingle();

  return json({ user: profile, stats: stats ?? { games_played: 0, games_won: 0 } });
}

/**
 * Send a friend request.
 *
 * RLS already enforces the block check and the rate caps on insert; this op
 * exists to turn those into readable errors and to set auto_decline_at, which
 * needs game_bots visibility the client does not have.
 */
export async function opFriendRequest(admin: SupabaseClient, userId: string, toUserId: string): Promise<Response> {
  reapAutoDeclines(admin);
  if (!toUserId || toUserId === userId) return json({ error: "That isn't a valid player." });
  if (!(await rateOk(admin, userId, "friendRequest", FRIEND_REQUESTS_PER_HOUR))) {
    return json({ error: "You've sent a lot of requests. Try again in an hour." });
  }

  const { data: blocked } = await admin.rpc("is_blocked", { a: userId, b: toUserId });
  if (blocked === true) return json({ error: "You can't add this player." });

  // They already asked us — accept instead of creating a reverse duplicate.
  const { data: reverse } = await admin
    .from("friendships")
    .select("id, status")
    .eq("requester_user_id", toUserId)
    .eq("addressee_user_id", userId)
    .maybeSingle();
  if (reverse) {
    if (reverse.status === "pending") {
      await admin.from("friendships").update({ status: "accepted", auto_decline_at: null }).eq("id", reverse.id);
    }
    return json({ ok: true, status: "accepted" });
  }

  // Hidden bots decline on a randomized 45s-4min delay. Instant would be a
  // tell; this reads exactly like a human getting round to it.
  const { data: botRow } = await admin.from("bot_identities").select("user_id").eq("user_id", toUserId).maybeSingle();
  const autoDeclineAt = botRow
    ? new Date(Date.now() + (45 + Math.random() * 195) * 1000).toISOString()
    : null;

  const { error } = await admin
    .from("friendships")
    .upsert(
      { requester_user_id: userId, addressee_user_id: toUserId, status: "pending", auto_decline_at: autoDeclineAt },
      { onConflict: "requester_user_id,addressee_user_id" },
    );
  if (error) return json({ error: "Could not send that request." });

  // Bots get no notification — nobody is there, and the outbound traffic would
  // be a tell if it ever showed up in analytics.
  if (!botRow) {
    afterResponse(
      (async () => {
        const name = await displayNameOf(admin, userId);
        await sendPush(admin, [toUserId], {
          title: "New friend request",
          body: `${name} wants to be friends`,
          data: { type: "friend-request" },
        });
      })(),
    );
  }

  return json({ ok: true, status: "pending" });
}

/**
 * Invite a friend to a room, and push it to them.
 *
 * The insert itself was always possible straight from the client under RLS
 * (0015 restricts it to accepted friends), and that policy stays as the hard
 * guarantee. This op exists for the same reason opFriendRequest does: it can
 * give readable errors, and it can do the thing RLS cannot — reach Expo and
 * actually wake the person up. An invite that only arrives when the app is
 * already open is barely an invite.
 */
export async function opRoomInvite(
  admin: SupabaseClient,
  userId: string,
  toUserId: string,
  roomCode: string,
  stake: number,
): Promise<Response> {
  if (!toUserId || toUserId === userId) return json({ error: "That isn't a valid player." });
  if (!(await rateOk(admin, userId, "roomInvite", LIMITS.roomInvite))) {
    return json({ error: "You've sent a lot of invites. Give it a minute." });
  }

  const code = roomCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,8}$/.test(code)) return json({ error: "That room code isn't valid." });

  const { data: blocked } = await admin.rpc("is_blocked", { a: userId, b: toUserId });
  if (blocked === true) return json({ error: "You can't invite this player." });

  // Friends only — mirrors the 0015 insert policy, so a direct-to-table caller
  // and this op refuse the same set of invites.
  const { data: friendship } = await admin
    .from("friendships")
    .select("id")
    .eq("status", "accepted")
    .or(
      `and(requester_user_id.eq.${userId},addressee_user_id.eq.${toUserId}),` +
        `and(requester_user_id.eq.${toUserId},addressee_user_id.eq.${userId})`,
    )
    .maybeSingle();
  if (!friendship) return json({ error: "You can only invite friends." });

  const pot = Number.isFinite(stake) && stake > 0 ? Math.floor(stake) : 0;
  const { error } = await admin
    .from("room_invites")
    .insert({ from_user_id: userId, to_user_id: toUserId, room_code: code, stake: pot });
  if (error) return json({ error: "Could not send that invite." });

  // Fire-and-forget: the invite row is the real delivery, realtime shows it to
  // anyone already in the app, and the push is the bonus that reaches everyone
  // else. None of that should be able to fail the response.
  afterResponse(
    (async () => {
      const name = await displayNameOf(admin, userId);
      await sendPush(admin, [toUserId], {
        title: `${name} invited you to play`,
        body: pot > 0 ? `Room ${code} · ${pot} coins on the line` : `Room ${code} · friendly game`,
        data: { type: "invite", roomCode: code },
      });
    })(),
  );

  return json({ ok: true });
}

/**
 * People you've played with recently and could still add.
 *
 * Server-side because the bot subtraction is not expressible client-side: the
 * client cannot read game_bots at all (0009), and a "friend" who is never
 * online and never answers an invite would unravel the quick-match illusion.
 */
export async function opFriendsRecent(admin: SupabaseClient, userId: string): Promise<Response> {
  if (!(await rateOk(admin, userId, "friendsRecent", LIMITS.friendsRecent))) return rateLimited();
  reapAutoDeclines(admin);

  // Games I was in, most recent first (players_user_recent_idx, 0015).
  const { data: mine } = await admin
    .from("players")
    .select("game_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(40);
  const gameIds = (mine ?? []).map((r) => r.game_id as string);
  if (gameIds.length === 0) return json({ players: [] });

  const { data: seats } = await admin
    .from("players")
    .select("user_id, game_id, created_at")
    .in("game_id", gameIds)
    .neq("user_id", userId)
    .order("created_at", { ascending: false });
  if (!seats || seats.length === 0) return json({ players: [] });

  // Subtract bots, then anyone already in a friendship, then blocks.
  const [{ data: bots }, { data: rels }, { data: blocks }] = await Promise.all([
    admin.from("game_bots").select("user_id").in("game_id", gameIds),
    admin
      .from("friendships")
      .select("requester_user_id, addressee_user_id")
      .or(`requester_user_id.eq.${userId},addressee_user_id.eq.${userId}`),
    admin.from("blocks").select("blocker_user_id, blocked_user_id").or(`blocker_user_id.eq.${userId},blocked_user_id.eq.${userId}`),
  ]);

  const excluded = new Set<string>([userId]);
  for (const b of bots ?? []) excluded.add(b.user_id as string);
  for (const r of rels ?? []) {
    excluded.add(r.requester_user_id as string);
    excluded.add(r.addressee_user_id as string);
  }
  for (const b of blocks ?? []) {
    excluded.add(b.blocker_user_id as string);
    excluded.add(b.blocked_user_id as string);
  }

  const ordered: string[] = [];
  for (const s of seats) {
    const uid = s.user_id as string;
    if (excluded.has(uid)) continue;
    excluded.add(uid); // dedupe: keep the most recent encounter only
    ordered.push(uid);
    if (ordered.length >= RECENT_OPPONENT_LIMIT) break;
  }
  if (ordered.length === 0) return json({ players: [] });

  const { data: profiles } = await admin
    .from("profiles")
    .select("user_id, display_name, avatar_id, dice_skin")
    .in("user_id", ordered);

  const byId = new Map((profiles ?? []).map((p) => [p.user_id as string, p]));
  return json({ players: ordered.map((uid) => byId.get(uid)).filter(Boolean) });
}

/**
 * Announce that the caller is back, and tell the friends who would want to
 * know.
 *
 * Presence itself is client-written under RLS (0017) and stays that way for the
 * heartbeat — but the FIRST write of a session comes through here instead,
 * because the decision "is this news?" can only be made by comparing against
 * the row as it was before the heartbeat freshened it. Doing that client-side
 * would be a read-then-write race against the app's own heartbeat, and would
 * put the spam caps somewhere every client could ignore them.
 *
 * A friend is worth telling only if all of this holds:
 *   - the caller was actually away (ONLINE_AWAY_MINUTES of silence);
 *   - the friend is NOT in the app right now — if they are, the presence dot
 *     on their Friends screen already says it, and a push would duplicate
 *     something they can see;
 *   - neither has blocked the other, and the friend is not a hidden bot;
 *   - the pair and the recipient are both inside their notification budgets.
 *
 * Everything after the presence write is best-effort and runs off the response.
 * Being told your friend is around is a nicety; the app coming back online is
 * not, and must not wait on a fan-out.
 *
 * No rateOk guard, deliberately: the op is self-limiting. Its first act is to
 * stamp the presence row fresh, so a client hammering it finds `wasAway` false
 * on every call after the first and never reaches the fan-out at all. A limiter
 * on top would only add a counter write to the app-launch path.
 */
export async function opPresenceOnline(admin: SupabaseClient, userId: string): Promise<Response> {
  if (!(await rateOk(admin, userId, "presence", LIMITS.presence))) return rateLimited();
  const now = Date.now();

  const { data: mine } = await admin
    .from("user_presence")
    .select("last_seen_at, status")
    .eq("user_id", userId)
    .maybeSingle();

  // No row at all is a first launch, which is the most "just arrived" there is.
  const lastSeen = mine?.last_seen_at ? Date.parse(mine.last_seen_at as string) : null;
  const wasAway =
    lastSeen === null ||
    mine?.status === "offline" ||
    now - lastSeen > ONLINE_AWAY_MINUTES * 60_000;

  await admin
    .from("user_presence")
    .upsert(
      { user_id: userId, last_seen_at: new Date(now).toISOString(), status: "online" },
      { onConflict: "user_id" },
    );

  if (wasAway) afterResponse(notifyFriendsOnline(admin, userId, now).catch(() => {}));
  return json({ ok: true });
}

/**
 * Who, out of this player's friends, should actually be told they're back.
 *
 * Pure and fully injected, because this — not the sending — is the part that
 * decides whether the feature is useful or the reason someone turns
 * notifications off. It is exported so the caps are pinned by tests rather than
 * by the reviewer's reading of a loop buried in an async fan-out.
 *
 * Order of the filters is not arbitrary: cheap, high-yield exclusions first, so
 * a full friends list narrows to a handful before the fan-out cap ever applies.
 */
export function onlineNotifyTargets(input: {
  friendIds: readonly string[];
  /** Hidden bot seats — nobody is there to be notified. */
  botIds: ReadonlySet<string>;
  /** Friends with the app open; their Friends screen already shows the dot. */
  inApp: ReadonlySet<string>;
  /** Either direction of a block. */
  blocked: ReadonlySet<string>;
  /** When this player last told each friend they were online, epoch ms. */
  lastToldAt: ReadonlyMap<string, number>;
  /** How many of these a friend has already had today, from anyone. */
  todayCount: ReadonlyMap<string, number>;
  now: number;
}): string[] {
  const { friendIds, botIds, inApp, blocked, lastToldAt, todayCount, now } = input;
  const out: string[] = [];
  for (const id of friendIds) {
    if (out.length >= ONLINE_FANOUT_MAX) break;
    if (botIds.has(id) || inApp.has(id) || blocked.has(id)) continue;
    if (now - (lastToldAt.get(id) ?? -Infinity) < ONLINE_PAIR_COOLDOWN_HOURS * 3600_000) continue;
    if ((todayCount.get(id) ?? 0) >= ONLINE_MAX_PER_DAY) continue;
    out.push(id);
  }
  return out;
}

/** The fan-out half of opPresenceOnline. Separate so the op reads as the two
 *  things it does: record presence, then (maybe) tell people. */
async function notifyFriendsOnline(admin: SupabaseClient, userId: string, now: number): Promise<void> {
  const { data: rows } = await admin
    .from("friendships")
    .select("requester_user_id, addressee_user_id")
    .eq("status", "accepted")
    .or(`requester_user_id.eq.${userId},addressee_user_id.eq.${userId}`);

  const friendIds = (rows ?? [])
    .map((r) => (r.requester_user_id === userId ? r.addressee_user_id : r.requester_user_id) as string)
    .filter((id) => id && id !== userId);
  if (friendIds.length === 0) return;

  // Everything the decision needs, in one round of parallel reads. This runs on
  // every app launch that follows a real absence — which is most of them — so
  // it must not be a query per friend.
  const dayAgo = new Date(now - 24 * 3600_000).toISOString();
  const [{ data: bots }, { data: presence }, { data: blocks }, { data: pairs }, { data: recent }] =
    await Promise.all([
      // Hidden bots are "friends" only by accident (they auto-decline, 0035),
      // but a push aimed at one is outbound traffic for a seat nobody sits in.
      admin.from("bot_identities").select("user_id").in("user_id", friendIds),
      admin.from("user_presence").select("user_id, last_seen_at, status").in("user_id", friendIds),
      // Either direction. A block already severs the friendship (0015 cascade),
      // so this is belt and braces — but it is one query, and the one thing
      // worse than no notification is a notification from someone you blocked.
      admin
        .from("blocks")
        .select("blocker_user_id, blocked_user_id")
        .or(`blocker_user_id.eq.${userId},blocked_user_id.eq.${userId}`),
      admin
        .from("friend_online_pings")
        .select("to_user_id, sent_at")
        .eq("from_user_id", userId)
        .in("to_user_id", friendIds),
      admin
        .from("friend_online_pings")
        .select("to_user_id")
        .in("to_user_id", friendIds)
        .gte("sent_at", dayAgo),
    ]);

  const botIds = new Set((bots ?? []).map((b) => String(b.user_id)));

  // Anyone with the app open already sees the dot go green.
  const inApp = new Set(
    (presence ?? [])
      .filter(
        (r) =>
          r.status !== "offline" &&
          now - Date.parse(r.last_seen_at as string) < ONLINE_AWAY_MINUTES * 60_000,
      )
      .map((r) => String(r.user_id)),
  );

  const blocked = new Set<string>();
  for (const b of blocks ?? []) {
    const other = b.blocker_user_id === userId ? b.blocked_user_id : b.blocker_user_id;
    blocked.add(String(other));
  }

  const lastToldAt = new Map<string, number>();
  for (const r of pairs ?? []) lastToldAt.set(String(r.to_user_id), Date.parse(r.sent_at as string));

  const todayCount = new Map<string, number>();
  for (const r of recent ?? []) {
    const id = String(r.to_user_id);
    todayCount.set(id, (todayCount.get(id) ?? 0) + 1);
  }

  const targets = onlineNotifyTargets({ friendIds, botIds, inApp, blocked, lastToldAt, todayCount, now });
  if (targets.length === 0) return;

  const name = await displayNameOf(admin, userId);
  await sendPush(admin, targets, {
    title: `${name} is online`,
    body: "They're free for a game right now.",
    data: { type: "friend-online", userId },
  });

  // Recorded after the send, so a failed send does not burn the cooldown.
  // Upsert because a pair row is a last-sent stamp, not a log — the reaper
  // (0042) only has to cope with dead pairs, not with history.
  await admin.from("friend_online_pings").upsert(
    targets.map((to) => ({ from_user_id: userId, to_user_id: to, sent_at: new Date(now).toISOString() })),
    { onConflict: "from_user_id,to_user_id" },
  );
}
