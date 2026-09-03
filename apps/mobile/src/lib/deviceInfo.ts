/**
 * What phone this is, in the two strings a bug report needs.
 *
 * Kept out of net/api on purpose: that module is deliberately free of
 * react-native imports so the store tests can load it under Node, and reading
 * `Platform` there would drag Flow-typed React Native source into a Node-
 * environment test run. So the RN-side callers gather this and hand it over.
 *
 * Nothing here identifies a person. It is the build and the hardware — the
 * half of a bug report nobody ever thinks to include.
 */

import { Platform } from "react-native";
import * as Device from "expo-device";

export interface DeviceReport {
  /** "ios 18.5" / "android 34" — OS and its version, as one readable string. */
  platform: string;
  /** "iPhone14,2". Null on a simulator or where the OS won't say. */
  model: string | null;
}

export function deviceReport(): DeviceReport {
  return {
    platform: `${Platform.OS} ${String(Platform.Version)}`,
    model: Device.modelName ?? null,
  };
}
