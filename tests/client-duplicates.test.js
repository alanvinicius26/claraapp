import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { migrateScheduling, schedulingFixture } from "./scheduling-fixture.js";
import { phoneKey, duplicateGroups, groupOf } from "../src/client-duplicates.js";
import { alertText } from "../src/booking-alerts.js";

const phones = ["(11) 98765-4321", "+55 11 98765-4321", "5511987654321", "1187654321", "551187654321", "(11) 3265-0101",
  "11 9 8765 4321", "", "123", "0011987654321", "(21) 7123-4567", "11900000101", "abc 11 98765-4321 xyz"];

test("duplicate clients by WhatsApp: owner-only detection, alert and one-click merge", { timeout: 120000 }, async (t) => {
  const db = new PGlite({ extensions: { btree_gist } });
  try {
    await migrateScheduling(db);
    for (const name of ["booking_notifications", "booking_notifications_retention", "client_duplicates"])
      await db.exec(await readFile(new URL(`../supabase/${name}.sql`, import.meta.url), "utf8"));
    const f = await schedulingFixture(db), other = await schedulingFixture(db);
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
    const asPublic = () => db.query("select set_config('request.jwt.claim.sub','',false)");
    const asOwner = (owner) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    const book = async (fx, phone, time, name = "Cliente Online") => {
      await asPublic();
      return (await one("select public.book_appointment_team($1,$2,$3,$4,'',$5,'',$6) r", [fx.studio.slug, [fx.free], fx.at(time), name, phone, fx.p1])).r;
    };
    const lastAlert = async (fx) => (await one("select payload from public.studio_notifications where studio_id=$1 order by created_at desc, id desc limit 1", [fx.studio.id])).payload;
    const asRole = (owner, fn) => db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
      await tx.exec("set local role authenticated");
      return fn(tx);
    });

    await t.test("database and panel compute the same WhatsApp key", async () => {
      for (const p of phones) assert.equal((await one("select encaixa_private.phone_key($1) k", [p])).k, phoneKey(p), p);
    });

    await t.test("online booking from a known WhatsApp is flagged only in the owner's alert", async () => {
      await asOwner(f.owner);
      const known = (await one("insert into public.clients(studio_id,name,phone) values($1,'Maria Souza','(11) 98765-4321') returning id", [f.studio.id])).id;
      const visit = await f.insert([f.free], f.at("09:00"), f.p1, { client_id: known });
      await db.query("update public.appointments set status='completed' where id=$1", [visit.id]);
      const result = await book(f, "11987654321", "11:00", "Maria");
      assert.deepEqual(Object.keys(result).sort(), ["id", "token"]); // public response unchanged
      assert.deepEqual([(await lastAlert(f)).returning, (await lastAlert(f)).previous_visits], [true, 1]);
      await book(f, "1187654321", "13:00", "Maria antiga"); // old 8-digit mobile, same person
      assert.equal((await lastAlert(f)).returning, true);
      await book(f, "11912345678", "14:00", "Pessoa nova");
      assert.equal((await lastAlert(f)).returning, undefined);
      await book(other, "11987654321", "11:00", "Outro estúdio"); // no cross-studio matching
      assert.equal((await lastAlert(other)).returning, undefined);
    });

    await t.test("merge group: owner only, same WhatsApp only, all or nothing", async () => {
      const ids = (await db.query("select id,email from public.clients where studio_id=$1 and encaixa_private.phone_key(phone)='11987654321' order by created_at,id", [f.studio.id])).rows.map((r) => r.id);
      assert.equal(ids.length, 3);
      const [target, ...sources] = ids;
      await db.query("update public.clients set email='maria@exemplo.invalid' where id=$1", [sources[0]]);
      const stranger = (await one("select id from public.clients where studio_id=$1 and phone='11912345678'", [f.studio.id])).id;
      const merge = (owner, tgt, src) => asRole(owner, (tx) => tx.query("select public.merge_client_group($1,$2) r", [tgt, src]));
      await assert.rejects(() => merge(other.owner, target, sources), /indisponível/); // another studio cannot even confirm the record exists
      await assert.rejects(() => merge(f.owner, target, [...sources, stranger]), /mesmo WhatsApp/);
      assert.equal(Number((await one("select count(*) n from public.clients where id=any($1) and merged_into is not null", [ids])).n), 0);
      await assert.rejects(() => merge(f.owner, target, [target]), /Selecione/);
      await merge(f.owner, target, sources);
      assert.equal(Number((await one("select count(*) n from public.clients where id=any($1) and merged_into=$2", [sources, target])).n), 2);
      assert.equal(Number((await one("select count(*) n from public.appointments where client_id=any($1)", [sources])).n), 0);
      assert.equal(Number((await one("select count(*) n from public.appointments where client_id=$1", [target])).n), 3);
      assert.equal((await one("select email from public.clients where id=$1", [target])).email, "maria@exemplo.invalid");
      await assert.rejects(() => merge(f.owner, target, sources), /indisponível/); // already merged
      await assert.rejects(() => asRole(f.owner, (tx) => tx.query("select encaixa_private.phone_key('1')")));
      await asPublic();
      await assert.rejects(() => db.transaction(async (tx) => { await tx.exec("set local role anon"); await tx.query("select public.merge_client_group($1,$2)", [target, sources]); }));
    });
  } finally {
    await db.close();
  }
});

test("panel groups duplicates and suggests the record with more history as main", () => {
  const visits = new Map([["b", { completed: [1, 2] }], ["c", { completed: [], next: {} }]]);
  const c = (id, phone, created_at, extra = {}) => ({ id, name: id.toUpperCase(), phone, created_at, ...extra });
  const groups = duplicateGroups([
    c("a", "(11) 98765-4321", "2026-01-01"), c("b", "11987654321", "2026-05-01"), c("c", "1187654321", "2026-03-01"),
    c("d", "(11) 91111-2222", "2026-01-01"), c("e", "", "2026-01-01"), c("f", "", "2026-01-02"),
    c("g", "11911112222", "2026-02-01", { merged_into: "d" }),
  ], visits);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].clients.map((x) => x.id), ["b", "c", "a"]); // visits, then upcoming, then oldest
  assert.equal(groupOf(groups, "a"), groups[0]);
  assert.equal(groupOf(groups, "d"), null);
  assert.deepEqual(duplicateGroups([c("x", "11987654321", "2026-01-01")]), []);
});

test("owner alert says when the WhatsApp is already a client", () => {
  const base = { kind: "new_booking", payload: { client: "Maria", service: "Manicure", starts_at: "2026-10-20T13:00:00Z" } };
  assert.equal(alertText(base).title, "Nova reserva");
  const known = alertText({ ...base, payload: { ...base.payload, returning: true, previous_visits: 3 } });
  assert.equal(known.title, "Nova reserva · já é cliente");
  assert.match(known.body, /3 visitas concluídas$/);
  assert.doesNotMatch(alertText({ ...base, payload: { ...base.payload, returning: true, previous_visits: 0 } }).body, /visita/);
});
