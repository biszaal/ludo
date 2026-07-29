/**
 * The single guarded entry point to the ad SDK's JS package.
 *
 * `react-native-google-mobile-ads` resolves its TurboModule at *import* time via
 * `TurboModuleRegistry.getEnforcing`. On a runtime without the native side
 * compiled in — Expo Go, or a dev client built before ads landed — that import
 * throws during module evaluation and takes the whole app down before the first
 * frame renders, well before any of provider.ts's try/catch blocks can run.
 *
 * Requiring it here, once, inside a try/catch keeps that failure local and turns
 * it into the "no ads" degradation the rest of this folder already assumes.
 * A static `import` anywhere else in the app would reintroduce the crash.
 */

type AdsSdk = typeof import("react-native-google-mobile-ads");

let sdk: AdsSdk | null = null;
try {
  sdk = require("react-native-google-mobile-ads") as AdsSdk;
} catch {
  sdk = null;
}

/** The SDK surface, or null when the native module isn't in this binary. */
export const adsSdk = sdk;

/** False in Expo Go and in any build predating the ads dependency. */
export const adsSdkAvailable = sdk !== null;
