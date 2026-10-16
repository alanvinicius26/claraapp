import { test } from "node:test";
import assert from "node:assert/strict";
import { canManageBooking, changeDeadlinePassed, changeNoticeHours, changeNoticeLabel } from "../src/booking-policy.js";

const now = Date.parse("2026-10-01T10:00:00-03:00");
const booking = { status: "confirmed", paid: false, starts_at: "2026-10-01T12:00:00-03:00" };
test("allows unpaid confirmed bookings up to the two-hour boundary", () => {
  assert.equal(canManageBooking(booking, now), true);
  assert.equal(canManageBooking(booking, now + 1), false);
  assert.equal(changeDeadlinePassed(booking, now), false);
  assert.equal(changeDeadlinePassed(booking, now + 1), true);
});
test("uses the studio deadline and falls back to two hours", () => {
  const day = { ...booking, starts_at: "2026-10-02T10:00:00-03:00", change_notice_hours: 24 };
  assert.equal(canManageBooking(day, now), true);
  assert.equal(canManageBooking(day, now + 1), false);
  assert.equal(changeDeadlinePassed(day, now + 1), true);
  assert.equal(canManageBooking({ ...booking, change_notice_hours: 48 }, now), false);
  for (const value of [undefined, null, 3, "abc", 0]) assert.equal(changeNoticeHours({ change_notice_hours: value }), 2);
  assert.equal(changeNoticeHours({ change_notice_hours: "12" }), 12);
  assert.equal(changeNoticeLabel({ change_notice_hours: 48 }), "48 horas");
});
test("paid, cancelled, completed and unknown payment states cannot be managed", () => {
  for (const change of [{ paid: true }, { paid: undefined }, { status: "cancelled" }, { status: "completed" }, { starts_at: "invalid" }]) {
    assert.equal(canManageBooking({ ...booking, ...change }, now), false);
    assert.equal(changeDeadlinePassed({ ...booking, ...change }, now + 1), false);
  }
});
