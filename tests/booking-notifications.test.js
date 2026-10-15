import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { migrateScheduling, schedulingFixture } from "./scheduling-fixture.js";
import { alertText, unseenTitle, loadAlertPrefs, saveAlertPrefs, mergeAlerts, createAlertDelivery, demoAlerts, createAlertTracker } from "../src/booking-alerts.js";

test("owner alerts: only client actions create one event each, visible only to the owner", { timeout: 120000 }, async (t) => {
  const db = new PGlite({ extensions: { btree_gist } });
  try {
    await migrateScheduling(db);
    await db.exec(await readFile(new URL("../supabase/booking_notifications.sql", import.meta.url), "utf8"));
    const f = await schedulingFixture(db), other = await schedulingFixture(db);
    const { one, studio, p1, free, at } = f;
    const asOwner = (owner = f.owner) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    const asPublic = () => db.query("select set_config('request.jwt.claim.sub','',false)");
    const events = async () => (await db.query("select kind,payload,seen_at from public.studio_notifications where studio_id=$1 order by created_at,id", [studio.id])).rows;
    const book = async (time) => {
      await asPublic();
      return (await one("select public.book_appointment_team($1,$2,$3,'Maria Online','','11999998888','',$4) r", [studio.slug, [free], at(time), p1])).r;
    };

    await t.test("online booking creates a new_booking event with display data", async () => {
      await book("09:00");
      const [event] = await events();
      assert.equal(event.kind, "new_booking");
      assert.equal(event.payload.client, "Maria Online");
      assert.equal(event.payload.service, "Sem recurso");
      assert.equal(event.payload.professional, (await one("select name from public.professionals where id=$1", [p1])).name);
      assert.equal(Date.parse(event.payload.starts_at), Date.parse(at("09:00")));
    });

    await t.test("the owner's own bookings, edits and cancellations never alert", async () => {
      await asOwner();
      const a = await f.insert([free], at("13:00"));
      await db.query("update public.appointments set status='cancelled' where id=$1", [a.id]);
      assert.equal((await events()).length, 1);
    });

    await t.test("client reschedule and cancellation through the management link", async () => {
      const { token } = await book("10:00");
      await asPublic();
      await db.query("select public.manage_booking($1,'reschedule',$2)", [token, at("11:00")]);
      await db.query("select public.manage_booking($1,'cancel')", [token]);
      const [, moved, cancelled] = (await events()).slice(-3);
      assert.equal(moved.kind, "client_rescheduled");
      assert.equal(Date.parse(moved.payload.previous_starts_at), Date.parse(at("10:00")));
      assert.equal(Date.parse(moved.payload.starts_at), Date.parse(at("11:00")));
      assert.equal(cancelled.kind, "client_cancelled");
    });

    await t.test("RLS: owner reads own events, other owners and anonymous read nothing", async () => {
      const read = async (role, owner) => db.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [owner || ""]);
        await tx.exec(`set local role ${role}`);
        return (await tx.query("select id from public.studio_notifications")).rows.length;
      });
      assert.equal(await read("authenticated", f.owner), 4);
      assert.equal(await read("authenticated", other.owner), 0);
      await assert.rejects(() => read("anon"));
    });

    await t.test("only the owner can mark events as seen", async () => {
      const mark = (owner) => db.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
        await tx.exec("set local role authenticated");
        return (await tx.query("select public.mark_notifications_seen($1) n", [studio.id])).rows[0].n;
      });
      await assert.rejects(() => mark(other.owner), /Acesso negado/);
      assert.equal(await mark(f.owner), 4);
      assert.ok((await events()).every((e) => e.seen_at));
      assert.equal(await mark(f.owner), 0);
    });
  } finally {
    await db.close();
  }
});

test("alert texts are short and specific to each event", () => {
  const starts_at = "2026-10-20T13:00:00Z";
  assert.deepEqual(alertText({ kind: "new_booking", payload: { client: "Maria", service: "Manicure", starts_at } }),
    { title: "Nova reserva", body: "Maria · Manicure · ter., 20/10 às 10:00" });
  assert.equal(alertText({ kind: "client_cancelled", payload: { client: "Ana", service: "Escova", starts_at } }).title, "Reserva cancelada pela cliente");
  assert.match(alertText({ kind: "client_rescheduled", payload: { client: "Ana", service: "Escova", starts_at, previous_starts_at: "2026-10-19T13:00:00Z" } }).body,
    /Ana · Escova · agora ter\., 20\/10 às 10:00 \(antes seg\., 19\/10 às 10:00\)/);
  assert.equal(alertText({ kind: "new_booking", payload: {} }).body, "Cliente · Atendimento");
});

test("tab title shows unseen count without stacking prefixes", () => {
  assert.equal(unseenTitle("Clara · Seu tempo de volta", 2), "(2) Clara · Seu tempo de volta");
  assert.equal(unseenTitle("(2) Clara · Seu tempo de volta", 0), "Clara · Seu tempo de volta");
  assert.equal(unseenTitle("(2) Clara", 120), "(99+) Clara");
});

test("device preferences survive blocked storage and default to sound on", () => {
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.deepEqual(loadAlertPrefs("s1", blocked), { sound: true });
  assert.doesNotThrow(() => saveAlertPrefs("s1", { sound: false }, blocked));
  const memory = new Map(), storage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
  saveAlertPrefs("s1", { sound: false }, storage);
  assert.deepEqual(loadAlertPrefs("s1", storage), { sound: false });
  assert.deepEqual(loadAlertPrefs("s2", storage), { sound: true });
});

