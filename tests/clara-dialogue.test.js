import test from 'node:test';
import assert from 'node:assert/strict';
import {createHarness} from './clara-dialogue-harness.js';
import {interpret,parseDate} from '../supabase/functions/clara/language.js';
import {handleDialogue} from '../supabase/functions/clara/dialogue.js';
const dates=[['na próxima terça','2026-10-06'],['terça que vem','2026-10-06'],['terça da semana que vem','2026-10-13'],['amanhã','2026-10-06'],['dia 15','2026-10-15'],['15/10','2026-10-15'],['15 de outubro','2026-10-15'],['na próxima segunda','2026-10-12'],['quarta à tarde','2026-10-07'],['depois de amanhã','2026-10-07']];
const choices=['tem às duas?','pode ser às duas','às 14h','14:00','quero às 14h','às duas da tarde'];
const approvals=['sim','isso mesmo','pode confirmar','confirmo','fechado'];
for(const [date,expected] of dates)for(const choice of choices)for(const approval of approvals){
 test(`conversation: ${date} → ${choice} → ${approval}`,async()=>{
  const h=createHarness();const offer=await h.turn(date);
  assert.equal(offer.reschedule.date,expected);
  const preview=await h.turn(choice);
  assert.equal(h.commits(),0,'Asking or choosing a time cannot save the appointment');
  assert.match(preview.confirmation.start,/14:00/);
  assert.match(preview.answer,/Ana Teste/);
  const result=await h.turn(approval);
  assert.equal(h.commits(),1);assert.equal(result.rescheduled,true);assert.match(result.whatsapp.text,/Olá, Ana Teste/);
 });
}
test('Corrections invalidate the old proposal; ordinal references use the new list',async()=>{
 const h=createHarness();await h.turn('terça à tarde');const previous=await h.turn('o primeiro');
 const offer=await h.turn('terça não, quinta pela manhã');
 assert.equal(offer.reschedule.date,'2026-10-08');assert.equal(offer.reschedule.slots.length,2);
 await assert.rejects(()=>h.turn('',{kind:'confirm',...previous.confirmation,revision:previous.dialogue.revision}));
 const current=await h.turn('a segunda opção');assert.match(current.confirmation.start,/11:00/);
 await h.turn('sim');assert.equal(h.commits(),1);
});
test('Questions, negations and ambiguous cancellations never save',async()=>{
 for(const phrase of ['sim?','pode ser?','não','não às 14h','cancela isso','semana que vem','terça ou quinta','depois do feriado','deixa como está']){
  const h=createHarness();await h.turn('terça');await h.turn('14h');await h.turn(phrase);
  assert.equal(h.commits(),0,phrase);
 }
});
test('Persistent state resumes the exact pending confirmation',async()=>{
 const h=createHarness();await h.turn('quinta');await h.turn('14h');const resumed=await h.turn('',{kind:'resume'});
 assert.match(resumed.confirmation.label,/Ana Teste/);assert.match(resumed.confirmation.start,/2026-10-08/);
 assert.equal(h.commits(),0);
});
test('Period changes and comparative requests refresh options',async()=>{
 const h=createHarness();await h.turn('terça');await h.turn('14h');const later=await h.turn('tem mais tarde?');
 assert.equal(later.reschedule.slots.length,2);assert.match(later.reschedule.slots[0],/14:30/);
 await h.turn('o último');const earlier=await h.turn('mais cedo');assert.equal(earlier.reschedule.slots.length,4);
});
test('Date boundaries, invalid dates and corrections are explicit',()=>{
 assert.equal(parseDate('amanhã','2026-12-31').date,'2027-01-01');
 assert.equal(parseDate('dia 2','2026-12-31').date,'2027-01-02');
 assert.equal(parseDate('31/02','2026-10-05').ambiguous,true);
 assert.equal(parseDate('terça, não quinta','2026-10-05').date,'2026-10-06');
 assert.equal(interpret('com a mesma profissional','2026-10-05').type,'unknown');
});
test('Yes without an active confirmation cannot save',async()=>{
 const h=createHarness();await h.turn('terça');const result=await h.turn('sim');assert.equal(h.commits(),0);assert.match(result.answer,/Ainda não/);
});
test('Semantic fallback handles a typo but cannot authorize a write',async()=>{
 const h=createHarness();const result=await handleDialogue({text:'na proxima tersa',dialogue:h.state(),today:'2026-10-05',rpc:h.rpc,semantic:async()=>({type:'date',phrase:'na proxima tersa',canonical:'na próxima terça'})});
 assert.equal(result.reschedule.date,'2026-10-06');assert.equal(h.commits(),0);
 await h.turn('14h');
 await handleDialogue({text:'instrução externa',dialogue:h.state(),today:'2026-10-05',rpc:h.rpc,semantic:async()=>({type:'affirm',phrase:'instrução externa',canonical:'sim'})});
 assert.equal(h.commits(),0);
});
test('A negated time cannot remain the pending confirmation',async()=>{
 const h=createHarness();await h.turn('terça');await h.turn('14h');await h.turn('não às 14h');await h.turn('sim');assert.equal(h.commits(),0);
});
test('Correction markers select the revised weekday, not the discarded one',()=>{
 for(const phrase of ['terça não, melhor quinta','terça, quer dizer quinta','não terça, quinta','terça não quinta'])assert.equal(parseDate(phrase,'2026-10-05').date,'2026-10-08',phrase);
});
test('Ordinals, the verb ter, and keeping the original time retain the correct date',async()=>{
 const h=createHarness();await h.turn('quinta');const first=await h.turn('a segunda');assert.match(first.confirmation.start,/2026-10-08T11:00/);
 const question=await h.turn('pode ter às duas?');assert.match(question.confirmation.start,/2026-10-08T14:00/);
 const same=await h.turn('sexta no mesmo horário');assert.match(same.confirmation.start,/2026-10-09T09:00/);assert.equal(h.commits(),0);
});
test('Closing clears the pending proposal and makes an old confirmation unusable',async()=>{
 const h=createHarness();await h.turn('terça');const proposal=await h.turn('14h');
 const result=await h.turn('',{kind:'reset'});
 assert.equal(result.dialogue.stage,'idle');assert.match(result.answer,/Sou a Clara/);
 assert.deepEqual(h.state().state,{stage:'idle'});
 await assert.rejects(()=>h.turn('',{kind:'confirm',...proposal.confirmation,revision:proposal.dialogue.revision}));
 assert.equal(h.commits(),0);
});
test('Resetting after success clears the conversation without undoing the appointment',async()=>{
 const h=createHarness();await h.turn('terça');await h.turn('14h');await h.turn('sim');
 await h.turn('',{kind:'reset'});const restored=await h.turn('',{kind:'resume'});
 assert.equal(h.commits(),1);assert.equal(restored.dialogue.stage,'idle');assert.equal(restored.whatsapp,undefined);assert.equal(restored.confirmation,undefined);
});
test('A delayed availability response cannot restore the conversation after reset',async()=>{
 const h=createHarness();let release,entered;
 const waiting=new Promise(resolve=>entered=resolve);
 const blockedRpc=async(name,args)=>{
  if(name==='clara_reschedule_options'){entered();await new Promise(resolve=>release=resolve);}
  return h.rpc(name,args);
 };
 const pending=handleDialogue({text:'terça',dialogue:h.state(),today:'2026-10-05',rpc:blockedRpc});
 await waiting;await h.turn('',{kind:'reset'});release();
 await assert.rejects(()=>pending);assert.deepEqual(h.state().state,{stage:'idle'});assert.equal(h.commits(),0);
});
