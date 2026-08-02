/* KoralPaper — app layer: input, selection, snapping, history, UI. */
'use strict';

/* ── DOM ───────────────────────────────────────────── */
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const editorEl = document.getElementById('textEditor');
const fileInput = document.getElementById('fileInput');
const hintEl = document.getElementById('hint');
const $ = id => document.getElementById(id);

/* ── state ─────────────────────────────────────────── */
const state = {
  elements: [],          // elements of the ACTIVE page (alias into pages[pageIndex])
  pages: [],             // [{id, name, elements}]
  pageIndex: 0,
  tool: 'select',
  selection: new Set(),
  camera: { x: 0, y: 0, z: 1 },
  grid: 'grid',          // 'grid' | 'dots' | 'off'
  gridSize: 22,
  snap: true,
  theme: 'light',
  bgColor: null,         // custom paper color (hex) or null = theme default
  board: null,           // {name,w,h,x,y} artboard, or null = unlimited canvas
};
/* user-adjustable width + text-size presets (Settings panel), persisted separately */
const SETTINGS_KEY = 'koralpaper.settings';
const DEFAULT_WIDTHS = { fine: 1.7, medium: 3.3, thick: 5 };
const DEFAULT_SIZES = { s: 16, m: 21, l: 29, xl: 42 };
const widths = { ...DEFAULT_WIDTHS };
const sizes = { ...DEFAULT_SIZES };
try {
  const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  if (s.widths) for (const k of Object.keys(DEFAULT_WIDTHS))
    if (typeof s.widths[k] === 'number') widths[k] = clamp(s.widths[k], 0.5, 14);
  if (s.sizes) for (const k of Object.keys(DEFAULT_SIZES))
    if (typeof s.sizes[k] === 'number') sizes[k] = clamp(Math.round(s.sizes[k]), 8, 160);
} catch (e){ /* fresh settings */ }
function saveSettings(){
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ widths, sizes })); } catch (e){}
}

const defaults = {
  stroke:'ink', fill:'cream', fillStyle:'solid', dash:'solid', sw:widths.medium, sketch:1, round:1,
  opacity:100, font:'sans', size:sizes.m, align:'center',
  curve:0, elbow:false, startHead:'none', endHead:'arrow',
  fillByType: { rect:'cream', diamond:'cream', ellipse:'cream', chip:'periwinkle', icon:'none' },
};
let iconKind = 'asterisk'; // last-picked stamp from the icon menu
const GRID = 22;
const gsize = () => state.gridSize || GRID;
const STORE_KEY = 'asterisk.sketch.v1';

let interaction = null;      // current pointer gesture
let guides = [];             // snap guide lines to draw
let bindHover = null;        // shape id highlighted as arrow-glue target
let bindHoverAnchor = null;  // 'n'|'e'|'s'|'w' when an anchor dot is magnetized
let editing = null;          // { el, isNew }
let cropTarget = null;       // element id while crop mode is armed
let clipboard = null;        // serialized elements
let pasteCount = 0;
let spaceDown = false;
let history = [];
let histIndex = -1;
let renderQueued = false;

const pal = () => PALETTES[state.theme];
const effectiveBg = () => state.bgColor || pal().bg;
function effectiveGridColor(){
  if (!state.bgColor) return pal().grid;
  const n = parseInt(state.bgColor.slice(1), 16);
  const lum = (0.299*((n>>16)&255) + 0.587*((n>>8)&255) + 0.114*(n&255)) / 255;
  return lum > 0.5 ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.10)';
}
function outsideColor(){
  // the dimmed area around an artboard, derived from the paper color
  const bg = effectiveBg();
  const n = parseInt(bg.slice(1), 16);
  let r = (n>>16)&255, g = (n>>8)&255, b = n&255;
  const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
  const f = c => clamp(Math.round(lum > 0.5 ? c * 0.92 : c + (255 - c) * 0.09), 0, 255);
  return '#' + ((1<<24) + (f(r)<<16) + (f(g)<<8) + f(b)).toString(16).slice(1);
}

/* upgrade scenes saved by older versions.
   v<2: type 'asterisk' → icon; asterisks were stroke-colored spikes — the new
   capsule-ray asterisk paints its body with FILL, so move the color over. */
function migrateElements(els, ver){
  const v = ver || 1;
  for (const el of els){
    if (el.type === 'asterisk'){ el.type = 'icon'; el.kind = 'asterisk'; }
    if (el.type === 'icon' && !el.kind) el.kind = 'asterisk';
    if (!el.dash) el.dash = 'solid';
    // legacy boolean arrowheads → named head kinds
    if (el.startHead === undefined && 'startArrow' in el){
      el.startHead = el.startArrow ? 'arrow' : 'none';
      el.endHead = el.endArrow ? 'arrow' : 'none';
      delete el.startArrow; delete el.endArrow;
    }
    if (v < 2 && el.type === 'icon' && el.kind === 'asterisk' && (!el.fill || el.fill === 'none')){
      el.fill = (el.stroke && el.stroke !== 'none') ? el.stroke : 'coral';
      el.stroke = 'none';
    }
    if (v < 4){
      // pre-v3.1 presets (1.2 / 2 / 4) → current stages
      if (el.sw === 1.2) el.sw = 1.7;
      else if (el.sw === 2) el.sw = 3.3;
      else if (el.sw === 4) el.sw = 5;
    } else if (v === 4){
      // the short-lived v3.1.0 presets (2 / 4 / 6) → current stages
      if (el.sw === 2) el.sw = 1.7;
      else if (el.sw === 4) el.sw = 3.3;
      else if (el.sw === 6) el.sw = 5;
    }
  }
  return els;
}
const byId = id => state.elements.find(e => e.id === id);
const selected = () => state.elements.filter(e => state.selection.has(e.id));

/* ── camera ────────────────────────────────────────── */
function toScene(px, py){
  return [(px - state.camera.x) / state.camera.z, (py - state.camera.y) / state.camera.z];
}
function toScreen(sx, sy){
  return [sx * state.camera.z + state.camera.x, sy * state.camera.z + state.camera.y];
}
function zoomAt(px, py, factor){
  const z = clamp(state.camera.z * factor, 0.1, 6);
  const [sx, sy] = toScene(px, py);
  state.camera.z = z;
  state.camera.x = px - sx * z;
  state.camera.y = py - sy * z;
  if (editing) positionEditor(); // keep the text editor glued to its shape
  syncZoomLabel(); requestRender(); scheduleAutosave();
}
function zoomToFit(){
  if (canvas.clientWidth < 50 || canvas.clientHeight < 50){
    // layout not ready (hidden/backgrounded tab) — try again next frame
    requestAnimationFrame(zoomToFit);
    return;
  }
  const b = state.board
    ? { x: state.board.x, y: state.board.y, w: state.board.w, h: state.board.h }
    : sceneBounds(state.elements);
  if (!b) { state.camera = { x: 0, y: 0, z: 1 }; }
  else {
    const pad = 90;
    const z = clamp(Math.min(
      (canvas.clientWidth - pad*2) / (b.w || 1),
      (canvas.clientHeight - pad*2) / (b.h || 1)), 0.1, 2.2);
    state.camera.z = z;
    state.camera.x = (canvas.clientWidth - b.w * z) / 2 - b.x * z;
    state.camera.y = (canvas.clientHeight - b.h * z) / 2 - b.y * z;
  }
  syncZoomLabel(); requestRender(); scheduleAutosave();
}
function syncZoomLabel(){ $('zoomLabel').textContent = Math.round(state.camera.z * 100) + '%'; }

