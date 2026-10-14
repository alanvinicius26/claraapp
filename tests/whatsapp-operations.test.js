import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {migrateScheduling,schedulingFixture} from './scheduling-fixture.js';
import {sealToken,openToken,connectionHandler,metaConnections} from '../supabase/functions/whatsapp/connections.js';
import {createHandler,metaSender,providerPayload,simulationSender} from '../supabase/functions/whatsapp/core.js';
const config={META_ONBOARDING_ENABLED:'true',META_APP_ID:'123',META_SIGNUP_CONFIG_ID:'456',META_GRAPH_VERSION:'v99.0',META_APP_SECRET:'synthetic',WHATSAPP_TOKEN_ENCRYPTION_KEY:'ab'.repeat(32)};

test('Tokens are encrypted and cryptographically bound to the establishment',async()=>{
 const a=randomUUID(), b=randomUUID();const value=await sealToken('synthetic-token',a,config.WHATSAPP_TOKEN_ENCRYPTION_KEY);
 assert.ok(!JSON.stringify(value).includes('synthetic-token'));assert.equal(await openToken(value,a,config.WHATSAPP_TOKEN_ENCRYPTION_KEY),'synthetic-token');
 await assert.rejects(()=>openToken(value,b,config.WHATSAPP_TOKEN_ENCRYPTION_KEY));
 await assert.rejects(()=>openToken({...value,data:value.data.slice(0,-4)+'AAAA'},a,config.WHATSAPP_TOKEN_ENCRYPTION_KEY));
});
test('Durable inbox and customer-owned connection lifecycle',{timeout:120000},async t=>{
 const pg=new PGlite({extensions:{btree_gist}});const one=async(sql,args=[])=>(await pg.query(sql,args)).rows[0];
 const db=async(name,args={})=>(await one(`select public.${name}(${Object.keys(args).map((k,i)=>`${k}=>$${i+1}`).join(',')}) value`,Object.entries(args).map(([k,v])=>['p_data','p_payload'].includes(k)?JSON.stringify(v):v))).value;
 try{
  await migrateScheduling(pg);for(const name of ['whatsapp','whatsapp_operations'])await pg.exec(await readFile(new URL(`../supabase/${name}.sql`,import.meta.url),'utf8'));
  const a=await schedulingFixture(pg), b=await schedulingFixture(pg);
  await pg.query("insert into public.whatsapp_settings(studio_id,phone_number_id,enabled) values($1,'sim-a',true),($2,'sim-b',true)",[a.studio.id,b.studio.id]);
  const control=(owner,studio,action,data={})=>db('whatsapp_connect_control',{p_owner:owner,p_studio:studio,p_action:action,p_data:data});
  await t.test('ownership, replay, expiration and disconnect revoke in-flight signup',async()=>{
   await assert.rejects(()=>control(b.owner,a.studio.id,'status'),/Acesso negado/);
   const session=await control(a.owner,a.studio.id,'begin');await control(a.owner,a.studio.id,'consume',session);
   await assert.rejects(()=>control(a.owner,a.studio.id,'consume',session),/expirada/);
   const payload={...session,waba_id:'111',phone_number_id:'222',display_phone:'+55 fictício',verified_name:'QA',token_cipher:await sealToken('secret-a',a.studio.id,config.WHATSAPP_TOKEN_ENCRYPTION_KEY)};
   await control(a.owner,a.studio.id,'save',payload);
   assert.equal((await control(a.owner,a.studio.id,'status')).status,'connected');
   assert.equal((await one('select enabled from public.whatsapp_settings where studio_id=$1',[a.studio.id])).enabled,false);
   assert.equal(await db('whatsapp_worker_connection',{p_studio:a.studio.id,p_channel:'222'}),null);
   await pg.query('update public.whatsapp_settings set enabled=true where studio_id=$1',[a.studio.id]);
   assert.ok((await db('whatsapp_worker_connection',{p_studio:a.studio.id,p_channel:'222'})).token_cipher);
   assert.equal(await db('whatsapp_worker_connection',{p_studio:b.studio.id,p_channel:'222'}),null);
   await control(a.owner,a.studio.id,'disconnect');await assert.rejects(()=>control(a.owner,a.studio.id,'save',payload),/substituída/);
   assert.equal(await db('whatsapp_worker_connection',{p_studio:a.studio.id,p_channel:'222'}),null);
   const expired=await control(b.owner,b.studio.id,'begin');await pg.query("update encaixa_private.whatsapp_signup set expires_at=now()-interval '1 second' where id=$1",[expired.session_id]);
   await assert.rejects(()=>control(b.owner,b.studio.id,'consume',expired),/expirada/);
  });
  const event=(text,id=randomUUID())=>({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'sim-b'},messages:[{id,from:'5511900000101',timestamp:String(Math.floor(Date.now()/1000)),text:{body:text}}]}}]}]});
  const ingest=payload=>db('whatsapp_ingest',{p_key:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),p_payload:payload,p_mode:'simulation'});
  await t.test('persist before processing; replay never repeats greeting or handoff',async()=>{
   const payload=event('Olá');assert.equal((await ingest(payload)).duplicate,false);assert.equal((await ingest(payload)).duplicate,true);
   assert.equal(Number((await one('select count(*) n from public.whatsapp_conversations')).n),0);
   assert.equal((await db('whatsapp_dispatch',{p_mode:'simulation'})).processed,1);
   assert.equal(Number((await one("select count(*) n from public.whatsapp_messages where kind='greeting'")).n),1);
   const human=event('Falar com atendente');await ingest(human);
   assert.equal((await db('whatsapp_dispatch',{p_mode:'simulation'})).human_requests,1);
   const ack=await db('whatsapp_claim',{p_mode:'simulation'});assert.equal(ack.kind,'handoff');
   await db('whatsapp_finish',{p_id:ack.id,p_lease:ack.lease_id,p_result:'simulated'});
   assert.equal(await db('whatsapp_claim',{p_mode:'simulation'}),null);
   await ingest({...human,extra:'same message different envelope'});await db('whatsapp_dispatch',{p_mode:'simulation'});
   assert.equal(Number((await one("select count(*) n from public.whatsapp_messages where direction='in'")).n),2);
  });
  await t.test('bad event cannot roll back another event; bounded retries and single incident',async()=>{
   const bad=event('Agendar');bad.entry[0].changes[0].value.messages[0].timestamp='invalid';await ingest(bad);
   await ingest(event('Olá',randomUUID()));
   const first=await db('whatsapp_dispatch',{p_mode:'simulation'});assert.equal(first.failures,1);assert.equal(first.processed,1);
   for(let i=0;i<4;i++){await pg.exec("update encaixa_private.whatsapp_inbox set available_at=now() where status='pending'");await db('whatsapp_dispatch',{p_mode:'simulation'});}
   assert.equal(Number((await one("select count(*) n from encaixa_private.whatsapp_inbox where status='failed' and attempts=5")).n),1);
   for(let i=0;i<2;i++)assert.equal((await db('whatsapp_operations',{p_mode:'simulation',p_record:true})).needs_attention,true);
   assert.equal(Number((await one('select count(*) n from encaixa_private.whatsapp_incidents')).n),1);
  });
  await t.test('old terminal failures do not keep the incident open forever',async()=>{
   const health=()=>db('whatsapp_operations',{p_mode:'simulation',p_record:true});
   const open=async()=>Number((await one('select count(*) n from encaixa_private.whatsapp_incidents where resolved_at is null')).n);
   await pg.exec("update encaixa_private.whatsapp_inbox set available_at=now()-interval '2 hours' where status='failed'");
   assert.equal((await health()).needs_attention,false);assert.equal(await open(),0);
   const id=(await one("select id from public.whatsapp_messages where mode='simulation' limit 1")).id;
   await pg.query("update public.whatsapp_messages set status='failed',updated_at=now() where id=$1",[id]);
   assert.equal((await health()).failed_or_uncertain,1);assert.equal(await open(),1);
   await pg.query("update public.whatsapp_messages set updated_at=now()-interval '2 hours' where id=$1",[id]);
   assert.equal((await health()).needs_attention,false);assert.equal(await open(),0);
   assert.equal(Number((await one('select count(*) n from encaixa_private.whatsapp_incidents')).n),2); // history kept
  });
  await t.test('browser roles cannot read secrets/inbox or invoke service functions',async()=>{
   for(const role of ['anon','authenticated']){
    await assert.rejects(()=>pg.transaction(async tx=>{await tx.exec('set local role '+role);await tx.query('select * from encaixa_private.whatsapp_connections');}),/permission denied/);
    await assert.rejects(()=>pg.transaction(async tx=>{await tx.exec('set local role '+role);await tx.query("select public.whatsapp_dispatch('simulation')");}),/permission denied/);
   }
  });
  await t.test('connection HTTP validates user, consumes nonce and never returns token',async()=>{
   let exchange=0;
   const handler=connectionHandler({env:config,db,authenticate:async req=>req.headers.get('authorization')==='Bearer test'?b.owner:null,
    meta:{exchange:async()=>{exchange++;return{token:'private-token',waba_id:'777',phone_number_id:'888',display_phone:'fictício',verified_name:'Teste'};}}});
   const req=(body,auth=true)=>new Request('https://clara.invalid/connection',{method:'POST',headers:auth?{authorization:'Bearer test'}:{},body:JSON.stringify(body)});
   assert.equal((await handler(req({studio_id:b.studio.id,action:'begin'},false))).status,401);
   const session=await (await handler(req({studio_id:b.studio.id,action:'begin'}))).json();
   const data={studio_id:b.studio.id,action:'complete',...session,code:'synthetic-code',waba_id:'777',phone_number_id:'888'};
   const response=await handler(req(data));assert.equal(response.status,200);assert.ok(!(await response.text()).includes('private-token'));
   assert.equal((await handler(req(data))).status,400);assert.equal(exchange,1);
  });
 }finally{await pg.close();}
});

