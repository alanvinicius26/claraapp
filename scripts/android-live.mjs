// Live reload on Android: the app loads the local Vite server, so code changes
// appear on the phone/emulator without build + sync + Run.
// Usage: terminal 1 `npm run dev`, terminal 2 `npm run android:live`.
// The dev server stays on 127.0.0.1; `adb reverse` tunnels the device's
// localhost:3000 to this computer over USB (or to the emulator), not over Wi-Fi.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { liveReloadLeftovers, repairLiveReload } from "./android-guard.mjs";

const port = "3000";
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT ||
  (process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Android", "Sdk"));
const adb = sdk && existsSync(join(sdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb"))
  ? join(sdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb")
  : "adb";

const root = resolve(".");
// A previous session closed without Ctrl+C may have left the live settings behind.
if (liveReloadLeftovers(root).length) { repairLiveReload(root); console.log("Removidos restos de uma sessão ao vivo anterior."); }

const run = (cmd, args, options = {}) => spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...options });

const list = spawnSync(adb, ["devices"], { encoding: "utf8" });
if (list.error) {
  console.error("Não encontrei o adb. Instale o Android Studio (SDK Platform-Tools) e tente de novo.");
  process.exit(1);
}
const devices = list.stdout.split(/\r?\n/).slice(1).map((l) => l.trim().split(/\s+/)).filter(([id, state]) => id && state === "device").map(([id]) => id);
if (!devices.length) {
  console.error("Nenhum celular ou emulador conectado. Conecte o celular com a Depuração USB ativa, ou abra um emulador no Android Studio.");
  process.exit(1);
}

const server = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.ok).catch(() => false);
if (!server) {
  console.error(`O servidor local não está rodando na porta ${port}. Em outro terminal, rode: npm run dev`);
  process.exit(1);
}

for (const id of devices) {
  const r = spawnSync(adb, ["-s", id, "reverse", `tcp:${port}`, `tcp:${port}`], { encoding: "utf8" });
  console.log(r.status === 0 ? `Túnel criado para ${id}.` : `Não consegui criar o túnel para ${id}: ${r.stderr.trim()}`);
}

const target = devices.length === 1 ? ["--target", devices[0]] : [];
// Ctrl+C reaches Capacitor too; it reverts its own changes. This process waits for it,
// then repairs anything left so the packaged app never keeps the live settings.
process.on("SIGINT", () => {});
const result = run("npx", ["cap", "run", "android", "--live-reload", "--host", "localhost", "--port", port, ...target]);
const leftovers = repairLiveReload(root);
console.log(leftovers.length ? "Atenção: " + leftovers.join(" ") : "Modo ao vivo encerrado; o projeto Android voltou ao normal.");
process.exit(result.status ?? 1);
