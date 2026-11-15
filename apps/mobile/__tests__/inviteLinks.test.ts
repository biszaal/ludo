import { expect, it } from 'vitest';
import { codeFromUrl, inviteUrl } from '../src/lib/inviteLinks';
it('round-trips a room through the approved HTTPS landing page',()=>{
 expect(inviteUrl('abcd')).toBe('https://www.biszaaltech.com/games/ludo?room=ABCD');
 expect(codeFromUrl(inviteUrl('abcd'))).toBe('ABCD');
});
it('keeps supported old custom-scheme invites working',()=>{
 for(const url of ['ludobiszaal://join/ABCD','ludo:///join/ABCD']) expect(codeFromUrl(url)).toBe('ABCD');
});
it('rejects malformed rooms, duplicate parameters and untrusted hosts/schemes',()=>{
 for(const url of ['https://evil.test/games/ludo?room=ABCD','https://www.biszaaltech.com/games/ludo?room=ABCD&room=EFGH','https://www.biszaaltech.com/games/ludo?room=ABCDE','ludobiszaal://join/ABCD/extra','other://join/ABCD','https://user@www.biszaaltech.com/games/ludo?room=ABCD']) expect(codeFromUrl(url)).toBeNull();
 expect(()=>inviteUrl('AB/C')).toThrow();
});
