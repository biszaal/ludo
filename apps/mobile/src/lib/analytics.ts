/** Minimal opt-in events. No persistent queue, identifiers or free-form payloads. */
export type ProductEvent = 'session_started' | 'match_started' | 'match_completed' | 'matchmaking_cancelled' | 'reconnect' | 'invite_shared' | 'invite_joined' | 'purchase_delivered' | 'rewarded_ad_delivered';
let sink: ((name: ProductEvent, key: string) => Promise<void>) | null = null;
let permitted: () => boolean = () => false;
export function configureAnalytics(send: typeof sink, consent: () => boolean): () => void {
  sink = send; permitted = consent;
  return () => { sink = null; permitted = () => false; };
}
export function trackProductEvent(name: ProductEvent, key?: string): void {
  if (!permitted() || !sink) return;
  // No offline backlog: withdrawing consent cannot upload old activity later.
  void sink(name, key ?? `${name}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`).catch(() => {});
}