/* ── rendering ─────────────────────────────────────── */
function requestRender(){
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

function render(){
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr){
    canvas.width = w * dpr; canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderScene(ctx, state.elements, {
    width: w, height: h, camera: state.camera, pal: pal(),
    grid: state.grid, gridSize: gsize(),
    bg: effectiveBg(), gridColor: effectiveGridColor(),
    board: state.board, outside: state.board ? outsideColor() : null,
  });
  drawOverlay();
}

function drawOverlay(){
  const p = pal();
  const z = state.camera.z;
  ctx.save();
  ctx.translate(state.camera.x, state.camera.y);
  ctx.scale(z, z);

  // artboard label
  if (state.board){
    ctx.font = `600 ${12/z}px ${FONTS.sans.stack}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = state.theme === 'light' ? 'rgba(32,29,24,.55)' : 'rgba(236,231,218,.55)';
    ctx.fillText(`${state.board.name} · ${state.board.w} × ${state.board.h}`,
      state.board.x, state.board.y - 8/z);
  }

  // arrow glue target highlight + its 4 anchor dots
  if (bindHover){
    const el = byId(bindHover);
    if (el){
      const b = boundsOf(el);
      ctx.save();
      if (el.angle){
        const cx = b.x+b.w/2, cy = b.y+b.h/2;
        ctx.translate(cx,cy); ctx.rotate(el.angle); ctx.translate(-cx,-cy);
      }
      ctx.strokeStyle = p.bindHint;
      ctx.lineWidth = 2.5 / z;
      ctx.setLineDash([6/z, 5/z]);
      ctx.strokeRect(b.x - 5, b.y - 5, b.w + 10, b.h + 10);
      ctx.restore();
      ctx.setLineDash([]);
      for (const a of anchorPoints(el)){
        const active = a.key === bindHoverAnchor;
        ctx.beginPath();
        ctx.arc(a.x, a.y, (active ? 5.5 : 3.8) / z, 0, TAU);
        ctx.fillStyle = active ? p.bindHint : (state.theme === 'light' ? '#FFFDF7' : '#3A362F');
        ctx.strokeStyle = p.bindHint;
        ctx.lineWidth = 1.6 / z;
        ctx.fill(); ctx.stroke();
      }
    }
  }

  // per-element selection outlines
  const sel = selected();
  for (const el of sel){
    const b = boundsOf(el);
    ctx.save();
    if (el.angle){
      const cx = b.x+b.w/2, cy = b.y+b.h/2;
      ctx.translate(cx,cy); ctx.rotate(el.angle); ctx.translate(-cx,-cy);
    }
    ctx.strokeStyle = p.select;
    ctx.lineWidth = 1.2 / z;
    ctx.setLineDash([4/z, 4/z]);
    ctx.strokeRect(b.x - 4/z, b.y - 4/z, b.w + 8/z, b.h + 8/z);
    ctx.restore();
  }

  // combined bbox + handles
  if (sel.length && !editing){
    const sb = selectionBounds();
    ctx.setLineDash([]);
    const single = sel.length === 1 ? sel[0] : null;
    const showLineHandles = single && isLinear(single) && single.type !== 'draw';
    if (!showLineHandles){
      ctx.strokeStyle = p.select;
      ctx.lineWidth = 1.6 / z;
      ctx.strokeRect(sb.x, sb.y, sb.w, sb.h);
      const hs = 9 / z;
      for (const [hx, hy] of handlePositions(sb)){
        ctx.fillStyle = state.theme === 'light' ? '#FFFDF7' : '#3A362F';
        ctx.strokeStyle = p.select;
        ctx.lineWidth = 1.5 / z;
        ctx.beginPath();
        ctx.rect(hx - hs/2, hy - hs/2, hs, hs);
        ctx.fill(); ctx.stroke();
      }
      // rotation handle
      const [rx, ry] = rotHandlePos(sb);
      ctx.beginPath();
      ctx.arc(rx, ry, 5.5/z, 0, TAU);
      ctx.fillStyle = state.theme === 'light' ? '#FFFDF7' : '#3A362F';
      ctx.fill(); ctx.stroke();
    } else {
      const pts = [single.points[0], single.points[single.points.length-1]];
      for (const [ppx, ppy] of pts){
        ctx.beginPath();
        ctx.arc(single.x + ppx, single.y + ppy, 6/z, 0, TAU);
        ctx.fillStyle = state.theme === 'light' ? '#FFFDF7' : '#3A362F';
        ctx.strokeStyle = p.select;
        ctx.lineWidth = 1.6/z;
        ctx.fill(); ctx.stroke();
      }
      if (single.elbow){
        // one handle per segment — drag any of them to slide that segment
        for (const h of elbowSegHandles(single)){
          ctx.beginPath();
          ctx.arc(h.x, h.y, 5/z, 0, TAU);
          ctx.fillStyle = p.select;
          ctx.strokeStyle = state.theme === 'light' ? '#FFFDF7' : '#3A362F';
          ctx.lineWidth = 1.6/z;
          ctx.fill(); ctx.stroke();
        }
      } else {
        // middle handle: drag to bend the line
        const [mx, my] = linearMidpoint(single);
        ctx.beginPath();
        ctx.arc(mx, my, 5/z, 0, TAU);
        ctx.fillStyle = p.select;
        ctx.strokeStyle = state.theme === 'light' ? '#FFFDF7' : '#3A362F';
        ctx.lineWidth = 1.6/z;
        ctx.fill(); ctx.stroke();
      }
    }
  }

  // crop mode: highlight the target, then the dragged keep-region
  if (cropTarget){
    const el = byId(cropTarget);
    if (el){
      const b = boundsOf(el);
      ctx.strokeStyle = p.bindHint;
      ctx.lineWidth = 2 / z;
      ctx.setLineDash([7/z, 5/z]);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.setLineDash([]);
    }
  }
  if (interaction && interaction.kind === 'crop'){
    const { x0, y0, x1, y1 } = interaction;
    ctx.fillStyle = state.theme === 'light' ? 'rgba(201,100,66,0.10)' : 'rgba(222,139,107,0.14)';
    ctx.strokeStyle = p.select;
    ctx.lineWidth = 1.5 / z;
    const rx = Math.min(x0, x1), ry = Math.min(y0, y1);
    ctx.fillRect(rx, ry, Math.abs(x1-x0), Math.abs(y1-y0));
    ctx.strokeRect(rx, ry, Math.abs(x1-x0), Math.abs(y1-y0));
  }

  // marquee
  if (interaction && interaction.kind === 'marquee'){
    const { x0, y0, x1, y1 } = interaction;
    ctx.fillStyle = state.theme === 'light' ? 'rgba(201,100,66,0.08)' : 'rgba(222,139,107,0.12)';
    ctx.strokeStyle = p.select;
    ctx.lineWidth = 1 / z;
    ctx.setLineDash([5/z, 4/z]);
    const rx = Math.min(x0,x1), ry = Math.min(y0,y1);
    ctx.fillRect(rx, ry, Math.abs(x1-x0), Math.abs(y1-y0));
    ctx.strokeRect(rx, ry, Math.abs(x1-x0), Math.abs(y1-y0));
    ctx.setLineDash([]);
  }

  // alignment guides
  if (guides.length){
    ctx.strokeStyle = p.guide;
    ctx.lineWidth = 1 / z;
    ctx.setLineDash([6/z, 5/z]);
    const [vx0, vy0] = toScene(0, 0);
    const [vx1, vy1] = toScene(canvas.clientWidth, canvas.clientHeight);
    for (const g of guides){
      ctx.beginPath();
      if (g.dir === 'v'){ ctx.moveTo(g.pos, vy0); ctx.lineTo(g.pos, vy1); }
      else { ctx.moveTo(vx0, g.pos); ctx.lineTo(vx1, g.pos); }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function selectionBounds(){
  const sel = selected();
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  for (const el of sel){
    const b = boundsWithRotation(el);
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  }
  return { x:minX, y:minY, w:maxX-minX, h:maxY-minY };
}
function handlePositions(b){
  return [
    [b.x, b.y], [b.x+b.w/2, b.y], [b.x+b.w, b.y],
    [b.x+b.w, b.y+b.h/2], [b.x+b.w, b.y+b.h],
    [b.x+b.w/2, b.y+b.h], [b.x, b.y+b.h], [b.x, b.y+b.h/2],
  ];
}
const HANDLE_KEYS = ['nw','n','ne','e','se','s','sw','w'];
function rotHandlePos(b){ return [b.x + b.w/2, b.y - 26/state.camera.z]; }
function linearMidpoint(el){
  return pathMidpoint(linearPathPoints(el));
}
/* one draggable handle per elbow segment — EVERY segment gets one (tiny
   stubs excluded so handles don't sit on top of the endpoint circles) */
function elbowSegHandles(el){
  const { corners } = elbowRoute(el);
  const out = [];
  for (let s = 0; s <= corners.length - 2; s++){
    const a = corners[s], b = corners[s+1];
    if (Math.hypot(b[0]-a[0], b[1]-a[1]) < 24) continue;
    out.push({ seg: s, x: (a[0]+b[0])/2, y: (a[1]+b[1])/2,
      horizontal: Math.abs(a[1]-b[1]) <= Math.abs(a[0]-b[0]) });
  }
  return out;
}

/* ── history + persistence (document-level: all pages) ── */
function syncPageRef(){
  if (state.pages.length) state.pages[state.pageIndex].elements = state.elements;
}
function makePage(elements, name){
  return { id: uid(), name: name || `Page ${state.pages.length + 1}`, elements: elements || [] };
}
function serialize(){
  syncPageRef();
  return JSON.stringify({ pages: state.pages, pageIndex: state.pageIndex },
    (k, v) => k.startsWith('_') ? undefined : v);
}
function commit(){
  history = history.slice(0, histIndex + 1);
  history.push(serialize());
  if (history.length > 120) history.shift();
  histIndex = history.length - 1;
  syncHistoryButtons();
  scheduleAutosave();
  scheduleThumbRefresh();
  preloadDocFonts(); // any newly-referenced Google font starts downloading
}
function restore(json){
  const doc = JSON.parse(json);
  state.pages = doc.pages;
  state.pageIndex = clamp(doc.pageIndex, 0, doc.pages.length - 1);
  state.elements = state.pages[state.pageIndex].elements;
  const ids = new Set(state.elements.map(e => e.id));
  state.selection = new Set([...state.selection].filter(id => ids.has(id)));
  updateBoundArrows(state.elements);
  buildPageStrip();
  syncPanel(); requestRender(); scheduleAutosave();
}
function undo(){ if (histIndex > 0){ histIndex--; restore(history[histIndex]); syncHistoryButtons(); } }
function redo(){ if (histIndex < history.length - 1){ histIndex++; restore(history[histIndex]); syncHistoryButtons(); } }
function syncHistoryButtons(){
  $('undoBtn').disabled = histIndex <= 0;
  $('redoBtn').disabled = histIndex >= history.length - 1;
}

let autosaveTimer = null;
function scheduleAutosave(){
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      const doc = JSON.parse(serialize());
      localStorage.setItem(STORE_KEY, JSON.stringify({
        v: 5, appVersion: APP_VERSION,
        pages: doc.pages, pageIndex: doc.pageIndex,
        camera: state.camera, grid: state.grid, gridSize: state.gridSize, snap: state.snap,
        theme: state.theme, bgColor: state.bgColor, board: state.board,
      }));
    } catch (e) { /* storage full/unavailable — sketch still lives in memory */ }
  }, 350);
}
function loadSaved(){
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (Array.isArray(data.pages) && data.pages.length){
      state.pages = data.pages.map(p => ({
        id: p.id || uid(), name: p.name || 'Page',
        elements: migrateElements(p.elements || [], data.v),
      }));
      state.pageIndex = clamp(Number(data.pageIndex) || 0, 0, state.pages.length - 1);
    } else if (Array.isArray(data.elements)){
      state.pages = [{ id: uid(), name: 'Page 1', elements: migrateElements(data.elements, data.v) }];
      state.pageIndex = 0;
    } else return false;
    state.elements = state.pages[state.pageIndex].elements;
    if (data.camera) state.camera = data.camera;
    state.grid = typeof data.grid === 'string' ? data.grid : (data.grid !== false ? 'grid' : 'off');
    state.gridSize = clamp(Number(data.gridSize) || GRID, 6, 120);
    state.snap = data.snap !== false;
    state.theme = data.theme === 'dark' ? 'dark' : 'light';
    state.bgColor = (typeof data.bgColor === 'string' && data.bgColor[0] === '#') ? data.bgColor : null;
    state.board = (data.board && data.board.w > 0 && data.board.h > 0) ? data.board : null;
    return true;
  } catch (e){ return false; }
}

/* ── snapping ──────────────────────────────────────── */
function snapMovingBounds(b, dx, dy, ignoreIds){
  guides = [];
  let outDx = dx, outDy = dy;
  if (state.grid !== 'off'){
    const gs = gsize() / 2;
    outDx = Math.round((b.x + dx) / gs) * gs - b.x;
    outDy = Math.round((b.y + dy) / gs) * gs - b.y;
  }
  if (state.snap){
    const thresh = 6 / state.camera.z;
    const movedXs = [b.x + dx, b.x + b.w/2 + dx, b.x + b.w + dx];
    const movedYs = [b.y + dy, b.y + b.h/2 + dy, b.y + b.h + dy];
    let bestX = null, bestY = null;
    for (const el of state.elements){
      if (ignoreIds.has(el.id)) continue;
      const ob = boundsWithRotation(el);
      const oxs = [ob.x, ob.x + ob.w/2, ob.x + ob.w];
      const oys = [ob.y, ob.y + ob.h/2, ob.y + ob.h];
      for (const mx of movedXs) for (const ox of oxs){
        const d = Math.abs(mx - ox);
        if (d < thresh && (!bestX || d < bestX.d)) bestX = { d, delta: ox - mx, pos: ox };
      }
      for (const my of movedYs) for (const oy of oys){
        const d = Math.abs(my - oy);
        if (d < thresh && (!bestY || d < bestY.d)) bestY = { d, delta: oy - my, pos: oy };
      }
    }
    if (bestX){ outDx += bestX.delta; guides.push({ dir:'v', pos: bestX.pos }); }
    if (bestY){ outDy += bestY.delta; guides.push({ dir:'h', pos: bestY.pos }); }
  }
  return [outDx, outDy];
}
function snapPoint(sx, sy){
  if (state.grid === 'off') return [sx, sy];
  const gs = gsize() / 2;
  return [Math.round(sx / gs) * gs, Math.round(sy / gs) * gs];
}

/* ── selection helpers ─────────────────────────────── */
function expandGroups(ids){
  const out = new Set(ids);
  const gids = new Set();
  for (const id of ids){
    const el = byId(id);
    if (el && el.groupId) gids.add(el.groupId);
  }
  for (const el of state.elements) if (el.groupId && gids.has(el.groupId)) out.add(el.id);
  return out;
}
function setSelection(ids){
  state.selection = expandGroups(ids);
  syncPanel(); requestRender();
}
function topElementAt(sx, sy){
  for (let i = state.elements.length - 1; i >= 0; i--){
    if (hitTest(state.elements[i], sx, sy, state.camera.z)) return state.elements[i];
  }
  return null;
}
/* what would an arrow endpoint glue to at (sx,sy)?
   anchor dots (N/E/S/W) win within their magnet radius; the shape body is
   the fallback and produces an auto (center-directed) binding. */
function findBindTarget(sx, sy, excludeId){
  const near = 15 / state.camera.z;
  let best = null;
  for (let i = state.elements.length - 1; i >= 0; i--){
    const el = state.elements[i];
    if (el.id === excludeId || !isShape(el)) continue;
    for (const a of anchorPoints(el)){
      const d = dist(sx, sy, a.x, a.y);
      if (d < near && (!best || d < best.d)) best = { el, anchor: a.key, x: a.x, y: a.y, d };
    }
  }
  if (best) return best;
  for (let i = state.elements.length - 1; i >= 0; i--){
    const el = state.elements[i];
    if (el.id === excludeId || !isShape(el)) continue;
    if (pointInShape(el, sx, sy, 10 / state.camera.z)) return { el, anchor: null };
  }
  return null;
}

/* ── tools + hints ─────────────────────────────────── */
const HINTS = {
  select: '', hand: 'Drag to pan around the paper',
  rect: 'Drag to draw a sticky note — double-click it later to type',
  diamond: 'Drag to draw a diamond', ellipse: 'Drag to draw an ellipse',
  chip: 'Drag to place a label chip — double-click to name it',
  icon: 'Drag to stamp the icon — click the ✳ button again to pick another',
  arrow: 'Drag between shapes — aim for the side dots to pin the arrow to a side',
  line: 'Drag to draw a line', draw: 'Draw freely — it keeps your hand',
  text: 'Click anywhere and start typing',
};
function setTool(tool){
  state.tool = tool;
  document.querySelectorAll('.toolbtn').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  canvas.className = 'tool-' + tool;
  showHint(HINTS[tool] || '');
  if (tool !== 'select'){ state.selection = new Set(); }
  syncPanel(); requestRender();
}
let hintTimer = null;
function showHint(text){
  clearTimeout(hintTimer);
  if (!text){ hintEl.classList.remove('show'); return; }
  hintEl.textContent = text;
  hintEl.classList.add('show');
  hintTimer = setTimeout(() => hintEl.classList.remove('show'), 4200);
}

/* ── pointer input ─────────────────────────────────── */
canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', onPointerUp);
canvas.addEventListener('dblclick', onDblClick);

function onPointerDown(ev){
  setRouteContext(state.elements); // thumbnails may have re-pointed the router
  if (editing) commitTextEdit();
  closeMenus();
  canvas.setPointerCapture(ev.pointerId);
  const [sx, sy] = toScene(ev.clientX, ev.clientY);

  if (ev.button === 1 || spaceDown || state.tool === 'hand'){
    interaction = { kind:'pan', startX: ev.clientX, startY: ev.clientY,
      camX: state.camera.x, camY: state.camera.y };
    canvas.classList.add('panning');
    return;
  }
  if (ev.button !== 0) return;

  if (cropTarget){
    const el = byId(cropTarget);
    if (!el){ endCropMode(); return; }
    interaction = { kind: 'crop', el, x0: sx, y0: sy, x1: sx, y1: sy };
    return;
  }

  if (state.tool === 'select'){
    const sel = selected();
    if (sel.length){
      const sb = selectionBounds();
      const z = state.camera.z;
      const single = sel.length === 1 ? sel[0] : null;
      const showLineHandles = single && isLinear(single) && single.type !== 'draw';
      if (showLineHandles){
        const ends = [0, single.points.length - 1];
        for (const idx of ends){
          const [ppx, ppy] = single.points[idx];
          if (dist(sx, sy, single.x + ppx, single.y + ppy) < 10 / z){
            interaction = { kind:'endpoint', el: single, idx };
            return;
          }
        }
        if (single.elbow){
          for (const h of elbowSegHandles(single)){
            if (dist(sx, sy, h.x, h.y) < 10 / z){
              // first drag materializes the route into editable corners
              if (!single.elbowPts || !single.elbowPts.length){
                const corners = elbowRoute(single).corners;
                single.elbowPts = corners.slice(1, -1)
                  .map(([cx, cy]) => [cx - single.x, cy - single.y]);
              }
              // dragging a segment that touches an endpoint splits off a
              // stub corner there, so the endpoint stays glued while the
              // segment slides (covers first, last, and single-segment)
              let seg = h.seg;
              if (seg === 0){
                single.elbowPts.unshift([...single.points[0]]);
                seg = 1;
              }
              if (seg > single.elbowPts.length - 1)
                single.elbowPts.push([...single.points[single.points.length - 1]]);
              interaction = { kind:'elbowSeg', el: single, seg, horizontal: h.horizontal };
              return;
            }
          }
        } else {
          const [mx, my] = linearMidpoint(single);
          if (dist(sx, sy, mx, my) < 10 / z){
            const a = single.points[0], b2 = single.points[single.points.length - 1];
            interaction = { kind:'curve', el: single,
              A: [single.x + a[0], single.y + a[1]],
              B: [single.x + b2[0], single.y + b2[1]] };
            return;
          }
        }
      } else {
        const [rx, ry] = rotHandlePos(sb);
        if (dist(sx, sy, rx, ry) < 10 / z){
          interaction = { kind:'rotate', center: [sb.x + sb.w/2, sb.y + sb.h/2],
            orig: sel.map(e => ({ id: e.id, angle: e.angle || 0 })) };
          return;
        }
        const hs = handlePositions(sb);
        for (let i = 0; i < hs.length; i++){
          if (dist(sx, sy, hs[i][0], hs[i][1]) < 9 / z){
            interaction = makeResize(sel, sb, HANDLE_KEYS[i], ev.shiftKey);
            return;
          }
        }
      }
    }
    const hit = topElementAt(sx, sy);
    if (hit){
      let ids;
      if (ev.shiftKey){
        ids = new Set(state.selection);
        const grp = expandGroups(new Set([hit.id]));
        const already = state.selection.has(hit.id);
        for (const id of grp) already ? ids.delete(id) : ids.add(id);
        setSelection(ids);
        return;
      }
      if (!state.selection.has(hit.id)) setSelection(new Set([hit.id]));
      let movingEls = selected();
      if (ev.altKey){
        movingEls = duplicateElements(movingEls, 0, 0);
        setSelection(new Set(movingEls.map(e => e.id)));
      }
      interaction = {
        kind:'move', startX: sx, startY: sy, moved: false,
        bbox: selectionBounds(),
        ids: new Set(movingEls.map(e => e.id)),
        orig: movingEls.map(e => ({ id: e.id, x: e.x, y: e.y })),
      };
      return;
    }
    interaction = { kind:'marquee', x0: sx, y0: sy, x1: sx, y1: sy, keep: ev.shiftKey ? new Set(state.selection) : new Set() };
    if (!ev.shiftKey) setSelection(new Set());
    return;
  }

  if (state.tool === 'text'){
    const el = newElement('text', sx, sy, {
      stroke: defaults.stroke === 'paper' ? 'ink' : defaults.stroke,
      font: defaults.font, size: defaults.size, align: 'left', opacity: defaults.opacity,
    });
    autosizeText(el);
    state.elements.push(el);
    openTextEditor(el, true);
    interaction = null;
    return;
  }

  // creation tools
  const [gx, gy] = snapPoint(sx, sy);
  const style = {
    stroke: defaults.stroke, fillStyle: defaults.fillStyle, sw: defaults.sw,
    sketch: defaults.sketch, round: defaults.round, opacity: defaults.opacity,
    font: defaults.font, size: state.tool === 'chip' ? Math.min(defaults.size, 16) : defaults.size,
    align: defaults.align,
  };
  if (['rect','diamond','ellipse','chip','icon'].includes(state.tool)){
    style.fill = defaults.fillByType[state.tool] || defaults.fill;
  }
  if (state.tool === 'icon'){
    style.kind = iconKind;
    style.dash = defaults.dash;
    if (iconKind === 'asterisk'){
      // brand look by default: solid coral, no outline — unless the user
      // already picked their own stroke/fill for icons
      if (defaults.stroke === 'ink') style.stroke = 'none';
      if ((defaults.fillByType.icon || 'none') === 'none') style.fill = 'coral';
    }
    if (iconKind === 'paperast' || iconKind === 'paperstroke' || iconKind === 'paperthought'){
      // two-tone brand marks: ink page + coral mark
      if (defaults.stroke === 'none') style.stroke = 'ink';
      if ((defaults.fillByType.icon || 'none') === 'none') style.fill = 'coral';
    }
    if (iconKind === 'material'){
      if (defaults.stroke === 'none') style.stroke = 'ink';
      style.glyphName = materialName;
      style.mpath = miMem.get(materialName) || '';
    }
  } else {
    style.dash = defaults.dash;
  }
  const el = newElement(state.tool, gx, gy, style);
  if (el.type === 'icon' && el.kind === 'material' && !el.mpath && el.glyphName){
    // path not cached yet — fill it in as soon as the fetch lands
    miFetch(el.glyphName)
      .then(d => { el.mpath = d; requestRender(); scheduleAutosave(); })
      .catch(() => showHint('Could not load that icon — internet is needed once per icon'));
  }
  if (isLinear(el)){
    el.curve = (el.type === 'arrow') ? defaults.curve : 0;
    el.elbow = (el.type === 'arrow' || el.type === 'line') ? !!defaults.elbow : false;
    el.startHead = el.type === 'arrow' ? defaults.startHead : 'none';
    el.endHead = el.type === 'arrow' ? defaults.endHead : 'none';
    el.points = [[0,0],[0,0]];
    if (el.type === 'draw'){ el.points = [[0,0]]; el.sketch = defaults.sketch; }
  }
  state.elements.push(el);
  let startInfo = null;
  if (el.type === 'arrow' || el.type === 'line'){
    startInfo = findBindTarget(sx, sy, el.id);
    if (startInfo && startInfo.anchor){ el.x = startInfo.x; el.y = startInfo.y; }
  }
  interaction = {
    kind:'create', el,
    startX: startInfo && startInfo.anchor ? el.x : gx,
    startY: startInfo && startInfo.anchor ? el.y : gy,
    rawStartX: sx, rawStartY: sy,
    startBind: startInfo ? startInfo.el.id : null,
    startAnchor: startInfo ? startInfo.anchor : null,
    moved: false,
  };
}

function makeResize(sel, sb, handle, shiftKey){
  return {
    kind:'resize', handle, startB: { ...sb },
    orig: sel.map(e => ({
      id: e.id, x: e.x, y: e.y, w: e.w, h: e.h, size: e.size,
      points: e.points ? e.points.map(p => p.slice()) : null,
    })),
  };
}

function onPointerMove(ev){
  const [sx, sy] = toScene(ev.clientX, ev.clientY);
  if (!interaction){
    if ((state.tool === 'arrow' || state.tool === 'line') && !editing){
      const t = findBindTarget(sx, sy, null);
      const next = t ? t.el.id : null;
      const nextA = t ? t.anchor : null;
      if (next !== bindHover || nextA !== bindHoverAnchor){
        bindHover = next; bindHoverAnchor = nextA; requestRender();
      }
    } else if (bindHover){ bindHover = null; bindHoverAnchor = null; requestRender(); }
    updateCursor(sx, sy);
    return;
  }
  const it = interaction;

  if (it.kind === 'pan'){
    state.camera.x = it.camX + (ev.clientX - it.startX);
    state.camera.y = it.camY + (ev.clientY - it.startY);
    requestRender(); scheduleAutosave();
    return;
  }

  if (it.kind === 'marquee'){
    it.x1 = sx; it.y1 = sy;
    const rx = Math.min(it.x0, it.x1), ry = Math.min(it.y0, it.y1);
    const rw = Math.abs(it.x1 - it.x0), rh = Math.abs(it.y1 - it.y0);
    const ids = new Set(it.keep);
    for (const el of state.elements){
      const b = boundsWithRotation(el);
      if (b.x < rx + rw && b.x + b.w > rx && b.y < ry + rh && b.y + b.h > ry) ids.add(el.id);
    }
    state.selection = expandGroups(ids);
    requestRender();
    return;
  }

  if (it.kind === 'move'){
    let dx = sx - it.startX, dy = sy - it.startY;
    if (Math.abs(dx) + Math.abs(dy) > 1.5 / state.camera.z) it.moved = true;
    if (ev.shiftKey){ if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    [dx, dy] = snapMovingBounds(it.bbox, dx, dy, it.ids);
    for (const o of it.orig){
      const el = byId(o.id);
      if (!el) continue;
      el.x = o.x + dx; el.y = o.y + dy;
    }
    updateBoundArrows(state.elements);
    requestRender();
    return;
  }

  if (it.kind === 'rotate'){
    const [cx, cy] = it.center;
    let ang = Math.atan2(sy - cy, sx - cx) + Math.PI / 2;
    if (ev.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
    for (const o of it.orig){
      const el = byId(o.id);
      if (el && !isLinear(el)) el.angle = ang;
    }
    updateBoundArrows(state.elements);
    requestRender();
    return;
  }

  if (it.kind === 'resize'){
    resizeTo(it, sx, sy, ev.shiftKey);
    updateBoundArrows(state.elements);
    requestRender();
    return;
  }

  if (it.kind === 'crop'){
    it.x1 = sx; it.y1 = sy;
    requestRender();
    return;
  }

  if (it.kind === 'curve'){
    const el = it.el;
    const [ax, ay] = it.A, [bx2, by2] = it.B;
    const dx = bx2 - ax, dy = by2 - ay;
    const len = Math.hypot(dx, dy) || 1;
    // signed perpendicular distance of the cursor from the chord A→B
    const dperp = (dx * (sy - ay) - dy * (sx - ax)) / len;
    let curve = 2 * dperp / len;
    if (Math.abs(dperp) < 4 / state.camera.z) curve = 0; // snap straight
    el.curve = clamp(curve, -0.9, 0.9);
    requestRender();
    return;
  }

  if (it.kind === 'elbowSeg'){
    const el = it.el;
    const i0 = it.seg - 1, i1 = it.seg; // elbowPts indices bounding the segment
    if (el.elbowPts && el.elbowPts[i0] && el.elbowPts[i1]){
      const [px, py] = snapPoint(sx, sy);
      if (it.horizontal){ el.elbowPts[i0][1] = py - el.y; el.elbowPts[i1][1] = py - el.y; }
      else { el.elbowPts[i0][0] = px - el.x; el.elbowPts[i1][0] = px - el.x; }
      requestRender();
    }
    return;
  }

  if (it.kind === 'endpoint'){
    const el = it.el;
    let px = sx, py = sy;
    const target = findBindTarget(sx, sy, el.id);
    bindHover = target ? target.el.id : null;
    bindHoverAnchor = target ? target.anchor : null;
    if (target && target.anchor){ px = target.x; py = target.y; }
    else if (!target) [px, py] = snapPoint(sx, sy);
    el.points[it.idx] = [px - el.x, py - el.y];
    rectifyElbow(el);
    it.hoverBind = target ? target.el.id : null;
    it.hoverAnchor = target ? target.anchor : null;
    requestRender();
    return;
  }

  if (it.kind === 'create'){
    const el = it.el;
    it.moved = it.moved || dist(sx, sy, it.rawStartX, it.rawStartY) > 3 / state.camera.z;
    if (el.type === 'draw'){
      const lx = sx - el.x, ly = sy - el.y;
      const last = el.points[el.points.length - 1];
      if (dist(lx, ly, last[0], last[1]) > 1.2 / state.camera.z) el.points.push([lx, ly]);
      requestRender();
      return;
    }
    if (isLinear(el)){
      const target = findBindTarget(sx, sy, el.id);
      bindHover = target ? target.el.id : null;
      bindHoverAnchor = target ? target.anchor : null;
      let ex = sx, ey = sy;
      if (target && target.anchor){ ex = target.x; ey = target.y; }
      else if (!target){
        [ex, ey] = snapPoint(sx, sy);
        if (ev.shiftKey){
          const dx = ex - it.startX, dy = ey - it.startY;
          const ang = Math.round(Math.atan2(dy, dx) / (Math.PI/4)) * (Math.PI/4);
          const len = Math.hypot(dx, dy);
          ex = it.startX + Math.cos(ang) * len;
          ey = it.startY + Math.sin(ang) * len;
        }
      }
      el.points[1] = [ex - el.x, ey - el.y];
      it.hoverBind = target ? target.el.id : null;
      it.hoverAnchor = target ? target.anchor : null;
      requestRender();
      return;
    }
    let [ex, ey] = snapPoint(sx, sy);
    let w = ex - it.startX, h = ey - it.startY;
    if (ev.shiftKey || (el.type === 'icon' && el.kind !== 'cloud' && el.kind !== 'bubble')){
      const m = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m;
    }
    el.x = Math.min(it.startX, it.startX + w);
    el.y = Math.min(it.startY, it.startY + h);
    el.w = Math.abs(w); el.h = Math.abs(h);
    requestRender();
  }
}

function resizeTo(it, sx, sy, shiftKey){
  const b = it.startB;
  const h = it.handle;
  let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
  if (h.includes('w')) x0 = sx;
  if (h.includes('e')) x1 = sx;
  if (h.includes('n')) y0 = sy;
  if (h.includes('s')) y1 = sy;
  if (state.grid !== 'off' && !shiftKey){
    const gs = gsize() / 2;
    if (h.includes('w')) x0 = Math.round(x0/gs)*gs;
    if (h.includes('e')) x1 = Math.round(x1/gs)*gs;
    if (h.includes('n')) y0 = Math.round(y0/gs)*gs;
    if (h.includes('s')) y1 = Math.round(y1/gs)*gs;
  }
  let nw = x1 - x0, nh = y1 - y0;
  const onlyText = it.orig.every(o => { const e = byId(o.id); return e && e.type === 'text'; });
  if (shiftKey || onlyText){
    // preserve aspect
    const arx = Math.abs(nw) / (b.w || 1), ary = Math.abs(nh) / (b.h || 1);
    const s = (h === 'n' || h === 's') ? ary : (h === 'e' || h === 'w') ? arx : Math.max(arx, ary);
    nw = Math.sign(nw || 1) * b.w * s;
    nh = Math.sign(nh || 1) * b.h * s;
    if (h.includes('w')) x0 = x1 - nw; else x1 = x0 + nw;
    if (h.includes('n')) y0 = y1 - nh; else y1 = y0 + nh;
  }
  if (Math.abs(nw) < 8) { nw = Math.sign(nw || 1) * 8; if (h.includes('w')) x0 = x1 - nw; else x1 = x0 + nw; }
  if (Math.abs(nh) < 8) { nh = Math.sign(nh || 1) * 8; if (h.includes('n')) y0 = y1 - nh; else y1 = y0 + nh; }
  const fx = Math.min(x0, x1), fy = Math.min(y0, y1);
  const fw = Math.abs(x1 - x0), fh = Math.abs(y1 - y0);
  const kx = fw / (b.w || 1), ky = fh / (b.h || 1);
  for (const o of it.orig){
    const el = byId(o.id);
    if (!el) continue;
    if (el.type === 'text'){
      const s = Math.max(kx, ky);
      el.size = clamp(Math.round(o.size * s), 8, 200);
      el.x = fx + (o.x - b.x) * kx;
      el.y = fy + (o.y - b.y) * ky;
      autosizeText(el);
      continue;
    }
    if (isLinear(el) && o.points){
      el.x = fx + (o.x - b.x) * kx;
      el.y = fy + (o.y - b.y) * ky;
      el.points = o.points.map(([px, py]) => [px * kx, py * ky]);
      normalizeLinear(el);
      continue;
    }
    el.x = fx + (o.x - b.x) * kx;
    el.y = fy + (o.y - b.y) * ky;
    el.w = Math.max(8, o.w * kx);
    el.h = Math.max(8, o.h * ky);
  }
}

function onPointerUp(ev){
  const it = interaction;
  interaction = null;
  guides = [];
  canvas.classList.remove('panning');
  if (!it){ requestRender(); return; }

  if (it.kind === 'pan'){ requestRender(); return; }
  if (it.kind === 'marquee'){ syncPanel(); requestRender(); return; }

  if (it.kind === 'move'){
    if (it.moved){ updateBoundArrows(state.elements); commit(); }
    requestRender();
    return;
  }
  if (it.kind === 'crop'){
    if (applyCropRect(it.el, it.x0, it.y0, it.x1, it.y1)){
      updateBoundArrows(state.elements);
      commit(); syncPanel();
    }
    endCropMode();
    return;
  }
  if (it.kind === 'rotate' || it.kind === 'resize'){ commit(); requestRender(); return; }
  if (it.kind === 'curve'){
    if (it.el.type === 'arrow') defaults.curve = it.el.curve;
    commit(); syncPanel(); requestRender();
    return;
  }
  if (it.kind === 'elbowSeg'){
    normalizeLinear(it.el);
    commit(); requestRender(); return;
  }

  if (it.kind === 'endpoint'){
    const el = it.el;
    const bindId = it.hoverBind || null;
    const anchor = it.hoverAnchor || null;
    if (it.idx === 0){ el.startBind = bindId; el.startAnchor = anchor; }
    else { el.endBind = bindId; el.endAnchor = anchor; }
    normalizeLinear(el);
    updateBoundArrows(state.elements);
    bindHover = null; bindHoverAnchor = null;
    commit(); requestRender();
    return;
  }

  if (it.kind === 'create'){
    const el = it.el;
    if (isLinear(el)){
      if (el.type !== 'draw' && !it.moved){
        // click without drag → give it a friendly default length
        el.points[1] = [110, -60];
      }
      if (el.type !== 'draw'){
        el.startBind = it.startBind;
        el.startAnchor = it.startAnchor || null;
        const endOk = it.hoverBind && it.hoverBind !== it.startBind;
        el.endBind = endOk ? it.hoverBind : null;
        el.endAnchor = endOk ? (it.hoverAnchor || null) : null;
      }
      normalizeLinear(el);
      updateBoundArrows(state.elements);
      if (el.type === 'draw' && el.points.length < 2){
        state.elements.pop();
        requestRender();
        return;
      }
    } else if (!it.moved || el.w < 6 || el.h < 6){
      const defSize = {
        rect: [190, 92], diamond: [150, 110], ellipse: [150, 108],
        chip: [128, 38], icon: [96, 96],
      }[el.type] || [140, 100];
      el.x = it.startX - defSize[0]/2; el.y = it.startY - defSize[1]/2;
      [el.x, el.y] = snapPoint(el.x, el.y);
      el.w = defSize[0]; el.h = defSize[1];
    }
    bindHover = null; bindHoverAnchor = null;
    commit();
    if (el.type === 'draw'){ requestRender(); return; } // pencil stays active
    setTool('select');
    setSelection(new Set([el.id]));
    if (['rect','diamond','ellipse','chip'].includes(el.type)) openTextEditor(el, false);
    requestRender();
  }
}

function updateCursor(sx, sy){
  if (cropTarget) return; // crop mode owns the cursor
  if (state.tool !== 'select') return;
  const sel = selected();
  let cur = 'default';
  if (sel.length && !editing){
    const sb = selectionBounds();
    const z = state.camera.z;
    const [rx, ry] = rotHandlePos(sb);
    const cursors = ['nwse-resize','ns-resize','nesw-resize','ew-resize','nwse-resize','ns-resize','nesw-resize','ew-resize'];
    if (dist(sx, sy, rx, ry) < 10 / z) cur = 'grab';
    else {
      const hs = handlePositions(sb);
      for (let i = 0; i < hs.length; i++){
        if (dist(sx, sy, hs[i][0], hs[i][1]) < 9 / z){ cur = cursors[i]; break; }
      }
    }
  }
  if (cur === 'default' && topElementAt(sx, sy)) cur = 'move';
  canvas.style.cursor = cur === 'default' ? '' : cur;
}

function onDblClick(ev){
  const [sx, sy] = toScene(ev.clientX, ev.clientY);
  const hit = topElementAt(sx, sy);
  if (hit && canHaveText(hit)){
    setTool('select');
    setSelection(new Set([hit.id]));
    openTextEditor(hit, false);
    return;
  }
  if (!hit && state.tool === 'select'){
    const el = newElement('text', sx, sy, {
      stroke: defaults.stroke, font: defaults.font, size: defaults.size, align: 'left',
    });
    autosizeText(el);
    state.elements.push(el);
    openTextEditor(el, true);
  }
}

/* ── wheel: pan / zoom ─────────────────────────────── */
canvas.addEventListener('wheel', ev => {
  ev.preventDefault();
  if (ev.ctrlKey || ev.metaKey){
    zoomAt(ev.clientX, ev.clientY, Math.exp(-ev.deltaY * 0.012));
  } else {
    state.camera.x -= ev.deltaX;
    state.camera.y -= ev.deltaY;
    if (editing) positionEditor(); // bug fix: editor used to drift on scroll
    requestRender(); scheduleAutosave();
  }
}, { passive: false });

/* ── text editing ──────────────────────────────────── */
function openTextEditor(el, isNew){
  editing = { el, isNew };
  el._editing = true;
  editorEl.value = el.text || '';
  editorEl.classList.remove('hidden');
  positionEditor();
  editorEl.focus();
  editorEl.select();
  requestRender();
}
function positionEditor(){
  if (!editing) return;
  const el = editing.el;
  const z = state.camera.z;
  const fs = el.size * z;
  editorEl.style.font = fontCSS(el.font, fs);
  editorEl.style.lineHeight = lineHeightOf(el.size) * z + 'px';
  if (el.type === 'text'){
    const [px, py] = toScreen(el.x, el.y);
    const m = measureText(editorEl.value || ' ', el.font, el.size);
    editorEl.style.whiteSpace = 'pre';
    editorEl.style.textAlign = 'left';
    editorEl.style.left = px + 'px';
    editorEl.style.top = py + 'px';
    editorEl.style.width = Math.max(40, (m.w + 20) * z) + 'px';
    editorEl.style.height = Math.max(lineHeightOf(el.size), m.h) * z + 6 + 'px';
  } else if (isLinear(el)){
    // label editor floats centered on the arrow's midpoint
    const mid = linearMidpoint(el);
    const m = measureText(editorEl.value || ' ', el.font, el.size);
    const [px, py] = toScreen(mid[0], mid[1]);
    const w = Math.max(60, (m.w + 26) * z);
    editorEl.style.whiteSpace = 'pre';
    editorEl.style.textAlign = 'center';
    editorEl.style.left = (px - w / 2) + 'px';
    editorEl.style.top = (py - (m.h * z) / 2 - 3) + 'px';
    editorEl.style.width = w + 'px';
    editorEl.style.height = Math.max(lineHeightOf(el.size), m.h) * z + 6 + 'px';
  } else {
    const pad = el.type === 'chip' ? 10 : 12;
    const maxW = Math.max(20, el.w - pad*2);
    const lines = wrapText(editorEl.value || ' ', maxW, el.font, el.size);
    const th = lines.length * lineHeightOf(el.size);
    const [px, py] = toScreen(el.x + pad, el.y + el.h/2 - th/2);
    editorEl.style.whiteSpace = 'pre-wrap';
    editorEl.style.textAlign = el.align;
    editorEl.style.left = px + 'px';
    editorEl.style.top = py + 'px';
    editorEl.style.width = maxW * z + 'px';
    editorEl.style.height = (th + lineHeightOf(el.size)) * z + 'px';
  }
  const p = pal();
  editorEl.style.color = (el.fill === 'ink') ? p.bg : resolveStroke(p, el.stroke);
}
editorEl.addEventListener('input', () => {
  if (!editing) return;
  const el = editing.el;
  el.text = editorEl.value;
  if (el.type === 'text') autosizeText(el);
  else if (!isLinear(el)){
    // grow the container if the text no longer fits
    const pad = el.type === 'chip' ? 10 : 12;
    const lines = wrapText(el.text || ' ', Math.max(20, el.w - pad*2), el.font, el.size);
    const needH = lines.length * lineHeightOf(el.size) + pad * 2;
    if (needH > el.h) el.h = needH;
  }
  positionEditor();
  requestRender();
});
editorEl.addEventListener('keydown', ev => {
  ev.stopPropagation();
  if (ev.key === 'Escape'){ ev.preventDefault(); commitTextEdit(); }
  if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)){ ev.preventDefault(); commitTextEdit(); }
});
editorEl.addEventListener('blur', () => commitTextEdit());

function commitTextEdit(){
  if (!editing) return;
  const { el, isNew } = editing;
  editing = null;
  delete el._editing;
  el.text = editorEl.value;
  editorEl.classList.add('hidden');
  if (el.type === 'text'){
    if (!el.text.trim()){
      state.elements = state.elements.filter(e => e.id !== el.id);
      state.selection.delete(el.id);
    } else {
      autosizeText(el);
      if (isNew) setSelection(new Set([el.id]));
    }
  }
  updateBoundArrows(state.elements);
  commit();
  if (state.tool === 'text') setTool('select');
  syncPanel(); requestRender();
}

/* ── clipboard / duplicate / delete ────────────────── */
function duplicateElements(els, dx, dy){
  const idMap = new Map();
  const gidMap = new Map();
  const clones = els.map(el => {
    const c = JSON.parse(JSON.stringify(el, (k,v) => k.startsWith('_') ? undefined : v));
    idMap.set(el.id, c.id = uid());
    c.seed = Math.floor(Math.random() * 2 ** 31);
    if (c.groupId){
      if (!gidMap.has(c.groupId)) gidMap.set(c.groupId, uid());
      c.groupId = gidMap.get(c.groupId);
    }
    c.x += dx; c.y += dy;
    return c;
  });
  for (const c of clones){
    if (c.startBind) c.startBind = idMap.get(c.startBind) || null;
    if (c.endBind) c.endBind = idMap.get(c.endBind) || null;
  }
  state.elements.push(...clones);
  return clones;
}
function copySelection(){
  const sel = selected();
  if (!sel.length) return;
  clipboard = JSON.stringify(sel, (k,v) => k.startsWith('_') ? undefined : v);
  pasteCount = 0;
  // mark the system clipboard so ⌘V knows our internal copy is the fresh one
  if (navigator.clipboard && navigator.clipboard.writeText)
    navigator.clipboard.writeText(CLIP_MARKER).catch(() => {});
}
function paste(){
  if (!clipboard) return;
  pasteCount++;
  const els = JSON.parse(clipboard);
  const clones = duplicateElements(els, 20 * pasteCount, 20 * pasteCount);
  // duplicateElements pushed originals-with-new-ids; but els are detached copies
  updateBoundArrows(state.elements);
  setSelection(new Set(clones.map(e => e.id)));
  commit();
}
function duplicateSelection(){
  const sel = selected();
  if (!sel.length) return;
  const clones = duplicateElements(sel, 18, 18);
  updateBoundArrows(state.elements);
  setSelection(new Set(clones.map(e => e.id)));
  commit();
}
function deleteSelection(){
  if (!state.selection.size) return;
  state.elements = state.elements.filter(e => !state.selection.has(e.id));
  state.selection = new Set();
  updateBoundArrows(state.elements);
  commit(); syncPanel(); requestRender();
}
function groupSelection(){
  const sel = selected();
  if (sel.length < 2) return;
  const gid = uid();
  for (const el of sel) el.groupId = gid;
  commit();
}
function ungroupSelection(){
  for (const el of selected()) el.groupId = null;
  commit();
}

/* ── layer order ───────────────────────────────────── */
function reorder(mode){
  const selIds = state.selection;
  if (!selIds.size) return;
  const sel = state.elements.filter(e => selIds.has(e.id));
  const rest = state.elements.filter(e => !selIds.has(e.id));
  if (mode === 'front') state.elements = [...rest, ...sel];
  else if (mode === 'back') state.elements = [...sel, ...rest];
  else {
    const arr = state.elements.slice();
    const idxs = arr.map((e, i) => selIds.has(e.id) ? i : -1).filter(i => i >= 0);
    if (mode === 'forward'){
      for (let k = idxs.length - 1; k >= 0; k--){
        const i = idxs[k];
        if (i < arr.length - 1 && !selIds.has(arr[i+1].id)) [arr[i], arr[i+1]] = [arr[i+1], arr[i]];
      }
    } else {
      for (let k = 0; k < idxs.length; k++){
        const i = idxs[k];
        if (i > 0 && !selIds.has(arr[i-1].id)) [arr[i], arr[i-1]] = [arr[i-1], arr[i]];
      }
    }
    state.elements = arr;
  }
  commit(); requestRender();
}

/* ── copy / paste style ────────────────────────────── */
const STYLE_PROPS = ['stroke','sw','dash','sketch','fill','fillStyle','round','opacity','font','size','align'];
let styleClipboard = null;
function copyStyle(){
  const sel = selected();
  if (!sel.length) return;
  const src = sel[0];
  styleClipboard = {};
  for (const k of STYLE_PROPS)
    if (src[k] !== undefined) styleClipboard[k] = src[k];
  showHint('Style copied — select elements and press ⌥⌘V to paste it');
}
function pasteStyle(){
  const sel = selected();
  if (!styleClipboard || !sel.length) return;
  for (const el of sel) applyPatchTo(el, styleClipboard);
  updateBoundArrows(state.elements);
  commit(); syncPanel(); requestRender();
}

/* ── match size (same-shape equalizer, anchored on first selected) ── */
function matchSize(dim){
  const els = selected().filter(e => !isLinear(e) && e.type !== 'text');
  if (els.length < 2) return;
  const ref = els[0];
  for (const el of els.slice(1)){
    const centerKey = dim === 'w' ? 'x' : 'y';
    const c = el[centerKey] + el[dim] / 2;
    el[dim] = ref[dim];
    el[centerKey] = c - el[dim] / 2; // resize around the element's own center
    if (el.type === 'image'){ delete el._prims; delete el._pkey; }
  }
  updateBoundArrows(state.elements);
  commit(); requestRender();
}

/* ── align & distribute (shapes/text only; arrows follow their bindings) ── */
function alignUnits(){
  // groups move as one block; arrows/lines/pencil strokes are excluded
  const els = selected().filter(e => !isLinear(e));
  const map = new Map();
  for (const el of els){
    const key = el.groupId || el.id;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(el);
  }
  return [...map.values()].map(members => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of members){
      const b = boundsWithRotation(el);
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    }
    return { members, x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  });
}
function alignSel(mode){
  const units = alignUnits();
  if (units.length < 2) return;
  const minX = Math.min(...units.map(u => u.x));
  const maxX = Math.max(...units.map(u => u.x + u.w));
  const minY = Math.min(...units.map(u => u.y));
  const maxY = Math.max(...units.map(u => u.y + u.h));
  for (const u of units){
    let dx = 0, dy = 0;
    if (mode === 'l') dx = minX - u.x;
    else if (mode === 'cx') dx = (minX + maxX) / 2 - (u.x + u.w / 2);
    else if (mode === 'r') dx = maxX - (u.x + u.w);
    else if (mode === 't') dy = minY - u.y;
    else if (mode === 'cy') dy = (minY + maxY) / 2 - (u.y + u.h / 2);
    else if (mode === 'b') dy = maxY - (u.y + u.h);
    for (const el of u.members){ el.x += dx; el.y += dy; }
  }
  updateBoundArrows(state.elements);
  commit(); requestRender();
}
function distributeSel(axis){
  const units = alignUnits();
  if (units.length < 3) return;
  const key = axis === 'h' ? 'x' : 'y';
  const size = axis === 'h' ? 'w' : 'h';
  const sorted = units.slice().sort((a, b) => a[key] - b[key]);
  const first = sorted[0], last = sorted[sorted.length - 1];
  const span = (last[key] + last[size]) - first[key];
  const total = sorted.reduce((s, u) => s + u[size], 0);
  const gap = (span - total) / (sorted.length - 1);
  let pos = first[key];
  for (const u of sorted){
    const d = pos - u[key];
    for (const el of u.members){ el[key === 'x' ? 'x' : 'y'] += d; }
    pos += u[size] + gap;
  }
  updateBoundArrows(state.elements);
  commit(); requestRender();
}
$('alL').addEventListener('click', () => alignSel('l'));
$('alCX').addEventListener('click', () => alignSel('cx'));
$('alR').addEventListener('click', () => alignSel('r'));
$('alT').addEventListener('click', () => alignSel('t'));
$('alCY').addEventListener('click', () => alignSel('cy'));
$('alB').addEventListener('click', () => alignSel('b'));
$('distH').addEventListener('click', () => distributeSel('h'));
$('distV').addEventListener('click', () => distributeSel('v'));
$('matchW').addEventListener('click', () => matchSize('w'));
$('matchH').addEventListener('click', () => matchSize('h'));

/* ── right-click context menu ──────────────────────── */
function openCtxMenu(ev){
  const [sx, sy] = toScene(ev.clientX, ev.clientY);
  const hit = topElementAt(sx, sy);
  if (hit && !state.selection.has(hit.id)) setSelection(new Set([hit.id]));
  if (!hit && state.tool === 'select') setSelection(new Set());
  const sel = selected();
  const menu = $('ctxMenu');
  menu.replaceChildren();
  const add = (label, fn, disabled) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (disabled) b.disabled = true;
    else b.addEventListener('click', () => { closeMenus(); fn(); });
    menu.appendChild(b);
  };
  const hr = () => menu.appendChild(document.createElement('hr'));
  if (sel.length){
    if (sel.length === 1 && canHaveText(sel[0]))
      add('Edit text', () => openTextEditor(sel[0], false));
    if (sel.length === 1 && sel[0].type === 'image'){
      add('Crop image', () => startCrop(sel[0]));
      if (sel[0].crop) add('Uncrop', () => resetCrop(sel[0]));
    }
    if (sel.length === 1 && sel[0].elbow && sel[0].elbowPts && sel[0].elbowPts.length)
      add('Re-route elbow (auto)', () => {
        sel[0].elbowPts = null;
        commit(); requestRender();
      });
    add('Duplicate', duplicateSelection);
    add('Copy', copySelection);
    add('Copy style', copyStyle);
    if (styleClipboard) add('Paste style', pasteStyle);
    add('Delete', deleteSelection);
    hr();
    if (sel.length >= 2) add('Group', () => { groupSelection(); syncPanel(); });
    if (sel.some(e => e.groupId)) add('Ungroup', () => { ungroupSelection(); syncPanel(); });
    if (sel.length >= 2 || sel.some(e => e.groupId)) hr();
    add('Bring to front', () => reorder('front'));
    add('Bring forward', () => reorder('forward'));
    add('Send backward', () => reorder('backward'));
    add('Send to back', () => reorder('back'));
  } else {
    add('Paste', paste, !clipboard);
    add('Select all', () => { setSelection(new Set(state.elements.map(e => e.id))); setTool('select'); });
    add('Zoom to fit', zoomToFit);
  }
  closeMenus();
  menu.classList.remove('hidden');
  const mw = 200, mh = menu.scrollHeight || 300;
  menu.style.left = clamp(ev.clientX, 8, window.innerWidth - mw - 8) + 'px';
  menu.style.top = clamp(ev.clientY, 8, window.innerHeight - mh - 8) + 'px';
}
canvas.addEventListener('contextmenu', ev => {
  ev.preventDefault();
  if (editing) return;
  openCtxMenu(ev);
});

/* ── style panel ───────────────────────────────────── */
function buildSwatches(){
  const sEl = $('strokeSwatches');
  for (const key of STROKE_KEYS){
    const b = document.createElement('button');
    b.className = 'swatch' + (key === 'none' ? ' none' : '');
    b.dataset.stroke = key;
    b.title = key === 'none' ? 'no stroke — fill only' : (COLOR_TITLES[key] || key);
    sEl.appendChild(b);
  }
  addCustomSwatch(sEl, 'stroke');
  const fEl = $('fillSwatches');
  for (const key of FILL_KEYS){
    const b = document.createElement('button');
    b.className = 'swatch' + (key === 'none' ? ' none' : '');
    b.dataset.fill = key;
    b.title = key === 'none' ? 'no fill' : (COLOR_TITLES[key] || key);
    fEl.appendChild(b);
  }
  addCustomSwatch(fEl, 'fill');
  paintSwatches();
}
function addCustomSwatch(container, prop){
  const btn = document.createElement('button');
  btn.className = 'swatch custom';
  btn.title = 'Custom color… (wheel or hex)';
  btn.dataset.customFor = prop;
  btn.addEventListener('click', ev => {
    ev.stopPropagation();
    openColorPop(prop, btn);
  });
  container.appendChild(btn);
}

/* ── custom color popover: wheel + hex field ───────── */
let colorPopProp = null;
function openColorPop(prop, anchor){
  colorPopProp = prop;
  const pop = $('colorPop');
  pop.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.min(r.right + 10, window.innerWidth - 200) + 'px';
  pop.style.top = clamp(r.top - 10, 8, window.innerHeight - 60) + 'px';
  const sel = selected();
  let cur = sel.length ? sel[0][prop]
    : (prop === 'fill' ? (defaults.fillByType[state.tool] || defaults.fill) : defaults[prop]);
  if (typeof cur !== 'string' || cur[0] !== '#'){
    const p = pal();
    cur = (prop === 'stroke' ? resolveStroke(p, cur) : resolveFill(p, cur)) || '#D97757';
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(cur)) cur = '#D97757';
  $('popColor').value = cur.toLowerCase();
  $('popHex').value = cur.toUpperCase();
}
function closeColorPop(){
  $('colorPop').classList.add('hidden');
  colorPopProp = null;
}
function normalizedHex(){
  let v = $('popHex').value.trim();
  if (v && v[0] !== '#') v = '#' + v;
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null;
}
$('popColor').addEventListener('input', () => {
  const v = $('popColor').value;
  $('popHex').value = v.toUpperCase();
  if (colorPopProp) applyStyleLive({ [colorPopProp]: v });
});
$('popColor').addEventListener('change', () => {
  if (colorPopProp) applyStyle({ [colorPopProp]: $('popColor').value });
});
$('popHex').addEventListener('input', () => {
  const v = normalizedHex();
  if (v){
    $('popColor').value = v;
    if (colorPopProp) applyStyleLive({ [colorPopProp]: v });
  }
});
$('popHex').addEventListener('keydown', ev => {
  ev.stopPropagation();
  if (ev.key === 'Enter'){
    ev.preventDefault();
    const v = normalizedHex();
    if (v && colorPopProp) applyStyle({ [colorPopProp]: v });
    closeColorPop();
  }
  if (ev.key === 'Escape') closeColorPop();
});
$('popHex').addEventListener('blur', () => {
  const v = normalizedHex();
  if (v && colorPopProp) applyStyle({ [colorPopProp]: v });
});
document.addEventListener('pointerdown', ev => {
  if (!ev.target.closest('#colorPop') && !ev.target.closest('.swatch.custom')) closeColorPop();
  if (!ev.target.closest('#paperPop') && !ev.target.closest('#paperBtn')) closePaperPop();
  if (!ev.target.closest('#shortcutsCard') && !ev.target.closest('#helpBtn'))
    $('shortcutsCard').classList.add('hidden');
});
function setCustomSwatchState(prop, hex){
  const btn = document.querySelector(`.swatch.custom[data-custom-for="${prop}"]`);
  if (!btn) return;
  btn.classList.toggle('picked', !!hex);
  if (hex) btn.style.setProperty('--picked', hex);
  else btn.style.removeProperty('--picked');
}
function paintSwatches(){
  const p = pal();
  document.querySelectorAll('#strokeSwatches .swatch').forEach(b => {
    b.style.background = p.stroke[b.dataset.stroke];
  });
  document.querySelectorAll('#fillSwatches .swatch').forEach(b => {
    if (b.dataset.fill !== 'none') b.style.background = p.fill[b.dataset.fill];
  });
}

function targetsForStyle(){
  const sel = selected();
  return sel.length ? sel : null;
}
function applyPatchTo(el, patch){
  for (const [k, v] of Object.entries(patch)){
    if (k === 'fill' && !isShape(el) && el.type !== 'text') continue;
    if (k === 'round' && el.type !== 'rect') continue;
    el[k] = v;
  }
  if (el.type === 'text' && (patch.size || patch.font)) autosizeText(el);
  if (el.type === 'image' && (patch.artStyle !== undefined || patch.detail !== undefined)){
    delete el._prims; delete el._pkey;
  }
}
function rememberDefaults(patch){
  Object.assign(defaults, patch);
  if (patch.fill !== undefined && state.tool in defaults.fillByType) defaults.fillByType[state.tool] = patch.fill;
}
function applyStyle(patch){
  const sel = targetsForStyle();
  rememberDefaults(patch);
  if (sel){
    for (const el of sel) applyPatchTo(el, patch);
    updateBoundArrows(state.elements);
    commit();
  }
  syncPanel(); requestRender();
}
/* live preview while a color picker drags — no history entry per tick */
function applyStyleLive(patch){
  rememberDefaults(patch);
  for (const el of selected()) applyPatchTo(el, patch);
  requestRender();
}

function syncPanel(){
  const panel = $('stylePanel');
  const sel = selected();
  const tool = state.tool;
  const creating = !['select','hand'].includes(tool);
  if (!sel.length && !creating){ panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  const types = sel.length ? new Set(sel.map(e => e.type))
    : new Set([tool === 'text' ? 'text' : tool]);
  const has = (...ts) => ts.some(t => types.has(t));
  const shapeish = has('rect','diamond','ellipse','chip','icon');
  const linear = has('arrow','line','draw');
  const textish = has('rect','diamond','ellipse','chip','text','arrow','line');

  show('rowStroke', true);
  show('rowArt', has('image'));
  const imgDuo = sel.some(e => e.type === 'image' && e.artStyle === 'duotone');
  show('rowFill', (shapeish && !has('image')) || imgDuo);
  show('rowFillStyle', has('rect','diamond','ellipse','chip','icon'));
  show('rowWidth', shapeish || linear || has('image'));
  show('rowSketch', shapeish || linear);
  show('rowRound', has('rect'));
  show('rowCurve', has('arrow','line'));
  show('rowHeads', has('arrow','line'));
  show('rowFont', textish);
  show('rowSize', textish);
  show('rowAlign', textish);
  show('rowOpacity', true);
  const nUnits = sel.length ? alignUnits().length : 0;
  show('rowArrange', nUnits >= 2);
  $('distH').disabled = $('distV').disabled = nUnits < 3;
  const sizable = sel.filter(e => !isLinear(e) && e.type !== 'text').length;
  $('matchW').disabled = $('matchH').disabled = sizable < 2;
  show('rowLayer', sel.length > 0);
  show('rowActions', sel.length > 0);
  $('groupBtn').classList.toggle('hidden', sel.length < 2);
  $('ungroupBtn').classList.toggle('hidden', !sel.some(e => e.groupId));

  const val = key => {
    const src = sel.length ? sel : [defaults];
    const v0 = sel.length ? sel[0][key] : defaults[key];
    return src.every(e => (sel.length ? e[key] : defaults[key]) === v0) ? v0 : undefined;
  };
  const strokeVal = val('stroke');
  const fillVal = sel.length ? val('fill') : (defaults.fillByType[tool] || defaults.fill);
  markSel('#strokeSwatches .swatch', b => b.dataset.stroke === strokeVal);
  markSel('#fillSwatches .swatch', b => b.dataset.fill === fillVal);
  setCustomSwatchState('stroke', typeof strokeVal === 'string' && strokeVal[0] === '#' ? strokeVal : null);
  setCustomSwatchState('fill', typeof fillVal === 'string' && fillVal[0] === '#' ? fillVal : null);
  markSel('#fillStyleSeg button', b => b.dataset.v === val('fillStyle'));
  markSel('#artSeg button', b => b.dataset.art === (val('artStyle') || 'photo'));
  markSel('#artDetailSeg button', b => Number(b.dataset.detail) === (val('detail') || 2));
  const soloImage = sel.length === 1 && sel[0].type === 'image' ? sel[0] : null;
  $('cropBtn').disabled = !soloImage;
  $('cropResetBtn').disabled = !soloImage || !soloImage.crop;
  const firstImg = sel.find(e => e.type === 'image');
  if (firstImg){
    $('adjBright').value = firstImg.bright || 0;
    $('adjContrast').value = firstImg.contrast || 0;
    $('adjGamma').value = Math.round((firstImg.gamma || 1) * 100);
    $('adjSharp').value = firstImg.sharp || 0;
  }
  markSel('#widthSeg button', b => Number(b.dataset.v) === val('sw'));
  const dashVal = val('dash') || 'solid';
  markSel('#sketchSeg button', b => b.dataset.dash
    ? b.dataset.dash === dashVal
    : (dashVal === 'solid' && Number(b.dataset.v) === val('sketch')));
  markSel('#roundSeg button', b => Number(b.dataset.v) === val('round'));
  markSel('#curveSeg button', b => b.dataset.elbow
    ? !!val('elbow')
    : (!val('elbow') && Number(b.dataset.v) === val('curve')));
  const fontVal = val('font');
  $('fontSelect').value = typeof fontVal === 'string' ? fontVal : '';
  markSel('#sizeSeg button', b => Number(b.dataset.v) === val('size'));
  markSel('#alignSeg button', b => b.dataset.v === val('align'));
  $('startHeadSel').value = typeof val('startHead') === 'string' ? val('startHead') : '';
  $('endHeadSel').value = typeof val('endHead') === 'string' ? val('endHead') : '';
  const op = val('opacity');
  $('opacityRange').value = op == null ? 100 : op;
}
function show(id, on){ $(id).classList.toggle('hidden', !on); }
function markSel(q, fn){ document.querySelectorAll(q).forEach(b => b.classList.toggle('sel', !!fn(b))); }

/* panel events */
document.addEventListener('click', ev => {
  const t = ev.target.closest('button');
  if (!t) return;
  if (t.dataset.stroke) applyStyle({ stroke: t.dataset.stroke });
  else if (t.dataset.fill) applyStyle({ fill: t.dataset.fill });
  else if (t.closest('#fillStyleSeg') && t.dataset.v) applyStyle({ fillStyle: t.dataset.v });
  else if (t.closest('#widthSeg') && t.dataset.v) applyStyle({ sw: Number(t.dataset.v) });
  else if (t.closest('#sketchSeg')){
    if (t.dataset.dash) applyStyle({ dash: t.dataset.dash });
    else if (t.dataset.v) applyStyle({ sketch: Number(t.dataset.v), dash: 'solid' });
  }
  else if (t.closest('#roundSeg') && t.dataset.v) applyStyle({ round: Number(t.dataset.v) });
  else if (t.closest('#curveSeg') && t.dataset.elbow) applyStyle({ elbow: true, elbowPts: null });
  else if (t.closest('#curveSeg') && t.dataset.v) applyStyle({ curve: Number(t.dataset.v), elbow: false, elbowPts: null });
  else if (t.closest('#artSeg') && t.dataset.art) applyStyle({ artStyle: t.dataset.art });
  else if (t.closest('#artDetailSeg') && t.dataset.detail) applyStyle({ detail: Number(t.dataset.detail) });
  else if (t.closest('#sizeSeg') && t.dataset.v) applyStyle({ size: Number(t.dataset.v) });
  else if (t.closest('#alignSeg') && t.dataset.v) applyStyle({ align: t.dataset.v });
});
$('startHeadSel').addEventListener('change', ev => {
  if (ev.target.value) applyStyle({ startHead: ev.target.value });
});
$('endHeadSel').addEventListener('change', ev => {
  if (ev.target.value) applyStyle({ endHead: ev.target.value });
});
$('opacityRange').addEventListener('input', ev => {
  const v = Number(ev.target.value);
  for (const el of selected()) el.opacity = v;
  defaults.opacity = v;
  requestRender();
});
$('opacityRange').addEventListener('change', () => { if (state.selection.size) commit(); });
$('toFrontBtn').addEventListener('click', () => reorder('front'));
$('toBackBtn').addEventListener('click', () => reorder('back'));
$('forwardBtn').addEventListener('click', () => reorder('forward'));
$('backwardBtn').addEventListener('click', () => reorder('backward'));
$('dupBtn').addEventListener('click', duplicateSelection);
$('delBtn').addEventListener('click', deleteSelection);
$('groupBtn').addEventListener('click', () => { groupSelection(); syncPanel(); });
$('ungroupBtn').addEventListener('click', () => { ungroupSelection(); syncPanel(); });
$('cropBtn').addEventListener('click', () => {
  const sel = selected();
  if (sel.length === 1 && sel[0].type === 'image') startCrop(sel[0]);
});
$('cropResetBtn').addEventListener('click', () => {
  const sel = selected();
  if (sel.length === 1 && sel[0].type === 'image') resetCrop(sel[0]);
});

/* photo adjustment sliders — live preview debounced (LUT rebuild is cheap,
   but stipple-fine regeneration deserves a small breather) */
const ADJ_SLIDERS = [
  ['adjBright', 'bright', v => Number(v)],
  ['adjContrast', 'contrast', v => Number(v)],
  ['adjGamma', 'gamma', v => Number(v) / 100],
  ['adjSharp', 'sharp', v => Number(v)],
];
let adjTimer = null;
for (const [id, prop, parse] of ADJ_SLIDERS){
  $(id).addEventListener('input', ev => {
    const v = parse(ev.target.value);
    for (const el of selected()){
      if (el.type !== 'image') continue;
      el[prop] = v;
      delete el._prims; delete el._pkey;
    }
    clearTimeout(adjTimer);
    adjTimer = setTimeout(requestRender, 90);
  });
  $(id).addEventListener('change', () => { if (state.selection.size) commit(); });
}
$('adjResetBtn').addEventListener('click', () => {
  let touched = false;
  for (const el of selected()){
    if (el.type !== 'image') continue;
    el.bright = 0; el.contrast = 0; el.gamma = 1; el.sharp = 0;
    delete el._prims; delete el._pkey;
    touched = true;
  }
  if (touched){ commit(); syncPanel(); requestRender(); }
});

/* ── font picker ───────────────────────────────────── */
function buildFontSelect(){
  const sel = $('fontSelect');
  const hidden = document.createElement('option');
  hidden.value = ''; hidden.hidden = true; hidden.textContent = '—';
  sel.appendChild(hidden);
  const groups = new Map(FONT_GROUPS.map(g => {
    const og = document.createElement('optgroup');
    og.label = g;
    return [g, og];
  }));
  for (const [key, f] of Object.entries(FONTS)){
    const o = document.createElement('option');
    o.value = key; o.textContent = f.label;
    o.style.fontFamily = f.stack;
    (groups.get(f.group) || groups.get('Built-in')).appendChild(o);
  }
  for (const og of groups.values()) sel.appendChild(og);
  sel.addEventListener('change', () => {
    if (!sel.value) return;
    requestFontLoad(sel.value); // fetch the file now — 'loadingdone' repaints
    applyStyle({ font: sel.value });
  });
}
function loadGoogleFonts(){
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = googleFontsHref();
  link.onload = () => { preloadDocFonts(); document.fonts.ready.then(refreshTextMetrics); };
  document.head.appendChild(link); // fails silently offline — system fallbacks kick in
}
/* The stylesheet only DEFINES the fonts; the files download lazily when the
   DOM uses them — and canvas drawing doesn't count. So we explicitly request
   every Google font the document uses, and re-render whenever one arrives. */
const fontLoadRequested = new Set();
function preloadDocFonts(){
  for (const p of state.pages) for (const el of p.elements) requestFontLoad(el.font);
}
function requestFontLoad(key){
  const f = FONTS[key];
  if (!f || !f.google || fontLoadRequested.has(key)) return;
  fontLoadRequested.add(key);
  try { document.fonts.load(`${f.weight} 21px ${f.stack.split(',')[0]}`).catch(() => {}); }
  catch (e){}
}
if (document.fonts && document.fonts.addEventListener){
  document.fonts.addEventListener('loadingdone', () => {
    // a font file just arrived: re-measure text drawn with fallbacks, repaint
    for (const p of state.pages) for (const el of p.elements)
      if (el.type === 'text' && FONTS[el.font] && FONTS[el.font].google) autosizeText(el);
    requestRender(); scheduleThumbRefresh();
  });
}
function refreshTextMetrics(){
  for (const el of state.elements) if (el.type === 'text') autosizeText(el);
  requestRender();
}

/* ── icon menu ─────────────────────────────────────── */
/* ── Google Material icons (fonts.google.com/icons) ──
   The catalog (names + search tags) ships with the app; the actual vector
   path is fetched from fonts.gstatic.com the first time an icon is used,
   then cached — and stored inside the element, so documents stay offline. */
let materialName = null;
const MI_CACHE_KEY = 'koralpaper.mi.v1';
const miMem = new Map();
try {
  const stored = JSON.parse(localStorage.getItem(MI_CACHE_KEY) || '{}');
  for (const k of Object.keys(stored)) miMem.set(k, stored[k]);
} catch (e){ /* fresh cache */ }
function miPersist(){
  try {
    const keys = [...miMem.keys()].slice(-300); // cap the stored cache
    const out = {};
    for (const k of keys) out[k] = miMem.get(k);
    localStorage.setItem(MI_CACHE_KEY, JSON.stringify(out));
  } catch (e){}
}
function miFetch(name){
  if (miMem.has(name)) return Promise.resolve(miMem.get(name));
  return fetch(`https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/${name}/default/24px.svg`)
    .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.text(); })
    .then(txt => {
      const d = [...txt.matchAll(/ d="([^"]+)"/g)].map(m => m[1]).join(' ');
      if (!d) throw new Error('no path data');
      miMem.set(name, d); miPersist();
      return d;
    });
}
let miCatalog = null;
function miRecent(){
  try { return JSON.parse(localStorage.getItem('koralpaper.mi.recent') || '[]'); } catch (e){ return []; }
}
function miPinned(){
  try { return JSON.parse(localStorage.getItem('koralpaper.mi.pinned') || '[]'); } catch (e){ return []; }
}
function miTogglePin(name){
  const p = miPinned();
  const next = p.includes(name) ? p.filter(n => n !== name) : [...p, name].slice(-18);
  try { localStorage.setItem('koralpaper.mi.pinned', JSON.stringify(next)); } catch (e){}
  showHint(next.includes(name) ? `“${name.replace(/_/g,' ')}” pinned — it now leads the icon grid`
                               : `“${name.replace(/_/g,' ')}” unpinned`);
  miRenderGrid(miSearchList($('miSearch').value));
}
function miRemember(name){
  try {
    localStorage.setItem('koralpaper.mi.recent',
      JSON.stringify([name, ...miRecent().filter(n => n !== name)].slice(0, 9)));
  } catch (e){}
}
function miSearchList(q){
  if (!miCatalog)
    miCatalog = MATERIAL_ICONS.split('\n').map(line => {
      const bar = line.indexOf('|');
      const name = bar < 0 ? line : line.slice(0, bar);
      return { name, hay: (name + ' ' + (bar < 0 ? '' : line.slice(bar + 1))).replace(/[_,]/g, ' ') };
    });
  q = q.trim().toLowerCase();
  if (!q){
    const pin = miPinned();
    const rec = miRecent().filter(n => !pin.includes(n));
    const merged = [...pin, ...rec,
      ...MATERIAL_POPULAR.filter(n => !pin.includes(n) && !rec.includes(n))];
    // grid grows (up to 18) when the user has pinned more than fits in 9
    return merged.slice(0, Math.max(9, Math.min(18, pin.length)));
  }
  const out = [];
  for (const it of miCatalog){
    if (it.name.startsWith(q)){ out.push(it.name); if (out.length >= 9) return out; }
  }
  for (const it of miCatalog){
    if (!out.includes(it.name) && it.hay.includes(q)){
      out.push(it.name);
      if (out.length >= 9) break;
    }
  }
  return out;
}
function pickMaterial(name){
  materialName = name;
  iconKind = 'material';
  miRemember(name);
  miFetch(name).catch(() => showHint('Could not load that icon — internet is needed once per icon'));
  markIconMenu();
  setTool('icon');
  $('iconMenu').classList.add('hidden');
}
function miRenderGrid(names){
  const grid = $('miGrid');
  grid.replaceChildren();
  const pinned = miPinned();
  for (const name of names){
    const b = document.createElement('button');
    b.title = name.replace(/_/g, ' ') + ' — right-click to pin';
    b.dataset.mi = name;
    b.classList.toggle('pin', pinned.includes(name));
    b.addEventListener('click', ev => { ev.stopPropagation(); pickMaterial(name); });
    b.addEventListener('contextmenu', ev => {
      ev.preventDefault(); ev.stopPropagation();
      miTogglePin(name);
    });
    grid.appendChild(b);
    miFetch(name).then(d => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 -960 960 960');
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', 'currentColor');
      p.setAttribute('stroke', 'none');
      svg.appendChild(p);
      b.replaceChildren(svg);
      markIconMenu();
    }).catch(() => { b.textContent = '·'; b.disabled = true; });
  }
  markIconMenu();
}

const ICON_GLYPHS = {
  asterisk: '<g style="stroke-width:2.5"><path d="M10 3.2 L10 16.8"/><path d="M4.1 6.6 L15.9 13.4"/><path d="M15.9 6.6 L4.1 13.4"/></g>',
  paperast: '<path d="M5 2.6 L15 2.6 Q17 2.6 17 4.6 L17 15.4 Q17 17.4 15 17.4 L5 17.4 Q3 17.4 3 15.4 L3 4.6 Q3 2.6 5 2.6 Z"/><g style="stroke-width:1.7"><path d="M10 6.6 L10 13.4"/><path d="M7 8.3 L13 11.7"/><path d="M13 8.3 L7 11.7"/></g>',
  paperstroke: '<path d="M5 2.6 L15 2.6 Q17 2.6 17 4.6 L17 15.4 Q17 17.4 15 17.4 L5 17.4 Q3 17.4 3 15.4 L3 4.6 Q3 2.6 5 2.6 Z"/><path d="M6.2 8.6 Q8 6.8 10 8.6 Q12 10.4 13.8 8.4 M6.2 12.4 Q10 14 13.8 12"/>',
  paperthought: '<path d="M7 1.8 L15.4 1.8 Q17.2 1.8 17.2 3.6 L17.2 12.2 Q17.2 14 15.4 14 L7 14 Q5.2 14 5.2 12.2 L5.2 3.6 Q5.2 1.8 7 1.8 Z"/><g style="stroke-width:1.5"><path d="M11.2 4.6 L11.2 11.2"/><path d="M8.4 6.2 L14 9.6"/><path d="M14 6.2 L8.4 9.6"/></g><circle cx="4" cy="16" r="1.2" class="fillme"/><circle cx="1.9" cy="18.3" r="0.85" class="fillme"/>',
  spiral: '<path d="M10.4 10.2 Q10.9 9.1 9.9 8.6 Q8.5 8 7.6 9.3 Q6.5 10.9 8 12.4 Q10 14.3 12.4 12.7 Q15 10.9 13.8 7.9 Q12.4 4.8 8.9 5.4 Q5.2 6.1 4.6 10"/>',
  cloud: '<path d="M5.6 13.8 Q3.3 13.5 3.5 11.3 Q3.7 9.3 5.8 9.1 Q6 6.5 8.6 6.3 Q11 6.1 11.8 8 Q14.4 7.5 15.4 9.5 Q16.4 11.7 14.4 13.2 Q12.5 14.5 5.6 13.8 Z"/>',
  star: '<path d="M10 2.8 L11.8 7.6 L16.8 7.8 L12.9 10.9 L14.3 15.8 L10 13 L5.7 15.8 L7.1 10.9 L3.2 7.8 L8.2 7.6 Z"/>',
  heart: '<path d="M10 16.2 Q4.2 12.3 3.7 8.6 Q3.5 5.6 6.2 5.2 Q8.6 4.9 10 7.1 Q11.4 4.9 13.8 5.2 Q16.5 5.6 16.3 8.6 Q15.8 12.3 10 16.2 Z"/>',
  bolt: '<path d="M11.2 2.5 L4.8 10.6 L9 10.6 L7.6 17.5 L15.3 8.6 L10.9 8.6 L13.5 2.5 Z"/>',
  bubble: '<path d="M5.5 4.2 L14.5 4.2 Q16.4 4.2 16.4 6.1 L16.4 10.9 Q16.4 12.8 14.5 12.8 L9.4 12.8 L6.2 16.2 L6.9 12.8 L5.5 12.8 Q3.6 12.8 3.6 10.9 L3.6 6.1 Q3.6 4.2 5.5 4.2 Z"/>',
  bang: '<path d="M10 3.2 Q10.2 7.6 10 12" style="stroke-width:2.4"/><circle cx="10" cy="16.2" r="1.35" class="fillme"/>',
  question: '<path d="M6.6 6.6 Q6.9 3.8 10 3.8 Q13.1 3.8 13.2 6.5 Q13.3 8.3 11.5 9.3 Q10.1 10.1 10.1 12"/><circle cx="10.1" cy="15.6" r="1.3" class="fillme"/>',
  check: '<path d="M3.8 11.2 L8.2 15.2 L16.2 4.8"/>',
};
function glyphSVG(kind){
  // static app-owned markup, parsed without innerHTML
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">${ICON_GLYPHS[kind] || ''}</svg>`,
    'image/svg+xml');
  return document.importNode(doc.documentElement, true);
}
function buildIconMenu(){
  const menu = $('iconMenu');
  for (const kind of ICON_KINDS){
    const b = document.createElement('button');
    b.dataset.kind = kind;
    b.title = ({ bang:'exclamation', paperast:'asterisk on paper',
      paperstroke:'paper & stroke', paperthought:'paper thought (KoralPaper mark)' })[kind] || kind;
    b.appendChild(glyphSVG(kind));
    b.addEventListener('click', ev => {
      ev.stopPropagation();
      iconKind = kind;
      markIconMenu();
      setTool('icon');
      menu.classList.add('hidden');
    });
    menu.appendChild(b);
  }
  // Google Material icons: search + 3×3 grid (recents/popular by default)
  const head = document.createElement('div');
  head.className = 'menuhead';
  head.textContent = 'Google Material icons';
  menu.appendChild(head);
  const search = document.createElement('input');
  search.type = 'text';
  search.id = 'miSearch';
  search.placeholder = 'Search 3,000 icons…';
  search.spellcheck = false;
  search.addEventListener('click', ev => ev.stopPropagation());
  search.addEventListener('input', () => miRenderGrid(miSearchList(search.value)));
  search.addEventListener('keydown', ev => {
    ev.stopPropagation();
    if (ev.key === 'Enter'){
      const first = $('miGrid').querySelector('button:not(:disabled)');
      if (first) pickMaterial(first.dataset.mi);
    }
    if (ev.key === 'Escape') $('iconMenu').classList.add('hidden');
  });
  menu.appendChild(search);
  const grid = document.createElement('div');
  grid.id = 'miGrid';
  menu.appendChild(grid);
  miRenderGrid(miSearchList(''));
  markIconMenu();
}
function markIconMenu(){
  document.querySelectorAll('#iconMenu > button').forEach(b =>
    b.classList.toggle('sel', iconKind !== 'material' && b.dataset.kind === iconKind));
  document.querySelectorAll('#miGrid button').forEach(b =>
    b.classList.toggle('sel', iconKind === 'material' && b.dataset.mi === materialName));
}
$('iconToolBtn').addEventListener('click', ev => {
  ev.stopPropagation();
  $('iconMenu').classList.toggle('hidden');
});

/* ── top bar wiring ────────────────────────────────── */
document.querySelectorAll('.toolbtn[data-tool]').forEach(b =>
  b.addEventListener('click', () => setTool(b.dataset.tool)));
$('imgToolBtn').addEventListener('click', () => $('imgInput').click());

$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);
const GRID_CYCLE = { grid: 'dots', dots: 'off', off: 'grid' };
function cycleGrid(){
  state.grid = GRID_CYCLE[state.grid] || 'grid';
  syncToggles(); syncGridMenu(); requestRender(); scheduleAutosave();
  showHint(state.grid === 'off' ? 'Grid off' : state.grid === 'dots' ? 'Dot grid' : 'Line grid');
}
$('gridBtn').addEventListener('click', ev => {
  ev.stopPropagation();
  const m = $('gridMenu');
  const wasHidden = m.classList.contains('hidden');
  closeMenus();
  if (wasHidden){ syncGridMenu(); m.classList.remove('hidden'); }
});
function syncGridMenu(){
  document.querySelectorAll('#gridModeSeg button').forEach(b =>
    b.classList.toggle('sel', b.dataset.g === state.grid));
  $('gridSizeRange').value = state.gridSize;
  $('gridSizeVal').textContent = state.gridSize;
}
document.querySelectorAll('#gridModeSeg button').forEach(b =>
  b.addEventListener('click', ev => {
    ev.stopPropagation();
    state.grid = b.dataset.g;
    syncGridMenu(); syncToggles(); requestRender(); scheduleAutosave();
  }));
