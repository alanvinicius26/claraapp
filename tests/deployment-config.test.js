import test from "node:test";
import assert from "node:assert/strict";
import {
  validateDeploymentEnv,
  allowCustomerSharing,
} from "../scripts/deployment-config.js";

const valid = {
  VITE_SUPABASE_URL: "https://example.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-key",
};

test("deployment requires both public Supabase variables", () => {
  assert.doesNotThrow(() => validateDeploymentEnv(valid));
  for (const name of Object.keys(valid)) {
    assert.throws(
      () => validateDeploymentEnv({ ...valid, [name]: "" }),
      new RegExp(name),
    );
  }
});

test("deployment rejects placeholders, privileged keys and invalid backend origins", () => {
  for (const key of [
    "your_publishable_key",
    "sb_secret_private",
    "eyJservice_role",
    " ",
  ]) {
    assert.throws(() =>
      validateDeploymentEnv({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: key }),
    );
  }
  for (const url of [
    "invalid",
    "file:///tmp",
    "https://user:password@example.com",
    "https://example.com/path",
    "https://example.com?key=private",
  ]) {
    assert.throws(
      () => validateDeploymentEnv({ ...valid, VITE_SUPABASE_URL: url }),
      /VITE_SUPABASE_URL/,
    );
  }
});

test("customer sharing is blocked in Vercel previews and custom environments", () => {
  assert.equal(allowCustomerSharing({}), true);
  assert.equal(
    allowCustomerSharing({ VERCEL: "1", VERCEL_ENV: "production" }),
    true,
  );
  assert.equal(allowCustomerSharing({ VERCEL: "1" }), false);
  assert.equal(allowCustomerSharing({ VERCEL_ENV: "preview" }), false);
  assert.equal(
    allowCustomerSharing({
      VERCEL_ENV: "production",
      VERCEL_TARGET_ENV: "staging",
    }),
    false,
  );
});
