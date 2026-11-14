import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const dir = resolve('offline-dist');
const read = file => readFile(join(dir, file), 'utf8');

test('distinct offline edition identity and non-production label', async () => {
  const data = JSON.parse(await read('manifest.webmanifest'));
  const version = JSON.parse(await read('version.json'));
  assert.equal(data.name, 'KG Chart Offline');
  assert.equal(data.id, '/kg-chart-offline');
  assert.equal(version.offlineLessonsReady, false);
  assert.equal(version.contentPackVersion, null);
});

test('every static shell file is present and matches the build hash', async () => {
  const manifest = JSON.parse(await read('static-manifest.json'));
  assert.ok(manifest.files.length > 20, 'Expected bundled code and Unicode fonts');
  for (const item of manifest.files) {
    const data = await readFile(join(dir, item.path));
    assert.equal(data.length, item.bytes, item.path);
    assert.equal(createHash('sha256').update(data).digest('hex'), item.sha256, item.path);
  }
});

test('shell is cache-first, complete-at-install, and never forces an update', async () => {
  const worker = await read('sw.js');
  assert.match(worker, /cache\.addAll\(SHELL_FILES\)/);
  assert.match(worker, /cache\.match\(SHELL_URL\)/);
  assert.doesNotMatch(worker, /\bskipWaiting\(/);
  const entries = JSON.parse(worker.match(/const SHELL_FILES = (\[[^;]*\]);/)[1]);
  assert.ok(entries.includes('./index.html'));
  assert.ok(entries.includes('./vendor.js'));
  assert.ok(entries.includes('./fonts.css'));
  assert.ok(entries.includes('./converters/burmese.js'));
  assert.ok(entries.includes('./static-manifest.json'));
});

test('offline startup has no CDN or online converter script dependencies', async () => {
  const html = await read('index.html');
  const js = await read('app.js');
  assert.doesNotMatch(html, /<(?:script|link)\b[^>]+(?:src|href)="https:\/\//);
  assert.doesNotMatch(js, /const LANG_UTILS_BASE = 'https:\/\//);
  assert.match(js, /converters/);
  assert.match(html, /development preview/);
  const files = await readdir(join(dir, 'fonts'));
  assert.ok(files.some(name => name.endsWith('.woff2')));
});
