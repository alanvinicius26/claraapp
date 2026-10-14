import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID, createHmac } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { migrateScheduling, schedulingFixture } from "./scheduling-fixture.js";
import { createHandler, processQueue, simulationSender, metaSender, providerPayload } from "../supabase/functions/whatsapp/core.js";

const env = { WHATSAPP_MODE:"simulation", APP_ORIGIN:"https://clara.example.invalid", CLARA_N8N_SECRET:"x".repeat(40), META_APP_SECRET:"synthetic" };

test("WhatsApp persistent lifecycle, permissions and deterministic automation", {timeout:120000}, async t => {
  const pg=new PGlite({extensions:{btree_gist}});
  const one=async(sql,args=[]) => (await pg.query(sql,args)).rows[0];
  const rpc=async(name,args) => (await one(`select public.${name}(${Object.keys(args).map((k,i)=>`${k}=>$${i+1}`).join(',')}) value`,Object.entries(args).map(([k,v])=>k==='p_data'?JSON.stringify(v):v))).value;
  const fixture=async()=> {
    await pg.exec('update public.whatsapp_settings set enabled=false');
    const f=await schedulingFixture(pg), channel='sim-'+randomUUID();
    await pg.query('insert into public.whatsapp_settings(studio_id,enabled,phone_number_id) values($1,true,$2)',[f.studio.id,channel]);
    return {...f,channel};
  };
  const inbound=(f,text='Olá',id=randomUUID(),phone='5511900000101')=>rpc('whatsapp_inbound',{p_channel:f.channel,p_id:id,p_phone:phone,p_body:text,p_at:new Date().toISOString(),p_mode:'simulation'});
  const booking=(f,optin=true,extra={})=>rpc('book_appointment_whatsapp',{p_slug:f.studio.slug,p_services:[f.free],p_start:f.at(),p_name:'Cliente Simulada',p_email:'',p_phone:'11900000101',p_notes:'',p_professional:f.p1,p_whatsapp_opt_in:optin,p_request_id:randomUUID(),...extra});
  const owner=async(f,action,data={})=>pg.transaction(async tx=>{
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[f.owner]); await tx.exec('set local role authenticated');
    return (await tx.query('select public.whatsapp_owner($1,$2,$3) value',[action,f.studio.id,JSON.stringify(data)])).rows[0].value;
  });
  try {
    await migrateScheduling(pg);
    await pg.exec(await readFile(new URL('../supabase/whatsapp.sql',import.meta.url),'utf8'));
    await t.test('greeting once, duplicate inbound once, tenant-correct booking link',async()=>{
      const f=await fixture(), id=randomUUID();
      await inbound(f,'Olá',id); assert.equal((await inbound(f,'Olá',id)).duplicate,true);
      await inbound(f,'Bom dia'); await inbound(f,'Agendar');
      const result=await processQueue({db:rpc,env,send:simulationSender()});
      assert.equal(result.simulated,2);
      const rows=(await pg.query("select * from public.whatsapp_messages where studio_id=$1 and direction='out'",[f.studio.id])).rows;
      assert.equal(rows.filter(x=>x.kind==='greeting').length,1);
      assert.ok(rows.find(x=>x.kind==='booking_link').body.endsWith('/#/booking/'+f.studio.slug));
      assert.equal((await processQueue({db:rpc,env,send:simulationSender()})).processed,0);
    });
    await t.test('human handoff pauses bot and notifications; manual reply is idempotent; closing resumes',async()=>{
      const f=await fixture(); await inbound(f); await inbound(f,'Falar com atendente'); await inbound(f,'Agendar');
      const c=(await owner(f,'list')).conversations[0]; assert.equal(c.mode,'human');
      assert.equal((await processQueue({db:rpc,env,send:simulationSender()})).simulated,1); // One handoff acknowledgement, then silence.
      assert.equal((await processQueue({db:rpc,env,send:simulationSender()})).processed,0);
      const data={conversation_id:c.id,body:'Olá, sou a atendente.',request_id:randomUUID()};
      await owner(f,'send',data); await owner(f,'send',data);
      assert.equal((await processQueue({db:rpc,env,send:simulationSender()})).simulated,1);
      await owner(f,'close',{conversation_id:c.id}); await inbound(f,'Agendar');
      assert.equal((await processQueue({db:rpc,env,send:simulationSender()})).simulated,1);
      await inbound(f,'Falar com atendente');await owner(f,'close',{conversation_id:c.id});
      assert.equal((await processQueue({db:rpc,env,send:simulationSender()})).processed,0); // Never announce a pause after it ended.
    });
    await t.test('booking consent, replay and exact reminder time are transactional',async()=>{
      const f=await fixture(), request=randomUUID();
      const a=await booking(f,true,{p_request_id:request});
      assert.deepEqual(await booking(f,true,{p_request_id:request}),a);
      await assert.rejects(()=>booking(f,true,{p_request_id:request,p_name:'Outro Nome'}));
      const rows=(await pg.query("select * from public.whatsapp_messages where appointment_id=$1",[a.id])).rows;
      assert.equal(rows.length,2);
      assert.equal(Date.parse(rows.find(m=>m.kind==='reminder').available_at),Date.parse(f.at())-86400000);
      const proof=await one('select * from public.whatsapp_consents where appointment_id=$1',[a.id]);
      assert.equal(proof.phone,'5511900000101');assert.equal(proof.version,'booking-whatsapp-v1');
      assert.equal((await processQueue({db:rpc,env,send:simulationSender()})).simulated,1);
      const msg=await one("select * from public.whatsapp_messages where appointment_id=$1 and kind='confirmation'",[a.id]);
      assert.match(msg.body,/Profissional: Principal/);assert.match(msg.body,/Sem recurso/);assert.ok(msg.body.includes(a.token));
    });
    await t.test('unchecked consent never queues notifications',async()=>{
      const f=await fixture(),a=await booking(f,false);
      assert.equal(Number((await one('select count(*) n from public.whatsapp_messages where appointment_id=$1',[a.id])).n),0);
      assert.equal(Number((await one('select count(*) n from public.whatsapp_consents where appointment_id=$1',[a.id])).n),0);
    });
    await t.test('rescheduling invalidates old messages, cancellation suppresses reminders',async()=>{
      const f=await fixture(),a=await booking(f);
      await pg.query("update public.appointments set starts_at=$2 where id=$1",[a.id,f.at('10:00')]);
      let rows=(await pg.query('select * from public.whatsapp_messages where appointment_id=$1',[a.id])).rows;
      assert.equal(rows.filter(m=>m.status==='cancelled').length,2);
      assert.equal(rows.filter(m=>m.status==='pending').length,2);
      await pg.query("update public.appointments set status='cancelled' where id=$1",[a.id]);
      assert.equal((await processQueue({db:rpc,env,send:simulationSender()})).simulated,1);
      rows=(await pg.query('select * from public.whatsapp_messages where appointment_id=$1',[a.id])).rows;
      assert.equal(rows.find(m=>m.kind==='cancellation').status,'simulated');
      assert.ok(rows.filter(m=>m.kind==='reminder').every(m=>m.status==='cancelled'));
    });
    await t.test('short-notice policy and per-studio reminder change',async()=>{
      const f=await fixture();
      await owner(f,'settings',{enabled:true,reminder_minutes:10080});
      // 7 days minus a few hours: same future fixture date but lead exceeds it.
      const tomorrow=(await one("select ((now() at time zone 'America/Sao_Paulo')::date+1)::text d")).d;
      const a=await booking(f,true,{p_start:f.at('09:00',tomorrow)});
      const reminder=await one("select * from public.whatsapp_messages where appointment_id=$1 and kind='reminder'",[a.id]);
      assert.equal(reminder.status,'cancelled'); assert.equal(reminder.error_code,'short_notice');
      assert.equal((await processQueue({db:rpc,env,send:simulationSender()})).simulated,1);
    });
    await t.test('opt out persists, cancels pending notifications, no new auto responses',async()=>{
      const f=await fixture(),a=await booking(f);await inbound(f,'SAIR');await inbound(f,'Agendar');
      assert.equal((await processQueue({db:rpc,env,send:simulationSender()})).processed,0);
      assert.ok((await one('select revoked_at from public.whatsapp_consents where appointment_id=$1',[a.id])).revoked_at);
    });
    await t.test('changed contact cannot reuse consent and old job cannot send',async()=>{
      const f=await fixture(),a=await booking(f);
      await pg.query("update public.clients set phone='11900000202' where id=(select client_id from public.appointments where id=$1)",[a.id]);
      assert.equal((await processQueue({db:rpc,env,send:simulationSender()})).processed,0);
      assert.equal((await one("select error_code from public.whatsapp_messages where appointment_id=$1 and kind='confirmation'",[a.id])).error_code,'consent_missing');
    });
    const merge=(f,source,target)=>pg.transaction(async tx=>{
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[f.owner]); await tx.exec('set local role authenticated');
      await tx.query('select public.merge_clients($1,$2)',[source,target]);
    });
    await t.test('merging duplicate clients keeps notifications only for the same consented number',async()=>{
      const f=await fixture(),a=await booking(f);
      const online=(await one('select client_id from public.appointments where id=$1',[a.id])).client_id;
      await pg.query("update public.clients set phone='(11) 90000-0101' where id=$1",[f.client]);
      await merge(f,online,f.client);
      const rows=(await pg.query("select kind,status from public.whatsapp_messages where appointment_id=$1 order by kind",[a.id])).rows;
      assert.deepEqual(rows,[{kind:'confirmation',status:'pending'},{kind:'reminder',status:'pending'}]);
      assert.equal((await one('select client_id from public.whatsapp_consents where appointment_id=$1',[a.id])).client_id,f.client);
      assert.equal((await processQueue({db:rpc,env,send:simulationSender()})).simulated,1);
      // A kept record with another number is a contact change: nothing goes to the old consent.
      const g=await fixture(),b=await booking(g);
      const other=(await one('select client_id from public.appointments where id=$1',[b.id])).client_id;
      await pg.query("update public.clients set phone='11900000202' where id=$1",[g.client]);
      await merge(g,other,g.client);
      assert.equal(Number((await one("select count(*) n from public.whatsapp_messages where appointment_id=$1 and status='pending'",[b.id])).n),0);
      assert.equal((await processQueue({db:rpc,env,send:simulationSender()})).processed,0);
    });
    await t.test('legacy Brazilian number without the ninth digit is the same contact',async()=>{
      const canonical=async p=>(await one('select encaixa_private.whatsapp_canonical($1) v',[p])).v;
      assert.equal(await canonical('551187650101'),'5511987650101');
      assert.equal(await canonical('5511987650101'),'5511987650101');
      assert.equal(await canonical('551132650101'),'551132650101'); // landline
      assert.equal(await canonical('12025550123'),'12025550123'); // other countries untouched
      const f=await fixture();
      await inbound(f,'Olá',randomUUID(),'551187650101');
      const a=await booking(f,true,{p_phone:'(11) 98765-0101'});
      assert.equal(Number((await one('select count(*) n from public.whatsapp_conversations where studio_id=$1',[f.studio.id])).n),1);
      await inbound(f,'SAIR',randomUUID(),'551187650101');
      assert.ok((await one('select revoked_at from public.whatsapp_consents where appointment_id=$1',[a.id])).revoked_at);
      assert.equal(Number((await one("select count(*) n from public.whatsapp_messages where appointment_id=$1 and status='pending'",[a.id])).n),0);
    });
    await t.test('24-hour manual window is enforced by SQL, not only UI',async()=>{
      const f=await fixture();await inbound(f);const c=(await owner(f,'list')).conversations[0];
      await pg.query("update public.whatsapp_conversations set last_inbound_at=now()-interval '24 hours' where id=$1",[c.id]);
      await assert.rejects(()=>owner(f,'send',{conversation_id:c.id,body:'Test',request_id:randomUUID()}),/Janela encerrada/);
      await assert.rejects(()=>owner(f,'send',{conversation_id:c.id,body:'Test',template_key:'human_followup',request_id:randomUUID()}),/Modelo/);
    });
    await t.test('revocation after queuing also blocks proactive manual templates',async()=>{
      const f=await fixture();await booking(f);await inbound(f);
      const c=(await owner(f,'list')).conversations[0];
      await pg.query(`update public.whatsapp_settings set templates='{"human_followup":{"approved":true,"name":"clara_human_followup_v1","language":"pt_BR"}}' where studio_id=$1`,[f.studio.id]);
      await owner(f,'send',{conversation_id:c.id,body:'Test',template_key:'human_followup',request_id:randomUUID()});
      await inbound(f,'SAIR');
      assert.equal((await processQueue({db:rpc,env,send:simulationSender()})).processed,0);
      assert.equal((await one("select status from public.whatsapp_messages where conversation_id=$1 and kind='manual'",[c.id])).status,'cancelled');
    });
    await t.test('RLS, cross-tenant references and worker RPC privileges',async()=>{
      const a=await fixture();await inbound(a);const c=(await owner(a,'list')).conversations[0];const b=await fixture();
      await assert.rejects(()=>owner(b,'history',{conversation_id:c.id}),/não encontrada/);
      await pg.transaction(async tx=>{
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[b.owner]);await tx.exec('set local role authenticated');
        assert.equal((await tx.query('select * from public.whatsapp_conversations where studio_id=$1',[a.studio.id])).rows.length,0);
      });
      for(const role of ['authenticated','anon']) await assert.rejects(()=>pg.transaction(async tx=>{await tx.exec('set local role '+role);await tx.query("select public.whatsapp_claim('simulation')");}),/permission denied/);
      await assert.rejects(()=>pg.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("update public.whatsapp_settings set mode='live'");}),/permission denied/);
    });
    await t.test('controlled retry, bounded attempts, expired leases never automatically resend',async()=>{
      const f=await fixture();await inbound(f);
      let count=0;
      const send=simulationSender({fail:()=>++count===1?'retry':null});
      assert.equal((await processQueue({db:rpc,env,send})).retry,1);
      assert.equal((await processQueue({db:rpc,env,send})).processed,0);
      await pg.query("update public.whatsapp_messages set available_at=now() where studio_id=$1 and status='pending'",[f.studio.id]);
      assert.equal((await processQueue({db:rpc,env,send})).simulated,1);
      await inbound(f,'Agendar');const job=await rpc('whatsapp_claim',{p_mode:'simulation'});
      await pg.query("update public.whatsapp_messages set lease_until=now()-interval '1 second' where id=$1",[job.id]);
      assert.equal(await rpc('whatsapp_claim',{p_mode:'simulation'}),null);
      assert.equal((await one('select status from public.whatsapp_messages where id=$1',[job.id])).status,'uncertain');
      await inbound(f,'Agendar');
      for(let attempt=1;attempt<=4;attempt++) {
        const rejected=await rpc('whatsapp_claim',{p_mode:'simulation'});assert.ok(rejected);
        await rpc('whatsapp_finish',{p_id:rejected.id,p_lease:rejected.lease_id,p_result:'retry',p_error:'provider_rate_limit'});
        const state=await one('select status,attempts from public.whatsapp_messages where id=$1',[rejected.id]);
        assert.equal(state.attempts,attempt);assert.equal(state.status,attempt===4?'failed':'pending');
        await pg.query("update public.whatsapp_messages set available_at=now() where id=$1",[rejected.id]);
      }
      assert.equal(await rpc('whatsapp_claim',{p_mode:'simulation'}),null);
    });
    await t.test('out-of-order receipts never mark simulated as delivered or regress read',async()=>{
      const f=await fixture();await inbound(f);await processQueue({db:rpc,env,send:simulationSender()});
      const simulated=await one("select * from public.whatsapp_messages where studio_id=$1 and direction='out'",[f.studio.id]);
      assert.equal(await rpc('whatsapp_receipt',{p_channel:f.channel,p_provider:simulated.provider_id,p_status:'delivered',p_at:new Date().toISOString()}),false);
      await pg.query("update public.whatsapp_settings set mode='live' where studio_id=$1",[f.studio.id]);
      await pg.query("insert into public.whatsapp_messages(studio_id,conversation_id,direction,kind,mode,body,dedupe_key,status,provider_id) values($1,$2,'out','manual','live','Teste','status-test','accepted','wamid.test')",[f.studio.id,simulated.conversation_id]);
      for(const status of ['delivered','sent','read','delivered','failed'])await rpc('whatsapp_receipt',{p_channel:f.channel,p_provider:'wamid.test',p_status:status,p_at:new Date().toISOString()});
      assert.equal((await one("select status from public.whatsapp_messages where provider_id='wamid.test'")).status,'read');
      assert.equal((await one('select status from public.whatsapp_messages where id=$1',[simulated.id])).status,'simulated');
      const lease=randomUUID();
      const early=await one("insert into public.whatsapp_messages(studio_id,conversation_id,direction,kind,mode,dedupe_key,status,lease_id) values($1,$2,'out','manual','live','early-receipt','sending',$3) returning id",[f.studio.id,simulated.conversation_id,lease]);
      await rpc('whatsapp_receipt',{p_channel:f.channel,p_provider:'wamid.early',p_status:'delivered',p_at:new Date().toISOString()});
      await rpc('whatsapp_finish',{p_id:early.id,p_lease:lease,p_result:'accepted',p_provider:'wamid.early'});
      assert.equal((await one('select status from public.whatsapp_messages where id=$1',[early.id])).status,'delivered');
    });
  } finally {await pg.close();}
});

