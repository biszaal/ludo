import { expect, it } from 'vitest';
import { codeFromUrl, friendCodeFromUrl, friendInviteUrl, inviteUrl } from '../src/lib/inviteLinks';
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
it('builds and reads a friend link',()=>{
 expect(friendInviteUrl('k7pxq2')).toBe('https://www.biszaaltech.com/games/ludo?friend=K7PXQ2');
 expect(friendCodeFromUrl('https://www.biszaaltech.com/games/ludo?friend=K7PXQ2')).toBe('K7PXQ2');
 expect(friendCodeFromUrl('https://biszaaltech.com/games/ludo/?friend=k7pxq2')).toBe('K7PXQ2');
 // A friend link is not a room invite, and a room invite is not a friend link.
 expect(codeFromUrl(friendInviteUrl('K7PXQ2'))).toBeNull();
 expect(friendCodeFromUrl(inviteUrl('ABCD'))).toBeNull();
});
it('rejects friend codes outside the alphabet, duplicates and other hosts',()=>{
 for(const url of ['https://www.biszaaltech.com/games/ludo?friend=K7PXQ0','https://www.biszaaltech.com/games/ludo?friend=K7PX','https://www.biszaaltech.com/games/ludo?friend=K7PXQ2&friend=ABCDEF','https://evil.test/games/ludo?friend=K7PXQ2','http://www.biszaaltech.com/games/ludo?friend=K7PXQ2',null]) expect(friendCodeFromUrl(url)).toBeNull();
 expect(()=>friendInviteUrl('K7PXQ0')).toThrow();
});
