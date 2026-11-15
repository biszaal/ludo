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
