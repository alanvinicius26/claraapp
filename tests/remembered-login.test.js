import { test } from "node:test";
import assert from "node:assert/strict";
import { rememberedEmail, rememberEmail } from "../src/remembered-login.js";

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m }; };

test("remembers only the e-mail, normalized, and forgets on request", () => {
  const s = memory();
  rememberEmail(s, "  Ana@Studio.com ", true);
  assert.equal(rememberedEmail(s), "ana@studio.com");
  assert.ok(![...s.m.values()].some((v) => v.includes("password")));
  rememberEmail(s, "ana@studio.com", false);
  assert.equal(rememberedEmail(s), "");
});

test("blocked or corrupted storage never breaks the login screen", () => {
  const blocked = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); }, removeItem() { throw new Error("x"); } };
  assert.equal(rememberedEmail(blocked), "");
  assert.doesNotThrow(() => rememberEmail(blocked, "a@b.com", true));
  const bad = memory(); bad.setItem("clara-last-login", "{nope");
  assert.equal(rememberedEmail(bad), "");
  assert.equal(rememberedEmail(null), "");
});
