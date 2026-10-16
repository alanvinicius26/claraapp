import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server, businessPulse, revenueByDay;
before(async () => {
  server = await createServer({
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
  });
  ({ businessPulse, revenueByDay } = await server.ssrLoadModule("/src/Insights.jsx"));
});
after(async () => { await server?.close(); });

const visit = (client_id, date, status = "completed", price = 100) => ({
  client_id, starts_at: `${date}T10:00:00-03:00`, status, price,
});

test("returning clients excludes old history and future appointments", () => {
  const rows = [
    visit("old", "2026-01-02"), visit("old", "2026-01-03"),
    visit("new", "2026-10-12"), visit("new", "2026-10-14"),
  ];
  assert.equal(businessPulse(rows, "2026-10-13").returning, 0);
});

test("returning clients counts completed visits within 30 local calendar days", () => {
  const rows = [
    visit("repeat", "2026-09-14"), visit("repeat", "2026-10-13"),
    visit("single", "2026-09-13"), visit("single", "2026-10-13"),
    visit("single", "2026-10-12", "cancelled"),
    visit("single", "2026-10-12", "confirmed"),
    visit("single", "2026-10-12", "blocked"),
  ];
  assert.equal(businessPulse(rows, "2026-10-13").returning, 0.5);
  assert.equal(businessPulse([visit("old", "2026-09-13")], "2026-10-13").returning, null);
});

test("a one-day revenue chart excludes adjacent days using Sao Paulo time", () => {
  const rows = [
    visit("a", "2026-10-12"), visit("b", "2026-10-13"),
    visit("c", "2026-10-14"), visit("d", "2026-10-13", "confirmed", 50),
    { ...visit("late", "2026-10-13"), starts_at: "2026-10-14T02:59:00Z" },
    { ...visit("early", "2026-10-13"), starts_at: "2026-10-13T02:59:00Z" },
  ];
  assert.deepEqual(revenueByDay(rows, "2026-10-13", "2026-10-13"), [
    { date: "2026-10-13", done: 200, planned: 50 },
  ]);
});

test("after merging duplicates, returning clients counts the unified history at once", () => {
  // Same person: one visit as "ana" (panel) and one as "ana-online" (online booking).
  const rows = [visit("ana", "2026-10-01"), visit("ana-online", "2026-10-08"), visit("bia", "2026-10-05")];
  assert.equal(businessPulse(rows, "2026-10-13").returning, 0);
  // merge_client_group points every appointment to the main record; the panel reloads.
  const merged = rows.map((a) => (a.client_id === "ana-online" ? { ...a, client_id: "ana" } : a));
  assert.equal(businessPulse(merged, "2026-10-13").returning, 0.5);
});
