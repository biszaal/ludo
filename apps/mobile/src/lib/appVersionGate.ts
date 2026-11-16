/**
 * Whether this build is still allowed to run, decided from remote config.
 *
 * The floor arrives on the existing `config` document (`update.minVersion`).
 * Nothing here talks to the network: a missing, empty, or unparseable floor
 * is not a floor, so a bad dashboard edit cannot lock every player out. The
 * caller decides what "this build" is — that is `APP_VERSION`, the same string
 * Settings shows and every game call already sends — and only raises the gate
 * after a config read actually succeeded.
 */

export class AppVersionGate {
  /** Play Store application id. The 1.3.0 Android binary. */
  static readonly playStoreId = "com.biszaal.mobile";
  /** App Store id, without the `id` prefix the URL adds itself. */
  static readonly appStoreId = "6788536072";

  /**
   * Dotted numeric versions only (`1.3.0`). A `v` prefix, a pre-release tag,
   * or any other decoration makes the whole string unorderable so the caller
   * fails open instead of guessing.
   *
   * Missing segments count as zero, so `1.3` and `1.3.0` are the same build.
   */
  private static parts(version: string): number[] | null {
    const trimmed = version.trim();
    if (!trimmed) return null;
    const bits = trimmed.split(".");
    const nums: number[] = [];
    for (const bit of bits) {
      if (!/^\d{1,6}$/.test(bit)) return null;
      nums.push(Number(bit));
    }
    return nums;
  }

  /**
   * -1 when `current` is older, 0 when they are the same build, 1 when
   * `current` is newer. Null when either side is not a dotted numeric version.
   */
  static compare(current: string, other: string): -1 | 0 | 1 | null {
    const left = this.parts(current);
    const right = this.parts(other);
    if (!left || !right) return null;
    const length = Math.max(left.length, right.length);
    for (let i = 0; i < length; i++) {
      const a = left[i] ?? 0;
      const b = right[i] ?? 0;
      if (a < b) return -1;
      if (a > b) return 1;
    }
    return 0;
  }

  /**
   * Strictly older than `floor`. An empty or unparseable floor never matches,
   * and neither does an unparseable current version: both are "we don't know",
   * and not knowing must not block a player.
   */
  static below(current: string, floor: string): boolean {
    return this.compare(current, floor) === -1;
  }

  /**
   * HTTPS store page for this platform. Null anywhere else, so a build we
   * don't ship never gets sent to the wrong store.
   */
  /** Screens where a player is at a table. */
  private static readonly playScreens: readonly string[] = ["lobby", "onlineGame", "localGame", "frenzyGame"];

  /**
   * Must the update screen wait?
   *
   * It covers the whole app, and config can refresh at any moment — including
   * the middle of a match with a stake on it. Covering the board then would
   * cost the player the game. So while they are seated online, or any play
   * screen is on the stack, the screen is held back; it appears as soon as they
   * are off the table, and always at the next launch.
   */
  static defersFor(stack: readonly string[], seatedOnline: boolean): boolean {
    if (seatedOnline) return true;
    return stack.some((name) => this.playScreens.includes(name));
  }

  static storeUrl(platform: string): string | null {
    if (platform === "android") {
      return `https://play.google.com/store/apps/details?id=${this.playStoreId}`;
    }
    if (platform === "ios") {
      return `https://apps.apple.com/app/id${this.appStoreId}`;
    }
    return null;
  }
}
