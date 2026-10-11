import { test } from "node:test";
import assert from "node:assert/strict";
import { canManageBooking } from "../src/booking-policy.js";

const now = Date.parse("2026-10-01T10:00:00-03:00");
const booking = { status: "confirmed", paid: false, starts_at: "2026-10-01T12:00:00-03:00" };
test("allows unpaid confirmed bookings up to the two-hour boundary", () => {
  assert.equal(canManageBooking(booking, now), true);
  assert.equal(canManageBooking(booking, now + 1), false);
});
test("paid, cancelled, completed and unknown payment states cannot be managed", () => {
  for (const change of [{ paid: true }, { paid: undefined }, { status: "cancelled" }, { status: "completed" }, { starts_at: "invalid" }]) {
    assert.equal(canManageBooking({ ...booking, ...change }, now), false);
  }
});
