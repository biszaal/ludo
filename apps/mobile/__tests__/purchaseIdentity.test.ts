import { beforeEach, it, expect, vi } from 'vitest';
const sdk = vi.hoisted(() => ({
  configure: vi.fn(), setLogLevel: vi.fn(), logIn: vi.fn(), getAppUserID: vi.fn(),
  getProducts: vi.fn(), purchaseStoreProduct: vi.fn(), restorePurchases: vi.fn(),
}));
vi.mock('react-native-purchases', () => ({ default: sdk, LOG_LEVEL:{VERBOSE:'verbose'}, PURCHASE_TYPE:{INAPP:'inapp'} }));
let user = 'user-a';
let nativeUser = '$RCAnonymousID:test';
let purchases: typeof import('../src/lib/purchases');
beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks(); user='user-a'; nativeUser='$RCAnonymousID:test';
  sdk.logIn.mockImplementation(async (id) => {nativeUser=id;});
  sdk.getAppUserID.mockImplementation(async () => nativeUser);
  sdk.getProducts.mockResolvedValue([{identifier:'gems'}]);
  sdk.purchaseStoreProduct.mockResolvedValue({customerInfo:{entitlements:{active:{noads:{}}}}});
  sdk.restorePurchases.mockResolvedValue({entitlements:{active:{noads:{}}}});
  purchases=await import('../src/lib/purchases');
  await purchases.initPurchases('test-key', async () => user);
});
it('never opens checkout when attaching the game identity fails', async () => {
  sdk.logIn.mockRejectedValue(new Error('offline'));
  await purchases.syncPurchasesUser(user);
  expect(await purchases.purchaseGemProduct('gems')).toBe('unavailable');
  expect(await purchases.purchaseNoAds('noads')).toBe('unavailable');
  expect(await purchases.restorePurchases()).toBe(false);
  expect(sdk.purchaseStoreProduct).not.toHaveBeenCalled();
  expect(sdk.restorePurchases).not.toHaveBeenCalled();
});
it('retries identity attachment before checkout', async () => {
  sdk.logIn.mockRejectedValueOnce(new Error('offline'));
  await purchases.syncPurchasesUser(user);
  expect(await purchases.purchaseGemProduct('gems')).toBe('success');
  expect(nativeUser).toBe(user);
});
it('checks current game identity even when no auth synchronization ran', async () => {
  await purchases.syncPurchasesUser(user); user='user-b';
  expect(await purchases.purchaseNoAds('noads')).toBe('success');
  expect(nativeUser).toBe('user-b');
});
it('refuses checkout if the native SDK reports a different identity', async () => {
  sdk.getAppUserID.mockResolvedValue('$RCAnonymousID:wrong');
  expect(await purchases.purchaseGemProduct('gems')).toBe('unavailable');
  expect(sdk.purchaseStoreProduct).not.toHaveBeenCalled();
});
it('holds SDK identity stable until a store operation completes', async () => {
  let release!: () => void;
  const open = new Promise<void>(resolve => {release=resolve;});
  let started!: () => void;
  const opened = new Promise<void>(resolve => {started=resolve;});
  sdk.purchaseStoreProduct.mockImplementation(async () => {started(); await open;});
  const purchase = purchases.purchaseGemProduct('gems'); await opened;
  user='user-b'; const login = purchases.syncPurchasesUser(user);
  await Promise.resolve(); expect(nativeUser).toBe('user-a');
  release(); expect(await purchase).toBe('success'); await login;
  expect(nativeUser).toBe('user-b');
});
it('preserves user cancellation without treating it as a credit', async () => {
  sdk.purchaseStoreProduct.mockRejectedValue({userCancelled:true});
  expect(await purchases.purchaseGemProduct('gems')).toBe('cancelled');
});
