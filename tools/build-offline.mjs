// Builds an isolated PWA from the exact same index.html and quiz code as the
// online edition. This is a preview shell, NOT a claim of offline lessons/sync.
import { readFile, writeFile, mkdir, rm, readdir, copyFile, stat } from 'node:fs/promises';
import { resolve, join, relative, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { build, transform } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = join(root, 'offline-dist');
if (basename(out) !== 'offline-dist') throw new Error('Unexpected build target');
const input = await readFile(join(root, 'index.html'), 'utf8');
const babel = /<script type="text\/babel">([\s\S]*?)<\/script>/;
const appMatch = input.match(babel);
const tailwindScript = /<script>\s*tailwind\.config\s*=[\s\S]*?<\/script>/;
const twMatch = input.match(tailwindScript);
if (!appMatch || !twMatch) throw new Error('Upstream HTML changed: review the build adapter');
if (!input.includes('const supabase = window.supabase.createClient(')) {
  throw new Error('Supabase initialization changed: review offline auth before shipping');
}

await rm(out, { recursive: true, force: true }); // Generated directory only.
await mkdir(out, { recursive: true });
const app = await transform(appMatch[1].replace(
  "const LANG_UTILS_BASE = 'https://celeritas7.github.io/language-utils'",
  "const LANG_UTILS_BASE = './converters'"
), { loader: 'jsx', jsx: 'transform', jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment', target: 'es2020', legalComments: 'none' });
await writeFile(join(out, 'app.js'), app.code);

await build({ entryPoints: [join(root, 'offline/vendor-entry.mjs')], bundle: true,
  format: 'iife', platform: 'browser', target: 'es2020',
  outfile: join(out, 'vendor.js'), minify: true, legalComments: 'none' });
await build({ entryPoints: [join(root, 'offline/fonts.css')], bundle: true,
  outfile: join(out, 'fonts.css'), loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' },
  assetNames: 'fonts/[name]-[hash]', logLevel: 'warning' });

const tailwind = { config: null };
vm.runInNewContext(twMatch[0].replace(/<script>|<\/script>/g, ''), { tailwind }, { timeout: 1000 });
if (!tailwind.config?.theme) throw new Error('Tailwind config could not be extracted');
const compiledCSS = await postcss([tailwindcss({
  ...tailwind.config, content: [{ raw: input, extension: 'html' }],
})]).process('@tailwind base; @tailwind components; @tailwind utilities;', { from: undefined });
await writeFile(join(out, 'styles.css'), compiledCSS.css);

let html = input.replace(babel, '<!-- Compiled from the shared online source into app.js -->')
  .replace(tailwindScript, '')
  .replace(/\s*<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/, '')
  .replace(/\s*<script src="https:\/\/unpkg\.com\/[^"]+"><\/script>/g, '')
  .replace(/\s*<link rel="preconnect" href="https:\/\/fonts\.[^"]+"[^>]*>/g, '')
  .replace(/\s*<link href="https:\/\/fonts\.googleapis\.com[^>]+>/g, '')
  .replace(/\s*<script src="\.\/js\/image-store\.js"><\/script>/, '')
  .replace(/\s*<script src="\.\/js\/image-downloads\.js"><\/script>/, '')
  .replace(/<script src="\.\/js\/kg-audio\.js"><\/script>/, '<script defer src="./kg-audio.js"></script>')
  .replace(/<script src="\.\/js\/kg-shared\.js"><\/script>/, '<script defer src="./kg-shared.js"></script>')
  .replace(/<script src="\.\/js\/install\.js"><\/script>/, '<script defer src="./boot.js"></script><script defer src="./install.js"></script>')
  .replace('<link rel="manifest" href="./manifest.webmanifest">',
    '<link rel="manifest" href="./manifest.webmanifest">\n  <link rel="stylesheet" href="./styles.css">\n  <link rel="stylesheet" href="./fonts.css">\n  <script defer src="./vendor.js"></script>')
  .replace('<title>KG Chart - Multi-Language Vocabulary Learning</title>',
    '<title>KG Chart Offline — preview</title>')
  .replace('href="icons/kg-brand.svg?v=2"', 'href="icons/kg-brand.svg"')
  .replace('<div id="root"></div>', `<section id="kg-boot-status" role="status" style="font:16px system-ui,sans-serif;max-width:650px;margin:12vh auto;padding:28px;border-radius:18px;background:#ecfdf5;color:#14532d">
    <h1 style="font-size:24px;font-weight:700">Preparing KG Chart Offline</h1>
    <p>This preview still needs an internet connection to load lessons and save progress.</p>
    <button id="kg-boot-retry" type="button" style="padding:10px 18px;background:#15803d;color:white;border-radius:9px;margin-top:12px">Retry</button>
  </section>
  <aside role="note" style="padding:7px 14px;text-align:center;background:#fef3c7;color:#92400e;font:13px system-ui,sans-serif">KG Chart Offline — development preview. Offline lessons, account unlock and sync are not ready yet.</aside>
  <div id="root"></div>`);
if (/<(script|link)\b[^>]+(?:src|href)="https:\/\/(?:cdn\.tailwindcss|unpkg|fonts\.googleapis|fonts\.gstatic)/.test(html)) {
  throw new Error('Unexpected external startup dependency in generated HTML');
}
await writeFile(join(out, 'index.html'), html);

for (const [src, dest] of [
  ['js/kg-audio.js', 'kg-audio.js'],
  ['js/kg-shared.js', 'kg-shared.js'],
  ['offline/boot.js', 'boot.js'],
  ['offline/offline.html', 'offline.html'],
  ['icons/icon-192.png', 'icons/icon-192.png'],
  ['icons/apple-touch-icon.png', 'icons/apple-touch-icon.png'],
  ['icons/kg-brand.svg', 'icons/kg-brand.svg'],
]) {
  await mkdir(join(out, dest, '..'), { recursive: true });
  await copyFile(join(root, src), join(out, dest));
}
await mkdir(join(out, 'converters'), { recursive: true });
const converterNames = ['burmese','chinese','sinhala','telugu','tamil','korean','thai','malay','marathi','kannada'];
for (const name of converterNames) await copyFile(
  join(root, 'offline/converters', name + '.js'), join(out, 'converters', name + '.js')
);

const install = (await readFile(join(root, 'js/install.js'), 'utf8'))
  .replace('Install KG Chart', 'Install KG Chart Offline');
await writeFile(join(out, 'install.js'), install);
await writeFile(join(out, 'manifest.webmanifest'), JSON.stringify({
  id: '/kg-chart-offline', name: 'KG Chart Offline', short_name: 'KG Offline',
  start_url: './', scope: './', display: 'standalone', background_color: '#ffffff',
  theme_color: '#008878', icons: [
    { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: './icons/kg-brand.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
  ]
}, null, 2));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const revision = createHash('sha256').update(input).update(
  await readFile(join(root, 'offline/converters/burmese.js'))
).digest('hex').slice(0, 12);
await writeFile(join(out, 'version.json'), JSON.stringify({
  edition: 'offline-preview', appVersion: '0.1.0-preview', sourceRevision: commit,
  buildRevision: revision, contentPackVersion: null, localDataSchema: 0,
  offlineLessonsReady: false
}, null, 2));

async function walk(folder) {
  const results = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) results.push(...await walk(path));
    else results.push(path);
  }
  return results;
}
const files = (await walk(out)).map(path => relative(out, path).split(sep).join('/')).sort();
const assets = [];
for (const name of files) {
  const data = await readFile(join(out, name));
  assets.push({ path: name, bytes: data.byteLength, sha256: createHash('sha256').update(data).digest('hex') });
}
await writeFile(join(out, 'static-manifest.json'), JSON.stringify({ revision, files: assets }, null, 2));
const shellFiles = [...files, 'static-manifest.json'].map(p => './' + p);
const sw = (await readFile(join(root, 'offline/sw-template.js'), 'utf8'))
  .replace('__SHELL_CACHE__', 'kg-chart-offline-shell-' + revision)
  .replace('__SHELL_FILES__', JSON.stringify(shellFiles));
await writeFile(join(out, 'sw.js'), sw);
console.log(`Built KG Chart Offline preview: ${assets.length + 2} static files, source ${commit.slice(0, 12)}`);
console.log('This build includes NO offline lesson packs or progress synchronization.');
