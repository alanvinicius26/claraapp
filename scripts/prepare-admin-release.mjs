import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  copyFile,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { parseAst } from "rolldown/parseAst";
import { build } from "vite";

// Isolated release: preserve the published appointment implementation and all
// existing assets. Only replace Subscription and add the admin route/menu.
const releaseId = process.argv[2] || "20261008-admin-v1";
assert.match(releaseId, /^[a-z0-9-]+$/);
const baseline = ".local/vercel/clara-billing-production-20261008-polling-v1";
const target = `.local/vercel/clara-admin-${releaseId}`;
const oldMain = "clara-base-20261008-polling-v1.js";
const mainName = `clara-admin-base-${releaseId}.js`;
const original = await readFile(join(baseline, "assets", oldMain), "utf8");
const ast = parseAst(original);
const byName = (name) =>
  ast.body.find((n) => n.type === "FunctionDeclaration" && n.id.name === name);
assert.ok(
  original.includes(
    "export {h as supabase,g as rpc,_ as query,p as errorMessage,m as apiFetch",
  ),
);
assert.ok(
  !original.includes("owner_available_slots"),
  "Unexpected scheduling changes in baseline",
);
const app = byName("In"),
  dashboard = byName("Bn"),
  subscription = byName("C");
assert.ok(app && dashboard && subscription);
assert.equal(
  original.slice(subscription.start, subscription.end),
  "function C(props){return (0,c.jsx)(NewSubscription,props)}",
);
const appSource = original.slice(app.start, app.end);
const route = "(0,c.jsx)(Bn,{session:t,path:e,notify:v},t.user.id)";
assert.equal(appSource.split(route).length, 2);
let navChildren;
function visit(node) {
  if (!node || typeof node !== "object") return;
  if (
    node.type === "CallExpression" &&
    node.arguments?.[0]?.type === "TemplateLiteral" &&
    node.arguments[0].quasis[0]?.value.raw === "nav"
  ) {
    const children = node.arguments[1]?.properties?.find(
      (p) => p.key?.name === "children",
    );
    if (
      children &&
      original
        .slice(children.value.start, children.value.end)
        .startsWith("zn.map(")
    )
      navChildren = children.value;
  }
  for (const child of Object.values(node))
    if (Array.isArray(child)) child.forEach(visit);
    else if (child && typeof child === "object") visit(child);
}
visit(dashboard);
assert.ok(navChildren);
const replacements = [
  {
    start: subscription.start,
    end: subscription.end,
    replacement: "function C(props){return (0,c.jsx)(AdminSubscription,props)}",
  },
  {
    start: app.start,
    end: app.end,
    replacement: appSource.replace(
      route,
      "e===`/admin`?(0,c.jsx)(AdminPanel,{notify:v},t.user.id):" + route,
    ),
  },
  {
    start: navChildren.start,
    end: navChildren.end,
    replacement:
      "[" +
      original.slice(navChildren.start, navChildren.end) +
      ",!t&&(0,c.jsx)(AdminNavigation,{},`platform-admin`)]",
  },
];
let main = original;
for (const r of [...replacements].sort((a, b) => b.start - a.start))
  main = main.slice(0, r.start) + r.replacement + main.slice(r.end);
let restored = main;
for (const r of replacements)
  restored = restored.replace(r.replacement, original.slice(r.start, r.end));
