import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { chromium } from 'playwright-core';

const browserPath = process.env.KG_CHROMIUM || chromium.executablePath();
const root = resolve('offline-dist');
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png'
};

test('cold launch from installed local shell without network', { timeout: 120000 }, async t => {
  try { await access(browserPath); } catch {
    if (process.env.KG_EXPECT_BROWSER) throw new Error('CI requires a Playwright Chromium installation');
    t.skip('Playwright Chromium is not installed in this environment'); return;
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(path);
      res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream',
        'cache-control': 'no-store' }).end(body);
    } catch { res.writeHead(404).end('Not found'); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: browserPath, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  } catch (error) {
    if (!process.env.KG_EXPECT_BROWSER && /socket\(\) failed: Operation not permitted/.test(String(error))) {
      t.skip('Managed container denies Chromium Unix sockets; browser test not executed');
      return;
    }
    throw error;
  }
  t.after(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg?.active) return false;
    const names = await caches.keys();
    const name = names.find(x => x.startsWith('kg-chart-offline-shell-'));
    return name && (await (await caches.open(name)).keys()).length > 800;
  }, null, { timeout: 100000 });
  await context.setOffline(true);
  const started = Date.now();
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.getByRole('heading', { name: 'Connect to finish setup' }).waitFor({ timeout: 5000 });
  assert.ok(Date.now() - started < 10000, 'Offline shell should not wait for network');
  const banner = await page.locator('aside[role=note]').textContent();
  assert.match(banner, /offline lessons.*not ready/i);
  const saved = await page.evaluate(async () => {
    const name = (await caches.keys()).find(x => x.startsWith('kg-chart-offline-shell-'));
    return (await (await caches.open(name)).keys()).length;
  });
  assert.ok(saved > 800, 'Local static files remain cached');
});
