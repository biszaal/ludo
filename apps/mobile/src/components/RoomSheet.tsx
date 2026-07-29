/**
 * Play-with-friends flow, off the hub and into a sheet: create a room, or
 * join by code. The only TextInput on Home lives here, so the shell's
 * keyboardAvoiding mode handles the keyboard. No close-on-success wiring:
 * joining/creating pushes the lobby and ScreenStack unmounts Home.
 */

import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button } from "./Button";
import { Sheet } from "./Sheet";
import { Field } from "./Field";
import { useOnlineStore } from "../store/onlineStore";
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

  return (
    <Sheet onClose={onClose} title="Play with friends" keyboardAvoiding>
      <Button label={connecting ? "Creating…" : "Create a room"} onPress={() => void create()} />

      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <View style={{ flex: 1, height: 1, backgroundColor: palette.hairline }} />
        <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>or join with a code</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: palette.hairline }} />
      </View>

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
            label="Join"
            variant="ghost"
            onPress={() => {
              if (code.length >= 3) void join(code);
            }}
          />
        </View>
      </View>

      {error ? <Text style={{ fontFamily: font.regular, fontSize: 13, color: teamColor.red }}>{error}</Text> : null}

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
