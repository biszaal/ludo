-- In-room chat becomes a private channel, gated by the seat you actually hold.
--
-- Chat rides Realtime *broadcast* on topic `game:<uuid>` (src/net/api.ts,
-- subscribeGame). Broadcast is peer-to-peer: the server relays whatever a
-- client sends, and every field in the payload — `fromUserId` included — is
-- chosen by the sender. Nothing signs it.
--
-- Until now that channel was public, so the only things standing between an
-- outsider and a room's chat were the publishable key (which ships inside the
-- app, and is public by design) and knowing the game id. The id being a v4
-- uuid is what was actually keeping strangers out — not any check that the
-- speaker holds a seat. That is an accident, not a guarantee: game ids are not
-- secrets, they travel in invites and in every client that ever sat at the
-- table, and a player who leaves keeps theirs forever.
--
-- 0019 already settled who may see a game: `is_game_participant`, the
-- SECURITY DEFINER lookup behind the games/players/moves read policies. The
-- same question decides who may see its room, so the same function answers it
-- here — one definition of "in this game" for tables and chat alike.
--
-- Note for anyone tuning this: 0019's comment guesses that Realtime evaluates
-- the policy per message per subscriber. It does not. The read verdict is
-- computed once when the client joins the topic and cached for the life of
-- that connection. Cheap, but it means a player who is removed from a game
-- keeps receiving until their socket drops — acceptable for chat, and worth
-- knowing before relying on this policy for anything stricter.
--
-- Sending moves to the server at the same time (functions/game/chat.ts). The
-- reason is that RLS cannot police WHO a broadcast claims to be from: the write
-- check on realtime.messages runs for the first message on a connection and is
-- then cached for the rest of it, so a policy comparing the payload's
-- fromUserId to auth.uid() would pass once and wave everything after it
-- through. A player could send one honest message and then speak as anyone
-- else at the table. Since the check cannot be per-message, the sender cannot
-- be a client: the `chat` op stamps fromUserId from the verified JWT and
-- relays as the service role, which bypasses these policies entirely.
--
-- Hence SELECT only below. There is deliberately NO insert policy — with RLS
-- enabled, absent means denied, and that is the whole guarantee: the only
-- writer left on this topic is the service role.
--
-- ORDERING: deploy this BEFORE shipping the client that sets private:true.
-- A private channel with no policy denies everyone, so an app that flips the
-- flag against a database without this policy loses chat entirely. The reverse
-- order is harmless: the policy sits unused until the app asks for a private
-- channel.
--
-- Rollback: drop the policy AND re-deploy the previous client — an app on
-- private:true goes silent without it. Restoring peer-to-peer sending would
-- also need an insert policy here, which is the hole this closes.

-- ---------------------------------------------------------------------------
-- realtime.messages is Realtime's own authorization surface. RLS is already
-- enabled on it by the Realtime extension; only the policy is ours.
--
--   select — may this connection JOIN the topic and receive on it
--   insert — may this connection SEND on it (granted to nobody; see above)
-- ---------------------------------------------------------------------------

-- Topic is `game:<uuid>`; split_part gives back the uuid half. A malformed or
-- non-game topic yields '' and the ::uuid cast would raise, so guard the shape
-- first — a bad topic must be a quiet denial, not a 500 for the subscriber.
drop policy if exists "chat: participants receive" on realtime.messages;
create policy "chat: participants receive" on realtime.messages
  for select to authenticated
  using (
    realtime.topic() like 'game:%'
    and split_part(realtime.topic(), ':', 2) ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_game_participant(split_part(realtime.topic(), ':', 2)::uuid)
  );

-- No insert policy, deliberately. See the header: a per-message sender check is
-- impossible here because Realtime caches the write verdict per connection, so
-- clients do not get to write at all. functions/game/chat.ts relays instead,
-- as the service role, stamping fromUserId from the caller's verified JWT.
--
-- If a later change grants insert here, it hands every player the ability to
-- post as any other player in the room. Route it through the chat op instead.
