import { test } from "node:test";
import assert from "node:assert/strict";
import { accessNotice, nextAccessCheck, noticeSeenKey } from "../src/access-notice.js";

const future = new Date(Date.now() + 864e5).toISOString(), past = new Date(Date.now() - 864e5).toISOString();
const base = { can_use: false, billing_enabled: true, has_subscription: false, status: "trial", trial_ends_at: past, active_professionals: 1, effective_limit: 1 };

test("no notice while access is allowed, unknown or billing is not active", () => {
  assert.equal(accessNotice(null), null);
  assert.equal(accessNotice({ ...base, can_use: true }), null);
  assert.equal(accessNotice({ ...base, can_use: undefined }), null);
  assert.equal(accessNotice({ ...base, billing_enabled: false }), null);
});

test("each blocked situation gets its own message and call to action", () => {
  assert.equal(accessNotice(base).kind, "trial_ended");
  assert.match(accessNotice(base).title, /teste grátis de 7 dias terminou/);
  assert.equal(accessNotice({ ...base, has_subscription: true, status: "past_due" }).kind, "payment_failed");
  assert.equal(accessNotice({ ...base, has_subscription: true, status: "canceled" }).kind, "subscription_ended");
  assert.equal(accessNotice({ ...base, has_subscription: true, status: "active", paid_until: future, active_professionals: 4, effective_limit: 3 }).kind, "team_limit");
  assert.equal(accessNotice({ ...base, benefit: { expires_at: future }, active_professionals: 6, effective_limit: 5 }).kind, "team_limit");
  // Over the limit but the paid period also ended: the period is the real cause.
  assert.equal(accessNotice({ ...base, has_subscription: true, status: "canceled", paid_until: past, active_professionals: 4, effective_limit: 1 }).kind, "subscription_ended");
});

test("an open panel re-checks exactly when the earliest period ends", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  assert.equal(nextAccessCheck({ can_use: true, trial_ends_at: "2026-10-15T16:48:00Z", benefit: { expires_at: "2026-10-20T00:00:00Z" } }, now), Date.parse("2026-10-15T16:48:00Z"));
  assert.equal(nextAccessCheck({ can_use: true, trial_ends_at: "2026-10-14T00:00:00Z" }, now), null);
  assert.equal(nextAccessCheck({ can_use: false, trial_ends_at: "2026-10-16T00:00:00Z" }, now), null);
  assert.equal(nextAccessCheck(null, now), null);
});

test("full-screen notice memory is per owner and per situation", () => {
  assert.notEqual(noticeSeenKey("a", "trial_ended"), noticeSeenKey("b", "trial_ended"));
  assert.notEqual(noticeSeenKey("a", "trial_ended"), noticeSeenKey("a", "payment_failed"));
});
