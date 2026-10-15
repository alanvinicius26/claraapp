import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paths, liveReloadLeftovers, repairLiveReload } from "../scripts/android-guard.mjs";

test("live reload leftovers are detected and removed without touching other settings", () => {
  const root = mkdtempSync(join(tmpdir(), "clara-android-"));
  try {
    const p = paths(root);
    mkdirSync(join(p.app, ".."), { recursive: true }); mkdirSync(join(p.plugins, ".."), { recursive: true });
    const base = { appId: "com.minhaclara.app", appName: "Clara", webDir: "dist" };
    writeFileSync(p.base, JSON.stringify(base));
    writeFileSync(p.app, JSON.stringify({ ...base, server: { url: "http://localhost:3000", androidScheme: "https" } }));
    writeFileSync(p.plugins, '<manifest><application  android:usesCleartextTraffic="true">\n</application></manifest>');
    assert.equal(liveReloadLeftovers(root).length, 2);
    assert.deepEqual(repairLiveReload(root), []);
    assert.deepEqual(JSON.parse(readFileSync(p.app, "utf8")), { ...base, server: { androidScheme: "https" } });
    assert.ok(!readFileSync(p.plugins, "utf8").includes("Cleartext"));
    writeFileSync(p.app, "{broken");
    assert.equal(liveReloadLeftovers(root).length, 1);
    assert.deepEqual(repairLiveReload(root), []);
    assert.deepEqual(JSON.parse(readFileSync(p.app, "utf8")), base);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a clean or not-yet-created Android project has no leftovers", () => {
  const root = mkdtempSync(join(tmpdir(), "clara-android-"));
  try { assert.deepEqual(liveReloadLeftovers(root), []); } finally { rmSync(root, { recursive: true, force: true }); }
});
