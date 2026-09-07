/**
 * "Send feedback" — one box, one button, and it sends from inside the app.
 *
 * Deliberately not a `mailto:` hand-off. A large share of Android phones have
 * no mail client configured and iOS Mail can be deleted, so that version of
 * this button opens a blank compose window or nothing at all — and the report
 * we most want ("the dice froze on turn nine") is exactly the one nobody
 * retypes into a mail app. The message goes to the server, which stores it and
 * forwards it to the team inbox.
 *
 * The reply address is optional and asked for once, prefilled from the account
 * when there is one. Most senders are guests with no email anywhere in the
 * system, so without this field a reply has nowhere to go — but demanding it
 * would cost more reports than the replies are worth.
 *
 * Diagnostics (version, platform, phone model) are attached by net/api and are
 * about the BUILD, not the player. They are named in the footnote rather than
 * collected quietly.
 */

import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Sheet } from "./Sheet";
import { Field } from "./Field";
import { Button } from "./Button";
import { getIdentity } from "../lib/auth";
import { isTimeout, sendFeedback } from "../net/api";
import { deviceReport } from "../lib/deviceInfo";
import { font, palette, space } from "../theme";
import { useT } from "../i18n";

/** Matches the server clamp and the column check (0060). */
const MESSAGE_MAX = 2000;
/** Where the counter appears. Silent until the end is in sight — a live count
 *  from the first keystroke reads as a limit on what you are allowed to say. */
const COUNTER_FROM = 1700;

export function FeedbackSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [focused, setFocused] = useState<"message" | "email" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // Prefill from the account, when there is one. A guest gets an empty field
  // and no explanation of why — they are not missing anything.
  useEffect(() => {
    let live = true;
    void getIdentity()
      .then((id) => {
        if (live && id.email) setEmail(id.email);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const submit = async () => {
    if (busy) return;
    const text = message.trim();
    if (!text) {
      setError(t("feedback.needText"));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await sendFeedback(text, email, deviceReport());
      setSent(true);
    } catch (e) {
      // A timeout means the send may well have landed, so it must not read as
      // a failure that invites a second copy of the same report.
      setError(
        isTimeout(e)
          ? t("feedback.stillWaiting")
          : e instanceof Error && e.message
            ? e.message
            : t("chat.sendFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Sheet onClose={onClose} title={t("feedback.thanks")}>
        <Text style={{ fontFamily: font.regular, fontSize: 14, color: palette.porcelain }}>
          That's with us. A person reads every one of these
          {email.trim() ? ", and we'll reply to " + email.trim() + " if there's anything to say" : ""}.
        </Text>
        <Button label={t("common.done")} onPress={onClose} />
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} title={t("settings.sendFeedback")} keyboardAvoiding>
      <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
        A bug, an idea, or a game that went wrong — tell us what happened and we'll read it.
      </Text>

      <Field
        accessibilityLabel={t("feedback.title")}
        value={message}
        onChangeText={(t) => setMessage(t.slice(0, MESSAGE_MAX))}
        focused={focused === "message"}
        onFocus={() => setFocused("message")}
        onBlur={() => setFocused(null)}
        placeholder={t("feedback.whatHappened")}
        multiline
        // Room for a paragraph without the sheet swallowing the screen; it
        // keeps growing from here as they type.
        style={{ minHeight: 132, paddingTop: 16, textAlignVertical: "top" }}
        maxLength={MESSAGE_MAX}
      />
      {message.length >= COUNTER_FROM ? (
        <Text style={{ fontFamily: font.mono, fontSize: 11, color: palette.mutedSteel, textAlign: "right" }}>
          {MESSAGE_MAX - message.length} left
        </Text>
      ) : null}

      <Field
        accessibilityLabel={t("feedback.emailOptional")}
        value={email}
        onChangeText={setEmail}
        focused={focused === "email"}
        onFocus={() => setFocused("email")}
        onBlur={() => setFocused(null)}
        placeholder={t("feedback.emailOptionalLong")}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
      />

      {error ? <Text style={{ fontFamily: font.regular, fontSize: 13, color: "#E8705F" }}>{error}</Text> : null}

      <Button label={busy ? t("common.sending") : t("settings.sendFeedback")} onPress={() => void submit()} disabled={busy} />

      <View style={{ paddingTop: space.xs }}>
        <Text style={{ fontFamily: font.regular, fontSize: 11, color: palette.mutedSteel }}>
          Your app version and phone model are attached, so we can tell which build a bug came from.
        </Text>
      </View>
    </Sheet>
  );
}
