import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adminCoupon,
  adminAccess,
  couponDefinition,
  AdminInputError,
} from "../supabase/functions/billing/admin.js";
import { subscriptionState } from "../supabase/functions/billing/core.js";

const actor = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const definition = {
  type: "percent",
  value: 50,
  duration: "repeating",
  months: 3,
  max_redemptions: 5,
  expires_at: null,
};
function fixture() {
  let record, providerCoupon, promotion;
  let lostFinish = false;
  const calls = [];
  const context = {
    live: false,
    plans: [{ priceId: "price_clara" }],
    validatePrice: () => {},
    db: async (name, args) => {
      calls.push({ name, args });
      if (name === "admin_coupon_authorize") {
        assert.equal(args.p_actor, actor);
        return true;
      }
      if (name === "admin_coupon_prepare") {
        if (record) assert.deepEqual(args.p_definition, record.definition);
        record ||= {
          id,
          code: args.p_code,
          definition: args.p_definition,
          mode: "test",
          state: "pending",
        };
        return structuredClone(record);
      }
      if (name === "admin_coupon_get") return structuredClone(record);
      if (name === "admin_coupon_finish") {
        if (lostFinish) {
          lostFinish = false;
          throw new Error("Lost database response");
        }
        record = {
          ...record,
          promotion_id: args.p_promotion,
          stripe_coupon_id: args.p_coupon,
          state: args.p_state,
        };
        return structuredClone(record);
      }
      throw new Error(name);
    },
    stripe: async (path, body, key, allowMissing) => {
      calls.push({ path, body: body ? Object.fromEntries(body) : null, key });
      if (path === "prices/price_clara")
        return { product: "prod_clara", livemode: false };
      if (path.startsWith("promotion_codes?"))
        return {
          data: promotion ? [structuredClone(promotion)] : [],
          has_more: false,
        };
      if (path === `coupons/clara_${id}`) {
        assert.equal(allowMissing, true);
        return providerCoupon;
      }
      if (path === "coupons") {
        assert.ok(key);
        assert.equal(body.get("applies_to[products][0]"), "prod_clara");
        providerCoupon = {
          id: body.get("id"),
          livemode: false,
          metadata: { clara_admin_coupon: id },
        };
        return providerCoupon;
      }
      if (path === "promotion_codes") {
        assert.ok(key);
        promotion = {
          id: "promo_local",
          coupon: providerCoupon,
          code: record.code,
          livemode: false,
          active: true,
          times_redeemed: 0,
          metadata: { clara_admin_coupon: id },
        };
        return structuredClone(promotion);
      }
      if (path === "promotion_codes/promo_local") {
        if (body) {
          assert.equal(body.get("active"), "false");
          promotion.active = false;
        }
        return structuredClone(promotion);
      }
      throw new Error(path);
    },
  };
  return {
    context,
    calls,
    loseFinish: () => {
      lostFinish = true;
    },
    setPromotion: (value) => {
      promotion = value;
    },
  };
}
test("coupon validation rejects malformed codes, discounts, durations, expiry and limits", () => {
  assert.equal(
    couponDefinition({ code: " teste50 ", definition }).code,
    "TESTE50",
  );
  for (const change of [
    { value: 0 },
    { value: 101 },
    { value: 1.5 },
    { type: "amount", value: 10000 },
    { duration: "other" },
    { months: 0 },
    { months: 37 },
    { max_redemptions: 0 },
    { max_redemptions: 1.5 },
    { expires_at: 1 },
  ])
    assert.throws(
      () =>
        couponDefinition({
          code: "TESTE50",
          definition: { ...definition, ...change },
        }),
      AdminInputError,
    );
  assert.throws(
    () => couponDefinition({ code: "TESTE-50", definition }),
    AdminInputError,
  );
});
test("coupon creation is restricted to Clara products and keeps stable provider idempotency keys", async () => {
  const f = fixture();
  const result = await adminCoupon(
    { action: "admin_coupon_create", code: "Teste50", definition },
    actor,
    f.context,
  );
  assert.equal(result.coupon.state, "active");
  const body = f.calls.find((c) => c.path === "coupons").body;
  assert.equal(body.percent_off, "50");
  assert.equal(body.duration_in_months, "3");
  assert.equal(body.max_redemptions, "5");
  await adminCoupon(
    { action: "admin_coupon_create", code: "TESTE50", definition },
    actor,
    f.context,
  );
  assert.equal(f.calls.filter((c) => c.path === "coupons").length, 1);
  assert.equal(f.calls.filter((c) => c.path === "promotion_codes").length, 1);
});
test("a lost persistence response resumes the same promotion even after idempotency expiry", async () => {
  const f = fixture();
  f.loseFinish();
  await assert.rejects(
    adminCoupon(
      { action: "admin_coupon_create", code: "TESTE50", definition },
      actor,
      f.context,
    ),
    /Lost database/,
  );
  const result = await adminCoupon(
    { action: "admin_coupon_resume", id },
    actor,
    f.context,
  );
  assert.equal(result.coupon.promotion_id, "promo_local");
  assert.equal(f.calls.filter((c) => c.path === "promotion_codes").length, 1);
});
test("fixed discounts are BRL cents, once duration has no months, disabling preserves existing subscriptions", async () => {
  const f = fixture();
  await adminCoupon(
    {
      action: "admin_coupon_create",
      code: "MENOS10",
      definition: {
        ...definition,
        type: "amount",
        value: 1000,
        duration: "once",
      },
    },
    actor,
    f.context,
  );
  const body = f.calls.find((c) => c.path === "coupons").body;
  assert.equal(body.currency, "brl");
  assert.equal(body.amount_off, "1000");
  assert.equal(body.percent_off, undefined);
  assert.equal(body.duration_in_months, undefined);
  const result = await adminCoupon(
    { action: "admin_coupon_disable", id },
    actor,
    f.context,
  );
  assert.equal(result.coupon.state, "inactive");
  assert.equal(
    f.calls.some((c) => c.path?.startsWith("subscriptions")),
    false,
  );
});
test("authorization is checked before any Stripe access and mismatched provider ownership fails closed", async () => {
  const f = fixture();
  f.context.db = async () => {
    throw new Error("Forbidden");
  };
  await assert.rejects(
    adminCoupon(
      { action: "admin_coupon_create", code: "TESTE50", definition },
      actor,
      f.context,
    ),
    /Forbidden/,
  );
  assert.equal(f.calls.length, 0);
  const g = fixture();
  await adminCoupon(
    { action: "admin_coupon_create", code: "TESTE50", definition },
    actor,
    g.context,
  );
  g.setPromotion({
    id: "promo_local",
    code: "TESTE50",
    livemode: true,
    metadata: { clara_admin_coupon: id },
  });
  await assert.rejects(
    adminCoupon({ action: "admin_coupon_disable", id }, actor, g.context),
    /Unexpected promotion/,
  );
});
test("100% coupon invoices grant paid access only after the provider marks the zero invoice paid", () => {
  const price = {
    id: "price_solo",
    currency: "brl",
    unit_amount: 2990,
    recurring: { interval: "month", interval_count: 1 },
  };
  const catalog = [{ id: "solo", priceId: price.id, amount: 2990, limit: 1 }];
  const sub = {
    status: "active",
    items: { data: [{ price, quantity: 1, current_period_end: 2000000000 }] },
    latest_invoice: { status: "paid", amount_due: 0 },
  };
  assert.ok(subscriptionState(sub, catalog).until);
  sub.latest_invoice.status = "open";
  assert.equal(subscriptionState(sub, catalog).until, null);
});
test("free access verifies provider state, ignores forged actor IDs and releases its lock on failure", async () => {
  const calls = [];
  const args = {
    p_owner: id,
    p_kind: "courtesy",
    p_plan: "team3",
    p_expires: null,
    p_reason: "Teste",
    p_expected: null,
  };
  const context = {
    db: async (name, a) => {
      calls.push({ name, args: a });
      assert.equal(a.p_actor, actor);
      return { customer_id: "cus_local", admin_ticket: "ticket" };
    },
    stripe: async (path) => ({
      data: path.startsWith("subscriptions") ? [{ status: "active" }] : [],
      has_more: false,
    }),
  };
  await assert.rejects(
    adminAccess({ args, p_actor: "forged" }, actor, context),
    /assinatura ou contratação/,
  );
  assert.equal(
    calls.some((c) => c.name === "admin_access_apply"),
    false,
  );
  assert.equal(calls.at(-1).name, "admin_access_release");
  context.stripe = async () => ({ data: [], has_more: false });
  await adminAccess({ args }, actor, context);
  assert.deepEqual(calls.find((c) => c.name === "admin_access_apply").args, {
    ...args,
    p_actor: actor,
    p_ticket: "ticket",
  });
});

