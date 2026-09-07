/**
 * A named collection of timers with an exhaustive teardown.
 *
 * Written for the online store, which had eleven separate module-level timer
 * handles and a `leave()` that cleared them by naming eleven different
 * clear-functions. That worked, and it was verified only by reading: nothing
 * stopped a twelfth timer being added beside the others and quietly not being
 * torn down. On that screen the cost of getting it wrong is a callback firing
 * into a game the player has already left — a write against a stale game id, or
 * a board reload with nothing behind it.
 *
 * Keying timers by name makes the invariant structural. `clearAll` walks
 * whatever has been armed, so a timer added through `set` is torn down without
 * anybody remembering to come back and edit the teardown. The name type is a
 * parameter so callers can close it over a union and have a typo be a build
 * error rather than a second, invisible timer.
 */
export class TimerSet<Name extends string> {
  private handles = new Map<Name, ReturnType<typeof setTimeout>>();
  /**
   * Which handles are intervals.
   *
   * `clearTimeout` and `clearInterval` are interchangeable in browsers and in
   * React Native, but they are NOT in Node's typings and are not guaranteed to
   * be by the spec. Remembering the kind costs one Set and removes the question.
   */
  private intervals = new Set<Name>();

  /** Arm a one-shot, replacing any timer already under this name. */
  set(name: Name, fn: () => void, ms: number): void {
    this.clear(name);
    this.handles.set(
      name,
      setTimeout(() => {
        // Drop the handle BEFORE running the callback. A callback that re-arms
        // its own timer — the autopilot step and the resync both do — would
        // otherwise have its new handle immediately overwritten by this
        // bookkeeping, leaving a live timer the set no longer knows about.
        this.handles.delete(name);
        this.intervals.delete(name);
        fn();
      }, ms),
    );
  }

  /**
   * Arm a repeating timer.
   *
   * Never replaces a running one: the callers that repeat (a lobby keep-warm
   * ping) mean "make sure this is running", and restarting would reset the
   * cadence every time something asked.
   */
  setInterval(name: Name, fn: () => void, ms: number): void {
    if (this.handles.has(name)) return;
    this.handles.set(name, setInterval(fn, ms));
    this.intervals.add(name);
  }

  /** Is this timer currently armed? Several callers debounce on this. */
  has(name: Name): boolean {
    return this.handles.has(name);
  }

  clear(name: Name): void {
    const h = this.handles.get(name);
    if (h === undefined) return;
    if (this.intervals.has(name)) clearInterval(h);
    else clearTimeout(h);
    this.handles.delete(name);
    this.intervals.delete(name);
  }

  /** Teardown. Exhaustive by construction — the whole point of the class. */
  clearAll(): void {
    for (const name of [...this.handles.keys()]) this.clear(name);
  }

  /** Armed timer names. For tests and diagnostics; not part of the hot path. */
  armed(): Name[] {
    return [...this.handles.keys()];
  }
}
