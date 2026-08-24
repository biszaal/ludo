/**
 * What the "Watch an ad" row on the Gems sheet shows, and whether it may be
 * tapped. Pure, so the three states that are easy to conflate can be tested
 * without mounting a sheet or an ad SDK:
 *
 *   HIDDEN   the placement is switched off — no row at all.
 *   LIVE     views remain; the row is lit and starts an ad.
 *   SPENT    the allowance is gone; the row is greyed but STILL TAPPABLE,
 *            because a dead button never tells anyone why it's dead.
 *
 * "Spent" is specifically not "hidden" and not "disabled". A reward that
 * vanishes overnight reads as a bug, and a button that swallows the tap reads
 * as a broken one; a grey row that answers "come back tomorrow" reads as the
 * rule it actually is.
 *
 * `remaining` being undefined is the fourth state and the reason this is worth
 * testing: not-yet-known must behave like LIVE, never like SPENT. Greying the
 * row out because a status call timed out would hide a reward the player can
 * collect right now.
 */

export type GemAdRowView = {
  /** Row subtitle. */
  label: string;
  /** Render the row at all. */
  visible: boolean;
  /** Greyed, but the tap still lands so it can explain the limit. */
  spent: boolean;
};

export function gemAdRowView(opts: {
  /** ads.rewarded.gemGrant — the remote kill switch for this placement. */
  flagOn: boolean;
  /** gems.enabled — the whole premium tier. */
  tierOn: boolean;
  /** SDK up and consent allows requests. */
  adsAvailable: boolean;
  /** A watch is already in flight. */
  busy: boolean;
  /** Gems one view pays. */
  amount: number;
  /** Views allowed per day. */
  cap: number;
  /** Views left today per the server; undefined until the quota call lands. */
  remaining?: number;
  /** The server's own view of whether the tier is on. Undefined on old
   *  servers, which is not a reason to hide anything. */
  serverEnabled?: boolean;
}): GemAdRowView {
  const { flagOn, tierOn, adsAvailable, busy, amount, cap, remaining, serverEnabled } = opts;

  const visible = flagOn && tierOn && adsAvailable && serverEnabled !== false;
  const spent = remaining === 0;
  const gems = (n: number) => `${n} gem${n === 1 ? "" : "s"}`;

  const label = busy
    ? "Loading…"
    : spent
      ? "None left today"
      : remaining === undefined
        ? `${gems(amount)} · ${cap} a day`
        : `${gems(amount)} · ${remaining} of ${cap} left today`;

  return { label, visible, spent };
}
