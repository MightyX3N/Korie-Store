// Serves a folder over http (a repository, for tests): node tests/static.mjs <dir> <port>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const [dir, port] = [path.resolve(process.argv[2] || '.'), Number(process.argv[3] || 8611)];
const types = { '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.apk': 'application/vnd.android.package-archive' };
http.createServer((req, res) => {
  const p = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log(`serving ${dir} on ${port}`));
