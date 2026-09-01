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

import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
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

/**
 * The providers a guest can link. Apple is not optional on iOS: the App Store
 * requires Sign in with Apple wherever a third-party login is offered.
 */
export type LinkProvider = "google" | "apple";

/**
 * Where the provider sends the player back to. A registered scheme (app.json
 * lists `ludobiszaal` and `ludo`) so the redirect reopens the app rather than
 * stranding them in a browser tab.
 */
const LINK_REDIRECT_PATH = "auth/link";

/**
 * Link a Google or Apple identity to the CURRENT anonymous user.
 *
 * The word "link" is load-bearing and is why this is not the native one-tap
 * sheet. `signInWithIdToken` — which is what a native Apple/Google dialog feeds
 * — signs into the PROVIDER's user, a different auth.users row, leaving the
 * guest's coins, gems and entitlements behind on an id nobody will ever reach
 * again. That is exactly how five accounts were stranded in August, and
 * unpicking one took hand-written SQL against production balances.
 *
 * `linkIdentity` attaches the provider to the user already signed in, so the id
 * never changes and nothing has to move. The cost is an OAuth round trip
 * through a browser sheet instead of a native dialog. That is a worse few
 * seconds in exchange for an entire class of bug that cannot happen.
 *
 * REQUIRES "manual linking" to be enabled on the Supabase project (Auth →
 * Providers). Without it the call is refused outright, which is why the failure
 * below is reported rather than swallowed — a silent no-op here looks to the
 * player like their account was saved when it was not.
 */
export async function linkProvider(provider: LinkProvider): Promise<AuthResult> {
  return runOAuth(provider, "link");
}

/**
 * Sign in with a provider already linked to an account — the other half, and
 * the half that makes linking worth anything.
 *
 * Linking on one phone is only useful if there is a way back on the next one. A
 * fresh install is a brand-new guest, so there is nothing to link TO: this
 * replaces that guest's session with the account the provider owns, exactly as
 * signIn(email, password) does.
 *
 * Which means it does the one thing linkProvider is careful never to do — end
 * up on a different user id. That is correct here and not there: this device's
 * guest is minutes old and holds nothing, while the account being restored is
 * the one with the coins in it.
 */
export async function signInWithProvider(provider: LinkProvider): Promise<AuthResult> {
  return runOAuth(provider, "signin");
}

/**
 * The browser round trip both paths share.
 *
 * `linkIdentity` attaches to the current user; `signInWithOAuth` replaces it.
 * Everything either side of that — building the redirect, driving the sheet,
 * exchanging the code, resyncing — is identical, and duplicating it would be
 * two chances to get the exchange wrong on the one flow that decides whether a
 * player keeps their purchases.
 */
async function runOAuth(provider: LinkProvider, intent: "link" | "signin"): Promise<AuthResult> {
  const supabase = getSupabase();
  const redirectTo = Linking.createURL(LINK_REDIRECT_PATH);
  const options = { redirectTo, skipBrowserRedirect: true };
  try {
    const { data, error } =
      intent === "link"
        ? await supabase.auth.linkIdentity({ provider, options })
        : await supabase.auth.signInWithOAuth({ provider, options });
    if (error) return { ok: false, error: friendlyLink(error.message) };
    if (!data?.url) return { ok: false, error: "Couldn't start sign-in. Try again." };

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    // "cancel" and "dismiss" are the player closing the sheet. Not an error, and
    // reporting it as one would tell somebody their account failed to save when
    // they simply changed their mind. The empty string means "say nothing".
    if (result.type !== "success") return { ok: false, error: "" };

    const code = new URL(result.url).searchParams.get("code");
    if (!code) return { ok: false, error: "Sign-in didn't complete. Try again." };
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) return { ok: false, error: friendlyLink(exchangeError.message) };

    // On the link path the id is unchanged, so this is a refresh rather than a
    // migration — but it still has to run: the account now carries an email, and
    // the Account screen must stop calling them a guest. On the sign-in path it
    // is what pulls the restored account's wallet and cosmetics down.
    await rehydrateAfterAuth();
    return { ok: true, needsConfirm: false };
  } catch {
    return { ok: false, error: "Couldn't reach the sign-in page. Check your connection." };
  }
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
  // A new guest's life starts over, so the save-account asks do too — otherwise
  // someone who deleted an account and kept playing would never be asked again.
  p.resetSavePrompt();
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

/**
 * Link failures a player can act on.
 *
 * The identity-already-linked case is the one worth naming: it means that Google
 * or Apple account is attached to a DIFFERENT Ludo account, so linking would
 * have to choose which set of coins to keep. It cannot, and neither can we
 * silently — so the player is told, and pointed at signing in instead.
 */
function friendlyLink(msg: string): string {
  const m = msg.toLowerCase();
  if (/manual linking|not enabled|disabled/.test(m))
    return "Account linking isn't switched on yet. Try again later.";
  if (/already.*linked|identity.*already|already.*exists/.test(m))
    return "That account is already linked to another Ludo profile. Sign in to it instead.";
  if (/rate|too many/.test(m)) return "Too many tries — wait a moment and try again.";
  return "Couldn't link that account. Try again.";
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
