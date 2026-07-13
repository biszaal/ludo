/**
 * Supabase client (singleton). Reads client-safe config from EXPO_PUBLIC_* env
 * (see apps/mobile/.env). Auth sessions persist in AsyncStorage so a reopened
 * app stays signed in — important for reconnecting to an in-progress game.
 */

import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export const isSupabaseConfigured = Boolean(url && publishableKey);

const client: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, publishableKey, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
      // Faster dead-socket detection (default ~30s): a game client should
      // notice a dropped realtime connection and resync within seconds.
      realtime: { heartbeatIntervalMs: 15000 },
    })
  : null;

/** The configured client, or throw a clear error if env is missing. */
export function getSupabase(): SupabaseClient {
  if (!client) {
    throw new Error(
      "Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in apps/mobile/.env.",
    );
  }
  return client;
}
