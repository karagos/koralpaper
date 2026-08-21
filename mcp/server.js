#!/usr/bin/env node
/* KoralPaper MCP bridge — lets Claude (Desktop) design pages directly
   in the KoralPaper app running in your browser.

   Two faces, one file, zero dependencies:
   - MCP server over stdio (newline-delimited JSON-RPC) for Claude.
   - Local HTTP bridge on 127.0.0.1:8137 that the KoralPaper page
     long-polls; tool calls become commands, the app posts results back.

   © 2026 Stefanos Karagos, CAIO Group · wearecaio.com · MIT */

'use strict';
const http = require('http');

const PORT = Number(process.env.KORALPAPER_PORT) || 8137;
const CMD_TIMEOUT_MS = 30000;
const POLL_HOLD_MS = 25000;

/* ── command queue: MCP side pushes, app side consumes ── */
let nextCmdId = 1;
const queue = [];                 // commands waiting for the app
const pending = new Map();        // id → {resolve, timer}
let appLastSeen = 0;
let pollWaiter = null;            // res of a held /poll request

function appConnected(){ return Date.now() - appLastSeen < 5000; }

function dispatch(action, args){
  return new Promise((resolve, reject) => {
    const id = nextCmdId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('KoralPaper did not answer in time. Is the app open in a browser tab?'));
    }, CMD_TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    queue.push({ id, action, args: args || {} });
    if (pollWaiter){ flushQueue(pollWaiter); pollWaiter = null; }
  });
}
function flushQueue(res){
  const batch = queue.splice(0, queue.length);
  res.writeHead(200, corsHeaders(res.kpOrigin, { 'Content-Type': 'application/json' }));
  res.end(JSON.stringify(batch));
}

/* ── the localhost bridge the app talks to ────────────
   Origin hardening: browsers attach an Origin header to cross-origin
   requests, and only KoralPaper's own homes are allowed — a file://
   page (Origin "null"), localhost, or the official GitHub Pages app.
   Any other website gets no CORS approval AND a 403, and the working
   endpoints additionally require the X-Koralpaper header, which forces
   a preflight that unknown origins can never pass. */
function hostAllowed(hostHeader){
  /* anti-DNS-rebinding: a browser page that rebinds its own domain to
     127.0.0.1 sends the request with Host = its domain, which the Origin
     checks below may not catch (rebound requests look same-origin). The
     app itself always reaches us at 127.0.0.1/localhost, so we accept only
     those hostnames and reject everything else outright. HTTP/1.1 requires
     a Host header; a missing one is rejected too. */
  if (!hostHeader) return false;
  const host = String(hostHeader).replace(/:\d+$/, '').toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
}
function originAllowed(o){
  return !o || o === 'null'
    || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)
    || o === 'https://karagos.github.io';
}
function corsHeaders(origin, extra){
  const h = { 'Cache-Control': 'no-store' };
  if (originAllowed(origin)){
    h['Access-Control-Allow-Origin'] = origin || '*';
    h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type, X-Koralpaper';
    h['Vary'] = 'Origin';
  }
  return Object.assign(h, extra || {});
}
/* Read a request body with a hard cap. Without one, any local process could
   POST an endless stream at the bridge and exhaust this process's memory. */
