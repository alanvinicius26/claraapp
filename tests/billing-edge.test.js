import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { PLANS } from "../supabase/functions/_shared/plans.js";
import {
  subscriptionState,
  canonicalSubscription,
} from "../supabase/functions/billing/core.js";
const env = {
  STRIPE_SECRET_KEY: "sk_test_synthetic",
  STRIPE_PRICE_ID: "price_test",
  STRIPE_PRICE_3_ID: "price_team3",
  STRIPE_PRICE_4_ID: "price_team4",
  STRIPE_PRICE_5_ID: "price_team5",
  STRIPE_PORTAL_CONFIGURATION_ID: "bpc_test",
  APP_ORIGIN: "https://clara.example.invalid",
  STRIPE_WEBHOOK_SECRET: "whsec_synthetic",
  SUPABASE_URL: "https://db.example.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic",
  APP_PUBLISHABLE_KEY: "sb_publishable_synthetic",
};
let serve;
globalThis.Deno = {
  env: { get: (key) => env[key] },
  serve: (handler) => {
    serve = handler;
  },
};
await import("../supabase/functions/billing/index.ts");
const billing = serve;
await import("../supabase/functions/stripe-webhook/index.ts");
const webhook = serve;
await import("../supabase/functions/clara/index.ts");
const clara = serve;
await import("../supabase/functions/booking/index.ts");
const booking = serve;
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const request = (action, extra = {}) =>
  new Request("https://edge.example.invalid/billing", {
    method: "POST",
    headers: { Authorization: "Bearer synthetic" },
    body: JSON.stringify({ action, plan: "solo", confirmed: true, ...extra }),
  });
