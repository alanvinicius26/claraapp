import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { migrateBilling, billingFixture } from "./billing-fixture.js";

test(
  "platform administration: permissions, benefits, billing and audit in PostgreSQL",
  { timeout: 120000 },
  async (t) => {
    const db = new PGlite({ extensions: { btree_gist } });
    try {
      await migrateBilling(db);
      const admin = await billingFixture(db),
        target = await billingFixture(db),
        outsider = await billingFixture(db);
      await db.exec(
        await readFile(
          new URL("../supabase/platform_admin.sql", import.meta.url),
          "utf8",
        ),
      );
      const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
      const rpc = async (name, args = []) =>
        (
          await one(
            `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) v`,
            args,
          )
        ).v;
      const future = new Date(Date.now() + 86400000 * 30).toISOString();
      let grant;
      await t.test(
        "migration grants nobody access; anon and members cannot list accounts or elevate themselves",
        async () => {
          await outsider.asOwner();
          assert.equal(await rpc("platform_admin_status"), false);
          for (const [name, args] of [
            ["admin_accounts", []],
            ["admin_history", []],
            ["admin_coupons_list", ["test"]],
            [
              "admin_set_access",
              [target.owner, "courtesy", "team3", null, "Unauthorized", null],
            ],
            [
              "admin_revoke_access",
              [target.owner, outsider.owner, "Unauthorized"],
            ],
          ])
            await assert.rejects(rpc(name, args), /Acesso restrito/);
          await assert.rejects(
            db.query(
              "insert into encaixa_private.platform_admins(user_id) values($1)",
              [outsider.owner],
            ),
            /permission denied/,
          );
          await assert.rejects(
            rpc("admin_coupon_authorize", [admin.owner]),
            /permission denied/,
          );
          await assert.rejects(
            rpc("admin_coupon_finish", [
              admin.owner,
              target.owner,
              "test",
              "x",
              "promo_x",
              "active",
            ]),
            /permission denied/,
          );
          await db.exec("set role anon");
          await assert.rejects(
            rpc("platform_admin_status"),
            /permission denied/,
          );
          await assert.rejects(rpc("admin_accounts"), /permission denied/);
        },
      );
      await t.test(
        "administrator can find accounts by email but membership remains private",
        async () => {
          await db.exec("reset role");
          await db.query(
            "insert into encaixa_private.platform_admins(user_id) values($1)",
            [admin.owner],
          );
          await db.query(
            "update auth.users set email='parceira@example.invalid' where id=$1",
            [target.owner],
          );
          await admin.asOwner();
          assert.equal(await rpc("platform_admin_status"), true);
          const found = await rpc("admin_accounts", ["PARCEIRA", 0]);
          assert.equal(found.length, 1);
          assert.equal(found[0].owner_id, target.owner);
          assert.equal((await rpc("admin_accounts", ["%", 0])).length, 0);
          await assert.rejects(
            db.query("select * from encaixa_private.platform_admins"),
            /permission denied/,
          );
        },
      );
      await t.test(
        "permanent courtesy sets the chosen capacity and survives billing activation",
        async () => {
          grant = await rpc("admin_set_access", [
            target.owner,
            "courtesy",
            "team3",
            null,
            "Parceria de testes",
            null,
          ]);
          await db.exec("reset role");
          await db.query("select encaixa_private.activate_billing()");
          await target.account({ trial_ends_at: "2020-01-01" });
          await target.asOwner();
          const s = await target.status();
          assert.equal(s.can_use, true);
          assert.equal(s.effective_limit, 3);
          assert.equal(s.benefit.plan_id, "team3");
          assert.equal(s.paid_until, null);
          assert.equal(s.has_subscription, false);
          assert.equal(
            s.benefit.reason,
            undefined,
            "internal reason is never exposed to customer",
          );
          await target.add();
          await target.add();
          await assert.rejects(target.add(), /não inclui esta vaga/);
          await outsider.asOwner();
          assert.equal((await outsider.status()).benefit, null);
        },
      );
      await t.test(
        "backend cannot begin a paid checkout while courtesy is active",
        async () => {
          await db.exec("set role service_role");
          const backend = await rpc("billing_backend_account", [target.owner]);
          assert.equal(backend.benefit.id, grant.id);
          await assert.rejects(
            rpc("billing_begin_operation", [target.owner, "checkout", "team3"]),
            /acesso gratuito/,
          );
        },
      );
      await t.test(
        "Stripe sync only changes payment fields, preserving independent courtesy",
        async () => {
          await target.account({
            customer_id: "cus_gift",
            sync_token: admin.owner,
            sync_expires_at: future,
          });
          await db.exec("set role service_role");
          await rpc("billing_apply_plan_event", [
            "evt_gift",
            100,
            "cus_gift",
            "sub_old",
            "canceled",
            null,
            false,
            admin.owner,
            "solo",
            false,
            null,
          ]);
          await target.asOwner();
          assert.equal((await target.status()).can_use, true);
          assert.equal((await target.status()).benefit.id, grant.id);
          assert.equal((await target.status()).effective_limit, 3);
        },
      );
      await t.test(
        "former Stripe accounts require server verification and lock out a concurrent checkout",
        async () => {
          await admin.asOwner();
          await assert.rejects(
            rpc("admin_set_access", [
              target.owner,
              "courtesy",
              "team3",
              null,
              "Motivo",
              grant.id,
            ]),
            /pelo painel administrativo/,
          );
          await assert.rejects(
            rpc("admin_access_claim", [admin.owner, target.owner]),
            /permission denied/,
          );
          await db.exec("set role service_role");
          const claimed = await rpc("admin_access_claim", [
            admin.owner,
            target.owner,
          ]);
          await assert.rejects(
            rpc("billing_begin_operation", [target.owner, "checkout", "team3"]),
            /atualização administrativa/,
          );
          await assert.rejects(
            rpc("admin_access_apply", [
              admin.owner,
              outsider.owner,
              target.owner,
              "courtesy",
              "team3",
              null,
              "Motivo",
              grant.id,
            ]),
            /conferência expirou/,
          );
          grant = await rpc("admin_access_apply", [
            admin.owner,
            claimed.admin_ticket,
            target.owner,
            "courtesy",
            "team3",
            null,
            "Motivo",
            grant.id,
          ]);
          await rpc("admin_access_release", [
            admin.owner,
            target.owner,
            claimed.admin_ticket,
          ]);
          // Return fixture to a no-provider account for direct authenticated RPC tests.
          await target.account({ customer_id: null });
        },
      );
      await t.test(
        "invalid inputs, stale edits and too-small plans fail without changing access",
        async () => {
          await admin.asOwner();
          for (const args of [
            [target.owner, "free_period", "team3", null, "Motivo", grant.id],
            [
              target.owner,
              "courtesy",
              "team3",
              "2020-01-01",
              "Motivo",
              grant.id,
            ],
            [target.owner, "courtesy", "team3", "infinity", "Motivo", grant.id],
            [target.owner, null, "team3", null, "Motivo", grant.id],
            [target.owner, "courtesy", "invalid", null, "Motivo", grant.id],
            [target.owner, "courtesy", "team3", null, " ", grant.id],
          ])
            await assert.rejects(
              rpc("admin_set_access", args),
              /Informe plano/,
            );
          await assert.rejects(
            rpc("admin_set_access", [
              target.owner,
              "courtesy",
              "solo",
              null,
              "Motivo",
              grant.id,
            ]),
            /comporte/,
          );
          await assert.rejects(
            rpc("admin_set_access", [
              target.owner,
              "courtesy",
              "team3",
              null,
              "Motivo",
              null,
            ]),
            /benefício mudou/,
          );
          await assert.rejects(
            rpc("admin_revoke_access", [target.owner, admin.owner, "Motivo"]),
            /benefício mudou/,
          );
          assert.equal((await rpc("admin_history", [target.owner])).length, 2);
        },
      );
      await t.test(
        "timed access expires by database clock without jobs and revocation preserves history",
        async () => {
          grant = await rpc("admin_set_access", [
            target.owner,
            "free_period",
            "team3",
            future,
            "Mais trinta dias",
            grant.id,
          ]);
          await target.asOwner();
          assert.equal((await target.status()).can_use, true);
          await db.exec("reset role");
          await db.query(
            "update encaixa_private.access_grants set expires_at=now()-interval '1 second' where owner_id=$1",
            [target.owner],
          );
          await target.asOwner();
          assert.equal((await target.status()).can_use, false);
          assert.equal((await target.status()).benefit, null);
          await assert.rejects(
            db.query("update public.studios set bio='blocked' where id=$1", [
              target.studio.id,
            ]),
            /período de acesso terminou/,
          );
          await admin.asOwner();
          await rpc("admin_revoke_access", [
            target.owner,
            grant.id,
            "Fim da parceria",
          ]);
          const history = await rpc("admin_history", [target.owner]);
          assert.equal(history.length, 4);
          assert.equal(history[0].action, "access_revoked");
          assert.equal(
            history[1].details.before.id,
            history[2].details.after.id,
          );
          await target.asOwner();
          assert.equal(
            (
              await one(
                "select count(*)::int n from public.professionals where studio_id=$1",
                [target.studio.id],
              )
            ).n,
            3,
          );
          assert.equal((await target.status()).can_use, false);
        },
      );
      await t.test(
        "ongoing subscriptions and pending checkouts cannot receive free access",
        async () => {
          for (const status of [
            "active",
            "past_due",
            "trialing",
            "unpaid",
            "incomplete",
            "paused",
          ]) {
            await target.account({ status, subscription_id: "sub_open" });
            await admin.asOwner();
            await assert.rejects(
              rpc("admin_set_access", [
                target.owner,
                "courtesy",
                "team3",
                null,
                "Motivo",
                null,
              ]),
              /assinatura em andamento/,
            );
          }
          await target.account({
            status: "canceled",
            operation: { key: target.owner, plan: "team3", action: "checkout" },
          });
          await admin.asOwner();
          await assert.rejects(
            rpc("admin_set_access", [
              target.owner,
              "courtesy",
              "team3",
              null,
              "Motivo",
              null,
            ]),
            /contratação pendente/,
          );
          await target.account({ operation: null });
          await admin.asOwner();
          grant = await rpc("admin_set_access", [
            target.owner,
            "courtesy",
            "team3",
            null,
            "Motivo",
            null,
          ]);
          await rpc("admin_revoke_access", [target.owner, grant.id, "Fim"]);
        },
      );
      await t.test(
        "coupon records are private, idempotent, environment-isolated and audited",
        async () => {
          await db.exec("set role service_role");
          await assert.rejects(
            rpc("admin_coupon_authorize", [outsider.owner]),
            /Acesso restrito/,
          );
          const definition = { type: "percent", value: 50, duration: "once" };
          const c = await rpc("admin_coupon_prepare", [
            admin.owner,
            "test",
            "TESTE50",
            definition,
          ]);
          const repeat = await rpc("admin_coupon_prepare", [
            admin.owner,
            "test",
            "TESTE50",
            definition,
          ]);
          assert.equal(c.id, repeat.id);
          await assert.rejects(
            rpc("admin_coupon_prepare", [
              admin.owner,
              "test",
              "TESTE50",
              { ...definition, value: 25 },
            ]),
            /outras condições/,
          );
          await assert.rejects(
            rpc("admin_coupon_get", [admin.owner, c.id, "live"]),
            /não encontrado/,
          );
          await rpc("admin_coupon_finish", [
            admin.owner,
            c.id,
            "test",
            "coupon_local",
            "promo_local",
            "active",
          ]);
          await rpc("admin_coupon_finish", [
            admin.owner,
            c.id,
            "test",
            "coupon_local",
            "promo_local",
            "inactive",
          ]);
          const stale = await rpc("admin_coupon_finish", [
            admin.owner,
            c.id,
            "test",
            "coupon_local",
            "promo_local",
            "active",
          ]);
          assert.equal(stale.state, "inactive");
          await admin.asOwner();
          assert.equal((await rpc("admin_coupons_list", ["test"])).length, 1);
          assert.equal((await rpc("admin_coupons_list", ["live"])).length, 0);
          await db.exec("reset role");
          await db.query(
            "delete from encaixa_private.platform_admins where user_id=$1",
            [admin.owner],
          );
          await admin.asOwner();
          assert.equal(await rpc("platform_admin_status"), false);
          await assert.rejects(rpc("admin_accounts"), /Acesso restrito/);
        },
      );
      await t.test('bootstrap requires an explicitly chosen confirmed email and refuses a second administrator', async () => {
        await db.exec('reset role');
        await db.exec('alter table auth.users add column email_confirmed_at timestamptz');
        const bootstrap = await readFile(new URL('../supabase/platform_admin_bootstrap.sql', import.meta.url), 'utf8');
        await assert.rejects(db.exec(bootstrap), /Informe o e-mail autorizado/);
        await db.exec('rollback');
        await db.query("update auth.users set email='admin@example.invalid',email_confirmed_at=now() where id=$1", [admin.owner]);
        await db.query("select set_config('clara.bootstrap_admin_email','unconfirmed@example.invalid',false)");
        await assert.rejects(db.exec(bootstrap), /e-mail confirmado/);
        await db.exec('rollback');
        await db.query("select set_config('clara.bootstrap_admin_email','admin@example.invalid',false)");
        await db.exec(bootstrap);
        await db.exec(bootstrap);
        assert.equal((await one('select count(*)::int n from encaixa_private.platform_admins')).n, 1);
        await db.query("update auth.users set email='other@example.invalid',email_confirmed_at=now() where id=$1", [outsider.owner]);
        await db.query("select set_config('clara.bootstrap_admin_email','other@example.invalid',false)");
        await assert.rejects(db.exec(bootstrap), /outro administrador/);
        await db.exec('rollback');
        await outsider.asOwner();
        await assert.rejects(db.exec(bootstrap), /permission denied/);
        await db.exec('rollback');
      });
    } finally {
      await db.close();
    }
  },
);
