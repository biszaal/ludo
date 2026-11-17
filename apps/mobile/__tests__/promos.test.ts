/**
 * Our own apps stand in for a banner Google left empty (owner request,
 * 2026-11-18). All of them are App Store only today.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/i18n', () => ({}));

import { PROMOS, nextPromo, promoUrl, promosFor } from '../src/lib/ads/promos';

describe('promos', () => {
  it('offers all four apps on iOS and none on Android', () => {
    expect(promosFor('ios').map((p) => p.id).sort()).toEqual(['cascade', 'expenzez', 'helicopter', 'itrackhabit']);
    expect(promosFor('android')).toEqual([]);
  });

  it('links each one to its own App Store page', () => {
    const urls = Object.fromEntries(PROMOS.map((p) => [p.id, promoUrl(p)]));
    expect(urls).toEqual({
      cascade: 'https://apps.apple.com/app/id6810394977',
      helicopter: 'https://apps.apple.com/app/id6786880982',
      itrackhabit: 'https://apps.apple.com/app/id6751805707',
      expenzez: 'https://apps.apple.com/app/id6751338089',
    });
  });

  it('takes turns, so two slots in a row do not show the same app', () => {
    const list = promosFor('ios');
    const seen = list.map(() => nextPromo(list)!.id);
    expect(new Set(seen).size).toBe(list.length);
  });

  it('has nothing to offer when the platform has no apps', () => {
    expect(nextPromo([])).toBeNull();
  });
});
