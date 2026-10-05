// Tiny static file server for KG Chart. Started by run-kg-chart.bat.
// Usage: node kg-serve.js [port] [--open]
const http = require('http'), fs = require('fs'), path = require('path'), { exec } = require('child_process');
const root = process.cwd(), port = Number(process.argv[2]) || 8142, open = process.argv.includes('--open');
const url = 'http://localhost:' + port + '/';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4' };
const handler = (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) { res.writeHead(301, { Location: p + '/' }); return res.end(); }
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found: ' + p); }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
};
// Listen on IPv4 AND IPv6 loopback. Windows resolves "localhost" to ::1 first;
// with IPv4 only, every connection stalls ~2s before falling back.
http.createServer(handler).listen(port, '127.0.0.1', () => {
  console.log('Serving ' + root + ' at ' + url);
  if (open) exec(process.platform === 'win32' ? 'start "" "' + url + '"' : (process.platform === 'darwin' ? 'open ' : 'xdg-open ') + url);
}).on('error', e => { console.error(e.code === 'EADDRINUSE' ? 'Port ' + port + ' is already in use.' : e.message); process.exit(1); });
http.createServer(handler).listen(port, '::1').on('error', () => {});
