import { readFile, writeFile, mkdir, readdir, copyFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

// Derive only the logout UI from the published package. The full source build
// contains a separate scheduling migration that is not approved for release.
const baseline = ".local/vercel/clara-visual-only-20261006";
const target = ".local/vercel/clara-logout-fixed-sidebar-20261007";
const jsOldName = "index-clara-64ae4532b705e8db.js";
const cssOldName = "index-clara-1b9c0b1664739869.css";
const hash = value => createHash("sha256").update(value).digest("hex");
const jsOld = await readFile(join(baseline, "assets", jsOldName), "utf8");
const cssOld = await readFile(join(baseline, "assets", cssOldName), "utf8");
const htmlOld = await readFile(join(baseline, "index.html"), "utf8");
assert.equal(hash(jsOld).slice(0, 16), "64ae4532b705e8db", "Unexpected baseline JS");
assert.equal(hash(cssOld).slice(0, 16), "1b9c0b1664739869", "Unexpected baseline CSS");

const oldButton = '(0,c.jsx)(`button`,{className:`icon-button`,"aria-label":t?`Sair da demonstração`:`Sair da conta`,onClick:()=>{t?On(`/`):_(h.auth.signOut()).catch(e=>r(p(e),!0))},children:(0,c.jsx)(Ve,{size:17})})';
const action = 'onClick:()=>{t?On(`/`):_(h.auth.signOut()).catch(e=>r(p(e),!0))}';
const newButton = text => '(0,c.jsxs)(`button`,{type:`button`,className:`account-exit`,"aria-label":t?`Sair da demonstração`:`Sair da conta`,title:t?`Sair da demonstração`:`Sair da conta`,' + action + ',children:[(0,c.jsx)(Ve,{size:17}),(0,c.jsx)(`span`,{children:' + text + '})]})';
const sidebarButton = newButton('t?`Sair da demonstração`:`Sair da conta`');
const headerButton = newButton('`Sair`');
const headerEnd = 'children:(0,c.jsx)(rt,{size:16})}),(0,c.jsx)(Pn,{name:u.professional})]})]})';
const headerNew = headerEnd.replace(']})]})', ',' + headerButton + ']})]})');
assert.equal(jsOld.split(oldButton).length, 2, "Expected one existing logout button");
assert.equal(jsOld.split(headerEnd).length, 2, "Expected one header action group");
const js = jsOld.replace(oldButton, sidebarButton).replace(headerEnd, headerNew);
assert.equal(js.replace(sidebarButton, oldButton).replace(headerNew, headerEnd), jsOld, "Unexpected change outside logout UI");
assert.ok(!js.includes("owner_available_slots"), "Unapproved scheduling code included");
const css = cssOld + "\n" + await readFile("src/account-exit.css", "utf8");
const jsName = "index-clara-" + hash(js).slice(0, 16) + ".js";
const cssName = "index-clara-" + hash(css).slice(0, 16) + ".css";
const html = htmlOld.replace(jsOldName, jsName).replace(cssOldName, cssName);
await mkdir(target);
await mkdir(join(target, "assets"));
for (const directory of ["", "assets"]) {
  for (const entry of await readdir(join(baseline, directory), { withFileTypes: true })) {
    if (entry.isDirectory() && directory === "" && entry.name === "assets") continue;
    assert.ok(entry.isFile(), "Unexpected entry in production package");
    if ([jsOldName, cssOldName, "index.html"].includes(entry.name)) continue;
    await copyFile(join(baseline, directory, entry.name), join(target, directory, entry.name));
  }
}
await writeFile(join(target, "assets", jsName), js);
await writeFile(join(target, "assets", cssName), css);
await writeFile(join(target, "index.html"), html);
const files = [];
for (const directory of ["", "assets"]) {
  for (const entry of await readdir(join(target, directory), { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(target, directory, entry.name);
    const content = await readFile(path);
    files.push({ file: relative(target, path).replaceAll("\\", "/"), bytes: content.length, sha256: hash(content) });
  }
}
await writeFile(target + ".manifest.json", JSON.stringify({ baseline, target, published: false, scope: "Visible logout buttons and fixed desktop sidebar without internal scrolling", jsName, cssName, files }, null, 2));
console.log(JSON.stringify({ target, jsName, cssName, files: files.length }));
