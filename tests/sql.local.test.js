import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

test(
  "local PostgreSQL validates migrations, trial expiry, billing replay and tenant isolation",
  { timeout: 120000 },
  async () => {
    const db = new PGlite({ extensions: { btree_gist } });
    try {
      await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create schema extensions;
   create table auth.users(id uuid primary key,email text);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema auth,public to anon,authenticated,service_role;
   set search_path=public,extensions;`);
      const migrations = [
        "schema",
        "hardening",
        "quality",
        "multiservice",
        "booking_readiness",
        "product_completion",
        "team",
        "custom_links",
        "clara",
        "clara_reschedule",
        "clara_dialogue",
        "production_readiness",
        "billing",
        "scheduling_integrity",
      ];
      // Storage policies are tested separately against Supabase; the business schema needs these two columns.
      for (const name of migrations) {
        try {
          await db.exec(
            await readFile(
              new URL(`../supabase/${name}.sql`, import.meta.url),
              "utf8",
            ),
          );
        } catch (e) {
          throw new Error(`Migration ${name}: ${e.message}`);
        }
        if (name === "quality")
          await db.exec(
            `alter table public.studios add column image_url text not null default ''; alter table public.services add column image_url text not null default '';`,
          );
      }
      const owner = "10000000-0000-0000-0000-000000000001",
        other = "10000000-0000-0000-0000-000000000002";
      await db.query("insert into auth.users(id) values($1),($2)", [
        owner,
        other,
      ]);
      await db.exec(
        `set role authenticated; set request.jwt.claim.sub='${owner}';`,
      );
      const studio = (
        await db.query(
          "select public.setup_studio('Studio de teste','Clara','studio-teste') as id",
        )
      ).rows[0].id;
      const beforeActivation = (
        await db.query("select public.billing_status() as value")
      ).rows[0].value;
      assert.equal(beforeActivation.billing_enabled, false);
      assert.equal(beforeActivation.can_use, true);
      assert.equal(beforeActivation.trial_ends_at, null);
      await assert.rejects(
        db.query("select encaixa_private.activate_billing()"),
        /permission denied/,
      );
      await db.exec("reset role");
      await db.query("select encaixa_private.activate_billing()");
      const activatedTrial = (
        await db.query(
          "select trial_ends_at from encaixa_private.billing_accounts where owner_id=$1",
          [owner],
        )
      ).rows[0].trial_ends_at;
      await db.query("select encaixa_private.activate_billing()");
      assert.deepEqual(
        (
          await db.query(
            "select trial_ends_at from encaixa_private.billing_accounts where owner_id=$1",
            [owner],
          )
        ).rows[0].trial_ends_at,
        activatedTrial,
      );
      assert.ok(activatedTrial.getTime() > Date.now() + 6 * 86400000);
      await db.exec(
        `set role authenticated; set request.jwt.claim.sub='${owner}';`,
      );
      const initial = (
        await db.query("select public.dashboard_revision($1) as value", [
          studio,
        ])
      ).rows[0].value;
      const service = (
        await db.query(
          "insert into public.services(studio_id,name,price,duration) values($1,'Manicure',40,30) returning id",
          [studio],
        )
      ).rows[0].id;
      assert.ok(
        Number(
          (
            await db.query("select public.dashboard_revision($1) as value", [
              studio,
            ])
          ).rows[0].value,
        ) > Number(initial),
      );
      assert.equal(
        (await db.query("select public.billing_status() as value")).rows[0]
          .value.can_use,
        true,
      );
      for (let i = 0; i < 20; i++)
        assert.equal(
          (await db.query("select public.clara_request_allowed() as value"))
            .rows[0].value,
          true,
        );
      assert.equal(
        (await db.query("select public.clara_request_allowed() as value"))
          .rows[0].value,
        false,
      );
      await assert.rejects(
        db.query("select public.billing_backend_account($1)", [owner]),
        /permission denied/,
      );
      await db.exec(`set request.jwt.claim.sub='${other}';`);
      assert.equal(
        (await db.query("select public.clara_request_allowed() as value"))
          .rows[0].value,
        true,
        "rate limits are isolated per account",
      );
      assert.equal(
        (await db.query("select * from public.services")).rows.length,
        0,
      );
      await assert.rejects(
        db.query("select public.dashboard_revision($1)", [studio]),
        /Acesso negado/,
      );
      await db.exec("reset role");
      await db.query(
        "update encaixa_private.billing_accounts set trial_ends_at=now()-interval '1 second' where owner_id=$1",
        [owner],
      );
      await db.exec(
        `set role authenticated; set request.jwt.claim.sub='${owner}';`,
      );
      assert.equal(
        (await db.query("select public.billing_status() as value")).rows[0]
          .value.can_use,
        false,
      );
      assert.equal(
        (await db.query("select * from public.services")).rows.length,
        1,
      );
      await assert.rejects(
        db.query("update public.services set price=41 where id=$1", [service]),
        /período de acesso terminou/,
      );
      await db.exec("reset role");
      assert.equal(
        (await db.query("select public.booking_page('studio-teste') as value"))
          .rows[0].value.studio.active,
        false,
      );
      await db.query(
        "select public.billing_backend_account($1,'cus_test',true)",
        [owner],
      );
      const ticket = (
        await db.query(
          "select public.billing_sync_claim('cus_test','evt_test') as value",
        )
      ).rows[0].value;
      await assert.rejects(
        db.query("select public.billing_sync_claim('cus_test','evt_other')"),
        /andamento/,
      );
      const until = new Date(Date.now() + 86400000).toISOString();
      await db.query(
        "select public.billing_apply_event('evt_test',100,'cus_test','sub_test','active',$1,false,$2)",
        [until, ticket],
      );
      assert.equal(
        (
          await db.query(
            "select public.billing_sync_claim('cus_test','evt_test') as value",
          )
        ).rows[0].value,
        null,
      );
      await db.exec(
        `set role authenticated; set request.jwt.claim.sub='${owner}';`,
      );
      assert.equal(
        (await db.query("select public.billing_status() as value")).rows[0]
          .value.can_use,
        true,
      );
      await db.query("update public.services set price=41 where id=$1", [
        service,
      ]);
      await db.exec("reset role");
      assert.equal(
        (await db.query("select public.booking_page('studio-teste') as value"))
          .rows[0].value.studio.active,
        true,
      );
      const oldTicket = (
        await db.query(
          "select public.billing_sync_claim('cus_test','evt_delayed') as value",
        )
      ).rows[0].value;
      await db.query(
        "update encaixa_private.billing_accounts set sync_expires_at=now()-interval '1 second' where owner_id=$1",
        [owner],
      );
      const newTicket = (
        await db.query(
          "select public.billing_sync_claim('cus_test','evt_current') as value",
        )
      ).rows[0].value;
      await assert.rejects(
        db.query(
          "select public.billing_apply_event('evt_delayed',200,'cus_test','sub_test','canceled',null,false,$1)",
          [oldTicket],
        ),
        /expirada/,
      );
      await db.query(
        "select public.billing_apply_event('evt_current',100,'cus_test','sub_test','active',$1,true,$2)",
        [until, newTicket],
      );
      await db.exec(
        `set role authenticated; set request.jwt.claim.sub='${owner}';`,
      );
      const cancelScheduled = (
        await db.query("select public.billing_status() as value")
      ).rows[0].value;
      assert.equal(
        cancelScheduled.can_use,
        true,
        "scheduled cancellation preserves a paid period",
      );
      assert.equal(cancelScheduled.cancel_at_period_end, true);
      await db.exec("reset role");
      await db.query(
        "update encaixa_private.billing_accounts set paid_until=now()-interval '1 second' where owner_id=$1",
        [owner],
      );
      await db.exec(
        `set role authenticated; set request.jwt.claim.sub='${owner}';`,
      );
      assert.equal(
        (await db.query("select public.billing_status() as value")).rows[0]
          .value.can_use,
        false,
      );
      await assert.rejects(
        db.query("update public.services set price=42 where id=$1", [service]),
        /período de acesso terminou/,
      );
      await db.exec("reset role");
      const originalTrial = (
        await db.query(
          "select trial_ends_at from encaixa_private.billing_accounts where owner_id=$1",
          [owner],
        )
      ).rows[0].trial_ends_at;
      await db.query("delete from public.studios where id=$1", [studio]);
      await db.exec(
        `set role authenticated; set request.jwt.claim.sub='${owner}';`,
      );
      await assert.rejects(
        db.query(
          "select public.setup_studio('Novo','Clara','studio-renovado')",
        ),
        /período de acesso terminou/,
      );
      await db.exec("reset role");
      assert.deepEqual(
        (
          await db.query(
            "select trial_ends_at from encaixa_private.billing_accounts where owner_id=$1",
            [owner],
          )
        ).rows[0].trial_ends_at,
        originalTrial,
        "recreating a studio does not restart its trial",
      );
    } finally {
      await db.close();
    }
  },
);
