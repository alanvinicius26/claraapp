// End-to-end test with a real WAHA container on this computer. The database is an isolated
// PGlite copy: it never reads .env.local and never connects to Supabase or production.
// Only phones listed in .local/waha-test/config.json ("allow") are answered or receive messages.
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { migrateScheduling, schedulingFixture } from "../tests/scheduling-fixture.js";
import { createHandler, processQueue } from "../supabase/functions/whatsapp/core.js";
import { wahaSender, wahaEvent } from "../supabase/functions/whatsapp/waha.js";
import { withinSendWindow } from "../supabase/functions/whatsapp/hours.js";

const IMAGE = "devlikeapro/waha:gows-2026.9.2", CONTAINER = "clara-waha", WAHA = "http://127.0.0.1:3001", PORT = 8788;
const PAGE_HOSTS = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
const root = resolve(".local/waha-test");
await mkdir(root, { recursive: true });

// Test secrets live only in .local (ignored by Git) and are never printed.
const configPath = resolve(root, "config.json");
let config;
try { config = JSON.parse(await readFile(configPath, "utf8")); }
catch (e) {
  if (e.code !== "ENOENT") throw e;
  config = { session: "clara_teste", allow: [], apiKey: randomBytes(32).toString("hex"), webhookSecret: randomBytes(32).toString("hex") };
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}
// Same key as encaixa_private.whatsapp_canonical: Brazilian mobiles without the ninth digit gain it.
const canonical = (value) => {
  let n = String(value).replace(/\D/g, "");
  if (n.length === 10 || n.length === 11) n = "55" + n;
  return /^55[1-9][1-9][6-9][0-9]{7}$/.test(n) ? n.slice(0, 4) + "9" + n.slice(4) : n;
};
const allowed = new Set((config.allow || []).map(canonical).filter((n) => /^55[1-9][1-9][0-9]{8,9}$/.test(n)));
const masked = (phone) => "••••" + String(phone).slice(-4);

// ---------- WAHA container and session ----------
const run = promisify(execFile);
const docker = async (...args) => (await run("docker", args, { windowsHide: true })).stdout.trim();
const waha = (path, options = {}) => fetch(WAHA + path, { ...options, signal: AbortSignal.timeout(15000),
  headers: { "X-Api-Key": config.apiKey, "Content-Type": "application/json", Accept: "application/json", ...options.headers } });
