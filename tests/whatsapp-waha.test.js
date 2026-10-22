import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID, createHmac, randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { migrateScheduling, schedulingFixture } from "./scheduling-fixture.js";
import { createHandler, processQueue } from "../supabase/functions/whatsapp/core.js";
import { wahaSender, wahaEvent, typingDelay } from "../supabase/functions/whatsapp/waha.js";
import { withinSendWindow, isActiveMessage } from "../supabase/functions/whatsapp/hours.js";

// Synthetic configuration only: no real WAHA server, phone or secret is used.
const env = { WHATSAPP_MODE: "live", WHATSAPP_LIVE_ENABLED: "true", APP_ORIGIN: "https://clara.example.invalid", CLARA_N8N_SECRET: "x".repeat(40),
  WAHA_URL: "https://waha.example.invalid", WAHA_API_KEY: "k".repeat(24), WAHA_WEBHOOK_SECRET: "w".repeat(40) };
const PHONE = "5511900000101";

// Records every request the adapter would make to WAHA.
function fakeWaha(config = env) {
  const calls = [], waits = [];
  const request = async (url, options) => {
    calls.push({ path: new URL(url).pathname, body: JSON.parse(options.body), key: options.headers["X-Api-Key"] });
    const sent = url.endsWith("/sendText") ? { id: `true_${PHONE}@c.us_${randomBytes(8).toString("hex")}` } : {};
    return new Response(JSON.stringify(sent), { status: 201 });
  };
  return { calls, waits, send: wahaSender(config, request, async (ms) => { waits.push(ms); }) };
}

