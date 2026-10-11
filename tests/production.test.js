import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  createTimedFetch,
  withDeadline,
  errorMessage,
} from "../src/network.js";
import { observeSession } from "../src/session.js";
import {
  readAllPages,
  createDashboardLoader,
  indexClientVisits,
} from "../src/dashboard-data.js";
import {
  validatePrice,
  verifyStripeSignature,
  subscriptionState,
} from "../supabase/functions/billing/core.js";

test("network deadline aborts a stalled request without replaying a write", async () => {
  let count = 0;
  const request = createTimedFetch({
    timeoutMs: 15,
    fetchImpl: (_input, { signal }) => {
      count++;
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    },
  });
  await assert.rejects(request("https://example.invalid", { method: "POST" }), {
    name: "TimeoutError",
  });
  assert.equal(count, 1);
});
test("body download is covered by the network deadline", async () => {
  const request = createTimedFetch({
    timeoutMs: 15,
    fetchImpl: async (_input, { signal }) =>
      new Response(
        new ReadableStream({
          start(controller) {
            signal.addEventListener("abort", () =>
              controller.error(new Error("aborted")),
            );
          },
        }),
      ),
  });
  await assert.rejects(request("https://example.invalid"), {
    name: "TimeoutError",
  });
});
test("network preserves external cancellation and successful JSON", async () => {
  const request = createTimedFetch({
    fetchImpl: async () => new Response('{"ok":true}', { status: 201 }),
  });
  const response = await request("https://example.invalid");
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
  const controller = new AbortController();
  controller.abort();
  const canceled = createTimedFetch({
    fetchImpl: async (_, { signal }) => {
      assert.equal(signal.aborted, true);
      throw new DOMException("Aborted", "AbortError");
    },
  });
  await assert.rejects(
    canceled("https://example.invalid", { signal: controller.signal }),
    { name: "AbortError" },
  );
  await assert.rejects(withDeadline(new Promise(() => {}), 10), {
    name: "TimeoutError",
  });
});
test("technical errors do not leak SQL while business errors stay readable", () => {
  assert.match(
    errorMessage({
      message: "relation private.secret does not exist",
      code: "42P01",
    }),
    /Não foi possível/,
  );
  assert.match(errorMessage({ message: "Failed to fetch" }), /conexão/);
  assert.equal(
    errorMessage({ code: "P0001", message: "Escolha outro horário." }),
    "Escolha outro horário.",
  );
});
test("late session bootstrap never restores a signed-out user, cleanup ignores pending work", async () => {
  let listener, resolve;
  const sessions = [];
  const auth = {
    onAuthStateChange(fn) {
      listener = fn;
      return { data: { subscription: { unsubscribe() {} } } };
    },
    getSession: () => new Promise((r) => (resolve = r)),
  };
  const stop = observeSession(auth, {
    onSession: (s) => sessions.push(s),
    onError: (e) => {
      throw e;
    },
    onRecovery: () => {},
  });
  listener("SIGNED_OUT", null);
  resolve({ data: { session: { user: { id: "old" } } } });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sessions, [null]);
  stop();
  listener("SIGNED_IN", { user: { id: "other" } });
  assert.deepEqual(sessions, [null]);
});
test("session bootstrap failure and recovery events have explicit paths", async () => {
  let listener,
    errors = 0,
    recovered = 0;
  const stop = observeSession(
    {
      onAuthStateChange(fn) {
        listener = fn;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      getSession: () => Promise.reject(new Error("offline")),
    },
    {
      onSession: () => {},
      onError: () => errors++,
      onRecovery: () => recovered++,
    },
  );
  await new Promise((r) => setImmediate(r));
  assert.equal(errors, 1);
  listener("PASSWORD_RECOVERY", { user: { id: "user" } });
  assert.equal(recovered, 1);
  stop();
});
test("pagination loads beyond 1000 rows with stable cursors and rejects broken pages", async () => {
  const rows = Array.from({ length: 1203 }, (_, i) => ({
    id: String(i).padStart(5, "0"),
  }));
  const make = () => {
    let cursor = "",
      size;
    return {
      order() {
        return this;
      },
      limit(n) {
        size = n;
        return this;
      },
      gt(_, id) {
        cursor = id;
        return this;
      },
      then(resolve) {
        resolve(rows.filter((r) => r.id > cursor).slice(0, size));
      },
    };
  };
  assert.equal((await readAllPages(make, (x) => x)).length, 1203);
  const broken = () => ({
    order() {
      return this;
    },
    limit() {
      return this;
    },
    gt() {
      return this;
    },
  });
  await assert.rejects(
    readAllPages(broken, async () => [{ id: "same" }], 1),
    /continuar/,
  );
});
test("client summaries are indexed without counting canceled visits", () => {
  const visits = indexClientVisits(
    [
      { client_id: "a", status: "completed" },
      { client_id: "a", status: "cancelled" },
      {
        client_id: "a",
        status: "confirmed",
        starts_at: "2030-01-01T10:00:00Z",
      },
    ],
    0,
  );
  assert.equal(visits.get("a").completed.length, 1);
  assert.equal(visits.get("a").next.starts_at, "2030-01-01T10:00:00Z");
});
test("dashboard shares concurrent reads, skips unchanged revisions and refreshes after a pending write", async (t) => {
  let version = 1,
    reads = 0,
    release;
  let gate = Promise.resolve();
  const fake = {
    from(table) {
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        is() {
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return q;
        },
        maybeSingle() {
          return q;
        },
        then(resolve, reject) {
          reads++;
          return gate
            .then(() => ({
              data: table === "studios" ? { id: "studio" } : [],
              error: null,
            }))
            .then(resolve, reject);
        },
      };
      return q;
    },
  };
  const loader = createDashboardLoader({
    supabase: fake,
    query: async (x) => (await x).data,
    rpc: async () => version,
    ownerId: "owner",
  });
  const [one, two] = await Promise.all([loader.load(), loader.load()]);
  assert.equal(reads, 6);
  assert.deepEqual(one, two);
  t.mock.method(Date, "now", () => 1900000000000);
  assert.equal(await loader.load(), null);
  assert.equal(reads, 6);
  t.mock.method(Date, "now", () => 1900000020000);
  gate = new Promise((r) => (release = r));
  version = 2;
  const pending = loader.load();
  await new Promise((r) => setImmediate(r));
  const afterWrite = loader.load(true);
  gate = Promise.resolve();
  release();
  await Promise.all([pending, afterWrite]);
  assert.equal(
    reads,
    18,
    "forced refresh must run after the existing read settles",
  );
});
test("Stripe signature rejects alteration, expiry, missing secret and accepts key rotation", async () => {
  const now = Date.now(),
    timestamp = Math.floor(now / 1000),
    raw = '{"id":"evt_test"}',
    secret = "whsec_synthetic";
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${raw}`)
    .digest("hex");
  const header = `t=${timestamp},v1=${"0".repeat(64)},v1=${signature}`;
  assert.equal(await verifyStripeSignature(raw, header, secret, now), true);
  assert.equal(
    await verifyStripeSignature(raw + " ", header, secret, now),
    false,
  );
  assert.equal(
    await verifyStripeSignature(raw, header, secret, now + 301000),
    false,
  );
  assert.equal(await verifyStripeSignature(raw, header, "", now), false);
});
test("only the approved monthly BRL plan is accepted; an unpaid invoice grants no paid period", () => {
  const price = {
    id: "price_test",
    active: true,
    currency: "brl",
    unit_amount: 2990,
    recurring: { interval: "month", interval_count: 1 },
  };
  validatePrice(price);
  assert.throws(() => validatePrice({ ...price, unit_amount: 4990 }));
  assert.throws(() => validatePrice({ ...price, currency: "usd" }));
  const subscription = {
    status: "active",
    items: { data: [{ price, quantity: 1, current_period_end: 1900000000 }] },
    latest_invoice: { status: "open" },
  };
  assert.equal(subscriptionState(subscription, "price_test").until, null);
  subscription.latest_invoice.status = "paid";
  assert.ok(subscriptionState(subscription, "price_test").until);
  subscription.items.data[0].quantity = 2;
  assert.throws(() => subscriptionState(subscription, "price_test"));
});
