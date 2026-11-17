import { expect, it } from 'vitest';
import { cleanDisplayName } from '../src/lib/displayName';
it('preserves names in supported scripts',()=>{
 for(const name of ['Bishal','विशाल','বাংলা','علی','José','João']) expect(cleanDisplayName(name)).toBe(name);
});
it('normalizes equivalent spelling and strips control characters',()=>{
 expect(cleanDisplayName('Jose\u0301')).toBe('José');
 expect(cleanDisplayName('A\u202eB\n<script>')).toBe('ABscript');
});
it('bounds names by code points without splitting surrogate pairs',()=>{
 const name='𐐀'.repeat(25); expect(Array.from(cleanDisplayName(name))).toHaveLength(20);
});
