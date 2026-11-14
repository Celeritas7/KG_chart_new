/** Build the independent offline PWA from the ONE canonical learner UI in index.html.
 * No runtime Babel, Tailwind CDN, unpkg, Google Fonts or cross-origin converters.
 */
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { transform, build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

const root = process.cwd();
const out = path.join(root, 'dist-offline');
const assets = path.join(out, 'assets');
const rev = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const read = file => fs.readFile(path.join(root, file), 'utf8');
const write = async (file, data) => {
  const destination = path.join(out, file);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, data);
};
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

await fs.mkdir(assets, { recursive: true });
const source = await read('index.html');
const appMatch = source.match(/<script type="text\/babel">([\s\S]*?)<\/script>/);
if (!appMatch || !appMatch[1].includes('ReactDOM.createRoot')) throw Error('Canonical learner app JSX not found');

// Offline-only replacements: online source and its existing Pages deployment remain untouched.
let app = appMatch[1]
  .replace("const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);",
    "const supabase = window.KGOffline.wrapClient(window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { storageKey: 'kg-chart-offline-auth', autoRefreshToken: false, detectSessionInUrl: true, flowType: 'pkce' } }));")
  .replace("const LANG_UTILS_BASE = 'https://celeritas7.github.io/language-utils';",
    "const LANG_UTILS_BASE = './language-utils';")
  .replace('verifiedRef.current = u.id;\n        setAuthError',
    'if (window.KGOffline) await window.KGOffline.afterVerified(u);\n        verifiedRef.current = u.id;\n        setAuthError')
  .replace('await verify(session);\n          setLoading(false);\n        });',
    "try { await verify(session); } catch (error) { setAuthError(error.message || 'Offline sign-in verification failed'); }\n          setLoading(false);\n        }).catch(error => { setAuthError(error.message || 'Could not open login'); setLoading(false); });")
  .replace("const [activeView, setActiveView] = useState(() => loadFromStorage(STORAGE_KEYS.view, 'chart'));",
    "const [activeView, setActiveView] = useState(() => loadFromStorage(STORAGE_KEYS.view, 'chart'));\n      useEffect(() => window.KGOffline.setQuizBusy(activeView === 'quiz'), [activeView]);")
  .replace(/<PictureDownloads vocabulary=\{vocabulary\} loading=\{loadingVocab \|\| !priv\.loaded\} \/>/,
    '<div className="kg-offline-legacy-image-panel-replaced" />')
  .replace('ReactDOM.createRoot(document.getElementById(\'root\')).render(<App />);',
    "window.KGOffline.ready.then(() => ReactDOM.createRoot(document.getElementById('root')).render(<App />)).catch(e => window.KGOffline.fatal(e));");
if (!app.includes('KGOffline.ready.then') || !app.includes('kg-offline-legacy') || !app.includes('afterVerified(u)')) throw Error('Offline app patch did not match upstream; review changes');
app = (await transform(app, { loader: 'jsx', jsx: 'transform', target: 'es2020', minify: false })).code;
await write('assets/app.js', app);

let html = source
  .replace('<title>KG Chart - Multi-Language Vocabulary Learning</title>', '<title>KG Chart Offline</title>')
  .replace('<link rel="manifest" href="./manifest.webmanifest">', '<link rel="manifest" href="./manifest.webmanifest">')
  .replace(/<link rel="apple-touch-icon" sizes="180x180" href="data:image\/png;base64,[^"]+">/, '<link rel="apple-touch-icon" href="./icons/apple-touch-icon.png">')
  .replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/, '<link rel="stylesheet" href="./assets/app.css">')
  .replace('<link rel="stylesheet" href="./assets/app.css">', '<link rel="stylesheet" href="./assets/app.css"><link rel="stylesheet" href="./assets/offline.css">')
  .replace(/<script src="https:\/\/unpkg\.com\/react@18\/umd\/react\.production\.min\.js"><\/script>/, '<script src="./assets/react.production.min.js"></script>')
  .replace(/<script src="https:\/\/unpkg\.com\/react-dom@18\/umd\/react-dom\.production\.min\.js"><\/script>/, '<script src="./assets/react-dom.production.min.js"></script>')
  .replace(/<script src="https:\/\/unpkg\.com\/@babel\/standalone\/babel\.min\.js"><\/script>/, '')
  .replace(/<script src="https:\/\/unpkg\.com\/@supabase\/supabase-js@2"><\/script>/, '<script src="./assets/supabase.js"></script>')
  .replace(/<script src="\.\/js\/image-downloads\.js"><\/script>/, '<script src="./js/offline-runtime.js"></script>')
  .replace(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">/, '')
  .replace(/<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>/, '')
  .replace(/<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^>]+>/, '<link rel="stylesheet" href="./assets/fonts.css">')
  .replace(/\s*<script>\s*tailwind\.config = [\s\S]*?<\/script>/, '')
  .replace(appMatch[0], '<script src="./assets/app.js"></script>')
  .replace('<script src="./js/install.js"></script>', '<script src="./js/offline-install.js"></script>')
  .replace('<div id="root"></div>', '<div id="kg-offline-panel" aria-live="polite"></div><div id="root"><p class="kg-offline-start">Opening your saved KG Chart…</p></div>');
if (/https:\/\/(unpkg\.com|cdn\.tailwindcss\.com|fonts\.googleapis\.com)/.test(html)) throw Error('Offline HTML still has a runtime CDN');
await write('index.html', html);