const price = {
  id: "price_test",
  active: true,
  livemode: false,
  currency: "brl",
  unit_amount: 2990,
  recurring: { interval: "month", interval_count: 1 },
};
test("billing validates identity and refuses checkout during the free trial", async (t) => {
  const paths = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    paths.push(url);
    if (url.endsWith("/auth/v1/user")) return json({ id: "owner" });
    if (url.endsWith("/booking_rate_limit")) return json(true);
    if (url.endsWith("/billing_backend_account"))
      return json({
        trial_ends_at: new Date(Date.now() + 86400000).toISOString(),
        billing_enabled: true,
        plans_version: 2,
      });
    throw new Error("Unexpected network request");
  });
  assert.equal(
    (
      await billing(
        new Request("https://edge.example.invalid/billing", { method: "POST" }),
      )
    ).status,
    401,
  );
  assert.equal((await billing(request("checkout"))).status, 409);
  assert.equal(
    paths.some((url) => url.includes("api.stripe.com")),
    false,
  );
});
test("checkout accepts only the server plan and reuses the database idempotency lease", async (t) => {
  let checkout;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url.endsWith("/auth/v1/user")) return json({ id: "owner" });
    if (url.endsWith("/booking_rate_limit")) return json(true);
    if (url.endsWith("/billing_backend_account"))
      return json({
        trial_ends_at: "2020-01-01",
        billing_enabled: true,
        plans_version: 2,
        customer_id: "cus_test",
        checkout_key: "fixed-lease",
        checkout_expires_at: 1900000000,
      });
    if (url.endsWith("/billing_begin_operation"))
      return json({
        owner_id: "owner",
        customer_id: "cus_test",
        operation_ticket: "ticket",
        operation: {
          key: "fixed-lease",
          action: "checkout",
          plan: "solo",
          expires: 1900000000,
        },
      });
    if (url.endsWith("/billing_finish_operation")) return json(true);
    if (url.includes("/checkout/sessions?")) return json({ data: [] });
    if (url.endsWith("/prices/price_test")) return json(price);
    if (url.includes("/subscriptions?")) return json({ data: [] });
    if (url.endsWith("/checkout/sessions")) {
      checkout = init;
      return json({ url: "https://checkout.stripe.com/test" });
    }
    throw new Error("Unexpected network request");
  });
  assert.equal((await billing(request("checkout"))).status, 200);
  assert.equal(
    checkout.headers["Idempotency-Key"],
    "clara-checkout-fixed-lease",
  );
  assert.equal(checkout.body.get("line_items[0][price]"), "price_test");
  assert.equal(checkout.body.get("allow_promotion_codes"), "true");
  assert.equal(
    checkout.body.get("success_url"),
    "https://clara.example.invalid/#/app/assinatura",
  );
  assert.equal(
    checkout.body.get("subscription_data[trial_period_days]"),
    null,
    "trial is measured by the app before checkout",
  );
});
test("signed webhook serializes retrieval and saves current provider state even for an old subscription event", async (t) => {
  const calls = [];
  let saved;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push(url);
    if (url.endsWith("/billing_sync_claim")) return json("ticket");
    if (url.includes("api.stripe.com"))
      return json({
        data: [
          {
            id: "sub_old",
            status: "canceled",
            created: 100,
            items: { data: [{ price, quantity: 1 }] },
            latest_invoice: { status: "paid" },
          },
          {
            id: "sub_new",
            status: "active",
            created: 200,
            items: {
              data: [{ price, quantity: 1, current_period_end: 1900000000 }],
            },
            latest_invoice: { status: "paid" },
          },
        ],
      });
    if (url.endsWith("/billing_apply_plan_event")) {
      saved = JSON.parse(init.body);
      return json(true);
    }
    throw new Error("Unexpected network request");
  });
  const event = {
    id: "evt_old",
    created: 100,
    livemode: false,
    type: "customer.subscription.deleted",
    data: { object: { id: "sub_old", customer: "cus_test" } },
  };
  const raw = JSON.stringify(event),
    stamp = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", env.STRIPE_WEBHOOK_SECRET)
    .update(`${stamp}.${raw}`)
    .digest("hex");
  const req = (body = raw) =>
    new Request("https://edge.example.invalid/webhook", {
      method: "POST",
      headers: { "stripe-signature": `t=${stamp},v1=${sig}` },
      body,
    });
  assert.equal((await webhook(req(raw + " "))).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await webhook(req())).status, 200);
  assert.match(calls[0], /billing_sync_claim$/);
  assert.match(calls[1], /api.stripe.com/);
  assert.equal(saved.p_subscription, "sub_new");
  assert.equal(saved.p_status, "active");
  assert.equal(saved.p_ticket, "ticket");
});
test("expired subscriptions block Clara queries but allow closing and resetting the conversation", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url.endsWith("/auth/v1/user")) return json({ id: "owner" });
    if (url.endsWith("/clara_request_allowed")) return json(true);
    if (url.endsWith("/billing_status")) return json({ can_use: false });
    if (url.endsWith("/clara_dialogue_get"))
      return json({ revision: 1, state: { stage: "date" } });
    if (url.endsWith("/clara_dialogue_save")) {
      assert.deepEqual(JSON.parse(init.body).p_state, { stage: "idle" });
      return json({ revision: 2, state: { stage: "idle" } });
    }
    throw new Error("Unexpected network request");
  });
  const req = (body) =>
    new Request("https://edge.example.invalid/clara", {
      method: "POST",
      headers: { Authorization: "Bearer synthetic" },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await clara(req({ message: "Qual é o próximo atendimento?" }))).status,
    402,
  );
  const response = await clara(req({ action: { kind: "reset" } }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).dialogue.stage, "idle");
});
test("booking gateway returns 400 for malformed input and 503 for a network failure", async (t) => {
  const req = (body) =>
    new Request("https://edge.example.invalid/booking", {
      method: "POST",
      headers: { apikey: env.APP_PUBLISHABLE_KEY },
      body,
    });
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Failed to fetch");
  });
  assert.equal((await booking(req("null"))).status, 400);
  assert.equal((await booking(req("{"))).status, 400);
  assert.equal(
    (
      await booking(
        req(
          JSON.stringify({
            action: "booking_page",
            args: { p_slug: "studio-teste" },
          }),
        ),
      )
    ).status,
    503,
  );
});