async function ensureContainer() {
  let state;
  try { state = await docker("ps", "-a", "--filter", `name=^${CONTAINER}$`, "--format", "{{.State}}"); }
  catch {
    console.error("O Docker não respondeu. Abra o Docker Desktop, espere ele ficar pronto e rode de novo: npm run waha:local");
    process.exit(1);
  }
  if (!state) {
    const envFile = resolve(root, "waha.env");
    // Only on 127.0.0.1. Dashboard/Swagger off: this page shows the QR code instead.
    await writeFile(envFile, [`WAHA_API_KEY=${config.apiKey}`, "WHATSAPP_DEFAULT_ENGINE=GOWS", "WAHA_PRINT_QR=False",
      "WAHA_DASHBOARD_ENABLED=False", "WHATSAPP_SWAGGER_ENABLED=False", ""].join("\n"), { mode: 0o600 });
    await docker("run", "-d", "--name", CONTAINER, "-p", "127.0.0.1:3001:3000", "--env-file", envFile, "-v", "clara-waha-sessions:/app/.sessions", IMAGE);
  } else if (state !== "running") await docker("start", CONTAINER);
  for (let i = 0; i < 60; i++) {
    try { if ((await waha("/api/sessions")).ok) return; } catch { /* still starting */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("O WAHA não respondeu em 2 minutos.");
}
const sessionConfig = { webhooks: [{ url: `http://host.docker.internal:${PORT}/waha`, events: ["message.any", "message.ack"],
  hmac: { key: config.webhookSecret }, retries: { policy: "exponential", delaySeconds: 2, attempts: 6 } }] };
async function ensureSession() {
  const current = await waha(`/api/sessions/${config.session}`);
  if (!current.ok) {
    const created = await waha("/api/sessions", { method: "POST", body: JSON.stringify({ name: config.session, start: true, config: sessionConfig }) });
    if (!created.ok) throw new Error(`WAHA recusou criar a sessão (${created.status}).`);
    return;
  }
  const updated = await waha(`/api/sessions/${config.session}`, { method: "PUT", body: JSON.stringify({ name: config.session, config: sessionConfig }) });
  if (!updated.ok) throw new Error(`WAHA recusou atualizar a sessão (${updated.status}).`);
  if ((await (await waha(`/api/sessions/${config.session}`)).json()).status === "STOPPED") await waha(`/api/sessions/${config.session}/start`, { method: "POST" });
}
async function sessionState() {
  try { const r = await waha(`/api/sessions/${config.session}`); return r.ok ? await r.json() : { status: `HTTP ${r.status}` }; }
  catch { return { status: "WAHA fora do ar" }; }
}

// ---------- Isolated database ----------
const pg = new PGlite(resolve(root, "database"), { extensions: { btree_gist } });
const files = ["whatsapp", "whatsapp_operations", "whatsapp_waha"];
const source = (name) => readFile(new URL(`../supabase/${name}.sql`, import.meta.url), "utf8");
if (!(await pg.query("select to_regclass('public.whatsapp_settings') t")).rows[0].t) {
  await migrateScheduling(pg);
  for (const name of files) await pg.exec(await source(name));
  const f = await schedulingFixture(pg);
  await pg.query("update public.studios set slug='clara-teste-waha',name='Clara — Teste WAHA' where id=$1", [f.studio.id]);
  await pg.query("update public.working_hours set opens='08:00',closes='21:00' where studio_id=$1", [f.studio.id]);
  await pg.query("insert into public.whatsapp_settings(studio_id,enabled,mode,phone_number_id,reminder_minutes) values($1,true,'live',$2,15)", [f.studio.id, "waha:" + config.session]);
} else {
  // Function-only changes are refreshed in order; table changes need a fresh database folder.
  for (const name of files) for (const statement of (await source(name)).match(/create (or replace )?function[\s\S]*?\$\$;/g) || [])
    await pg.exec(statement.replace(/create (or replace )?function/, "create or replace function"));
}
const one = async (sql, args = []) => (await pg.query(sql, args)).rows[0];
const rpc = async (name, args = {}) => (await one(`select public.${name}(${Object.keys(args).map((k, i) => `${k}=>$${i + 1}`).join(",")}) value`,
  Object.entries(args).map(([k, v]) => (["p_data", "p_payload"].includes(k) ? JSON.stringify(v) : v)))).value;
const studio = await one("select s.* from public.studios s join public.whatsapp_settings w on w.studio_id=s.id where w.phone_number_id=$1", ["waha:" + config.session]);
const owner = (action, data) => pg.transaction(async (tx) => {
  await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [studio.owner_id]); await tx.exec("set local role authenticated");
  return (await tx.query("select public.whatsapp_owner($1,$2,$3) value", [action, studio.id, JSON.stringify(data)])).rows[0].value;
});

// ---------- Same handler and queue as the Edge Function, live mode against local WAHA ----------
const env = { WHATSAPP_MODE: "live", WHATSAPP_LIVE_ENABLED: "true", APP_ORIGIN: "https://teste-local.minhaclara.invalid",
  CLARA_N8N_SECRET: randomBytes(32).toString("hex"), WAHA_URL: WAHA, WAHA_API_KEY: config.apiKey, WAHA_WEBHOOK_SECRET: config.webhookSecret };
const handler = createHandler({ env, db: rpc, send: async () => ({ result: "failed", error: "webhook_never_sends" }) });
const realSend = wahaSender(env);
// Test guard: nobody outside the allowlist ever receives a message from this computer.
const send = (job, payload) => (allowed.has(job.phone) ? realSend(job, payload) : Promise.resolve({ result: "failed", error: "not_in_test_allowlist" }));
let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const inbox = await rpc("whatsapp_dispatch", { p_mode: "live" });
    const out = await processQueue({ db: rpc, env, send });
    if (inbox.processed || inbox.failures || out.processed) console.log(new Date().toLocaleTimeString("pt-BR"), "entrada", inbox, "saída", out);
  } catch (e) { console.error("Fila:", e.message); }
  finally { busy = false; }
}

