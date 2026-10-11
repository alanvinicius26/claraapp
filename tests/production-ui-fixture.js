// Isolated manual UI verification: no network, real users, emails or writes.
// Loaded only by .local/production-qa.html; never included in the Vite entry point.
const mode = new URL(location.href).searchParams.get("mode") || "dashboard";
let failed = false;
let signedOut = false;
let authCallback;
let fixturePlan =
  mode === "billing-limit"
    ? "team5"
    : mode === "billing-three"
      ? "team3"
      : "solo";
window.fetch = async (input, init) => {
  if (String(input).endsWith("/functions/v1/billing")) {
    const body = init?.body ? JSON.parse(init.body) : { action: "status" };
    if (body.action !== "status") {
      if (mode === "billing-failure")
        return new Response(
          JSON.stringify({
            message: "Falha simulada. Seu plano anterior foi mantido.",
          }),
          { status: 503 },
        );
      if (body.action === "change") fixturePlan = body.plan;
      return new Response(
        JSON.stringify({
          message: "Simulação concluída. Nenhuma cobrança foi feita.",
        }),
      );
    }
    return new Response(
      JSON.stringify({ configured: true, mode: "test", plans_version: 2 }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  throw new Error("External network blocked in the isolated fixture");
};
const { supabase } = await import("../src/lib.js");
const { demoStudio, demoProfessionals, demoClients, demoServices } =
  await import("../src/demo.js");
supabase.auth.stopAutoRefresh();
const session = {
  access_token: "synthetic-not-a-token",
  user: { id: "qa-owner" },
};
supabase.auth.getSession = async () => {
  if (mode === "auth-failure" && !failed) {
    failed = true;
    throw new Error("Failed to fetch");
  }
  return {
    data: { session: signedOut || mode.startsWith("auth") ? null : session },
  };
};
supabase.auth.onAuthStateChange = (callback) => {
  authCallback = callback;
  if (mode === "recovery")
    queueMicrotask(() => callback("PASSWORD_RECOVERY", session));
  return { data: { subscription: { unsubscribe() {} } } };
};
supabase.auth.signOut = async () => {
  if (mode === "logout-failure" && !failed) {
    failed = true;
    return { error: { message: "Failed to fetch" } };
  }
  signedOut = true;
  authCallback?.("SIGNED_OUT", null);
  return { error: null };
};
supabase.auth.resetPasswordForEmail = async () => ({ data: {}, error: null });
let resendAttempts = 0;
supabase.auth.resend = async ({ type, email, options }) => {
  if (
    type !== "signup" ||
    !email ||
    email !== email.trim() ||
    options?.emailRedirectTo !== location.origin
  )
    throw new Error("Invalid confirmation request in fixture");
  resendAttempts++;
  if (mode === "auth-resend-failure" && resendAttempts === 1)
    return { error: { message: "Failed to fetch" } };
  return { data: {}, error: null };
};
supabase.auth.signInWithPassword = async () => ({
  error: { message: "Failed to fetch" },
});
supabase.auth.signUp = async () => ({ data: { session: null }, error: null });
supabase.rpc = async (name) => ({
  data:
    name === "billing_status"
      ? mode.startsWith("billing-")
        ? {
            status: mode === "billing-expired" ? "trial" : "active",
            can_use: mode !== "billing-expired",
            plans_version: 2,
            billing_enabled: mode !== "billing-disabled",
            has_subscription: mode !== "billing-expired",
            has_customer: mode !== "billing-expired",
            trial_ends_at: "2020-01-01",
            paid_until:
              mode === "billing-expired"
                ? null
                : new Date(Date.now() + 20 * 86400000).toISOString(),
            plan_id: fixturePlan,
            plan_limit: { solo: 1, team3: 3, team4: 4, team5: 5 }[fixturePlan],
            effective_limit:
              mode === "billing-disabled"
                ? 5
                : { solo: 1, team3: 3, team4: 4, team5: 5 }[fixturePlan],
            active_professionals:
              mode === "billing-limit" ? 5 : mode === "billing-three" ? 3 : 1,
          }
        : {
            status: mode === "expired" ? "canceled" : "trial",
            can_use: mode !== "expired",
            has_subscription: mode === "expired",
            has_customer: mode === "expired",
            trial_ends_at: new Date(
              Date.now() + (mode === "expired" ? -1 : 6) * 86400000,
            ).toISOString(),
          }
      : 1,
  error: null,
});
const studioId = "qa-studio";
const records = {
  studios: [{ ...demoStudio, id: studioId, owner_id: "qa-owner" }],
  clients: Array.from({ length: 53 }, (_, i) => ({
    ...demoClients[0],
    id: String(i).padStart(4, "0"),
    name: `Cliente ${String(i + 1).padStart(2, "0")}`,
    studio_id: studioId,
  })),
  services: demoServices.map((item) => ({
    ...item,
    studio_id: studioId,
    created_at: "2026-01-01",
  })),
  professionals: demoProfessionals.map((item) => ({
    ...item,
    studio_id: studioId,
  })),
  payments: [],
  appointments: [],
  working_hours: [],
};
if (mode.startsWith("billing-")) {
  const count = mode === "billing-limit" ? 5 : mode === "billing-three" ? 3 : 1;
  records.professionals = Array.from({ length: count }, (_, i) => ({
    id: `billing-pro-${i}`,
    studio_id: studioId,
    name: i === 0 ? "Proprietária" : `Atendente ${i + 1}`,
    active: true,
    is_default: i === 0,
  }));
}
supabase.from = (table) => {
  let single = false,
    size = 500;
  const filters = [];
  const q = {
    select() {
      return q;
    },
    order() {
      return q;
    },
    limit(n) {
      size = n;
      return q;
    },
    eq(k, v) {
      filters.push((x) => x[k] === v);
      return q;
    },
    is(k, v) {
      filters.push((x) => (v === null ? x[k] == null : x[k] === v));
      return q;
    },
    gt(k, v) {
      filters.push((x) => x[k] > v);
      return q;
    },
    maybeSingle() {
      single = true;
      return q;
    },
    then(resolve, reject) {
      if (mode === "data-failure" && !failed) {
        failed = true;
        return Promise.reject(new Error("Failed to fetch")).then(
          resolve,
          reject,
        );
      }
      const data = (records[table] || [])
        .filter((x) => filters.every((f) => f(x)))
        .slice(0, size);
      return Promise.resolve({
        data: single ? data[0] : data,
        error: null,
      }).then(resolve, reject);
    },
  };
  return q;
};
await import("../src/main.jsx");
