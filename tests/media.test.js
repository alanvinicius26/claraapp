import { test } from "node:test";
import assert from "node:assert/strict";
import { stagingEnv } from "./staging-env.js";
import { createClient } from "@supabase/supabase-js";
const env = stagingEnv();
test("storage allows owner upload and blocks another account", async () => {
  const a = createClient(
    env.VITE_SUPABASE_URL,
    env.VITE_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false } },
  );
  const b = createClient(
    env.VITE_SUPABASE_URL,
    env.VITE_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false } },
  );
  const loginA = await a.auth.signInWithPassword({
    email: "encaixa-test-a@example.invalid",
    password: "Encaixa-QA-9c187db1-f2c8!",
  });
  const loginB = await b.auth.signInWithPassword({
    email: "encaixa-test-b@example.invalid",
    password: "Encaixa-QA-9c187db1-f2c8!",
  });
  assert.equal(loginA.error, null);
  assert.equal(loginB.error, null);
  const path = loginA.data.user.id + "/qa-image.png";
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1sAAAAASUVORK5CYII=",
    "base64",
  );
  try {
    const upload = await a.storage
      .from("studio-media")
      .upload(path, bytes, { contentType: "image/png" });
    assert.equal(upload.error, null);
    const denied = await b.storage
      .from("studio-media")
      .upload(loginA.data.user.id + "/forbidden.png", bytes, {
        contentType: "image/png",
      });
    assert.ok(denied.error);
    const publicUrl = a.storage.from("studio-media").getPublicUrl(path)
      .data.publicUrl;
    const response = await fetch(publicUrl);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
  } finally {
    await a.storage.from("studio-media").remove([path]);
    await a.auth.signOut();
    await b.auth.signOut();
  }
});
