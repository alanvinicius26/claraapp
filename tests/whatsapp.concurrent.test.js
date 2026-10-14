// Independent native PostgreSQL connections; isolated data, no remote credentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { migrateScheduling, schedulingFixture } from './scheduling-fixture.js';
const localRequire=createRequire(new URL('../.local/pg-test/package.json',import.meta.url));
const {Client}=localRequire('pg'), run=promisify(execFile);
const binary=resolve('.local/pg-test/node_modules/@embedded-postgres/windows-x64/native/bin');
test('WhatsApp native PostgreSQL concurrency', {timeout:120000}, async t=>{
  const dir=await mkdtemp(resolve('.local/whatsapp-pg-')),data=join(dir,'data'),pw=join(dir,'password');
  const password=randomBytes(24).toString('hex');await writeFile(pw,password);
  let started=false;const clients=[];
  const connect=async()=>{const c=new Client({host:'127.0.0.1',port:55441,user:'whatsapp_test',password,database:'postgres',connectionTimeoutMillis:5000});await c.connect();clients.push(c);await c.query("set statement_timeout='15s';set lock_timeout='10s'");return c;};
  try {
    await run(join(binary,'initdb.exe'),['-D',data,'-U','whatsapp_test','--auth=scram-sha-256',`--pwfile=${pw}`,'--encoding=UTF8','--locale=C'],{windowsHide:true,timeout:30000});
    await run(join(binary,'pg_ctl.exe'),['-D',data,'-l',join(dir,'postgres.log'),'-o','-h 127.0.0.1 -p 55441','-w','start'],{windowsHide:true,timeout:30000});started=true;
    const admin=await connect(),db={exec:sql=>admin.query(sql),query:(sql,args)=>admin.query(sql,args)};
    await migrateScheduling(db);await admin.query(await readFile(new URL('../supabase/whatsapp.sql',import.meta.url),'utf8'));
    await admin.query(await readFile(new URL('../supabase/whatsapp_operations.sql',import.meta.url),'utf8'));
    const f=await schedulingFixture(db);await admin.query("insert into public.whatsapp_settings(studio_id,enabled,phone_number_id) values($1,true,'concurrent-sim')",[f.studio.id]);
    const connections=await Promise.all(Array.from({length:8},connect));
    await t.test('eight concurrent inbound redeliveries produce one greeting',async()=>{
      const id=randomUUID();const results=await Promise.all(connections.map(c=>c.query("select public.whatsapp_inbound('concurrent-sim',$1,'5511900000101','Olá',now(),'simulation') r",[id])));
      assert.equal(results.filter(x=>x.rows[0].r.duplicate).length,7);
      assert.equal(Number((await admin.query("select count(*) n from public.whatsapp_messages where direction='out'")).rows[0].n),1);
    });
    await t.test('eight simultaneous booking replays share one reservation and consent',async()=>{
      const request=randomUUID();const results=await Promise.all(connections.map(c=>c.query("select public.book_appointment_whatsapp($1,$2,$3,'QA WhatsApp','','11900000101','',$4,true,$5) r",[f.studio.slug,[f.free],f.at(),f.p1,request])));
      assert.equal(new Set(results.map(x=>x.rows[0].r.id)).size,1);
      assert.equal(Number((await admin.query('select count(*) n from public.whatsapp_consents')).rows[0].n),1);
    });
    await t.test('eight webhook writers and dispatchers commit one durable event',async()=>{
      const payload={object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'concurrent-sim'},messages:[{id:'concurrent-inbox',from:'5511900000202',timestamp:String(Math.floor(Date.now()/1000)),text:{body:'Olá'}}]}}]}]};
      const writes=await Promise.all(connections.map(c=>c.query("select public.whatsapp_ingest($1,$2,'simulation') r",['a'.repeat(64),JSON.stringify(payload)])));
      assert.equal(writes.filter(r=>r.rows[0].r.duplicate).length,7);
      const runs=await Promise.all(connections.map(c=>c.query("select public.whatsapp_dispatch('simulation') r")));
      assert.equal(runs.reduce((n,r)=>n+r.rows[0].r.processed,0),1);
      assert.equal(Number((await admin.query("select count(*) n from public.whatsapp_messages where dedupe_key='in:concurrent-inbox'")).rows[0].n),1);
    });
    await t.test('concurrent workers never claim the same message',async()=>{
      for(let i=0;i<10;i++)await admin.query("select public.whatsapp_inbound('concurrent-sim',$1,'5511900000101','Agendar',now(),'simulation')",[randomUUID()]);
      const claims=await Promise.all(connections.map(c=>c.query("select public.whatsapp_claim('simulation') r")));
      const jobs=claims.map(x=>x.rows[0].r).filter(Boolean);
      assert.equal(jobs.length,8);assert.equal(new Set(jobs.map(x=>x.id)).size,8);
      for(const job of jobs){await admin.query("select public.whatsapp_finish($1,$2,'simulated',$3,null)",[job.id,job.lease_id,'sim:'+job.id]);}
      const statuses=(await admin.query("select status from public.whatsapp_messages where id=any($1)",[jobs.map(x=>x.id)])).rows;
      assert.ok(statuses.every(x=>x.status==='simulated'));
    });
  } finally {
    await Promise.allSettled(clients.map(c=>c.end()));
    if(started)await run(join(binary,'pg_ctl.exe'),['-D',data,'-m','fast','-w','stop'],{windowsHide:true,timeout:20000});
  }
});
