import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const billing = vi.hoisted(() => ({ purchase: vi.fn() }));
const api = vi.hoisted(() => ({ getWalletState: vi.fn(), getGemPurchaseDelivery: vi.fn(), ensureSignedIn: vi.fn() }));
vi.mock('../src/lib/purchases', () => ({ isPurchasesConfigured: () => true, purchaseGemProduct: billing.purchase }));
vi.mock('../src/net/api', () => api);
import { useWallet } from '../src/store/walletStore';
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  useWallet.setState({gems:10,gemPurchaseStatus:'idle'});
  billing.purchase.mockImplementation(async (_id, onReceipt) => { await onReceipt({userId:'buyer',productId:'gems',transactionId:'txn'}); return 'success'; });
  api.ensureSignedIn.mockResolvedValue('buyer');
  api.getGemPurchaseDelivery.mockResolvedValue(null);
  api.getWalletState.mockResolvedValue({balance:500,gems:10,purchasedBalance:0});
});
afterEach(() => vi.useRealTimers());
it('reports pending delivery after a paid purchase without a webhook credit', async () => {
  const purchase=useWallet.getState().buyGems('gems'); await vi.runAllTimersAsync();
  expect(await purchase).toBe(0);
  expect(useWallet.getState().gemPurchaseStatus).toBe('pending');
});
it('reports delivery from its receipt even if the gems have already been spent', async () => {
  api.getWalletState.mockResolvedValue({balance:500,gems:0,purchasedBalance:0});
  api.getGemPurchaseDelivery.mockResolvedValue(60);
  const purchase=useWallet.getState().buyGems('gems'); await vi.runAllTimersAsync();
  expect(await purchase).toBe(60);
  expect(useWallet.getState().gemPurchaseStatus).toBe('delivered');
});
it('distinguishes cancellation and unavailable checkout from pending delivery', async () => {
  for (const outcome of ['cancelled','unavailable','error']) {
    billing.purchase.mockResolvedValue(outcome);
    expect(await useWallet.getState().buyGems('gems')).toBe(0);
    expect(useWallet.getState().gemPurchaseStatus).toBe(outcome);
  }
  expect(api.getWalletState).not.toHaveBeenCalled();
});

it('does not confuse unrelated gem earnings with purchase delivery', async () => {
  api.getWalletState.mockResolvedValue({balance:500,gems:999,purchasedBalance:0});
  const purchase=useWallet.getState().buyGems('gems'); await vi.runAllTimersAsync();
  expect(await purchase).toBe(0);
  expect(useWallet.getState().gemPurchaseStatus).toBe('pending');
});
it('ignores completion after the wallet switches accounts', async () => {
  const purchase=useWallet.getState().buyGems('gems');
  await vi.advanceTimersByTimeAsync(1);
  useWallet.getState().reset();
  api.getGemPurchaseDelivery.mockResolvedValue(60);
  await vi.runAllTimersAsync();
  expect(await purchase).toBe(0);
  expect(useWallet.getState().gemPurchaseStatus).toBe('idle');
  expect(useWallet.getState().gems).toBeNull();
});
it('recovers pending delivery on a later wallet refresh', async () => {
  const purchase=useWallet.getState().buyGems('gems'); await vi.runAllTimersAsync();
  await purchase;
  api.getGemPurchaseDelivery.mockResolvedValue(60);
  await useWallet.getState().refresh();
  expect(useWallet.getState().gemPurchaseStatus).toBe('delivered');
});