const MAX_BODY = 8 * 1024 * 1024;                 // 8 MB: far above any real tool call
function readBody(req, res, origin, onDone){
  let body = '', over = false;
  req.on('data', d => {
    if (over) return;
    body += d;
    if (body.length > MAX_BODY){
      over = true; body = '';
      try { res.writeHead(413, corsHeaders(origin)); res.end(); } catch (e){}
      req.destroy();
    }
  });
  req.on('end', () => { if (!over) onDone(body); });
  req.on('error', () => { over = true; });
}
const server = http.createServer((req, res) => {
  if (!hostAllowed(req.headers.host)){
    res.writeHead(403, { 'Cache-Control': 'no-store' }); res.end(); return;
  }
  const origin = req.headers.origin;
  if (origin && !originAllowed(origin)){
    res.writeHead(403, { 'Cache-Control': 'no-store' }); res.end(); return;
  }
  const guarded = req.url.startsWith('/poll') || req.url.startsWith('/result') || req.url.startsWith('/dispatch');
  if (origin && guarded && req.method !== 'OPTIONS' && !req.headers['x-koralpaper']){
    res.writeHead(403, corsHeaders(origin)); res.end(); return;
  }
  appLastSeen = Date.now();
  if (req.method === 'OPTIONS'){
    res.writeHead(204, corsHeaders(origin)); res.end(); return;
  }
  if (req.method === 'GET' && req.url.startsWith('/poll')){
    res.kpOrigin = origin;
    if (queue.length){ flushQueue(res); return; }
    if (pollWaiter){ try { flushQueue(pollWaiter); } catch (e){} }
    pollWaiter = res;
    const t = setTimeout(() => {
      if (pollWaiter === res){ pollWaiter = null; try { flushQueue(res); } catch (e){} }
    }, POLL_HOLD_MS);
    res.on('close', () => { clearTimeout(t); if (pollWaiter === res) pollWaiter = null; });
    return;
  }
  if (req.method === 'POST' && req.url.startsWith('/result')){
    readBody(req, res, origin, body => {
      try {
        const { id, result } = JSON.parse(body);
        const p = pending.get(id);
        if (p){ clearTimeout(p.timer); pending.delete(id); p.resolve(result); }
      } catch (e){}
      res.writeHead(200, corsHeaders(origin, { 'Content-Type': 'application/json' }));
      res.end('{"ok":true}');
    });
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/status')){
    res.writeHead(200, corsHeaders(origin, { 'Content-Type': 'application/json' }));
    res.end(JSON.stringify({ bridge: 'koralpaper', app: appConnected() }));
    return;
  }
  if (req.method === 'POST' && req.url.startsWith('/dispatch')){
    // a proxy instance (another Claude app) forwards a tool call to us
    readBody(req, res, origin, async body => {
      let out;
      try {
        const { action, args } = JSON.parse(body);
        out = await dispatch(action, args);
      } catch (e){
        out = { error: String(e && e.message || e) };
      }
      res.writeHead(200, corsHeaders(origin, { 'Content-Type': 'application/json' }));
      res.end(JSON.stringify(out));
    });
    return;
  }
  res.writeHead(404, corsHeaders(origin)); res.end();
});
/* ── multi-instance: two Claude apps, one bridge ────
   The connector may run in Claude Desktop AND Claude Code at the same
   time. Only one process can own the port; any instance that cannot
   bind becomes a PROXY and forwards its tool calls to the owner over
   HTTP, so every Claude app works, whichever launched first. If the
   owner quits, the proxy grabs the port and takes over. */
let proxyMode = false;
server.on('error', err => {
  if (err && err.code === 'EADDRINUSE'){
    proxyMode = true;
    process.stderr.write('KoralPaper bridge: port busy, running as proxy to the primary instance\n');
  } else {
    process.stderr.write('KoralPaper bridge error: ' + (err && err.message) + '\n');
  }
});
server.listen(PORT, '127.0.0.1');