test('bridge authentication, live gates and webhook signature fail closed',async()=>{
  let calls=0;const db=async()=>{calls++;return null;};
  const handler=createHandler({env,db,send:simulationSender()});
  const request=(path,body={},headers={})=>new Request('https://edge.invalid/'+path,{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal((await handler(request('process'))).status,401);assert.equal(calls,0);
  assert.equal((await handler(request('process',{}, {authorization:'Bearer '+env.CLARA_N8N_SECRET}))).status,200);
  assert.equal((await handler(request('webhook'))).status,401);
  const payload={object:'whatsapp_business_account',entry:[]};const signature='sha256='+createHmac('sha256',env.META_APP_SECRET).update(JSON.stringify(payload)).digest('hex');
  assert.equal((await handler(request('webhook',payload,{'x-hub-signature-256':signature}))).status,403);
  const live=createHandler({env:{...env,WHATSAPP_MODE:'live',WHATSAPP_LIVE_ENABLED:'true'},db,send:simulationSender()});
  assert.equal((await live(request('simulate-inbound',{}, {authorization:'Bearer '+env.CLARA_N8N_SECRET}))).status,403);
});
test('Meta accepted is not delivered; ambiguity is not retryable; no real fetch',async()=>{
  const live={...env,WHATSAPP_MODE:'live',WHATSAPP_LIVE_ENABLED:'true',META_GRAPH_VERSION:'v99.0',META_ACCESS_TOKEN:'synthetic'};
  const job={mode:'live',channel:'123',phone:'5511900000101',body:'Teste'};
  assert.equal((await metaSender(env,()=>{throw new Error('must not fetch')})(job,{})).error,'live_disabled');
  assert.equal((await metaSender(live,async()=>new Response(JSON.stringify({messages:[{id:'wamid.test'}]})))(job,{})).result,'accepted');
  assert.equal((await metaSender(live,async()=>{throw new Error('timeout')})(job,{})).result,'uncertain');
  assert.equal((await metaSender(live,async()=>new Response(JSON.stringify({error:{code:130497}}),{status:400}))(job,{})).result,'failed');
  assert.equal((await metaSender(live,async()=>new Response(JSON.stringify({error:{code:130429}}),{status:429}))(job,{})).result,'retry');
  assert.ok(providerPayload({...job,body:'Link: /#/booking/clara'},env.APP_ORIGIN).text.body.includes(env.APP_ORIGIN+'/#/booking/clara'));
});
