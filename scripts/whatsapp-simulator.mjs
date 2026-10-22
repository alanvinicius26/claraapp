import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { migrateScheduling, schedulingFixture } from "../tests/scheduling-fixture.js";
import { createHandler, simulationSender, equalSecret } from "../supabase/functions/whatsapp/core.js";
import { connectionHandler } from '../supabase/functions/whatsapp/connections.js';

const root = resolve(".local/whatsapp-sim");
await mkdir(root, { recursive: true });
let secrets;
try { secrets = JSON.parse(await readFile(resolve(root, "server-secrets.json"), "utf8")); }
catch (e) {
  if (e.code !== "ENOENT") throw e;
  secrets = { CLARA_N8N_SECRET: randomBytes(32).toString("hex"), PANEL_SECRET: randomBytes(32).toString("hex") };
  await writeFile(resolve(root, "server-secrets.json"), JSON.stringify(secrets), { mode: 0o600 });
}
// Independent database, never reads .env.local or connects to Supabase/Meta.
const pg = new PGlite(resolve(root, "database"), { extensions: { btree_gist } });
const migration = await readFile(new URL("../supabase/whatsapp.sql", import.meta.url), "utf8");
if (!(await pg.query("select to_regclass('public.whatsapp_settings') as table_name")).rows[0].table_name) {
  await migrateScheduling(pg);
  await pg.exec(migration);
  for (const [index, slug] of [[1, "clara-simulacao"], [2, "clara-simulacao-b"]]) {
    const f = await schedulingFixture(pg);
    await pg.query("update public.studios set slug=$2,name=$3 where id=$1", [f.studio.id, slug, `Clara — Simulação ${index}`]);
    await pg.query("insert into public.whatsapp_settings(studio_id,enabled,phone_number_id) values($1,true,$2)", [f.studio.id, `sim-studio-${index}`]);
  }
} else {
  // Refresh function-only local development changes while preserving fixture history.
  // Never used against Supabase; schema/table changes still require a migration.
  for (const statement of migration.match(/create function[\s\S]*?\$\$;/g) || []) {
    await pg.exec(statement.replace('create function', 'create or replace function'));
  }
}
const operations = await readFile(new URL('../supabase/whatsapp_operations.sql',import.meta.url),'utf8');
if (!(await pg.query("select to_regclass('encaixa_private.whatsapp_connections') name")).rows[0].name) await pg.exec(operations);
else for(const statement of operations.match(/create function[\s\S]*?\$\$;/g)||[]) await pg.exec(statement.replace('create function','create or replace function'));
const kindCheck=(await pg.query("select pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.whatsapp_messages'::regclass and conname='whatsapp_messages_kind_check'")).rows[0].definition;
if(!kindCheck.includes('handoff')) await pg.exec("begin; alter table public.whatsapp_messages drop constraint whatsapp_messages_kind_check; alter table public.whatsapp_messages add constraint whatsapp_messages_kind_check check(kind in('inbound','greeting','booking_link','confirmation','reschedule','cancellation','reminder','manual','handoff')); commit;");
// Applied last so its versions of whatsapp_inbound/claim/finish replace the refreshed ones above.
const waha = await readFile(new URL('../supabase/whatsapp_waha.sql',import.meta.url),'utf8');
if (!(await pg.query("select 1 from information_schema.columns where table_schema='public' and table_name='whatsapp_conversations' and column_name='status'")).rows.length) await pg.exec(waha);
else for(const statement of waha.match(/create (or replace )?function[\s\S]*?\$\$;/g)||[]) await pg.exec(statement.replace(/create (or replace )?function/,'create or replace function'));
const fixtures = (await pg.query("select id,owner_id,slug,name from public.studios where slug in('clara-simulacao','clara-simulacao-b') order by slug")).rows;
const env = { ...secrets, WHATSAPP_MODE: "simulation", WHATSAPP_LIVE_ENABLED: "false", APP_ORIGIN: "http://127.0.0.1:3000" };
const signatures = {
  whatsapp_connect_control:['p_owner','p_studio','p_action','p_data'],
  whatsapp_ingest:['p_key','p_payload','p_mode'],whatsapp_dispatch:['p_mode'],whatsapp_operations:['p_mode','p_record'],
  whatsapp_inbound: ['p_channel','p_id','p_phone','p_body','p_at','p_mode'],
  whatsapp_claim: ['p_mode'], whatsapp_finish: ['p_id','p_lease','p_result','p_provider','p_error'],
  whatsapp_receipt: ['p_channel','p_provider','p_status','p_at'],
  whatsapp_owner: ['p_action','p_studio','p_data'],
  booking_page: ['p_slug'], available_slots_team: ['p_slug','p_services','p_date','p_token','p_professional'],
  available_dates_team: ['p_slug','p_services','p_after','p_until','p_token','p_professional'],
  book_appointment_whatsapp: ['p_slug','p_services','p_start','p_name','p_email','p_phone','p_notes','p_professional','p_whatsapp_opt_in','p_request_id'],
  manage_booking: ['p_token','p_action','p_start'],
};
const call = async (db, name, args) => {
  const keys = signatures[name];
  if (!keys) throw new Error("Ação inválida.");
  const used = keys.filter((k) => args[k] !== undefined);
  const sql = `select public.${name}(${used.map((k, i) => `${k} => $${i + 1}`).join(",")}) as data`;
  const rows = (await db.query(sql, used.map((k) => ['p_data','p_payload'].includes(k) ? JSON.stringify(args[k]) : args[k]))).rows;
  return name === 'available_slots_team' ? rows.map((r) => ({ starts_at: r.data })) : rows[0]?.data;
};
const db = (name, args) => call(pg, name, args);
const handler = createHandler({ env, db, send: simulationSender() });
const connections = connectionHandler({env,db,authenticate:async()=>fixtures[0].owner_id});
const wake = async () => {try { await fetch('http://127.0.0.1:5678/webhook/clara-operations-local',{
  method:'POST',headers:{Authorization:`Bearer ${secrets.CLARA_N8N_SECRET}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(3000),
}); } catch { /* Persistent inbox will be picked up by the next scheduled execution. */ } };
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
const publicActions = ['booking_page','available_slots_team','available_dates_team','book_appointment_whatsapp','manage_booking'];
const server = createServer(async (req, res) => {
  try {
    const chunks = []; let size = 0;
    for await (const part of req) { size += part.length; if (size > 65536) { json(res,413,{message:'Dados muito longos.'}); return; } chunks.push(part); }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (req.url.startsWith('/whatsapp-sim/')) {
      if (!equalSecret(req.headers['x-clara-panel'], secrets.PANEL_SECRET)) return json(res,401,{message:'Acesso negado.'});
      if (req.method !== 'POST') return json(res,405,{message:'Método inválido.'});
      const body = JSON.parse(raw || '{}');
      if (req.url === '/whatsapp-sim/connection') {
        const response=await connections(new Request('http://local/connection',{method:'POST',body:JSON.stringify({...body,studio_id:fixtures[0].id})}));
        return json(res,response.status,await response.json());
      }
      if (req.url === '/whatsapp-sim/info') return json(res,200,{fixtures: fixtures.map(({owner_id,...s})=>s),mode:'simulation'});
      if (req.url === '/whatsapp-sim/inbound') {
        const response=await handler(new Request('http://local/simulate-inbound',{method:'POST',headers:{authorization:`Bearer ${secrets.CLARA_N8N_SECRET}`},body:JSON.stringify({channel:'sim-studio-1',event_id:body.event_id||randomUUID(),phone:'5511900000101',text:body.text||'Olá',timestamp:new Date().toISOString()})}));
        if(response.ok)await wake();
        return json(res,response.status,await response.json());
      }
      if (req.url === '/whatsapp-sim/process') {
        const response = await handler(new Request('http://local/process',{method:'POST',headers:{authorization:`Bearer ${secrets.CLARA_N8N_SECRET}`},body:'{}'}));
        return json(res,response.status,await response.json());
      }
      if (req.url === '/whatsapp-sim/reminders') {
        await pg.query("update public.whatsapp_messages set available_at=now() where kind='reminder' and status='pending' and mode='simulation'");
        return json(res,200,{ready:true});
      }
      if (req.url === '/whatsapp-sim/rpc') {
        if (body.name === 'whatsapp_owner') {
          // This local-only owner is a fixture; real auth uses Supabase JWT + RLS.
          const f = fixtures[0];
          const data = await pg.transaction(async (tx) => {
            await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[f.owner_id]);
            await tx.exec('set local role authenticated');
            return call(tx,body.name,{...body.args,p_studio:f.id});
          });
          return json(res,200,{data});
        }
        if (!publicActions.includes(body.name)) return json(res,403,{message:'Ação não permitida no simulador.'});
        return json(res,200,{data:await db(body.name,body.args)});
      }
      return json(res,404,{message:'Rota inexistente.'});
    }
    const response = await handler(new Request(`http://local${req.url}`, { method:req.method, headers:req.headers, ...(req.method==='POST' ? {body:raw} : {}) }));
    if(req.url==='/simulate-inbound' && response.ok)await wake();
    res.writeHead(response.status,Object.fromEntries(response.headers)); res.end(await response.text());
  } catch (error) {
    // Do not print SQL, phone numbers, request bodies, management URLs or secrets.
    json(res,400,{message:error.code==='P0001' ? error.message : 'Não foi possível processar a simulação.'});
  }
});
server.listen(8787,'0.0.0.0',()=>console.log('Simulador WhatsApp pronto na porta 8787. Somente dados fictícios; envio Meta desativado.'));
const stop = () => server.close(async () => { await pg.close(); process.exit(0); });
process.on('SIGINT',stop); process.on('SIGTERM',stop);