$('gridSizeRange').addEventListener('input', ev => {
  state.gridSize = Number(ev.target.value);
  $('gridSizeVal').textContent = state.gridSize;
  requestRender();
});
$('gridSizeRange').addEventListener('change', scheduleAutosave);
$('gridMenu').addEventListener('click', ev => ev.stopPropagation());
$('snapBtn').addEventListener('click', () => {
  state.snap = !state.snap; syncToggles(); scheduleAutosave();
});
$('themeBtn').addEventListener('click', () => {
  state.theme = state.theme === 'light' ? 'dark' : 'light';
  document.body.classList.toggle('dark', state.theme === 'dark');
  paintSwatches(); syncPaperUI(); requestRender(); scheduleAutosave();
});
function syncToggles(){
  $('gridBtn').classList.toggle('on', state.grid !== 'off');
  $('gridBtn').title = `Grid: ${state.grid === 'off' ? 'off' : state.grid} — G cycles`;
  $('snapBtn').classList.toggle('on', state.snap);
}

/* paper color */
const PAPER_PRESETS = [
  { name: 'Theme paper',    v: null },
  { name: 'White',          v: '#FFFFFF' },
  { name: 'Light gray',     v: '#F2F3F3' },
  { name: 'Light blue',     v: '#EAF1F6' },
  { name: 'Soft green',     v: '#E8F0E3' },
  { name: 'Soft yellow',    v: '#FAF3D9' },
  { name: 'Soft mauve',     v: '#F3E7EE' },
  { name: 'Warm linen',     v: '#F6ECE1' },
];
function setPaper(v){
  state.bgColor = v;
  syncPaperUI(); requestRender(); scheduleAutosave();
}
function buildPaperSwatches(){
  const wrap = $('paperSwatches');
  wrap.replaceChildren();
  for (const p of PAPER_PRESETS){
    const b = document.createElement('button');
    b.title = p.name;
    b.dataset.paper = p.v || 'theme';
    b.addEventListener('click', () => { setPaper(p.v); });
    wrap.appendChild(b);
  }
}
function syncPaperUI(){
  const bg = effectiveBg();
  $('paperDot').style.background = bg;
  const hex = /^#[0-9a-f]{6}$/i.test(bg) ? bg : '#f2efe6';
  $('paperInput').value = hex.toLowerCase();
  $('paperHex').value = hex.toUpperCase();
  for (const b of $('paperSwatches').children){
    const isTheme = b.dataset.paper === 'theme';
    b.style.background = isTheme ? pal().bg : b.dataset.paper;
    b.classList.toggle('picked', isTheme
      ? !state.bgColor
      : (state.bgColor || '').toLowerCase() === b.dataset.paper.toLowerCase());
  }
}
function closePaperPop(){ $('paperPop').classList.add('hidden'); }
$('paperBtn').addEventListener('click', ev => {
  ev.stopPropagation();
  const pop = $('paperPop');
  if (!pop.classList.contains('hidden')){ closePaperPop(); return; }
  closeMenus(); closeColorPop();
  syncPaperUI();
  pop.classList.remove('hidden');
  const r = $('paperBtn').getBoundingClientRect();
  pop.style.left = clamp(r.right - 206, 8, window.innerWidth - 214) + 'px';
  pop.style.top = (r.bottom + 10) + 'px';
});
$('paperPop').addEventListener('click', ev => ev.stopPropagation());
$('paperInput').addEventListener('input', ev => {
  state.bgColor = ev.target.value;
  syncPaperUI(); requestRender();
});
$('paperInput').addEventListener('change', () => {
  scheduleAutosave();
  showHint('Paper color set — ☰ menu → “Reset paper color” to go back');
});
function normalizedPaperHex(){
  let v = $('paperHex').value.trim();
  if (v && v[0] !== '#') v = '#' + v;
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null;
}
$('paperHex').addEventListener('input', () => {
  const v = normalizedPaperHex();
  if (v){ state.bgColor = v; $('paperInput').value = v; syncPaperUI(); requestRender(); }
});
$('paperHex').addEventListener('keydown', ev => {
  ev.stopPropagation();
  if (ev.key === 'Enter'){
    ev.preventDefault();
    const v = normalizedPaperHex();
    if (v) setPaper(v);
    closePaperPop();
  }
  if (ev.key === 'Escape') closePaperPop();
});
$('paperHex').addEventListener('blur', () => {
  const v = normalizedPaperHex();
  if (v) setPaper(v);
});