const catalog = PLANS.map((p) => ({
  ...p,
  priceId: p.id === "solo" ? "price_test" : `price_${p.id}`,
}));
function fakeProvider(t, options = {}) {
  const plan = catalog.find((p) => p.id === (options.plan || "solo"));
  const makePrice = (p) => ({ ...price, id: p.priceId, unit_amount: p.amount });
  const account = {
    owner_id: "owner",
    plans_version: 2,
    billing_enabled: true,
    trial_ends_at: "2020-01-01",
    active_professionals: options.count || 1,
    customer_id: "cus_test",
    subscription_id: options.checkout ? null : "sub_test",
    status: options.checkout ? "trial" : "active",
    paid_until: new Date(Date.now() + 20 * 86400000).toISOString(),
    plan_id: plan.id,
    ...options.account,
  };
  let subscription = options.checkout
    ? null
    : {
        id: "sub_test",
        status: "active",
        created: 100,
        items: {
          data: [
            {
              id: "si_test",
              price: makePrice(plan),
              quantity: 1,
              current_period_end: Math.floor(Date.now() / 1000) + 20 * 86400,
            },
          ],
        },
        latest_invoice: {
          id: "in_old",
          status: "paid",
          billing_reason: "subscription_cycle",
        },
      };
  const calls = [],
    sessions = [];
  let counter = 0,
    failed = false;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    const args = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    if (url.endsWith("/auth/v1/user")) return json({ id: "owner" });
    if (url.endsWith("/booking_rate_limit")) return json(true);
    if (url.endsWith("/billing_backend_account")) return json(account);
    if (url.endsWith("/billing_begin_operation")) {
      if (
        account.operation &&
        (args.p_plan !== account.operation.plan ||
          args.p_action !== account.operation.action)
      )
        return json(
          { code: "P0001", message: "Conclua a alteração em andamento." },
          400,
        );
      if (
        account.active_professionals >
        catalog.find((p) => p.id === args.p_plan).limit
      )
        return json(
          { code: "P0001", message: "Desative os atendentes excedentes." },
          400,
        );
      const now = Math.floor(Date.now() / 1000);
      account.operation ||= {
        key: `op${++counter}`,
        action: args.p_action,
        plan: args.p_plan,
        from_plan: account.plan_id,
        subscription: account.subscription_id,
        created: now,
        expires: now + 3600,
      };
      account.operation_ticket = "ticket";
      return json(account);
    }
    if (url.endsWith("/billing_finish_operation")) {
      if (args.p_clear) account.operation = null;
      return json(true);
    }
    const p = catalog.find((p) => url.endsWith("/prices/" + p.priceId));
    if (p) return json({ ...makePrice(p), ...options.price });
    if (url.includes("/subscriptions?"))
      return json({ data: subscription ? [subscription] : [] });
    if (url.includes("/checkout/sessions?")) return json({ data: sessions });
    if (url.endsWith("/checkout/sessions")) {
      const session = {
        id: "cs_test",
        status: "open",
        metadata: {
          clara_operation: init.body.get("metadata[clara_operation]"),
        },
        url: "https://checkout.stripe.com/synthetic",
      };
      sessions.push(session);
      if (options.loseCheckoutResponse && !failed) {
        failed = true;
        throw new Error("Failed to fetch");
      }
      return json(session);
    }
    if (url.endsWith("/checkout/sessions/cs_test/expire")) {
      sessions[0].status = "expired";
      return json(sessions[0]);
    }
    if (url.endsWith("/subscriptions/sub_test")) {
      const newPlan = catalog.find(
        (p) => p.priceId === init.body.get("items[0][price]"),
      );
      if (options.decline) {
        subscription.pending_update = {
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        };
        subscription.latest_invoice = {
          id: "in_upgrade",
          status: "open",
          billing_reason: "subscription_update",
          hosted_invoice_url: "https://invoice.stripe.com/synthetic",
        };
      } else {
        subscription.items.data[0].price = makePrice(newPlan);
        subscription.latest_invoice = { status: "paid" };
      }
      if (options.loseChangeResponse && !failed) {
        failed = true;
        throw new Error("Failed to fetch");
      }
      return json(subscription);
    }
    if (url.endsWith("/invoices/in_upgrade/void")) {
      subscription.pending_update = null;
      subscription.latest_invoice.status = "void";
      return json(subscription.latest_invoice);
    }
    if (url.endsWith("/billing_portal/configurations/bpc_test"))
      return json({
        id: "bpc_test",
        active: true,
        features: {
          subscription_update: { enabled: !!options.unsafePortal },
          subscription_cancel: { enabled: true, mode: "at_period_end" },
        },
      });
    if (url.endsWith("/billing_portal/sessions"))
      return json({ url: "https://billing.stripe.com/synthetic" });
    throw new Error(`Unexpected fake request: ${url}`);
  });
  return {
    account,
    calls,
    sessions,
    subscription,
    writes: (suffix) =>
      calls.filter((c) => c.url.endsWith(suffix) && c.init.method === "POST"),
  };
}

