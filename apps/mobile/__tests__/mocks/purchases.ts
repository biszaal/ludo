// Vitest stub for react-native-purchases (a native module). The wallet store
// imports lib/purchases transitively; this keeps the Node test suite from
// loading native code. Nothing here is "configured", so store logic under test
// always takes the server-stub path.

export const LOG_LEVEL = { VERBOSE: "VERBOSE", DEBUG: "DEBUG", INFO: "INFO", WARN: "WARN", ERROR: "ERROR" } as const;
export const PURCHASE_TYPE = { SUBS: "subs", INAPP: "inapp" } as const;

const Purchases = {
  configure: (_config: unknown) => {},
  setLogLevel: (_level: unknown) => {},
  logIn: async (_appUserID: string) => ({ customerInfo: {}, created: false }),
  getProducts: async (_ids: string[], _type?: unknown) => [] as unknown[],
  purchaseStoreProduct: async (_product: unknown) => ({}),
};

export default Purchases;
