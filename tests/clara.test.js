import test from "node:test";
import assert from "node:assert/strict";
import {validatePlan,renderAnswer} from "../supabase/functions/clara/core.js";
import {extendedQuery} from "../supabase/functions/clara/queries.js";
import {whatsappLink,rescheduleMessage} from "../src/clara-whatsapp.js";
import {relativeDay,selectedSlot,optionsReply,confirmationReply} from "../supabase/functions/clara/reschedule.js";
test('Relative weekdays resolve across weeks and year boundaries',()=>{
 assert.equal(relativeDay('Remarque para terça que vem','2026-10-05'),'2026-10-06');
 assert.equal(relativeDay('terça que vem','2026-10-06'),'2026-10-13');
 assert.equal(relativeDay('terça da semana que vem','2026-10-05'),'2026-10-13');
 assert.equal(relativeDay('amanhã','2026-12-31'),'2027-01-01');
});
test('Typed time confirms only an exact offered slot and renders real confirmation details',()=>{
 const options={slots:['2026-10-06T17:00:00Z'],date:'2026-10-06',oldStart:'2026-10-05T12:00:00Z',appointmentId:'a1',client:'Ana',service:'Manicure',professional:'Bia'};
 assert.equal(selectedSlot('às 14h',options),options.slots[0]);
 assert.equal(selectedSlot('Não quero 14:00',options),null);
 assert.equal(selectedSlot('14:15',options),null);
 assert.match(optionsReply(options).answer,/terça-feira, 6 de outubro/);
 assert.match(confirmationReply({client:'Ana',startsAt:options.slots[0],oldStart:options.oldStart,service:'Manicure',professional:'Bia',studio:'Estúdio'}).whatsapp.text,/Olá, Ana!/);
});
test("WhatsApp encodes editable text and rejects missing contact",()=>{
 const message=rescheduleMessage({starts_at:'2026-10-05T13:00:00Z',service_name:'Manicure',clients:{name:'Ana'}},'2026-10-06T14:00:00Z',{name:'Estúdio'},'Bia');
 assert.match(message,/10:00/);assert.match(message,/11:00/);
 assert.equal(new URL(whatsappLink('(11) 99999-8888',message)).searchParams.get('text'),message);
 assert.equal(whatsappLink('',message),null);
 assert.equal(whatsappLink('99999-8888',message),null);
});
test("Clara never picks an ambiguous client or queries appointments for them",async()=>{
 let calls=0;
 const response=await extendedQuery({kind:'clients',client:'Ana'},async()=>{calls++;return [{id:'1',name:'Ana A'},{id:'2',name:'Ana B'}];});
 assert.equal(calls,1);assert.match(response.answer,/mais de um/);assert.equal(response.actions,undefined);
});
test("Client history uses client id, inclusive dates and only confirmed actions",async()=>{
 const response=await extendedQuery({kind:'clients',client:'Ana',from:'2026-10-01',to:'2026-10-05'},async(table,params)=>{
  if(table==='clients')return [{id:'c1',name:'Ana'}];
  assert.equal(params.client_id,'eq.c1');assert.match(params.and,/2026-10-06T00:00:00-03:00/);
  return [{id:'a1',starts_at:'2026-10-05T12:00:00Z',status:'cancelled',service_name:'Manicure',price:50}];
 });
 assert.match(response.answer,/Cancelado/);assert.deepEqual(response.actions,[]);
});
test("Clara rejects arbitrary operations and invalid or excessive periods",()=>{
 assert.equal(validatePlan({kind:'help',from:'2026-10-05',to:'2026-10-05',client:null,answer:'Ajuda'}).client,undefined);
 for(const plan of [
  {kind:"delete",from:"2026-10-05",to:"2026-10-05"},
  {kind:"agenda",from:"2026-02-30",to:"2026-03-01"},
  {kind:"agenda",from:"2026-10-05",to:"2026-10-04"},
  {kind:"revenue",from:"2024-01-01",to:"2026-10-05"}
 ]) assert.throws(()=>validatePlan(plan));
 assert.equal(validatePlan({kind:"revenue",from:"2026-09-28",to:"2026-10-04"}).kind,"revenue");
});
test("Clara distinguishes received cash from scheduled value and profit",()=>{
 const period={from:"2026-10-01",to:"2026-10-05"};
 assert.match(renderAnswer({...period,kind:"revenue"},{received:1234.56,payments:4}),/1.234,56/);
 assert.match(renderAnswer({...period,kind:"revenue"},{received:0,payments:0}),/não representa lucro/);
 assert.match(renderAnswer({...period,kind:"summary"},{appointments:5,completed:2,scheduled_value:500}),/não significa dinheiro recebido/);
});
test("Clara formats appointments in Sao Paulo and identifies truncated lists",()=>{
 const a={starts_at:"2026-10-06T01:00:00Z",client:"Cliente sintética",service_name:"Manicure",professional:"Profissional",status:"confirmed"};
 const plan={kind:"agenda",from:"2026-10-05",to:"2026-10-05"};
 const answer=renderAnswer(plan,Array(31).fill(a));
 assert.match(answer,/05\/10\/2026/);assert.match(answer,/22:00/);
 assert.match(answer,/primeiros 30/);
 assert.match(renderAnswer({...plan,kind:"next"},[]),/não tem próximos/);
});