test("WAHA: idempotent webhook, 08h–20h window and FILA_HUMANO pause", { timeout: 120000 }, async (t) => {
  const pg = new PGlite({ extensions: { btree_gist } });
  const one = async (sql, args = []) => (await pg.query(sql, args)).rows[0];
  const count = async (sql, args = []) => Number((await one(sql, args)).n);
  const rpc = async (name, args = {}) => (await one(`select public.${name}(${Object.keys(args).map((k, i) => `${k}=>$${i + 1}`).join(",")}) value`,
    Object.entries(args).map(([k, v]) => (["p_data", "p_payload"].includes(k) ? JSON.stringify(v) : v)))).value;
  const handler = createHandler({ env, db: rpc, send: async () => { throw new Error("the webhook must never send"); } });
  const post = (body, { secret = env.WAHA_WEBHOOK_SECRET, signed = true } = {}) => {
    const raw = JSON.stringify(body);
    const headers = signed ? { "x-webhook-hmac": createHmac("sha512", secret).update(raw).digest("hex"), "x-webhook-hmac-algorithm": "sha512" } : {};
    return handler(new Request("https://edge.invalid/functions/v1/whatsapp/waha", { method: "POST", headers, body: raw }));
  };
  const message = (f, text, { id = `false_${PHONE}@c.us_${randomBytes(8).toString("hex")}`, phone = PHONE } = {}) => ({
    id: "evt_" + randomUUID(), timestamp: Date.now(), event: "message", session: f.session,
    payload: { id, timestamp: Math.floor(Date.now() / 1000), from: `${phone}@c.us`, fromMe: false, body: text, hasMedia: false },
  });
  const dispatch = () => rpc("whatsapp_dispatch", { p_mode: "live" });
  const conversation = (f, phone = PHONE) => one("select * from public.whatsapp_conversations where studio_id=$1 and phone=$2", [f.studio.id, phone]);
  const fixture = async () => {
    const f = await schedulingFixture(pg), session = "studio_" + randomBytes(4).toString("hex");
    await pg.query("insert into public.whatsapp_settings(studio_id,enabled,mode,phone_number_id) values($1,true,'live',$2)", [f.studio.id, "waha:" + session]);
    return { ...f, session };
  };
  const owner = (f, action, data = {}) => pg.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [f.owner]); await tx.exec("set local role authenticated");
    return (await tx.query("select public.whatsapp_owner($1,$2,$3) value", [action, f.studio.id, JSON.stringify(data)])).rows[0].value;
  });
  try {
    await migrateScheduling(pg);
    for (const name of ["whatsapp", "whatsapp_operations", "whatsapp_waha"]) await pg.exec(await readFile(new URL(`../supabase/${name}.sql`, import.meta.url), "utf8"));

    await t.test("duplicate webhooks are stored and answered once", async () => {
      const f = await fixture(), waha = fakeWaha(), hello = message(f, "Olá");
      const first = await post(hello);
      assert.equal(first.status, 200); assert.equal((await first.json()).duplicate, false);
      assert.equal((await (await post(hello)).json()).duplicate, true);
      // WAHA redelivery: new event id and send time, same message.
      assert.equal((await (await post({ ...hello, id: "evt_" + randomUUID(), timestamp: Date.now() + 5000 })).json()).duplicate, true);
      assert.equal(await count("select count(*) n from encaixa_private.whatsapp_inbox"), 1);
      // A different envelope for the same WhatsApp message id is caught by the message key.
      await post({ ...hello, payload: { ...hello.payload, body: "Olá!" } });
      assert.equal(await count("select count(*) n from encaixa_private.whatsapp_inbox"), 2);
      assert.equal((await dispatch()).processed, 2);
      assert.equal(await count("select count(*) n from public.whatsapp_messages where studio_id=$1 and direction='in'", [f.studio.id]), 1);
      assert.equal(await count("select count(*) n from public.whatsapp_messages where studio_id=$1 and kind='greeting'", [f.studio.id]), 1);

      const stats = await processQueue({ db: rpc, env, send: waha.send });
      assert.equal(stats.accepted, 1);
      assert.deepEqual(waha.calls.map((c) => c.path), ["/api/sendSeen", "/api/startTyping", "/api/sendText"]);
      for (const c of waha.calls) { assert.equal(c.body.chatId, `${PHONE}@c.us`); assert.equal(c.body.session, f.session); assert.equal(c.key, env.WAHA_API_KEY); }
      assert.match(waha.calls[2].body.text, /^Olá! Você está falando com QA Scheduling/);
      assert.equal(waha.waits.length, 1); assert.ok(waha.waits[0] >= 1000);
      assert.equal((await processQueue({ db: rpc, env, send: waha.send })).processed, 0);
      assert.equal(waha.calls.length, 3);

      // Delivery receipts reuse the same idempotent inbox. WAHA reports the sent message under the
      // contact's hidden id (@lid) while sendText answered with @c.us: only the key matches.
      const sent = await one("select provider_id from public.whatsapp_messages where studio_id=$1 and kind='greeting'", [f.studio.id]);
      assert.match(sent.provider_id, /^waha:[0-9a-f]{16}$/);
      const ack = { id: "evt_" + randomUUID(), timestamp: Date.now(), event: "message.ack", session: f.session,
        payload: { id: `true_123456789012345@lid_${sent.provider_id.slice(5)}`, fromMe: true, ack: 2, ackName: "DEVICE" } };
      await post(ack); await post(ack); await dispatch();
      assert.equal((await one("select status from public.whatsapp_messages where provider_id=$1", [sent.provider_id])).status, "delivered");
      // The same incoming message under @c.us or @lid is still one message.
      const again = { ...hello, payload: { ...hello.payload, from: "123456789012345@lid", body: "Olá de novo", _data: { Info: { SenderAlt: `${PHONE}@s.whatsapp.net` } },
        id: hello.payload.id.replace(`${PHONE}@c.us`, "123456789012345@lid") } };
      await post(again); await dispatch();
      assert.equal(await count("select count(*) n from public.whatsapp_messages where studio_id=$1 and direction='in'", [f.studio.id]), 1);
    });

    await t.test("unsigned, forged or irrelevant events never reach the inbox", async () => {
      const f = await fixture(), before = await count("select count(*) n from encaixa_private.whatsapp_inbox");
      assert.equal((await post(message(f, "Olá"), { signed: false })).status, 401);
      assert.equal((await post(message(f, "Olá"), { secret: "z".repeat(40) })).status, 401);
      const ignored = [
        { ...message(f, "Olá"), payload: { ...message(f, "Olá").payload, fromMe: true } },
        { ...message(f, "Olá"), payload: { ...message(f, "Olá").payload, from: "120363000000000000@g.us" } },
        { ...message(f, "Olá"), payload: { ...message(f, "Olá").payload, from: "123456789@lid" } },
        { ...message(f, "Olá"), event: "session.status" },
      ];
      for (const body of ignored) assert.equal((await (await post(body)).json()).ignored, true);
      assert.equal(await count("select count(*) n from encaixa_private.whatsapp_inbox"), before);
      const local = createHandler({ env: { ...env, WHATSAPP_MODE: "simulation" }, db: rpc, send: async () => null });
      const raw = JSON.stringify(message(f, "Olá"));
      const response = await local(new Request("https://edge.invalid/waha", { method: "POST", body: raw,
        headers: { "x-webhook-hmac": createHmac("sha512", env.WAHA_WEBHOOK_SECRET).update(raw).digest("hex"), "x-webhook-hmac-algorithm": "sha512" } }));
      assert.equal(response.status, 403);
    });

    await t.test("FILA_HUMANO answers 200 and makes no request to WAHA", async () => {
      const f = await fixture(), waha = fakeWaha();
      await post(message(f, "Oi")); await post(message(f, "Falar com atendente")); await dispatch();
      let c = await conversation(f);
      assert.equal(c.status, "AGUARDANDO_ASSUNTO"); assert.equal(c.mode, "human");
      assert.equal((await processQueue({ db: rpc, env, send: waha.send })).accepted, 1); // only the handoff acknowledgement
      assert.match(waha.calls.at(-1).body.text, /qual é o assunto/);
      await post(message(f, "Quero remarcar a unha de sábado")); await dispatch();
      c = await conversation(f);
      assert.equal(c.status, "FILA_HUMANO"); assert.equal(c.resumo_duvida, "Quero remarcar a unha de sábado");

      waha.calls.length = 0;
      for (const text of ["Agendar", "menu", "Oi", "Falar com atendente"]) assert.equal((await post(message(f, text))).status, 200);
      await dispatch();
      assert.equal((await processQueue({ db: rpc, env, send: waha.send })).processed, 0);
      assert.equal(waha.calls.length, 0);
      assert.equal((await conversation(f)).resumo_duvida, "Quero remarcar a unha de sábado");

      // Status set directly (e.g. by the team) pauses the bot too: mode follows status.
      const other = "5511900000202";
      await pg.query("insert into public.whatsapp_conversations(studio_id,phone,status) values($1,$2,'FILA_HUMANO')", [f.studio.id, other]);
      assert.equal((await conversation(f, other)).mode, "human");
      assert.equal((await post(message(f, "Olá", { phone: other }))).status, 200); await dispatch();
      assert.equal((await processQueue({ db: rpc, env, send: waha.send })).processed, 0);
      assert.equal(waha.calls.length, 0);
      // Writing only mode (older functions) can never leave the two columns disagreeing.
      const synced = await one("update public.whatsapp_conversations set mode='bot' where studio_id=$1 and phone=$2 returning mode,status", [f.studio.id, other]);
      assert.deepEqual(synced, { mode: "bot", status: "TRIAGEM" });
      // Even without the trigger, the constraint refuses a paused bot outside the human statuses.
      await assert.rejects(() => pg.transaction(async (tx) => {
        await tx.exec(`alter table public.whatsapp_conversations disable trigger whatsapp_conversation_status;
          update public.whatsapp_conversations set mode='human' where phone='${other}'`);
      }), /whatsapp_conversations_status_mode/);

      // Closing finishes the attendance; the next message goes back to triage and the bot.
      await owner(f, "close", { conversation_id: c.id });
      assert.equal((await conversation(f)).status, "FINALIZADO");
      await post(message(f, "Agendar")); await dispatch();
      assert.equal((await conversation(f)).status, "TRIAGEM");
      assert.equal((await processQueue({ db: rpc, env, send: waha.send })).accepted, 1);
      assert.deepEqual(waha.calls.map((x) => x.path), ["/api/sendSeen", "/api/startTyping", "/api/sendText"]);
      assert.ok(waha.calls[2].body.text.includes(`${env.APP_ORIGIN}/#/booking/${f.studio.slug}`));
    });

    await t.test("reminders and confirmations never leave at 03:00", async () => {
      const f = await fixture(), waha = fakeWaha();
      await pg.query("update public.whatsapp_settings set reminder_minutes=420 where studio_id=$1", [f.studio.id]); // 10:00 − 7 h = 03:00
      const booked = await rpc("book_appointment_whatsapp", { p_slug: f.studio.slug, p_services: [f.free], p_start: f.at("10:00"), p_name: "Cliente Simulada",
        p_email: "", p_phone: "11900000101", p_notes: "", p_professional: f.p1, p_whatsapp_opt_in: true, p_request_id: randomUUID() });
      const day = (offset) => new Date(Date.parse(`${f.date}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
      const reminder = await one("select * from public.whatsapp_messages where appointment_id=$1 and kind='reminder'", [booked.id]);
      // Moved earlier, to the previous evening, never later.
      assert.equal(reminder.status, "pending"); assert.equal(Date.parse(reminder.available_at), Date.parse(`${day(-1)}T19:30:00-03:00`));

      const at3 = `${f.date}T03:00:00-03:00`, at8 = `${f.date}T08:00:00-03:00`;
      const clock = (at) => async (name, args) => name === "whatsapp_claim"
        ? (await one("select encaixa_private.whatsapp_claim_at($1,$2) value", [args.p_mode, at])).value : rpc(name, args);
      const stats = await processQueue({ db: clock(at3), env, send: waha.send, now: () => new Date(at3) });
      assert.equal(stats.processed, 0); assert.equal(waha.calls.length, 0);
      const held = (await pg.query("select kind,status,available_at,attempts from public.whatsapp_messages where appointment_id=$1 order by kind", [booked.id])).rows;
      assert.deepEqual(held.map((m) => [m.kind, m.status, Date.parse(m.available_at), m.attempts]),
        [["confirmation", "pending", Date.parse(at8), 0], ["reminder", "pending", Date.parse(at8), 0]]);

      // Second gate: a worker clock at 03:00 defers even if the database already reached 08:00.
      const early = await processQueue({ db: clock(at8), env, send: waha.send, now: () => new Date(at3) });
      assert.equal(early.deferred, 1); assert.equal(waha.calls.length, 0);
      assert.equal(await count("select count(*) n from public.whatsapp_messages where appointment_id=$1 and status='pending' and attempts=0", [booked.id]), 2);

      const open = await processQueue({ db: clock(at8), env, send: waha.send, now: () => new Date(at8) });
      assert.equal(open.accepted, 2);
      const texts = waha.calls.filter((c) => c.path === "/api/sendText").map((c) => c.body.text);
      assert.match(texts[0], /^Agendamento confirmado/); assert.match(texts[1], /^Lembrete/);
      assert.ok(texts.every((text) => text.includes(`${env.APP_ORIGIN}/#/manage/${booked.token}`)));
    });

    await t.test("a reminder whose earlier slot already passed is not sent", async () => {
      const f = await fixture();
      const booked = await rpc("book_appointment_whatsapp", { p_slug: f.studio.slug, p_services: [f.free], p_start: f.at("10:00"), p_name: "Cliente Simulada",
        p_email: "", p_phone: "11900000101", p_notes: "", p_professional: f.p1, p_whatsapp_opt_in: true, p_request_id: randomUUID() });
      await pg.query(`update public.whatsapp_messages set available_at=((now() at time zone 'America/Sao_Paulo')::date-1+time '03:00') at time zone 'America/Sao_Paulo'
        where appointment_id=$1 and kind='reminder'`, [booked.id]);
      const reminder = await one("select status,error_code from public.whatsapp_messages where appointment_id=$1 and kind='reminder'", [booked.id]);
      assert.deepEqual(reminder, { status: "cancelled", error_code: "outside_hours" });
    });

    await t.test("SQL and JavaScript windows agree minute by minute", async () => {
      for (let minute = 0; minute < 24 * 60; minute += 15) {
        const at = new Date(Date.parse("2026-10-21T00:00:00-03:00") + minute * 60000);
        assert.equal((await one("select encaixa_private.whatsapp_in_hours($1) v", [at.toISOString()])).v, withinSendWindow(at), at.toISOString());
      }
      const edge = async (fn, at) => Date.parse((await one(`select encaixa_private.${fn}($1) v`, [at])).v);
      assert.equal(await edge("whatsapp_next_open", "2026-10-21T03:00:00-03:00"), Date.parse("2026-10-21T08:00:00-03:00"));
      assert.equal(await edge("whatsapp_next_open", "2026-10-21T20:00:00-03:00"), Date.parse("2026-10-22T08:00:00-03:00"));
      assert.equal(await edge("whatsapp_last_open", "2026-10-21T07:30:00-03:00"), Date.parse("2026-10-20T19:30:00-03:00"));
      assert.equal(await edge("whatsapp_last_open", "2026-10-21T21:00:00-03:00"), Date.parse("2026-10-21T19:30:00-03:00"));
      assert.equal(await edge("whatsapp_last_open", "2026-10-21T19:59:00-03:00"), Date.parse("2026-10-21T19:59:00-03:00"));
    });

    // Helpers for the attendance rules of 21/10: a worker whose database and own clock both read `at`.
    const book = (f, time = "10:00") => rpc("book_appointment_whatsapp", { p_slug: f.studio.slug, p_services: [f.free], p_start: f.at(time),
      p_name: "Cliente Simulada", p_email: "", p_phone: "11900000101", p_notes: "", p_professional: f.p1, p_whatsapp_opt_in: true, p_request_id: randomUUID() });
    const run = (send, at) => processQueue({ env, send, now: () => new Date(at), db: async (name, args) => name === "whatsapp_claim"
      ? (await one("select encaixa_private.whatsapp_claim_at($1,$2) value", [args.p_mode, at])).value : rpc(name, args) });
    const instant = async (sql) => new Date((await one(`select (${sql}) v`)).v).toISOString();
    const texts = (waha) => waha.calls.filter((c) => c.path === "/api/sendText").map((c) => c.body.text);
    // A message sent from the studio's own number, as WAHA reports it in message.any.
    const typed = (f, text, { id = `true_${PHONE}@c.us_${randomBytes(8).toString("hex")}`, to = `${PHONE}@c.us`, data } = {}) => ({
      id: "evt_" + randomUUID(), timestamp: Date.now(), event: "message.any", session: f.session,
      payload: { id, timestamp: Math.floor(Date.now() / 1000), from: "5511988887777@c.us", to, fromMe: true, body: text, hasMedia: false, ...(data && { _data: data }) },
    });
    const team = (f) => count("select count(*) n from public.whatsapp_messages where studio_id=$1 and kind='team_phone'", [f.studio.id]);
    // The queue is shared by every studio in this database: earlier tests leave pending notices behind.
    const isolate = (f) => pg.query("update public.whatsapp_messages set status='cancelled',error_code='other_test' where status='pending' and studio_id<>$1", [f.studio.id]);

    await t.test("booking notices reach the client during FILA_HUMANO; menu and link stay paused", async () => {
      const f = await fixture(), waha = fakeWaha(); await isolate(f);
      await post(message(f, "Oi")); await post(message(f, "Falar com atendente")); await post(message(f, "Preciso de ajuda")); await dispatch();
      assert.equal((await conversation(f)).status, "FILA_HUMANO");
      assert.equal((await processQueue({ db: rpc, env, send: waha.send })).accepted, 1); // the handoff notice only
      assert.equal((await one("select status from public.whatsapp_messages where studio_id=$1 and kind='greeting'", [f.studio.id])).status, "pending");

      // Inside the window (now, or the next 08:00 if it is closed) and within the 24 h of the greeting.
      const open = await instant("encaixa_private.whatsapp_next_open(now()+interval '1 minute')");
      const booked = await book(f);
      assert.equal((await run(waha.send, open)).accepted, 1);
      await pg.query("update public.appointments set starts_at=$2 where id=$1", [booked.id, f.at("11:00")]);
      assert.equal((await run(waha.send, open)).accepted, 1);
      // The new reminder is due the day before at 11:00.
      const before = new Date(Date.parse(`${f.date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
      assert.equal((await run(waha.send, `${before}T11:30:00-03:00`)).accepted, 1);
      await pg.query("update public.appointments set status='cancelled' where id=$1", [booked.id]);
      assert.equal((await run(waha.send, open)).accepted, 1);

      const sent = texts(waha).slice(1);
      assert.deepEqual(sent.map((text) => text.split(" em ")[0]), ["Agendamento confirmado", "Agendamento atualizado", "Lembrete", "Agendamento cancelado"]);
      // The client reads the time zone in plain words; the calculation still uses America/Sao_Paulo.
      assert.ok(sent.every((text) => text.includes("às 11:00 (horário de Brasília)") || text.includes("às 10:00 (horário de Brasília)")));
      assert.ok(sent.every((text) => !text.includes("America/Sao_Paulo")));
      assert.ok(!texts(waha).some((text) => text.startsWith("Olá! Você está falando")));
      assert.equal((await conversation(f)).status, "FILA_HUMANO");
    });

    await t.test("SAIR is acknowledged once, even at 03:00, and nothing automatic follows", async () => {
      const f = await fixture(), waha = fakeWaha(), booked = await book(f); await isolate(f);
      const name = (await one("select name from public.studios where id=$1", [f.studio.id])).name;
      await post(message(f, "SAIR")); await dispatch();
      assert.equal((await conversation(f)).opted_out, true);
      // The next 03:00 in São Paulo, always within the 24 h after the client's message.
      const at3 = await instant(`((case when (now() at time zone 'America/Sao_Paulo')::time<time '03:00' then (now() at time zone 'America/Sao_Paulo')::date
        else (now() at time zone 'America/Sao_Paulo')::date+1 end)+time '03:00') at time zone 'America/Sao_Paulo'`);
      const night = await run(waha.send, at3);
      assert.equal(night.accepted, 1); assert.equal(night.deferred, 0);
      assert.deepEqual(texts(waha), [`Pronto! Você não vai mais receber avisos automáticos de ${name} por aqui. Se precisar, é só escrever.`]);
      const notices = (await pg.query("select kind,status,error_code from public.whatsapp_messages where appointment_id=$1 order by kind", [booked.id])).rows;
      assert.deepEqual(notices, [{ kind: "confirmation", status: "cancelled", error_code: "opt_out" }, { kind: "reminder", status: "cancelled", error_code: "opt_out" }]);

      for (const text of ["sair", "Parar", "SAIR", "Oi", "1", "menu"]) await post(message(f, text));
      await dispatch();
      assert.equal(await count("select count(*) n from public.whatsapp_messages where studio_id=$1 and kind='opt_out_ack'", [f.studio.id]), 1);
      assert.equal((await run(waha.send, at3)).processed, 0);
      assert.equal(waha.calls.length, 3);
    });

    await t.test("a reply typed on the studio's phone pauses the bot; echoes and personal chats are ignored", async () => {
      const f = await fixture(), waha = fakeWaha(); await isolate(f);
      // Clara's own messages come back as fromMe: once before her send is recorded (matched by the
      // text, links without the site address) and again afterwards under the @lid id (matched by the key).
      const later = [];
      const racing = async (job, payload) => {
        const result = await waha.send(job, payload), key = result.provider.slice(5);
        await post(typed(f, payload.text, { id: `true_${PHONE}@c.us_${key}` })); await dispatch();
        later.push(typed(f, payload.text, { id: `true_123456789012345@lid_${key}`, to: "123456789012345@lid" }));
        return result;
      };
      await post(message(f, "Oi")); await post(message(f, "1")); await dispatch();
      assert.equal((await processQueue({ db: rpc, env, send: racing })).accepted, 2);
      assert.ok(texts(waha).some((text) => text.includes(`${env.APP_ORIGIN}/#/booking/`)));
      for (const echo of later) await post(echo);
      await dispatch();
      assert.equal(await team(f), 0);
      assert.deepEqual((({ status, mode }) => ({ status, mode }))(await conversation(f)), { status: "TRIAGEM", mode: "bot" });

      // The owner answers on the phone: recorded as the team's reply, and the bot stops at once.
      await post(typed(f, "Oi! Aqui é a Ana, já vejo seu horário.")); await dispatch();
      let c = await conversation(f);
      assert.equal(c.status, "FILA_HUMANO"); assert.equal(c.mode, "human");
      assert.ok(Math.abs(Date.parse(c.human_until) - Date.now() - 12 * 3600000) < 120000);
      assert.deepEqual(await one("select status,body from public.whatsapp_messages where studio_id=$1 and kind='team_phone'", [f.studio.id]),
        { status: "sent", body: "Oi! Aqui é a Ana, já vejo seu horário." });
      waha.calls.length = 0;
      await post(message(f, "1")); await dispatch();
      assert.equal((await processQueue({ db: rpc, env, send: waha.send })).processed, 0);
      assert.equal(waha.calls.length, 0);

      // Personal chats of the connected phone never enter, with a number or a hidden id.
      await post(typed(f, "Chego às 19h", { to: "5511900000999@c.us" }));
      await post(typed(f, "Chego às 19h!", { to: "555555555555555@lid" }));
      await dispatch();
      assert.equal(await team(f), 1);
      assert.equal(await count("select count(*) n from public.whatsapp_conversations where studio_id=$1", [f.studio.id]), 1);

      // A client known only by her hidden id: learned from her own message, then used for the reply.
      const other = "5511900000303", lid = "998877665544332";
      await post({ ...message(f, "Olá", { phone: other }), payload: { ...message(f, "Olá", { phone: other }).payload, from: `${lid}@lid`,
        _data: { Info: { IsGroup: false, SenderAlt: `${other}@s.whatsapp.net` } } } });
      await dispatch();
      assert.equal((await conversation(f, other)).wa_lid, lid);
      await post(typed(f, "Respondo já", { to: `${lid}@lid` })); await dispatch();
      c = await conversation(f, other);
      assert.equal(c.status, "FILA_HUMANO"); assert.equal(await team(f), 2);
    });

    await t.test("a takeover from the phone ends after 12 h; an attendance the client asked for does not", async () => {
      const f = await fixture(), waha = fakeWaha(); await isolate(f);
      await post(message(f, "Oi")); await dispatch(); await processQueue({ db: rpc, env, send: waha.send });
      await post(typed(f, "Oi, tudo bem?")); await dispatch();
      await pg.query("update public.whatsapp_conversations set human_until=now()-interval '1 minute' where studio_id=$1", [f.studio.id]);
      waha.calls.length = 0;
      await post(message(f, "1")); await dispatch();
      assert.equal((await conversation(f)).status, "TRIAGEM");
      assert.equal((await processQueue({ db: rpc, env, send: waha.send })).accepted, 1);
      assert.match(texts(waha)[0], /^Agende em/);

      // The client asks for a person: the team's phone reply keeps it until someone closes it.
      await post(message(f, "2")); await dispatch(); await processQueue({ db: rpc, env, send: waha.send });
      await post(typed(f, "Estou aqui, pode falar.")); await dispatch();
      const c = await conversation(f);
      assert.equal(c.status, "FILA_HUMANO"); assert.equal(c.human_until, null);
      waha.calls.length = 0;
      await post(message(f, "1")); await dispatch();
      assert.equal((await processQueue({ db: rpc, env, send: waha.send })).processed, 0);
      assert.equal((await conversation(f)).status, "FILA_HUMANO");
    });

    await t.test("browser roles cannot call the clock-injectable claim", async () => {
      for (const role of ["anon", "authenticated"]) await assert.rejects(() => pg.transaction(async (tx) => {
        await tx.exec("set local role " + role); await tx.query("select encaixa_private.whatsapp_claim_at('live',now())");
      }), /permission denied/);
      for (const role of ["anon", "authenticated"]) await assert.rejects(() => pg.transaction(async (tx) => {
        await tx.exec("set local role " + role); await tx.query("select public.whatsapp_echo('waha:x','x',null,null,'x',now(),'live')");
      }), /permission denied/);
    });
  } finally { await pg.close(); }
});

test("WAHA window utility, gates and payload normalization (no network)", async () => {
  assert.equal(withinSendWindow(new Date("2026-10-21T03:00:00-03:00")), false);
  assert.equal(withinSendWindow(new Date("2026-10-21T07:59:00-03:00")), false);
  assert.equal(withinSendWindow(new Date("2026-10-21T08:00:00-03:00")), true);
  assert.equal(withinSendWindow(new Date("2026-10-21T19:59:00-03:00")), true);
  assert.equal(withinSendWindow(new Date("2026-10-21T20:00:00-03:00")), false);
  assert.equal(withinSendWindow(new Date("2026-10-21T06:00:00Z")), false); // 03:00 in São Paulo, whatever the server zone
  assert.equal(isActiveMessage({ kind: "reminder" }), true);
  assert.equal(isActiveMessage({ kind: "manual", template_key: "human_followup" }), true);
  assert.equal(isActiveMessage({ kind: "greeting" }), false);
  assert.equal(isActiveMessage({ kind: "manual" }), false);

  const job = { mode: "live", provider: "waha", channel: "waha:default", phone: PHONE, kind: "greeting", body: "Olá" };
  const blocked = (config) => wahaSender(config, () => { throw new Error("must not request"); }, async () => {});
  assert.equal((await blocked({ ...env, WHATSAPP_LIVE_ENABLED: "false" })(job, { text: "Olá" })).error, "live_disabled");
  assert.equal((await blocked({ ...env, WHATSAPP_MODE: "simulation" })(job, { text: "Olá" })).error, "live_disabled");
  assert.equal((await blocked(env)({ ...job, provider: "meta" }, { text: "Olá" })).error, "live_disabled");
  assert.equal((await blocked({ ...env, WAHA_URL: "http://waha.example.invalid" })(job, { text: "Olá" })).error, "provider_not_configured");
  assert.equal((await blocked({ ...env, WAHA_API_KEY: "" })(job, { text: "Olá" })).error, "provider_not_configured");

  const reply = (status, body) => wahaSender(env, async () => new Response(JSON.stringify(body), { status }), async () => {});
  assert.equal((await reply(429, {})(job, { text: "Olá" })).result, "retry");
  assert.equal((await reply(500, {})(job, { text: "Olá" })).result, "uncertain");
  assert.equal((await reply(201, {})(job, { text: "Olá" })).result, "uncertain"); // accepted without an id is not proof
  assert.equal((await reply(422, {})(job, { text: "Olá" })).error, "waha_422");
  assert.equal((await reply(201, { id: { _serialized: "true_x" } })(job, { text: "Olá" })).provider, "true_x");
  assert.ok(typingDelay("x".repeat(1000)) <= 4000);

  const event = wahaEvent({ event: "message", session: "default", payload: { id: "false_1", timestamp: 1767225600, from: `${PHONE}@c.us`, body: "" } });
  assert.equal(event.entry[0].changes[0].value.metadata.phone_number_id, "waha:default");
  assert.equal(event.entry[0].changes[0].value.messages[0].text.body, "[Mensagem não textual]");
  assert.equal(wahaEvent({ event: "message", session: "../x", payload: { id: "1", timestamp: 1, from: `${PHONE}@c.us`, body: "Oi" } }), null);
  // Hidden WhatsApp ids (@lid): the phone comes from the engine's alternate sender.
  const lid = (data) => wahaEvent({ event: "message", session: "default", payload: { id: "false_2", timestamp: 1767225600, from: "123456789012345@lid", body: "Oi", _data: data } });
  assert.equal(lid({ Info: { IsGroup: false, SenderAlt: `${PHONE}@s.whatsapp.net` } }).entry[0].changes[0].value.messages[0].from, PHONE);
  assert.equal(lid({ key: { remoteJidAlt: `${PHONE}@s.whatsapp.net` } }).entry[0].changes[0].value.messages[0].from, PHONE);
  assert.equal(lid({ Info: { IsGroup: true, SenderAlt: `${PHONE}@s.whatsapp.net` } }), null);
  assert.equal(lid({}), null);
  assert.equal(lid({ Info: { SenderAlt: `${PHONE}@s.whatsapp.net` } }).entry[0].changes[0].value.messages[0].lid, "123456789012345");
  // Messages sent from the studio's number exist only in message.any, addressed by the recipient.
  const own = (event, to, data) => wahaEvent({ event, session: "default", payload: { id: `true_${to}_ABC123`, timestamp: 1767225600, fromMe: true, to, body: "Oi", _data: data } });
  assert.equal(own("message", `${PHONE}@c.us`), null);
  assert.deepEqual(own("message.any", `${PHONE}@c.us`).entry[0].changes[0].value.echoes, [{ id: "waha:ABC123", to: PHONE, timestamp: "1767225600", text: { body: "Oi" } }]);
  assert.deepEqual(own("message.any", "123456789012345@lid").entry[0].changes[0].value.echoes[0].lid, "123456789012345");
  assert.equal(own("message.any", "123456789012345@lid", { Info: { RecipientAlt: `${PHONE}@s.whatsapp.net` } }).entry[0].changes[0].value.echoes[0].to, PHONE);
  assert.equal(own("message.any", "120363000000000000@g.us"), null);
  assert.equal(own("message.any", "status@broadcast"), null);
  assert.equal(wahaEvent({ event: "message.any", session: "default", payload: { id: "false_3", timestamp: 1767225600, from: `${PHONE}@c.us`, body: "Oi" } })
    .entry[0].changes[0].value.messages[0].from, PHONE);
});
