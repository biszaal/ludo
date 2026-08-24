/**
 * The app's one confirmation prompt, as a promise.
 *
 * Destructive taps used to go through `Alert.alert`, which is the OS's dialog,
 * not ours — a white iOS card with a system font dropped on top of a felt-and-
 * brass game. Worse, the places that felt too small for a system modal grew
 * their own ad-hoc guards instead (PlayerProfileScreen's "tap again to block"),
 * so "are you sure" meant three different things depending on where you were,
 * and removing a friend meant none of them.
 *
 * One store, one rendered dialog (mounted once in App), and an imperative
 * `confirm()` that resolves true or false. That shape matters: a call site
 * turns into a single `await`, so guarding an action is cheap enough that
 * there's no excuse for a destructive tap to go unguarded.
 *
 *   if (!(await confirm({ title: "Remove Ada?", ... }))) return;
 *
 * Dismissing — backdrop tap, Android back, Cancel — always resolves false. A
 * prompt that could resolve neither way would strand the caller's await.
 */

import { create } from "zustand";

export interface ConfirmRequest {
  title: string;
  /** The consequence, in plain words. Say what is lost, not "are you sure". */
  message?: string;
  /** Label for the affirmative button. Name the ACTION ("Remove", "Leave"),
   *  never "OK" — the button text is the last thing read before it happens. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Paints the confirm button in the danger color. For anything that destroys
   *  data or cannot be undone. */
  destructive?: boolean;
  /** Telling, not asking: one full-width button and no Cancel.
   *
   *  A notice still resolves through the same promise (always true — there is
   *  no "no" to give), so call sites that only want to be read can `await
   *  notice(...)` and ignore it. Kept on this store rather than growing a
   *  second dialog: the shell, the animation and the back-button handling are
   *  identical, and only the button row differs. */
  notice?: boolean;
}

interface ConfirmState {
  /** The prompt on screen, or null. */
  request: ConfirmRequest | null;
  /** Settles the open prompt; owned by the store, never called from outside. */
  resolve: ((ok: boolean) => void) | null;
  ask: (request: ConfirmRequest) => Promise<boolean>;
  answer: (ok: boolean) => void;
}

export const useConfirm = create<ConfirmState>((set, get) => ({
  request: null,
  resolve: null,

  ask: (request) =>
    new Promise<boolean>((resolve) => {
      // A second prompt while one is open would orphan the first one's await.
      // The newest ask wins and the older one is answered "no" — the safe
      // reading, since its own dialog is about to vanish unanswered.
      const pending = get().resolve;
      if (pending) pending(false);
      set({ request, resolve });
    }),

  answer: (ok) => {
    const { resolve } = get();
    set({ request: null, resolve: null });
    resolve?.(ok);
  },
}));

/**
 * Ask the player to confirm. Resolves true only if they tapped the affirmative
 * button — every other way out is false.
 */
export function confirm(request: ConfirmRequest): Promise<boolean> {
  return useConfirm.getState().ask(request);
}

/**
 * Say something that needs acknowledging but has no alternative — "that's all
 * for today". One button, and every way out (button, backdrop, Android back)
 * settles the same, because a notice cannot be declined.
 */
export function notice(request: Omit<ConfirmRequest, "notice" | "destructive">): Promise<boolean> {
  return useConfirm.getState().ask({ confirmLabel: "Got it", ...request, notice: true });
}
