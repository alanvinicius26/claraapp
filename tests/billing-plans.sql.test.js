import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { migrateBilling, billingFixture } from "./billing-fixture.js";
import {
  PLANS,
  teamSize,
  planForCount,
} from "../supabase/functions/_shared/plans.js";

test(
  "five-person billing rules run in PostgreSQL without the unpublished scheduling migration",
  { timeout: 120000 },
  async (t) => {
    const db = new PGlite({ extensions: { btree_gist } });
    try {
      await migrateBilling(db);
      const f = await billingFixture(db),
        other = await billingFixture(db);
      const { one, owner, studio, primary, add, asOwner, account, status } = f;
      const future = new Date(Date.now() + 86400000 * 20).toISOString();
      let second;
      await t.test(
        "migration keeps billing disabled and counts proprietor only once, even inactive",
        async () => {
          await asOwner();
          assert.equal((await status()).billing_enabled, false);
          assert.equal((await status()).trial_ends_at, null);
          assert.equal((await status()).active_professionals, 1);
          await db.query(
            "update public.professionals set active=false where id=$1",
            [primary],
          );
          assert.equal((await status()).active_professionals, 1);
          second = await add();
          assert.equal((await status()).active_professionals, 2);
          const inactive = await add("Inativa", false);
          assert.equal((await status()).active_professionals, 2);
          await db.query(
            "update public.professionals set active=true where id=$1",
            [inactive],
          );
          assert.equal((await status()).active_professionals, 3);
          await add();
          await add();
          await assert.rejects(add(), /limite é de cinco/);
          const sixth = await add("Reserva", false);
          await assert.rejects(
            db.query(
              "update public.professionals set active=true where id=$1",
              [sixth],
            ),
            /limite é de cinco/,
          );
          assert.equal((await status()).active_professionals, 5);
        },
      );
      await t.test(
        "team enforcement rejects direct REST-equivalent updates, identity changes and another tenant",
        async () => {
          await assert.rejects(
            db.query(
              "update public.professionals set is_default=true where id=$1",
              [second],
            ),
            /identificação/,
          );
          await assert.rejects(
            db.query(
              "select public.billing_begin_operation($1,'checkout','team5')",
              [owner],
            ),
            /permission denied/,
          );
          await assert.rejects(
            db.query("select encaixa_private.plan_limit('team5')"),
            /permission denied/,
          );
          await assert.rejects(
            db.query(
              "insert into public.professionals(studio_id,name) values($1,'Outra')",
              [other.studio.id],
            ),
            /row-level security/,
          );
          assert.equal(
            (
              await db.query(
                "select id from public.professionals where studio_id=$1",
                [other.studio.id],
              )
            ).rows.length,
            0,
          );
        },
      );
      await t.test(
        "paid plans enforce 1/3/4/5, with exact agreed BRL amounts",
        async () => {
          await db.exec("reset role");
          await db.query("select encaixa_private.activate_billing()");
          await account({
            trial_ends_at: "2020-01-01",
            customer_id: "cus_local",
            subscription_id: "sub_local",
            status: "active",
            paid_until: future,
          });
          await asOwner();
          assert.equal(
            (await status()).can_use,
            false,
            "five-person team cannot keep solo paid access",
          );
          await db.query(
            "update public.professionals set active=false where studio_id=$1 and not is_default",
            [studio.id],
          );
          assert.equal((await status()).can_use, true);
          for (const plan of PLANS) {
            await account({ plan_id: plan.id });
            await asOwner();
            const s = await status();
            assert.equal(s.amount, plan.amount);
            assert.equal(s.effective_limit, plan.limit);
            while ((await status()).active_professionals < plan.limit)
              await add();
            await assert.rejects(
              add(),
              plan.limit === 5 ? /limite é de cinco/ : /plano não inclui/,
            );
          }
        },
      );
      await t.test(
        "downgrade rejects excess attendants; operation freezes freed places until provider reconciliation",
        async () => {
          await db.exec("reset role");
          await assert.rejects(
            db.query(
              "select public.billing_begin_operation($1,'change','team3')",
              [owner],
            ),
            /Desative os atendentes/,
          );
          await asOwner();
          await db.query(
            "update public.professionals set active=false where studio_id=$1 and not is_default",
            [studio.id],
          );
          await add();
          await add();
          await db.exec("reset role");
          const op = (
            await one(
              "select public.billing_begin_operation($1,'change','team3') v",
              [owner],
            )
          ).v;
          await assert.rejects(
            db.query(
              "select public.billing_begin_operation($1,'change','team3')",
              [owner],
            ),
            /andamento/,
          );
          await asOwner();
          await assert.rejects(add(), /plano não inclui/);
          await db.exec("reset role");
          await db.query(
            "select public.billing_finish_operation($1,$2,$3,false)",
            [owner, op.operation.key, op.operation_ticket],
          );
          const retry = (
            await one(
              "select public.billing_begin_operation($1,'change','team3') v",
              [owner],
            )
          ).v;
          assert.deepEqual(
            retry.operation,
            op.operation,
            "idempotent retry preserves key, plan and proration date",
          );
          await db.query(
            "select public.billing_finish_operation($1,$2,$3,true)",
            [owner, retry.operation.key, retry.operation_ticket],
          );
          await asOwner();
          await add();
        },
      );
      await t.test(
        "confirmed webhook applies plan; unpaid upgrade preserves but cannot extend the old paid period",
        async () => {
          await account({ plan_id: "team4", paid_until: future });
          const apply = async (event, plan, until, preserve, end = future) => {
            const ticket = (
              await one("select public.billing_sync_claim('cus_local',$1) v", [
                event,
              ])
            ).v;
            return one(
              "select public.billing_apply_plan_event($1,100,'cus_local','sub_local','active',$2,false,$3,$4,$5,$6) v",
              [event, until, ticket, plan, preserve, end],
            );
          };
          await apply(
            "evt_failed_upgrade",
            "team4",
            null,
            true,
            new Date(Date.now() + 40 * 86400000).toISOString(),
          );
          assert.equal((await account()).paid_until.toISOString(), future);
          await apply("evt_unknown_unpaid_upgrade", "team5", null, true);
          assert.equal(
            (await account()).paid_until,
            null,
            "a new plan never inherits unproven paid access",
          );
          await apply("evt_paid_upgrade", "team5", future, false);
          assert.equal((await account()).plan_id, "team5");
          assert.equal(
            (
              await one(
                "select public.billing_sync_claim('cus_local','evt_paid_upgrade') v",
              )
            ).v,
            null,
          );
          await asOwner();
          assert.equal((await status()).can_use, true);
        },
      );
      await t.test(
        "expired access still permits deactivation and preserves existing professional records",
        async () => {
          await account({ paid_until: "2020-01-01", status: "past_due" });
          await asOwner();
          const before = Number(
            (await one("select count(*) n from public.professionals")).n,
          );
          await db.query(
            "update public.professionals set active=false where studio_id=$1 and not is_default",
            [studio.id],
          );
          assert.equal(
            Number(
              (await one("select count(*) n from public.professionals")).n,
            ),
            before,
          );
          await assert.rejects(add(), /período de acesso terminou/);
          assert.equal((await status()).active_professionals, 1);
        },
      );
      await t.test(
        "inactive billing and free trial support all five, with isolated limits per owner",
        async () => {
          await account({ status: "trial", trial_ends_at: future });
          await asOwner();
          for (let i = 0; i < 4; i++) await add();
          await assert.rejects(add(), /limite é de cinco/);
          await db.exec("reset role");
          await other.asOwner();
          assert.equal((await other.status()).active_professionals, 1);
          assert.equal((await other.status()).effective_limit, 5);
        },
      );
    } finally {
      await db.close();
    }
  },
);