// ---------- Page (127.0.0.1 only) and webhook ----------
const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const clock = (t) => t ? new Date(t).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
const readBody = (req) => new Promise((ok, fail) => {
  let size = 0; const chunks = [];
  req.on("data", (c) => { size += c.length; if (size > 65536) { fail(new Error("body_too_large")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => ok(Buffer.concat(chunks).toString("utf8"))); req.on("error", fail);
});
async function page(notice = "") {
  const session = await sessionState(), working = session.status === "WORKING";
  const conversations = (await pg.query("select * from public.whatsapp_conversations where studio_id=$1 order by last_inbound_at desc nulls last limit 20", [studio.id])).rows;
  const blocks = [];
  for (const c of conversations) {
    const messages = (await pg.query("select * from public.whatsapp_messages where conversation_id=$1 order by created_at desc limit 12", [c.id])).rows.reverse();
    blocks.push(`<section class="card"><h3>${escape(masked(c.phone))} · <span class="tag">${escape(c.status)}</span>${c.opted_out ? ' <span class="tag off">SAIR</span>' : ""}</h3>
      ${c.resumo_duvida ? `<p><b>Assunto:</b> ${escape(c.resumo_duvida)}</p>` : ""}
      <table>${messages.map((m) => `<tr class="${m.direction}"><td>${clock(m.created_at)}</td><td>${m.direction === "in" ? "cliente" : escape(m.kind)}</td><td>${escape(m.status)}${m.error_code ? " · " + escape(m.error_code) : ""}${m.status === "pending" ? " · " + clock(m.available_at) : ""}</td><td>${escape(String(m.body).slice(0, 140))}</td></tr>`).join("")}</table>
      <form method="post" action="/reply" class="row"><input type="hidden" name="id" value="${c.id}"><input name="body" placeholder="Responder como atendente (dentro de 24 h)" maxlength="1000" required><button>Enviar</button></form>
      <form method="post" action="/close"><input type="hidden" name="id" value="${c.id}"><button class="secondary">Encerrar atendimento</button></form></section>`);
  }
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  ${working ? "" : '<meta http-equiv="refresh" content="5">'}<title>Teste WAHA local</title><style>
  body{font:14px/1.5 system-ui,sans-serif;margin:0;background:#faf7f2;color:#2b1d22}main{max-width:900px;margin:auto;padding:16px}
  h1{color:#500021;font-size:22px}.card{background:#fff;border:1px solid #ece2de;border-radius:16px;padding:16px;margin:12px 0}
  .tag{background:#f3e1df;color:#4b1529;border-radius:99px;padding:2px 8px;font-size:12px}.off{background:#2b1d22;color:#fff}
  table{width:100%;border-collapse:collapse;font-size:13px}td{border-top:1px solid #eadde0;padding:4px;vertical-align:top}tr.in td{color:#607662}
  .row{display:flex;gap:8px;margin:8px 0}input,select{flex:1;font:inherit;padding:8px;border:1px solid #eadde0;border-radius:9px}
  button{font:inherit;font-weight:700;background:#6e1936;color:#fff;border:0;border-radius:9px;padding:8px 14px;min-height:40px}
  button.secondary{background:#fff;color:#6e1936;border:1px solid #eadde0}.notice{background:#f3e1df;padding:8px 12px;border-radius:9px}img{max-width:260px}</style></head>
  <body><main><h1>Teste WAHA local · ${escape(studio.name)}</h1>${notice ? `<p class="notice" role="status">${escape(notice)}</p>` : ""}
  <section class="card"><h2>Sessão WhatsApp: ${escape(session.status)}</h2>
   ${session.me?.id ? `<p>Número conectado: ${escape(masked(session.me.id.split("@")[0]))}</p>` : ""}
   ${session.status === "SCAN_QR_CODE" ? `<p>No celular de teste: WhatsApp → Aparelhos conectados → Conectar aparelho.</p><img alt="QR code do WAHA" src="/qr.png?r=${Date.now()}">` : ""}
   <p>Janela de mensagens ativas agora: <b>${withinSendWindow() ? "aberta (08h–20h)" : "fechada — confirmações e lembretes esperam até 08h"}</b></p>
   <p>Números de teste permitidos: ${allowed.size ? [...allowed].map(masked).join(", ") : "<b>nenhum</b>"}</p>
   <form method="post" action="/allow" class="row"><input name="phone" inputmode="tel" placeholder="Celular da cliente com DDD (ex.: 11 99999-8888)" required><button>Permitir número</button></form>
   <p><a href="/">Atualizar</a></p></section>
  <section class="card"><h2>Reserva de teste</h2><p>Cria uma reserva com autorização de WhatsApp para o primeiro número permitido.</p>
   <form method="post" action="/book" class="row"><select name="lead"><option value="20">daqui a 20 min</option><option value="30" selected>daqui a 30 min</option><option value="60">daqui a 1 h</option><option value="1500">amanhã</option></select>
   <select name="reminder"><option value="5">lembrete 5 min antes</option><option value="15" selected>lembrete 15 min antes</option><option value="60">lembrete 1 h antes</option><option value="1440">lembrete 24 h antes</option></select><button>Criar reserva</button></form></section>
  <h2>Conversas</h2>${blocks.join("") || "<p>Nenhuma mensagem ainda. Envie “Oi” do celular permitido para o número conectado.</p>"}</main></body></html>`;
}
async function book(form) {
  const phone = [...allowed][0];
  if (!phone) return "Adicione um número permitido antes de criar a reserva.";
  const lead = Math.max(5, Number(form.get("lead")) || 30), reminder = Number(form.get("reminder")) || 15;
  await pg.query("update public.whatsapp_settings set reminder_minutes=$2 where studio_id=$1", [studio.id, reminder]);
  const service = (await one("select id from public.services where studio_id=$1 and resource_id is null order by name limit 1", [studio.id])).id;
  const professional = (await one("select id from public.professionals where studio_id=$1 and name=$2", [studio.id, studio.professional])).id;
  for (let day = 0; day < 8; day++) {
    const slot = await one(`select s from public.available_slots_team($1,array[$2]::uuid[],((now() at time zone 'America/Sao_Paulo')::date+$3::int),null,$4) s
      where s>=now()+make_interval(mins=>$5::int) order by s limit 1`, [studio.slug, service, day, professional, lead]);
    if (!slot) continue;
    await rpc("book_appointment_whatsapp", { p_slug: studio.slug, p_services: [service], p_start: slot.s, p_name: "Cliente Teste WAHA", p_email: "",
      p_phone: phone.slice(2), p_notes: "", p_professional: professional, p_whatsapp_opt_in: true, p_request_id: randomUUID() });
    return `Reserva criada para ${clock(slot.s)} com lembrete ${reminder} min antes.`;
  }
  return "Nenhum horário livre nos próximos 8 dias.";
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const reply = (status, type, body) => { res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" }); res.end(body); };
  try {
    if (req.method === "POST" && url.pathname === "/waha") {
      const raw = await readBody(req);
      let event = null; try { event = JSON.parse(raw); } catch { /* the handler answers invalid_json */ }
      // Test guard: only the allowed chats reach the database. The connected phone may be in
      // personal use, so receipts of its other chats are dropped too.
      if (event?.event === "message" || event?.event === "message.any") {
        // Incoming messages by sender; messages sent from the connected phone by recipient.
        const value = wahaEvent(event)?.entry[0].changes[0].value, echo = value?.echoes?.[0];
        const ok = echo ? (echo.to && allowed.has(canonical(echo.to))) || allowedLids.has(echo.lid)
          : value?.messages?.[0]?.from && allowed.has(canonical(value.messages[0].from));
        if (!ok) return reply(200, "application/json", '{"received":true,"ignored":true}');
      } else if (event?.event === "message.ack") {
        const text = JSON.stringify(event.payload || {});
        if (![...allowed, ...allowedLids].some((id) => text.includes(id))) return reply(200, "application/json", '{"received":true,"ignored":true}');
      }
      const headers = {};
      for (const name of ["x-webhook-hmac", "x-webhook-hmac-algorithm"]) if (req.headers[name]) headers[name] = req.headers[name];
      const response = await handler(new Request(`http://127.0.0.1:${PORT}/waha`, { method: "POST", headers, body: raw }));
      reply(response.status, "application/json", await response.text());
      setTimeout(tick, 200);
      return;
    }
    // The page is only for this computer: other Host headers (DNS rebinding) and other origins are refused.
    if (!PAGE_HOSTS.includes(req.headers.host)) return reply(403, "text/plain", "forbidden");
    if (req.method === "GET" && url.pathname === "/") return reply(200, "text/html; charset=utf-8", await page(url.searchParams.get("msg") || ""));
    // Diagnostics: provider ids of sent messages next to the receipt ids, digits masked.
    if (req.method === "GET" && url.pathname === "/debug/receipts") {
      const hide = (s) => String(s ?? "").replace(/[0-9]{6,}/g, (d) => "#".repeat(d.length - 4) + d.slice(-4));
      const sent = (await pg.query("select kind,status,provider_id from public.whatsapp_messages where direction='out' and studio_id=$1 order by created_at", [studio.id])).rows;
      const receipts = (await pg.query("select provider_id,status from encaixa_private.whatsapp_receipts where studio_id=$1 order by event_at", [studio.id])).rows;
      return reply(200, "application/json", JSON.stringify({ sent: sent.map((m) => ({ ...m, provider_id: hide(m.provider_id) })), receipts: receipts.map((r) => ({ ...r, provider_id: hide(r.provider_id) })) }, null, 1));
    }
    if (req.method === "GET" && url.pathname === "/qr.png") {
      const qr = await waha(`/api/${config.session}/auth/qr?format=image`, { headers: { Accept: "image/png" } });
      if (!qr.ok) return reply(404, "text/plain", "QR indisponível");
      return reply(200, "image/png", Buffer.from(await qr.arrayBuffer()));
    }
    if (req.method === "POST") {
      if (!PAGE_HOSTS.map((h) => "http://" + h).includes(req.headers.origin)) return reply(403, "text/plain", "forbidden");
      const form = new URLSearchParams(await readBody(req));
      let message = "";
      try {
        if (url.pathname === "/allow") {
          const phone = canonical(form.get("phone") || "");
          if (!/^55[1-9][1-9][0-9]{8,9}$/.test(phone)) message = "Número inválido: use DDD + número.";
          else {
            allowed.add(phone);
            config.allow = [...allowed];
            await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
            await refreshLids();
            message = `Número ${masked(phone)} permitido.`;
          }
        }
        else if (url.pathname === "/book") message = await book(form);
        else if (url.pathname === "/close") { await owner("close", { conversation_id: form.get("id") }); message = "Atendimento encerrado."; }
        else if (url.pathname === "/reply") { await owner("send", { conversation_id: form.get("id"), body: form.get("body"), request_id: randomUUID() }); message = "Resposta na fila."; }
        else return reply(404, "text/plain", "not found");
      } catch (e) { message = "Erro: " + e.message; }
      setTimeout(tick, 200);
      res.writeHead(303, { Location: "/?msg=" + encodeURIComponent(message) }); return res.end();
    }
    reply(404, "text/plain", "not found");
  } catch (e) { reply(500, "text/plain", e.message === "body_too_large" ? "too large" : "erro"); }
});

await ensureContainer();
await ensureSession();
// Hidden ids (@lid) of the allowed phones, so their receipts can be told apart from other chats.
const allowedLids = new Set();
async function refreshLids() {
  for (const phone of allowed) {
    try {
      const r = await waha(`/api/${config.session}/lids/pn/${phone}`);
      const lid = r.ok ? (await r.json()).lid : null;
      if (typeof lid === "string" && /^[0-9]+@lid$/.test(lid)) allowedLids.add(lid.split("@")[0]);
    } catch { /* session still starting; retried below */ }
  }
}
await refreshLids();
setInterval(refreshLids, 60000);
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Teste WAHA pronto em http://127.0.0.1:${PORT} (banco isolado em .local/waha-test; produção não é usada).`);
  if (!allowed.size) console.log('Nenhum número permitido: adicione o celular da "cliente" em .local/waha-test/config.json → "allow" e reinicie.');
});
setInterval(tick, 5000);
