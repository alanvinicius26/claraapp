import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { migrateScheduling, schedulingFixture } from "./scheduling-fixture.js";
import { sameInstant } from "../src/scheduling.js";
import { parallelServiceData, sharedAppointmentIds } from "../src/parallel.js";

test("service form values become encaixe columns within the database limits", () => {
  assert.deepEqual(parallelServiceData({ allows_parallel: "on", parallel_limit: "3" }), { allows_parallel: true, parallel_limit: 3 });
  assert.deepEqual(parallelServiceData({ allows_parallel: "on", parallel_limit: "40" }), { allows_parallel: true, parallel_limit: 10 });
  assert.deepEqual(parallelServiceData({}, { parallel_limit: 4 }), { allows_parallel: false, parallel_limit: 4 });
  assert.deepEqual(parallelServiceData({}), { allows_parallel: false, parallel_limit: 2 });
});

test("agenda marks only appointments served together by the same professional", () => {
  const at = (id, start, end, professional_id = "p1", status = "confirmed") =>
    ({ id, professional_id, status, starts_at: `2026-10-20T${start}:00-03:00`, ends_at: `2026-10-20T${end}:00-03:00` });
  const ids = sharedAppointmentIds([at("a", "09:00", "10:00"), at("b", "09:30", "10:30"), at("c", "10:30", "11:00"),
    at("d", "09:00", "10:00", "p2"), at("e", "09:00", "10:00", "p1", "cancelled")]);
  assert.deepEqual([...ids].sort(), ["a", "b"]);
});

