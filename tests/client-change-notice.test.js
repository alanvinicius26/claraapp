import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { migrateScheduling, schedulingFixture } from "./scheduling-fixture.js";

test("client link deadline: studio setting replaces the fixed 2 hours", { timeout: 120000 }, async (t) => {
  const db = new PGlite({ extensions: { btree_gist } });
  try {
    await migrateScheduling(db);
    const f = await schedulingFixture(db); // studio created before the migration, like production
    await db.exec(await readFile(new URL("../supabase/client_change_notice.sql", import.meta.url), "utf8"));
    const { one, studio, free, at } = f;
    const asPublic = () => db.query("select set_config('request.jwt.claim.sub','',false)");
    const setNotice = (hours) => db.query("update public.studios set change_notice_hours=$1 where id=$2", [hours, studio.id]);
    const book = async (time) => {
      await asPublic();
      return (await one("select public.book_appointment_team($1,$2,$3,'Cliente Online','','11987654321','',$4) r", [studio.slug, [free], at(time), f.p1])).r;
    };
    const manage = async (token, action = "get", start = null) =>
      (await one("select public.manage_booking($1,$2,$3) r", [token, action, start])).r;
    const tokenSlots = async (token) =>
      (await db.query("select * from public.available_slots_team($1,null,$2::date,$3)", [studio.slug, f.date, token])).rows.length;
    // Moves a booking to now()+hours without the scheduling triggers, to test the
    // deadline independently of the time of day the suite runs.
    const startIn = async (id, hours) => {
      await db.exec("set session_replication_role = replica");
      try {
        await db.query(`update public.appointments set starts_at=now()+make_interval(hours=>$2), ends_at=now()+make_interval(hours=>$2,mins=>45),
          occupied=tstzrange(now()+make_interval(hours=>$2),now()+make_interval(hours=>$2,mins=>55),'[)') where id=$1`, [id, hours]);
      } finally { await db.exec("set session_replication_role = origin"); }
    };

    await t.test("existing studios keep 2 hours and only the listed options are accepted", async () => {
      assert.equal((await one("select change_notice_hours h from public.studios where id=$1", [studio.id])).h, 2);
      assert.equal((await one("select public.booking_page($1) r", [studio.slug])).r.studio.change_notice_hours, 2);
      for (const bad of [0, 1, 3, 72, null]) await assert.rejects(setNotice(bad));
    });

    await t.test("owner changes the deadline through her own session only", async () => {
      const update = (owner, hours) => db.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
        await tx.exec("set local role authenticated");
        return (await tx.query("update public.studios set change_notice_hours=$1 where id=$2 returning id", [hours, studio.id])).rows.length;
      });
      const stranger = (await one("insert into auth.users(id) values(gen_random_uuid()) returning id")).id;
      assert.equal(await update(stranger, 48), 0);
      assert.equal(await update(f.owner, 24), 1);
      assert.equal((await one("select public.booking_page($1) r", [studio.slug])).r.studio.change_notice_hours, 24);
    });

    await t.test("cancel and reschedule follow the studio deadline in both functions", async () => {
      const a = await book("10:00");
      await startIn(a.id, 23);
      await setNotice(24);
      assert.equal((await manage(a.token)).change_notice_hours, 24);
      assert.equal(await tokenSlots(a.token), 0);
      await assert.rejects(manage(a.token, "cancel"), /até 24 horas antes/);
      await assert.rejects(manage(a.token, "reschedule", at("15:00")), /até 24 horas antes/);
      await setNotice(12);
      assert.ok(await tokenSlots(a.token) > 0);
      assert.equal((await manage(a.token, "cancel")).status, "cancelled");

      const b = await book("13:00");
      await startIn(b.id, 30);
      await setNotice(24);
      const moved = await manage(b.token, "reschedule", at("15:00"));
      assert.equal(Date.parse(moved.starts_at), Date.parse(at("15:00")));
      await setNotice(48);
      assert.ok(await tokenSlots(b.token) > 0); // moved to 7 days ahead: still outside 48 hours
    });

    await t.test("booking notice (min_notice) and link deadline stay independent", async () => {
      const publicSlots = async () =>
        (await db.query("select * from public.available_slots_team($1,$2,$3::date)", [studio.slug, [free], f.date])).rows.length;
      await setNotice(2);
      const before = await publicSlots();
      await setNotice(48);
      assert.equal(await publicSlots(), before); // new bookings ignore the link deadline
      await db.query("update public.studios set min_notice=1440 where id=$1", [studio.id]);
      await setNotice(2);
      const e = await book("17:00");
      await startIn(e.id, 5);
      assert.ok(await tokenSlots(e.token) > 0); // 24 h booking notice does not shorten the link deadline
      assert.equal((await manage(e.token, "cancel")).status, "cancelled");
      await db.query("update public.studios set min_notice=0 where id=$1", [studio.id]);
    });

    await t.test("confirmed status and registered payment checks are unchanged", async () => {
      await setNotice(2);
      const c = await book("09:00");
      await db.query("insert into public.payments(studio_id,appointment_id,amount,method) values($1,$2,10,'Pix')", [studio.id, c.id]);
      assert.equal(await tokenSlots(c.token), 0);
      await assert.rejects(manage(c.token, "cancel"), /pagamento registrado/);
      const d = await book("16:00");
      await manage(d.token, "cancel");
      await assert.rejects(manage(d.token, "cancel"), /até 2 horas antes/);
    });
  } finally {
    await db.close();
  }
});
