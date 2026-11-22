/* Test harness for the KoralPaper MCP server. Zero dependencies.

   It starts the three real parts and wires them together on test ports:
   - the MCP server (mcp/server.js) as a child process, driven over stdio;
   - the real app (index.html), served from this repo over http;
   - headless Chrome with its own throwaway profile, so the test app never
     shares storage with the KoralPaper you actually use.
   Nothing here touches port 8137 or your documents.

   © 2026 Stefanos Karagos, CAIO Group · wearecaio.com · MIT */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
function freePort(){
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}
function staticServer(port, bridgePort){
  const srv = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    if (rel === '/index.html'){
      // the page's security policy only allows the real bridge port; the test copy
      // is served with the test port in its place, the file on disk is untouched
      res.end(fs.readFileSync(file, 'utf8').replace(/(127\.0\.0\.1|localhost):8137/g, '$1:' + bridgePort));
      return;
    }
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(res => srv.listen(port, '127.0.0.1', () => res(srv)));
}

/* one MCP server process, driven over stdio */
async function spawnServer(env){
  const server = spawn(process.execPath, [path.join(ROOT, 'mcp', 'server.js')], {
    env: Object.assign({}, process.env, env),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '', nextId = 1;
  const waiting = new Map();
  server.stdout.setEncoding('utf8');
  server.stdout.on('data', d => {
    out += d;
    let nl;
    while ((nl = out.indexOf('\n')) >= 0){
      const line = out.slice(0, nl); out = out.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      const w = waiting.get(msg.id);
      if (w){ waiting.delete(msg.id); w(msg); }
    }
  });
  const rpc = (method, params) => new Promise((res, rej) => {
    const id = nextId++;
    const timer = setTimeout(() => { waiting.delete(id); rej(new Error('no answer to ' + method)); }, 120000);
    waiting.set(id, msg => { clearTimeout(timer); res(msg); });
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  /* call a tool; returns { isError, text, json, image } */
  const tool = async (name, args) => {
    const msg = await rpc('tools/call', { name, arguments: args || {} });
    const content = (msg.result && msg.result.content) || [];
    const textPart = content.find(c => c.type === 'text');
    const text = textPart ? textPart.text : '';
    let json = null;
    try { json = JSON.parse(text); } catch (e){}
    return { isError: !!(msg.result && msg.result.isError), text, json, image: content.find(c => c.type === 'image') || null };
  };
  await rpc('initialize', { protocolVersion: '2024-11-05' });
  return { server, rpc, tool, kill: () => server.kill() };
}

/* opts.file: open the app straight from disk (file://), the way it is used when
   index.html is double-clicked. A copy is made so its bridge port can be the test one. */
async function start(opts = {}){
  const bridgePort = await freePort(), webPort = await freePort(), dbgPort = await freePort();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'koralpaper-test-'));
  const docsDir = path.join(tmp, 'Documents'), desktopDir = path.join(tmp, 'Desktop');
  fs.mkdirSync(docsDir); fs.mkdirSync(desktopDir);
  const profile = path.join(tmp, 'chrome-profile');

  /* the MCP server */
  const serverEnv = { KORALPAPER_PORT: String(bridgePort), KORALPAPER_DOCS_DIR: docsDir, KORALPAPER_DESKTOP_DIR: desktopDir };
  const { server, rpc, tool } = await spawnServer(serverEnv);

  /* the app, in headless Chrome */
  const web = await staticServer(webPort, bridgePort);
  let appUrl = `http://127.0.0.1:${webPort}/index.html?bridge=${bridgePort}`;
  if (opts.file){
    const copy = path.join(tmp, 'app');
    fs.mkdirSync(copy);
    for (const d of ['css', 'js', 'fonts']) fs.cpSync(path.join(ROOT, d), path.join(copy, d), { recursive: true });
    fs.writeFileSync(path.join(copy, 'index.html'),
      fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/(127\.0\.0\.1|localhost):8137/g, '$1:' + bridgePort));
    appUrl = 'file://' + path.join(copy, 'index.html') + '?bridge=' + bridgePort;
  }
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--window-size=1400,900', `--user-data-dir=${profile}`, `--remote-debugging-port=${dbgPort}`, appUrl],
    { stdio: 'ignore' });

  let ws = null;
  for (let i = 0; i < 100 && !ws; i++){
    await sleep(150);
    try {
      const list = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json();
      const page = list.find(t => t.type === 'page' && t.url.includes('index.html'));
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch (e){}
  }
  if (!ws) throw new Error('Chrome did not start');
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('devtools socket failed')); });
  let cdpId = 1;
  const cdpWait = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    const w = cdpWait.get(m.id);
    if (w){ cdpWait.delete(m.id); w(m); }
  };
  const cdp = (method, params) => new Promise(res => {
    const id = cdpId++;
    cdpWait.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  /* run JavaScript inside the app page, as if the user had done it */
  const page = async expr => {
    const m = await cdp('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (m.result && m.result.exceptionDetails)
      throw new Error('in page: ' + (m.result.exceptionDetails.exception && m.result.exceptionDetails.exception.description || m.result.exceptionDetails.text));
    return m.result && m.result.result ? m.result.result.value : undefined;
  };

  /* wait until the app has linked to the bridge */
  let linked = false;
  for (let i = 0; i < 120 && !linked; i++){
    const s = await tool('koralpaper_status');
    linked = /open and linked \(app v/.test(s.text);
    if (!linked) await sleep(250);
  }
  if (!linked){
    let why = '';
    try {
      why = await page(`return JSON.stringify({ meta: typeof state !== 'undefined' && !!state.meta, bridge: typeof CLAUDE_BRIDGE !== 'undefined' ? CLAUDE_BRIDGE : null,
        linked: typeof claudeLinked !== 'undefined' ? claudeLinked : null, hint: document.getElementById('hint') ? document.getElementById('hint').textContent : null,
        errs: window.__errs || null })`);
      const st = await tool('koralpaper_status');
      why += ' | status: ' + st.text;
    } catch (e){ why = String(e); }
    try { ws.close(); } catch (e){}
    chrome.kill('SIGKILL'); server.kill(); web.close();
    throw new Error('the app never linked to the test bridge: ' + why);
  }

  const stop = async () => {
    try { ws.close(); } catch (e){}
    chrome.kill('SIGKILL'); server.kill();
    await new Promise(r => web.close(r));
    await sleep(200);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e){}
  };
  /* save a picture of the app window */
  const shot = async file => {
    const m = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(m.result.data, 'base64'));
    return file;
  };
  /* reload the app, as the user pressing Cmd+R, and wait for it to link again */
  const reload = async () => {
    await cdp('Page.reload', {});
    for (let i = 0; i < 120; i++){
      await sleep(250);
      try { if (await page(`return typeof claudeLinked !== 'undefined' && claudeLinked === true && !!state.meta`)) return; } catch (e){}
    }
    throw new Error('the app did not come back after a reload');
  };
  return { tool, rpc, page, shot, reload, stop, docsDir, desktopDir, tmp, bridgePort, serverEnv, sleep };
}

module.exports = { start, spawnServer, freePort, sleep, ROOT };
