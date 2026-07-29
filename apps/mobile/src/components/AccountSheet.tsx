/**
 * Save-account / Sign-in sheet. Optional by design — it exists so a guest CAN
 * make their purchases durable, never to gate play. One card toggles between
 * saving the current guest as an account and signing back into an existing one.
 */

import { useState } from "react";
import { Text, View } from "react-native";
import { Sheet } from "./Sheet";
import { Field } from "./Field";
import { Button } from "./Button";
import { saveAccount, signIn } from "../lib/auth";
import { font, palette, space } from "../theme";

type Mode = "save" | "signin";

export function AccountSheet({ initialMode, onClose }: { initialMode: Mode; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [focused, setFocused] = useState<"email" | "password" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const saving = mode === "save";

  const submit = async () => {
    if (busy) return;
    setError(null);
    setDone(null);
    const em = email.trim();
    if (!em || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      const res = saving ? await saveAccount(em, password) : await signIn(em, password);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (saving) {
        setDone(
          res.needsConfirm
            ? "Almost there — tap the link in your email to confirm, then you can sign in on any device."
            : "Saved. Your coins, gems and looks are backed up to this account.",
        );
      } else {
        onClose(); // restored + rehydrated
      }
    } finally {
      setBusy(false);
    }
  };

  const swap = (next: Mode) => {
    setMode(next);
    setError(null);
    setDone(null);
  };

  return (
    <Sheet onClose={onClose} title={saving ? "Save your account" : "Sign in"} keyboardAvoiding>
      <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
        {saving
          ? "Back up your coins, gems and looks so they survive a reinstall or a new phone. You'll keep playing exactly as you are."
          : "Restore an account you saved earlier — its coins, gems and cosmetics come with it."}
      </Text>

      <Field
        accessibilityLabel="Email"
        value={email}
        onChangeText={setEmail}
        focused={focused === "email"}
        onFocus={() => setFocused("email")}
        onBlur={() => setFocused(null)}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
      />
      <Field
        accessibilityLabel="Password"
        value={password}
        onChangeText={setPassword}
        focused={focused === "password"}
        onFocus={() => setFocused("password")}
        onBlur={() => setFocused(null)}
        placeholder="At least 6 characters"
        secureTextEntry
        autoCapitalize="none"
        autoComplete={saving ? "new-password" : "current-password"}
      />

      {error ? (
        <Text style={{ fontFamily: font.regular, fontSize: 13, color: "#E8705F" }}>{error}</Text>
      ) : done ? (
        <Text style={{ fontFamily: font.regular, fontSize: 13, color: "#5BC48A" }}>{done}</Text>
      ) : null}

      {done ? (
        <Button label="Done" onPress={onClose} />
      ) : (
        <Button label={busy ? (saving ? "Saving…" : "Signing in…") : saving ? "Save account" : "Sign in"} onPress={() => void submit()} disabled={busy} />
      )}

      <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingTop: space.xs }}>
        <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
          {saving ? "Already have an account?" : "New here?"}
        </Text>
        <Text
          accessibilityRole="button"
          onPress={() => swap(saving ? "signin" : "save")}
          style={{ fontFamily: font.semibold, fontSize: 13, color: palette.porcelain }}
        >
          {saving ? "Sign in" : "Save an account"}
        </Text>
      </View>
    </Sheet>
  );
}
