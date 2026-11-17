/**
 * The end-of-game interstitial plays on Home after a game is left — finished or
 * quit — and never on the board (owner rule, 2026-11-17).
 */
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ show: vi.fn(), appState: { current: 'active' } }));
vi.mock('react-native', () => ({
  AppState: {
    get currentState() { return mocks.appState.current; },
    addEventListener: () => ({ remove: () => {} }),
  },
  Platform: { OS: 'ios' },
}));
vi.mock('../src/lib/ads/provider', () => ({ showInterstitial: mocks.show }));
vi.mock('../src/store/adsStore', () => ({
  useAds: { getState: () => ({ noteInterstitialShown: vi.fn() }) },
  canShowInterstitial: () => true,
}));
vi.mock('../src/store/configStore', () => ({ useConfig: { getState: () => ({ config: {} }) } }));
vi.mock('../src/store/entitlementsStore', () => ({
  useEntitlements: { getState: () => ({ owned: [], noAdsRestored: false }) },
  noAdsActive: () => false,
}));

type Listener = () => void;
const nav = vi.hoisted(() => ({ stack: [{ name: 'home' }] as { name: string }[], listeners: new Set<() => void>() }));
const online = vi.hoisted(() => ({ status: 'idle', listeners: new Set<(s: unknown, p: unknown) => void>() }));
vi.mock('../src/store/navStore', () => ({
  useNav: {
    getState: () => ({ stack: nav.stack }),
    subscribe: (l: Listener) => { nav.listeners.add(l); return () => nav.listeners.delete(l); },
  },
}));
vi.mock('../src/store/onlineStore', () => ({
  useOnlineStore: {
    getState: () => ({ status: online.status }),
    subscribe: (l: (s: unknown, p: unknown) => void) => { online.listeners.add(l); return () => online.listeners.delete(l); },
  },
}));

import { AFTER_GAME_SETTLE_MS, homeIsClear, markGameLeft, testingOnlyReset, watchAfterGameAd } from '../src/lib/ads/afterGameAd';

function goTo(...names: string[]) {
  nav.stack = names.map((name) => ({ name }));
  for (const l of nav.listeners) l();
}
function setOnline(status: string) {
  const prev = { status: online.status };
  online.status = status;
  for (const l of online.listeners) l({ status }, prev);
}

describe('homeIsClear', () => {
  const at = (stack: string[], onlineStatus = 'idle', appActive = true) => homeIsClear({ stack, onlineStatus, appActive });
  it('is true only on Home with nothing being played or searched for', () => {
    expect(at(['home'])).toBe(true);
    expect(at(['home'], 'finished')).toBe(true);
  });
  it('is false on any game or matchmaking screen, even a finished game being watched', () => {
    expect(at(['home', 'onlineGame'], 'finished')).toBe(false);
    expect(at(['home', 'onlineGame'], 'active')).toBe(false);
    expect(at(['home', 'localGame'])).toBe(false);
    expect(at(['home', 'frenzyGame'])).toBe(false);
    expect(at(['home', 'lobby'], 'lobby')).toBe(false);
  });
  it('is false while a quick match is connecting from Home', () => {
    expect(at(['home'], 'connecting')).toBe(false);
  });
  it('is false away from Home and in the background', () => {
    expect(at(['home', 'shop'])).toBe(false);
    expect(at(['home'], 'idle', false)).toBe(false);
  });
});

describe('the after-game ad', () => {
  let stop: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    testingOnlyReset();
    mocks.show.mockReset().mockResolvedValue(true);
    nav.stack = [{ name: 'home' }, { name: 'onlineGame' }];
    online.status = 'active';
    stop = watchAfterGameAd();
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it('plays once the player has left the game and Home has settled', async () => {
    markGameLeft();
    setOnline('idle');
    goTo('home');
    expect(mocks.show).not.toHaveBeenCalled(); // not during the screen change
    await vi.advanceTimersByTimeAsync(AFTER_GAME_SETTLE_MS + 1);
    expect(mocks.show).toHaveBeenCalledTimes(1);
  });

  it('never plays while the player is still on the board, finished or watching', async () => {
    setOnline('finished');
    goTo('home', 'onlineGame');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.show).not.toHaveBeenCalled();
  });

  it('does not play when nothing was left (Home reached some other way)', async () => {
    setOnline('idle');
    goTo('home');
    await vi.advanceTimersByTimeAsync(AFTER_GAME_SETTLE_MS + 1);
    expect(mocks.show).not.toHaveBeenCalled();
  });

  it('drops the ad when the player starts another game before it lands', async () => {
    markGameLeft();
    setOnline('idle');
    goTo('home');
    setOnline('connecting'); // tapped PLAY again within the settle window
    await vi.advanceTimersByTimeAsync(AFTER_GAME_SETTLE_MS + 1);
    expect(mocks.show).not.toHaveBeenCalled();
    setOnline('idle');
    goTo('home');
    await vi.advanceTimersByTimeAsync(AFTER_GAME_SETTLE_MS + 1);
    expect(mocks.show).not.toHaveBeenCalled();
  });

  it('plays only one ad per game left', async () => {
    markGameLeft();
    setOnline('idle');
    goTo('home');
    await vi.advanceTimersByTimeAsync(AFTER_GAME_SETTLE_MS + 1);
    goTo('home', 'shop');
    goTo('home');
    await vi.advanceTimersByTimeAsync(AFTER_GAME_SETTLE_MS + 1);
    expect(mocks.show).toHaveBeenCalledTimes(1);
  });
});