test('Verified Meta webhook is acknowledged only after durable ingestion',async()=>{
 const env={WHATSAPP_MODE:'live',WHATSAPP_LIVE_ENABLED:'true',META_APP_SECRET:'synthetic'};let called;
 const raw=JSON.stringify({object:'whatsapp_business_account',entry:[]});const signature='sha256='+createHmac('sha256',env.META_APP_SECRET).update(raw).digest('hex');
 const req=()=>new Request('https://clara.invalid/webhook',{method:'POST',headers:{'x-hub-signature-256':signature},body:raw});
 const handler=createHandler({env,db:async(name,args)=>{called={name,args};return{received:true};},send:simulationSender()});
 assert.equal((await handler(req())).status,200);assert.equal(called.name,'whatsapp_ingest');assert.equal(called.args.p_key.length,64);
 assert.equal((await createHandler({env,db:async()=>{throw new Error('database offline');},send:simulationSender()})(req())).status,503);
});
test('Meta onboarding verifies app, scopes and phone ownership before subscribing; no real calls',async()=>{
 const responses=[{access_token:'synthetic'},{data:{is_valid:true,app_id:'123',scopes:['whatsapp_business_management','whatsapp_business_messaging']}},{data:[{id:'222',display_phone_number:'fictício',verified_name:'Teste'}]},{success:true}];let calls=0;
 const api=metaConnections(config,async()=>new Response(JSON.stringify(responses[calls++])));
 assert.equal((await api.exchange('synthetic-code','111','222')).phone_number_id,'222');assert.equal(calls,4);
 const bad=metaConnections(config,async()=>new Response(JSON.stringify(responses[Math.min(calls++-4,2)])));
 await assert.rejects(()=>bad.exchange('synthetic-code','111','333'),/phone_not/);assert.equal(calls,7);
});
test('Live sends resolve tenant credentials and never fall back to a shared token',async()=>{
 const env={...config,WHATSAPP_MODE:'live',WHATSAPP_LIVE_ENABLED:'true',META_ACCESS_TOKEN:'must-not-use'};let auth;
 const job={mode:'live',studio_id:randomUUID(),channel:'222',phone:'5511900000101',kind:'greeting',body:'Olá'};
 const payload=providerPayload(job,'https://clara.invalid');assert.equal(payload.interactive.action.buttons[1].reply.id,'atendente');
 const send=metaSender(env,async(url,opts)=>{auth=opts.headers.Authorization;return new Response(JSON.stringify({messages:[{id:'wamid.synthetic'}]}));},async j=>{assert.equal(j.studio_id,job.studio_id);return 'tenant-token';});
 assert.equal((await send(job,payload)).result,'accepted');assert.equal(auth,'Bearer tenant-token');
 const blocked=metaSender(env,()=>{throw new Error('must not request');},async()=>null);assert.equal((await blocked(job,payload)).error,'connection_required');
});
