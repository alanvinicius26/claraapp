import { test } from "node:test";
import assert from "node:assert/strict";
import { totals, shiftDate, csv, slugify } from "../src/domain.js";
import { claraDaySummary } from "../src/clara-day.js";
import { claraMilestoneFor, claimClaraMilestone } from "../src/clara-milestones.js";

test("Clara celebrates explicit first actions, not edits or subsequent registrations", () => {
  const empty = { services: [], appointments: [] };
  assert.equal(claraMilestoneFor("service-created", empty), "first-service");
  assert.equal(claraMilestoneFor(undefined, empty), null);
  assert.equal(claraMilestoneFor("service-created", { ...empty, services: [{ id: "old", active: false }] }), null);
  assert.equal(claraMilestoneFor("appointment-completed", { ...empty, appointments: [{ status: "confirmed" }, { status: "cancelled" }] }), "first-completed");
  assert.equal(claraMilestoneFor("appointment-completed", { ...empty, appointments: [{ status: "completed" }] }), null);
});
test("Clara remembers each milestone separately for each studio", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(claimClaraMilestone("test-studio-a", "first-service", storage), true);
  assert.equal(claimClaraMilestone("test-studio-a", "first-service", storage), false);
  assert.equal(claimClaraMilestone("test-studio-a", "first-completed", storage), true);
  assert.equal(claimClaraMilestone("test-studio-b", "first-service", storage), true);
  assert.equal(claimClaraMilestone("test-studio-b", null, storage), false);
});
test("Clara does not repeat persisted milestones, and storage failure never interrupts success", () => {
  assert.equal(claimClaraMilestone("test-studio-persisted", "first-service", { getItem: () => "seen" }), false);
  const blocked = { getItem() { throw new Error("Storage blocked"); } };
  assert.equal(claimClaraMilestone("test-studio-private", "first-service", blocked), true);
  assert.equal(claimClaraMilestone("test-studio-private", "first-service", blocked), false);
});

const claraNow = new Date("2026-10-05T13:00:00-03:00");
const claraAppointments = [
  { id: "done", starts_at: "2026-10-05T09:00:00-03:00", status: "completed", professional_id: "p1" },
  { id: "later", starts_at: "2026-10-05T16:00:00-03:00", status: "confirmed", professional_id: "p1" },
  { id: "next", starts_at: "2026-10-05T14:00:00-03:00", status: "confirmed", professional_id: "p2" },
  { id: "cancelled", starts_at: "2026-10-05T13:10:00-03:00", status: "cancelled", professional_id: "p1" },
  { id: "blocked", starts_at: "2026-10-05T13:20:00-03:00", status: "blocked", professional_id: "p1" },
  { id: "invalid", starts_at: "invalid", status: "confirmed", professional_id: "p1" },
];
test("Clara counts appointments, excluding blocks and cancellations, and sorts the next confirmed visit", () => {
  const result = claraDaySummary(claraAppointments, { day: "2026-10-05", now: claraNow });
  assert.equal(result.count, 3);
  assert.equal(result.completed, 1);
  assert.equal(result.next.id, "next");
  assert.equal(result.nextLabel, "Hoje às 14:00");
  assert.equal(result.greeting, "Boa tarde");
});
test("Clara respects professional selection for both totals and next appointment", () => {
  const result = claraDaySummary(claraAppointments, { day: "2026-10-05", professionalId: "p1", now: claraNow });
  assert.equal(result.count, 2);
  assert.equal(result.next.id, "later");
});
test("Clara distinguishes an empty selected day from a later upcoming appointment", () => {
  const result = claraDaySummary(claraAppointments, { day: "2026-10-04", now: claraNow });
  assert.equal(result.count, 0);
  assert.equal(result.summary, "Em 4 de outubro, sua agenda está livre.");
  assert.equal(result.nextDay, "2026-10-05");
});
test("Clara uses São Paulo date at UTC midnight and never offers a past confirmed visit", () => {
  const now = new Date("2026-10-06T01:00:00Z");
  const result = claraDaySummary([
    ...claraAppointments,
    { id: "late", status: "confirmed", starts_at: "2026-10-06T02:00:00Z" },
    { id: "tomorrow", status: "confirmed", starts_at: "2026-10-06T13:00:00Z" },
  ], { day: "2026-10-05", now });
  assert.equal(result.count, 4);
  assert.equal(result.next.id, "late");
  assert.equal(result.nextDay, "2026-10-05");
  assert.equal(result.nextLabel, "Hoje às 23:00");
  assert.equal(result.greeting, "Boa noite");
});
test("Clara shows no next appointment once all confirmed visits are in the past", () => {
  const result = claraDaySummary(claraAppointments, { day: "2026-10-05", now: new Date("2026-10-05T23:00:00-03:00") });
  assert.equal(result.next, null);
  assert.equal(result.nextDay, null);
  assert.equal(result.completed, 1);
});
test("Clara handles an empty agenda and singular appointment wording", () => {
  assert.match(claraDaySummary([], { day: "2026-10-05", now: claraNow }).summary, /Hoje, sua agenda está livre/);
  assert.match(claraDaySummary([claraAppointments[0]], { day: "2026-10-05", now: claraNow }).summary, /1 atendimento\.$/);
});
test("finance ignores cancelled appointments and personal blocks", () => {
  assert.deepEqual(
    totals(
      [
        { status: "confirmed", price: 90 },
        { status: "completed", price: 65 },
        { status: "cancelled", price: 80 },
        { status: "blocked", price: 0 },
      ],
      [{ amount: 65 }],
    ),
    { count: 2, expected: 155, received: 65, pending: 90 },
  );
});
test("date navigation crosses months and leap years without timezone shifts", () => {
  assert.equal(shiftDate("2028-02-28", 1), "2028-02-29");
  assert.equal(shiftDate("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftDate("2026-03-01", -1), "2026-02-28");
});
test("CSV preserves quotes and protects spreadsheet formula injection", () => {
  assert.equal(
    csv([["=SUM(A1)", 'Ana "B"', "a;b"]]),
    '\uFEFF"\'=SUM(A1)";"Ana ""B""";"a;b"',
  );
});
test("public slugs remove accents and punctuation", () => {
  assert.equal(slugify("Estúdio São João!"), "estudio-sao-joao");
});
