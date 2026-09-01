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
import { Platform } from "react-native";
import { saveAccount, signIn, linkProvider, signInWithProvider, type LinkProvider } from "../lib/auth";
import { font, palette, space } from "../theme";

type Mode = "save" | "signin";

/**
 * Minimum for a NEW password. Above Supabase's default 6 on purpose: breached-
 * password checking (HaveIBeenPwned) is a Pro-plan feature and this project is
 * on Free, so length is the only lever available. Modest by design — the
 * account guards a coin balance and cosmetics, holds no payment details, and is
 * optional in the first place, so a wall of complexity rules would cost more
 * sign-ups than it prevents takeovers.
 */
const MIN_NEW_PASSWORD = 8;

/**
 * `heading` lets a caller replace the title and blurb without forking the sheet.
 * The save-account PROMPT needs to say why it appeared — a player who has just
 * bought gems and a player three games in are being asked the same thing for
 * visibly different reasons — while the Account screen, where the player came
 * looking, wants the plain wording. Same card either way, so the flow can only
 * be got wrong in one place.
 */
export function AccountSheet({
  initialMode,
  onClose,
  heading,
}: {
  initialMode: Mode;
  onClose: () => void;
  heading?: { title: string; message: string };
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [focused, setFocused] = useState<"email" | "password" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const saving = mode === "save";

  /**
   * Apple first on iOS, and present at all only there.
   *
   * The App Store requires Sign in with Apple wherever a third-party login is
   * offered, and Apple's guidelines expect it to be at least as prominent as
   * the alternatives — so it leads. On Android it would be a worse version of
   * Google for no reason, so it is simply absent.
   */
  const providers: LinkProvider[] = Platform.OS === "ios" ? ["apple", "google"] : ["google"];

  const runProvider = async (provider: LinkProvider) => {
    if (busy) return;
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const res = saving ? await linkProvider(provider) : await signInWithProvider(provider);
      if (!res.ok) {
        // An empty message is a deliberate cancel — the player closed the sheet.
        // Saying anything here would turn a change of mind into a failure.
        if (res.error) setError(res.error);
        return;
      }
      if (saving) setDone("Saved. Your coins, gems and looks now follow this account to any phone.");
      else onClose(); // restored + rehydrated
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (busy) return;
    setError(null);
    setDone(null);
    const em = email.trim();
    if (!em || !password) {
      setError("Enter your email and password.");
      return;
    }
    // Only gate NEW passwords on length. Applying this to sign-in too would
    // lock out anyone who registered under the old 6-character minimum — they
    // could no longer reach the account they already have. Wrong credentials
    // are the server's call to make, not a length check's.
    if (saving && password.length < MIN_NEW_PASSWORD) {
      setError(`Password must be at least ${MIN_NEW_PASSWORD} characters.`);
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
    <Sheet onClose={onClose} title={heading?.title ?? (saving ? "Save your account" : "Sign in")} keyboardAvoiding>
      <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
        {heading?.message ??
          (saving
            ? "Back up your coins, gems and looks so they survive a reinstall or a new phone. You'll keep playing exactly as you are."
            : "Restore an account you saved earlier — its coins, gems and cosmetics come with it.")}
      </Text>

      {done ? null : (
        <>
          {providers.map((provider) => (
            <Button
              key={provider}
              label={`${saving ? "Continue" : "Sign in"} with ${provider === "apple" ? "Apple" : "Google"}`}
              variant={provider === providers[0] ? undefined : "ghost"}
              onPress={() => void runProvider(provider)}
              disabled={busy}
            />
          ))}
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.xs }}>
            <View style={{ flex: 1, height: 1, backgroundColor: palette.hairline }} />
            <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>or use email</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: palette.hairline }} />
          </View>
        </>
      )}

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
