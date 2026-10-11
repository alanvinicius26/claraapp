import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { migrateScheduling, schedulingFixture } from "./scheduling-fixture.js";
import { studioInstant, sameInstant } from "../src/scheduling.js";
import { validStart, bookingError } from "../supabase/functions/booking/validation.js";

test("studio wall time uses IANA rules and rejects invalid or ambiguous wall times", () => {
  assert.equal(studioInstant("2026-10-06", "09:00"), "2026-10-06T12:00:00.000Z");
  assert.equal(studioInstant("2018-01-15", "09:00"), "2018-01-15T11:00:00.000Z");
  assert.equal(studioInstant("2026-10-06", "23:45"), "2026-10-07T02:45:00.000Z");
  for (const [d, t] of [["2026-02-30", "09:00"], ["2026-10-06", "25:00"], ["2018-11-04", "00:30"], ["2019-02-16", "23:30"]])
    assert.throws(() => studioInstant(d, t));
  assert.equal(sameInstant("2026-10-06T12:00:00Z", "2026-10-06T09:00:00-03:00"), true);
});

test("gateway requires an explicit valid instant and maps transactional conflicts", () => {
  for (const value of [null, "infinity", "2026-10-06T09:00:00", "2026-02-30T09:00:00Z", "2026-10-06T24:00:00Z"])
    assert.equal(validStart(value), false);
  assert.equal(validStart("2026-10-06T09:00:00-03:00"), true);
  for (const code of ["23P01", "40P01", "40001", "55P03"]) assert.equal(bookingError({ code }).status, 409);
  assert.equal(bookingError({ code: "XX000", message: "internal SQL" }).message.includes("internal"), false);
});

