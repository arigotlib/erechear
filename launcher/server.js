'use strict';
/*
 * Erechear launcher: serves ./www on a local port, opens the game in its own
 * app window (Chrome / Edge), and shuts itself down when that window closes.
 * Started hidden by "התחל משחק" (start-hidden.vbs). No dependencies.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, exec } = require('child_process');

const ROOT = path.join(__dirname, '..', 'www');
const PORT = 8777;                          // fixed, so saved names/settings persist between launches
const URL = `http://127.0.0.1:${PORT}/`;
const PROFILE = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'erechear-game-window');
const LOG = path.join(os.tmpdir(), 'erechear-launcher.log');

const log = msg => { try { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch (e) { /* ignore */ } };
process.on('uncaughtException', e => { log('crash: ' + (e && e.stack || e)); process.exit(1); });

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon'
};

/* ---------- lifetime: window process exit (primary) + page heartbeat (fallback) ---------- */
let byeTimer = null, lastPing = Date.now(), watchByProcess = false;
function shutdown(why) {
  log('shutdown: ' + why);
  try { server.close(); } catch (e) { /* ignore */ }
  setTimeout(() => process.exit(0), 200);
}
setInterval(() => {
  // no sign of life from any game page for 10 minutes -> stop (covers crashes / default-browser mode)
  if (!watchByProcess && Date.now() - lastPing > 10 * 60 * 1000) shutdown('no heartbeat');
}, 30 * 1000);

/* ---------- static server ---------- */
const server = http.createServer((req, res) => {
  let u;
  try { u = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
  if (u === '/__ping') { lastPing = Date.now(); clearTimeout(byeTimer); res.writeHead(204); return res.end(); }
  if (u === '/__bye') {
    // page closed or reloading; if no page pings back soon, the game was closed
    clearTimeout(byeTimer);
    if (!watchByProcess) byeTimer = setTimeout(() => shutdown('page closed'), 8000);
    res.writeHead(204); return res.end();
  }
  let file = path.normalize(path.join(ROOT, u));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (u.endsWith('/')) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

/* ---------- open the game window ---------- */
function findBrowser() {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  return [
    path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(local, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe')
  ].find(p => p && fs.existsSync(p));
}

function openWindow(ownsServer) {
  const exe = findBrowser();
  if (!exe) {
    log('no chrome/edge found, using default browser');
    exec(`start "" "${URL}"`);
    return;
  }
  const child = spawn(exe, [
    `--app=${URL}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--disable-sync',
    '--window-size=640,900'
  ], { stdio: 'ignore', windowsHide: false });
  if (!ownsServer) return;
  watchByProcess = true;
  const started = Date.now();
  child.on('exit', code => {
    // if the browser handed off to an already-running window, fall back to the heartbeat
    if (Date.now() - started < 4000) { watchByProcess = false; log('browser handed off (exit ' + code + ')'); return; }
    shutdown('window closed');
  });
  child.on('error', e => { watchByProcess = false; log('spawn error: ' + e.message); exec(`start "" "${URL}"`); });
}

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    // the game is already running: just open another window to it
    log('already running, opening a window');
    openWindow(false);
    setTimeout(() => process.exit(0), 3000);
  } else { log('server error: ' + e.message); process.exit(1); }
});
server.listen(PORT, '127.0.0.1', () => { log('serving ' + URL); openWindow(true); });
