/**
 * Wire the connection store to the device and to the network layer.
 *
 * Kept as thin as it looks on purpose: everything with a decision in it lives
 * in netQuality.ts (pure, tested) or connectionStore.ts (no native imports,
 * tested). This file is the only part that touches expo-network, which is
 * exactly the part a Node test cannot run — so there is nothing here worth
 * testing and nothing here that decides anything.
 *
 * Returns a stop function, like initFriends/initPresence/initDeepLinks.
 */

import * as Network from "expo-network";
import { reachableFrom } from "./netQuality";
import { setLinkMonitor } from "../net/api";
import { useConnection } from "../store/connectionStore";

export function initConnection(): () => void {
  const store = useConnection.getState();

  // Give api.ts its view of the link. Until this runs, every call behaves
  // exactly as it did before any of this existed.
  setLinkMonitor({
    observe: (rttMs) => useConnection.getState().observeCall(rttMs),
    isOffline: () => useConnection.getState().link === "offline",
    waitForOnline: (budgetMs) => useConnection.getState().waitForOnline(budgetMs),
  });

  // Seed from the current state; the listener only reports changes, so without
  // this a device that launches offline would read as online until it recovered.
  void Network.getNetworkStateAsync()
    .then((s) => useConnection.getState().setReachable(reachableFrom(s)))
    .catch(() => {
      // Unknown beats a guess — see reachableFrom.
    });

  const sub = Network.addNetworkStateListener((s) => {
    useConnection.getState().setReachable(reachableFrom(s));
  });

  return () => {
    sub.remove();
    setLinkMonitor(null);
    // Release anything parked on waitForOnline rather than leaving a retry
    // ladder holding a promise nobody will ever settle.
    store.reset();
  };
}
