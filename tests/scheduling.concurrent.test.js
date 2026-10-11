// Dedicated local PostgreSQL, separate connections, no remote environment vars.
// Install the pinned test runtime as documented in AUDITORIA_AGENDAMENTOS.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { migrateScheduling, schedulingFixture } from "./scheduling-fixture.js";

const localRequire = createRequire(new URL("../.local/pg-test/package.json", import.meta.url));
const { Client } = localRequire("pg");
const run = promisify(execFile);
const binary = resolve(".local/pg-test/node_modules/@embedded-postgres/windows-x64/native/bin");

test("real PostgreSQL: independent transactions serialize bookings and configuration", { timeout: 120000 }, async (t) => {
  const dir = await mkdtemp(resolve(".local/scheduling-pg-"));
  const password = randomBytes(24).toString("hex");
  const passwordFile = join(dir, "init-password");
  await writeFile(passwordFile, password);
  const data = join(dir, "data");
  const port = 55439;
  let started = false;
  const clients = [];
  const connect = async () => {
    const c = new Client({ host: "127.0.0.1", port, user: "scheduling_test", password, database: "postgres", connectionTimeoutMillis: 5000 });
    await c.connect(); clients.push(c);
    await c.query("set statement_timeout='15s'; set lock_timeout='10s'; set timezone='UTC'");
    return c;
  };
  try {
    await run(join(binary, "initdb.exe"), ["-D", data, "-U", "scheduling_test", "--auth=scram-sha-256", `--pwfile=${passwordFile}`, "--encoding=UTF8", "--locale=C"], { windowsHide: true, timeout: 30000 });
    await run(join(binary, "pg_ctl.exe"), ["-D", data, "-l", join(dir, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "start"], { windowsHide: true, timeout: 30000 });
    started = true;
    const admin = await connect();
    const db = { exec: (sql) => admin.query(sql), query: (sql, args) => admin.query(sql, args) };
    await migrateScheduling(db);
    const f = await schedulingFixture(db);
    const { studio, p1, p2, manicure, free, at, date, client, one } = f;
    const contenders = await Promise.all(Array.from({ length: 8 }, connect));
    const write = (c, professional = p1, service = free, start = at()) => c.query(
      "insert into public.appointments(studio_id,professional_id,client_id,service_ids,starts_at,ends_at) values($1,$2,$3,$4,$5,$5::timestamptz+interval '1 minute') returning id",
      [studio.id, professional, client, [service], start]);
    const clean = () => admin.query("delete from public.appointments where studio_id=$1", [studio.id]);
    await t.test("8 simultaneous same-professional inserts yield exactly one committed booking", async () => {
      const results = await Promise.allSettled(contenders.map((c) => write(c)));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      for (const result of results.filter((r) => r.status === "rejected")) assert.equal(result.reason.code, "23P01");
      assert.equal(Number((await one("select count(*) n from public.appointments")).n), 1);
      await clean();
    });
    await t.test("different professionals competing for one maca cannot both commit", async () => {
      const results = await Promise.allSettled([write(contenders[0], p1, manicure), write(contenders[1], p2, manicure)]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(results.find((r) => r.status === "rejected").reason.constraint, "appointment_resources_no_overlap");
      assert.equal(Number((await one("select count(*) n from public.appointment_resources")).n), 1);
      await clean();
    });
    await t.test("8 concurrent public RPC calls create exactly one client and reservation", async () => {
      const before = Number((await one("select count(*) n from public.clients")).n);
      const results = await Promise.allSettled(contenders.map((c) => c.query("select public.book_appointment_team($1,$2,$3,'QA Online','','11999998888','',$4)", [studio.slug, [manicure], at(), p1])));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(Number((await one("select count(*) n from public.clients")).n), before + 1);
      await clean();
    });
    await t.test("nonconflicting professionals can both commit", async () => {
      const results = await Promise.allSettled([write(contenders[0], p1), write(contenders[1], p2)]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
      await clean();
    });
    await t.test("two simultaneous reschedules have one winner and preserve the loser", async () => {
      const a = await f.insert([manicure], at("09:00"), p1);
      const b = await f.insert([manicure], at("10:00"), p2);
      const results = await Promise.allSettled([a, b].map((a, i) => contenders[i].query("update public.appointments set starts_at=$1 where id=$2 returning id", [at("14:00"), a.id])));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const loser = results[0].status === "rejected" ? a : b;
      assert.equal((await one("select starts_at from public.appointments where id=$1", [loser.id])).starts_at.getTime(), loser.starts_at.getTime());
      await clean();
    });
    await t.test("hours change racing a reservation never leaves a booking on a closed day", async () => {
      const results = await Promise.allSettled([
        write(contenders[0]),
        contenders[1].query("update public.working_hours set enabled=false where studio_id=$1 and weekday=extract(dow from $2::date)", [studio.id, date]),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(Number((await one("select count(*) n from public.appointments a where not encaixa_private.schedule_fits(a.studio_id,a.professional_id,a.occupied)")).n), 0);
      await clean();
      await admin.query("update public.working_hours set enabled=true where studio_id=$1", [studio.id]);
    });
    await t.test("assigning a resource concurrently with booking is atomic", async () => {
      await f.insert([manicure], at(), p1);
      const results = await Promise.allSettled([
        write(contenders[0], p2, free),
        contenders[1].query("update public.services set resource_id=$1 where id=$2", [f.r1, free]),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const missing = await one(`select count(*) n from public.appointments a join public.services s on s.id=any(a.service_ids)
        where a.status='confirmed' and s.resource_id is not null and not exists(select 1 from public.appointment_resources ar
          where ar.appointment_id=a.id and ar.resource_id=s.resource_id and ar.occupied=a.occupied)`);
      assert.equal(Number(missing.n), 0);
      await clean();
      await admin.query("update public.services set resource_id=null where id=$1", [free]);
    });
    await t.test("stale REPEATABLE READ config snapshots abort instead of violating schedule", async () => {
      const c = contenders[0];
      await c.query("begin isolation level repeatable read");
      await c.query("select * from public.working_hours");
      await contenders[1].query("update public.working_hours set enabled=false where studio_id=$1", [studio.id]);
      await assert.rejects(write(c), { code: "40001" });
      await c.query("rollback");
      await admin.query("update public.working_hours set enabled=true where studio_id=$1", [studio.id]);
    });
    const nails = (await one("insert into public.services(studio_id,name,duration,price,allows_parallel,parallel_limit) values($1,'Encaixe QA',45,40,true,3) returning id", [studio.id])).id;
    await admin.query("update public.professionals set accepts_parallel=true,parallel_online=true where id=$1", [p1]);
    await t.test("encaixe: 8 simultaneous inserts for a limit of 3 commit exactly 3", async () => {
      const results = await Promise.allSettled(contenders.map((c) => write(c, p1, nails)));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
      for (const result of results.filter((r) => r.status === "rejected")) assert.equal(result.reason.code, "23P01");
      await clean();
    });
    await t.test("encaixe: 8 concurrent public RPC calls fill the 3 places and create 3 clients", async () => {
      const before = Number((await one("select count(*) n from public.clients")).n);
      const results = await Promise.allSettled(contenders.map((c) => c.query("select public.book_appointment_team($1,$2,$3,'QA Encaixe','','11999998888','',$4)", [studio.slug, [nails], at(), p1])));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
      assert.equal(Number((await one("select count(*) n from public.clients")).n), before + 3);
      await clean();
    });
    await t.test("encaixe racing exclusive services never mixes them", async () => {
      const results = await Promise.allSettled(contenders.map((c, i) => write(c, p1, i % 2 ? nails : free)));
      const rows = (await admin.query("select parallel_limit from public.appointments where studio_id=$1", [studio.id])).rows;
      assert.equal(results.filter((r) => r.status === "fulfilled").length, rows.length);
      if (rows.some((r) => r.parallel_limit === 1)) assert.equal(rows.length, 1);
      else assert.ok(rows.length >= 1 && rows.length <= 3);
      await clean();
    });
    await admin.query("update public.professionals set accepts_parallel=false,parallel_online=false where id=$1", [p1]);
    console.log("PostgreSQL version:", (await one("select version() v")).v);
  } finally {
    await Promise.allSettled(clients.map((c) => c.end()));
    if (started) await run(join(binary, "pg_ctl.exe"), ["-D", data, "-m", "fast", "-w", "stop"], { windowsHide: true, timeout: 20000 });
    // Retain the isolated cluster and log for audit; never recursively delete.
  }
});
