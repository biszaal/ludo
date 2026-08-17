/**
 * Account durability — turning a guest into a recoverable account, and back.
 *
 * Play is guest-first: the app signs in anonymously (net/api ensureSignedIn) and
 * everything — wallet, gems, entitlements, profile — is keyed to that user id.
 * Saving an account UPGRADES that anonymous user in place (same id), so nothing
 * migrates: the coins/gems/cosmetics simply become recoverable. Signing in on a
 * new device restores the same id, and its purchases with it.
 *
 * Nothing here forces a login. A player who never saves an account keeps
 * playing as a guest forever — they just carry the reinstall risk.
 */

import { getSupabase } from "./supabase";
import { forgetIdentity } from "./identityClient";
import { syncPurchasesUser } from "./purchases";
import { getProfiles, deleteAccount as apiDeleteAccount } from "../net/api";
import { useWallet } from "../store/walletStore";
import { useEntitlements } from "../store/entitlementsStore";
import { useProfile } from "../store/profileStore";

export interface AuthIdentity {
  userId: string | null;
  /** True for a not-yet-saved anonymous player (or no session yet). */
  isGuest: boolean;
  email: string | null;
}

export type AuthResult = { ok: true; needsConfirm: boolean } | { ok: false; error: string };

/** Who the current session belongs to — a guest, or a saved account. */
export async function getIdentity(): Promise<AuthIdentity> {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  const u = data.session?.user;
  if (!u) return { userId: null, isGuest: true, email: null };
  return { userId: u.id, isGuest: (u.is_anonymous ?? false) || !u.email, email: u.email ?? null };
}

/** Upgrade the current guest into an email+password account, in place. */
export async function saveAccount(email: string, password: string): Promise<AuthResult> {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.updateUser({ email: email.trim().toLowerCase(), password });
  if (error) return { ok: false, error: friendly(error.message) };
  // With email confirmations on, the address is pending until the link is
  // clicked; sign-in on another device only works once confirmed.
  const confirmed = Boolean(data.user?.email_confirmed_at ?? data.user?.confirmed_at);
  return { ok: true, needsConfirm: !confirmed };
}

/** Restore a saved account on this device, replacing the current guest session,
 *  then pull its wallet / entitlements / profile down. */
export async function signIn(email: string, password: string): Promise<AuthResult> {
  const supabase = getSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) return { ok: false, error: friendly(error.message) };
  await rehydrateAfterAuth();
  return { ok: true, needsConfirm: false };
}

/** Leave a saved account and return to a fresh guest session. */
export async function signOutToGuest(): Promise<void> {
  const supabase = getSupabase();
  await supabase.auth.signOut();
  // Drop the keychain lifeline first, or ensureSignedIn would helpfully restore
  // the account we were just asked to leave. Safe to lose: the account signed
  // out of here is a saved one, recoverable with its email and password.
  await forgetIdentity();
  await supabase.auth.signInAnonymously();
  await rehydrateAfterAuth();
}

/** Permanently delete the account and all its server data, then drop the player
 *  back to a clean guest on this device. Required by the app stores for any app
 *  that lets you create an account. Irreversible — the caller confirms first. */
export async function deleteAccount(): Promise<AuthResult> {
  try {
    await apiDeleteAccount();
  } catch {
    return { ok: false, error: "Could not delete your account. Please try again." };
  }
  // Server data is gone (auth user + cascade). Reset this device to a fresh
  // guest so nothing from the deleted account lingers locally.
  const supabase = getSupabase();
  await supabase.auth.signOut().catch(() => {});
  // The auth user is gone server-side, so its refresh token is worthless — but
  // leaving it in the keychain would have every later launch try to recover a
  // deleted account before giving up.
  await forgetIdentity();
  resetLocalIdentity();
  await supabase.auth.signInAnonymously().catch(() => {});
  await rehydrateAfterAuth();
  return { ok: true, needsConfirm: false };
}

/** Wipe the on-device identity + cached balances back to first-launch defaults. */
function resetLocalIdentity(): void {
  const p = useProfile.getState();
  p.setName(""); // empty falls back to this device's guest handle
  p.setAvatar("leo");
  p.setDiceSkin("classic");
  useWallet.setState({
    balance: null,
    gems: null,
    purchasedBalance: 0,
    streakDay: 0,
    bonusClaimable: false,
    pityAvailable: false,
  });
  useEntitlements.setState({ owned: [], prices: {}, currencies: {}, buying: null });
}

/** After the signed-in user changes, resync everything keyed to the user id.
 *  Best-effort and independent — one failure never blocks the others. */
async function rehydrateAfterAuth(): Promise<void> {
  const { data } = await getSupabase().auth.getSession();
  const uid = data.session?.user.id ?? null;
  await Promise.allSettled([
    useWallet.getState().refresh(),
    useEntitlements.getState().refresh(),
    hydrateProfileFromServer(),
    syncPurchasesUser(uid), // attach RevenueCat purchases to the now-current user
  ]);
}

/** Pull the account's saved name / avatar / dice skin into the local profile,
 *  so a restored account looks like itself and not this device's guest defaults. */
async function hydrateProfileFromServer(): Promise<void> {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return;
  const [me] = await getProfiles([uid]);
  if (!me) return;
  const p = useProfile.getState();
  if (me.display_name) p.setName(me.display_name);
  if (me.avatar_id) p.setAvatar(me.avatar_id);
  if (me.dice_skin) p.setDiceSkin(me.dice_skin);
}

/** Turn Supabase's raw auth messages into something a player can act on. */
function friendly(msg: string): string {
  const m = msg.toLowerCase();
  if (/already registered|already been registered|already exists|user already/.test(m))
    return "That email already has an account — use Sign in instead.";
  if (/invalid login|invalid credentials/.test(m)) return "Wrong email or password.";
  if (/email not confirmed|not confirmed/.test(m)) return "Confirm your email first — check your inbox.";
  if (/password/.test(m) && /6|short|weak|length/.test(m)) return "Password must be at least 6 characters.";
  if (/rate|too many/.test(m)) return "Too many tries — wait a moment and try again.";
  return msg;
}
