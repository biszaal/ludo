import { beforeEach, expect, it, vi } from 'vitest';
const disk = vi.hoisted(() => new Map<string,string>());
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
 getAllKeys: async () => [...disk.keys()],
 getItem: async (key: string) => disk.get(key) ?? null,
 setItem: async (key: string, value: string) => { disk.set(key,value); },
 removeItem: async (key: string) => { disk.delete(key); },
} }));
import storage from '@react-native-async-storage/async-storage';
beforeEach(async()=>{
  for(const key of await storage.getAllKeys()) if(key.startsWith('ludo.pending-purchase.v1:')) await storage.removeItem(key);
  vi.resetModules();
});
it('recovers a receipt after module restart and keeps account journals isolated',async()=>{
  let journal=await import('../src/lib/purchaseJournal');
  const receipt={userId:'a',productId:'gems.small',transactionId:'store:123'};
  await journal.rememberPurchase(receipt);
  vi.resetModules();
  journal=await import('../src/lib/purchaseJournal');
  // Reload clears the journal's memory while the simulated disk survives.
  expect(await storage.getItem('ludo.pending-purchase.v1:a:store%3A123')).toContain('store:123');
  expect(await journal.pendingPurchases('a')).toEqual([receipt]);
  expect(await journal.pendingPurchases('b')).toEqual([]);
});
it('removes only the delivered transaction',async()=>{
  const journal=await import('../src/lib/purchaseJournal');
  const first={userId:'a',productId:'gems.small',transactionId:'first'};
  const second={...first,transactionId:'second'};
  await journal.rememberPurchase(first); await journal.rememberPurchase(second);
  await journal.forgetPurchase(first);
  expect(await journal.pendingPurchases('a')).toEqual([second]);
});