function httpJSON(method, path, payload){
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? null : JSON.stringify(payload);
    const req = http.request({
      host: '127.0.0.1', port: PORT, path, method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {},
      timeout: CMD_TIMEOUT_MS + 5000,
    }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e){ reject(new Error('bridge answered unreadably')); } });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('bridge timeout')));
    req.end(body);
  });
}
async function proxyDispatch(action, args){
  try {
    return await httpJSON('POST', '/dispatch', { action, args });
  } catch (e){
    if (e && (e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET')){
      // the primary quit — take over the port and serve directly
      proxyMode = false;
      try { server.listen(PORT, '127.0.0.1'); } catch (e2){}
      await new Promise(r => setTimeout(r, 300));
      if (!proxyMode) return dispatch(action, args);
    }
    throw e;
  }
}
async function bridgeAppConnected(){
  if (!proxyMode) return appConnected();
  try { const s = await httpJSON('GET', '/status'); return !!(s && s.app); }
  catch (e){ return appConnected(); }
}

/* ── element schema shared by the drawing tools ── */
const STROKES = 'ink (black), gdark, gmid, glight, white, coral, blue, green, plum, none, or any #hex';
const FILLS = 'none, cream, white, coral, terracotta, blush, periwinkle, sage, butter, sky, glight, gmid, gdark, ink, or any #hex';
const ELEMENT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Your own short id (e.g. "start", "step2") so arrows and later updates can reference this element.' },
    type: { type: 'string', enum: ['rect', 'diamond', 'ellipse', 'polygon', 'chip', 'text', 'arrow', 'line'], description: 'rect = box/sticky, diamond = decision, ellipse = start/end, polygon = regular N-gon (set sides), chip = small label pill, text = free text, arrow/line = connector.' },
    x: { type: 'number' }, y: { type: 'number' },
    w: { type: 'number' }, h: { type: 'number' },
    text: { type: 'string', description: 'Text inside the shape, the free text, or the label riding an arrow.' },
    stroke: { type: 'string', description: 'Outline / text color: ' + STROKES },
    fill: { type: 'string', description: 'Fill color: ' + FILLS },
    textColor: { type: 'string', description: 'Text color, independent of the outline — use a light color (white, glight) on dark fills. Values: ' + STROKES + '. Omit or "auto" = follows the stroke, auto-flips to light on dark fills.' },
    fillStyle: { type: 'string', enum: ['solid', 'hachure', 'dense', 'cross', 'dots', 'waves'] },
    dash: { type: 'string', enum: ['solid', 'dotted', 'dashed'] },
    size: { type: 'number', description: 'Font size in px (default 21; 16 for chips and arrow labels; up to 300 for poster headlines).' },
    bold: { type: 'boolean', description: 'true = render the whole text bold (headlines, table headers).' },
    font: { type: 'string', description: 'serif, sans, hand, or a Google font key like playfair, spacegrotesk, caveat.' },
    align: { type: 'string', enum: ['left', 'center', 'right'] },
    sketch: { type: 'number', description: 'Line style. 1 = hand-drawn wobble (the default look). 0 = neat, straight, precise lines — use 0 for clean/professional diagrams, tables, UI mockups, and anything that should NOT look hand-sketched.' },
    sw: { type: 'number', description: 'Stroke (line/outline) width in px. Guide: 1.5 = thin/hairline, 3.3 = medium (default), 5 = thick, 8 to 14 = bold poster lines. Range 0.5 to 40. Thin outlines read as more precise; thick reads as emphasis.' },
    opacity: { type: 'number', description: 'Opacity of the WHOLE element (outline + fill + text) from 0 (invisible) to 100 (solid, default). Use for ghosted/faded elements.' },
    fillOpacity: { type: 'number', description: 'Transparency of the FILL ONLY, 0 (transparent fill) to 100 (opaque, default). The outline and text stay solid. Use for translucent highlight boxes, tints behind text, overlapping shapes that should show through each other, or Venn-style overlaps.' },
    sides: { type: 'number', description: 'Polygon only: number of sides, 3 (triangle) to 12 (dodecagon). 5 = pentagon, 6 = hexagon, 8 = octagon.' },
    startHead: { type: 'string', enum: ['none','arrow','triangle','triangle-filled','diamond','diamond-filled','circle','circle-filled','bar'], description: 'Arrows/lines only: the marker at the START point. Default none.' },
    endHead: { type: 'string', enum: ['none','arrow','triangle','triangle-filled','diamond','diamond-filled','circle','circle-filled','bar'], description: 'Arrows/lines only: the marker at the END point. Default arrow for arrows, none for lines. "-filled" variants are solid; "bar" is a perpendicular stop.' },
    from: { type: 'string', description: 'Arrows only: id of the shape this arrow starts from (it glues to the border and follows).' },
    to: { type: 'string', description: 'Arrows only: id of the shape this arrow points to.' },
    elbow: { type: 'boolean', description: 'Arrows only: true = right-angle elbow route instead of a straight/curved line.' },
    x2: { type: 'number', description: 'Unbound arrows/lines only: end point x (start is x,y).' },
    y2: { type: 'number', description: 'Unbound arrows/lines only: end point y.' },
  },
  required: ['type'],
};
const COORDS_HELP = 'Coordinates: y grows downward, origin is the artboard top-left. Typical shape: 190 wide × 92 tall; leave 100 to 120 px gaps. On a 1920×1080 board keep everything inside 60 px margins. Styling: set sketch:0 for clean/precise diagrams and tables (1 is hand-drawn); control line weight with sw (1.5 thin, 3.3 medium, 5 thick); use fillOpacity for translucent fills and opacity to fade a whole element; pick per-end arrowheads with startHead/endHead.';

