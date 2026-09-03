/**
 * "Send feedback" — the write, and the forward to the team inbox.
 *
 * Two halves with deliberately different guarantees. The row (0060) is the
 * record and the caller waits on it; the email is a convenience and the caller
 * never does. A mail provider that is unset, throttled or down must not turn a
 * player's bug report into an error message, so the forward runs after the
 * response and only stamps `forwarded_at` when it actually lands. Anything it
 * misses is still in the table, findable by `forwarded_at is null`.
 *
 * Mail goes out through Resend, which is one HTTPS POST and no SDK. Configure:
 *
 *   supabase secrets set RESEND_API_KEY=re_...
 *   supabase secrets set FEEDBACK_TO=biszaalgames@gmail.com            # optional
 *   supabase secrets set FEEDBACK_FROM="Ludo <onboarding@resend.dev>"  # optional
 *
 * With no key set the op still works and simply keeps everything in the table.
 * Swapping providers is one fetch call — nothing else here knows about Resend.
 */

import { afterResponse, json, LIMITS, rateLimited, rateOk, safeError, type SupabaseClient } from "./lib.ts";

/** Matches the column check. Long enough for a real bug report, short enough
 *  that the table cannot be used as free storage. */
const MESSAGE_MAX = 2000;
const EMAIL_MAX = 254;
/** Deliberately loose: this address is for replying to a human, never for
 *  authentication, so the only job here is to reject obvious junk. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Control characters, which have no business in either half of this: in the
 *  row they corrupt the queue's readability, and in the email a stray CR is
 *  how header injection starts. Newline and tab are kept in the message only. */
const CONTROL_ALL = /[\u0000-\u001f\u007f]/g;
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0008\u000b-\u000d\u000e-\u001f\u007f]/g;

const DEFAULT_TO = "biszaalgames@gmail.com";
/** Resend's shared sender. It needs no verified domain, which is what lets
 *  this ship before anyone owns a mail domain — it can only deliver to the
 *  address the Resend account was registered with, and that is the one
 *  recipient we have. Point FEEDBACK_FROM at a real domain later and nothing
 *  else changes. */
const DEFAULT_FROM = "Ludo Feedback <onboarding@resend.dev>";

/** One line of the client's report, clamped and flattened so a crafted value
 *  cannot forge headers or wreck the email body. */
function line(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(CONTROL_ALL, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return clean || null;
}

/**
 * File one piece of feedback.
 *
 * No moderation filter on the way in: this text is read by us and shown to
 * nobody, so masking someone's swearing would only make their complaint harder
 * to understand. The clamps are about the shape of the row, not its tone.
 */
export async function opSendFeedback(
  admin: SupabaseClient,
  userId: string,
  req: { message: unknown; email: unknown; appVersion: unknown; platform: unknown; device: unknown },
): Promise<Response> {
  if (!(await rateOk(admin, userId, "feedback", LIMITS.feedback))) return rateLimited();

  // Newlines survive here where `line()` would flatten them — paragraphs are
  // how a person describes a sequence of events, and this is read by eye.
  const message = typeof req.message === "string"
    ? req.message.replace(CONTROL_EXCEPT_NEWLINE, "").trim().slice(0, MESSAGE_MAX)
    : "";
  if (!message) return json({ error: "Write a little about what happened first." });

  const typed = line(req.email, EMAIL_MAX);
  const contactEmail = typed && EMAIL_RE.test(typed) ? typed.toLowerCase() : null;
  if (typed && !contactEmail) {
    return json({ error: "That email doesn't look right. Leave it blank to send anyway." });
  }

  const { data, error } = await admin
    .from("feedback")
    .insert({
      user_id: userId,
      message,
      contact_email: contactEmail,
      app_version: line(req.appVersion, 32),
      platform: line(req.platform, 32),
      device: line(req.device, 120),
    })
    .select("id")
    .single();
  if (error) return safeError("feedback.insert", error, "Couldn't send that. Try again in a moment.");

  // The sender is already done; the inbox can wait for the round trip.
  afterResponse(forward(admin, String(data.id), { message, contactEmail, userId, req }));
  return json({ ok: true });
}

/**
 * Best-effort forward to the team inbox. Every failure path is a console line
 * and nothing else — the row is already saved, and the caller has already been
 * told it worked, because it was.
 */
async function forward(
  admin: SupabaseClient,
  id: string,
  ctx: {
    message: string;
    contactEmail: string | null;
    userId: string;
    req: { appVersion: unknown; platform: unknown; device: unknown };
  },
): Promise<void> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return; // unconfigured is not an error — see the file header

  // The display name makes the inbox readable; its absence never stops a send.
  const { data: profile } = await admin
    .from("profiles")
    .select("display_name")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  const who = line(profile?.display_name, 40) ?? "a player";

  const version = line(ctx.req.appVersion, 32) ?? "?";
  const platform = line(ctx.req.platform, 32) ?? "?";
  const device = line(ctx.req.device, 120) ?? "?";

  const text = [
    ctx.message,
    "",
    "—",
    `from:     ${who}`,
    `reply to: ${ctx.contactEmail ?? "(none given)"}`,
    `version:  ${version}`,
    `device:   ${platform} · ${device}`,
    `user id:  ${ctx.userId}`,
    `row:      feedback/${id}`,
  ].join("\n");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("FEEDBACK_FROM") ?? DEFAULT_FROM,
        to: [Deno.env.get("FEEDBACK_TO") ?? DEFAULT_TO],
        // Replying in the mail client should reach the player when they left an
        // address, and go nowhere when they didn't.
        ...(ctx.contactEmail ? { reply_to: ctx.contactEmail } : {}),
        subject: `Ludo feedback · ${who} · v${version}`,
        text,
      }),
    });
    if (!res.ok) {
      console.error("[feedback.forward]", res.status, (await res.text()).slice(0, 200));
      return;
    }
    await admin.from("feedback").update({ forwarded_at: new Date().toISOString() }).eq("id", id);
  } catch (e) {
    console.error("[feedback.forward]", e instanceof Error ? e.message : e);
  }
}
