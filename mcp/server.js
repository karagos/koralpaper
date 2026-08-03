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

const PORT = 8137;
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
  res.writeHead(200, corsHeaders({ 'Content-Type': 'application/json' }));
  res.end(JSON.stringify(batch));
}

/* ── the localhost bridge the app talks to ── */
function corsHeaders(extra){
  return Object.assign({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  }, extra || {});
}
const server = http.createServer((req, res) => {
  appLastSeen = Date.now();
  if (req.method === 'OPTIONS'){
    res.writeHead(204, corsHeaders()); res.end(); return;
  }
  if (req.method === 'GET' && req.url.startsWith('/poll')){
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
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      try {
        const { id, result } = JSON.parse(body);
        const p = pending.get(id);
        if (p){ clearTimeout(p.timer); pending.delete(id); p.resolve(result); }
      } catch (e){}
      res.writeHead(200, corsHeaders({ 'Content-Type': 'application/json' }));
      res.end('{"ok":true}');
    });
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/status')){
    res.writeHead(200, corsHeaders({ 'Content-Type': 'application/json' }));
    res.end(JSON.stringify({ bridge: 'koralpaper', app: appConnected() }));
    return;
  }
  res.writeHead(404, corsHeaders()); res.end();
});
server.on('error', err => {
  // port already taken (a second Claude window?) — report via MCP errors
  process.stderr.write('KoralPaper bridge port error: ' + err.message + '\n');
});
server.listen(PORT, '127.0.0.1');

/* ── element schema shared by the drawing tools ── */
const STROKES = 'ink (black), gdark, gmid, glight, white, coral, blue, green, plum, none, or any #hex';
const FILLS = 'none, cream, white, coral, terracotta, blush, periwinkle, sage, butter, sky, glight, gmid, gdark, ink, or any #hex';
const ELEMENT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Your own short id (e.g. "start", "step2") so arrows and later updates can reference this element.' },
    type: { type: 'string', enum: ['rect', 'diamond', 'ellipse', 'chip', 'text', 'arrow', 'line'], description: 'rect = box/sticky, diamond = decision, ellipse = start/end, chip = small label pill, text = free text, arrow/line = connector.' },
    x: { type: 'number' }, y: { type: 'number' },
    w: { type: 'number' }, h: { type: 'number' },
    text: { type: 'string', description: 'Text inside the shape, the free text, or the label riding an arrow.' },
    stroke: { type: 'string', description: 'Outline / text color: ' + STROKES },
    fill: { type: 'string', description: 'Fill color: ' + FILLS },
    fillStyle: { type: 'string', enum: ['solid', 'hachure', 'dense', 'cross', 'dots', 'waves'] },
    dash: { type: 'string', enum: ['solid', 'dotted', 'dashed'] },
    size: { type: 'number', description: 'Font size in px (default 21; 16 for chips and arrow labels).' },
    font: { type: 'string', description: 'serif, sans, hand, or a Google font key like playfair, spacegrotesk, caveat.' },
    align: { type: 'string', enum: ['left', 'center', 'right'] },
    sketch: { type: 'number', description: '1 = hand-drawn wobble (default), 0 = neat straight lines.' },
    from: { type: 'string', description: 'Arrows only: id of the shape this arrow starts from (it glues to the border and follows).' },
    to: { type: 'string', description: 'Arrows only: id of the shape this arrow points to.' },
    elbow: { type: 'boolean', description: 'Arrows only: true = right-angle elbow route instead of a straight/curved line.' },
    x2: { type: 'number', description: 'Unbound arrows/lines only: end point x (start is x,y).' },
    y2: { type: 'number', description: 'Unbound arrows/lines only: end point y.' },
  },
  required: ['type'],
};
const COORDS_HELP = 'Coordinates: y grows downward, origin is the artboard top-left. Typical shape: 190 wide × 92 tall; leave 100 to 120 px gaps. On a 1920×1080 board keep everything inside 60 px margins.';

const TOOLS = [
  {
    name: 'koralpaper_status',
    description: 'Check whether the KoralPaper app is open and linked. Call this first if unsure.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'koralpaper_read_document',
    description: 'Read the current KoralPaper document: every page with its elements (positions, sizes, text, colors, arrow connections). Use it before editing so you work with what is really on the paper.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'koralpaper_create_page',
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
    description: 'Add elements to the CURRENT page (read the document first to see what is there and where free space is). Same element format as koralpaper_create_page. ' + COORDS_HELP,
    inputSchema: {
      type: 'object',
      properties: { elements: { type: 'array', items: ELEMENT_SCHEMA } },
      required: ['elements'],
    },
  },
  {
    name: 'koralpaper_update_elements',
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
    description: 'Delete elements from the current page by id.',
    inputSchema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' } } },
      required: ['ids'],
    },
  },
  {
    name: 'koralpaper_render_page',
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
      const linked = appConnected();
      reply(id, { content: [{ type: 'text', text: linked
        ? 'KoralPaper is open and linked. Ready to draw.'
        : 'KoralPaper is not linked. Ask the user to open KoralPaper (index.html) in their browser — the app links to this bridge automatically within a few seconds.' }] });
      return;
    }
    const action = name.replace('koralpaper_', '');
    const result = await dispatch(action, args);
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
      serverInfo: { name: 'koralpaper', version: '1.0.0' },
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
