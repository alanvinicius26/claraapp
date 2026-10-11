// Requires temporary test-only users prepared with tests/fixture.sql.
// This test NEVER signs up users or sends confirmation email.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stagingEnv } from "./staging-env.js";
import { createClient } from "@supabase/supabase-js";
const env = stagingEnv();
const url = env.VITE_SUPABASE_URL,
  key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const client = () =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
async function gateway(action, args) {
  const r = await fetch(url + "/functions/v1/booking", {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key },
    body: JSON.stringify({ action, args }),
  });
  return { status: r.status, ...(await r.json()) };
}
async function ok(request) {
  const { data, error } = await request;
  assert.equal(error, null, JSON.stringify(error));
  return data;
}
test("live Supabase: auth, tenant isolation, booking race, rescheduling, payment, private data", async () => {
  const a = client(),
    b = client(),
    anon = client();
  await ok(
    a.auth.signInWithPassword({
      email: "encaixa-test-a@example.invalid",
      password: "Encaixa-QA-9c187db1-f2c8!",
    }),
  );
  await ok(
    b.auth.signInWithPassword({
      email: "encaixa-test-b@example.invalid",
      password: "Encaixa-QA-9c187db1-f2c8!",
    }),
  );
  const sid = await ok(
    a.rpc("setup_studio", {
      p_name: "Encaixa Teste Temporário",
      p_professional: "Teste",
      p_slug: "encaixa-qa-temp",
    }),
  );
  const service = await ok(
    a
      .from("services")
      .insert({
        studio_id: sid,
        name: "Manicure de teste",
        price: 90,
        duration: 60,
      })
      .select()
      .single(),
  );
  const hours = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    enabled: true,
    opens: "09:00",
    closes: "18:00",
    break_start: "12:00",
    break_end: "13:00",
  }));
  await ok(a.rpc("save_hours", { p_studio: sid, p_hours: hours }));
  assert.deepEqual(
    await ok(b.from("studios").select("*")),
    [],
    "other tenant cannot read studios",
  );
  assert.deepEqual(
    await ok(b.from("clients").select("*")),
    [],
    "other tenant cannot read clients",
  );
  const illegal = await b.from("services").insert({
    studio_id: sid,
    name: "Invasão de teste",
    price: 1,
    duration: 30,
  });
  assert.ok(illegal.error, "other tenant cannot write");
  const raw = await anon.from("clients").select("*");
  assert.ok(raw.error, "anonymous raw tables are blocked");
  assert.ok(
    (await anon.rpc("booking_page", { p_slug: "encaixa-qa-temp" })).error,
    "direct privileged RPC is blocked",
  );
  const page = await gateway("booking_page", { p_slug: "encaixa-qa-temp" });
  assert.equal(page.status, 200);
  assert.equal(page.data.studio.name, "Encaixa Teste Temporário");
  assert.equal(page.data.studio.owner_id, undefined);
  const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const slots = await gateway("available_slots", {
    p_slug: "encaixa-qa-temp",
    p_service: service.id,
    p_date: date,
  });
  assert.equal(slots.status, 200);
  assert.ok(slots.data.length > 5);
  const invalid = await gateway("book_appointment", {
    p_slug: "encaixa-qa-temp",
    p_service: service.id,
    p_start: date + "T12:00:00-03:00",
    p_name: "Cliente Teste",
    p_email: "qa@example.invalid",
    p_phone: "11999998888",
  });
  assert.equal(invalid.status, 409, "lunch cannot be booked");
  const args = {
    p_slug: "encaixa-qa-temp",
    p_service: service.id,
    p_start: slots.data[0].starts_at,
    p_name: "Cliente Teste",
    p_email: "qa@example.invalid",
    p_phone: "11999998888",
    p_notes: "Preferência pública de teste",
  };
  const race = await Promise.all([
    gateway("book_appointment", args),
    gateway("book_appointment", args),
  ]);
  assert.equal(
    race.filter((r) => r.status === 200).length,
    1,
    "only one concurrent reservation succeeds",
  );
  const booked = race.find((r) => r.status === 200).data;
  let record = await gateway("manage_booking", { p_token: booked.token });
  assert.equal(record.data.service, "Manicure de teste");
  assert.equal(record.data.notes, undefined);
  let rows = await ok(a.from("appointments").select("*").eq("id", booked.id));
  assert.equal(rows.length, 1);
  const c = await ok(a.from("clients").select("*"));
  assert.equal(c.length, 1, "failed booking creates no orphan client");
  await ok(
    a.from("clients").update({ notes: "INTERNAL SECRET" }).eq("id", c[0].id),
  );
  assert.equal(JSON.stringify(record).includes("INTERNAL SECRET"), false);
  const overlap = await a.from("appointments").insert({
    studio_id: sid,
    client_id: c[0].id,
    service_id: service.id,
    starts_at: slots.data[0].starts_at,
    ends_at: slots.data[1].starts_at,
  });
  assert.equal(overlap.error?.code, "23P01", "owner cannot overlap either");
  const altered = await b
    .from("appointments")
    .update({ status: "cancelled" })
    .eq("id", booked.id)
    .select();
  assert.equal(altered.data.length, 0);
  const availableAfter = await gateway("available_slots", {
    p_slug: "encaixa-qa-temp",
    p_service: service.id,
    p_date: date,
  });
  assert.ok(!availableAfter.data.some((x) => x.starts_at === args.p_start));
  const changed = await gateway("manage_booking", {
    p_token: booked.token,
    p_action: "reschedule",
    p_start: availableAfter.data.at(-1).starts_at,
  });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.data.starts_at, record.data.starts_at);
  await ok(
    a.from("payments").insert({
      studio_id: sid,
      appointment_id: booked.id,
      amount: 1,
      method: "Pix",
    }),
  );
  const pay = await ok(a.from("payments").select("*"));
  assert.equal(pay[0].amount, 90, "amount fixed from actual appointment");
  const paidCancel = await gateway("manage_booking", {
    p_token: booked.token,
    p_action: "cancel",
  });
  assert.equal(
    paidCancel.status,
    400,
    "paid bookings require studio intervention",
  );
  await ok(a.from("payments").delete().eq("id", pay[0].id));
  const cancelled = await gateway("manage_booking", {
    p_token: booked.token,
    p_action: "cancel",
  });
  assert.equal(cancelled.data.status, "cancelled");
  const restoredSlots = await gateway("available_slots", {
    p_slug: "encaixa-qa-temp",
    p_service: service.id,
    p_date: date,
  });
  assert.equal(restoredSlots.data.length, slots.data.length);
  const tokenAttack = await gateway("manage_booking", {
    p_token: "00000000-0000-0000-0000-000000000000",
  });
  assert.equal(tokenAttack.status, 400);
  const crossRef = await b.from("payments").insert({
    studio_id: sid,
    appointment_id: booked.id,
    amount: 90,
    method: "Pix",
  });
  assert.ok(crossRef.error);
  await ok(a.from("studios").update({ active: false }).eq("id", sid));
  const paused = await gateway("available_slots", {
    p_slug: "encaixa-qa-temp",
    p_service: service.id,
    p_date: date,
  });
  assert.equal(paused.data.length, 0);
  await ok(a.from("studios").update({ active: true }).eq("id", sid));
  await a.auth.signOut();
  await b.auth.signOut();
  console.log(
    "Live integration passed. Fixture remains for browser checks; remove with tests/cleanup.sql.",
  );
});