assert.equal(
  restored,
  original,
  "Unexpected changes outside admin routing/menu and Subscription",
);
const sources = {
  "\0admin-entry": `export {default as AdminPanel,AdminLink as AdminNavigation} from ${JSON.stringify(resolve("src/Admin.jsx"))}; export {default as AdminSubscription} from ${JSON.stringify(resolve("src/Subscription.jsx"))};`,
  "\0admin-react": `import {r as requireReact} from './react-FpO-Qvof.js'; const React=requireReact(); export default React; export const {useState,useEffect,useRef,useMemo,useCallback,useId,useLayoutEffect,useContext,createContext,createElement,forwardRef,memo,Fragment,Component}=React;`,
  "\0admin-jsx": `import {n as requireJsx} from './react-FpO-Qvof.js'; const runtime=requireJsx(); export const {jsx,jsxs,Fragment}=runtime;`,
  "\0admin-lib": `export {supabase,query,rpc,errorMessage,apiFetch} from 'admin-existing';`,
  "\0admin-brand": `export {Brand as default,BrandMark} from 'admin-existing';`,
};
await mkdir(target, { recursive: false });
const result = await build({
  configFile: false,
  publicDir: false,
  logLevel: "error",
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
      "https://gtqcehwvddvqllicnreu.supabase.co",
    ),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
      "sb_publishable_LNIhSp1x9e-xsPUV8dWMZw_gzxhswD-",
    ),
  },
  plugins: [
    {
      name: "isolated-admin-release",
      enforce: "pre",
      resolveId(id) {
        if (id === "admin-existing")
          return { id: "./" + mainName, external: true };
        if (id === "./react-FpO-Qvof.js") return { id, external: true };
        return {
          "admin-entry": "\0admin-entry",
          react: "\0admin-react",
          "react/jsx-runtime": "\0admin-jsx",
          "./lib": "\0admin-lib",
          "./Brand": "\0admin-brand",
        }[id];
      },
      load(id) {
        return sources[id];
      },
    },
  ],
  build: {
    outDir: target,
    emptyOutDir: false,
    minify: true,
    cssCodeSplit: false,
    rolldownOptions: {
      input: "admin-entry",
      preserveEntrySignatures: "strict",
      output: {
        entryFileNames: "assets/clara-admin-[hash].js",
        assetFileNames: "assets/admin-[name]-[hash][extname]",
      },
    },
  },
});
const entry = result.output.find((o) => o.type === "chunk" && o.isEntry);
assert.ok(
  entry.exports.includes("AdminPanel") &&
    entry.exports.includes("AdminSubscription"),
);
main =
  `import {AdminPanel,AdminNavigation,AdminSubscription} from './${entry.fileName.split("/").pop()}';\n` +
  main;
parseAst(main);
for (const directory of ["", "assets"])
  for (const file of await readdir(join(baseline, directory), {
    withFileTypes: true,
  })) {
    if (!file.isFile() || [oldMain, "index.html"].includes(file.name)) continue;
    // The old features chunk imports the original main filename. Preserve that
    // module identity via a re-export shim, so only one Supabase client is created.
    await copyFile(
      join(baseline, directory, file.name),
      join(target, directory, file.name),
    );
  }
await writeFile(
  join(target, "assets", oldMain),
  `export * from './${mainName}';\n`,
);
await writeFile(join(target, "assets", mainName), main);
const css = result.output.filter(
  (o) => o.type === "asset" && o.fileName.endsWith(".css"),
);
let html = (await readFile(join(baseline, "index.html"), "utf8")).replace(
  oldMain,
  mainName,
);
html = html.replace(
  "</head>",
  css.map((o) => `<link rel="stylesheet" href="/${o.fileName}">`).join("") +
    "</head>",
);
await writeFile(join(target, "index.html"), html);
const hash = (x) => createHash("sha256").update(x).digest("hex");
const files = [];
for (const directory of ["", "assets"])
  for (const file of await readdir(join(target, directory), {
    withFileTypes: true,
  })) {
    if (!file.isFile()) continue;
    const data = await readFile(join(target, directory, file.name));
    files.push({
      file: join(directory, file.name).replaceAll("\\", "/"),
      bytes: data.length,
      sha256: hash(data),
    });
  }
await writeFile(
  target + ".manifest.json",
  JSON.stringify(
    {
      baseline,
      target,
      sourceMainSha256: hash(original),
      scope: [
        "Admin route/menu",
        "Admin account access and coupons",
        "Subscription benefits and coupon guidance",
      ],
      schedulingChanged: false,
      files,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ target, files: files.length, schedulingChanged: false }),
);
