// Run after fixture.sql and integration.test.js. Only synthetic accounts are used.
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
async function ok(request) {
  const { data, error } = await request;
  assert.equal(error, null, JSON.stringify(error));
  return data;
}
async function gateway(action, args) {
  const res = await fetch(url + "/functions/v1/booking", {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key },
    body: JSON.stringify({ action, args }),
  });
  return { status: res.status, ...(await res.json()) };
}
test("live multi-service: total duration, one buffer, atomic conflicts, snapshots, editing and tenant isolation", async () => {
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
  const studio = await ok(a.from("studios").select("*").single());
  const sid = studio.id;
  const other = await ok(
    b.rpc("setup_studio", {
      p_name: "Outro QA temporário",
      p_professional: "QA B",
      p_slug: "encaixa-qa-multi-b",
    }),
  );
  const foreign = await ok(
    b
      .from("services")
      .insert({
        studio_id: other,
        name: "Serviço outro estúdio",
        duration: 30,
        price: 1,
      })
      .select()
      .single(),
  );
  const services = await ok(
    a
      .from("services")
      .insert([
        { studio_id: sid, name: "QA Manicure", duration: 45, price: 45 },
        { studio_id: sid, name: "QA Sobrancelhas", duration: 30, price: 60 },
        { studio_id: sid, name: "QA Alongamento", duration: 90, price: 130 },
      ])
      .select(),
  );
  const [first, second, third] = [
    "QA Manicure",
    "QA Sobrancelhas",
    "QA Alongamento",
  ].map((n) => services.find((s) => s.name === n));
  const ids = [first.id, second.id];
  const date = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
  const start = `${date}T09:00:00-03:00`;
  const params = { p_slug: studio.slug, p_services: ids, p_date: date };
  assert.ok(
    (await anon.rpc("available_slots_multi", params)).error,
    "direct anonymous RPC denied",
  );
  assert.ok(
    (await a.rpc("available_slots_multi", params)).error,
    "authenticated callers also use protected gateway",
  );
  const slots = await gateway("available_slots_multi", params);
  assert.equal(slots.status, 200);
  const hours = slots.data.map((x) =>
    new Date(x.starts_at).toLocaleTimeString("en-GB", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    }),
  );
  assert.ok(hours.includes("10:30"));
  assert.ok(
    !hours.includes("10:45"),
    "full duration and cleanup respect lunch",
  );
  assert.ok(hours.includes("16:30"));
  assert.ok(
    !hours.includes("16:45"),
    "full duration and cleanup respect closing",
  );
  const duplicate = await gateway("available_slots_multi", {
    ...params,
    p_services: [first.id, first.id],
  });
  assert.equal(duplicate.status, 400);
  const foreignSlots = await gateway("available_slots_multi", {
    ...params,
    p_services: [first.id, foreign.id],
  });
  assert.deepEqual(foreignSlots.data, []);
  const bookArgs = {
    p_slug: studio.slug,
    p_services: ids,
    p_start: start,
    p_name: "QA Multi",
    p_email: "multi@example.invalid",
    p_phone: "11999998888",
    p_notes: "",
  };
  const race = await Promise.all([
    gateway("book_appointment_multi", bookArgs),
    gateway("book_appointment_multi", bookArgs),
  ]);
  assert.equal(
    race.filter((x) => x.status === 200).length,
    1,
    "only one booking can take the combined interval",
  );
  const booking = race.find((x) => x.status === 200).data;
  let row = await ok(
    a.from("appointments").select("*").eq("id", booking.id).single(),
  );
  assert.deepEqual(row.service_ids, ids);
  assert.equal(row.service_items.length, 2);
  assert.equal(Number(row.price), 105);
  assert.equal((new Date(row.ends_at) - new Date(row.starts_at)) / 60000, 75);
  assert.ok(row.service_name.includes("QA Manicure + QA Sobrancelhas"));
  const cid = row.client_id;
  const manual = (at, list) =>
    a
      .from("appointments")
      .insert({
        studio_id: sid,
        client_id: cid,
        service_ids: list,
        starts_at: `${date}T${at}:00-03:00`,
        ends_at: `${date}T18:00:00-03:00`,
        price: 1,
        service_items: [{ price: 1, duration: 1 }],
      })
      .select()
      .single();
  assert.equal(
    (await manual("10:15", [first.id])).error?.code,
    "23P01",
    "cleanup is reserved once at the end",
  );
  const next = await ok(manual("10:30", [first.id]));
  assert.equal(Number(next.price), 45, "client cannot spoof totals");
  assert.ok(
    (await manual("16:00", [first.id, foreign.id])).error,
    "cross-studio service rejected",
  );
  assert.ok(
    (await manual("16:00", [first.id, first.id])).error,
    "duplicate service rejected in direct API",
  );
  const clash = await a
    .from("appointments")
    .update({ service_ids: [...ids, third.id] })
    .eq("id", booking.id);
  assert.equal(
    clash.error?.code,
    "23P01",
    "extending into the next booking is atomic and rejected",
  );
  row = await ok(
    a.from("appointments").select("*").eq("id", booking.id).single(),
  );
  assert.equal(row.service_items.length, 2);
  await ok(
    a
      .from("appointments")
      .update({ service_ids: [first.id] })
      .eq("id", booking.id),
  );
  row = await ok(
    a.from("appointments").select("*").eq("id", booking.id).single(),
  );
  assert.equal(Number(row.price), 45);
  assert.equal((new Date(row.ends_at) - new Date(row.starts_at)) / 60000, 45);
  await ok(
    a.from("appointments").update({ service_ids: ids }).eq("id", booking.id),
  );
  await ok(
    a.from("services").update({ price: 200, duration: 90 }).eq("id", first.id),
  );
  const rescheduleSlots = await gateway("available_slots_multi", {
    ...params,
    p_token: booking.token,
  });
  assert.ok(
    rescheduleSlots.data.some(
      (x) => new Date(x.starts_at).getTime() === new Date(start).getTime(),
    ),
    "rescheduling excludes own interval and uses original duration",
  );
  const moved = await gateway("manage_booking", {
    p_token: booking.token,
    p_action: "reschedule",
    p_start: `${date}T13:00:00-03:00`,
  });
  assert.equal(moved.status, 200, JSON.stringify(moved));
  assert.equal(Number(moved.data.price), 105);
  assert.equal(
    (new Date(moved.data.ends_at) - new Date(moved.data.starts_at)) / 60000,
    75,
    "catalog edits do not alter booked duration",
  );
  assert.equal(moved.data.service_items[0].price, 45);
  assert.equal(
    (
      await gateway("available_slots_multi", {
        ...params,
        p_token: "00000000-0000-0000-0000-000000000000",
      })
    ).data.length,
    0,
  );
  const payment = await ok(
    a
      .from("payments")
      .insert({
        studio_id: sid,
        appointment_id: booking.id,
        amount: 1,
        method: "Pix",
      })
      .select()
      .single(),
  );
  assert.equal(Number(payment.amount), 105);
  assert.ok(
    (
      await a
        .from("appointments")
        .update({ service_ids: [second.id] })
        .eq("id", booking.id)
    ).error,
    "paid service changes are blocked",
  );
  assert.deepEqual(
    await ok(b.from("appointments").select("*").eq("id", booking.id)),
    [],
  );
  await a.auth.signOut();
  await b.auth.signOut();
  console.log(
    "Multi-service integration passed; synthetic fixtures remain for cleanup.",
  );
});