for (const plan of catalog)
  test(`checkout uses approved ${plan.amount} BRL cents for ${plan.id}, ignoring client-supplied price and quantity`, async (t) => {
    const provider = fakeProvider(t, { checkout: true });
    const response = await billing(
      request("checkout", {
        plan: plan.id,
        price: "price_evil",
        quantity: 99,
        amount: 1,
        owner_id: "another",
      }),
    );
    assert.equal(response.status, 200);
    const body = provider.writes("/checkout/sessions")[0].init.body;
    assert.equal(body.get("line_items[0][price]"), plan.priceId);
    assert.equal(body.get("line_items[0][quantity]"), "1");
    assert.equal(body.get("subscription_data[metadata][owner_id]"), "owner");
    assert.equal(
      provider.account.plan_id,
      "solo",
      "checkout return never grants a paid plan",
    );
  });
test("checkout recovers a lost response with the same session and expires it before another plan", async (t) => {
  const provider = fakeProvider(t, {
    checkout: true,
    loseCheckoutResponse: true,
  });
  assert.equal(
    (await billing(request("checkout", { plan: "team3" }))).status,
    503,
  );
  assert.equal(
    (await billing(request("checkout", { plan: "team5" }))).status,
    409,
  );
  const retry = await billing(request("checkout", { plan: "team3" }));
  assert.equal(
    (await retry.json()).url,
    "https://checkout.stripe.com/synthetic",
  );
  assert.equal(provider.writes("/checkout/sessions").length, 1);
  assert.equal((await billing(request("cancel_pending"))).status, 200);
  assert.equal(provider.sessions[0].status, "expired");
  assert.equal(provider.account.operation, null);
});
test("upgrade charges prorated difference and a declined payment keeps the old plan; retry opens existing invoice", async (t) => {
  const provider = fakeProvider(t, { decline: true });
  const first = await billing(request("change", { plan: "team3" }));
  assert.equal(
    (await first.json()).url,
    "https://invoice.stripe.com/synthetic",
  );
  const params = provider.writes("/subscriptions/sub_test")[0].init.body;
  assert.equal(params.get("proration_behavior"), "always_invoice");
  assert.equal(params.get("payment_behavior"), "pending_if_incomplete");
  assert.equal(
    params.get("proration_date"),
    String(provider.account.operation.created),
  );
  assert.equal(provider.account.plan_id, "solo");
  assert.equal(subscriptionState(provider.subscription, catalog).plan, "solo");
  assert.equal(
    subscriptionState(provider.subscription, catalog).preservePaid,
    true,
  );
  assert.equal(
    (await billing(request("change", { plan: "team3" }))).status,
    200,
  );
  assert.equal(provider.writes("/subscriptions/sub_test").length, 1);
  await billing(request("cancel_pending"));
  assert.equal(provider.writes("/invoices/in_upgrade/void").length, 1);
  assert.equal(provider.account.operation, null);
  assert.equal(provider.subscription.items.data[0].price.id, "price_test");
});
test("lost successful upgrade response is reconciled without charging twice", async (t) => {
  const provider = fakeProvider(t, { loseChangeResponse: true });
  assert.equal(
    (await billing(request("change", { plan: "team4" }))).status,
    503,
  );
  assert.equal(
    (await billing(request("change", { plan: "team4" }))).status,
    200,
  );
  assert.equal(provider.writes("/subscriptions/sub_test").length, 1);
  assert.ok(
    provider.account.operation,
    "operation stays until the database receives the webhook",
  );
});
test("downgrade requires a fitting team and changes renewal price without prorated credits", async (t) => {
  const provider = fakeProvider(t, { plan: "team5", count: 3 });
  assert.equal(
    (await billing(request("change", { plan: "solo" }))).status,
    409,
  );
  assert.equal(provider.writes("/subscriptions/sub_test").length, 0);
  assert.equal(
    (await billing(request("change", { plan: "team3" }))).status,
    200,
  );
  const params = provider.writes("/subscriptions/sub_test")[0].init.body;
  assert.equal(params.get("proration_behavior"), "none");
  assert.equal(params.get("proration_date"), null);
  assert.equal(params.get("items[0][price]"), "price_team3");
  assert.ok(
    provider.account.operation,
    "the lower capacity stays reserved until the webhook commits",
  );
});
test("portal cannot expose free price/quantity changes that bypass application limits", async (t) => {
  const provider = fakeProvider(t, { unsafePortal: true });
  assert.equal((await billing(request("portal"))).status, 503);
  assert.equal(provider.writes("/billing_portal/sessions").length, 0);
});
test("safe portal uses the explicit validated configuration", async (t) => {
  const provider = fakeProvider(t);
  assert.equal((await billing(request("portal"))).status, 200);
  assert.equal(
    provider
      .writes("/billing_portal/sessions")[0]
      .init.body.get("configuration"),
    "bpc_test",
  );
});
test("unconfirmed requests and unknown plans cannot create a payment", async (t) => {
  const provider = fakeProvider(t, { checkout: true });
  assert.equal(
    (await billing(request("checkout", { confirmed: false }))).status,
    400,
  );
  assert.equal(
    (await billing(request("checkout", { plan: "team6" }))).status,
    400,
  );
  assert.equal(provider.writes("/checkout/sessions").length, 0);
});
for (const priceOverride of [
  { unit_amount: 1990 },
  { livemode: true },
  { recurring: { interval: "year", interval_count: 1 } },
]) {
  test(`misconfigured Stripe price fails closed: ${JSON.stringify(priceOverride)}`, async (t) => {
    const provider = fakeProvider(t, { checkout: true, price: priceOverride });
    assert.equal((await billing(request("checkout"))).status, 503);
    assert.equal(provider.writes("/checkout/sessions").length, 0);
  });
}
test("disabled billing never starts checkout or changes an existing plan", async (t) => {
  const provider = fakeProvider(t, { account: { billing_enabled: false } });
  assert.equal(
    (await billing(request("change", { plan: "team3" }))).status,
    409,
  );
  assert.equal(provider.writes("/subscriptions/sub_test").length, 0);
});
test("canonical provider state rejects duplicate live subscriptions and unsupported prices or quantities", () => {
  const sub = {
    id: "sub1",
    status: "active",
    items: { data: [{ price, quantity: 1 }] },
    latest_invoice: { status: "paid" },
  };
  assert.throws(
    () =>
      canonicalSubscription({ data: [sub, { ...sub, id: "sub2" }] }, catalog),
    /Mais de uma/,
  );
  assert.throws(
    () => canonicalSubscription({ data: [sub], has_more: true }, catalog),
    /incompleta/,
  );
  assert.throws(
    () =>
      subscriptionState(
        { ...sub, items: { data: [{ price, quantity: 2 }] } },
        catalog,
      ),
    /fora do plano/,
  );
  assert.throws(
    () =>
      subscriptionState(
        {
          ...sub,
          items: {
            data: [{ price: { ...price, unit_amount: 1 }, quantity: 1 }],
          },
        },
        catalog,
      ),
    /inválido/,
  );
});