test("scheduling database invariants across all write paths", { timeout: 120000 }, async (t) => {
  const db = new PGlite({ extensions: { btree_gist } });
  try {
    await migrateScheduling(db);
    const f = await schedulingFixture(db);
    const { one, studio, p1, p2, r1, r2, manicure, hair, brow, free, date, at, insert } = f;
    const rejects = (promise, pattern) => assert.rejects(promise, pattern);
    const clean = () => db.query("delete from public.appointments where studio_id=$1", [studio.id]);
    await t.test("continuous multiservice duration, price and one cleanup; forged fields ignored", async () => {
      const a = await insert([manicure, hair], at("13:00"), p1, { resource_ids: [], price: 1, occupied: "empty" });
      assert.equal((a.ends_at - a.starts_at) / 60000, 225);
      assert.equal(Number(a.price), 100);
      assert.deepEqual([...a.resource_ids].sort(), [r1, r2].sort());
      assert.equal(Number((await one("select extract(epoch from (upper(occupied)-ends_at))/60 b from public.appointments where id=$1", [a.id])).b), 10);
      assert.equal((await db.query("select * from public.appointment_resources where appointment_id=$1", [a.id])).rows.length, 2);
      await rejects(insert([manicure, manicure]), /serviços diferentes/);
      await rejects(insert([hair, manicure], at("09:00")), /expediente/);
      await clean();
    });
    await t.test("professional, shared room, buffer boundaries and cancellation", async () => {
      const a = await insert();
      await rejects(insert([free], at("09:15")), { code: "23P01" });
      await rejects(insert([manicure], at("09:30"), p2), { code: "23P01" });
      await rejects(insert([manicure], at("09:45"), p2), { code: "23P01" });
      await insert([free], at("09:00"), p2);
      await insert([manicure], at("09:55"));
      await db.query("update public.appointments set status='cancelled' where id=$1", [a.id]);
      assert.equal((await db.query("select * from public.appointment_resources where appointment_id=$1", [a.id])).rows.length, 0);
      await insert();
      await clean();
    });
    await t.test("direct writes cannot bypass lunch, closing, individual hours or time off", async () => {
      for (const clock of ["08:45", "11:15", "12:00", "17:15"]) await rejects(insert([manicure], at(clock)), /expediente/);
      await db.query("insert into public.professional_hours(professional_id,studio_id,weekday,opens,closes) values($1,$2,extract(dow from $3::date),'14:00','18:00')", [p2, studio.id, date]);
      await rejects(insert([free], at("09:00"), p2), /expediente/);
      await insert([free], at("14:00"), p2);
      await insert([], at("00:00"), p1, { status: "blocked", client_id: null, ends_at: at("23:59") });
      await rejects(insert(), { code: "23P01" });
      await clean();
      await db.query("delete from public.professional_hours where professional_id=$1", [p2]);
    });
    await t.test("catalog and buffer changes preserve historical snapshots; expansion is atomic", async () => {
      const a = await insert();
      await insert([free], at("10:00"));
      await db.query("update public.services set duration=60,price=80 where id=$1", [manicure]);
      await db.query("update public.studios set buffer=5 where id=$1", [studio.id]);
      await db.query("update public.appointments set notes='updated',resource_ids='{}',ends_at=starts_at+interval '5 min' where id=$1", [a.id]);
      const saved = await one("select * from public.appointments where id=$1", [a.id]);
      assert.equal((saved.ends_at - saved.starts_at) / 60000, 45);
      assert.deepEqual(saved.resource_ids, [r1]);
      await rejects(db.query("update public.appointments set service_ids=$1 where id=$2", [[manicure, brow], a.id]), { code: "23P01" });
      assert.equal((await one("select service_ids from public.appointments where id=$1", [a.id])).service_ids.length, 1);
      await clean();
      await db.query("update public.services set duration=45,price=50 where id=$1", [manicure]);
      await db.query("update public.studios set buffer=10 where id=$1", [studio.id]);
    });
    await t.test("availability, public booking, owner changes and Clara all account for rooms", async () => {
      const a = await insert();
      const slots = await db.query("select * from public.available_slots_team($1,$2,$3,null,$4)", [studio.slug, [manicure], date, p2]);
      assert.equal(slots.rows.some((x) => sameInstant(x.starts_at, at())), false);
      const before = Number((await one("select count(*) n from public.clients where studio_id=$1", [studio.id])).n);
      await rejects(db.query("select public.book_appointment_team($1,$2,$3,'Client test','','11999998888','',$4)", [studio.slug, [manicure], at(), p2]), /não cabe/);
      assert.equal(Number((await one("select count(*) n from public.clients where studio_id=$1", [studio.id])).n), before);
      const b = await insert([manicure], at("13:00"), p2);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [f.owner]);
      const ownerSlots = await db.query("select * from public.owner_available_slots($1,$2,$3,$4,$5)", [studio.id, p2, [manicure], date, b.id]);
      assert.equal(ownerSlots.rows.some((x) => sameInstant(x.starts_at, at())), false);
      const options = (await one("select public.clara_reschedule_options($1,$2) data", [b.id, date])).data;
      assert.equal(options.slots.some((x) => sameInstant(x, at())), false);
      await rejects(db.query("update public.appointments set starts_at=$1 where id=$2", [at(), b.id]), { code: "23P01" });
      assert.equal(sameInstant((await one("select starts_at from public.appointments where id=$1", [b.id])).starts_at, at("13:00")), true);
      await db.query("select set_config('request.jwt.claim.sub','',false)");
      await clean();
    });
    await t.test("schedule/resource configuration cannot invalidate an existing reservation", async () => {
      const a = await insert();
      await rejects(db.query("update public.working_hours set enabled=false where studio_id=$1", [studio.id]), /sem cobertura/);
      await rejects(db.query("update public.resources set active=false where id=$1", [r1]), /reservas futuras/);
      const b = await insert([free], at(), p2);
      await rejects(db.query("update public.services set resource_id=$1 where id=$2", [r1, free]), { code: "23P01" });
      assert.equal((await one("select resource_id from public.services where id=$1", [free])).resource_id, null);
      assert.deepEqual((await one("select resource_ids from public.appointments where id=$1", [b.id])).resource_ids, []);
      await db.query("update public.services set resource_id=$1 where id=$2", [r2, manicure]);
      const updated = await one("select * from public.appointments where id=$1", [a.id]);
      assert.deepEqual(updated.resource_ids, [r2]);
      assert.equal(updated.starts_at.getTime(), a.starts_at.getTime());
      assert.equal(updated.ends_at.getTime(), a.ends_at.getTime());
      assert.equal(updated.price, a.price);
      assert.deepEqual((await one("select array_agg(resource_id) r from public.appointment_resources where appointment_id=$1", [a.id])).r, [r2]);
      await clean();
      await db.query("update public.services set resource_id=$1 where id=$2", [r1, manicure]);
      await db.query("update public.professionals set active=false where id=$1", [p2]);
      await rejects(insert([free], at(), p2), /profissional ativa/);
      await db.query("update public.professionals set active=true where id=$1", [p2]);
    });
    await t.test("owner preserves off-grid reservations and can book when public page is paused", async () => {
      const a = await insert([manicure], at("09:10"));
      await db.query("update public.studios set active=false where id=$1", [studio.id]);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [f.owner]);
      const slots = await db.query("select * from public.owner_available_slots($1,$2,$3,$4,$5)", [studio.id, p1, [manicure, brow], date, a.id]);
      assert.ok(slots.rows.some((s) => sameInstant(s.starts_at, at("09:10"))));
      assert.ok(slots.rows.some((s) => sameInstant(s.starts_at, at("13:00"))));
      assert.equal((await db.query("select * from public.available_slots_team($1,$2,$3,null,$4)", [studio.slug, [manicure], date, p1])).rows.length, 0);
      await db.query("select set_config('request.jwt.claim.sub','',false)");
      await db.query("update public.studios set active=true where id=$1", [studio.id]);
      await clean();
    });
    await t.test("RLS, allocation write protection, ownership and finite dates", async () => {
      await db.exec("set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [f.owner]);
      await insert();
      await rejects(db.query("delete from public.appointment_resources"), /permission denied/);
      await db.query("select set_config('request.jwt.claim.sub',gen_random_uuid()::text,false)");
      assert.equal((await db.query("select * from public.resources")).rows.length, 0);
      await rejects(db.query("select * from public.owner_available_slots($1,$2,$3,$4)", [studio.id, p1, [free], date]), /Acesso negado/);
      await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)");
      await rejects(db.query("insert into public.appointments(studio_id,professional_id,starts_at,ends_at,status) values($1,$2,'-infinity','infinity','blocked')", [studio.id, p2]), /intervalo/);
      await clean();
    });
    for (const name of ["booking-readiness", "product-completion", "team", "clara-reschedule", "clara-dialogue"]) {
      await t.test(`existing SQL workflow: ${name}`, async () => {
        try { await db.exec(await readFile(new URL(`./${name}.sql`, import.meta.url), "utf8")); }
        finally { await db.exec("rollback; reset role"); }
      });
    }
  } finally { await db.close(); }
});
