// Cheap protection against accidentally replacing the established online app.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const worker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
assert.match(html, /function AuthProvider\(/);
assert.match(html, /kg_chart_is_allowed/);
assert.match(html, /function QuizView\(/);
assert.match(html, /window\.supabase\.createClient/);
assert.match(html, /<script type="text\/babel">/);
assert.match(worker, /kg-chart-install-v3/);
console.log('Online source entry, auth gate, quiz UI and existing service worker are intact.');