/* ── image crop ────────────────────────────────────── */
const CROP_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26'%3E%3Cg fill='none' stroke='%23C96442' stroke-width='2.4' stroke-linecap='round'%3E%3Cpath d='M8 2v16h16'/%3E%3Cpath d='M2 8h16v16'/%3E%3C/g%3E%3C/svg%3E") 13 13, crosshair`;
function startCrop(el){
  cropTarget = el.id;
  setTool('select');
  setSelection(new Set([el.id]));
  canvas.style.cursor = CROP_CURSOR;
  showHint('✂ Crop mode: drag across the image to keep that area — Esc cancels');
  requestRender();
}
function endCropMode(){
  cropTarget = null;
  canvas.style.cursor = '';
  requestRender();
}
function applyCropRect(el, sx0, sy0, sx1, sy1){
  const b = boundsOf(el);
  const cx = b.x + b.w/2, cy = b.y + b.h/2;
  const [lax, lay] = rotatePoint(sx0, sy0, cx, cy, -(el.angle || 0));
  const [lbx, lby] = rotatePoint(sx1, sy1, cx, cy, -(el.angle || 0));
  const x0 = clamp(Math.min(lax, lbx), b.x, b.x + b.w);
  const x1 = clamp(Math.max(lax, lbx), b.x, b.x + b.w);
  const y0 = clamp(Math.min(lay, lby), b.y, b.y + b.h);
  const y1 = clamp(Math.max(lay, lby), b.y, b.y + b.h);
  if (x1 - x0 < 8 || y1 - y0 < 8) return false;
  const c = el.crop || [0, 0, 1, 1];
  const fu0 = (x0 - b.x) / b.w, fu1 = (x1 - b.x) / b.w;
  const fv0 = (y0 - b.y) / b.h, fv1 = (y1 - b.y) / b.h;
  el.crop = [
    c[0] + fu0 * (c[2] - c[0]), c[1] + fv0 * (c[3] - c[1]),
    c[0] + fu1 * (c[2] - c[0]), c[1] + fv1 * (c[3] - c[1]),
  ];
  // keep the kept region exactly where it was on canvas
  const [ncx, ncy] = rotatePoint((x0 + x1) / 2, (y0 + y1) / 2, cx, cy, el.angle || 0);
  el.w = x1 - x0; el.h = y1 - y0;
  el.x = ncx - el.w / 2; el.y = ncy - el.h / 2;
  delete el._prims; delete el._pkey;
  return true;
}
function resetCrop(el){
  if (!el.crop) return;
  const entry = getImageEntry(el.src);
  el.crop = null;
  if (entry.ready){
    const cx = el.x + el.w/2, cy = el.y + el.h/2;
    el.h = el.w * (entry.img.naturalHeight / entry.img.naturalWidth);
    el.x = cx - el.w/2; el.y = cy - el.h/2;
  }
  delete el._prims; delete el._pkey;
  updateBoundArrows(state.elements);
  commit(); syncPanel(); requestRender();
}

