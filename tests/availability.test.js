import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findNextDates } from '../src/availability.js';
import { validPhone, normalizePhone } from '../src/contact.js';
test('range search uses exactly one call and preserves server pagination', async () => {
 let calls=0;
 const expected={dates:[{date:'2026-11-02',first:'2026-11-02T12:00:00Z'}],through:'2026-11-03',hasMore:true};
 const result=await findNextDates({after:'2026-10-30',until:'2026-11-30',fetchRange:async(a,b)=>{calls++;assert.equal(a,'2026-10-30');assert.equal(b,'2026-11-30');return expected;}});
 assert.deepEqual(result,expected);assert.equal(calls,1);
});
test('no request after the horizon',async()=>{
 const result=await findNextDates({after:'2026-10-17',until:'2026-10-17',fetchRange:()=>{throw Error('unexpected request');}});
 assert.equal(result.hasMore,false);
});
test('stale selection discards response',async()=>{
 let current=true;
 assert.equal(await findNextDates({after:'2026-10-01',until:'2026-10-30',isCurrent:()=>current,fetchRange:async()=>{current=false;return {};}}),null);
});
test('network error is not an empty agenda',async()=>{
 await assert.rejects(findNextDates({after:'2026-10-01',until:'2026-10-30',fetchRange:async()=>{throw Error('offline');}}),/offline/);
});
test('Brazilian phone accepts formatting and country code but rejects missing DDD and invalid input',()=>{
 assert.equal(normalizePhone('+55 (11) 99999-8888'),'11999998888');
 for(const value of ['(11) 99999-8888','+55 (11) 99999-8888','5533334444']) assert.equal(validPhone(value),true);
 for(const value of ['', '999998888','00123456789','11999999888888']) assert.equal(validPhone(value),false);
});