test("catalog does not undercount an inactive owner or charge for inactive employees", () => {
  assert.equal(
    teamSize([
      { is_default: true, active: true },
      { active: true },
      { active: false },
    ]),
    2,
  );
  assert.equal(
    teamSize([{ is_default: true, active: false }, { active: true }]),
    2,
  );
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((n) => planForCount(n).amount),
    [2990, 5990, 5990, 7990, 9990],
  );
  for (const n of [0, 6, -1, 2.5, NaN]) assert.equal(planForCount(n), null);
});

test("migration refuses oversized legacy teams and rolls back without deleting history", async () => {
  const db = new PGlite({ extensions: { btree_gist } });
  try {
    await migrateBilling(db, { plans: false });
    const f = await billingFixture(db);
    for (let i = 0; i < 5; i++) await f.add();
    await assert.rejects(
      db.exec(
        await readFile(
          new URL("../supabase/billing_plans.sql", import.meta.url),
          "utf8",
        ),
      ),
      /mais de cinco/,
    );
    await db.exec("rollback");
    assert.equal(
      Number((await f.one("select count(*) n from public.professionals")).n),
      6,
    );
  } finally {
    await db.close();
  }
});

test("plan migration also composes with the locally prepared scheduling migration", async () => {
  const db = new PGlite({ extensions: { btree_gist } });
  try {
    await migrateBilling(db, { scheduling: true });
    const f = await billingFixture(db);
    for (let i = 0; i < 4; i++) await f.add();
    await assert.rejects(f.add(), /limite é de cinco/);
  } finally {
    await db.close();
  }
});