test("realtime and catch-up results merge without duplicates, newest first", () => {
  const list = mergeAlerts([{ id: "a", created_at: "2026-10-14T10:00:00Z" }],
    [{ id: "b", created_at: "2026-10-14T11:00:00Z" }, { id: "a", created_at: "2026-10-14T10:00:00Z", seen_at: "x" }]);
  assert.deepEqual(list.map((x) => x.id), ["b", "a"]);
  assert.equal(list[1].seen_at, "x");
});

test("browser delivery: system notification only when the tab is hidden and allowed", () => {
  const shown = [], sounds = [];
  class FakeNotification { static permission = "granted"; constructor(title, options) { shown.push([title, options.body]); } }
  const env = { document: { hidden: false }, Notification: FakeNotification, playSound: () => sounds.push(1) };
  const deliver = createAlertDelivery(env);
  deliver({ title: "Nova reserva", body: "Maria" }, { sound: true });
  assert.equal(shown.length, 0); assert.equal(sounds.length, 1);
  env.document.hidden = true;
  deliver({ title: "Nova reserva", body: "Maria" }, { sound: false });
  assert.deepEqual(shown, [["Nova reserva", "Maria"]]); assert.equal(sounds.length, 1);
  FakeNotification.permission = "denied";
  deliver({ title: "Nova reserva", body: "Ana" }, { sound: false });
  assert.equal(shown.length, 1);
  assert.doesNotThrow(() => createAlertDelivery({ document: { hidden: true } })({ title: "x", body: "y" }, { sound: true }));
});

test("demonstration alerts use only future confirmed online bookings, two unseen", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");
  const a = (id, starts_at, source = "online", status = "confirmed") => ({ id, starts_at, source, status, service_name: "Manicure", clients: { name: id } });
  const list = demoAlerts([a("past", "2026-10-13T12:00:00Z"), a("studio", "2026-10-15T12:00:00Z", "studio"), a("cancel", "2026-10-15T13:00:00Z", "online", "cancelled"),
    a("c", "2026-10-17T12:00:00Z"), a("b", "2026-10-16T12:00:00Z"), a("d", "2026-10-18T12:00:00Z"), a("e", "2026-10-19T12:00:00Z")], now);
  assert.deepEqual(list.map((x) => x.payload.client), ["b", "c", "d"]);
  assert.deepEqual(list.map((x) => !!x.seen_at), [false, false, true]);
});

test("an event arriving while the first read is in flight still alerts once", () => {
  const t = createAlertTracker();
  const e = (id, minute, seen_at = null) => ({ id, created_at: `2026-10-15T10:${minute}:00Z`, seen_at });
  assert.deepEqual(t.incoming([e("live", "05")]), []); // held: first read not finished
  // The backlog includes the live event (committed before the read) and old ones.
  const first = t.loaded([e("live", "05"), e("old-unseen", "01"), e("old-seen", "00", "x")]);
  assert.deepEqual(first.map((x) => x.id), ["live"]);
  assert.deepEqual(t.incoming([e("live", "05")]), []); // realtime echo is not repeated
  assert.deepEqual(t.incoming([e("next", "07")]).map((x) => x.id), ["next"]);
  // Reconnection catch-up announces only what was missed meanwhile, oldest first.
  const missed = t.loaded([e("m2", "09"), e("m1", "08"), e("next", "07"), e("old-unseen", "01")]);
  assert.deepEqual(missed.map((x) => x.id), ["m1", "m2"]);
});

test("first read failing keeps holding events until a later read succeeds", () => {
  const t = createAlertTracker();
  t.incoming([{ id: "a", created_at: "2026-10-15T10:00:00Z" }]);
  assert.equal(t.ready, false);
  assert.deepEqual(t.loaded([]).map((x) => x.id), ["a"]);
});

test("alerts older than 90 days are removed per studio, recent ones stay", { timeout: 120000 }, async () => {
  const db = new PGlite({ extensions: { btree_gist } });
  try {
    await migrateScheduling(db);
    for (const name of ["booking_notifications", "booking_notifications_retention"])
      await db.exec(await readFile(new URL(`../supabase/${name}.sql`, import.meta.url), "utf8"));
    const f = await schedulingFixture(db), other = await schedulingFixture(db);
    const add = (studio, days) => db.query("insert into public.studio_notifications(studio_id,kind,created_at) values($1,'new_booking',now()-make_interval(days=>$2))", [studio, days]);
    const count = async (studio) => Number((await db.query("select count(*) n from public.studio_notifications where studio_id=$1", [studio])).rows[0].n);
    await add(f.studio.id, 120); await add(f.studio.id, 30); await add(other.studio.id, 120);
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.query("select public.book_appointment_team($1,$2,$3,'Nova','','11999998888','',$4)", [f.studio.slug, [f.free], f.at("09:00"), f.p1]);
    assert.equal(await count(f.studio.id), 2); // 30-day alert + the new one
    assert.equal(await count(other.studio.id), 1); // other studio untouched until it has activity
    await db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [other.owner]);
      await tx.exec("set local role authenticated");
      await tx.query("select public.mark_notifications_seen($1)", [other.studio.id]);
    });
    assert.equal(await count(other.studio.id), 0);
  } finally {
    await db.close();
  }
});