test("HTTP endpoint rejects member coupon calls before provider writes and enables hosted promotion entry", async (t) => {
  let handler;
  globalThis.Deno = {
    env: {
      get: (key) =>
        ({
          STRIPE_SECRET_KEY: "sk_test_synthetic",
          STRIPE_PRICE_1_ID: "price_1",
          STRIPE_PRICE_3_ID: "price_3",
          STRIPE_PRICE_4_ID: "price_4",
          STRIPE_PRICE_5_ID: "price_5",
          STRIPE_PORTAL_CONFIGURATION_ID: "bpc_test",
          APP_ORIGIN: "https://app.example.invalid",
          SUPABASE_URL: "https://db.example.invalid",
          SUPABASE_SERVICE_ROLE_KEY: "synthetic",
          APP_PUBLISHABLE_KEY: "synthetic",
        })[key],
    },
    serve: (h) => {
      handler = h;
    },
  };
  await import("../supabase/functions/billing/index.ts");
  const paths = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    paths.push(url);
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status });
    if (url.endsWith("/auth/v1/user")) return json({ id: actor });
    if (url.endsWith("/booking_rate_limit")) return json(true);
    if (url.endsWith("/admin_coupon_authorize"))
      return json({ code: "42501" }, 403);
    throw new Error(url);
  });
  const result = await handler(
    new Request("https://edge.example.invalid", {
      method: "POST",
      headers: { Authorization: "Bearer synthetic" },
      body: JSON.stringify({
        action: "admin_coupon_create",
        code: "TESTE50",
        definition,
        confirmed: true,
      }),
    }),
  );
  assert.equal(result.status, 403);
  assert.equal(
    paths.some((p) => p.includes("api.stripe.com")),
    false,
  );
});
