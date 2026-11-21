export const INVITE_BASE = 'https://www.biszaaltech.com/games/ludo';
export function inviteUrl(code: string): string {
  const normalized = code.toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(normalized)) throw new Error('Invalid room code');
  return `${INVITE_BASE}?room=${normalized}`;
}
export function codeFromUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.port) return null;
    let code: string | null = null;
    if (url.protocol === 'https:' && ['www.biszaaltech.com','biszaaltech.com'].includes(url.hostname) && url.pathname.replace(/\/$/,'') === '/games/ludo') {
      if(url.searchParams.getAll('room').length !== 1) return null;
      code=url.searchParams.get('room');
    } else if (['ludobiszaal:','ludo:'].includes(url.protocol)) {
      const path = [url.hostname,...url.pathname.split('/')].filter(Boolean);
      if(path.length === 2 && path[0] === 'join') code=path[1];
    }
    return code && /^[A-Za-z0-9]{4}$/.test(code) ? code.toUpperCase() : null;
  } catch { return null; }
}
/** The friend-code alphabet (0015): no O/0/I/1. */
const FRIEND_CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
/** A friend's landing link. The site sends a new player to the store with the
 *  code in the install referrer; the app, if installed, opens Add Friend. */
export function friendInviteUrl(code: string): string {
  const normalized = code.toUpperCase();
  if (!FRIEND_CODE.test(normalized)) throw new Error('Invalid friend code');
  return `${INVITE_BASE}?friend=${normalized}`;
}
export function friendCodeFromUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.port) return null;
    if (url.protocol !== 'https:' || !['www.biszaaltech.com','biszaaltech.com'].includes(url.hostname)) return null;
    if (url.pathname.replace(/\/$/,'') !== '/games/ludo') return null;
    if (url.searchParams.getAll('friend').length !== 1) return null;
    const code = (url.searchParams.get('friend') ?? '').toUpperCase();
    return FRIEND_CODE.test(code) ? code : null;
  } catch { return null; }
}
