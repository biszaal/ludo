/**
 * The sound delay measured on this device, shared with the timing code.
 *
 * lib/sound measures how long this phone takes to sound an effect (its
 * calibration plays a clip silently at launch and on every return to the
 * front) and stores it here; lib/moveTiming and render/waypoints read it. It
 * lives in its own module, with no imports, so that the timing code can use it
 * and still run in the Node test suite — lib/sound pulls in expo-audio.
 *
 * Null until the first measurement lands, which keeps every timing exactly as
 * it was without one.
 */

let measuredLeadMs: number | null = null;

/** The lead, in ms, a sound must be asked for ahead of its beat — or null. */
export function measuredSoundLead(): number | null {
  return measuredLeadMs;
}

export function setMeasuredSoundLead(ms: number | null): void {
  measuredLeadMs = ms;
}