/* ── image import ──────────────────────────────────── */
function downscaleDataURL(srcURL, mime, cb){
  const img = new Image();
  img.onload = () => {
    const maxDim = 1024; // keeps .json saves and autosave sane
    const s = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    if (s >= 1){ cb(srcURL); return; }
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s);
    c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    cb(mime === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.87));
  };
  img.src = srcURL;
}
function insertImageFiles(files, sx, sy){
  const list = [...files].filter(f => f.type.startsWith('image/'));
  if (!list.length) return;
  list.forEach((f, idx) => {
    const reader = new FileReader();
    reader.onload = () => downscaleDataURL(reader.result, f.type, dataURL => {
      const probe = new Image();
      probe.onload = () => {
        const maxSide = 420;
        const s = Math.min(1, maxSide / Math.max(probe.naturalWidth, probe.naturalHeight));
        const w = Math.max(24, Math.round(probe.naturalWidth * s));
        const h = Math.max(24, Math.round(probe.naturalHeight * s));
        let cx = sx, cy = sy;
        if (cx == null){
          [cx, cy] = toScene(canvas.clientWidth / 2, canvas.clientHeight / 2);
        }
        const el = newElement('image', cx - w/2 + idx * 26, cy - h/2 + idx * 26, {});
        el.src = dataURL; el.w = w; el.h = h;
        state.elements.push(el);
        setTool('select');
        setSelection(new Set([el.id]));
        commit(); requestRender();
        showHint('Image added — pick an Art style in the panel to vectorize it ✳');
      };
      probe.src = dataURL;
    });
    reader.readAsDataURL(f);
  });
}
window.addEventListener('dragover', ev => ev.preventDefault());
window.addEventListener('drop', ev => {
  ev.preventDefault();
  if (!ev.dataTransfer || !ev.dataTransfer.files.length) return;
  const [sx, sy] = toScene(ev.clientX, ev.clientY);
  insertImageFiles(ev.dataTransfer.files, sx, sy);
});
/* system paste: images from the clipboard beat the internal element clipboard,
   unless the internal one is fresher (we mark our own copies with a token). */
