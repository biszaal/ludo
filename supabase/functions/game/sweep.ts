/**
 * Deleting guest accounts nobody has used in 90 days.
 *
 * The SQL side (0054) decides WHO. This decides nothing — it is the executor,
 * and every safety property it has comes from refusing to act on its own
 * judgement:
 *
 *   * it deletes only ids the database hands back from guest_sweep_confirm,
 *     re-checked at this instant, never the marks it read a moment earlier;
 *   * it purges orphan rows only for users it actually deleted;
 *   * it authenticates with a shared secret and fails closed if unset.
 *
 * Like opTick this runs with no user behind it, called by pg_cron through
 * pg_net, so there is no JWT to authorize against.
 */

import { json, secretMatches, type SupabaseClient } from "./lib.ts";

/**
 * Accounts deleted per run. The cron fires daily, so this is a ceiling on the
 * drain rate, not on throughput — a backlog empties over consecutive days,
 * oldest mark first. 200 admin-API calls at 4 in flight is ~5-8s of pure I/O
 * wait, far inside the edge budget.
 *
 * Raise internal_config.sweep_max_per_run to drain a large first backlog faster;
 * that needs no migration and no redeploy.
 */
const DEFAULT_MAX_PER_RUN = 200;

/** Admin-API calls in flight. Deliberately timid: the Auth endpoints are rate
 *  limited, and there is no deadline here worth racing. */
const CONCURRENCY = 4;

/** A mark the Auth API has refused this many times stops being retried. Five
 *  daily failures is a bug to look at, not a row to hammer forever. */
const MAX_ATTEMPTS = 5;

/** How long a mark must sit before it is acted on. The grace week: a user has to
 *  fail the check twice, seven days apart, before anything is destroyed. MUST
 *  match the gate in sweep_guests() — that gate decides whether this is even
 *  called, and a shorter window here would act on marks the gate never saw. */
const GRACE_DAYS = 7;

async function configInt(admin: SupabaseClient, key: string, fallback: number): Promise<number> {
  const { data } = await admin.from("internal_config").select("value").eq("key", key).maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Run `task` over `items` with a fixed number in flight. Order is not preserved
 *  and does not matter — every result is recorded by user id. */
async function pooled<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await task(items[i]);
    }
  });
  await Promise.all(workers);
}

export async function opSweepGuests(admin: SupabaseClient, req: Request): Promise<Response> {
  const expected = Deno.env.get("SWEEP_SECRET") ?? "";
  const given = req.headers.get("x-sweep-secret") ?? "";
  // Fail closed. An unset secret must never turn account deletion into an open
  // endpoint — the blast radius here is the entire guest userbase.
  if (!expected || !secretMatches(given, expected)) return json({ error: "Not authenticated." });

  const maxPerRun = await configInt(admin, "sweep_max_per_run", DEFAULT_MAX_PER_RUN);
  const days = await configInt(admin, "sweep_days", 90);

  const cutoff = new Date(Date.now() - GRACE_DAYS * 86_400_000).toISOString();
  const { data: marks } = await admin
    .from("guest_sweep_marks")
    .select("user_id")
    .lt("marked_at", cutoff)
    .lt("attempts", MAX_ATTEMPTS)
    .order("marked_at", { ascending: true })
    .limit(maxPerRun);

  const considered = marks?.length ?? 0;
  if (!considered) return json({ ok: true, considered: 0, confirmed: 0, deleted: 0, failed: 0 });

  const ids = marks!.map((m) => String(m.user_id));

  // The last safety net. A mark can be a week stale; the player may have come
  // back, bought something, or saved an account since. Anything the database
  // does not hand back here is silently skipped and its mark is left alone —
  // the next mark run will clear it.
  const { data: confirmedRows, error: confirmErr } = await admin.rpc("guest_sweep_confirm", {
    p_users: ids,
    p_days: days,
  });
  // A failed confirm means we cannot prove anyone is still a candidate, so we
  // delete nobody. Never fall back to the unconfirmed list.
  if (confirmErr) {
    console.error("[sweep.confirm]", confirmErr.message);
    return json({ error: "Sweep aborted." });
  }

  const confirmed: string[] = (confirmedRows ?? []).map((r: unknown) =>
    String(typeof r === "object" && r !== null && "user_id" in r ? (r as { user_id: unknown }).user_id : r)
  );

  const deleted: string[] = [];
  let failed = 0;

  await pooled(confirmed, CONCURRENCY, async (id) => {
    try {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw new Error(error.message);
      deleted.push(id);
    } catch (e) {
      // One user's failure must never abort the batch — a rate limit or a
      // transient 500 on one account would otherwise strand every account
      // behind it. Record it and move on; MAX_ATTEMPTS bounds the retrying.
      failed++;
      const message = e instanceof Error ? e.message : String(e);
      console.error("[sweep.delete]", id, message);
      await admin
        .from("guest_sweep_marks")
        .update({ attempts: (await currentAttempts(admin, id)) + 1, last_error: message.slice(0, 500) })
        .eq("user_id", id);
    }
  });

  // Only the users who are genuinely gone. A user whose deleteUser failed still
  // exists, and purging their seats and ledger would be the one thing here that
  // damages a live account.
  if (deleted.length) {
    const { error } = await admin.rpc("guest_sweep_purge", { p_users: deleted });
    if (error) console.error("[sweep.purge]", error.message);
  }

  // pg_net discards the response and cron only knows it POSTed, so this row is
  // the only durable record that the sweep ran at all.
  await admin.from("guest_sweep_runs").insert({
    considered,
    confirmed: confirmed.length,
    deleted: deleted.length,
    failed,
  });

  return json({ ok: true, considered, confirmed: confirmed.length, deleted: deleted.length, failed });
}

async function currentAttempts(admin: SupabaseClient, userId: string): Promise<number> {
  const { data } = await admin.from("guest_sweep_marks").select("attempts").eq("user_id", userId).maybeSingle();
  const n = Number(data?.attempts);
  return Number.isFinite(n) ? n : 0;
}
