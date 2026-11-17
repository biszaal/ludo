import AsyncStorage from "@react-native-async-storage/async-storage";
import type { GemReceipt } from "./purchases";

// Individual keys avoid read-modify-write races between checkout and recovery.
const prefix = "ludo.pending-purchase.v1:";
const key = (r: GemReceipt) => prefix + encodeURIComponent(r.userId) + ":" + encodeURIComponent(r.transactionId);
const memory = new Map<string, GemReceipt>();

export async function rememberPurchase(receipt: GemReceipt): Promise<void> {
  memory.set(key(receipt), receipt);
  await AsyncStorage.setItem(key(receipt), JSON.stringify(receipt));
}

export async function pendingPurchases(userId: string): Promise<GemReceipt[]> {
  const keys = await AsyncStorage.getAllKeys();
  for (const k of keys.filter(k => k.startsWith(prefix + encodeURIComponent(userId) + ":"))) {
    try {
      const r = JSON.parse(await AsyncStorage.getItem(k) ?? "null") as GemReceipt | null;
      if (r && r.userId === userId && typeof r.productId === "string" && typeof r.transactionId === "string" && key(r) === k) memory.set(k, r);
    } catch { /* A corrupt local record cannot grant currency. */ }
  }
  return [...memory.values()].filter(r => r.userId === userId);
}

export async function forgetPurchase(receipt: GemReceipt): Promise<void> {
  await AsyncStorage.removeItem(key(receipt));
  memory.delete(key(receipt));
}