const CLIP_MARKER = '⟡asterisk-clipboard⟡';
document.addEventListener('paste', ev => {
  if (editing || ev.target === editorEl || ev.target.tagName === 'INPUT') return;
  const items = ev.clipboardData ? [...ev.clipboardData.items] : [];
  const imgItem = items.find(i => i.type.startsWith('image/'));
  const txt = ev.clipboardData ? ev.clipboardData.getData('text/plain') : '';
  ev.preventDefault();
  if (imgItem && txt !== CLIP_MARKER){
    const f = imgItem.getAsFile();
    if (f){ insertImageFiles([f], null, null); return; }
  }
  paste();
});

/* ── pages ─────────────────────────────────────────── */
function switchPage(i){
  i = clamp(i, 0, state.pages.length - 1);
  if (i === state.pageIndex) return;
  if (editing) commitTextEdit();
  syncPageRef();
  state.pageIndex = i;
  state.elements = state.pages[i].elements;
  state.selection = new Set();
  updateBoundArrows(state.elements);
  buildPageStrip(); syncPanel(); requestRender(); scheduleAutosave();
}
function addPage(){
  syncPageRef();
  state.pages.splice(state.pageIndex + 1, 0, makePage([], `Page ${state.pages.length + 1}`));
  state.pageIndex += 1;
  state.elements = state.pages[state.pageIndex].elements;
  state.selection = new Set();
  commit(); buildPageStrip(); syncPanel(); requestRender();
  showHint('New page — right-click a page tab for rename, duplicate, delete');
}
function deletePage(i){
  if (state.pages.length <= 1){ showHint('This is the only page'); return; }
  if (!confirm(`Delete “${state.pages[i].name}”? (You can undo.)`)) return;
  syncPageRef();
  state.pages.splice(i, 1);
  state.pageIndex = clamp(state.pageIndex >= i ? state.pageIndex - 1 : state.pageIndex, 0, state.pages.length - 1);
  state.elements = state.pages[state.pageIndex].elements;
  state.selection = new Set();
  commit(); buildPageStrip(); syncPanel(); requestRender();
}
function duplicatePage(i){
  syncPageRef();
  const src = state.pages[i];
  const copy = JSON.parse(JSON.stringify(src.elements, (k, v) => k.startsWith('_') ? undefined : v));
  state.pages.splice(i + 1, 0, { id: uid(), name: src.name + ' copy', elements: copy });
  state.pageIndex = i + 1;
  state.elements = state.pages[state.pageIndex].elements;
  state.selection = new Set();
  commit(); buildPageStrip(); syncPanel(); requestRender();
}
function renamePage(i){
  const name = prompt('Page name:', state.pages[i].name);
  if (name && name.trim()){ state.pages[i].name = name.trim(); commit(); buildPageStrip(); }
}
function movePage(i, dir){
  const j = i + dir;
  if (j < 0 || j >= state.pages.length) return;
  syncPageRef();
  const cur = state.pages[state.pageIndex];
  [state.pages[i], state.pages[j]] = [state.pages[j], state.pages[i]];
  state.pageIndex = state.pages.indexOf(cur);
  commit(); buildPageStrip();
}

/* thumbnail strip */
let thumbTimer = null;
function scheduleThumbRefresh(){
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => refreshThumb(state.pageIndex), 350);
}
function renderThumbInto(cv, page){
  const els = page.elements;
  const b = state.board
    ? { x: state.board.x, y: state.board.y, w: state.board.w, h: state.board.h }
    : sceneBounds(els);
  const ratio = b ? clamp(b.h / b.w, 0.4, 1.8) : 1.25;
  const th = 52, tw = clamp(Math.round(th / ratio), 30, 88);
  const dpr = 2;
  cv.width = tw * dpr; cv.height = th * dpr;
  cv.style.width = tw + 'px'; cv.style.height = th + 'px';
  const tctx = cv.getContext('2d');
  if (!b){
    tctx.fillStyle = effectiveBg();
    tctx.fillRect(0, 0, cv.width, cv.height);
    return;
  }
  const pad = Math.max(b.w, b.h) * 0.06;
  const z = Math.min(cv.width / (b.w + pad * 2), cv.height / (b.h + pad * 2));
  renderScene(tctx, els, {
    width: cv.width, height: cv.height,
    camera: {
      x: (cv.width - b.w * z) / 2 - b.x * z,
      y: (cv.height - b.h * z) / 2 - b.y * z, z,
    },
    pal: pal(), grid: false, bg: effectiveBg(), hideBoardFrame: true,
  });
}
function refreshThumb(i){
  const cv = document.querySelector(`#pageStrip .pagethumb[data-i="${i}"] canvas`);
  if (cv) renderThumbInto(cv, state.pages[i]);
}
function buildPageStrip(){
  const strip = $('pageStrip');
  if (!strip) return;
  syncPageRef();
  strip.replaceChildren();
  state.pages.forEach((page, i) => {
    const b = document.createElement('button');
    b.className = 'pagethumb' + (i === state.pageIndex ? ' active' : '');
    b.dataset.i = i;
    b.title = page.name;
    const cv = document.createElement('canvas');
    b.appendChild(cv);
    const num = document.createElement('span');
    num.className = 'pagenum';
    num.textContent = i + 1;
    b.appendChild(num);
    b.addEventListener('click', () => switchPage(i));
    b.addEventListener('contextmenu', ev => {
      ev.preventDefault(); ev.stopPropagation();
      openPageMenu(ev, i);
    });
    strip.appendChild(b);
    renderThumbInto(cv, page);
  });
  const add = document.createElement('button');
  add.className = 'pageadd';
  add.title = 'Add page';
  add.textContent = '+';
  add.addEventListener('click', addPage);
  strip.appendChild(add);
}
function openPageMenu(ev, i){
  const menu = $('ctxMenu');
  menu.replaceChildren();
  const add = (label, fn, disabled) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (disabled) b.disabled = true;
    else b.addEventListener('click', () => { closeMenus(); fn(); });
    menu.appendChild(b);
  };
  add('Rename page…', () => renamePage(i));
  add('Duplicate page', () => duplicatePage(i));
  add('Move left', () => movePage(i, -1), i === 0);
  add('Move right', () => movePage(i, 1), i === state.pages.length - 1);
  menu.appendChild(document.createElement('hr'));
  add('Delete page…', () => deletePage(i), state.pages.length <= 1);
  closeMenus();
  menu.classList.remove('hidden');
  menu.style.left = clamp(ev.clientX, 8, window.innerWidth - 200) + 'px';
  menu.style.top = clamp(ev.clientY - 190, 8, window.innerHeight - 220) + 'px';
}

/* ── artboard / canvas size ────────────────────────── */
const BOARD_GROUPS = [
  { label: 'Social', items: [
    ['IG Story / Reel', 1080, 1920],
    ['IG Post square', 1080, 1080],
    ['IG Portrait', 1080, 1350],
    ['LinkedIn image', 1200, 627],
    ['LinkedIn square', 1080, 1080],
    ['X / Twitter post', 1600, 900],
    ['YouTube thumbnail', 1280, 720],
  ]},
  { label: 'Wallpapers', items: [
    ['Desktop FHD', 1920, 1080],
    ['Desktop 4K', 3840, 2160],
    ['MacBook', 2560, 1600],
    ['iPhone 17 Pro', 1206, 2622],
    ['iPhone 17 Pro Max', 1320, 2868],
  ]},
  { label: 'Ratios', items: [
    ['1 : 1', 1200, 1200],
    ['16 : 9', 1600, 900],
    ['9 : 16', 900, 1600],
    ['4 : 3', 1600, 1200],
    ['3 : 2', 1500, 1000],
  ]},
];
function setBoard(name, w, h){
  if (!w){
    state.board = null;
    showHint('Unlimited canvas');
  } else {
    const c = sceneBounds(state.elements);
    const cx = c ? c.x + c.w/2 : 0, cy = c ? c.y + c.h/2 : 0;
    state.board = {
      name, w, h,
      x: Math.round((cx - w/2) / gsize()) * gsize(),   // edges land on grid lines
      y: Math.round((cy - h/2) / gsize()) * gsize(),
    };
    showHint(`${name} — exports will be exactly ${w} × ${h}px, grid included`);
  }
  syncBoardBtn(); buildBoardMenuSel(); zoomToFit(); scheduleAutosave();
}
function syncBoardBtn(){
  $('boardBtnLabel').textContent = state.board ? `${state.board.w}×${state.board.h}` : '∞';
  $('boardBtn').title = state.board
    ? `Canvas: ${state.board.name} (${state.board.w}×${state.board.h})`
    : 'Canvas size: unlimited';
}
function buildBoardMenu(){
  const menu = $('boardMenu');
  const free = document.createElement('button');
  free.dataset.free = '1';
  free.textContent = 'Unlimited canvas  ∞';
  free.addEventListener('click', () => { setBoard(null); closeMenus(); });
  menu.appendChild(free);
  for (const grp of BOARD_GROUPS){
    const head = document.createElement('div');
    head.className = 'menuhead';
    head.textContent = grp.label;
    menu.appendChild(head);
    for (const [name, w, h] of grp.items){
      const b = document.createElement('button');
      b.dataset.w = w; b.dataset.h = h;
      const n = document.createElement('span'); n.textContent = name;
      const d = document.createElement('span'); d.className = 'dim'; d.textContent = `${w}×${h}`;
      b.appendChild(n); b.appendChild(d);
      b.addEventListener('click', () => { setBoard(name, w, h); closeMenus(); });
      menu.appendChild(b);
    }
  }
  buildBoardMenuSel();
}
function buildBoardMenuSel(){
  document.querySelectorAll('#boardMenu button').forEach(b => {
    const isSel = state.board
      ? Number(b.dataset.w) === state.board.w && Number(b.dataset.h) === state.board.h
      : !!b.dataset.free;
    b.classList.toggle('sel', isSel);
  });
}
$('boardBtn').addEventListener('click', ev => {
  ev.stopPropagation();
  const m = $('boardMenu');
  const wasHidden = m.classList.contains('hidden');
  closeMenus();
  if (wasHidden) m.classList.remove('hidden');
});

/* export menu */
$('exportMenuBtn').addEventListener('click', ev => {
  ev.stopPropagation();
  const m = $('exportMenu');
  const wasHidden = m.classList.contains('hidden');
  closeMenus();
  if (wasHidden) m.classList.remove('hidden');
});
$('exportMenu').addEventListener('click', ev => {
  const b = ev.target.closest('button');
  if (!b) return;
  closeMenus();
  runFileAction(b.dataset.act);
});
$('helpBtn').addEventListener('click', () => $('shortcutsCard').classList.toggle('hidden'));

/* ── Help / Settings side panel ─────────────────────── */
function setPanelTab(t){
  $('tabHelp').classList.toggle('sel', t === 'help');
  $('tabSettings').classList.toggle('sel', t === 'settings');
  $('helpPane').classList.toggle('hidden', t !== 'help');
  $('settingsPane').classList.toggle('hidden', t !== 'settings');
}
$('tabHelp').addEventListener('click', () => setPanelTab('help'));
$('tabSettings').addEventListener('click', () => setPanelTab('settings'));

const WIDTH_KEYS = ['fine', 'medium', 'thick'];
const SIZE_KEYS = ['s', 'm', 'l', 'xl'];
const sizeInputId = k => 'setSize' + k[0].toUpperCase() + k.slice(1);
function syncSettingsUI(){
  for (const k of WIDTH_KEYS){
    const id = 'set' + k[0].toUpperCase() + k.slice(1);
    $(id).value = widths[k];
    $(id + 'Val').textContent = String(widths[k]);
  }
  for (const k of SIZE_KEYS){
    $(sizeInputId(k)).value = sizes[k];
    $(sizeInputId(k) + 'Val').textContent = String(sizes[k]);
  }
}
function applyWidthPresets(){
  document.querySelectorAll('#widthSeg button').forEach((b, i) => {
    const k = WIDTH_KEYS[i];
    b.dataset.v = widths[k];
    b.title = k[0].toUpperCase() + k.slice(1) + ' (' + widths[k] + ')';
  });
  document.querySelectorAll('#sizeSeg button').forEach((b, i) => {
    const k = SIZE_KEYS[i];
    b.dataset.v = sizes[k];
    b.title = k.toUpperCase() + ' (' + sizes[k] + 'px)';
  });
  syncPanel();
}
WIDTH_KEYS.forEach(k => {
  const id = 'set' + k[0].toUpperCase() + k.slice(1);
  $(id).addEventListener('input', () => {
    const old = widths[k];
    widths[k] = Number($(id).value);
    if (defaults.sw === old) defaults.sw = widths[k]; // keep the active preset live
    syncSettingsUI(); applyWidthPresets(); saveSettings();
  });
});
SIZE_KEYS.forEach(k => {
  $(sizeInputId(k)).addEventListener('input', () => {
    const old = sizes[k];
    sizes[k] = Number($(sizeInputId(k)).value);
    if (defaults.size === old) defaults.size = sizes[k];
    syncSettingsUI(); applyWidthPresets(); saveSettings();
  });
});
$('setWidthsReset').addEventListener('click', () => {
  Object.assign(widths, DEFAULT_WIDTHS);
  Object.assign(sizes, DEFAULT_SIZES);
  defaults.sw = widths.medium;
  defaults.size = sizes.m;
  syncSettingsUI(); applyWidthPresets(); saveSettings();
});
function zoomFocusPoint(){
  // zoom toward the selection's center when something is selected
  if (state.selection.size){
    let b = null;
    for (const el of state.elements){
      if (!state.selection.has(el.id)) continue;
      const eb = boundsWithRotation(el);
      b = b ? { x: Math.min(b.x, eb.x), y: Math.min(b.y, eb.y),
                x2: Math.max(b.x2, eb.x + eb.w), y2: Math.max(b.y2, eb.y + eb.h) }
            : { x: eb.x, y: eb.y, x2: eb.x + eb.w, y2: eb.y + eb.h };
    }
    if (b) return [
      (b.x + b.x2) / 2 * state.camera.z + state.camera.x,
      (b.y + b.y2) / 2 * state.camera.z + state.camera.y,
    ];
  }
  return [canvas.clientWidth / 2, canvas.clientHeight / 2];
}
$('zoomInBtn').addEventListener('click', () => zoomAt(...zoomFocusPoint(), 1.2));
$('zoomOutBtn').addEventListener('click', () => zoomAt(...zoomFocusPoint(), 1/1.2));
$('zoomFitBtn').addEventListener('click', zoomToFit);
$('zoomLabel').addEventListener('click', () => {
  zoomAt(...zoomFocusPoint(), 1 / state.camera.z);
});

/* file menu */
$('menuBtn').addEventListener('click', ev => {
  ev.stopPropagation();
  $('fileMenu').classList.toggle('hidden');
});
function closeMenus(){
  $('fileMenu').classList.add('hidden');
  $('iconMenu').classList.add('hidden');
  $('exportMenu').classList.add('hidden');
  $('boardMenu').classList.add('hidden');
  $('gridMenu').classList.add('hidden');
  $('ctxMenu').classList.add('hidden');
}
document.addEventListener('click', ev => {
  if (!ev.target.closest('#brandIsland')) closeMenus();
});
$('fileMenu').addEventListener('click', ev => {
  const b = ev.target.closest('button');
  if (!b) return;
  closeMenus();
  runFileAction(b.dataset.act);
});
function newDocument(){
  const hasContent = state.pages.length > 1 || state.pages.some(p => p.elements.length);
  if (hasContent && !confirm('Start a new, empty document?\n\nThe current document will be replaced — use “Save sketch (.json)” first if you want to keep a copy. (⌘Z still brings the pages back.)')) return;
  state.pages = [{ id: uid(), name: 'Page 1', elements: [] }];
  state.pageIndex = 0;
  state.elements = state.pages[0].elements;
  state.selection = new Set();
  state.board = null;
  state.bgColor = null;
  state.camera = { x: 0, y: 0, z: 1 };
  try { localStorage.removeItem('asterisk.docname'); } catch (e){}
  buildPageStrip();
  syncPaperUI(); syncBoardBtn(); buildBoardMenuSel(); syncZoomLabel();
  commit(); syncPanel(); requestRender();
  showHint('New document — ⌘Z brings the previous pages back');
}
function runFileAction(act){
  if (act === 'new') newDocument();
  if (act === 'open') fileInput.click();
  if (act === 'save') saveJSON();
  if (act === 'image') $('imgInput').click();
  if (act === 'excal') exportExcalidraw();
  if (act === 'templates'){ buildTplList(); $('tplDialog').classList.remove('hidden'); }
  if (act === 'png') exportPNG(false);
  if (act === 'pngT') exportPNG(true);
  if (act === 'svg') exportSVG(false);
  if (act === 'svgT') exportSVG(true);
  if (act === 'pdf') exportPDFFlow();
  if (act === 'demo') loadDemo();
  if (act === 'paperReset'){
    state.bgColor = null;
    syncPaperUI(); requestRender(); scheduleAutosave();
  }
  if (act === 'clear'){
    if (confirm('Clear the whole canvas? (You can still undo.)')){
      state.elements = [];
      state.selection = new Set();
      commit(); syncPanel(); requestRender();
    }
  }
}

