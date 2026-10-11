// Dedicated localhost PostgreSQL; never reads remote credentials or production data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { migrateBilling, billingFixture } from "./billing-fixture.js";
const localRequire = createRequire(
  new URL("../.local/pg-test/package.json", import.meta.url),
);
const { Client } = localRequire("pg");
const run = promisify(execFile);
const binary = resolve(
  ".local/pg-test/node_modules/@embedded-postgres/windows-x64/native/bin",
);

test(
  "real PostgreSQL serializes team limits and billing operations across separate connections",
  { timeout: 120000 },
  async (t) => {
    const dir = await mkdtemp(resolve(".local/billing-pg-"));
    const password = randomBytes(24).toString("hex"),
      passwordFile = join(dir, "init-password"),
      data = join(dir, "data"),
      port = 55440;
    await writeFile(passwordFile, password);
    let started = false;
    const clients = [];
    const connect = async () => {
      const c = new Client({
        host: "127.0.0.1",
        port,
        user: "billing_test",
        password,
        database: "postgres",
        connectionTimeoutMillis: 5000,
      });
      await c.connect();
      clients.push(c);
      await c.query("set statement_timeout='15s'; set lock_timeout='10s'");
      return c;
    };
    try {
      await run(
        join(binary, "initdb.exe"),
        [
          "-D",
          data,
          "-U",
          "billing_test",
          "--auth=scram-sha-256",
          `--pwfile=${passwordFile}`,
          "--encoding=UTF8",
          "--locale=C",
        ],
        { windowsHide: true, timeout: 30000 },
      );
      await run(
        join(binary, "pg_ctl.exe"),
        [
          "-D",
          data,
          "-l",
          join(dir, "postgres.log"),
          "-o",
          `-h 127.0.0.1 -p ${port}`,
          "-w",
          "start",
        ],
        { windowsHide: true, timeout: 30000 },
      );
      started = true;
      const admin = await connect(),
        db = {
          exec: (sql) => admin.query(sql),
          query: (sql, args) => admin.query(sql, args),
        };
      await migrateBilling(db);
      const f = await billingFixture(db);
      const contenders = await Promise.all(Array.from({ length: 8 }, connect));
      const add = (c) =>
        c.query(
          "insert into public.professionals(studio_id,name) values($1,'Concorrente') returning id",
          [f.studio.id],
        );
      const count = async () =>
        Number(
          (await f.one("select encaixa_private.team_size($1) n", [f.owner])).n,
        );
      const resetTeam = async (n) => {
        await admin.query(
          "update public.professionals set active=false where studio_id=$1 and not is_default",
          [f.studio.id],
        );
        for (let i = 1; i < n; i++) await f.add();
      };
      await t.test(
        "eight additions competing for the fifth place commit exactly one",
        async () => {
          await resetTeam(4);
          const results = await Promise.allSettled(contenders.map(add));
          assert.equal(
            results.filter((r) => r.status === "fulfilled").length,
            1,
          );
          assert.equal(await count(), 5);
          for (const result of results.filter((r) => r.status === "rejected"))
            assert.match(result.reason.message, /limite é de cinco/);
        },
      );
      await t.test(
        "paid three-person limit also survives eight concurrent additions",
        async () => {
          await resetTeam(2);
          await f.account({
            status: "active",
            paid_until: new Date(Date.now() + 86400000).toISOString(),
            plan_id: "team3",
            customer_id: "cus_concurrent",
            subscription_id: "sub_concurrent",
          });
          await admin.query(
            "update encaixa_private.billing_settings set enabled=true",
          );
          const results = await Promise.allSettled(contenders.map(add));
          assert.equal(
            results.filter((r) => r.status === "fulfilled").length,
            1,
          );
          assert.equal(await count(), 3);
        },
      );
      await t.test(
        "downgrade racing an added attendant cannot commit both conflicting requests",
        async () => {
          await f.account({ plan_id: "team5" });
          const results = await Promise.allSettled([
            add(contenders[0]),
            contenders[1].query(
              "select public.billing_begin_operation($1,'change','team3')",
              [f.owner],
            ),
          ]);
          assert.equal(
            results.filter((r) => r.status === "fulfilled").length,
            1,
          );
          const account = await f.account();
          if (account.operation) assert.ok((await count()) <= 3);
          else assert.equal(await count(), 4);
          await f.account({
            operation: null,
            operation_ticket: null,
            operation_lease_until: null,
          });
        },
      );
      await t.test(
        "eight simultaneous billing requests acquire only one network lease",
        async () => {
          await resetTeam(1);
          const results = await Promise.allSettled(
            contenders.map((c) =>
              c.query(
                "select public.billing_begin_operation($1,'change','team3')",
                [f.owner],
              ),
            ),
          );
          assert.equal(
            results.filter((r) => r.status === "fulfilled").length,
            1,
          );
          for (const result of results.filter((r) => r.status === "rejected"))
            assert.match(result.reason.message, /andamento/);
          await f.account({
            operation: null,
            operation_ticket: null,
            operation_lease_until: null,
          });
        },
      );
      await t.test(
        "stale repeatable-read snapshots abort instead of exceeding the fifth place",
        async () => {
          await resetTeam(4);
          const c = contenders[0];
          await c.query("begin isolation level repeatable read");
          await c.query("select * from public.professionals");
          await add(contenders[1]);
          await assert.rejects(add(c), { code: "40001" });
          await c.query("rollback");
          assert.equal(await count(), 5);
        },
      );
      await db.exec(await readFile(new URL('../supabase/platform_admin.sql', import.meta.url), 'utf8'));
      await admin.query('insert into encaixa_private.platform_admins(user_id) values($1)', [f.owner]);
      await t.test('courtesy grants racing checkout commit exactly one access decision', async () => {
        await resetTeam(1);
        await f.account({ status: 'canceled', subscription_id: null, customer_id: null, trial_ends_at: '2020-01-01', paid_until: null, operation: null, operation_ticket: null, operation_lease_until: null });
        for (const c of contenders) await c.query("select set_config('request.jwt.claim.sub',$1,false)", [f.owner]);
        const results = await Promise.allSettled(contenders.map((c, i) => i % 2 === 0
          ? c.query("select public.admin_set_access($1,'courtesy','solo',null,'Concorrência',null)", [f.owner])
          : c.query("select public.billing_begin_operation($1,'checkout','solo')", [f.owner])));
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        const grants = await admin.query('select count(*)::int n from encaixa_private.access_grants where owner_id=$1', [f.owner]);
        const account = await f.account();
        assert.equal(grants.rows[0].n + (account.operation ? 1 : 0), 1);
      });
      await t.test('provider verification locks serialize against new checkout operations', async () => {
        await admin.query('delete from encaixa_private.access_grants where owner_id=$1', [f.owner]);
        await f.account({ operation: null, operation_ticket: null, operation_lease_until: null });
        const results = await Promise.allSettled(contenders.map((c, i) => i % 2 === 0
          ? c.query('select public.admin_access_claim($1,$1)', [f.owner])
          : c.query("select public.billing_begin_operation($1,'checkout','solo')", [f.owner])));
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      });
    } finally {
      await Promise.allSettled(clients.map((c) => c.end()));
      if (started)
        await run(
          join(binary, "pg_ctl.exe"),
          ["-D", data, "-m", "fast", "-w", "stop"],
          { windowsHide: true, timeout: 20000 },
        );
      // Keep the isolated cluster and logs as local test evidence.
    }
  },
);