test("encaixes: parallel capacity per professional across all write paths", { timeout: 120000 }, async (t) => {
  const db = new PGlite({ extensions: { btree_gist } });
  try {
    await migrateScheduling(db);
    const f = await schedulingFixture(db);
    const { one, studio, p1, p2, free, manicure, date, at, insert } = f;
    // Fixture buffer: 10 minutes. A 60-minute service at 09:00 occupies [09:00,10:10).
    const service = async (name, parallel, limit = 2) => (await one(
      "insert into public.services(studio_id,name,duration,price,allows_parallel,parallel_limit) values($1,$2,60,40,$3,$4) returning id",
      [studio.id, name, parallel, limit])).id;
    const nails = await service("Pé e mão", true, 3);
    const brush = await service("Escova", true, 2);
    const asOwner = () => db.query("select set_config('request.jwt.claim.sub',$1,false)", [f.owner]);
    const asPublic = () => db.query("select set_config('request.jwt.claim.sub','',false)");
    const setPro = (accepts, online = false, pid = p1) =>
      db.query("update public.professionals set accepts_parallel=$1,parallel_online=$2 where id=$3", [accepts, online, pid]);
    const clean = async () => {
      await asPublic();
      await db.query("delete from public.appointments where studio_id=$1", [studio.id]);
      await db.query("update public.services set allows_parallel=true where id=$1", [nails]);
      await setPro(false);
    };
    const ownerSlots = async (services, pid = p1, appointment = null) => (await db.query(
      "select * from public.owner_available_slots($1,$2,$3,$4,$5)", [studio.id, pid, services, date, appointment])).rows;
    const publicSlots = async (services, pid = p1) => (await db.query(
      "select * from public.available_slots_team($1,$2,$3,null,$4)", [studio.slug, services, date, pid])).rows;
    const find = (rows, time) => rows.find((r) => sameInstant(r.starts_at, at(time)));
    const book = (services, time, pid = p1) => db.query(
      "select public.book_appointment_team($1,$2,$3,'Cliente online','','11999998888','',$4) r", [studio.slug, services, at(time), pid]);
    const block = (from, to, pid = p1) => db.query(
      "insert into public.appointments(studio_id,professional_id,starts_at,ends_at,status) values($1,$2,$3,$4,'blocked') returning *",
      [studio.id, pid, at(from), at(to)]);

    await t.test("defaults keep every reservation exclusive and snapshot the limit", async () => {
      await asOwner();
      const a = await insert([nails], at("09:00"));
      assert.equal(a.parallel_limit, 3);
      assert.equal((await insert([free], at("13:00"))).parallel_limit, 1);
      assert.equal((await insert([nails, brush], at("15:00"))).parallel_limit, 2);
      assert.equal((await insert([nails, free], at("13:00"), p2)).parallel_limit, 1);
      await assert.rejects(insert([nails], at("09:00")), { code: "23P01", message: /não faz encaixes/ });
      assert.equal(find(await ownerSlots([nails]), "09:00"), undefined);
      await clean();
    });

    await t.test("a professional doing encaixes serves up to the smallest limit at every instant", async () => {
      await setPro(true);
      await asOwner();
      await insert([nails], at("09:00"));
      await insert([nails], at("09:00"));
      await insert([nails], at("09:30"));
      await assert.rejects(insert([nails], at("09:45")), { code: "23P01", message: /limite de pessoas/ });
      // 10:15: the 09:00 pair ended at 10:10 ([) ranges); only 09:30 is still active.
      await insert([brush], at("10:15"));
      await assert.rejects(insert([brush], at("10:15")), { code: "23P01", message: /limite de pessoas/ });
      await assert.rejects(insert([nails], at("10:15")), { code: "23P01", message: /limite de pessoas/ });
      await assert.rejects(insert([free], at("09:00")), { code: "23P01", message: /ocupado para esta profissional/ });
      await assert.rejects(block("09:00", "09:30"), { code: "23P01" });
      await insert([free], at("09:00"), p2);
      await insert([free], at("13:00"));
      await assert.rejects(insert([nails], at("13:00")), { code: "23P01", message: /ocupado para esta profissional/ });
      await clean();
    });

    await t.test("owner availability marks encaixe times and still refuses exclusive overlaps", async () => {
      await setPro(true);
      await asOwner();
      const a = await insert([nails], at("09:00"));
      const slots = await ownerSlots([nails]);
      assert.equal(find(slots, "09:00").shared, true);
      assert.equal(find(slots, "13:00").shared, false);
      assert.equal(find(await ownerSlots([free]), "09:00"), undefined);
      assert.equal(find(await ownerSlots([nails], p1, a.id), "09:00").shared, false);
      const b = await insert([nails], at("13:00"));
      const options = (await one("select public.clara_reschedule_options($1,$2) data", [b.id, date])).data;
      assert.ok(options.slots.some((x) => sameInstant(x, at("09:00"))));
      await db.query("update public.appointments set starts_at=$1 where id=$2", [at("09:00"), b.id]);
      await insert([free], at("15:00"));
      await assert.rejects(db.query("update public.appointments set starts_at=$1 where id=$2", [at("15:00"), b.id]), { code: "23P01" });
      await setPro(false);
      assert.equal(find(await ownerSlots([nails]), "09:00"), undefined);
      await clean();
    });

    await t.test("online booking offers encaixes only where the professional released them", async () => {
      await setPro(true, false);
      await asOwner();
      await insert([nails], at("09:00"));
      await asPublic();
      assert.equal(find(await publicSlots([nails]), "09:00"), undefined);
      await assert.rejects(book([nails], "09:00"), /não cabe/);
      await assert.rejects(insert([nails], at("09:00")), { code: "23P01" });
      await setPro(true, true);
      assert.ok(find(await publicSlots([nails]), "09:00"));
      assert.equal(find(await publicSlots([free]), "09:00"), undefined);
      await book([nails], "09:00");
      await book([nails], "09:00");
      assert.equal(find(await publicSlots([nails]), "09:00"), undefined);
      await assert.rejects(book([nails], "09:00"), /não cabe/);
      assert.equal(Number((await one("select count(*) n from public.appointments where studio_id=$1 and starts_at=$2",
        [studio.id, at("09:00")])).n), 3);
      await assert.rejects(setPro(false, true), /professionals_parallel_online/);
      await clean();
    });

    await t.test("catalog and team changes never invalidate booked encaixes", async () => {
      await setPro(true);
      await asOwner();
      const a = await insert([nails], at("09:00"));
      await insert([nails], at("09:00"));
      await db.query("update public.services set allows_parallel=false where id=$1", [nails]);
      assert.equal((await one("select parallel_limit from public.appointments where id=$1", [a.id])).parallel_limit, 3);
      await assert.rejects(insert([nails], at("09:00")), { code: "23P01" });
      await db.query("update public.services set allows_parallel=true where id=$1", [nails]);
      await setPro(false);
      await db.query("update public.appointments set notes='Mantido' where id=$1", [a.id]);
      await assert.rejects(db.query("update public.appointments set starts_at=$1 where id=$2", [at("09:15"), a.id]), /não faz encaixes/);
      await db.query("update public.appointments set status='cancelled' where id=$1", [a.id]);
      await insert([free], at("13:00"));
      await clean();
    });

    await t.test("a shared room or table stays exclusive during encaixes", async () => {
      await setPro(true);
      await db.query("update public.services set allows_parallel=true,parallel_limit=2 where id=$1", [manicure]);
      await asOwner();
      await insert([manicure], at("09:00"));
      await assert.rejects(insert([manicure], at("09:00")), { code: "23P01" });
      assert.equal(find(await ownerSlots([manicure]), "09:00"), undefined);
      await db.query("update public.services set allows_parallel=false where id=$1", [manicure]);
      await clean();
    });

    await t.test("owner settings are protected by RLS", async () => {
      await db.exec("set role authenticated");
      await asOwner();
      await db.query("update public.professionals set accepts_parallel=true,parallel_online=true where id=$1", [p1]);
      await db.query("update public.services set allows_parallel=true,parallel_limit=4 where id=$1", [free]);
      await assert.rejects(db.query("update public.services set parallel_limit=11 where id=$1", [free]), /parallel_limit/);
      await db.query("select set_config('request.jwt.claim.sub',gen_random_uuid()::text,false)");
      assert.equal((await db.query("update public.professionals set accepts_parallel=false where id=$1 returning id", [p1])).rows.length, 0);
      await db.exec("reset role");
      await asPublic();
      await db.query("update public.services set allows_parallel=false,parallel_limit=2 where id=$1", [free]);
      await clean();
    });
  } finally { await db.close(); }
});