const TOOLS = [
  {
    name: 'koralpaper_status',
    annotations: { title: 'Check KoralPaper connection', readOnlyHint: true, openWorldHint: false },
    description: 'Check whether the KoralPaper app is open and linked. Call this first if unsure.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'koralpaper_read_document',
    annotations: { title: 'Read the document', readOnlyHint: true, openWorldHint: false },
    description: 'Read the current KoralPaper document: every page with its elements (positions, sizes, text, colors, arrow connections). Use it before editing so you work with what is really on the paper.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'koralpaper_create_page',
    annotations: { title: 'Create a page and draw', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Create a NEW page in KoralPaper and draw elements on it. Shapes first, then arrows that reference shape ids via from/to (they glue to the shapes and follow them). ' + COORDS_HELP,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Page name shown in the page strip.' },
        board: { type: 'object', properties: { w: { type: 'number' }, h: { type: 'number' }, name: { type: 'string' } }, description: 'Optional artboard, e.g. {w:1920,h:1080} for a slide or {w:1080,h:1350} for a LinkedIn carousel. Omit for an unlimited canvas.' },
        paper: { type: 'string', description: 'Optional paper color as #hex (e.g. "#FFFFFF" for white).' },
        elements: { type: 'array', items: ELEMENT_SCHEMA },
      },
      required: ['elements'],
    },
  },
  {
    name: 'koralpaper_add_elements',
    annotations: { title: 'Add elements to the page', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Add elements to the CURRENT page (read the document first to see what is there and where free space is). Same element format as koralpaper_create_page. ' + COORDS_HELP,
    inputSchema: {
      type: 'object',
      properties: { elements: { type: 'array', items: ELEMENT_SCHEMA } },
      required: ['elements'],
    },
  },
  {
    name: 'koralpaper_update_elements',
    annotations: { title: 'Update elements by id', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Change existing elements on the current page by id (ids come from koralpaper_read_document or the ids you assigned). Provide only the properties to change: x, y, w, h, text, stroke, fill, fillStyle, dash, size, font, align.',
    inputSchema: {
      type: 'object',
      properties: {
        updates: { type: 'array', items: { type: 'object', properties: Object.assign({}, ELEMENT_SCHEMA.properties, { id: { type: 'string' } }), required: ['id'] } },
      },
      required: ['updates'],
    },
  },
  {
    name: 'koralpaper_delete_elements',
    annotations: { title: 'Delete elements by id', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Delete elements from the current page by id.',
    inputSchema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' } } },
      required: ['ids'],
    },
  },
  {
    name: 'koralpaper_render_page',
    annotations: { title: 'Render a page preview', readOnlyHint: true, openWorldHint: false },
    description: 'See the current page as an image. ALWAYS call this after creating or changing a design to check your layout with your own eyes — fix overlaps or crowding before telling the user you are done.',
    inputSchema: { type: 'object', properties: {} },
  },
];

/* ── MCP over stdio: newline-delimited JSON-RPC 2.0 ── */
function send(msg){ process.stdout.write(JSON.stringify(msg) + '\n'); }
function reply(id, result){ send({ jsonrpc: '2.0', id, result }); }
function replyErr(id, code, message){ send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handleToolCall(id, name, args){
  try {
    if (name === 'koralpaper_status'){
      const linked = await bridgeAppConnected();
      reply(id, { content: [{ type: 'text', text: linked
        ? 'KoralPaper is open and linked. Ready to draw.'
        : 'KoralPaper is not linked. Ask the user to open KoralPaper (index.html) in their browser — the app links to this bridge automatically within a few seconds.' }] });
      return;
    }
    const action = name.replace('koralpaper_', '');
    const result = proxyMode ? await proxyDispatch(action, args) : await dispatch(action, args);
    if (result && result.error){
      reply(id, { content: [{ type: 'text', text: 'KoralPaper reported: ' + result.error }], isError: true });
      return;
    }
    if (action === 'render_page' && result && result.png){
      reply(id, { content: [
        { type: 'image', data: result.png, mimeType: 'image/png' },
        { type: 'text', text: result.note || 'Current page render.' },
      ] });
      return;
    }
    reply(id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
  } catch (e){
    reply(id, { content: [{ type: 'text', text: String(e && e.message || e) }], isError: true });
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0){
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (e){ continue; }
    onMessage(msg);
  }
});
process.stdin.on('end', () => process.exit(0));

function onMessage(msg){
  const { id, method, params } = msg;
  if (method === 'initialize'){
    reply(id, {
      protocolVersion: (params && params.protocolVersion) || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'koralpaper', version: '1.4.3' },
      instructions: 'These tools draw directly in the KoralPaper app (hand-drawn diagram studio) running in the user\'s browser. Workflow: koralpaper_status → koralpaper_read_document (if editing) → create/add/update → koralpaper_render_page to visually check the result, and iterate until the layout is clean.',
    });
    return;
  }
  if (method === 'notifications/initialized' || (method && method.startsWith('notifications/'))) return;
  if (method === 'ping'){ reply(id, {}); return; }
  if (method === 'tools/list'){ reply(id, { tools: TOOLS }); return; }
  if (method === 'tools/call'){
    handleToolCall(id, params.name, params.arguments || {});
    return;
  }
  if (id !== undefined) replyErr(id, -32601, 'Method not found: ' + method);
}
