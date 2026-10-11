import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// Keep the production scheduling behavior. The current source build also
// contains an independent database migration that was not approved for release.
const baseline = '.local/vercel/clara-production-live-20261006';
const target = '.local/vercel/clara-visual-only-20261006';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const oldJsName = 'index-DOfl8Qe2.js';
const oldCssName = 'index-_sckkqTA.css';
const oldLogoName = 'clara-logo-v1-BDARFn35.webp';
const oldHtml = await readFile(join(baseline, 'index.html'), 'utf8');
const oldJs = await readFile(join(baseline, 'assets', oldJsName), 'utf8');
const oldCss = await readFile(join(baseline, 'assets', oldCssName), 'utf8');

// Verify that the saved release is still the deployed baseline before deriving it.
for (const [path, expected] of [['/index.html', oldHtml], ['/assets/' + oldJsName, oldJs], ['/assets/' + oldCssName, oldCss]]) {
  const response = await fetch('https://encaixa-eta.vercel.app' + path, { signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, path);
  assert.equal(hash(await response.text()), hash(expected), 'Production baseline changed: ' + path);
}

const logo = await readFile('src/assets/clara-logo-v2.png');
const logoName = 'clara-logo-v2-' + hash(logo).slice(0, 16) + '.png';
const oldComponent = 'function y(){return(0,c.jsx)(`svg`,{className:`brand-logo`,viewBox:`235 125 1780 490`,width:`1780`,height:`490`,role:`img`,"aria-label":`Clara Pro`,focusable:`false`,children:(0,c.jsx)(`image`,{href:v,width:`2172`,height:`724`})})}';
const newComponent = 'function y(){return(0,c.jsx)(`img`,{className:`brand-logo`,src:v,alt:`Clara`,width:`2172`,height:`724`})}';
assert.equal(oldJs.split(oldComponent).length, 2, 'Brand component must match exactly once');
assert.equal(oldJs.split('/assets/' + oldLogoName).length, 2, 'Logo URL must match exactly once');

const substitutions = [];
function removeSuffix(content, file) {
  return content.replace(/Clara Pro|Clara PRO|CLARA PRO/g, (match) => {
    const replacement = match === 'CLARA PRO' ? 'CLARA' : 'Clara';
    substitutions.push({ file, from: match, to: replacement });
    return replacement;
  });
}
const js = removeSuffix(oldJs.replace(oldComponent, newComponent).replace('/assets/' + oldLogoName, '/assets/' + logoName), 'javascript');
const css = oldCss.replaceAll('/clara-icon-v2.png', '/clara-icon-v3.png');
assert.equal(css.split('/clara-icon-v3.png').length, 3, 'Both icon masks must be replaced');
assert.ok(!js.includes('owner_available_slots'), 'Pending scheduling changes must be absent');
assert.ok(js.includes('Você cuida.') && js.includes('A Clara '), 'Original headline must be present');
assert.ok(!/clara.?pro\b/i.test(js), 'Old suffix remains');
const jsName = 'index-clara-' + hash(js).slice(0, 16) + '.js';
const cssName = 'index-clara-' + hash(css).slice(0, 16) + '.css';
const html = removeSuffix(oldHtml, 'html').replace(oldJsName, jsName).replace(oldCssName, cssName).replace('/clara-icon-v2.png', '/clara-icon-v3.png');

// mkdir fails if this immutable release directory already exists.
await mkdir(target);
await mkdir(join(target, 'assets'));
for (const entry of await readdir(join(baseline, 'assets'), { withFileTypes: true })) {
  assert.ok(entry.isFile(), 'Unexpected nested assets');
  if (![oldJsName, oldCssName, oldLogoName].includes(entry.name)) {
    await copyFile(join(baseline, 'assets', entry.name), join(target, 'assets', entry.name));
  }
}
await writeFile(join(target, 'assets', jsName), js);
await writeFile(join(target, 'assets', cssName), css);
await writeFile(join(target, 'assets', logoName), logo);
await writeFile(join(target, 'index.html'), html);
await copyFile('public/clara-icon-v3.png', join(target, 'clara-icon-v3.png'));
await copyFile(join(baseline, 'studio-portrait.png'), join(target, 'studio-portrait.png'));
const config = JSON.parse(await readFile(join(baseline, 'vercel.json'), 'utf8'));
for (const header of config.headers) if (header.source === '/clara-icon-v2.png') header.source = '/clara-icon-v3.png';
await writeFile(join(target, 'vercel.json'), JSON.stringify(config, null, 2) + '\n');

const manifest = [];
for (const dir of [target, join(target, 'assets')]) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(dir, entry.name);
    const contents = await readFile(path);
    manifest.push({ file: relative(target, path).replaceAll('\\', '/'), bytes: contents.length, sha256: hash(contents) });
  }
}
await writeFile(target + '.manifest.json', JSON.stringify({ baseline, target, substitutions, component: 'SVG frame replaced with full Clara image', unchangedBehavior: true, manifest }, null, 2));
console.log(JSON.stringify({ target, jsName, cssName, logoName, textSubstitutions: substitutions.length, files: manifest.length }));
