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
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER_VERSION = '1.6.0';

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

function dispatch(action, args, timeoutMs){
  return new Promise((resolve, reject) => {
    const id = nextCmdId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      const i = queue.findIndex(c => c.id === id);
      if (i >= 0) queue.splice(i, 1);          // never run a command nobody is waiting for any more
      reject(new Error('KoralPaper did not answer in time. Is the app open in a browser tab?'));
    }, timeoutMs || CMD_TIMEOUT_MS);
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
const MAX_BODY = 96 * 1024 * 1024;                // 96 MB: room for one exported page at 4x, far above any other call
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
        const { action, args, timeoutMs } = JSON.parse(body);
        out = await dispatch(action, args, Number(timeoutMs) > 0 ? Math.min(Number(timeoutMs), 180000) : undefined);
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

function httpJSON(method, urlPath, payload, timeoutMs){
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? null : JSON.stringify(payload);
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: urlPath, method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {},
      timeout: (timeoutMs || CMD_TIMEOUT_MS) + 5000,
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
async function proxyDispatch(action, args, timeoutMs){
  try {
    return await httpJSON('POST', '/dispatch', { action, args, timeoutMs }, timeoutMs);
  } catch (e){
    if (e && (e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET')){
      // the primary quit — take over the port and serve directly
      proxyMode = false;
      try { server.listen(PORT, '127.0.0.1'); } catch (e2){}
      await new Promise(r => setTimeout(r, 300));
      if (!proxyMode) return dispatch(action, args, timeoutMs);
    }
    throw e;
  }
}
async function bridgeAppConnected(){
  if (!proxyMode) return appConnected();
  try { const s = await httpJSON('GET', '/status'); return !!(s && s.app); }
  catch (e){ return appConnected(); }
}

/* send a command to the app, through the primary instance when this one is a proxy */
function call(action, args, timeoutMs){
  return proxyMode ? proxyDispatch(action, args, timeoutMs) : dispatch(action, args, timeoutMs);
}

/* ── element schema shared by the drawing tools ── */
const STROKES = 'ink (black), gdark, gmid, glight, white, coral, blue, green, plum, none, any #hex, or a colour token by name with a $ in front ("$accent", defined with koralpaper_set_styles)';
const FILLS = 'none, cream, white, coral, terracotta, blush, periwinkle, sage, butter, sky, glight, gmid, gdark, ink, any #hex, or a colour token like "$accent"';
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
    textColor: { type: 'string', description: 'Text color, independent of the outline: use a light color (white, glight) on dark fills. Values: ' + STROKES + '. Omit or "auto" = follows the stroke, auto-flips to light on dark fills.' },
    fillStyle: { type: 'string', enum: ['solid', 'hachure', 'dense', 'cross', 'dots', 'waves'] },
    dash: { type: 'string', enum: ['solid', 'dotted', 'dashed'] },
    size: { type: 'number', description: 'Font size in px (default 21; 16 for chips and arrow labels; up to 600 for poster headlines).' },
    bold: { type: 'boolean', description: 'true = render the whole text bold (headlines, table headers).' },
    italic: { type: 'boolean', description: 'true = render the whole text italic.' },
    weight: { type: 'number', description: 'Font weight 100 to 900 for the whole text (400 regular, 600 semibold, 800 extrabold). Inter Tight has every weight from 400 to 900, JetBrains Mono and Gelasio from 400 to 700, all with italics. Inter Tight and JetBrains Mono include Greek; Gelasio does not.' },
    font: { type: 'string', description: 'serif, sans, hand; a font that ships with the app by name: "Inter Tight", "JetBrains Mono", "Gelasio" (these work offline); a built-in key like playfair, spacegrotesk, caveat; or any Google font by its exact name.' },
    style: { type: 'string', description: 'Name of a text style defined with koralpaper_set_styles (e.g. "headline"). It supplies font, size, weight, colour and alignment; anything you also set here wins. Changing the style later restyles this element.' },
    align: { type: 'string', enum: ['left', 'center', 'right'] },
    valign: { type: 'string', enum: ['top', 'middle', 'bottom'], description: 'Where text sits vertically inside a shape (default middle).' },
    lineHeight: { type: 'number', description: 'Line height as a multiple of the font size (default 1.3; 1.05 to 1.15 for big headlines).' },
    letterSpacing: { type: 'number', description: 'Extra space between letters in px, -7 to 15 (default 0).' },
    wrap: { type: 'boolean', description: 'Text elements only: true = keep the given width w and break lines inside it. Without it a text element is as wide as its longest line and w is ignored.' },
    maxHeight: { type: 'number', description: 'Text elements only: the height in px the copy must fit. Nothing is clipped; koralpaper_measure reports overflow against it.' },
    locked: { type: 'boolean', description: 'true = lock the element: it ignores clicks and drags in the app (the user can unlock it with a right-click) and later updates or deletes skip it.' },
    sketch: { type: 'number', description: 'Line style. 1 = hand-drawn wobble (the default look). 0 = neat, straight, precise lines: use 0 for clean/professional diagrams, tables, UI mockups, carousels, and anything that should NOT look hand-sketched.' },
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

/* the three arguments that aim a tool at a document, a page, and a known state */
const DOC_ID = { type: 'string', description: 'The document to act on (ids come from koralpaper_create_document, koralpaper_list_documents or koralpaper_read_document). If another document is on screen, this one is opened first and the other is kept in the app\'s Documents list. Omit = the document on screen.' };
const PAGE_ID = { type: 'string', description: 'The page to act on (ids come from koralpaper_read_document or koralpaper_create_page). Omit = the page on screen.' };
const IF_VERSION = { type: 'number', description: 'Safety check: the page version you last read (the "version" of that page in koralpaper_read_document, or returned by your last write). If the page changed since, by the user or anyone else, the write is refused and nothing changes. Always send it when editing existing work.' };
const BOARD = {
  type: 'object',
  properties: {
    w: { type: 'number' }, h: { type: 'number' }, name: { type: 'string' },
    safeArea: { type: 'number', description: 'Optional inset in px. Draws a dashed safe-area guide in the editor (never exported), and koralpaper_measure reports text that leaves it.' },
  },
  description: 'Artboard, e.g. {w:1920,h:1080} for a slide or {w:1080,h:1350,safeArea:80} for a LinkedIn carousel. One artboard size applies to the whole document.',
};
const ex = obj => ' Example: ' + JSON.stringify(obj);
const PAGE_SPEC = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Page name shown in the page strip.' },
    paper: { type: 'string', description: 'Paper color as #hex.' },
    elements: { type: 'array', items: ELEMENT_SCHEMA },
  },
  required: ['elements'],
};

const TOOLS = [
  {
    name: 'koralpaper_status',
    annotations: { title: 'Check KoralPaper connection', readOnlyHint: true, openWorldHint: false },
    description: 'Check whether the KoralPaper app is open and linked, and which document is on screen. Call this first if unsure.' + ex({}),
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'koralpaper_list_documents',
    annotations: { title: 'List documents', readOnlyHint: true, openWorldHint: false },
    description: 'List every document kept in the app: id, name, page count, artboard, version, which one is on screen, and each document\'s snapshots. Use it to find the document you worked on before.' + ex({}),
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'koralpaper_create_document',
    annotations: { title: 'Create a new document', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Start a NEW, separate document and show it. The document that was on screen is kept untouched in the app\'s Documents list. Use this for every new carousel or deck so you never draw over other work. Returns the documentId to pass to every later call. The new document has one blank page; your first koralpaper_create_page takes its place.' + ex({ name: 'AI adoption carousel', board: { w: 1080, h: 1350, safeArea: 80 } }),
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Document name, shown in the Documents list and used as the default export file name.' },
        board: BOARD,
      },
      required: ['name'],
    },
  },
  {
    name: 'koralpaper_open_document',
    annotations: { title: 'Open a document', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Show an existing document by id. The document that was on screen is kept in the Documents list. Returns its pages with their ids and versions.' + ex({ id: 'doc_k3f9a2x1b7c4' }),
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Document id from koralpaper_list_documents.' } },
      required: ['id'],
    },
  },
  {
    name: 'koralpaper_read_document',
    annotations: { title: 'Read the document', readOnlyHint: true, openWorldHint: false },
    description: 'Read a KoralPaper document: its id and version, and every page with its id, its version and its elements (positions, sizes, text, fonts, colors, arrow connections, locks). Also returns named styles, the master page and the number of open comments. Use it before editing so you work with what is really on the paper, and keep each page\'s version for ifVersion. With pageId only that page\'s elements are listed.' + ex({ documentId: 'doc_k3f9a2x1b7c4' }),
    inputSchema: { type: 'object', properties: { documentId: DOC_ID, pageId: PAGE_ID } },
  },
  {
    name: 'koralpaper_create_page',
    annotations: { title: 'Create pages and draw', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Create a NEW page and draw elements on it, or several pages in one call with "pages". Shapes first, then arrows that reference shape ids via from/to (they glue to the shapes and follow them). Returns each new page\'s id and version. ' + COORDS_HELP + ex({ documentId: 'doc_k3f9a2x1b7c4', pages: [{ name: 'Cover', paper: '#111111', elements: [{ id: 'title', type: 'text', x: 80, y: 420, w: 920, wrap: true, text: 'Five myths about AI at work', font: 'Inter Tight', weight: 800, size: 96, lineHeight: 1.05, textColor: '#FFFFFF' }] }, { name: 'Myth 1', elements: [{ type: 'text', x: 80, y: 120, text: 'Myth 1', font: 'JetBrains Mono', size: 28 }] }] }),
    inputSchema: {
      type: 'object',
      properties: {
        documentId: DOC_ID,
        name: { type: 'string', description: 'Page name shown in the page strip (single page).' },
        board: Object.assign({}, BOARD, { description: 'Optional artboard for the document, e.g. {w:1920,h:1080} for a slide or {w:1080,h:1350} for a LinkedIn carousel. Omit to keep the current one (or an unlimited canvas).' }),
        paper: { type: 'string', description: 'Optional paper color as #hex (e.g. "#FFFFFF" for white), single page.' },
        elements: { type: 'array', items: ELEMENT_SCHEMA, description: 'Elements of the single page. Use this OR pages.' },
        pages: { type: 'array', items: PAGE_SPEC, description: 'Several pages in one call, created in this order. Element ids are local to each page.' },
        ifVersion: { type: 'number', description: 'Safety check: the DOCUMENT version you last read. If the document changed since, nothing is created.' },
      },
    },
  },
  {
    name: 'koralpaper_add_elements',
    annotations: { title: 'Add elements to a page', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Add elements to a page: the page on screen, or the one named by pageId (read the document first to see what is there and where free space is). Same element format as koralpaper_create_page. Returns the page\'s new version. ' + COORDS_HELP + ex({ documentId: 'doc_k3f9a2x1b7c4', pageId: 'k2j4h6g8a1b2', ifVersion: 7, elements: [{ id: 'note', type: 'rect', x: 80, y: 900, w: 400, h: 120, text: 'Source: CAIO survey 2026', sketch: 0, fill: '$accent' }] }),
    inputSchema: {
      type: 'object',
      properties: { documentId: DOC_ID, pageId: PAGE_ID, ifVersion: IF_VERSION, elements: { type: 'array', items: ELEMENT_SCHEMA } },
      required: ['elements'],
    },
  },
  {
    name: 'koralpaper_update_elements',
    annotations: { title: 'Update elements by id', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Change existing elements on a page by id (ids come from koralpaper_read_document or the ids you assigned). Provide only the properties to change. Locked elements are skipped and reported, unless the same update sends locked:false. Returns the page\'s new version.' + ex({ documentId: 'doc_k3f9a2x1b7c4', pageId: 'k2j4h6g8a1b2', ifVersion: 8, updates: [{ id: 'title', text: 'Six myths about AI at work', size: 88 }] }),
    inputSchema: {
      type: 'object',
      properties: {
        documentId: DOC_ID, pageId: PAGE_ID, ifVersion: IF_VERSION,
        updates: { type: 'array', items: { type: 'object', properties: Object.assign({}, ELEMENT_SCHEMA.properties, { id: { type: 'string' } }), required: ['id'] } },
      },
      required: ['updates'],
    },
  },
  {
    name: 'koralpaper_delete_elements',
    annotations: { title: 'Delete elements by id', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Delete elements from a page by id. Locked elements are never deleted; they are reported back instead.' + ex({ documentId: 'doc_k3f9a2x1b7c4', pageId: 'k2j4h6g8a1b2', ifVersion: 9, ids: ['note'] }),
    inputSchema: {
      type: 'object',
      properties: { documentId: DOC_ID, pageId: PAGE_ID, ifVersion: IF_VERSION, ids: { type: 'array', items: { type: 'string' } } },
      required: ['ids'],
    },
  },
  {
    name: 'koralpaper_render_page',
    annotations: { title: 'Render a page preview', readOnlyHint: true, openWorldHint: false },
    description: 'See a page as an image: the page on screen, or the one named by pageId. ALWAYS call this after creating or changing a design to check your layout with your own eyes, and fix overlaps or crowding before telling the user you are done.' + ex({ documentId: 'doc_k3f9a2x1b7c4', pageId: 'k2j4h6g8a1b2' }),
    inputSchema: { type: 'object', properties: { documentId: DOC_ID, pageId: PAGE_ID } },
  },
  {
    name: 'koralpaper_measure',
    annotations: { title: 'Measure text', readOnlyHint: true, openWorldHint: false },
    description: 'Measure how text really renders, with the real fonts loaded. For each element: the rendered line breaks, the real text height and width, the space available, and overflow true/false with the reason (taller than its box or maxHeight, a word too long to wrap, or past the artboard edge). Call it after writing copy into fixed boxes, then shorten the text or lower the size until overflow is false.' + ex({ documentId: 'doc_k3f9a2x1b7c4', elementIds: ['a1b2c3d4e5f6', 'g7h8i9j0k1l2'] }),
    inputSchema: {
      type: 'object',
      properties: {
        documentId: DOC_ID,
        pageId: Object.assign({}, PAGE_ID, { description: 'Optional: look for the elements on this page only. Omit = search every page of the document.' }),
        elementIds: { type: 'array', items: { type: 'string' }, description: 'Real element ids, as returned by the drawing tools or koralpaper_read_document.' },
      },
      required: ['elementIds'],
    },
  },
  {
    name: 'koralpaper_export',
    annotations: { title: 'Export pages to files', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Export pages as files on this computer and return their full paths. pdf = one multi-page PDF in the document\'s page order; png / jpg = one image per page, numbered by page ("name-01.png"). Files go to a folder inside ~/Documents (created if missing); nothing can be written outside it. The editor\'s grid and guides are not exported. In a PDF each page is a JPEG placed as-is at the artboard size, the same bytes a jpg export gives, with the page\'s text laid over it as invisible real text, so the PDF can be searched, selected, copied and read aloud.' + ex({ documentId: 'doc_k3f9a2x1b7c4', pageIds: 'all', format: 'pdf', scale: 2, folder: 'Carousels/AI myths', filenamePrefix: 'ai-myths' }),
    inputSchema: {
      type: 'object',
      properties: {
        documentId: DOC_ID,
        pageIds: { description: '"all" (default) or a list of page ids. Pages are always exported in document order.', anyOf: [{ type: 'string', enum: ['all'] }, { type: 'array', items: { type: 'string' } }] },
        format: { type: 'string', enum: ['pdf', 'png', 'jpg'], description: 'pdf, png or jpg.' },
        scale: { type: 'number', description: 'Pixel scale, 0.25 to 4. 1 = exactly the artboard size (1080×1350 stays 1080×1350), 2 = twice the pixels. Default 1 for png and jpg, 2 for pdf.' },
        folder: { type: 'string', description: 'Folder inside ~/Documents, e.g. "Carousels/AI myths". Default "KoralPaper Exports". A full path is accepted only if it is inside ~/Documents.' },
        filenamePrefix: { type: 'string', description: 'Start of the file names. Default: the document name.' },
        overwrite: { type: 'boolean', description: 'true = replace files that already have the same name. Default false: a number is added to the name instead.' },
        selectableText: { type: 'boolean', description: 'pdf only. Default true: the text of each page is added as invisible real text over the picture. false = pictures only.' },
      },
      required: ['format'],
    },
  },
  {
    name: 'koralpaper_get_selection',
    annotations: { title: 'Get the user\'s selection', readOnlyHint: true, openWorldHint: false },
    description: 'The elements the user has selected in the app right now: their ids and details, plus the page they are on. Use it when the user says "this one", "the selected box" or "make these bigger".' + ex({}),
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'koralpaper_get_changes',
    annotations: { title: 'See what changed', readOnlyHint: true, openWorldHint: false },
    description: 'What changed in a document since a version you know: elements added, changed and removed, with their pages. Use it after a refused write, or when you return to a document, to see what the user did without re-reading everything.' + ex({ documentId: 'doc_k3f9a2x1b7c4', sinceVersion: 12 }),
    inputSchema: {
      type: 'object',
      properties: { documentId: DOC_ID, sinceVersion: { type: 'number', description: 'A DOCUMENT version: the "version" at the top of koralpaper_read_document, or documentVersion from a write.' } },
      required: ['sinceVersion'],
    },
  },
  {
    name: 'koralpaper_list_comments',
    annotations: { title: 'List comments', readOnlyHint: true, openWorldHint: false },
    description: 'Comments the user pinned to elements (right-click an element, Add comment), each with its element, page and replies. Open comments only, unless includeResolved is true.' + ex({ documentId: 'doc_k3f9a2x1b7c4' }),
    inputSchema: {
      type: 'object',
      properties: { documentId: DOC_ID, includeResolved: { type: 'boolean', description: 'true = also list resolved comments.' } },
    },
  },
  {
    name: 'koralpaper_reply_comment',
    annotations: { title: 'Reply to a comment', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Reply to a comment and/or mark it resolved. Reply after you have acted on it, saying what you changed, and send resolve:true when the request is done. resolve:false reopens it.' + ex({ id: 'c_p4q8r2s6t0u1', text: 'Shortened the headline to two lines and moved it up 40px.', resolve: true }),
    inputSchema: {
      type: 'object',
      properties: {
        documentId: DOC_ID,
        id: { type: 'string', description: 'Comment id from koralpaper_list_comments.' },
        text: { type: 'string', description: 'Your reply, shown to the user under the comment.' },
        resolve: { type: 'boolean', description: 'true = mark resolved, false = reopen. Omit to leave as is.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'koralpaper_snapshot',
    annotations: { title: 'Save a snapshot', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Save a named checkpoint of a whole document (all pages, styles, master page, comments). Take one before a big rework so it can be undone as a whole. Up to 20 are kept per document; the oldest make room.' + ex({ documentId: 'doc_k3f9a2x1b7c4', name: 'Before the restyle' }),
    inputSchema: {
      type: 'object',
      properties: { documentId: DOC_ID, name: { type: 'string', description: 'A name that says why it was taken.' } },
    },
  },
  {
    name: 'koralpaper_restore',
    annotations: { title: 'Restore a snapshot', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Put a document back to a snapshot. Everything in that document changed since the snapshot is replaced (the user can undo it once with Cmd+Z). Page versions move forward, so read the document again afterwards. Snapshot ids come from koralpaper_snapshot or koralpaper_list_documents.' + ex({ snapshotId: 'snap_w5x9y3z7a1b5' }),
    inputSchema: {
      type: 'object',
      properties: { snapshotId: { type: 'string' } },
      required: ['snapshotId'],
    },
  },
  {
    name: 'koralpaper_set_styles',
    annotations: { title: 'Define named styles', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Define or change a document\'s named text styles and colour tokens. Elements then reference them by name: style:"headline" for a text style, "$accent" for a colour. Changing a style or token here restyles every element that uses it, on every page. Only the names you send are touched; send null to delete one.' + ex({ documentId: 'doc_k3f9a2x1b7c4', colors: { ink: '#111111', accent: '#E4572E', paper: '#F7F3EA' }, textStyles: { headline: { font: 'Inter Tight', weight: 800, size: 88, lineHeight: 1.05, color: '$ink' }, body: { font: 'Gelasio', size: 34, lineHeight: 1.35, color: '$ink' }, label: { font: 'JetBrains Mono', weight: 500, size: 22, color: '$accent' } } }),
    inputSchema: {
      type: 'object',
      properties: {
        documentId: DOC_ID,
        colors: { type: 'object', description: 'Colour tokens: name → "#hex" (or null to delete). Names use letters, digits, - and _.', additionalProperties: { type: ['string', 'null'] } },
        textStyles: {
          type: 'object',
          description: 'Text styles: name → style (or null to delete).',
          additionalProperties: {
            type: ['object', 'null'],
            properties: {
              font: { type: 'string' }, size: { type: 'number' }, weight: { type: 'number' },
              italic: { type: 'boolean' }, bold: { type: 'boolean' },
              align: { type: 'string', enum: ['left', 'center', 'right'] },
              lineHeight: { type: 'number' }, letterSpacing: { type: 'number' },
              color: { type: 'string', description: 'A colour or a token like "$ink".' },
            },
          },
        },
      },
    },
  },
  {
    name: 'koralpaper_set_master',
    annotations: { title: 'Set the master page', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Set the elements that repeat on every page of a document: a footer, a logo mark, a page number. In text, {page} becomes the page number and {pages} the page count, both two digits ("03 / 10"); {n} and {N} are the same without the leading zero. Master elements appear locked on each page and follow along when pages are added, removed or reordered. For a page number at the right, give it a box: x, a width w, wrap:true and align:"right", so its right edge is exactly x + w on every page. Send an empty elements list to remove the master page.' + ex({ documentId: 'doc_k3f9a2x1b7c4', elements: [{ type: 'text', x: 80, y: 1262, text: 'CAIO Group · wearecaio.com', font: 'JetBrains Mono', size: 20, textColor: '$ink' }, { type: 'text', x: 700, y: 1262, w: 300, wrap: true, align: 'right', text: '{page} / {pages}', font: 'JetBrains Mono', size: 20, textColor: '$ink' }], skipPageIds: [] }),
    inputSchema: {
      type: 'object',
      properties: {
        documentId: DOC_ID,
        elements: { type: 'array', items: ELEMENT_SCHEMA, description: 'Shapes, text and lines (no glued arrows). Empty list = no master page.' },
        front: { type: 'boolean', description: 'true (default) = drawn above each page\'s own elements; false = behind them.' },
        skipPageIds: { type: 'array', items: { type: 'string' }, description: 'Pages that should not show the master elements, e.g. the cover. They still count in the page numbers.' },
      },
      required: ['elements'],
    },
  },
  {
    name: 'koralpaper_import_svg',
    annotations: { title: 'Import an SVG as a page', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Turn an SVG into a new page of editable elements. Text stays text, with its font, size, weight and colour; rectangles, circles, ellipses and lines become shapes; a full-size first rectangle becomes the paper colour. Anything else (paths, polygons, gradients, clipped art) is kept together as one vector picture behind them, and reported. Scripts and external links are removed.' + ex({ documentId: 'doc_k3f9a2x1b7c4', pageName: 'Imported cover', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1350"><rect width="1080" height="1350" fill="#111111"/><text x="80" y="300" font-family="Inter Tight" font-size="96" font-weight="800" fill="#FFFFFF">Hello</text></svg>' }),
    inputSchema: {
      type: 'object',
      properties: {
        documentId: DOC_ID,
        svg: { type: 'string', description: 'The SVG markup.' },
        pageName: { type: 'string', description: 'Name of the new page.' },
      },
      required: ['svg'],
    },
  },
];

/* ── export: the app renders, this process writes the files ── */
function documentsRoot(){
  // KORALPAPER_DOCS_DIR exists for the test suite only; real use is always ~/Documents
  return path.resolve(process.env.KORALPAPER_DOCS_DIR || path.join(os.homedir(), 'Documents'));
}
function isInside(root, target){
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
/* Resolve the export folder and refuse anything that is not inside ~/Documents,
   including "../" tricks, absolute paths elsewhere, and symlinks that lead out. */
function resolveExportFolder(folder){
  const root = documentsRoot();
  let f = typeof folder === 'string' && folder.trim() ? folder.trim() : 'KoralPaper Exports';
  if (f.includes('\0')) throw new Error('The folder name is not valid.');
  if (f === '~' || f.startsWith('~/')) f = path.join(os.homedir(), f.slice(1));
  const target = path.isAbsolute(f) ? path.resolve(f) : path.resolve(root, f);
  const refuse = () => new Error(`Refused: exports can only be written inside ${root}. "${folder}" is outside it. Give a folder name like "Carousels/My deck".`);
  if (!isInside(root, target)) throw refuse();
  fs.mkdirSync(target, { recursive: true });
  const realRoot = fs.realpathSync(root), realTarget = fs.realpathSync(target);
  if (!isInside(realRoot, realTarget)) throw refuse();
  return realTarget;
}
function safeFileStem(s, fallback){
  let out = String(s == null ? '' : s).replace(/[\/\\:*?"<>|\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim();
  out = out.replace(/^[.\s-]+/, '').replace(/[.\s]+$/, '').slice(0, 80);
  return out || fallback;
}
function freeName(dir, stem, ext, overwrite){
  let file = path.join(dir, `${stem}.${ext}`);
  if (overwrite) return file;
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${stem} (${n}).${ext}`);
  return file;
}
/* A font with one empty glyph, 500 units wide. It is what makes the text of a
   PDF selectable without drawing anything: every character maps to that glyph,
   and a ToUnicode table says which character each code stands for. */
function glyphlessFont(){
  const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n & 0xFFFF); return b; };
  const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
  const tables = {
    glyf: Buffer.alloc(12),                                             // one simple glyph with no contours
    head: Buffer.concat([u32(0x00010000), u32(0x00010000), u32(0), u32(0x5F0F3CF5), u16(0), u16(1000),
      Buffer.alloc(16), u16(0), u16(-200), u16(500), u16(800), u16(0), u16(8), u16(2), u16(0), u16(0)]),
    hhea: Buffer.concat([u32(0x00010000), u16(800), u16(-200), u16(0), u16(500), u16(0), u16(0), u16(0),
      u16(1), u16(0), u16(0), Buffer.alloc(8), u16(0), u16(1)]),
    hmtx: Buffer.concat([u16(500), u16(0)]),
    loca: Buffer.concat([u16(0), u16(6)]),
    maxp: Buffer.concat([u32(0x00010000), u16(1), u16(0), u16(0), u16(0), u16(0), u16(2), Buffer.alloc(16)]),
    post: Buffer.concat([u32(0x00030000), u32(0), u16(0), u16(0), u32(1), Buffer.alloc(16)]),
  };
  const sum = buf => {
    let s = 0;
    const padded = Buffer.concat([buf, Buffer.alloc((4 - buf.length % 4) % 4)]);
    for (let i = 0; i < padded.length; i += 4) s = (s + padded.readUInt32BE(i)) >>> 0;
    return s;
  };
  const tags = Object.keys(tables).sort();
  const head = [u32(0x00010000), u16(tags.length), u16(64), u16(2), u16(tags.length * 16 - 64)];
  let offset = 12 + tags.length * 16;
  const dir = [], body = [];
  for (const tag of tags){
    const t = tables[tag];
    dir.push(Buffer.from(tag, 'latin1'), u32(sum(t)), u32(offset), u32(t.length));
    const padded = Buffer.concat([t, Buffer.alloc((4 - t.length % 4) % 4)]);
    body.push(padded); offset += padded.length;
  }
  const font = Buffer.concat([...head, ...dir, ...body]);
  const headAt = 12 + tags.length * 16 + body.slice(0, tags.indexOf('head')).reduce((n, b) => n + b.length, 0);
  font.writeUInt32BE((0xB1B0AFBA - sum(font)) >>> 0, headAt + 8);       // checkSumAdjustment
  return font;
}
const pdfHex = s => Buffer.from(String(s), 'utf16le').swap16().toString('hex').toUpperCase();
const pdfNum = n => { const v = Math.round(Number(n) * 1000) / 1000; return Number.isFinite(v) ? String(v) : '0'; };
/* the invisible text of one page: each painted line becomes one run of real
   text, placed and stretched to cover exactly where the picture shows it */
function pdfTextOps(texts, pageH){
  const out = [];
  for (const t of texts || []){
    const str = String(t && t.text || '');
    const units = str.length;                                            // UTF-16 code units, one glyph each
    const size = Number(t.size), w = Number(t.w);
    if (!units || !str.trim() || !(size > 0) || !(w > 0)) continue;
    const ang = -(Number(t.angle) || 0);                                 // the page's y axis points down, a PDF's points up
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const stretch = Math.max(1, Math.min(2000, 100 * w / (units * size * 0.5)));
    out.push(`BT /KPT ${pdfNum(size)} Tf ${pdfNum(stretch)} Tz ${pdfNum(cos)} ${pdfNum(sin)} ${pdfNum(-sin)} ${pdfNum(cos)} ` +
      `${pdfNum(t.x)} ${pdfNum(pageH - Number(t.y))} Tm <${pdfHex(str)}> Tj ET`);
  }
  return out.length ? '3 Tr\n' + out.join('\n') : '';
}
/* A PDF where each page is one JPEG, placed as-is (DCTDecode): the JPEG bytes
   are copied in untouched, never decoded or re-compressed. A page may also
   carry "texts": the lines painted on it, laid over the picture as invisible
   real text so the PDF can be searched, selected, copied and read aloud.
   pages: [{ bytes: Buffer (JPEG), w, h (page size in points), pxW, pxH, texts? }]
   info:  { title } */
function buildPDF(pages, info){
  const chunks = [];
  let offset = 0;
  const offs = [];
  const push = data => {
    const b = Buffer.isBuffer(data) ? data : Buffer.from(data, 'latin1');
    chunks.push(b); offset += b.length;
  };
  const obj = (n, body) => { offs[n] = offset; push(`${n} 0 obj\n${body}\nendobj\n`); };
  const streamObj = (n, dict, bytes) => {
    offs[n] = offset;
    push(`${n} 0 obj\n<< ${dict} /Length ${bytes.length} >>\nstream\n`);
    push(bytes);
    push('\nendstream\nendobj\n');
  };
  push('%PDF-1.4\n');
  push(Buffer.from([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));
  const n = pages.length;
  const pageObj = i => 3 + i * 3, contObj = i => 4 + i * 3, imgObj = i => 5 + i * 3;
  const ops = pages.map(p => pdfTextOps(p.texts, p.h));
  const hasText = ops.some(Boolean);
  let next = 3 + n * 3;
  const fontObj = hasText ? next : 0;                                    // + 5 more: CIDFont, map, ToUnicode, descriptor, file
  if (hasText) next += 6;
  const infoObj = next++;
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${n} >>`);
  pages.forEach((p, i) => {
    obj(pageObj(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.w} ${p.h}] ` +
      `/Resources << /XObject << /Im${i} ${imgObj(i)} 0 R >>${ops[i] ? ` /Font << /KPT ${fontObj} 0 R >>` : ''} >> /Contents ${contObj(i)} 0 R >>`);
    const stream = Buffer.from(`q ${p.w} 0 0 ${p.h} 0 0 cm /Im${i} Do Q` + (ops[i] ? '\n' + ops[i] : ''), 'latin1');
    streamObj(contObj(i), '', stream);
    streamObj(imgObj(i), `/Type /XObject /Subtype /Image /Width ${p.pxW} /Height ${p.pxH} ` +
      '/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', p.bytes);
  });
  if (hasText){
    const zlib = require('zlib');
    const font = glyphlessFont();
    obj(fontObj, `<< /Type /Font /Subtype /Type0 /BaseFont /KoralPaperText /Encoding /Identity-H ` +
      `/DescendantFonts [${fontObj + 1} 0 R] /ToUnicode ${fontObj + 3} 0 R >>`);
    obj(fontObj + 1, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /KoralPaperText ` +
      `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
      `/FontDescriptor ${fontObj + 4} 0 R /CIDToGIDMap ${fontObj + 2} 0 R /DW 500 >>`);
    streamObj(fontObj + 2, '/Filter /FlateDecode', zlib.deflateSync(Buffer.alloc(131072)));   // every code → the one empty glyph
    streamObj(fontObj + 3, '', Buffer.from(
      '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
      '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
      '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' +
      '1 beginbfrange\n<0000> <FFFF> <0000>\nendbfrange\n' +
      'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n', 'latin1'));
    obj(fontObj + 4, `<< /Type /FontDescriptor /FontName /KoralPaperText /Flags 5 /FontBBox [0 -200 500 800] ` +
      `/ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 800 /StemV 80 /FontFile2 ${fontObj + 5} 0 R >>`);
    streamObj(fontObj + 5, `/Length1 ${font.length}`, font);
  }
  const title = info && info.title ? ` /Title <FEFF${pdfHex(info.title)}>` : '';
  obj(infoObj, `<<${title} /Producer (KoralPaper) /Creator (KoralPaper) >>`);
  const total = next;
  const xrefOffset = offset;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) xref += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  push(xref);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info ${infoObj} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return Buffer.concat(chunks);
}
const appError = r => (r && r.error) ? new Error(r.error) : null;
async function runExport(args){
  const format = String(args.format || '').toLowerCase().replace('jpeg', 'jpg');
  if (!['pdf', 'png', 'jpg'].includes(format)) throw new Error('format must be pdf, png or jpg.');
  const scale = Number(args.scale) > 0 ? Math.max(0.25, Math.min(4, Number(args.scale))) : (format === 'pdf' ? 2 : 1);
  const dir = resolveExportFolder(args.folder);       // refuse a bad folder before any rendering
  const info = await call('export_info', {
    documentId: args.documentId,
    pageIds: Array.isArray(args.pageIds) ? args.pageIds : undefined,
  });
  if (appError(info)) throw appError(info);
  if (!info.pages || !info.pages.length) throw new Error('There are no pages to export.');
  const stem = safeFileStem(args.filenamePrefix, safeFileStem(info.name, 'koralpaper'));
  const pad = Math.max(2, String(info.totalPages || info.pages.length).length);
  const rendered = [];
  const wantText = format === 'pdf' && args.selectableText !== false;
  for (const p of info.pages){
    const r = await call('export_page', {
      documentId: info.documentId, pageId: p.id, format: format === 'png' ? 'png' : 'jpg', scale,
      texts: wantText,
    }, 90000);
    if (appError(r)) throw appError(r);
    rendered.push({ page: p, r, bytes: Buffer.from(r.data, 'base64') });
  }
  const files = [];
  if (format === 'pdf'){
    const file = freeName(dir, stem, 'pdf', args.overwrite === true);
    const pdf = buildPDF(rendered.map(x => ({
      bytes: x.bytes, w: x.r.w, h: x.r.h, pxW: x.r.pxW, pxH: x.r.pxH,
      texts: wantText && Array.isArray(x.r.texts) ? x.r.texts : null,
    })), { title: info.name });
    fs.writeFileSync(file, pdf);
    const textLines = rendered.reduce((n, x) => n + (wantText && Array.isArray(x.r.texts) ? x.r.texts.length : 0), 0);
    files.push({ path: file, bytes: pdf.length, selectableText: textLines > 0, textLines, pages: rendered.map(x => ({ number: x.page.number, id: x.page.id, name: x.page.name })) });
  } else {
    for (const x of rendered){
      const file = freeName(dir, `${stem}-${String(x.page.number).padStart(pad, '0')}`, format, args.overwrite === true);
      fs.writeFileSync(file, x.bytes);
      files.push({ path: file, bytes: x.bytes.length, page: x.page.number, pageId: x.page.id, name: x.page.name, width: x.r.pxW, height: x.r.pxH });
    }
  }
  return {
    ok: true, documentId: info.documentId, document: info.name, format, scale: rendered[0].r.scale,
    folder: dir, files, paths: files.map(f => f.path),
    pageSize: { w: rendered[0].r.w, h: rendered[0].r.h, pxW: rendered[0].r.pxW, pxH: rendered[0].r.pxH },
  };
}

/* ── MCP over stdio: newline-delimited JSON-RPC 2.0 ── */
function send(msg){ process.stdout.write(JSON.stringify(msg) + '\n'); }
function reply(id, result){ send({ jsonrpc: '2.0', id, result }); }
function replyErr(id, code, message){ send({ jsonrpc: '2.0', id, error: { code, message } }); }

const OLD_APP = 'The KoralPaper page in the browser is an older version that does not know this command. Reload the KoralPaper tab (or open the newest index.html), then try again.';
const NOT_LINKED = 'KoralPaper is not linked. Ask the user to open KoralPaper (index.html) in their browser: the app links to this bridge automatically within a few seconds.';

async function handleToolCall(id, name, args){
  const text = (t, isError) => reply(id, Object.assign({ content: [{ type: 'text', text: t }] }, isError ? { isError: true } : {}));
  try {
    if (!TOOLS.some(t => t.name === name)){ text('Unknown tool: ' + name, true); return; }
    if (name === 'koralpaper_status'){
      const linked = await bridgeAppConnected();
      if (!linked){ text(NOT_LINKED); return; }
      let info = null;
      try { info = await call('app_info', {}, 6000); } catch (e){ info = null; }
      if (info && info.app === 'koralpaper')
        text(`KoralPaper is open and linked (app v${info.appVersion}, connector v${SERVER_VERSION}). On screen: "${info.document}" (documentId ${info.documentId}, ${info.pages} page${info.pages === 1 ? '' : 's'}). Ready to draw.`);
      else
        text(`KoralPaper is open and linked, but the page in the browser is an older version: documents, versions, export, fonts and measure need the newest app. Ask the user to reload the KoralPaper tab. Drawing on the current page still works. (connector v${SERVER_VERSION})`);
      return;
    }
    if (name === 'koralpaper_export'){
      text(JSON.stringify(await runExport(args)));
      return;
    }
    const action = name.replace('koralpaper_', '');
    const result = await call(action, args);
    if (result && result.error){
      const msg = /^Unknown action/.test(result.error) ? OLD_APP : 'KoralPaper reported: ' + result.error;
      text(msg, true);
      return;
    }
    if (action === 'render_page' && result && result.png){
      reply(id, { content: [
        { type: 'image', data: result.png, mimeType: 'image/png' },
        { type: 'text', text: result.note || 'Current page render.' },
      ] });
      return;
    }
    text(JSON.stringify(result));
  } catch (e){
    const msg = String(e && e.message || e);
    text(/^Unknown action/.test(msg) ? OLD_APP : msg, true);
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
      serverInfo: { name: 'koralpaper', version: SERVER_VERSION },
      instructions: 'These tools draw directly in the KoralPaper app (a design studio for diagrams, slides and carousels) running in the user\'s browser. '
        + 'Workflow for new work: koralpaper_status → koralpaper_create_document (always start a carousel or deck in its own document, never on top of what is open) → koralpaper_set_styles and koralpaper_set_master if the design repeats → koralpaper_create_page (several pages in one call) → koralpaper_measure on text in fixed boxes → koralpaper_render_page to check each page with your own eyes → koralpaper_export. '
        + 'Workflow for existing work: koralpaper_read_document, keep each page\'s version, and pass documentId, pageId and ifVersion on every write; if a write is refused the user changed the page, so read again (or koralpaper_get_changes) before retrying. Check koralpaper_list_comments for requests, and take a koralpaper_snapshot before a big rework.',
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