// Supabase is bundled here to prevent the online global SDK dependency at offline startup.
await build({ stdin: { contents: "import { createClient } from '@supabase/supabase-js'; window.supabase = { createClient };", resolveDir: root, sourcefile: 'supabase-entry.js' },
  outfile: path.join(assets, 'supabase.js'), platform: 'browser', format: 'iife', bundle: true, minify: true, target: 'es2020' });
for (const [from, to] of [
  ['node_modules/react/umd/react.production.min.js', 'assets/react.production.min.js'],
  ['node_modules/react-dom/umd/react-dom.production.min.js', 'assets/react-dom.production.min.js'],
  ['js/image-store.js', 'js/image-store.js'], ['js/kg-audio.js', 'js/kg-audio.js'],
  ['js/kg-shared.js', 'js/kg-shared.js'],
  ['offline/runtime.js', 'js/offline-runtime.js'], ['offline/install.js', 'js/offline-install.js'],
  ['offline/offline.css', 'assets/offline.css'],
  ['icons/kg-brand.svg', 'icons/kg-brand.svg'],
  ['icons/icon-192.png', 'icons/icon-192.png'], ['icons/apple-touch-icon.png', 'icons/apple-touch-icon.png'],
]) await write(to, await fs.readFile(path.join(root, from)));
await write('sw.js', (await read('offline/sw.js')).replaceAll('APP_REVISION', rev));

// Install the converter source locally as an explicit build input, not a runtime fetch.
const converterDir = path.join(root, 'offline', 'language-utils');
const converters = ['burmese', 'chinese', 'sinhala', 'telugu', 'tamil', 'korean', 'thai', 'malay', 'marathi', 'kannada'];
for (const name of converters) await write(`language-utils/${name}.js`, await fs.readFile(path.join(converterDir, `${name}.js`)));

// Tailwind v3 is compiled against the SAME canonical index.html, including all quiz screens.
const css = await postcss([tailwindcss({ content: [{ raw: source, extension: 'html' }], theme: {
  extend: { colors: { jade: { 50: '#f0fdf6', 100: '#dcfce9', 200: '#bbf7d4', 300: '#86efb0', 400: '#4ade83',
    500: '#22c55e', 600: '#16a34a', 700: '#15803d', 800: '#166534', 900: '#14532d' } },
    fontFamily: { display: ['Playfair Display','serif'], body: ['DM Sans','sans-serif'], burmese: ['Noto Sans Myanmar','Padauk','sans-serif'],
      devanagari: ['Noto Sans Devanagari','sans-serif'], japanese: ['Noto Sans JP','sans-serif'], chinese: ['Noto Sans SC','sans-serif'],
      sinhala: ['Noto Sans Sinhala','sans-serif'], tamil: ['Noto Sans Tamil','sans-serif'], korean: ['Noto Sans KR','sans-serif'],
      thai: ['Noto Sans Thai','sans-serif'], kannada: ['Noto Sans Kannada','sans-serif'], telugu: ['Noto Sans Telugu','sans-serif'] } } }
})]).process('@tailwind base; @tailwind components; @tailwind utilities;', { from: undefined });
await write('assets/app.css', css.css);

// Ship matching local fonts: only modern WOFF2 files of the regular weight are included.
const fonts = [
  ['dm-sans','DM Sans'], ['playfair-display','Playfair Display'], ['noto-sans-myanmar','Noto Sans Myanmar'],
  ['noto-sans-devanagari','Noto Sans Devanagari'], ['noto-sans-jp','Noto Sans JP'], ['noto-sans-sc','Noto Sans SC'],
  ['noto-sans-kr','Noto Sans KR'], ['noto-sans-tamil','Noto Sans Tamil'], ['noto-sans-thai','Noto Sans Thai'],
  ['noto-sans-sinhala','Noto Sans Sinhala'], ['noto-sans-kannada','Noto Sans Kannada'], ['noto-sans-telugu','Noto Sans Telugu'],
];
const declarations = [];
for (const [pkg, family] of fonts) {
  const folder = path.join(root, 'node_modules', '@fontsource', pkg, 'files');
  const filenames = (await fs.readdir(folder)).filter(n => /-400-normal\.woff2$/.test(n));
  for (const filename of filenames) {
    await write(`assets/fonts/${filename}`, await fs.readFile(path.join(folder, filename)));
  }
  // Preserve each @font-face unicode-range. Especially critical for fragmented CJK fonts.
  const original = await fs.readFile(path.join(root, 'node_modules', '@fontsource', pkg, '400.css'), 'utf8');
  const local = original.replace(/url\(\.\/files\/([^\)]+\.woff2)\) format\('woff2'\), url\(\.\/files\/[^\)]+\.woff\) format\('woff'\)/g,
    "url('./fonts/$1') format('woff2')");
  if(local.includes('./files/')) throw Error(`Font URLs were not localized: ${family}`);
  declarations.push(local);
}
await write('assets/fonts.css', declarations.join('\n'));

const manifest = JSON.parse(await read('offline/manifest.webmanifest'));
manifest.version = rev;
await write('manifest.webmanifest', JSON.stringify(manifest));
const files = (await walk(out)).map(p => p.slice(out.length + 1)).sort();
const shellFiles = files.filter(f => f !== 'shell-manifest.json' && f !== 'offline-build.json');
const shell = { version: rev, files: shellFiles.map(p => ({ path: p, sha256: sha(readFileSync(path.join(out, p))) })) };
await write('shell-manifest.json', JSON.stringify(shell));
await write('offline-build.json', JSON.stringify({ appVersion: rev, source: 'index.html', schemaVersion: 1, generatedAt: new Date().toISOString() }));
console.log(`Built KG Chart Offline ${rev}: ${shellFiles.length} local assets`);

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const rows = await Promise.all(entries.map(async e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  return rows.flat();
}
