/**
 * Play-with-friends flow, off the hub and into a centered POPUP: join by code,
 * or pick what the game is worth and open a room. The only TextInput on Home
 * lives here, so the shell's keyboardAvoiding mode handles the keyboard. No
 * close-on-success wiring: joining/creating pushes the lobby and ScreenStack
 * unmounts Home.
 *
 * A popup rather than a bottom band because this is a short decision, not a
 * list to browse — and because a card that is already vertically centred lifts
 * cleanly when the keyboard opens instead of being shoved off the top.
 *
 * JOINING COMES FIRST, and the order is the fix rather than a preference.
 * Creating a room and joining one are not symmetric acts: the host is browsing,
 * while the guest has been sent four letters by someone already sitting in a
 * lobby waiting for them. Leading with the stake tiles and "Create a room" put
 * a decision the guest does not have to make above the one thing they came in
 * to do, with the field itself below a divider at the bottom of the sheet —
 * small, ghost-buttoned, and reported as simply not findable.
 *
 * So the code field opens the sheet, at full width with a real button on it,
 * and hosting sits below under its own heading. A host loses nothing: they are
 * exploring the sheet anyway, and "Create a room" is still plainly there.
 *
 * The pot is the HOST's choice and nobody pays on the way in — the server
 * collects from every seat when the game actually starts. That is why tiers you
 * can't currently afford are still offered as disabled rather than hidden: you
 * may well top up before anyone presses start, and a tier that silently
 * vanishes reads like a bug.
 */

import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button } from "./Button";
import { Sheet } from "./Sheet";
import { Field } from "./Field";
import { SelectTile } from "./SelectTile";
import { SectionLabel } from "./SectionLabel";
import { CoinGlyph } from "./CoinsPill";
import { useOnlineStore } from "../store/onlineStore";
import { useConfig } from "../store/configStore";
import { useWallet } from "../store/walletStore";
import { formatCompact } from "../lib/format";
import { useNav } from "../store/navStore";
import { font, palette, space, teamColor } from "../theme";

export function RoomSheet({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState("");
  const create = useOnlineStore((s) => s.create);
  const join = useOnlineStore((s) => s.join);
  const status = useOnlineStore((s) => s.status);
  const error = useOnlineStore((s) => s.error);
  const push = useNav((s) => s.push);
  const connecting = status === "connecting";
  // Room codes are four characters; three is accepted because the join RPC has
  // always tolerated it, and rejecting on length here would be a new rule.
  const canJoin = code.length >= 3 && !connecting;

  const tiers = useConfig((s) => s.config.economy.stakeTiers);
  const balance = useWallet((s) => s.balance);
  const [stake, setStake] = useState(0);

  return (
    <Sheet onClose={onClose} title="Play with friends" keyboardAvoiding variant="popup">
      <SectionLabel>Got a code from a friend?</SectionLabel>
      <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
        <Field
          accessibilityLabel="Room code"
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))}
          placeholder="CODE"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={4}
          mono
          style={{ flex: 1 }}
        />
        <View style={{ width: 130 }}>
          <Button
            label={connecting ? "Joining…" : "Join"}
            // Filled, not ghost: this is the reason most people open this
            // sheet, and a ghost button beside an empty field read as decoration.
            disabled={!canJoin}
            onPress={() => {
              if (canJoin) void join(code);
            }}
          />
        </View>
      </View>
      <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>
        Four letters, from whoever set the game up.
      </Text>

      {error ? <Text style={{ fontFamily: font.regular, fontSize: 13, color: teamColor.red }}>{error}</Text> : null}

      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <View style={{ flex: 1, height: 1, backgroundColor: palette.hairline }} />
        <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>or start your own</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: palette.hairline }} />
      </View>

      <SectionLabel>Play for</SectionLabel>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <SelectTile label="Free" selected={stake === 0} onPress={() => setStake(0)} />
        {tiers.map((t) => (
          <SelectTile
            key={t}
            label={formatCompact(t)}
            mono
            selected={stake === t}
            onPress={() => setStake(t)}
          />
        ))}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <CoinGlyph size={13} />
        <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>
          {stake === 0
            ? "A friendly game — no coins change hands."
            : `Everyone pays ${formatCompact(stake)} when the game starts. Winner takes the pot.`}
        </Text>
      </View>
      {stake > 0 && balance !== null && balance < stake ? (
        <Text style={{ fontFamily: font.regular, fontSize: 12, color: teamColor.red }}>
          You have {formatCompact(balance)} — top up before starting, or pick a smaller pot.
        </Text>
      ) : null}

      <Button
        label={connecting ? "Creating…" : "Create a room"}
        variant="ghost"
        onPress={() => void create(stake)}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Manage friends"
        onPress={() => {
          onClose();
          push("friends");
        }}
        style={({ pressed }) => ({ alignSelf: "center", opacity: pressed ? 0.7 : 1, paddingVertical: space.xs })}
      >
        <Text style={{ fontFamily: font.semibold, fontSize: 13, color: palette.mutedSteel }}>Manage friends</Text>
      </Pressable>
    </Sheet>
  );
}
