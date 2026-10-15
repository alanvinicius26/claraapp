// Live reload (`cap run -l`) points the app at http://localhost:3000 and enables
// cleartext traffic. Capacitor reverts both on Ctrl+C, but not if the terminal is
// closed. This guard finds and removes those leftovers so they never reach a build.
// CLI: `node scripts/android-guard.mjs` (check) or `--repair`.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const cleartext = /\s*android:usesCleartextTraffic="true"/g;
export const paths = (root) => ({
  base: join(root, "capacitor.config.json"),
  app: join(root, "android", "app", "src", "main", "assets", "capacitor.config.json"),
  plugins: join(root, "android", "capacitor-cordova-android-plugins", "src", "main", "AndroidManifest.xml"),
});

export function liveReloadLeftovers(root) {
  const p = paths(root), problems = [];
  if (existsSync(p.app)) {
    try {
      if (JSON.parse(readFileSync(p.app, "utf8")).server?.url) problems.push("O app aponta para o servidor local (server.url).");
    } catch { problems.push("A configuração do app Android está ilegível."); }
  }
  if (existsSync(p.plugins) && cleartext.test(readFileSync(p.plugins, "utf8")))
    problems.push("O app permite conexão sem HTTPS (usesCleartextTraffic).");
  cleartext.lastIndex = 0;
  return problems;
}

export function repairLiveReload(root) {
  const p = paths(root);
  if (existsSync(p.app)) {
    let config;
    try { config = JSON.parse(readFileSync(p.app, "utf8")); } catch { config = JSON.parse(readFileSync(p.base, "utf8")); }
    if (config.server?.url) {
      const { url, ...server } = config.server;
      if (Object.keys(server).length) config.server = server; else delete config.server;
    }
    writeFileSync(p.app, JSON.stringify(config, null, "\t"));
  }
  if (existsSync(p.plugins)) writeFileSync(p.plugins, readFileSync(p.plugins, "utf8").replace(cleartext, ""));
  return liveReloadLeftovers(root);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const root = resolve(".");
  const problems = process.argv.includes("--repair") ? repairLiveReload(root) : liveReloadLeftovers(root);
  if (problems.length) {
    console.error("Restos do modo ao vivo no projeto Android:\n- " + problems.join("\n- ") + "\nRode: npm run android:release");
    process.exit(1);
  }
  console.log("Projeto Android sem restos do modo ao vivo.");
}
