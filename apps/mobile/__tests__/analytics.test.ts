import { expect, it, vi } from 'vitest';
import { configureAnalytics, trackProductEvent } from '../src/lib/analytics';
it('sends nothing before opt-in and stops immediately on withdrawal',async()=>{
 const send=vi.fn().mockResolvedValue(undefined); let consent=false;
 const stop=configureAnalytics(send,()=>consent);
 trackProductEvent('session_started'); expect(send).not.toHaveBeenCalled();
 consent=true; trackProductEvent('match_started','start:test');
 expect(send).toHaveBeenCalledExactlyOnceWith('match_started','start:test');
 consent=false; trackProductEvent('match_completed'); expect(send).toHaveBeenCalledTimes(1);
 stop(); consent=true; trackProductEvent('session_started'); expect(send).toHaveBeenCalledTimes(1);
});
it('measurement failures never fail gameplay',async()=>{
 const stop=configureAnalytics(vi.fn().mockRejectedValue(new Error('offline')),()=>true);
 expect(()=>trackProductEvent('invite_shared')).not.toThrow(); await Promise.resolve(); stop();
});