/* ── save / open / export ──────────────────────────── */
function download(name, url){
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}
function saveJSON(){
  const doc = JSON.parse(serialize());
  const data = {
    app: 'koralpaper', version: 5, appVersion: APP_VERSION,
    pages: doc.pages, pageIndex: doc.pageIndex,
    appState: { theme: state.theme, grid: state.grid, gridSize: state.gridSize, snap: state.snap,
      bgColor: state.bgColor, board: state.board },
  };
  const stamp = new Date().toISOString().slice(0, 10);
  let name = prompt('File name for the sketch:',
    localStorage.getItem('asterisk.docname') || `koralpaper-${stamp}`);
  if (name === null) return;
  name = name.trim().replace(/\.json$/i, '').replace(/[\/\\:*?"<>|]/g, '-');
  if (!name) name = `koralpaper-${stamp}`;
  try { localStorage.setItem('asterisk.docname', name); } catch (e){}
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  download(`${name}.json`, URL.createObjectURL(blob));
}
$('imgInput').addEventListener('change', () => {
  insertImageFiles($('imgInput').files, null, null);
  $('imgInput').value = '';
});
fileInput.addEventListener('change', () => {
  const f = fileInput.files[0];
  fileInput.value = '';
  if (!f) return;
  if (/\.json$/i.test(f.name)){
    try { localStorage.setItem('asterisk.docname', f.name.replace(/\.json$/i, '')); } catch (e){}
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.type === 'excalidraw'){
        importExcalidraw(data);
        return;
      }
      if (Array.isArray(data.pages) && data.pages.length){
        state.pages = data.pages.map(p => ({
          id: p.id || uid(), name: p.name || 'Page',
          elements: migrateElements(p.elements || [], data.version),
        }));
        state.pageIndex = clamp(Number(data.pageIndex) || 0, 0, state.pages.length - 1);
      } else {
        const els = Array.isArray(data) ? data : data.elements;
        if (!Array.isArray(els)) throw new Error('no elements');
        state.pages = [{ id: uid(), name: 'Page 1', elements: migrateElements(els, data.version) }];
        state.pageIndex = 0;
      }
      state.elements = state.pages[state.pageIndex].elements;
      buildPageStrip();
      if (data.appState){
        state.theme = data.appState.theme === 'dark' ? 'dark' : 'light';
        document.body.classList.toggle('dark', state.theme === 'dark');
        const g = data.appState.grid;
        state.grid = typeof g === 'string' ? g : (g !== false ? 'grid' : 'off');
        state.gridSize = clamp(Number(data.appState.gridSize) || GRID, 6, 120);
        state.snap = data.appState.snap !== false;
        state.bgColor = (typeof data.appState.bgColor === 'string' && data.appState.bgColor[0] === '#')
          ? data.appState.bgColor : null;
        state.board = (data.appState.board && data.appState.board.w > 0) ? data.appState.board : null;
        paintSwatches(); syncToggles(); syncPaperUI(); syncBoardBtn(); buildBoardMenuSel();
      }
      state.selection = new Set();
      updateBoundArrows(state.elements);
      commit(); zoomToFit(); syncPanel();
    } catch (e){
      alert('That file does not look like a KoralPaper sketch (.json).');
    }
  };
  reader.readAsText(f);
});

function exportPNG(transparent){
  const board = state.board;
  const off = document.createElement('canvas');
  const octx = off.getContext('2d');
  let name;
  if (board){
    // exact preset pixels; the grid ships with the artboard (unless transparent)
    off.width = board.w; off.height = board.h;
    renderScene(octx, state.elements, {
      width: board.w, height: board.h,
      camera: { x: -board.x, y: -board.y, z: 1 },
      pal: pal(), transparent, bg: effectiveBg(),
      grid: transparent ? false : state.grid, gridSize: gsize(),
      gridColor: effectiveGridColor(),
    });
    name = `koralpaper-${board.w}x${board.h}`;
  } else {
    const b = sceneBounds(state.elements);
    if (!b){ alert('Nothing to export yet — draw something first.'); return; }
    const pad = 72;
    const maxDim = 8000;
    let scale = 2;
    scale = Math.min(scale, maxDim / (b.w + pad*2), maxDim / (b.h + pad*2));
    const w = Math.ceil((b.w + pad*2) * scale), h = Math.ceil((b.h + pad*2) * scale);
    off.width = w; off.height = h;
    renderScene(octx, state.elements, {
      width: w, height: h,
      camera: { x: (pad - b.x) * scale, y: (pad - b.y) * scale, z: scale },
      pal: pal(), grid: false, transparent, bg: effectiveBg(),
    });
    name = `koralpaper-${new Date().toISOString().slice(0, 10)}`;
  }
  off.toBlob(blob => download(`${name}.png`, URL.createObjectURL(blob)), 'image/png');
}

/* ── templates ─────────────────────────────────────── */
const TPL_STORE = 'asterisk.templates.v1';
function tplHelpers(){
  const mk = (type, x, y, w, h, props) => {
    const el = newElement(type, x, y, props || {});
    if (w) el.w = w;
    if (h) el.h = h;
    return el;
  };
  const txt = (x, y, text, size, opts) => {
    const el = newElement('text', x, y,
      { font: 'sans', align: 'left', stroke: 'ink', ...(opts || {}) });
    el.text = text; el.size = size;
    autosizeText(el);
    return el;
  };
  return { mk, txt };
}
function tplLinkedInCarousel(){
  const { mk, txt } = tplHelpers();
  const header = () => [
    mk('chip', 60, 60, 330, 56, { text: 'CAIO ✳ PLAYBOOK', fill: 'periwinkle', size: 18 }),
  ];
  const footer = () => [
    txt(60, 1262, 'Stefanos Karagos · wearecaio.com', 20, { stroke: 'gmid' }),
    mk('icon', 950, 1236, 70, 70, { kind: 'asterisk', stroke: 'none', fill: 'coral' }),
  ];
  const pageNo = n => mk('chip', 950, 60, 70, 56, { text: n, fill: 'blush', size: 18 });
  const pages = [];
  // 1 — cover
  const swipe = mk('arrow', 840, 1130, 0, 0, { stroke: 'coral', sw: 3.3, curve: 0.18 });
  swipe.points = [[0, 0], [170, 0]];
  swipe.endHead = 'arrow'; swipe.text = 'swipe';
  pages.push({ name: 'Cover', elements: [
    ...header(),
    txt(60, 380, 'Your bold statement', 80, { font: 'serif' }),
    txt(60, 490, 'goes right here.', 80, { font: 'serif', stroke: 'coral' }),
    txt(62, 660, 'A one-line promise of what the reader gets\nby swiping through these slides.', 30, { stroke: 'gmid' }),
    swipe,
    ...footer(),
  ]});
  // 2 & 3 — content
  for (let i = 0; i < 2; i++){
    pages.push({ name: `Point 0${i + 1}`, elements: [
      ...header(), pageNo(`0${i + 1}`),
      txt(60, 220, 'One idea per slide', 52, { font: 'serif' }),
      txt(60, 380, 'Open with the claim in a single sentence —\nno warm-up, no hedging.', 28),
      txt(60, 560, 'Then back it with one concrete example\nor number your audience will remember.', 28, { stroke: 'gmid' }),
      mk('rect', 60, 820, 960, 150, {
        fill: 'butter', text: '★ The takeaway they should screenshot', size: 28, sketch: 1,
      }),
      ...footer(),
    ]});
  }
  // 4 — photo slide
  const ph = mk('rect', 60, 300, 960, 620, {
    fill: 'none', stroke: 'gmid', dash: 'dashed',
    text: 'Drop your image here\n(drag & drop, or the 🖼 toolbar button)\nthen try an Art style ✳', size: 26,
  });
  pages.push({ name: 'Photo', elements: [
    ...header(), pageNo('03'),
    txt(60, 210, 'Show, don’t tell', 52, { font: 'serif' }),
    ph,
    txt(60, 980, 'A caption that tells the reader what to notice.', 26, { stroke: 'gmid' }),
    ...footer(),
  ]});
  // 5 — CTA
  pages.push({ name: 'CTA', elements: [
    ...header(),
    mk('icon', 420, 300, 240, 240, { kind: 'asterisk', stroke: 'none', fill: 'coral' }),
    txt(60, 640, 'Follow for more of this.', 64, { font: 'serif', align: 'left' }),
    txt(62, 760, 'Repost helps more people escape tool-mode.\nDM “PLAYBOOK” for the full guide.', 28, { stroke: 'gmid' }),
    ...footer(),
  ]});
  return { board: { name: 'LinkedIn carousel', w: 1080, h: 1350, x: 0, y: 0 }, pages };
}
function tplFlowchart(){
  const { mk, txt } = tplHelpers();
  const els = [txt(80, 60, 'Process name', 42, { font: 'serif' })];
  const start = mk('chip', 80, 180, 170, 52, { text: 'Start', fill: 'sage', size: 18 });
  const step = mk('rect', 360, 160, 240, 90, { fill: 'cream', text: 'First step', size: 21 });
  const dec = mk('diamond', 720, 140, 230, 130, { fill: 'periwinkle', text: 'Decision?', size: 21 });
  const yes = mk('rect', 720, 380, 230, 90, { fill: 'butter', text: 'Do the thing', size: 21 });
  const no = mk('rect', 360, 380, 230, 90, { fill: 'blush', text: 'Rework', size: 21 });
  els.push(start, step, dec, yes, no);
  const link = (a, b2, label, curve) => {
    const ar = mk('arrow', a.x + a.w / 2, a.y + a.h / 2, 0, 0, { stroke: 'ink', sw: 3.3, curve: curve || 0 });
    ar.points = [[0, 0], [10, 10]];
    ar.startBind = a.id; ar.endBind = b2.id;
    if (label) ar.text = label;
    els.push(ar);
  };
  link(start, step); link(step, dec); link(dec, yes, 'yes'); link(dec, no, 'no', 0.2); link(no, step, 'retry', 0.25);
  return { board: null, pages: [{ name: 'Flowchart', elements: els }] };
}
function tplVersus(){
  const { mk, txt } = tplHelpers();
  const els = [
    txt(90, 60, 'Option A vs Option B', 46, { font: 'serif' }),
    mk('rect', 80, 180, 420, 460, { fill: 'periwinkle', fillStyle: 'hachure', stroke: 'blue' }),
    mk('rect', 560, 180, 420, 460, { fill: 'blush', fillStyle: 'hachure', stroke: 'coral' }),
    mk('chip', 200, 210, 180, 50, { text: 'Option A', fill: 'periwinkle', size: 18 }),
    mk('chip', 680, 210, 180, 50, { text: 'Option B', fill: 'blush', size: 18 }),
    txt(120, 300, '+ first advantage\n+ second advantage\n– one honest drawback', 24),
    txt(600, 300, '+ first advantage\n+ second advantage\n– one honest drawback', 24),
    mk('rect', 280, 700, 500, 110, { fill: 'butter', text: 'Verdict: pick one and say why', size: 24, angle: -0.02 }),
  ];
  return { board: null, pages: [{ name: 'Versus', elements: els }] };
}
function tplQuoteCard(){
  const { mk, txt } = tplHelpers();
  const els = [
    mk('icon', 80, 90, 110, 110, { kind: 'asterisk', stroke: 'none', fill: 'coral' }),
    txt(80, 320, '“AI is an intelligence to\ncommunicate with, not a\ntool to operate.”', 64, { font: 'serif' }),
    txt(82, 720, '— Stefanos Karagos, CAIO Group', 28, { stroke: 'gmid' }),
    txt(82, 950, 'wearecaio.com', 22, { stroke: 'coral' }),
  ];
  return { board: { name: 'Quote card', w: 1080, h: 1080, x: 0, y: 0 }, pages: [{ name: 'Quote', elements: els }] };
}
const TEMPLATES = [
  { id: 'li-carousel', name: 'LinkedIn carousel', desc: '5 slides: cover, two content, photo, CTA — header & footer on every slide', build: tplLinkedInCarousel },
  { id: 'flowchart', name: 'Flowchart kit', desc: 'Start, steps, decision diamond, labeled glued arrows', build: tplFlowchart },
  { id: 'versus', name: 'Comparison / Versus', desc: 'Two columns with pros & cons and a verdict sticky', build: tplVersus },
  { id: 'quote', name: 'Quote card', desc: '1080×1080 square with a big serif quote', build: tplQuoteCard },
];
function loadUserTemplates(){
  try { return JSON.parse(localStorage.getItem(TPL_STORE)) || []; }
  catch (e){ return []; }
}
function clonePageElements(els){
  const idMap = new Map(), gidMap = new Map();
  const clones = els.map(e => {
    const c = JSON.parse(JSON.stringify(e, (k, v) => k.startsWith('_') ? undefined : v));
    idMap.set(e.id, c.id = uid());
    if (c.groupId){
      if (!gidMap.has(c.groupId)) gidMap.set(c.groupId, uid());
      c.groupId = gidMap.get(c.groupId);
    }
    return c;
  });
  for (const c of clones){
    if (c.startBind) c.startBind = idMap.get(c.startBind) || null;
    if (c.endBind) c.endBind = idMap.get(c.endBind) || null;
  }
  return clones;
}
function applyTemplate(def){
  const built = def.build ? def.build() : def;
  syncPageRef();
  const startIdx = state.pages.length;
  for (const pg of built.pages)
    state.pages.push(makePage(clonePageElements(pg.elements), pg.name));
  if (built.board) state.board = { ...built.board };
  state.pageIndex = startIdx;
  state.elements = state.pages[startIdx].elements;
  state.selection = new Set();
  updateBoundArrows(state.elements);
  syncBoardBtn(); buildBoardMenuSel();
  commit(); buildPageStrip(); zoomToFit(); syncPanel();
  $('tplDialog').classList.add('hidden');
  showHint(`Template added — ${built.pages.length} page${built.pages.length > 1 ? 's' : ''}, fully editable`);
}
function saveUserTemplate(){
  const name = prompt('Template name:', state.pages[state.pageIndex].name || 'My template');
  if (!name || !name.trim()) return;
  syncPageRef();
  const list = loadUserTemplates();
  list.push({
    id: uid(), name: name.trim(),
    pages: [{ name: name.trim(),
      elements: JSON.parse(JSON.stringify(state.elements, (k, v) => k.startsWith('_') ? undefined : v)) }],
    board: state.board ? { ...state.board } : null,
  });
  try { localStorage.setItem(TPL_STORE, JSON.stringify(list)); }
  catch (e){ alert('Could not save the template (storage is full).'); return; }
  buildTplList();
  showHint(`“${name.trim()}” saved to your template library`);
}
function buildTplList(){
  const list = $('tplList');
  list.replaceChildren();
  const addRow = (name, desc, onApply, onDelete) => {
    const row = document.createElement('div');
    row.className = 'tplrow';
    const info = document.createElement('div');
    info.className = 'tplinfo';
    const nm = document.createElement('b'); nm.textContent = name;
    const ds = document.createElement('span'); ds.textContent = desc;
    info.appendChild(nm); info.appendChild(ds);
    row.appendChild(info);
    const apply = document.createElement('button');
    apply.className = 'minipill';
    apply.textContent = 'Add';
    apply.addEventListener('click', onApply);
    row.appendChild(apply);
    if (onDelete){
      const del = document.createElement('button');
      del.className = 'minipill danger tpldel';
      del.textContent = '✕';
      del.title = 'Delete this template';
      del.addEventListener('click', onDelete);
      row.appendChild(del);
    }
    list.appendChild(row);
  };
  for (const t of TEMPLATES) addRow(t.name, t.desc, () => applyTemplate(t));
  const user = loadUserTemplates();
  if (user.length){
    const head = document.createElement('div');
    head.className = 'menuhead';
    head.textContent = 'Your templates';
    list.appendChild(head);
    for (const t of user)
      addRow(t.name, `${t.pages.length} page${t.pages.length > 1 ? 's' : ''}${t.board ? ` · ${t.board.w}×${t.board.h}` : ''}`,
        () => applyTemplate(t),
        () => {
          const rest = loadUserTemplates().filter(x => x.id !== t.id);
          localStorage.setItem(TPL_STORE, JSON.stringify(rest));
          buildTplList();
        });
  }
}
$('tplSaveBtn').addEventListener('click', saveUserTemplate);
$('tplCloseBtn').addEventListener('click', () => $('tplDialog').classList.add('hidden'));

/* ── Excalidraw interop ────────────────────────────── */
function excalFont(font){
  const f = FONTS[font];
  if (['hand','caveat','patrick','kalam','architects','shadows'].includes(font)) return 1; // Virgil
  if (font === 'jetbrains' || font === 'ibmplex') return 3; // code
  return 2; // normal
}
function exportExcalidraw(){
  syncPageRef();
  const p = pal();
  const files = {};
  const out = [];
  let skipped = 0;
  const strokeHex = el => resolveStroke(p, el.stroke) || '#1e1e1e';
  const base = el => ({
    id: el.id, angle: el.angle || 0, x: el.x, y: el.y,
    strokeColor: el.stroke === 'none' ? 'transparent' : strokeHex(el),
    backgroundColor: resolveFill(p, el.fill) || 'transparent',
    fillStyle: (!el.fillStyle || el.fillStyle === 'solid') ? 'solid'
      : el.fillStyle === 'cross' ? 'cross-hatch' : 'hachure',
    strokeWidth: el.sw <= 2.5 ? 1 : el.sw <= 4.5 ? 2 : 4,
    strokeStyle: el.dash === 'dashed' ? 'dashed' : el.dash === 'dotted' ? 'dotted' : 'solid',
    roughness: el.sketch === 0 ? 0 : el.sketch === 2 ? 2 : 1,
    opacity: el.opacity == null ? 100 : el.opacity,
    groupIds: el.groupId ? [el.groupId] : [],
    frameId: null, roundness: null, seed: el.seed || 1,
    version: 1, versionNonce: (Math.random() * 2 ** 31) | 0,
    isDeleted: false, boundElements: null, updated: 1, link: null, locked: false,
  });
  const pushShapeText = el => {
    if (!el.text || !el.text.trim()) return;
    const m = measureText(el.text, el.font, el.size);
    // properly BOUND label: Excalidraw manages it inside the container,
    // and our importer re-merges it into the shape
    out[out.length - 1].boundElements = [{ type: 'text', id: el.id + '_t' }];
    out.push({
      ...base(el), id: el.id + '_t', type: 'text',
      x: el.x + el.w / 2 - m.w / 2, y: el.y + el.h / 2 - m.h / 2,
      width: m.w, height: m.h,
      strokeColor: el.fill === 'ink' ? effectiveBg() : strokeHex(el),
      backgroundColor: 'transparent',
      text: el.text, originalText: el.text, fontSize: el.size,
      fontFamily: excalFont(el.font), textAlign: 'center', verticalAlign: 'middle',
      containerId: el.id, lineHeight: 1.3, autoResize: true,
    });
  };
  for (const el of state.elements){
    if (el.type === 'rect' || el.type === 'chip' || el.type === 'ellipse' || el.type === 'diamond'){
      out.push({
        ...base(el),
        type: el.type === 'ellipse' ? 'ellipse' : el.type === 'diamond' ? 'diamond' : 'rectangle',
        width: el.w, height: el.h,
        roundness: (el.round || el.type === 'chip') ? { type: 3 } : null,
      });
      pushShapeText(el);
    } else if (el.type === 'arrow' || el.type === 'line'){
      out.push({
        ...base(el), type: el.type, width: el.w, height: el.h,
        points: (el.elbow && el.elbowPts && el.elbowPts.length
          ? [el.points[0], ...el.elbowPts, el.points[el.points.length-1]]
          : el.points).map(pt => [pt[0], pt[1]]),
        lastCommittedPoint: null, startBinding: null, endBinding: null,
        elbowed: !!el.elbow,
        startArrowhead: el.startHead === 'none' || !el.startHead ? null
          : el.startHead === 'circle' ? 'dot' : el.startHead,
        endArrowhead: el.endHead === 'none' || !el.endHead ? null
          : el.endHead === 'circle' ? 'dot' : el.endHead,
      });
      if (el.text && el.text.trim()){
        const mid = linearMidpoint(el);
        const m = measureText(el.text, el.font, el.size);
        out[out.length - 1].boundElements = [{ type: 'text', id: el.id + '_t' }];
        out.push({
          ...base(el), id: el.id + '_t', type: 'text',
          x: mid[0] - m.w / 2, y: mid[1] - m.h / 2, width: m.w, height: m.h,
          backgroundColor: 'transparent',
          text: el.text, originalText: el.text, fontSize: el.size,
          fontFamily: excalFont(el.font), textAlign: 'center', verticalAlign: 'middle',
          containerId: el.id, lineHeight: 1.3, autoResize: true,
        });
      }
    } else if (el.type === 'draw'){
      out.push({
        ...base(el), type: 'freedraw', width: el.w, height: el.h,
        points: el.points.map(pt => [pt[0], pt[1]]),
        pressures: [], simulatePressure: true, lastCommittedPoint: null,
      });
    } else if (el.type === 'text'){
      out.push({
        ...base(el), type: 'text', width: el.w, height: el.h,
        strokeColor: strokeHex(el), backgroundColor: 'transparent',
        text: el.text, originalText: el.text, fontSize: el.size,
        fontFamily: excalFont(el.font), textAlign: el.align || 'left',
        verticalAlign: 'top', containerId: null, lineHeight: 1.3, autoResize: true,
      });
    } else if (el.type === 'image' && el.src){
      const fileId = 'f' + el.id;
      files[fileId] = {
        mimeType: el.src.startsWith('data:image/png') ? 'image/png' : 'image/jpeg',
        id: fileId, dataURL: el.src, created: 1,
      };
      out.push({
        ...base(el), type: 'image', width: el.w, height: el.h,
        fileId, status: 'saved', scale: [1, 1],
      });
    } else skipped++;
  }
  const doc = {
    type: 'excalidraw', version: 2, source: 'koralpaper',
    elements: out,
    appState: {
      viewBackgroundColor: effectiveBg(),
      gridSize: state.grid !== 'off' ? gsize() : null,
    },
    files,
  };
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
  const name = (state.pages[state.pageIndex].name || 'page').replace(/[^\w-]+/g, '-').toLowerCase();
  download(`koralpaper-${name}.excalidraw`, URL.createObjectURL(blob));
  if (skipped) showHint(`${skipped} icon/art element(s) skipped — Excalidraw has no equivalent (photos export as photos)`);
}
function importExcalidraw(data){
  const els = [];
  const files = data.files || {};
  const byExId = {};
  for (const ex of data.elements || []){
    if (ex.isDeleted) continue;
    const style = {
      stroke: (!ex.strokeColor || ex.strokeColor === 'transparent') ? 'none' : ex.strokeColor,
      fill: (!ex.backgroundColor || ex.backgroundColor === 'transparent') ? 'none' : ex.backgroundColor,
      fillStyle: ex.fillStyle === 'solid' ? 'solid' : ex.fillStyle === 'cross-hatch' ? 'cross' : 'hachure',
      sw: (ex.strokeWidth || 1) <= 1 ? widths.fine : ex.strokeWidth <= 2 ? widths.medium : widths.thick,
      dash: ex.strokeStyle === 'dashed' ? 'dashed' : ex.strokeStyle === 'dotted' ? 'dotted' : 'solid',
      sketch: ex.roughness === 0 ? 0 : ex.roughness === 2 ? 2 : 1,
      opacity: ex.opacity == null ? 100 : ex.opacity,
    };
    let el = null;
    switch (ex.type){
      case 'rectangle':
        el = newElement('rect', ex.x, ex.y, style);
        el.w = ex.width; el.h = ex.height; el.round = ex.roundness ? 1 : 0;
        break;
      case 'ellipse':
      case 'diamond':
        el = newElement(ex.type, ex.x, ex.y, style);
        el.w = ex.width; el.h = ex.height;
        break;
      case 'arrow':
      case 'line':
        el = newElement(ex.type, ex.x, ex.y, style);
        el.points = (ex.points && ex.points.length > 1 ? ex.points : [[0,0],[ex.width||10, ex.height||0]]).map(pt => [pt[0], pt[1]]);
        {
          const mapHead = h => !h ? 'none'
            : h === 'triangle' || h === 'triangle_outline' ? 'triangle'
            : h === 'dot' || h === 'circle' || h === 'circle_outline' ? 'circle'
            : 'arrow';
          el.startHead = mapHead(ex.startArrowhead);
          el.endHead = ex.type === 'arrow' && ex.endArrowhead === undefined
            ? 'arrow' : mapHead(ex.endArrowhead);
        }
        if (ex.elbowed){
          // Excalidraw elbow arrows carry their bends as extra points —
          // adopt the intermediate ones as our editable corners
          el.elbow = true;
          if (el.points.length > 2) el.elbowPts = el.points.slice(1, -1);
          el.points = [el.points[0], el.points[el.points.length - 1]];
        }
        normalizeLinear(el);
        break;
      case 'freedraw':
        el = newElement('draw', ex.x, ex.y, style);
        el.points = (ex.points || [[0,0],[1,1]]).map(pt => [pt[0], pt[1]]);
        normalizeLinear(el);
        break;
      case 'text':
        el = newElement('text', ex.x, ex.y, {
          ...style, stroke: style.stroke === 'none' ? 'ink' : style.stroke,
        });
        el.text = ex.text || '';
        el.size = ex.fontSize || 20;
        el.font = ex.fontFamily === 1 ? 'hand' : ex.fontFamily === 3 ? 'jetbrains' : 'sans';
        el.align = ex.textAlign || 'left';
        autosizeText(el);
        if (ex.containerId) el._container = ex.containerId;
        break;
      case 'image': {
        const f = files[ex.fileId];
        if (f && f.dataURL){
          el = newElement('image', ex.x, ex.y, {});
          el.src = f.dataURL; el.w = ex.width; el.h = ex.height;
          el.opacity = style.opacity;
        }
        break;
      }
    }
    if (el){
      el.angle = ex.angle || 0;
      if (ex.groupIds && ex.groupIds.length) el.groupId = ex.groupIds[ex.groupIds.length - 1];
      byExId[ex.id] = el;
      els.push(el);
    }
  }
  // Excalidraw bound labels → our container text
  for (let i = els.length - 1; i >= 0; i--){
    const el = els[i];
    if (el._container){
      const host = byExId[el._container];
      delete el._container;
      if (host && canHaveText(host)){
        host.text = el.text; host.font = el.font; host.size = el.size;
        els.splice(i, 1);
      }
    }
  }
  syncPageRef();
  state.pages.push(makePage(els, 'Excalidraw import'));
  state.pageIndex = state.pages.length - 1;
  state.elements = state.pages[state.pageIndex].elements;
  state.selection = new Set();
  updateBoundArrows(state.elements);
  commit(); buildPageStrip(); zoomToFit(); syncPanel();
  showHint(`Imported ${els.length} elements from Excalidraw onto a new page`);
}

/* ── PDF export ────────────────────────────────────── */
function pageCrop(els){
  if (state.board) return { x: state.board.x, y: state.board.y, w: state.board.w, h: state.board.h };
  const b = sceneBounds(els);
  if (!b) return null;
  const pad = 72;
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
}
function exportPDF(pageIdxs){
  const imgs = [];
  for (const i of pageIdxs){
    const els = state.pages[i].elements;
    const crop = pageCrop(els);
    if (!crop) continue; // empty page on an unlimited canvas — nothing to print
    const maxDim = 4200;
    const sc = Math.min(2, maxDim / crop.w, maxDim / crop.h);
    const off = document.createElement('canvas');
    off.width = Math.ceil(crop.w * sc);
    off.height = Math.ceil(crop.h * sc);
    renderScene(off.getContext('2d'), els, {
      width: off.width, height: off.height,
      camera: { x: -crop.x * sc, y: -crop.y * sc, z: sc },
      pal: pal(), bg: effectiveBg(),
      grid: state.board ? state.grid : false, gridSize: gsize(),
      gridColor: effectiveGridColor(),
    });
    imgs.push({
      bytes: dataURLToBytes(off.toDataURL('image/jpeg', 0.92)),
      w: Math.round(crop.w), h: Math.round(crop.h),
      pxW: off.width, pxH: off.height,
    });
  }
  if (!imgs.length){ alert('Nothing to export — the selected pages are empty.'); return; }
  const blob = buildPDF(imgs);
  const stamp = new Date().toISOString().slice(0, 10);
  download(`koralpaper-${stamp}.pdf`, URL.createObjectURL(blob));
}
function exportPDFFlow(){
  if (state.pages.length === 1){ exportPDF([0]); return; }
  openPdfDialog();
}
function openPdfDialog(){
  syncPageRef();
  const dlg = $('pdfDialog');
  const list = $('pdfPageList');
  list.replaceChildren();
  state.pages.forEach((p, i) => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.i = i;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(` ${i + 1} — ${p.name}`));
    list.appendChild(label);
  });
  dlg.classList.remove('hidden');
}
$('pdfExportBtn').addEventListener('click', () => {
  const idxs = [...document.querySelectorAll('#pdfPageList input:checked')].map(cb => Number(cb.dataset.i));
  $('pdfDialog').classList.add('hidden');
  if (idxs.length) exportPDF(idxs);
});
$('pdfCancelBtn').addEventListener('click', () => $('pdfDialog').classList.add('hidden'));

function exportSVG(transparent){
  const board = state.board;
  const svg = renderSceneSVG(state.elements, {
    pal: pal(), transparent, bg: effectiveBg(),
    board, grid: board && !transparent ? state.grid : false,
    gridColor: effectiveGridColor(), gridSize: gsize(),
  });
  if (!svg){ alert('Nothing to export yet — draw something first.'); return; }
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const name = board ? `koralpaper-${board.w}x${board.h}` : `koralpaper-${new Date().toISOString().slice(0, 10)}`;
  download(`${name}.svg`, URL.createObjectURL(blob));
}

/* ── keyboard ──────────────────────────────────────── */
const TOOL_KEYS = { v:'select', h:'hand', r:'rect', d:'diamond', o:'ellipse',
  c:'chip', s:'icon', a:'arrow', l:'line', p:'draw', t:'text' };

window.addEventListener('keydown', ev => {
  if (editing || ev.target === editorEl || ev.target.tagName === 'INPUT') {
    if (ev.key === ' ') return;
    return;
  }
  const mod = ev.metaKey || ev.ctrlKey;
  const k = ev.key.toLowerCase();

  if (ev.key === ' '){ spaceDown = true; canvas.classList.add('tool-hand'); return; }

  if (mod && k === 'z'){ ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y'){ ev.preventDefault(); redo(); return; }
  if (mod && k === 'a'){ ev.preventDefault(); setSelection(new Set(state.elements.map(e => e.id))); setTool('select'); return; }
  if (mod && ev.altKey && k === 'c'){ ev.preventDefault(); copyStyle(); return; }
  if (mod && ev.altKey && k === 'v'){ ev.preventDefault(); pasteStyle(); return; }
  if (mod && ev.altKey && k === 'n'){ ev.preventDefault(); newDocument(); return; }
  if (mod && k === 'c'){ ev.preventDefault(); copySelection(); return; }
  if (mod && k === 'x'){ ev.preventDefault(); copySelection(); deleteSelection(); return; }
  if (mod && k === 'v'){ return; } // handled by the 'paste' event (supports images)
  if (mod && k === 'd'){ ev.preventDefault(); duplicateSelection(); return; }
  if (mod && k === 'g'){ ev.preventDefault(); ev.shiftKey ? ungroupSelection() : groupSelection(); return; }
  if (mod && k === 's'){ ev.preventDefault(); saveJSON(); return; }
  if (mod && k === 'o'){ ev.preventDefault(); fileInput.click(); return; }
  if (mod) return;

  if (ev.key === 'Delete' || ev.key === 'Backspace'){ ev.preventDefault(); deleteSelection(); return; }
  if (ev.key === 'Escape'){
    if (cropTarget){ endCropMode(); showHint('Crop cancelled'); return; }
    setSelection(new Set()); closeMenus(); closeColorPop(); closePaperPop();
    $('shortcutsCard').classList.add('hidden');
    $('tplDialog').classList.add('hidden');
    $('pdfDialog').classList.add('hidden');
    return; }
  if (ev.key === 'Enter'){
    const sel = selected();
    if (sel.length === 1 && canHaveText(sel[0])){ ev.preventDefault(); openTextEditor(sel[0], false); }
    return;
  }
  if (ev.key === '?'){ $('shortcutsCard').classList.toggle('hidden'); return; }
  if (k === 'g'){
    if (ev.shiftKey){ state.snap = !state.snap; syncToggles(); scheduleAutosave(); }
    else cycleGrid();
    return; }
  if (ev.shiftKey && ev.key === '!'){ zoomToFit(); return; }
  if (ev.key.startsWith('Arrow')){
    const step = ev.shiftKey ? 10 : 2;
    const dx = ev.key === 'ArrowLeft' ? -step : ev.key === 'ArrowRight' ? step : 0;
    const dy = ev.key === 'ArrowUp' ? -step : ev.key === 'ArrowDown' ? step : 0;
    if (state.selection.size){
      ev.preventDefault();
      for (const el of selected()){ el.x += dx; el.y += dy; }
      updateBoundArrows(state.elements);
      commit(); requestRender();
    }
    return;
  }
  if (k === 'i' && !ev.shiftKey){ $('imgInput').click(); return; }
  if (TOOL_KEYS[k] && !ev.shiftKey){ setTool(TOOL_KEYS[k]); return; }
});
window.addEventListener('keyup', ev => {
  if (ev.key === ' '){
    spaceDown = false;
    if (state.tool !== 'hand') canvas.classList.remove('tool-hand');
  }
});

/* reposition the editor if the window scrolls/zooms while editing */
window.addEventListener('resize', () => { positionEditor(); requestRender(); });

/* ── demo scene ────────────────────────────────────── */
function demoElements(){
  const els = [];
  const mk = (type, x, y, w, h, extra) => {
    const el = newElement(type, x, y, extra);
    el.w = w; el.h = h;
    Object.assign(el, extra || {});
    els.push(el);
    return el;
  };
  const title = newElement('text', 90, 120, {
    text: 'Sketch it like Claude.', font: 'serif', size: 46, align: 'left', stroke: 'ink',
  });
  autosizeText(title); els.push(title);

  const sub = newElement('text', 92, 186, {
    text: 'Sticky notes, wobbly arrows, and one proud asterisk —\nall drawn by hand (well, almost).',
    font: 'sans', size: 16, align: 'left', stroke: 'ink', opacity: 65,
  });
  autosizeText(sub); els.push(sub);

  const chip = mk('chip', 96, 300, 132, 38, {
    text: 'Mulling…', fill: 'periwinkle', size: 16, font: 'sans',
  });
  const sticky = mk('rect', 330, 420, 250, 96, {
    text: 'Raise the effort', fill: 'terracotta', font: 'sans', size: 24, sketch: 1, angle: -0.02,
  });
  const sticky2 = mk('rect', 660, 300, 260, 92, {
    text: 'Change the model', fill: 'cream', font: 'sans', size: 24, angle: 0.025,
  });
  const note = mk('rect', 640, 470, 300, 104, {
    text: 'Drag an arrow between shapes — it glues to both and follows them around.',
    fill: 'none', font: 'sans', size: 15, align: 'left',
  });
  const star = mk('icon', 700, 120, 104, 104, { stroke: 'none', fill: 'coral', kind: 'asterisk' });
  mk('icon', 520, 168, 58, 58, { kind: 'spiral', stroke: 'ink' });
  mk('icon', 90, 470, 160, 104, { kind: 'cloud', stroke: 'ink', fill: 'sky' });
  mk('icon', 968, 300, 46, 62, { kind: 'question', stroke: 'coral', sw: 5 });

  const a1 = newElement('arrow', 0, 0, { stroke: 'ink', curve: 0.22 });
  a1.points = [[0,0],[10,10]];
  a1.startBind = chip.id; a1.endBind = sticky.id;
  a1.x = chip.x + 60; a1.y = chip.y + 60;
  els.push(a1);

  const a2 = newElement('arrow', 0, 0, { stroke: 'coral', curve: -0.2, sw: 3.3 });
  a2.points = [[0,0],[10,10]];
  a2.startBind = sticky.id; a2.endBind = sticky2.id;
  a2.x = sticky.x + 100; a2.y = sticky.y;
  els.push(a2);

  updateBoundArrows(els);
  return els;
}
function loadDemo(){
  state.elements = demoElements();
  state.selection = new Set();
  syncPageRef();
  commit(); buildPageStrip(); zoomToFit(); syncPanel();
}

/* ── boot ──────────────────────────────────────────── */
function boot(){
  $('menuVersion').textContent = `KoralPaper v${APP_VERSION}`;
  document.querySelector('.brand .name').title = `KoralPaper v${APP_VERSION}`;
  buildSwatches();
  buildPaperSwatches();
  buildFontSelect();
  syncSettingsUI();
  applyWidthPresets();
  buildIconMenu();
  buildBoardMenu();
  loadGoogleFonts();
  loadSaved();
  document.body.classList.toggle('dark', state.theme === 'dark');
  paintSwatches();
  syncToggles();
  syncPaperUI();
  syncBoardBtn();
  buildBoardMenuSel();
  if (!state.pages.length){
    state.pages = [{ id: uid(), name: 'Page 1', elements: [] }];
    state.pageIndex = 0;
    state.elements = state.pages[0].elements;
  }
  updateBoundArrows(state.elements);
  buildPageStrip();
  history = [serialize()];
  histIndex = 0;
  syncHistoryButtons();
  setTool('select');
  syncZoomLabel();
  requestRender();
  showHint('Double-click any shape to type in it · press ? for shortcuts');
}
boot();
