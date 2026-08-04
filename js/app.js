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
  images: {},            // shared image store: imgId → data URL (pixels live ONCE)
};
/* user-adjustable width + text-size presets (Settings panel), persisted separately */
const SETTINGS_KEY = 'koralpaper.settings';
const DEFAULT_WIDTHS = { fine: 1.7, medium: 3.3, thick: 5 };
const DEFAULT_SIZES = { s: 16, m: 21, l: 29, xl: 42 };
const DEFAULT_TYPO = { lh: 1.3, pgap: 0, lspace: 0 };
const widths = { ...DEFAULT_WIDTHS };
const sizes = { ...DEFAULT_SIZES };
const typo = { ...DEFAULT_TYPO };
try {
  const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  if (s.widths) for (const k of Object.keys(DEFAULT_WIDTHS))
    if (typeof s.widths[k] === 'number') widths[k] = clamp(s.widths[k], 0.5, 14);
  if (s.sizes) for (const k of Object.keys(DEFAULT_SIZES))
    if (typeof s.sizes[k] === 'number') sizes[k] = clamp(Math.round(s.sizes[k]), 8, 160);
  if (s.typo){
    if (typeof s.typo.lh === 'number') typo.lh = clamp(s.typo.lh, 0.5, 2.5);
    if (typeof s.typo.pgap === 'number') typo.pgap = clamp(s.typo.pgap, 0, 48);
    if (typeof s.typo.lspace === 'number') typo.lspace = clamp(s.typo.lspace, -7, 15);
  }
} catch (e){ /* fresh settings */ }
function saveSettings(){
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ widths, sizes, typo })); } catch (e){}
}

const defaults = {
  stroke:'ink', fill:'cream', fillStyle:'solid', dash:'solid', sw:widths.medium, sketch:1, round:1,
  opacity:100, font:'sans', size:sizes.m, align:'center',
  curve:0, elbow:false, startHead:'none', endHead:'arrow',
  lh:typo.lh, pgap:typo.pgap, lspace:typo.lspace, valign:'middle',
  hlColor:'#F7E36B',
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
    if (el.font === 'archivo') el.font = 'spacegrotesk'; // short-lived v3.7.0 font
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

function sceneOpts(w, h, camera){
  return {
    width: w, height: h, camera, pal: pal(),
    grid: state.grid, gridSize: gsize(),
    bg: effectiveBg(), gridColor: effectiveGridColor(),
    board: state.board, outside: state.board ? outsideColor() : null,
  };
}

/* ── interaction-time render cache ──────────────────
   During drags/pans, static elements are rasterized once to an offscreen
   bitmap; each frame only blits it and redraws the few moving elements —
   heavy documents stay at full frame rate. The cache lives exactly as long
   as one interaction and is dropped the moment it ends. */
let staticCache = null;
const CACHE_KINDS = new Set(['move','resize','rotate','curve','elbowSeg','endpoint','create','marquee','pan']);
function movingIdsFor(it){
  let base;
  if (it.kind === 'move') base = new Set(it.ids);
  else if (it.kind === 'resize' || it.kind === 'rotate') base = new Set(state.selection);
  else if (it.kind === 'marquee') base = new Set();
  else base = new Set([it.el.id]); // create / curve / elbowSeg / endpoint
  for (const el of state.elements)
    if (isLinear(el) && (base.has(el.startBind) || base.has(el.endBind))) base.add(el.id);
  return base;
}
function renderInteractionCached(it, dpr, w, h){
  const camKey = state.camera.x + ',' + state.camera.y + ',' + state.camera.z + ',' + w + 'x' + h;
  const moving = movingIdsFor(it);
  const movKey = [...moving].sort().join('|');
  if (!staticCache || staticCache.it !== it || staticCache.camKey !== camKey || staticCache.movKey !== movKey){
    const off = document.createElement('canvas');
    off.width = Math.max(1, w * dpr); off.height = Math.max(1, h * dpr);
    const octx = off.getContext('2d');
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderScene(octx, visibleEls(state.elements).filter(e => !moving.has(e.id)), sceneOpts(w, h, state.camera));
    staticCache = { c: off, it, camKey, movKey };
  }
  ctx.drawImage(staticCache.c, 0, 0, w, h);
  setRouteContext(state.elements); // routes must see every obstacle
  const p = pal(), bgc = effectiveBg();
  ctx.save();
  ctx.translate(state.camera.x, state.camera.y);
  ctx.scale(state.camera.z, state.camera.z);
  for (const el of state.elements) if (moving.has(el.id)) drawElement(ctx, el, p, bgc);
  ctx.restore();
  drawOverlay();
}
function renderPanCached(dpr, w, h){
  const M = 400; // extra margin so short pans never hit the bitmap edge
  const cam = state.camera;
  if (!staticCache || staticCache.kind !== 'pan' || staticCache.it !== interaction ||
      staticCache.z !== cam.z ||
      Math.abs(cam.x - staticCache.cam.x) > M || Math.abs(cam.y - staticCache.cam.y) > M){
    const off = document.createElement('canvas');
    off.width = (w + 2 * M) * dpr; off.height = (h + 2 * M) * dpr;
    const octx = off.getContext('2d');
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderScene(octx, visibleEls(state.elements),
      sceneOpts(w + 2 * M, h + 2 * M, { x: cam.x + M, y: cam.y + M, z: cam.z }));
    staticCache = { kind: 'pan', c: off, cam: { x: cam.x, y: cam.y }, z: cam.z, it: interaction };
  }
  const dx = cam.x - staticCache.cam.x, dy = cam.y - staticCache.cam.y;
  ctx.fillStyle = state.board ? outsideColor() : effectiveBg();
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(staticCache.c, -M + dx, -M + dy, w + 2 * M, h + 2 * M);
  drawOverlay();
}

function render(){
  if (replaying) return; // the replay loop owns the canvas
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr){
    canvas.width = w * dpr; canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const it = interaction;
  if (it && CACHE_KINDS.has(it.kind) && state.elements.length >= 12){
    if (it.kind === 'pan') return renderPanCached(dpr, w, h);
    return renderInteractionCached(it, dpr, w, h);
  }
  staticCache = null;
  renderScene(ctx, visibleEls(state.elements), sceneOpts(w, h, state.camera));
  drawOverlay();
}

function drawOverlay(){
  const p = pal();
  const z = state.camera.z;

  // empty-canvas guidance: only on a completely blank document, gone forever
  // the moment the first element lands
  if (state.pages.length === 1 && state.elements.length === 0 &&
      !interaction && !editing && !presenting && state.tool === 'select'){
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = state.theme === 'light' ? 'rgba(32,29,24,.34)' : 'rgba(236,231,218,.34)';
    ctx.font = `italic 500 19px ${FONTS.serif.stack}`;
    ctx.fillText('Draw your thinking', w / 2, h / 2 - 26);
    ctx.font = `13px ${FONTS.sans.stack}`;
    ctx.fillStyle = state.theme === 'light' ? 'rgba(32,29,24,.26)' : 'rgba(236,231,218,.26)';
    ctx.fillText('R rectangle · A arrow · T text · double-click a shape to type', w / 2, h / 2 + 2);
    ctx.fillText('? shortcuts & settings · ☰ templates and the tour', w / 2, h / 2 + 24);
    ctx.restore();
  }

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

  // mind-map fold badges: − on expanded parents, +N on folded ones
  const badges = mindBadgesFor(state.elements);
  if (badges.length){
    const pnow = pal();
    ctx.lineWidth = 1.5 / z;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const bd of badges){
      ctx.beginPath();
      ctx.arc(bd.x, bd.y, bd.r, 0, Math.PI * 2);
      ctx.fillStyle = bd.folded ? pnow.select : (state.theme === 'light' ? '#FBF9F2' : '#2C2924');
      ctx.fill();
      ctx.strokeStyle = pnow.stroke.ink;
      ctx.stroke();
      ctx.fillStyle = bd.folded ? '#FBF6EE' : pnow.stroke.ink;
      const label = bd.folded ? (bd.count > 0 ? '+' + bd.count : '+') : '−';
      ctx.font = `700 ${Math.max(8, bd.r * (label.length > 2 ? 0.75 : 1.0))}px ${FONTS.sans.stack}`;
      ctx.fillText(label, bd.x, bd.y + 0.5 / z);
    }
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

/* ── shared image store ─────────────────────────────
   Image pixels are stored ONCE per unique image in state.images and
   referenced by el.imgId; the element carries the pixels only at
   runtime as el._src, which every serializer already strips. History
   snapshots, the clipboard and autosave therefore stay small no matter
   how many photos the document holds or how deep undo goes. */
function imageHash(src){
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) >>> 0;
  return 'im' + h.toString(36) + src.length.toString(36);
}
function internImage(el){
  const src = el._src || el.src;
  delete el.src;                       // legacy field never survives in memory
  if (!src){
    if (el.imgId && state.images[el.imgId]) el._src = state.images[el.imgId];
    return;
  }
  if (!el.imgId || state.images[el.imgId] !== src){
    el.imgId = imageHash(src);
    state.images[el.imgId] = src;      // identical images share one entry
  }
  el._src = src;
}
function adoptImages(els){
  for (const el of els) if (el.type === 'image') internImage(el);
}
function usedImages(){
  const used = {};
  for (const p of state.pages)
    for (const el of p.elements)
      if (el.type === 'image' && el.imgId && state.images[el.imgId] !== undefined)
        used[el.imgId] = state.images[el.imgId];
  return used;
}
function commit(){
  lastCoalesce.key = null; // an unrelated commit breaks any coalescing run
  history = history.slice(0, histIndex + 1);
  history.push(serialize());
  if (history.length > 120) history.shift();
  histIndex = history.length - 1;
  syncHistoryButtons();
  scheduleAutosave();
  scheduleThumbRefresh();
  preloadDocFonts(); // any newly-referenced Google font starts downloading
}

/* ── coalesced commits ──────────────────────────────
   Rapid repeats of the same micro-operation (arrow-key nudges, wiggling
   the same slider) fold into ONE undo step: within the time window the
   top history entry is replaced instead of pushing a new one, so ⌘Z
   jumps back to before the whole run. */
const lastCoalesce = { key: null, at: 0 };
function commitCoalesced(key, windowMs = 900){
  const now = performance.now();
  const canFold = lastCoalesce.key === key && (now - lastCoalesce.at) < windowMs &&
    histIndex === history.length - 1 && histIndex > 0;
  if (canFold){
    history[histIndex] = serialize();
    syncHistoryButtons(); scheduleAutosave(); scheduleThumbRefresh();
  } else {
    commit();
  }
  lastCoalesce.key = key; lastCoalesce.at = now;
}
function restore(json){
  const doc = JSON.parse(json);
  state.pages = doc.pages;
  state.pageIndex = clamp(doc.pageIndex, 0, doc.pages.length - 1);
  state.elements = state.pages[state.pageIndex].elements;
  for (const p of state.pages) adoptImages(p.elements);
  const ids = new Set(state.elements.map(e => e.id));
  state.selection = new Set([...state.selection].filter(id => ids.has(id)));
  updateBoundArrows(state.elements);
  buildPageStrip();
  syncPanel(); requestRender(); scheduleAutosave();
}
function undo(){ if (histIndex > 0){ lastCoalesce.key = null; histIndex--; restore(history[histIndex]); syncHistoryButtons(); } }
function redo(){ if (histIndex < history.length - 1){ lastCoalesce.key = null; histIndex++; restore(history[histIndex]); syncHistoryButtons(); } }
function syncHistoryButtons(){
  $('undoBtn').disabled = histIndex <= 0;
  $('redoBtn').disabled = histIndex >= history.length - 1;
}

let autosaveTimer = null;
let autosaveFailing = false;
function setStorageWarn(on){
  if (on === autosaveFailing) return;
  autosaveFailing = on;
  $('storageWarn').classList.toggle('hidden', !on);
}
function scheduleAutosave(){
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      const doc = JSON.parse(serialize());
      localStorage.setItem(STORE_KEY, JSON.stringify({
        v: 6, appVersion: APP_VERSION,
        pages: doc.pages, pageIndex: doc.pageIndex, images: usedImages(),
        camera: state.camera, grid: state.grid, gridSize: state.gridSize, snap: state.snap,
        theme: state.theme, bgColor: state.bgColor, board: state.board,
      }));
      setStorageWarn(false);
    } catch (e) {
      // storage full/unavailable — the sketch still lives in memory, but
      // the user must KNOW a reload would lose it
      setStorageWarn(true);
    }
  }, 350);
}
function docSizeMB(){
  try { return serialize().length / 1048576; } catch (e){ return 0; }
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
    state.images = data.images || {};
    for (const p of state.pages) adoptImages(p.elements);
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
  const els = visibleEls(state.elements);
  for (let i = els.length - 1; i >= 0; i--){
    if (hitTest(els[i], sx, sy, state.camera.z)) return els[i];
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
  text = kbdLocal(text);
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

/* ── multi-touch: pinch zoom + two-finger pan ───────
   Fingers are tracked by pointerId. A second finger cancels whatever the
   first finger started (reverting any element mutation to the last commit)
   and turns the gesture into a pinch: zoom around the moving centroid,
   which also gives two-finger panning for free. */
const touchPts = new Map();
let hitScale = 1;   // fat-finger factor: handle hit areas grow on touch
function pinchState(){
  const [a, b] = [...touchPts.values()];
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
    d: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)) };
}

function onPointerDown(ev){
  if (replaying){ stopReplay(); return; }
  if (presenting){
    // tap turns the page, drag draws the laser
    try { canvas.setPointerCapture(ev.pointerId); } catch (e){}
    presTapStart = { x: ev.clientX, y: ev.clientY, t: performance.now(), laser: false };
    laserLive = { pts: [{ x: ev.clientX, y: ev.clientY, t: performance.now() }] };
    laserStrokes.push(laserLive);
    return;
  }
  setRouteContext(state.elements); // thumbnails may have re-pointed the router
  hitScale = ev.pointerType === 'touch' ? 1.8 : 1;
  if (ev.pointerType === 'touch'){
    touchPts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (touchPts.size === 2){
      if (editing) commitTextEdit();
      if (interaction && interaction.kind !== 'pinch'){
        const revert = !['pan','marquee','pinch'].includes(interaction.kind);
        interaction = null;
        canvas.classList.remove('panning');
        if (revert) restore(history[histIndex]);
      }
      const p = pinchState();
      interaction = { kind: 'pinch', d0: p.d, z0: state.camera.z,
        cx0: p.cx, cy0: p.cy, camX: state.camera.x, camY: state.camera.y };
      canvas.setPointerCapture(ev.pointerId);
      requestRender();
      return;
    }
    if (touchPts.size > 2){ canvas.setPointerCapture(ev.pointerId); return; }
  }
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
    const badge = mindBadgeAt(sx, sy);
    if (badge){ mindToggle(badge.id); return; }
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
          if (dist(sx, sy, single.x + ppx, single.y + ppy) < 10 * hitScale / z){
            interaction = { kind:'endpoint', el: single, idx };
            return;
          }
        }
        if (single.elbow){
          for (const h of elbowSegHandles(single)){
            if (dist(sx, sy, h.x, h.y) < 10 * hitScale / z){
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
          if (dist(sx, sy, mx, my) < 10 * hitScale / z){
            const a = single.points[0], b2 = single.points[single.points.length - 1];
            interaction = { kind:'curve', el: single,
              A: [single.x + a[0], single.y + a[1]],
              B: [single.x + b2[0], single.y + b2[1]] };
            return;
          }
        }
      } else {
        const [rx, ry] = rotHandlePos(sb);
        if (dist(sx, sy, rx, ry) < 10 * hitScale / z){
          interaction = { kind:'rotate', center: [sb.x + sb.w/2, sb.y + sb.h/2],
            orig: sel.map(e => ({ id: e.id, angle: e.angle || 0 })) };
          return;
        }
        const hs = handlePositions(sb);
        for (let i = 0; i < hs.length; i++){
          if (dist(sx, sy, hs[i][0], hs[i][1]) < 9 * hitScale / z){
            interaction = makeResize(sel, sb, HANDLE_KEYS[i], ev.shiftKey);
            return;
          }
        }
      }
    }
    const hit = topElementAt(sx, sy);
    if (hit){
      // ⇧-press on an element: if it is NOT selected yet, add it right
      // away (classic shift-click). If it IS selected, don't toggle yet —
      // the user may be starting a ⇧-drag (axis-locked move of the whole
      // selection). The toggle happens on pointerup only if nothing moved.
      let shiftPendingRemove = null;
      if (ev.shiftKey){
        const grp = expandGroups(new Set([hit.id]));
        if (!state.selection.has(hit.id)){
          const ids = new Set(state.selection);
          for (const id of grp) ids.add(id);
          setSelection(ids);
        } else {
          shiftPendingRemove = grp;
        }
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
        shiftPendingRemove,
      };
      return;
    }
    interaction = { kind:'marquee', x0: sx, y0: sy, x1: sx, y1: sy, keep: ev.shiftKey ? new Set(state.selection) : new Set() };
    if (!ev.shiftKey) setSelection(new Set());
    return;
  }

  if (state.tool === 'text'){
    // the browser's default pointerdown action would move focus to the
    // canvas right after this handler, blurring the fresh editor — the
    // blur commits the empty text and deletes it. Prevent that.
    if (ev.preventDefault) ev.preventDefault();
    const el = newElement('text', sx, sy, {
      stroke: defaults.stroke === 'paper' ? 'ink' : defaults.stroke,
      font: defaults.font, size: defaults.size, align: 'left', opacity: defaults.opacity,
      lh: defaults.lh, pgap: defaults.pgap, lspace: defaults.lspace,
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
    lh: defaults.lh, pgap: defaults.pgap, lspace: defaults.lspace, valign: defaults.valign,
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
      .catch(() => showHint('Could not load that icon: internet is needed once per icon'));
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
  if (presenting){
    if (laserLive){
      laserLive.pts.push({ x: ev.clientX, y: ev.clientY, t: performance.now() });
      if (presTapStart && !presTapStart.laser &&
          Math.hypot(ev.clientX - presTapStart.x, ev.clientY - presTapStart.y) > 6)
        presTapStart.laser = true;
    }
    return;
  }
  if (ev.pointerType === 'touch' && touchPts.has(ev.pointerId)){
    touchPts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (interaction && interaction.kind === 'pinch'){
      if (touchPts.size < 2) return;
      const p = pinchState();
      const z = clamp(interaction.z0 * (p.d / interaction.d0), 0.1, 6);
      // the scene point under the starting centroid stays glued to the
      // live centroid — zooming and two-finger panning in one formula
      const ax = (interaction.cx0 - interaction.camX) / interaction.z0;
      const ay = (interaction.cy0 - interaction.camY) / interaction.z0;
      state.camera.z = z;
      state.camera.x = p.cx - ax * z;
      state.camera.y = p.cy - ay * z;
      if (editing) positionEditor();
      syncZoomLabel(); requestRender(); scheduleAutosave();
      return;
    }
  }
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
    for (const el of visibleEls(state.elements)){
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
    // ⇧ locks the drag to the dominant axis — and the lock must be
    // re-asserted AFTER snapping, because grid/guide snapping would
    // otherwise nudge the frozen axis onto the nearest line
    const axisLock = ev.shiftKey ? (Math.abs(dx) > Math.abs(dy) ? 'y' : 'x') : null;
    if (axisLock === 'y') dy = 0;
    if (axisLock === 'x') dx = 0;
    [dx, dy] = snapMovingBounds(it.bbox, dx, dy, it.ids);
    if (axisLock === 'y') dy = 0;
    if (axisLock === 'x') dx = 0;
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
  if (presenting){
    if (laserLive){
      const wasTap = presTapStart && !presTapStart.laser &&
        performance.now() - presTapStart.t < 400;
      if (wasTap) laserStrokes.pop();   // a click is a page turn, not a dot
      laserLive = null;
      if (wasTap){
        const [tx, ty] = toScene(ev.clientX, ev.clientY);
        const badge = mindBadgeAt(tx, ty);
        if (badge) mindToggle(badge.id);   // unfold live while presenting
        else presentGo(1);
      }
    }
    presTapStart = null;
    return;
  }
  if (ev.pointerType === 'touch'){
    touchPts.delete(ev.pointerId);
    if (interaction && interaction.kind === 'pinch'){
      // pinch survives until fewer than two fingers remain
      if (touchPts.size < 2){ interaction = null; requestRender(); }
      return;
    }
  }
  const it = interaction;
  interaction = null;
  guides = [];
  canvas.classList.remove('panning');
  if (!it){ requestRender(); return; }

  if (it.kind === 'pan'){ requestRender(); return; }
  if (it.kind === 'marquee'){ syncPanel(); requestRender(); return; }

  if (it.kind === 'move'){
    if (it.moved){ updateBoundArrows(state.elements); commit(); }
    else if (it.shiftPendingRemove){
      // it was a plain ⇧-click after all — toggle the element out
      const ids = new Set(state.selection);
      for (const id of it.shiftPendingRemove) ids.delete(id);
      setSelection(ids);
    }
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
  if (presenting) return;
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
  if (presenting) return;
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
  // the canvas draws the (rich) text live underneath; the editor only
  // contributes the caret and the selection band
  editorEl.style.color = 'transparent';
  const pnow = pal();
  editorEl.style.caretColor = textColorOf(pnow, el);
  editorEl.classList.remove('hidden');
  positionEditor();
  editorEl.focus();
  editorEl.select();
  // defend the focus: if a default action (or anything else) steals it in
  // this same tick, take it back on the next frame
  requestAnimationFrame(() => {
    if (editing && document.activeElement !== editorEl){
      editorEl.focus({ preventScroll: true });
      editorEl.select();
    }
  });
  requestRender();
}
function positionEditor(){
  if (!editing) return;
  const el = editing.el;
  const z = state.camera.z;
  const fs = el.size * z;
  editorEl.style.font = fontCSS(el.font, fs);
  editorEl.style.lineHeight = lineHeightOf(el.size, el.lh) * z + 'px';
  editorEl.style.letterSpacing = ((el.lspace || 0) * z) + 'px';
  if (el.type === 'text'){
    const [px, py] = toScreen(el.x, el.y);
    const m = measureText(editorEl.value || ' ', el.font, el.size);
    editorEl.style.whiteSpace = 'pre';
    editorEl.style.textAlign = 'left';
    editorEl.style.left = px + 'px';
    editorEl.style.top = py + 'px';
    editorEl.style.width = Math.max(40, (m.w + 20) * z) + 'px';
    editorEl.style.height = Math.max(lineHeightOf(el.size, el.lh), m.h) * z + 6 + 'px';
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
    editorEl.style.height = Math.max(lineHeightOf(el.size, el.lh), m.h) * z + 6 + 'px';
  } else {
    const pad = el.type === 'chip' ? 10 : 12;
    const maxW = Math.max(20, el.w - pad*2);
    const lines = wrapText(editorEl.value || ' ', maxW, el.font, el.size);
    const th = lines.length * lineHeightOf(el.size, el.lh);
    const [px, py] = toScreen(el.x + pad, el.y + el.h/2 - th/2);
    editorEl.style.whiteSpace = 'pre-wrap';
    editorEl.style.textAlign = el.align;
    editorEl.style.left = px + 'px';
    editorEl.style.top = py + 'px';
    editorEl.style.width = maxW * z + 'px';
    editorEl.style.height = (th + lineHeightOf(el.size, el.lh)) * z + 'px';
  }
  const p = pal();
  // the canvas paints the text; the editor stays a transparent input layer
  editorEl.style.color = 'transparent';
  editorEl.style.caretColor = textColorOf(p, el);
}
editorEl.addEventListener('input', () => {
  if (!editing) return;
  const el = editing.el;
  // keep bold/italic/highlight runs anchored across the edit
  const oldT = String(el.text || ''), newT = editorEl.value;
  if (el.runs && oldT !== newT){
    let p = 0;
    while (p < oldT.length && p < newT.length && oldT[p] === newT[p]) p++;
    let so = oldT.length, sn = newT.length;
    while (so > p && sn > p && oldT[so - 1] === newT[sn - 1]){ so--; sn--; }
    el.runs = remapRuns(el.runs, p, so - p, sn - p);
  }
  el.text = editorEl.value;
  if (el.type === 'text') autosizeText(el);
  else if (!isLinear(el)){
    // grow the container if the text no longer fits
    const pad = el.type === 'chip' ? 10 : 12;
    const lines = wrapText(el.text || ' ', Math.max(20, el.w - pad*2), el.font, el.size);
    const needH = lines.length * lineHeightOf(el.size, el.lh) + pad * 2;
    if (needH > el.h) el.h = needH;
  }
  positionEditor();
  requestRender();
});
editorEl.addEventListener('keydown', ev => {
  ev.stopPropagation();
  const mod = ev.metaKey || ev.ctrlKey;
  const k = ev.key.toLowerCase();
  if (mod && k === 'b'){ ev.preventDefault(); applyTextFormat('b'); return; }
  if (mod && !ev.shiftKey && k === 'i'){ ev.preventDefault(); applyTextFormat('i'); return; }
  if (mod && ev.shiftKey && k === 'h'){ ev.preventDefault(); applyTextFormat('hl', defaults.hlColor); return; }
  if (ev.key === 'Escape'){ ev.preventDefault(); commitTextEdit(); }
  if (ev.key === 'Enter' && mod){ ev.preventDefault(); commitTextEdit(); }
  if (ev.key === 'Tab' && editing && editing.el.type !== 'text'){
    // type, Tab, type, Tab — the flow keeps flowing
    ev.preventDefault();
    const src = editing.el;
    commitTextEdit();
    setSelection(new Set([src.id]));
    tabCreate(ev.shiftKey);
  }
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
  adoptImages(clones);
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
const STYLE_PROPS = ['stroke','sw','dash','sketch','fill','fillStyle','round','opacity','font','size','align','lh','pgap','lspace','valign','textColor','frame'];
let styleClipboard = null;
function copyStyle(){
  const sel = selected();
  if (!sel.length) return;
  const src = sel[0];
  styleClipboard = {};
  for (const k of STYLE_PROPS)
    if (src[k] !== undefined) styleClipboard[k] = src[k];
  showHint('Style copied: select elements and press ⌥⌘V to paste it');
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
$('tidyBtn').addEventListener('click', tidyLayout);
$('frameOn').addEventListener('click', () => applyStyle({ frame: true }));
$('frameOff').addEventListener('click', () => applyStyle({ frame: false }));

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
    if (sel[0].chart)
      add('Edit chart data…', () => chartOpen(sel[0]));
    if (sel.length === 1 && sel[0].type === 'image'){
      add('Crop image', () => startCrop(sel[0]));
      if (sel[0].crop) add('Uncrop', () => resetCrop(sel[0]));
    }
    if (sel.length === 1 && sel[0].elbow && sel[0].elbowPts && sel[0].elbowPts.length)
      add('Re-route elbow (auto)', () => {
        sel[0].elbowPts = null;
        commit(); requestRender();
      });
    if (sel.length === 1 && !isLinear(sel[0]) && sel[0].type !== 'text'){
      const one = sel[0];
      const pageRoot = state.elements.find(e => e.mindRoot);
      if (one.mindRoot){
        add('Mind map: unmark root (show everything)', mindClearPage);
      } else if (!pageRoot){
        add('Mark as mind-map root', () => {
          one.mindRoot = true;
          commit(); requestRender();
          showHint('Mind map on: click the − / + badges to fold and unfold branches');
        });
      }
      if (pageRoot){
        const info = mindInfoFor(state.elements);
        if (info && (info.out.get(one.id) || []).length)
          add(one.folded ? 'Unfold this branch' : 'Fold this branch', () => mindToggle(one.id));
      }
    }
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
    add('Tidy the flow', tidyLayout);
  }
  closeMenus();
  menu.classList.remove('hidden');
  const mw = 200, mh = menu.scrollHeight || 300;
  menu.style.left = clamp(ev.clientX, 8, window.innerWidth - mw - 8) + 'px';
  menu.style.top = clamp(ev.clientY, 8, window.innerHeight - mh - 8) + 'px';
}
canvas.addEventListener('contextmenu', ev => {
  if (presenting){ ev.preventDefault(); return; }
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
  const tEl = $('textSwatches');
  const auto = document.createElement('button');
  auto.className = 'swatch tauto';
  auto.dataset.textcolor = 'auto';
  auto.textContent = 'A';
  auto.title = 'Auto: follows the stroke, flips to light on dark fills';
  tEl.appendChild(auto);
  for (const key of STROKE_KEYS){
    if (key === 'none') continue;
    const b = document.createElement('button');
    b.className = 'swatch';
    b.dataset.textcolor = key;
    b.title = 'Text in ' + (COLOR_TITLES[key] || key);
    tEl.appendChild(b);
  }
  addCustomSwatch(tEl, 'textColor');
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
let colorPopRange = null; // {id, a, b} when coloring letters via the wheel
function openColorPop(prop, anchor){
  colorPopProp = prop;
  colorPopRange = (prop === 'textColor' && editingSelection())
    ? { id: editing.el.id, a: editorEl.selectionStart, b: editorEl.selectionEnd }
    : null;
  const pop = $('colorPop');
  pop.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.min(r.right + 10, window.innerWidth - 200) + 'px';
  pop.style.top = clamp(r.top - 10, 8, window.innerHeight - 60) + 'px';
  const sel = selected();
  let cur = prop === 'hlColor' ? defaults.hlColor
    : sel.length ? sel[0][prop]
    : (prop === 'fill' ? (defaults.fillByType[state.tool] || defaults.fill) : defaults[prop]);
  if (typeof cur !== 'string' || cur[0] !== '#'){
    const p = pal();
    cur = (prop === 'fill' ? resolveFill(p, cur) : resolveStroke(p, cur)) || '#D97757';
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(cur)) cur = '#D97757';
  $('popColor').value = cur.toLowerCase();
  $('popHex').value = cur.toUpperCase();
}
function closeColorPop(){
  $('colorPop').classList.add('hidden');
  colorPopProp = null;
  colorPopRange = null;
}
function normalizedHex(){
  let v = $('popHex').value.trim();
  if (v && v[0] !== '#') v = '#' + v;
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null;
}
$('popColor').addEventListener('input', () => {
  const v = $('popColor').value;
  $('popHex').value = v.toUpperCase();
  if (colorPopProp === 'hlColor') forceHighlight(v);
  else if (colorPopRange) forceLetterColor(v);
  else if (colorPopProp) applyStyleLive({ [colorPopProp]: v });
});
$('popColor').addEventListener('change', () => {
  if (colorPopProp === 'hlColor'){ forceHighlight($('popColor').value); commit(); syncPanel(); }
  else if (colorPopRange){ forceLetterColor($('popColor').value); commit(); syncPanel(); }
  else if (colorPopProp) applyStyle({ [colorPopProp]: $('popColor').value });
});
$('popHex').addEventListener('input', () => {
  const v = normalizedHex();
  if (v){
    $('popColor').value = v;
    if (colorPopProp === 'hlColor') forceHighlight(v);
    else if (colorPopRange) forceLetterColor(v);
    else if (colorPopProp) applyStyleLive({ [colorPopProp]: v });
  }
});
$('popHex').addEventListener('keydown', ev => {
  ev.stopPropagation();
  if (ev.key === 'Enter'){
    ev.preventDefault();
    const v = normalizedHex();
    if (v && colorPopProp === 'hlColor'){ forceHighlight(v); commit(); syncPanel(); }
    else if (v && colorPopRange){ forceLetterColor(v); commit(); syncPanel(); }
    else if (v && colorPopProp) applyStyle({ [colorPopProp]: v });
    closeColorPop();
  }
  if (ev.key === 'Escape') closeColorPop();
});
$('popHex').addEventListener('blur', () => {
  const v = normalizedHex();
  if (v && colorPopProp === 'hlColor'){ forceHighlight(v); commit(); syncPanel(); }
  else if (v && colorPopRange){ forceLetterColor(v); commit(); syncPanel(); }
  else if (v && colorPopProp) applyStyle({ [colorPopProp]: v });
});
document.addEventListener('pointerdown', ev => {
  if (!ev.target.closest('#colorPop') && !ev.target.closest('.swatch.custom') && !ev.target.closest('#hlCustom')) closeColorPop();
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
  document.querySelectorAll('#textSwatches .swatch').forEach(b => {
    if (b.dataset.textcolor && b.dataset.textcolor !== 'auto')
      b.style.background = p.stroke[b.dataset.textcolor];
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

  const onlyText = sel.length > 0 && sel.every(e => e.type === 'text');
  const onlyLinear = sel.length > 0 && sel.every(e => isLinear(e));
  show('rowStroke', !onlyText);   // for text, "Text color" is the one truth
  $('strokeLabel').textContent = onlyLinear ? 'Line color' : 'Outline';
  show('rowArt', has('image'));
  const imgDuo = sel.some(e => e.type === 'image' && e.artStyle === 'duotone');
  show('rowFill', ((shapeish || has('draw')) && !has('image')) || imgDuo);
  show('rowFillStyle', has('rect','diamond','ellipse','chip','icon'));
  show('rowWidth', shapeish || linear || has('image'));
  show('rowSketch', shapeish || linear || has('image'));
  show('rowFrame', has('image'));
  show('rowRound', has('rect'));
  show('rowCurve', has('arrow','line'));
  show('rowHeads', has('arrow','line'));
  show('rowFont', textish);
  show('rowTextColor', textish);
  show('rowSize', textish);
  show('rowAlign', textish);
  show('rowRich', textish);
  show('rowTypo', textish);
  show('rowValign', has('rect','diamond','ellipse','chip'));
  show('rowOpacity', true);
  $('opacityVal').textContent = ((sel.length ? sel[0].opacity : defaults.opacity) ?? 100) + '%';
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
  const frameVal = !!val('frame');
  $('frameOn').classList.toggle('sel', frameVal);
  $('frameOff').classList.toggle('sel', sel.some(e => e.type === 'image') && !frameVal);
  const tcVal = val('textColor') || 'auto';
  markSel('#textSwatches .swatch', b => b.dataset.textcolor === tcVal);
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
  const fSel = (typeof fontVal === 'string' && FONTS[fontVal]) ? fontVal : null;
  $('fontBtnLabel').textContent = fSel ? FONTS[fSel].label : '—';
  $('fontBtnLabel').style.fontFamily = fSel ? FONTS[fSel].stack : '';
  markSel('#sizeSeg button', b => Number(b.dataset.v) === val('size'));
  markSel('#alignSeg button', b => b.dataset.v === val('align'));
  markSel('#valignSeg button', b => b.dataset.v === (val('valign') || 'middle'));
  const fmtEls = sel.filter(e => canHaveText(e) && e.text && e.text.trim());
  $('tsBold').classList.toggle('sel', fmtEls.length > 0 && fmtEls.every(e => rangeHasStyle(e, 0, e.text.length, 'b')));
  $('tsItal').classList.toggle('sel', fmtEls.length > 0 && fmtEls.every(e => rangeHasStyle(e, 0, e.text.length, 'i')));
  $('tyLh').value = val('lh') ?? 1.3;
  $('tyLhVal').textContent = '×' + $('tyLh').value;
  $('tyPgap').value = val('pgap') ?? 0;
  $('tyPgapVal').textContent = $('tyPgap').value + 'px';
  $('tyLs').value = val('lspace') ?? 0;
  $('tyLsVal').textContent = $('tyLs').value + 'px';
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
  if (t.dataset.textcolor){
    const tcv = t.dataset.textcolor === 'auto' ? null : t.dataset.textcolor;
    if (editingSelection()) applyTextFormat('co', tcv);
    else applyStyle({ textColor: tcv });
  }
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
  else if (t.closest('#valignSeg') && t.dataset.v) applyStyle({ valign: t.dataset.v });
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
  $('opacityVal').textContent = v + '%';
  requestRender();
});
$('opacityRange').addEventListener('change', () => { if (state.selection.size) commitCoalesced('opacity', 1500); });
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
  $(id).addEventListener('change', () => { if (state.selection.size) commitCoalesced('adj:' + id, 1500); });
}

/* typography sliders — line spacing, paragraph gap, letter spacing */
const TYPO_SLIDERS = [
  ['tyLh', 'lh', v => Number(v), v => '×' + v],
  ['tyPgap', 'pgap', v => Number(v), v => v + 'px'],
  ['tyLs', 'lspace', v => Number(v), v => v + 'px'],
];
for (const [id, prop, parse, fmt] of TYPO_SLIDERS){
  $(id).addEventListener('input', ev => {
    const v = parse(ev.target.value);
    $(id + 'Val').textContent = fmt(ev.target.value);
    applyStyleLive({ [prop]: v });
    for (const el of selected()) if (el.type === 'text') autosizeText(el);
    requestRender();
  });
  $(id).addEventListener('change', ev => {
    applyStyle({ [prop]: parse(ev.target.value) });
    for (const el of selected()) if (el.type === 'text') autosizeText(el);
    requestRender();
  });
}
/* ── rich text formatting: bold / italic / highlight ──
   While editing: applies to the selected characters (whole text if the
   caret is collapsed). Otherwise: applies to every selected element. */
function formatTargets(){
  if (editing && editing.el && (editing.el.text || editorEl.value)) return [editing.el];
  return selected().filter(e => canHaveText(e) && e.text && e.text.trim());
}
function formatRange(el){
  if (editing && editing.el === el){
    const a = editorEl.selectionStart, b = editorEl.selectionEnd;
    if (a !== b) return [a, b];
  }
  return [0, String(el.text || '').length];
}
function applyTextFormat(kind, color){
  const targets = formatTargets();
  if (!targets.length) return;
  for (const el of targets){
    const [a, b] = formatRange(el);
    if (kind === 'b' || kind === 'i'){
      const on = !rangeHasStyle(el, a, b, kind);
      setRangeStyle(el, a, b, { [kind]: on });
    } else if (kind === 'hl'){
      const same = rangeHasStyle(el, a, b, 'hl', color);
      setRangeStyle(el, a, b, { hl: same ? null : color });
      if (!same) defaults.hlColor = color;
    } else if (kind === 'hloff'){
      setRangeStyle(el, a, b, { hl: null });
    } else if (kind === 'co'){
      setRangeStyle(el, a, b, { co: color || null });
    }
    if (el.type === 'text') autosizeText(el);
  }
  commit(); syncPanel(); requestRender();
  if (editing) editorEl.focus();
}
/* keep the editor's text selection alive when clicking format controls:
   canceling pointerdown stops the browser from moving focus (same trick
   that fixed text placement in v3.5.1) */
document.querySelectorAll('#rowRich button').forEach(b =>
  b.addEventListener('pointerdown', ev => ev.preventDefault()));
/* letter coloring: while editing with characters selected, the text color
   dots color just that range (runs), not the whole element */
function editingSelection(){
  return !!(editing && editing.el && editorEl.selectionStart !== editorEl.selectionEnd);
}
$('textSwatches').addEventListener('pointerdown', ev => { if (editing) ev.preventDefault(); });
function forceLetterColor(color){
  if (!colorPopRange) return;
  const el = byId(colorPopRange.id);
  if (!el) return;
  setRangeStyle(el, colorPopRange.a, colorPopRange.b, { co: color || null });
  requestRender();
}
function forceHighlight(color){
  for (const el of formatTargets()){
    const [a, b] = formatRange(el);
    setRangeStyle(el, a, b, { hl: color });
    if (el.type === 'text') autosizeText(el);
  }
  defaults.hlColor = color;
  requestRender();
}
$('tsBold').addEventListener('click', () => applyTextFormat('b'));
$('tsItal').addEventListener('click', () => applyTextFormat('i'));
document.querySelectorAll('.hldot[data-hl]').forEach(b =>
  b.addEventListener('click', () => applyTextFormat('hl', b.dataset.hl)));
$('hlOff').addEventListener('click', () => applyTextFormat('hloff'));
$('hlCustom').addEventListener('click', ev => {
  ev.stopPropagation();
  openColorPop('hlColor', $('hlCustom'));
});

$('tyReset').addEventListener('click', () => {
  // resets to YOUR defaults — adjustable in Settings, not hardcoded values
  applyStyle({ lh: typo.lh, pgap: typo.pgap, lspace: typo.lspace, valign: 'middle' });
  for (const el of selected()) if (el.type === 'text') autosizeText(el);
  requestRender();
  showHint(`Spacing reset to your defaults (×${typo.lh} · ${typo.pgap}px · ${typo.lspace}px)`);
});
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
  const menu = $('fontMenu');
  for (const g of FONT_GROUPS){
    const head = document.createElement('div');
    head.className = 'menuhead';
    head.textContent = g;
    menu.appendChild(head);
    for (const [key, f] of Object.entries(FONTS)){
      if ((f.group || 'Built-in') !== g) continue;
      const b = document.createElement('button');
      b.dataset.font = key;
      b.textContent = f.label;
      b.style.fontFamily = f.stack;   // each font previews itself
      b.addEventListener('click', ev => {
        ev.stopPropagation();
        requestFontLoad(key); // fetch the file now — 'loadingdone' repaints
        applyStyle({ font: key });
        closeFontMenu();
      });
      menu.appendChild(b);
    }
  }
  $('fontBtn').addEventListener('click', ev => {
    ev.stopPropagation();
    if (menu.classList.contains('hidden')) openFontMenu(); else closeFontMenu();
  });
  document.addEventListener('pointerdown', ev => {
    const t = ev.target;
    if (!t || !t.closest || (!t.closest('#fontMenu') && !t.closest('#fontBtn'))) closeFontMenu();
  });
}
function openFontMenu(){
  const m = $('fontMenu');
  const r = $('fontBtn').getBoundingClientRect();
  m.classList.remove('hidden');
  m.style.left = Math.min(r.left, window.innerWidth - 244) + 'px';
  const below = window.innerHeight - r.bottom - 20;
  if (below > 220){ m.style.top = (r.bottom + 6) + 'px'; m.style.bottom = 'auto'; m.style.maxHeight = below + 'px'; }
  else { m.style.top = '8px'; m.style.bottom = 'auto'; m.style.maxHeight = (r.top - 16) + 'px'; }
  for (const k of Object.keys(FONTS)) requestFontLoad(k);  // names render in themselves
  const sel = selected();
  const cur = sel.length ? sel[0].font : defaults.font;
  m.querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.dataset.font === cur));
  const curBtn = m.querySelector('button.sel');
  if (curBtn) curBtn.scrollIntoView({ block: 'center' });
}
function closeFontMenu(){ $('fontMenu').classList.add('hidden'); }
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
/* ── user asset gallery: reusable SVG / PNG logos & marks ──
   Assets live in the browser (koralpaper.assets.v1). SVGs keep their
   original markup (pure vector at any size, vector in SVG exports);
   raster images are downscaled to ≤512px with transparency preserved.
   Stamped assets are ordinary image elements — documents stay portable. */
const ASSET_KEY = 'koralpaper.assets.v1';
function assetList(){
  try { return JSON.parse(localStorage.getItem(ASSET_KEY)) || []; } catch (e){ return []; }
}
function assetSave(list){
  try { localStorage.setItem(ASSET_KEY, JSON.stringify(list)); return true; }
  catch (e){ alert('Gallery storage is full — remove an asset (right-click) and try again.'); return false; }
}
function assetAddFiles(files){
  for (const f of files){
    const isSvg = f.type === 'image/svg+xml' || /\.svg$/i.test(f.name);
    const reader = new FileReader();
    reader.onload = () => {
      const finish = (src) => {
        const img = new Image();
        img.onload = () => {
          let w = img.naturalWidth || 300, h = img.naturalHeight || 300;
          if (src.length > 700000){
            alert(`“${f.name}” is too large for the gallery (max ~700 KB after processing).`);
            return;
          }
          const list = assetList();
          list.push({ id: uid(), name: f.name.replace(/\.[^.]+$/, ''), svg: isSvg, src, w, h });
          if (assetSave(list)){
            buildAssetGrid();
            showHint(`“${f.name}” added to your gallery`);
          }
        };
        img.onerror = () => alert(`Could not read “${f.name}”.`);
        img.src = src;
      };
      if (isSvg){
        // keep the vector source verbatim as a data URL
        finish('data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(reader.result))));
      } else {
        // raster: downscale for storage, preserve transparency
        const img0 = new Image();
        img0.onload = () => {
          const maxDim = 512;
          const s = Math.min(1, maxDim / Math.max(img0.naturalWidth, img0.naturalHeight));
          if (s >= 1){ finish(reader.result2); return; }
          const c = document.createElement('canvas');
          c.width = Math.round(img0.naturalWidth * s);
          c.height = Math.round(img0.naturalHeight * s);
          c.getContext('2d').drawImage(img0, 0, 0, c.width, c.height);
          finish(c.toDataURL('image/png'));
        };
        img0.src = reader.result2 = reader.result;
      }
    };
    if (isSvg) reader.readAsText(f);
    else reader.readAsDataURL(f);
  }
}
function insertAsset(a){
  // place at the viewport center at a friendly size, keeping the aspect
  const [cx, cy] = toScene(canvas.clientWidth / 2, canvas.clientHeight / 2);
  const target = 240 / state.camera.z;
  const s = target / Math.max(a.w, a.h);
  const el = newElement('image', 0, 0, {});
  el._src = a.src;
  internImage(el);
  el.w = Math.max(20, a.w * s);
  el.h = Math.max(20, a.h * s);
  el.x = cx - el.w / 2; el.y = cy - el.h / 2;
  state.elements.push(el);
  setSelection(new Set([el.id]));
  setTool('select');
  commit(); requestRender();
  $('assetMenu').classList.add('hidden');
}
function buildAssetGrid(){
  const grid = $('assetGrid');
  grid.replaceChildren();
  const list = assetList();
  $('assetHint').textContent = list.length
    ? 'Click to place · right-click to remove. SVG stays pure vector, PNG keeps transparency.'
    : 'Your reusable logos & marks live here — add an SVG or transparent PNG to get started.';
  for (const a of list){
    const b = document.createElement('button');
    b.title = a.name + ' — right-click to remove';
    const im = document.createElement('img');
    im.src = a.src;
    b.appendChild(im);
    b.addEventListener('click', ev => { ev.stopPropagation(); insertAsset(a); });
    b.addEventListener('contextmenu', ev => {
      ev.preventDefault(); ev.stopPropagation();
      if (!confirm(`Remove “${a.name}” from your gallery?`)) return;
      assetSave(assetList().filter(x => x.id !== a.id));
      buildAssetGrid();
    });
    grid.appendChild(b);
  }
}
$('assetToolBtn').addEventListener('click', ev => {
  ev.stopPropagation();
  const menu = $('assetMenu');
  const wasHidden = menu.classList.contains('hidden');
  closeMenus(); closeColorPop(); closePaperPop();
  if (wasHidden){ buildAssetGrid(); menu.classList.remove('hidden'); }
});
$('assetMenu').addEventListener('click', ev => ev.stopPropagation());
$('assetAddBtn').addEventListener('click', ev => { ev.stopPropagation(); $('assetInput').click(); });
$('assetInput').addEventListener('change', () => {
  assetAddFiles([...$('assetInput').files]);
  $('assetInput').value = '';
});

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
  showHint(next.includes(name) ? `“${name.replace(/_/g,' ')}” pinned: it now leads the icon grid`
                               : `“${name.replace(/_/g,' ')}” unpinned`);
  miRefresh(false);
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
    // browse mode: pins, then recents, then the popular nine, then the
    // WHOLE catalog — the pager arrows walk through all 3,000
    const pin = miPinned();
    const rec = miRecent().filter(n => !pin.includes(n));
    const lead = [...pin, ...rec,
      ...MATERIAL_POPULAR.filter(n => !pin.includes(n) && !rec.includes(n))];
    const seen = new Set(lead);
    const rest = [];
    for (const it of miCatalog) if (!seen.has(it.name)) rest.push(it.name);
    return [...lead, ...rest];
  }
  const out = [];
  const inOut = new Set();
  for (const it of miCatalog)
    if (it.name.startsWith(q)){ out.push(it.name); inOut.add(it.name); }
  for (const it of miCatalog)
    if (!inOut.has(it.name) && it.hay.includes(q)) out.push(it.name);
  return out;
}

/* pager state: 9 icons per page over the full list */
let miPage = 0;
let miList = [];
function miRefresh(resetPage){
  if (resetPage) miPage = 0;
  miList = miSearchList($('miSearch') ? $('miSearch').value : '');
  const pages = Math.max(1, Math.ceil(miList.length / 9));
  miPage = clamp(miPage, 0, pages - 1);
  miRenderGrid(miList.slice(miPage * 9, miPage * 9 + 9));
  const pager = $('miPager');
  if (pager){
    pager.classList.toggle('hidden', pages <= 1);
    $('miPageLabel').textContent = (miPage + 1) + ' / ' + pages;
    $('miPrev').disabled = miPage === 0;
    $('miNext').disabled = miPage >= pages - 1;
  }
}
function pickMaterial(name){
  materialName = name;
  iconKind = 'material';
  miRemember(name);
  miFetch(name).catch(() => showHint('Could not load that icon: internet is needed once per icon'));
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
  search.addEventListener('input', () => miRefresh(true));
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
  const pager = document.createElement('div');
  pager.id = 'miPager';
  pager.className = 'mipager hidden';
  const prev = document.createElement('button');
  prev.id = 'miPrev'; prev.textContent = '‹'; prev.title = 'Previous icons';
  const lbl = document.createElement('span');
  lbl.id = 'miPageLabel';
  const next = document.createElement('button');
  next.id = 'miNext'; next.textContent = '›'; next.title = 'More icons';
  prev.addEventListener('click', ev => { ev.stopPropagation(); miPage--; miRefresh(false); });
  next.addEventListener('click', ev => { ev.stopPropagation(); miPage++; miRefresh(false); });
  pager.append(prev, lbl, next);
  menu.appendChild(pager);
  miRefresh(true);
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
  $('gridBtn').title = `Grid (now ${state.grid === 'off' ? 'off' : state.grid}), click for options — G`;
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
  showHint('Paper color set: ☰ menu → “Reset paper color” to go back');
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
  showHint('✂ Crop mode: drag across the image to keep that area: Esc cancels');
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
  const entry = getImageEntry(el._src);
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
        el._src = dataURL; el.w = w; el.h = h;
        internImage(el);
        state.elements.push(el);
        setTool('select');
        setSelection(new Set([el.id]));
        commit(); requestRender();
        showHint('Image added: pick an Art style in the panel to vectorize it ✳');
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
  showHint('New page: right-click a page tab for rename, duplicate, delete');
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
/* ── drag a page thumbnail to reorder ───────────────
   Press and drag a thumbnail: a coral insertion mark shows where the
   page will land; release to move it (one undo step). A plain click
   still switches pages, and the right-click menu keeps Move left/right
   for keyboard-averse fingers. */
let stripDragged = false;
function attachThumbDrag(b, i, strip){
  b.addEventListener('pointerdown', ev => {
    if (ev.button !== 0) return;
    const startX = ev.clientX, startY = ev.clientY;
    let dragging = false, slot = i;
    const thumbs = () => [...strip.querySelectorAll('.pagethumb')];
    const clearMarks = () => thumbs().forEach(t => t.classList.remove('dropbefore', 'dropafter', 'dragsrc'));
    const onMove = mv => {
      if (!dragging && Math.hypot(mv.clientX - startX, mv.clientY - startY) > 7){
        dragging = true;
        b.classList.add('dragsrc');
      }
      if (!dragging) return;
      const ts = thumbs();
      ts.forEach(t => t.classList.remove('dropbefore', 'dropafter'));
      slot = ts.length;
      for (let k = 0; k < ts.length; k++){
        const rc = ts[k].getBoundingClientRect();
        if (mv.clientX < rc.left + rc.width / 2){ slot = k; break; }
      }
      if (slot < ts.length) ts[slot].classList.add('dropbefore');
      else ts[ts.length - 1].classList.add('dropafter');
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      clearMarks();
      if (dragging){
        stripDragged = true;
        setTimeout(() => { stripDragged = false; }, 0);
        movePageTo(i, slot);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}
function movePageTo(from, slot){
  if (slot === from || slot === from + 1) return;   // dropped where it already sits
  syncPageRef();
  const cur = state.pages[state.pageIndex];
  const [pg] = state.pages.splice(from, 1);
  const at = slot > from ? slot - 1 : slot;
  state.pages.splice(at, 0, pg);
  state.pageIndex = state.pages.indexOf(cur);
  state.elements = state.pages[state.pageIndex].elements;
  commit(); buildPageStrip();
  showHint(`Moved "${pg.name || 'page'}" to position ${at + 1}`);
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
    b.addEventListener('click', () => { if (!stripDragged) switchPage(i); });
    b.addEventListener('contextmenu', ev => {
      ev.preventDefault(); ev.stopPropagation();
      openPageMenu(ev, i);
    });
    attachThumbDrag(b, i, strip);
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
    showHint(`${name}: exports will be exactly ${w} × ${h}px, grid included`);
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
  if (b.dataset.act !== 'expT') closeMenus();
  runFileAction(b.dataset.act);
});
$('helpBtn').addEventListener('click', () => $('shortcutsCard').classList.toggle('hidden'));

/* ── Help / Settings side panel ─────────────────────── */
function setPanelTab(t){
  $('tabHelp').classList.toggle('sel', t === 'help');
  $('tabClaude').classList.toggle('sel', t === 'claude');
  $('tabSettings').classList.toggle('sel', t === 'settings');
  $('helpPane').classList.toggle('hidden', t !== 'help');
  $('claudePane').classList.toggle('hidden', t !== 'claude');
  $('settingsPane').classList.toggle('hidden', t !== 'settings');
}
$('tabHelp').addEventListener('click', () => setPanelTab('help'));
$('tabClaude').addEventListener('click', () => setPanelTab('claude'));
$('tabSettings').addEventListener('click', () => {
  setPanelTab('settings');
  const mb = docSizeMB();
  $('setDocSize').textContent =
    `This document: ${mb < 0.1 ? (mb * 1024).toFixed(0) + ' KB' : mb.toFixed(1) + ' MB'} · ` +
    `browser autosave holds roughly 5 MB${autosaveFailing ? ' — AUTOSAVE IS CURRENTLY FAILING, save as .json' : ''}`;
});
$('claudeLinkBtn').addEventListener('click', () => {
  $('shortcutsCard').classList.remove('hidden');
  setPanelTab('claude');
});

/* the fallback prompt: teaches any Claude the KoralPaper file format */
const DESIGN_PROMPT = `You are designing a diagram for KoralPaper, a hand-drawn-style sketch app. Answer ONLY with a JSON code block in exactly this format, nothing else:

{"app":"koralpaper","version":5,
 "pages":[{"name":"Page 1","elements":[ ...elements... ]}],
 "appState":{"board":{"name":"Slide","w":1920,"h":1080,"x":0,"y":0}}}

Element format (every field shown with a valid example):
- Box: {"id":"el1","type":"rect","x":100,"y":100,"w":190,"h":92,"angle":0,"seed":12345,"stroke":"ink","fill":"periwinkle","fillStyle":"solid","dash":"solid","sw":3.3,"sketch":1,"round":1,"opacity":100,"text":"Step 1","font":"sans","size":21,"align":"center","groupId":null}
- Other shapes: same but "type":"diamond" (decisions), "ellipse" (start/end), "chip" (small label pill, size 16)
- Text: same fields with "type":"text","fill":"none","align":"left" and w,h roughly fitting the text
- Arrow between shapes: {"id":"a1","type":"arrow","x":0,"y":0,"w":10,"h":10,"angle":0,"seed":23456,"stroke":"ink","fill":"none","fillStyle":"solid","dash":"solid","sw":3.3,"sketch":1,"round":1,"opacity":100,"text":"","font":"sans","size":16,"align":"center","groupId":null,"points":[[0,0],[10,0]],"curve":0,"elbow":false,"elbowPts":null,"startHead":"none","endHead":"arrow","startBind":"el1","endBind":"el2","startAnchor":null,"endAnchor":null}
  startBind/endBind reference element ids; the app glues and routes the arrow automatically. "text" on an arrow becomes its label. "elbow":true gives right-angle routing.

Rules:
- ids: any unique short strings. seed: any random integer per element.
- stroke colors: ink, gdark, gmid, glight, white, coral, blue, green, plum, or #hex
- optional "textColor" on any element: same values — use white on dark fills (omit = auto: follows stroke, flips light on dark fills)
- fill colors: none, cream, white, coral, terracotta, blush, periwinkle, sage, butter, sky, glight, gmid, gdark, ink, or #hex
- Coordinates: y grows downward, origin top-left of the board. Typical box 190×92, gaps 100 to 120 px, keep 60 px margins.
- "sketch":1 = hand-drawn wobble (default look), 0 = neat.
- Multi-page is allowed: more entries in "pages". Omit "board" in appState for an unlimited canvas.

The user saves your JSON as a .json file and opens it in KoralPaper. Now design what the user asks below, thinking about clear layout and generous spacing.

MY REQUEST: `;
$('copyPromptBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(DESIGN_PROMPT);
    showHint('Design prompt copied: paste it into any Claude, add your request');
  } catch (e){
    prompt('Copy this prompt:', DESIGN_PROMPT);
  }
});

const WIDTH_KEYS = ['fine', 'medium', 'thick'];
const SIZE_KEYS = ['s', 'm', 'l', 'xl'];
const sizeInputId = k => 'setSize' + k[0].toUpperCase() + k.slice(1);
const TYPO_KEYS = [['lh', 'setTypoLh', v => '×' + v], ['pgap', 'setTypoPgap', v => v + 'px'], ['lspace', 'setTypoLs', v => v + 'px']];
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
  for (const [k, id, fmt] of TYPO_KEYS){
    $(id).value = typo[k];
    $(id + 'Val').textContent = fmt(typo[k]);
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
for (const [k, id] of TYPO_KEYS){
  $(id).addEventListener('input', () => {
    const old = typo[k];
    typo[k] = Number($(id).value);
    if (defaults[k] === old) defaults[k] = typo[k]; // new elements follow immediately
    syncSettingsUI(); saveSettings();
  });
}
$('setResetWidths').addEventListener('click', () => {
  Object.assign(widths, DEFAULT_WIDTHS);
  defaults.sw = widths.medium;
  syncSettingsUI(); applyWidthPresets(); saveSettings();
  showHint('Line-width presets reset (1.7 / 3.3 / 5)');
});
$('setResetSizes').addEventListener('click', () => {
  Object.assign(sizes, DEFAULT_SIZES);
  defaults.size = sizes.m;
  syncSettingsUI(); applyWidthPresets(); saveSettings();
  showHint('Text-size presets reset (16 / 21 / 29 / 42)');
});
/* ── settings file: export / import every preference ── */
function exportSettings(){
  const data = {
    app: 'koralpaper-settings', version: 1, appVersion: APP_VERSION,
    settings: { widths: { ...widths }, sizes: { ...sizes }, typo: { ...typo } },
    pinnedIcons: miPinned(),
  };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  download(`koralpaper-settings-${new Date().toISOString().slice(0, 10)}.json`, URL.createObjectURL(blob));
  showHint('Settings exported: keep the .json to reload these values anytime');
}
function importSettingsData(data){
  const s = data.settings || {};
  if (s.widths) for (const k of WIDTH_KEYS)
    if (typeof s.widths[k] === 'number') widths[k] = clamp(s.widths[k], 0.5, 14);
  if (s.sizes) for (const k of SIZE_KEYS)
    if (typeof s.sizes[k] === 'number') sizes[k] = clamp(Math.round(s.sizes[k]), 8, 160);
  if (s.typo){
    if (typeof s.typo.lh === 'number') typo.lh = clamp(s.typo.lh, 0.5, 2.5);
    if (typeof s.typo.pgap === 'number') typo.pgap = clamp(s.typo.pgap, 0, 48);
    if (typeof s.typo.lspace === 'number') typo.lspace = clamp(s.typo.lspace, -7, 15);
  }
  if (Array.isArray(data.pinnedIcons)){
    try {
      localStorage.setItem('koralpaper.mi.pinned',
        JSON.stringify(data.pinnedIcons.filter(n => typeof n === 'string').slice(0, 18)));
    } catch (e){}
  }
  defaults.sw = widths.medium;
  defaults.size = sizes.m;
  defaults.lh = typo.lh; defaults.pgap = typo.pgap; defaults.lspace = typo.lspace;
  saveSettings(); syncSettingsUI(); applyWidthPresets();
  showHint(`Settings imported: widths ${widths.fine}/${widths.medium}/${widths.thick}, sizes ${sizes.s}/${sizes.m}/${sizes.l}/${sizes.xl}, spacing ×${typo.lh}/${typo.pgap}px/${typo.lspace}px`);
}
$('setExportBtn').addEventListener('click', exportSettings);
$('setImportBtn').addEventListener('click', () => $('settingsInput').click());
$('settingsInput').addEventListener('change', () => {
  const f = $('settingsInput').files[0];
  $('settingsInput').value = '';
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.app !== 'koralpaper-settings' && !data.settings)
        throw new Error('not a settings file');
      importSettingsData(data);
    } catch (e){
      alert('That file does not look like a KoralPaper settings file (.json).');
    }
  };
  reader.readAsText(f);
});

$('setResetTypo').addEventListener('click', () => {
  Object.assign(typo, DEFAULT_TYPO);
  defaults.lh = typo.lh; defaults.pgap = typo.pgap; defaults.lspace = typo.lspace;
  syncSettingsUI(); saveSettings();
  showHint('Text-spacing defaults reset (×1.3 / 0px / 0px)');
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
  $('assetMenu').classList.add('hidden');
  $('exportMenu').classList.add('hidden');
  $('boardMenu').classList.add('hidden');
  $('gridMenu').classList.add('hidden');
  $('ctxMenu').classList.add('hidden');
}
document.addEventListener('click', ev => {
  if (!ev.target.closest('#brandIsland') &&
      !ev.target.closest('#exportMenu') && !ev.target.closest('#exportMenuBtn')) closeMenus();
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
  state.images = {};
  state.camera = { x: 0, y: 0, z: 1 };
  try { localStorage.removeItem('asterisk.docname'); } catch (e){}
  buildPageStrip();
  syncPaperUI(); syncBoardBtn(); buildBoardMenuSel(); syncZoomLabel();
  commit(); syncPanel(); requestRender();
  showHint('New document: ⌘Z brings the previous pages back');
}
/* one Transparent-background toggle drives PNG & SVG exports */
const EXPT_KEY = 'koralpaper.exportT';
const exportT = () => { try { return localStorage.getItem(EXPT_KEY) === '1'; } catch (e){ return false; } };
function syncExpToggle(){
  const on = exportT();
  $('expTransToggle').classList.toggle('sel', on);
  $('expTransMark').textContent = on ? '✓' : '';
}
function runFileAction(act){
  if (act === 'expT'){
    try { localStorage.setItem(EXPT_KEY, exportT() ? '0' : '1'); } catch (e){}
    syncExpToggle();
    return;
  }
  if (act === 'new') newDocument();
  if (act === 'open') fileInput.click();
  if (act === 'save') saveJSON();
  if (act === 'image') $('imgInput').click();
  if (act === 'excal') exportExcalidraw();
  if (act === 'templates'){ buildTplList(); $('tplDialog').classList.remove('hidden'); }
  if (act === 'png') exportPNG(exportT());
  if (act === 'pngT') exportPNG(true);
  if (act === 'svg') exportSVG(exportT());
  if (act === 'svgT') exportSVG(true);
  if (act === 'pdf') exportPDFFlow();
  if (act === 'pngAll') exportAllPages();
  if (act === 'copyPng') copyAsPNG();
  if (act === 'copySvg') copyAsSVG();
  if (act === 'shareHtml') shareHTML();
  if (act === 'present') enterPresent();
  if (act === 'replay') startReplay(false);
  if (act === 'replayVid') startReplay(true);
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
    app: 'koralpaper', version: 6, appVersion: APP_VERSION,
    pages: doc.pages, pageIndex: doc.pageIndex, images: usedImages(),
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
      state.images = data.images || {};
      for (const pg of state.pages) adoptImages(pg.elements);
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
      alert('KoralPaper could not open that file.\n\n' +
        'It opens: .json sketches saved by KoralPaper, and .excalidraw files.\n' +
        'If this file came from KoralPaper, it may be damaged — the technical reason: ' +
        (e && e.message ? e.message : 'unknown') + '.');
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
    renderScene(octx, visibleEls(state.elements), {
      width: board.w, height: board.h,
      camera: { x: -board.x, y: -board.y, z: 1 },
      pal: pal(), transparent, bg: effectiveBg(),
      grid: transparent ? false : state.grid, gridSize: gsize(),
      gridColor: effectiveGridColor(),
    });
    name = `koralpaper-${board.w}x${board.h}`;
  } else {
    const b = sceneBounds(visibleEls(state.elements));
    if (!b){ alert('Nothing to export yet — draw something first.'); return; }
    const pad = 72;
    const maxDim = 8000;
    let scale = 2;
    scale = Math.min(scale, maxDim / (b.w + pad*2), maxDim / (b.h + pad*2));
    const w = Math.ceil((b.w + pad*2) * scale), h = Math.ceil((b.h + pad*2) * scale);
    off.width = w; off.height = h;
    renderScene(octx, visibleEls(state.elements), {
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
/* "Black carousel" — faithful conversion of Stefanos's Claude-designed
   1080×1350 carousel (black #0b0b0b paper, electric-yellow #EFE94A accent,
   Space Grotesk throughout — the design's own body face, substituting its
   original heading font to stay within the app's curated library). Three
   of its sixteen layouts: Stats, Highlight word, Numbered steps. */
function tplBlackCarousel(){
  const { mk, txt } = tplHelpers();
  const YEL = '#EFE94A', BLACK = '#0b0b0b', WHITE = '#FFFFFF', DIM = '#9E9E9E', LINE = '#2A2A2A';
  const N = { sketch: 0 };
  const R = 1022; // right edge (1080 − 58 padding)
  const header = (els) => {
    const logo = mk('rect', 58, 58, 36, 36, { fill: YEL, stroke: 'none', ...N });
    const p = txt(0, 61, 'P', 23, { font: 'spacegrotesk', stroke: BLACK, ...N });
    p.x = 76 - p.w / 2;
    const left = txt(107, 60, 'Pixel', 25, { font: 'spacegrotesk', stroke: WHITE, ...N });
    const right = txt(0, 61, 'Introduction', 23, { font: 'spacegrotesk', stroke: DIM, ...N });
    right.x = R - right.w;
    els.push(logo, p, left, right);
  };
  const footer = (els) => {
    const l = txt(58, 1262, '@pixel', 23, { font: 'spacegrotesk', stroke: DIM, ...N });
    const r = txt(0, 1262, 'pixel.com', 23, { font: 'spacegrotesk', stroke: DIM, ...N });
    r.x = R - r.w;
    els.push(l, r);
  };
  const divider = (y) => {
    const ln = mk('line', 58, y, 0, 0, { stroke: LINE, sw: 1.7, ...N });
    ln.points = [[0, 0], [964, 0]];
    ln.endHead = 'none';
    return ln;
  };

  /* ── 03 Stats ── */
  const stats = [];
  header(stats);
  const rows = [
    ['93%',  'of first impressions\nare visual',        204],
    ['2.7x', 'higher engagement\nwith strong branding', 440],
    ['5s',   'is all you get\nto grab attention',       676],
  ];
  for (const [num, label, y] of rows){
    stats.push(txt(58, y, num, 132, { font: 'spacegrotesk', stroke: YEL, ...N }));
    stats.push(txt(438, y + 24, label, 32, { font: 'spacegrotesk', stroke: WHITE, ...N }));
  }
  stats.push(divider(388), divider(624));
  footer(stats);

  /* ── 08 Highlight word ── */
  const hi = [];
  header(hi);
  const h1 = txt(58, 190, 'We build', 88, { font: 'spacegrotesk', stroke: WHITE, ...N });
  const chipText = txt(0, 196, 'software', 88, { font: 'spacegrotesk', stroke: BLACK, ...N });
  const chip = mk('rect', 58 + h1.w + 24, 186, chipText.w + 36, 112, { fill: YEL, stroke: 'none', ...N });
  chipText.x = chip.x + 18;
  const h2 = txt(58, 294, 'that outlasts', 88, { font: 'spacegrotesk', stroke: WHITE, ...N });
  const h3 = txt(58, 398, 'your rivals.', 88, { font: 'spacegrotesk', stroke: WHITE, ...N });
  const slot = mk('rect', 58, 582, 964, 560, { fill: 'none', stroke: DIM, dash: 'dashed', ...N });
  slot.text = 'Drop your image here — skyline / towers, b&w';
  slot.font = 'spacegrotesk'; slot.size = 26;
  hi.push(h1, chip, chipText, h2, h3, slot);
  footer(hi);

  /* ── 14 Numbered steps ── */
  const steps = [];
  header(steps);
  steps.push(txt(58, 194, 'Three moves that', 82, { font: 'spacegrotesk', stroke: WHITE, ...N }));
  steps.push(txt(58, 280, 'change everything', 82, { font: 'spacegrotesk', stroke: WHITE, ...N }));
  const stepRows = [
    ['01', 'Say one thing',          'Pick the single idea you want to own and cut the rest.',      460],
    ['02', "Show it, don't claim it", 'Proof beats adjectives every single time.',                   690],
    ['03', 'Repeat until boring',    "The moment you're sick of it is when they start noticing.",   920],
  ];
  for (const [num, title, para, y] of stepRows){
    steps.push(txt(58, y, num, 64, { font: 'spacegrotesk', stroke: YEL, ...N }));
    steps.push(txt(214, y + 6, title, 40, { font: 'spacegrotesk', stroke: WHITE, ...N }));
    steps.push(txt(214, y + 64, para, 26, { font: 'spacegrotesk', stroke: DIM, ...N }));
  }
  steps.push(divider(610), divider(840));
  footer(steps);

  return {
    pages: [
      { name: 'Stats', elements: stats },
      { name: 'Highlight', elements: hi },
      { name: 'Steps', elements: steps },
    ],
    board: { name: 'Black carousel', w: 1080, h: 1350, x: 0, y: 0 },
    bg: BLACK,
  };
}

const TEMPLATES = [
  { id: 'li-carousel', cat: 'Carousels', name: 'LinkedIn carousel', desc: '5 slides: cover, two content, photo, CTA. Header & footer on every slide', build: tplLinkedInCarousel },
  { id: 'black-carousel', cat: 'Carousels', name: 'Black carousel', desc: 'Stats, Highlight word & Numbered steps. 1080×1350, black paper + electric yellow (sets the paper color)', build: tplBlackCarousel },
  { id: 'flowchart', cat: 'Diagrams', name: 'Flowchart kit', desc: 'Start, steps, decision diamond, labeled glued arrows', build: tplFlowchart },
  { id: 'versus', cat: 'Infographics', name: 'Comparison / Versus', desc: 'Two columns with pros & cons and a verdict sticky', build: tplVersus },
  { id: 'quote', cat: 'Presentations', name: 'Quote card', desc: '1080×1080 square with a big serif quote', build: tplQuoteCard },
];
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
  adoptImages(clones);
  return clones;
}
function applyTemplate(def){
  const built = def.build ? def.build() : def;
  syncPageRef();
  const startIdx = state.pages.length;
  for (const pg of built.pages)
    state.pages.push(makePage(clonePageElements(pg.elements), pg.name));
  if (built.board) state.board = { ...built.board };
  if (built.bg){ state.bgColor = built.bg; syncPaperUI(); }
  state.pageIndex = startIdx;
  state.elements = state.pages[startIdx].elements;
  state.selection = new Set();
  updateBoundArrows(state.elements);
  preloadDocFonts();
  syncBoardBtn(); buildBoardMenuSel();
  commit(); buildPageStrip(); zoomToFit(); syncPanel();
  $('tplDialog').classList.add('hidden');
  showHint(`Template added: ${built.pages.length} page${built.pages.length > 1 ? 's' : ''}, fully editable`);
}

/* ── template store: user templates + built-in overrides/hides ──────
   Shape: { user: [tpl…], overrides: {builtinId: tpl}, hidden: [builtinId…] }
   tpl = { id, name, pages:[{name, elements}], board, bg }
   Migrates from the old plain-array format transparently. */
function tplStore(){
  try {
    const raw = JSON.parse(localStorage.getItem(TPL_STORE));
    if (Array.isArray(raw)) return { user: raw, overrides: {}, hidden: [] };
    if (raw && typeof raw === 'object')
      return { user: raw.user || [], overrides: raw.overrides || {}, hidden: raw.hidden || [] };
  } catch (e){}
  return { user: [], overrides: {}, hidden: [] };
}
function tplSave(store){
  try { localStorage.setItem(TPL_STORE, JSON.stringify(store)); return true; }
  catch (e){ alert('Could not save the template (browser storage is full).'); return false; }
}
function loadUserTemplates(){ return tplStore().user; }
/* snapshot the current document (or just the active page) as template data */
function tplSnapshot(name, scope){
  syncPageRef();
  const strip = els => {
    const out = JSON.parse(JSON.stringify(els, (k, v) => k.startsWith('_') ? undefined : v));
    // templates outlive this document, so they carry their own pixels
    for (const el of out)
      if (el.type === 'image' && el.imgId && state.images[el.imgId]) el.src = state.images[el.imgId];
    return out;
  };
  const pages = scope === 'all'
    ? state.pages.map(p => ({ name: p.name, elements: strip(p.elements) }))
    : [{ name: state.pages[state.pageIndex].name || name, elements: strip(state.elements) }];
  return {
    id: uid(), name, pages,
    board: state.board ? { ...state.board } : null,
    bg: state.bgColor || null,
  };
}
const TPL_SUGGESTED_CATS = ['Carousels', 'Presentations', 'Infographics', 'Diagrams'];
function tplCatOf(t){ return (t.cat || 'Other'); }
function tplAllCats(){
  const found = new Set(TPL_SUGGESTED_CATS);
  const store = tplStore();
  for (const t of TEMPLATES) if (!store.hidden.includes(t.id)) found.add(tplCatOf(store.overrides[t.id] || t));
  for (const t of store.user) found.add(tplCatOf(t));
  return [...TPL_SUGGESTED_CATS, ...[...found].filter(c => !TPL_SUGGESTED_CATS.includes(c)).sort()];
}
const TPL_FOLD_KEY = 'koralpaper.tplfold';
function tplFolded(){
  try { const v = JSON.parse(localStorage.getItem(TPL_FOLD_KEY)); return Array.isArray(v) ? v : []; }
  catch (e){ return []; }
}
function tplFillCatSelect(current){
  const sel = $('tplCat');
  sel.replaceChildren();
  for (const c of tplAllCats()){
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  }
  const nw = document.createElement('option');
  nw.value = '__new'; nw.textContent = 'New category…';
  sel.appendChild(nw);
  sel.value = current && [...sel.options].some(o => o.value === current) ? current : tplAllCats()[0];
}
function tplAskScope(){
  // 'all' | 'page' | null (cancelled) — only asks when it matters
  if (state.pages.length <= 1) return 'page';
  return confirm(`Include all ${state.pages.length} pages?\n\nOK = every page · Cancel = only the current page`)
    ? 'all' : 'page';
}
function saveUserTemplate(scope){
  const sc = scope || 'page';
  const name = (($('tplName').value || '').trim()) || $('tplName').placeholder.trim();
  if (!name){ $('tplName').focus(); showHint('Give the template a name first'); return; }
  const cat = $('tplCat').value === '__new' ? 'Other' : $('tplCat').value;
  const store = tplStore();
  const snap = tplSnapshot(name, sc);
  snap.cat = cat;
  store.user.push(snap);
  if (!tplSave(store)) return;
  $('tplName').value = '';
  buildTplList();
  showHint(`\u201C${name}\u201D saved to ${cat}: ${sc === 'all' ? state.pages.length + ' pages' : '1 page'}${state.board ? ' \u00B7 ' + state.board.w + '\u00D7' + state.board.h : ''}`);
}
function tplUpdate(kind, id, currentName){
  const sc = tplAskScope();
  if (!sc) return;
  if (!confirm(`Replace \u201C${currentName}\u201D with the ${sc === 'all' ? 'whole current document' : 'current page'}?`)) return;
  const store = tplStore();
  const snap = tplSnapshot(currentName, sc);
  const prev = kind === 'user' ? store.user.find(t => t.id === id) : (store.overrides[id] || TEMPLATES.find(t => t.id === id));
  if (prev) snap.cat = prev.cat || 'Other';
  if (kind === 'user'){
    const i = store.user.findIndex(t => t.id === id);
    if (i < 0) return;
    snap.id = id;
    store.user[i] = snap;
  } else {
    snap.id = id;
    store.overrides[id] = snap;
  }
  if (!tplSave(store)) return;
  buildTplList();
  showHint(`\u201C${currentName}\u201D updated`);
}
function tplRename(kind, id, oldName){
  const name = prompt('New name:', oldName);
  if (!name || !name.trim()) return;
  const store = tplStore();
  const t = kind === 'user' ? store.user.find(t => t.id === id) : store.overrides[id];
  if (!t) return;
  t.name = name.trim();
  const cat = prompt('Category (' + tplAllCats().join(', ') + ' — or type a new one):', t.cat || 'Other');
  if (cat && cat.trim()) t.cat = cat.trim();
  if (tplSave(store)) buildTplList();
}
function tplDelete(kind, id, name){
  if (!confirm(`Delete \u201C${name}\u201D from the template library?`)) return;
  const store = tplStore();
  if (kind === 'user') store.user = store.user.filter(t => t.id !== id);
  else {
    delete store.overrides[id];
    if (!store.hidden.includes(id)) store.hidden.push(id);
  }
  if (tplSave(store)) buildTplList();
}
function tplRestoreBuiltins(){
  const store = tplStore();
  store.overrides = {}; store.hidden = [];
  if (tplSave(store)) buildTplList();
  showHint('Built-in templates restored');
}
function buildTplList(){
  const list = $('tplList');
  list.replaceChildren();
  const store = tplStore();
  const meta = t => `${t.pages.length} page${t.pages.length > 1 ? 's' : ''}` +
    (t.board ? ` \u00B7 ${t.board.w}\u00D7${t.board.h}` : ' \u00B7 unlimited canvas') +
    (t.bg ? ' \u00B7 custom paper' : '');
  const mini = (label, title, fn, extraClass) => {
    const b = document.createElement('button');
    b.className = 'minipill tplmini' + (extraClass ? ' ' + extraClass : '');
    b.textContent = label; b.title = title;
    b.addEventListener('click', fn);
    return b;
  };
  // one merged, category-grouped list: built-ins and your own together
  const rows = [];
  for (const t of TEMPLATES){
    if (store.hidden.includes(t.id)) continue;
    const ov = store.overrides[t.id];
    const shown = ov || t;
    rows.push({ cat: tplCatOf(shown), name: shown.name,
      desc: ov ? meta(ov) + ' \u00B7 customized' : t.desc,
      actions: ov
        ? [ mini('Add', 'Add these pages to the document', () => applyTemplate(ov)),
            mini('\u270E', 'Rename / change category', () => tplRename('builtin', t.id, ov.name)),
            mini('\u21BB', 'Update with the current design', () => tplUpdate('builtin', t.id, ov.name)),
            mini('\u2715', 'Delete', () => tplDelete('builtin', t.id, ov.name), 'danger tpldel') ]
        : [ mini('Add', 'Add these pages to the document', () => applyTemplate(t)),
            mini('\u21BB', 'Replace this built-in with your current design', () => tplUpdate('builtin', t.id, t.name)),
            mini('\u2715', 'Remove from the list (restorable)', () => tplDelete('builtin', t.id, t.name), 'danger tpldel') ] });
  }
  for (const t of store.user)
    rows.push({ cat: tplCatOf(t), name: t.name, desc: meta(t), yours: true,
      actions: [ mini('Add', 'Add these pages to the document', () => applyTemplate(t)),
        mini('\u270E', 'Rename / change category', () => tplRename('user', t.id, t.name)),
        mini('\u21BB', 'Update with the current design', () => tplUpdate('user', t.id, t.name)),
        mini('\u2715', 'Delete', () => tplDelete('user', t.id, t.name), 'danger tpldel') ] });
  const cats = tplAllCats().filter(c => rows.some(r => r.cat === c));
  const folded = tplFolded();
  for (const cat of cats){
    const catRows = rows.filter(r => r.cat === cat);
    const isFolded = folded.includes(cat);
    const head = document.createElement('button');
    head.className = 'menuhead tplcathead' + (isFolded ? ' folded' : '');
    head.type = 'button';
    head.title = isFolded ? 'Show this category' : 'Hide this category';
    const hn = document.createElement('span'); hn.textContent = cat;
    const hc = document.createElement('span'); hc.className = 'tplcatmeta';
    hc.textContent = catRows.length + (isFolded ? ' \u25B8' : ' \u25BE');
    head.append(hn, hc);
    head.addEventListener('click', () => {
      const f = tplFolded();
      const i = f.indexOf(cat);
      if (i >= 0) f.splice(i, 1); else f.push(cat);
      try { localStorage.setItem(TPL_FOLD_KEY, JSON.stringify(f)); } catch (e){}
      buildTplList();
    });
    list.appendChild(head);
    if (isFolded) continue;
    for (const r of catRows){
      const row = document.createElement('div');
      row.className = 'tplrow';
      const info = document.createElement('div');
      info.className = 'tplinfo';
      const nm = document.createElement('b');
      nm.textContent = r.name;
      if (r.yours){ const st = document.createElement('span'); st.className = 'star'; st.textContent = ' \u2605'; nm.appendChild(st); }
      const ds = document.createElement('span'); ds.textContent = r.desc;
      info.appendChild(nm); info.appendChild(ds);
      row.appendChild(info);
      for (const a of r.actions) row.appendChild(a);
      list.appendChild(row);
    }
  }
  const dirty = store.hidden.length || Object.keys(store.overrides).length;
  $('tplRestoreBtn').classList.toggle('hidden', !dirty);
  // save form defaults
  if (!$('tplName').value) $('tplName').value = '';
  $('tplName').placeholder = state.pages[state.pageIndex].name || 'Template name';
  tplFillCatSelect($('tplCat').value !== '__new' ? $('tplCat').value : null);
  $('tplSaveAllBtn').classList.toggle('hidden', state.pages.length <= 1);
}
$('tplCat').addEventListener('change', () => {
  if ($('tplCat').value !== '__new') return;
  const c = prompt('New category name:', '');
  if (c && c.trim()){ const cc = c.trim(); tplFillCatSelect(null);
    const o = document.createElement('option'); o.value = cc; o.textContent = cc;
    $('tplCat').insertBefore(o, $('tplCat').lastElementChild); $('tplCat').value = cc;
  } else tplFillCatSelect(null);
});
$('tplSaveBtn').addEventListener('click', () => saveUserTemplate('page'));
$('tplSaveAllBtn').addEventListener('click', () => saveUserTemplate('all'));
$('tplRestoreBtn').addEventListener('click', tplRestoreBuiltins);
$('tplCloseBtn').addEventListener('click', () => $('tplDialog').classList.add('hidden'));


/* ── charts & tables ─────────────────────────────────
   The dialog turns pasted numbers into ORDINARY elements (rects, draw
   paths, lines, text) in one group. Every piece stays editable with the
   normal tools; each piece carries el.chart = the recipe, so right-click
   → "Edit chart data" can rebuild the group in place. */
const CHART_FILLS = ['coral', 'periwinkle', 'sage', 'butter', 'blush', 'sky', 'terracotta', 'cream'];
const CHART_STROKES = ['coral', 'blue', 'green', 'plum', 'gdark', 'ink'];

function chartNum(c){
  const v = parseFloat(String(c).replace(/\s/g, '').replace(/^\+/, ''));
  return isNaN(v) ? null : v;
}
function chartRows(txt){
  const lines = String(txt || '').trim().split('\n').map(l => l.replace(/\r/g, '')).filter(l => l.trim().length);
  if (!lines.length) throw 'Type or paste some data first';
  return lines.map(l => l.split(/\t|;|,/).map(c => c.trim()));
}
function chartParseData(txt){
  const rows = chartRows(txt);
  const width = Math.max(...rows.map(r => r.length));
  if (width === 1){
    const vals = rows.map((r, i) => {
      const v = chartNum(r[0]);
      if (v === null) throw `Row ${i + 1}: "${r[0]}" is not a number`;
      return v;
    });
    return { series: ['Values'], cats: vals.map((_, i) => String(i + 1)), vals: vals.map(v => [v]) };
  }
  const headed = rows[0].slice(1).some(c => c !== '' && chartNum(c) === null);
  const series = [];
  for (let j = 1; j < width; j++)
    series.push(headed && rows[0][j] ? rows[0][j] : (width === 2 ? 'Values' : 'Series ' + j));
  const body = headed ? rows.slice(1) : rows;
  if (!body.length) throw 'Add at least one data row';
  if (body.length > 40) throw 'That is a lot of rows: keep it under 40';
  if (series.length > 8) throw 'Keep it under 8 series (value columns)';
  const cats = [], vals = [];
  body.forEach((r, i) => {
    cats.push(r[0] !== '' && r[0] !== undefined ? r[0] : 'Row ' + (i + 1));
    const row = [];
    for (let j = 1; j < width; j++){
      const raw = r[j];
      if (raw === undefined || raw === '') { row.push(0); continue; }
      const v = chartNum(raw);
      if (v === null) throw `Row ${i + (headed ? 2 : 1)}: "${raw}" is not a number`;
      row.push(v);
    }
    vals.push(row);
  });
  return { series, cats, vals };
}
/* measured text element; position by (x, y) top-left after checking .w/.h */
function chartText(txt, size, stroke, opts){
  const el = newElement('text', 0, 0, Object.assign({ size, stroke, align: 'left', sw: 3.3 }, opts || {}));
  el.text = String(txt);
  const m = measureText(el.text, el.font, el.size, el);
  el.w = m.w; el.h = m.h;
  return el;
}
function chartLine(x1, y1, x2, y2, stroke, sw, dash2){
  const el = newElement('line', Math.min(x1, x2), Math.min(y1, y2), { stroke, sw, dash: dash2 || 'solid', sketch: 1 });
  el.w = Math.abs(x2 - x1); el.h = Math.abs(y2 - y1);
  el.points = [[x1 - el.x, y1 - el.y], [x2 - el.x, y2 - el.y]];
  return el;
}
function chartFmt(v){
  return String(Math.round(v * 100) / 100);
}
function chartStep(range){
  const raw = range / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}
/* title + legend header shared by bar and line charts; returns next free y */
function chartHeader(els, spec, d, plotX, plotW, lineMode){
  let ty = 0;
  if (spec.title){
    const t = chartText(spec.title, 26, 'ink', { font: 'serif' });
    t.x = plotX + plotW / 2 - t.w / 2; t.y = ty;
    els.push(t); ty += t.h + 14;
  }
  if (d.series.length > 1){
    let lx = plotX;
    d.series.forEach((name, j) => {
      const sw2 = newElement('rect', lx, ty + 2, {
        fill: lineMode ? 'white' : CHART_FILLS[j % CHART_FILLS.length],
        stroke: lineMode ? CHART_STROKES[j % CHART_STROKES.length] : 'ink',
        sw: lineMode ? 2.6 : 1.8, round: 0, sketch: 1,
      });
      sw2.w = 14; sw2.h = 14;
      els.push(sw2);
      const t = chartText(name, 13, 'ink');
      t.x = lx + 20; t.y = ty + 9 - t.h / 2;
      els.push(t);
      lx += 20 + t.w + 20;
    });
    ty += 26;
  }
  return ty;
}
/* value axis scale for bars and lines */
function chartScale(d){
  let vmin = 0, vmax = 0;
  for (const row of d.vals) for (const v of row){ vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
  if (vmax === 0 && vmin === 0) vmax = 1;
  const step = chartStep(vmax - vmin);
  vmax = Math.ceil((vmax - 1e-9) / step) * step;
  if (vmin < 0) vmin = Math.floor((vmin + 1e-9) / step) * step;
  return { vmin, vmax, step };
}
function chartBuildBars(d, spec, horizontal){
  const els = [];
  const { vmin, vmax, step } = chartScale(d);
  const plotW = horizontal ? 460 : 520, plotH = horizontal ? Math.max(220, d.cats.length * 44) : 300;
  const plotX = 0;
  const plotY = chartHeader(els, spec, d, plotX, plotW, false);
  const nS = d.series.length, nC = d.cats.length;
  if (!horizontal){
    const y = v => plotY + plotH * (vmax - v) / (vmax - vmin);
    for (let v = vmin; v <= vmax + 1e-9; v += step){
      if (Math.abs(v) > 1e-9)
        els.push(chartLine(plotX, y(v), plotX + plotW, y(v), 'glight', 1.3));
      const t = chartText(chartFmt(v), 12, 'gmid');
      t.x = plotX - 10 - t.w; t.y = y(v) - t.h / 2;
      els.push(t);
    }
    const y0 = y(0);
    const slot = plotW / nC, groupW = slot * 0.72, barW = groupW / nS;
    d.cats.forEach((cat, i) => {
      d.vals[i].forEach((v, j) => {
        const by = Math.min(y(v), y0), bh = Math.max(2, Math.abs(y(v) - y0));
        const bar = newElement('rect', plotX + slot * i + (slot - groupW) / 2 + barW * j, by, {
          fill: CHART_FILLS[j % CHART_FILLS.length], stroke: 'ink', sw: 2, round: 0, sketch: 1,
        });
        bar.w = Math.max(4, barW - 3); bar.h = bh;
        els.push(bar);
      });
      const t = chartText(cat, 13, 'gdark');
      t.x = plotX + slot * i + slot / 2 - t.w / 2; t.y = plotY + plotH + 10;
      els.push(t);
    });
    els.push(chartLine(plotX, plotY, plotX, plotY + plotH, 'ink', 2.5));
    els.push(chartLine(plotX, y0, plotX + plotW, y0, 'ink', 2.5));
    if (spec.xl){
      const t = chartText(spec.xl, 15, 'gdark');
      t.x = plotX + plotW / 2 - t.w / 2; t.y = plotY + plotH + 34;
      els.push(t);
    }
    if (spec.yl){
      const t = chartText(spec.yl, 15, 'gdark', { angle: -Math.PI / 2 });
      t.x = plotX - 58 - t.w / 2; t.y = plotY + plotH / 2 - t.h / 2;
      els.push(t);
    }
  } else {
    const x = v => plotX + plotW * (v - vmin) / (vmax - vmin);
    for (let v = vmin; v <= vmax + 1e-9; v += step){
      if (Math.abs(v) > 1e-9)
        els.push(chartLine(x(v), plotY, x(v), plotY + plotH, 'glight', 1.3));
      const t = chartText(chartFmt(v), 12, 'gmid');
      t.x = x(v) - t.w / 2; t.y = plotY + plotH + 8;
      els.push(t);
    }
    const x0 = x(0);
    const slot = plotH / nC, groupH = slot * 0.72, barH = groupH / nS;
    d.cats.forEach((cat, i) => {
      d.vals[i].forEach((v, j) => {
        const bx = Math.min(x(v), x0), bw = Math.max(2, Math.abs(x(v) - x0));
        const bar = newElement('rect', bx, plotY + slot * i + (slot - groupH) / 2 + barH * j, {
          fill: CHART_FILLS[j % CHART_FILLS.length], stroke: 'ink', sw: 2, round: 0, sketch: 1,
        });
        bar.w = bw; bar.h = Math.max(4, barH - 3);
        els.push(bar);
      });
      const t = chartText(cat, 13, 'gdark');
      t.x = plotX - 10 - t.w; t.y = plotY + slot * i + slot / 2 - t.h / 2;
      els.push(t);
    });
    els.push(chartLine(plotX, plotY + plotH, plotX + plotW, plotY + plotH, 'ink', 2.5));
    els.push(chartLine(x0, plotY, x0, plotY + plotH, 'ink', 2.5));
    if (spec.xl){
      const t = chartText(spec.xl, 15, 'gdark');
      t.x = plotX + plotW / 2 - t.w / 2; t.y = plotY + plotH + 32;
      els.push(t);
    }
    if (spec.yl){
      const t = chartText(spec.yl, 15, 'gdark', { angle: -Math.PI / 2 });
      const catW = Math.max(...d.cats.map(c => measureText(c, 'sans', 13).w));
      t.x = plotX - catW - 40 - t.w / 2; t.y = plotY + plotH / 2 - t.h / 2;
      els.push(t);
    }
  }
  return els;
}
function chartBuildLine(d, spec){
  const els = [];
  const { vmin, vmax, step } = chartScale(d);
  const plotW = 520, plotH = 300, plotX = 0;
  const plotY = chartHeader(els, spec, d, plotX, plotW, true);
  const nC = d.cats.length;
  const y = v => plotY + plotH * (vmax - v) / (vmax - vmin);
  for (let v = vmin; v <= vmax + 1e-9; v += step){
    if (Math.abs(v) > 1e-9)
      els.push(chartLine(plotX, y(v), plotX + plotW, y(v), 'glight', 1.3));
    const t = chartText(chartFmt(v), 12, 'gmid');
    t.x = plotX - 10 - t.w; t.y = y(v) - t.h / 2;
    els.push(t);
  }
  const slot = plotW / nC;
  const px = i => plotX + slot * i + slot / 2;
  d.series.forEach((name, j) => {
    const abs = d.vals.map((row, i) => [px(i), y(row[j])]);
    const minX = Math.min(...abs.map(p => p[0])), minY = Math.min(...abs.map(p => p[1]));
    const ln = newElement('draw', minX, minY, {
      stroke: CHART_STROKES[j % CHART_STROKES.length], sw: 3, sketch: 1, fill: 'none',
    });
    ln.points = abs.map(p => [p[0] - minX, p[1] - minY]);
    ln.w = Math.max(...ln.points.map(p => p[0]));
    ln.h = Math.max(...ln.points.map(p => p[1]));
    els.push(ln);
    if (nC <= 14) abs.forEach(pt => {
      const dot = newElement('ellipse', pt[0] - 4.5, pt[1] - 4.5, {
        fill: 'white', stroke: CHART_STROKES[j % CHART_STROKES.length], sw: 2.4, sketch: 1,
      });
      dot.w = 9; dot.h = 9;
      els.push(dot);
    });
  });
  d.cats.forEach((cat, i) => {
    const t = chartText(cat, 13, 'gdark');
    t.x = px(i) - t.w / 2; t.y = plotY + plotH + 10;
    els.push(t);
  });
  const y0 = vmin < 0 ? y(0) : plotY + plotH;
  els.push(chartLine(plotX, plotY, plotX, plotY + plotH, 'ink', 2.5));
  els.push(chartLine(plotX, y0, plotX + plotW, y0, 'ink', 2.5));
  if (spec.xl){
    const t = chartText(spec.xl, 15, 'gdark');
    t.x = plotX + plotW / 2 - t.w / 2; t.y = plotY + plotH + 34;
    els.push(t);
  }
  if (spec.yl){
    const t = chartText(spec.yl, 15, 'gdark', { angle: -Math.PI / 2 });
    t.x = plotX - 58 - t.w / 2; t.y = plotY + plotH / 2 - t.h / 2;
    els.push(t);
  }
  return els;
}
function chartBuildPie(d, spec, donut){
  const els = [];
  const vals = d.vals.map(r => Math.abs(r[0]));
  const total = vals.reduce((a, v) => a + v, 0);
  if (total <= 0) throw 'A pie needs at least one number above zero';
  const r = 150, rIn = donut ? r * 0.55 : 0, cx = 0, cy = 0;
  let a = -Math.PI / 2;
  vals.forEach((v, i) => {
    if (!v) return;
    const a2 = a + (v / total) * Math.PI * 2;
    const pts = [];
    const steps = Math.max(3, Math.ceil((a2 - a) / 0.09));
    if (donut){
      for (let k = 0; k <= steps; k++){
        const ang = a + (a2 - a) * k / steps;
        pts.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]);
      }
      for (let k = steps; k >= 0; k--){
        const ang = a + (a2 - a) * k / steps;
        pts.push([cx + Math.cos(ang) * rIn, cy + Math.sin(ang) * rIn]);
      }
      pts.push(pts[0].slice());
    } else {
      pts.push([cx, cy]);
      for (let k = 0; k <= steps; k++){
        const ang = a + (a2 - a) * k / steps;
        pts.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]);
      }
      pts.push([cx, cy]);
    }
    const minX = Math.min(...pts.map(pp => pp[0])), minY = Math.min(...pts.map(pp => pp[1]));
    const slice = newElement('draw', minX, minY, {
      fill: CHART_FILLS[i % CHART_FILLS.length], stroke: 'ink', sw: 2.5, sketch: 1,
    });
    slice.points = pts.map(pp => [pp[0] - minX, pp[1] - minY]);
    slice.w = Math.max(...slice.points.map(pp => pp[0]));
    slice.h = Math.max(...slice.points.map(pp => pp[1]));
    els.push(slice);
    const mid = (a + a2) / 2, lr = r + 18;
    const pct = Math.round(v / total * 100);
    const t = chartText(`${d.cats[i]} · ${pct}%`, 14, 'ink');
    const lx = cx + Math.cos(mid) * lr, ly = cy + Math.sin(mid) * lr;
    t.x = Math.cos(mid) >= 0.06 ? lx : Math.cos(mid) <= -0.06 ? lx - t.w : lx - t.w / 2;
    t.y = ly - t.h / 2;
    els.push(t);
    a = a2;
  });
  if (spec.title){
    const t = chartText(spec.title, 26, 'ink', { font: 'serif' });
    t.x = cx - t.w / 2; t.y = cy - r - 70;
    els.push(t);
  }
  return els;
}
function chartBuildTable(spec){
  const rows = chartRows(spec.data);
  if (rows.length < 2) throw 'A table needs a header row plus at least one data row';
  if (rows.length > 30) throw 'Keep tables under 30 rows';
  const nCols = Math.max(...rows.map(rr => rr.length));
  if (nCols > 8) throw 'Keep tables under 8 columns';
  const els = [];
  const headH = 42, rowH = 37, padX = 13;
  const colW = [];
  for (let c = 0; c < nCols; c++){
    let mw = 0;
    rows.forEach((rr, i) => {
      const m = measureText(String(rr[c] ?? ''), 'sans', i ? 14 : 15);
      mw = Math.max(mw, m.w);
    });
    colW.push(clamp(Math.ceil(mw) + padX * 2 + 4, 64, 250));
  }
  const totalW = colW.reduce((acc, w) => acc + w, 0);
  const totalH = headH + (rows.length - 1) * rowH;
  let ty = 0;
  if (spec.title){
    const t = chartText(spec.title, 26, 'ink', { font: 'serif' });
    t.x = totalW / 2 - t.w / 2; t.y = 0;
    els.push(t); ty = t.h + 16;
  }
  const head = newElement('rect', 0, ty, { fill: 'coral', stroke: 'none', round: 0, sketch: 1 });
  head.w = totalW; head.h = headH;
  els.push(head);
  for (let i = 2; i < rows.length; i += 2){
    const stripe = newElement('rect', 0, ty + headH + (i - 1) * rowH, { fill: 'cream', stroke: 'none', round: 0, sketch: 0 });
    stripe.w = totalW; stripe.h = rowH;
    els.push(stripe);
  }
  let cxx = 0;
  for (let c = 0; c < nCols - 1; c++){
    cxx += colW[c];
    els.push(chartLine(cxx, ty, cxx, ty + totalH, 'glight', 1.4));
  }
  els.push(chartLine(0, ty + headH, totalW, ty + headH, 'ink', 2));
  const frame = newElement('rect', 0, ty, { fill: 'none', stroke: 'ink', sw: 2.5, round: 0, sketch: 1 });
  frame.w = totalW; frame.h = totalH;
  els.push(frame);
  rows.forEach((rr, i) => {
    const isHead = i === 0;
    const rowY = isHead ? ty : ty + headH + (i - 1) * rowH;
    const rh = isHead ? headH : rowH;
    let colX = 0;
    for (let c = 0; c < nCols; c++){
      const raw = String(rr[c] ?? '');
      if (raw !== ''){
        const t = chartText(raw, isHead ? 15 : 14, isHead ? 'white' : 'ink');
        if (isHead) t.runs = [{ s: 0, e: raw.length, b: true, i: false, hl: null, co: null }];
        const numeric = !isHead && chartNum(raw) !== null;
        t.x = numeric ? colX + colW[c] - padX - t.w : colX + padX;
        t.y = rowY + (rh - t.h) / 2;
        els.push(t);
      }
      colX += colW[c];
    }
  });
  return els;
}
function chartBuild(spec){
  let els;
  if (spec.type === 'table') els = chartBuildTable(spec);
  else {
    const d = chartParseData(spec.data);
    if (spec.type === 'bars') els = chartBuildBars(d, spec, false);
    else if (spec.type === 'hbars') els = chartBuildBars(d, spec, true);
    else if (spec.type === 'line') els = chartBuildLine(d, spec);
    else els = chartBuildPie(d, spec, spec.type === 'donut');
  }
  const b = sceneBounds(els);
  for (const el of els){ el.x -= b.x; el.y -= b.y; }
  return { els, w: b.w, h: b.h };
}

/* ── chart dialog ── */
let chartType = 'bars', chartDirty = false, chartEditCtx = null, chartPrevTimer = null;
const CHART_SAMPLES = {
  bars: 'Quarter\tSales\tCosts\nQ1\t42\t31\nQ2\t55\t40\nQ3\t38\t45\nQ4\t61\t52',
  hbars: 'Quarter\tSales\tCosts\nQ1\t42\t31\nQ2\t55\t40\nQ3\t38\t45\nQ4\t61\t52',
  line: 'Month\tVisitors\tSignups\nJan\t120\t30\nFeb\t180\t42\nMar\t150\t55\nApr\t210\t70\nMay\t260\t85',
  pie: 'Consulting\t45\nTraining\t30\nProducts\t15\nOther\t10',
  donut: 'Consulting\t45\nTraining\t30\nProducts\t15\nOther\t10',
  table: 'Product\tQ1\tQ2\tGrowth\nAlpha\t120\t135\t+12%\nBeta\t80\t95\t+19%\nGamma\t45\t60\t+33%',
};
const CHART_INTROS = {
  chart: 'Paste rows straight from Excel or Numbers, or type them: one row per line, columns split by Tab, comma or semicolon. First column: labels. First row: series names (optional). Negative numbers work.',
  pie: 'One row per slice: a label, then its value. Percentages are computed for you.',
  table: 'Every cell becomes a table cell. The first row is the header; numbers align right on their own.',
};
function chartSpecFromUI(){
  return {
    type: chartType,
    data: $('chartData').value,
    title: $('chartTitle').value.trim(),
    xl: $('chartXLabel').value.trim(),
    yl: $('chartYLabel').value.trim(),
  };
}
function chartSyncTypeUI(){
  document.querySelectorAll('#chartTypeSeg button').forEach(b => b.classList.toggle('sel', b.dataset.ct === chartType));
  $('chartAxisRow').classList.toggle('hidden', chartType === 'pie' || chartType === 'donut' || chartType === 'table');
  $('chartIntro').textContent = chartType === 'table' ? CHART_INTROS.table
    : (chartType === 'pie' || chartType === 'donut') ? CHART_INTROS.pie : CHART_INTROS.chart;
}
function chartSetType(t){
  chartType = t;
  chartSyncTypeUI();
  if (!chartDirty) $('chartData').value = CHART_SAMPLES[t];
  chartPreviewRefresh();
}
function chartPreviewRefresh(){
  clearTimeout(chartPrevTimer);
  chartPrevTimer = setTimeout(() => {
    const cv = $('chartPreview'), err = $('chartErr');
    const cw = cv.clientWidth || 400, chh = cv.clientHeight || 200;
    cv.width = cw * 2; cv.height = chh * 2;
    const ctx2 = cv.getContext('2d');
    try {
      const { els, w, h } = chartBuild(chartSpecFromUI());
      err.classList.add('hidden');
      const pad = Math.max(w, h) * 0.05;
      const z = Math.min(cv.width / (w + pad * 2), cv.height / (h + pad * 2));
      renderScene(ctx2, els, {
        width: cv.width, height: cv.height,
        camera: { x: (cv.width - w * z) / 2, y: (cv.height - h * z) / 2, z },
        pal: pal(), grid: false, bg: effectiveBg(), hideBoardFrame: true,
      });
    } catch (e){
      ctx2.clearRect(0, 0, cv.width, cv.height);
      err.textContent = typeof e === 'string' ? e : 'Could not read the data';
      err.classList.remove('hidden');
      if (typeof e !== 'string') console.warn('chart build', e);
    }
  }, 200);
}
function chartOpen(fromEl){
  closeMenus();
  chartEditCtx = null;
  if (fromEl && fromEl.chart){
    const c = fromEl.chart;
    chartEditCtx = { chartId: c.id, groupId: fromEl.groupId };
    chartType = c.type;
    $('chartData').value = c.data || '';
    $('chartTitle').value = c.title || '';
    $('chartXLabel').value = c.xl || '';
    $('chartYLabel').value = c.yl || '';
    chartDirty = true;
  } else if (!chartDirty && !$('chartData').value){
    $('chartData').value = CHART_SAMPLES[chartType];
  }
  $('chartAddBtn').textContent = chartEditCtx ? 'Update chart' : 'Add to page';
  chartSyncTypeUI();
  $('chartDialog').classList.remove('hidden');
  chartPreviewRefresh();
}
function chartApply(){
  let built;
  try { built = chartBuild(chartSpecFromUI()); }
  catch (e){ chartPreviewRefresh(); return; }
  const spec = chartSpecFromUI();
  let gid, ox, oy;
  if (chartEditCtx){
    const old = state.elements.filter(e => e.chart && e.chart.id === chartEditCtx.chartId);
    const ob = old.length ? sceneBounds(old) : null;
    gid = chartEditCtx.groupId || uid();
    if (ob){ ox = ob.x; oy = ob.y; }
    state.elements = state.elements.filter(e => !(e.chart && e.chart.id === chartEditCtx.chartId));
    spec.id = chartEditCtx.chartId;
  }
  if (ox === undefined){
    const [scx, scy] = toScene(window.innerWidth / 2, window.innerHeight / 2);
    ox = scx - built.w / 2; oy = scy - built.h / 2;
    gid = gid || uid();
    spec.id = spec.id || uid();
  }
  for (const el of built.els){
    el.x += ox; el.y += oy;
    el.groupId = gid;
    el.chart = spec;
    state.elements.push(el);
  }
  setSelection(new Set(built.els.map(e => e.id)));
  setTool('select');
  commit(); requestRender();
  $('chartDialog').classList.add('hidden');
  showHint(chartEditCtx
    ? 'Chart rebuilt with the new data'
    : 'Added. Right-click it to edit the data; every bar and slice recolors like any shape');
  chartEditCtx = null;
}
document.querySelectorAll('#chartTypeSeg button').forEach(b =>
  b.addEventListener('click', () => chartSetType(b.dataset.ct)));
$('chartData').addEventListener('input', () => { chartDirty = true; chartPreviewRefresh(); });
/* Tab types a column separator instead of leaving the field
   (Shift+Tab still moves focus away for keyboard users) */
$('chartData').addEventListener('keydown', ev => {
  ev.stopPropagation();
  if (ev.key !== 'Tab' || ev.shiftKey) return;
  ev.preventDefault();
  const ta = ev.target;
  if (!document.execCommand || !document.execCommand('insertText', false, '\t')){
    const a = ta.selectionStart, b = ta.selectionEnd;
    ta.value = ta.value.slice(0, a) + '\t' + ta.value.slice(b);
    ta.selectionStart = ta.selectionEnd = a + 1;
    ta.dispatchEvent(new Event('input'));
  }
});
['chartTitle', 'chartXLabel', 'chartYLabel'].forEach(id =>
  $(id).addEventListener('input', chartPreviewRefresh));
$('chartAddBtn').addEventListener('click', chartApply);
$('chartCloseBtn').addEventListener('click', () => { $('chartDialog').classList.add('hidden'); chartEditCtx = null; });
$('chartToolBtn').addEventListener('click', () => chartOpen(null));

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
    } else if (el.type === 'image' && el._src){
      const fileId = 'f' + el.id;
      files[fileId] = {
        mimeType: el._src.startsWith('data:image/png') ? 'image/png' : 'image/jpeg',
        id: fileId, dataURL: el._src, created: 1,
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
  if (skipped) showHint(`${skipped} icon/art element(s) skipped: Excalidraw has no equivalent (photos export as photos)`);
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
          el._src = f.dataURL; el.w = ex.width; el.h = ex.height;
          internImage(el);
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

/* ── carousel export: every page as a numbered PNG in one .zip ──
   Zero dependencies: the ZIP is written by hand (store method, no
   compression — PNGs are already compressed). */
function crc32(data){
  if (!crc32.table){
    crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++){
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crc32.table[n] = c;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) c = crc32.table[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function buildZip(files){ // files: [{name, data: Uint8Array}]
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const u16 = v => [v & 255, (v >> 8) & 255];
  const u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const f of files){
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const head = new Uint8Array([
      0x50, 0x4B, 0x03, 0x04, ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(dosTime), ...u16(dosDate), ...u32(crc),
      ...u32(f.data.length), ...u32(f.data.length),
      ...u16(name.length), ...u16(0)]);
    chunks.push(head, name, f.data);
    central.push(new Uint8Array([
      0x50, 0x4B, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(dosTime), ...u16(dosDate), ...u32(crc),
      ...u32(f.data.length), ...u32(f.data.length),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset)]), name);
    offset += head.length + name.length + f.data.length;
  }
  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  const eocd = new Uint8Array([
    0x50, 0x4B, 0x05, 0x06, ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length),
    ...u32(cdSize), ...u32(offset), ...u16(0)]);
  return new Blob([...chunks, ...central, eocd], { type: 'application/zip' });
}
function renderPagePNGBlob(elements, transparent){
  return new Promise(resolve => {
    const off = document.createElement('canvas');
    const octx = off.getContext('2d');
    const board = state.board;
    if (board){
      off.width = board.w; off.height = board.h;
      renderScene(octx, elements, {
        width: board.w, height: board.h,
        camera: { x: -board.x, y: -board.y, z: 1 },
        pal: pal(), transparent, bg: effectiveBg(),
        grid: transparent ? false : state.grid, gridSize: gsize(),
        gridColor: effectiveGridColor(),
      });
    } else {
      const b = sceneBounds(elements);
      if (!b){ resolve(null); return; }
      const pad = 72, maxDim = 8000;
      const scale = Math.min(2, maxDim / (b.w + pad*2), maxDim / (b.h + pad*2));
      off.width = Math.ceil((b.w + pad*2) * scale);
      off.height = Math.ceil((b.h + pad*2) * scale);
      renderScene(octx, elements, {
        width: off.width, height: off.height,
        camera: { x: (pad - b.x) * scale, y: (pad - b.y) * scale, z: scale },
        pal: pal(), grid: false, transparent, bg: effectiveBg(),
      });
    }
    off.toBlob(resolve, 'image/png');
  });
}
async function exportAllPages(){
  syncPageRef();
  const docname = (localStorage.getItem('asterisk.docname') || 'koralpaper')
    .replace(/[\/\\:*?"<>|]/g, '-');
  const files = [];
  const pad = state.pages.length > 9 ? 2 : 1;
  for (let i = 0; i < state.pages.length; i++){
    const blob = await renderPagePNGBlob(visibleEls(state.pages[i].elements), false);
    if (!blob) continue; // empty page — skipped
    files.push({
      name: `${String(i + 1).padStart(pad, '0')}-${(state.pages[i].name || 'page').replace(/[\/\\:*?"<>|]/g, '-')}.png`,
      data: new Uint8Array(await blob.arrayBuffer()),
    });
  }
  if (!files.length){ alert('Nothing to export yet — draw something first.'); return; }
  download(`${docname}-pages.zip`, URL.createObjectURL(buildZip(files)));
  showHint(`Exported ${files.length} page${files.length > 1 ? 's' : ''} as PNGs${state.board ? ` at ${state.board.w}×${state.board.h}` : ''}`);
}

/* ── copy to clipboard: selection (or page) as PNG / SVG ── */
async function copyAsPNG(){
  const els = state.selection.size ? selected() : visibleEls(state.elements);
  if (!els.length){ showHint('Nothing to copy: the page is empty'); return; }
  try {
    const b = sceneBounds(els);
    const pad = 24, maxDim = 8000;
    const scale = Math.min(2, maxDim / (b.w + pad*2), maxDim / (b.h + pad*2));
    const off = document.createElement('canvas');
    off.width = Math.ceil((b.w + pad*2) * scale);
    off.height = Math.ceil((b.h + pad*2) * scale);
    renderScene(off.getContext('2d'), els, {
      width: off.width, height: off.height,
      camera: { x: (pad - b.x) * scale, y: (pad - b.y) * scale, z: scale },
      pal: pal(), grid: false, transparent: false, bg: effectiveBg(),
    });
    const blob = await new Promise(res => off.toBlob(res, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    showHint(state.selection.size ? 'Selection copied as PNG: paste it anywhere' : 'Page copied as PNG: paste it anywhere');
  } catch (e){
    showHint('Clipboard image copy is not available in this browser');
  }
}
async function copyAsSVG(){
  const els = state.selection.size ? selected() : visibleEls(state.elements);
  if (!els.length){ showHint('Nothing to copy: the page is empty'); return; }
  const svg = renderSceneSVG(els, {
    pal: pal(), transparent: true, bg: effectiveBg(), board: null, grid: false,
  });
  if (!svg){ showHint('Nothing to copy: the page is empty'); return; }
  try {
    await navigator.clipboard.writeText(svg);
    showHint('Copied as SVG markup: paste into Figma, a code editor, or a .svg file');
  } catch (e){
    showHint('Clipboard copy is not available in this browser');
  }
}

function exportSVG(transparent){
  const board = state.board;
  const svg = renderSceneSVG(visibleEls(state.elements), {
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
  if (replaying){ ev.preventDefault(); stopReplay(); return; }
  if (presenting){
    const kk = ev.key;
    if (kk === 'Escape'){ ev.preventDefault(); exitPresent(); return; }
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(kk)){
      ev.preventDefault(); presentGo(1); return; }
    if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(kk)){
      ev.preventDefault(); presentGo(-1); return; }
    if (kk === 'Home'){ ev.preventDefault(); switchPage(0); presentFit(); syncPresentBar(); return; }
    if (kk === 'End'){ ev.preventDefault(); switchPage(state.pages.length - 1); presentFit(); syncPresentBar(); return; }
    return; // the show swallows every other key
  }
  if (editing || ev.target === editorEl || ev.target.tagName === 'INPUT') {
    if (ev.key === ' ') return;
    return;
  }
  const mod = ev.metaKey || ev.ctrlKey;
  const k = ev.key.toLowerCase();

  if (ev.key === ' '){ spaceDown = true; canvas.classList.add('tool-hand'); return; }

  if (mod && k === 'z'){ ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y'){ ev.preventDefault(); redo(); return; }
  if (mod && k === 'a'){ ev.preventDefault(); setSelection(new Set(visibleEls(state.elements).map(e => e.id))); setTool('select'); return; }
  if (mod && ev.altKey && k === 'c'){ ev.preventDefault(); copyStyle(); return; }
  if (mod && ev.altKey && k === 'v'){ ev.preventDefault(); pasteStyle(); return; }
  if (mod && ev.altKey && k === 'n'){ ev.preventDefault(); newDocument(); return; }
  if (mod && ev.shiftKey && k === 'p'){ ev.preventDefault(); enterPresent(); return; }
  if (mod && ev.shiftKey && k === 'c'){ ev.preventDefault(); copyAsPNG(); return; }
  if (mod && k === 'c'){ ev.preventDefault(); copySelection(); return; }
  if (mod && k === 'x'){ ev.preventDefault(); copySelection(); deleteSelection(); return; }
  if (mod && k === 'v'){ return; } // handled by the 'paste' event (supports images)
  if (mod && k === 'd'){ ev.preventDefault(); duplicateSelection(); return; }
  if (mod && k === 'g'){ ev.preventDefault(); ev.shiftKey ? ungroupSelection() : groupSelection(); return; }
  if (mod && k === 'b'){ ev.preventDefault(); applyTextFormat('b'); return; }
  if (mod && !ev.shiftKey && k === 'i'){ ev.preventDefault(); applyTextFormat('i'); return; }
  if (mod && ev.shiftKey && k === 'h'){ ev.preventDefault(); applyTextFormat('hl', defaults.hlColor); return; }
  if (mod && k === 's'){ ev.preventDefault(); saveJSON(); return; }
  if (mod && k === 'o'){ ev.preventDefault(); fileInput.click(); return; }
  if (mod) return;

  if (ev.key === 'Tab'){
    ev.preventDefault();               // the canvas never gives up focus
    tabCreate(ev.shiftKey);
    return;
  }
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
      commitCoalesced('nudge'); requestRender();
    }
    return;
  }
  if (k === 'i' && !ev.shiftKey){ $('imgInput').click(); return; }
  if (k === 'b' && !ev.shiftKey){ chartOpen(null); return; }
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

/* ── the KoralPaper tour ── the built-in demo document ──────────
   Same content as examples/koralpaper-tour.json, embedded so it loads
   from file:// with zero network. Cloned on load, so it can be re-added. */
const TOUR_DOC = {"elements": [{"id": "4ednew2jmjns", "type": "icon", "x": 70, "y": 48, "w": 96, "h": 96, "angle": 0, "seed": 488436088, "stroke": "ink", "fill": "coral", "fillStyle": "solid", "dash": "solid", "sw": 3.3, "sketch": 1, "round": 1, "opacity": 100, "text": "", "font": "sans", "size": 21, "align": "center", "groupId": null, "kind": "paperthought"}, {"id": "49djzuytmjns", "type": "text", "x": 195, "y": 52, "w": 310.28125, "h": 83, "angle": 0, "seed": 1599755736, "stroke": "ink", "fill": "none", "fillStyle": "solid", "dash": "solid", "sw": 3.3, "sketch": 1, "round": 1, "opacity": 100, "text": "KoralPaper", "font": "serif", "size": 64, "align": "left", "groupId": null}, {"id": "o0t5ssgsmjnw", "type": "text", "x": 199, "y": 138, "w": 553.7396850585938, "h": 29, "angle": 0, "seed": 177560681, "stroke": "gmid", "fill": "none", "fillStyle": "solid", "dash": "solid", "sw": 3.3, "sketch": 1, "round": 1, "opacity": 100, "text": "Draw your thinking \u2014 every feature on this page is real.", "font": "sans", "size": 22, "align": "left", "groupId": null}, {"id": "6u0tkkmwmjnw", "type": "rect", "x": 90, "y": 300, "w": 250, "h": 120, "angle": 0, "seed": 1351053469, "stroke": "ink", "fill": "cream", "fillStyle": "solid", "dash": "solid", "sw": 3.3, "sketch": 1, "round": 1, "opacity": 100, "text": "Hello, world", "font": "sans", "size": 24, "align": "center", "groupId": null}, {"id": "dir1v0ezmjnw", "type": "diamond", "x": 520, "y": 280, "w": 250, "h": 160, "angle": 0, "seed": 868359191, "stroke": "ink", "fill": "periwinkle", "fillStyle": "solid", "dash": "solid", "sw": 3.3, "sketch": 1, "round": 1, "opacity": 100, "text": "Wobbly?", "font": "sans", "size": 22, "align": "center", "groupId": null}, {"id": "ctocinljmjnw", "type": "rect", "x": 950, "y": 470, "w": 250, "h": 120, "angle": 0, "seed": 314726289, "stroke": "ink", "fill": "sage", "fillStyle": "solid", "dash": "solid", "sw": 3.3, "sketch": 1, "round": 1, "opacity": 100, "text": "Ship it \u2733", "font": "sans", "size": 24, "align": "center", "groupId": null}, {"id": "v6olo8tfmjnw", "type": "rect", "x": 950, "y": 130, "w": 250, "h": 100, "angle": 0, "seed": 219892050, "stroke": "ink", "fill": "none", "fillStyle": "solid", "dash": "solid", "sw": 2, "sketch": 0, "round": 0, "opacity": 100, "text": "Neat mode exists too", "font": "sans", "size": 18, "align": "center", "groupId": null}, {"id": "7pcu83nwmjnw", "type": "arrow", "x": 347, "y": 360, "w": 166, "h": 0, "angle": 0, "seed": 98815248, "stroke": "coral", "fill": "none", "fillStyle": "solid", "dash": "solid", "sw": 3.3, "sketch": 1, "round": 1, "opacity": 100, "text": "glued + labeled", "font": "sans", "size": 16, "align": "center", "groupId": null, "points": [[0, 0], [166, 0]], "curve": 0.2, "elbow": false, "elbowPts": null, "startHead": "none", "endHead": "arrow", "startBind": "6u0tkkmwmjnw", "endBind": "dir1v0ezmjnw", "startAnchor": "e", "endAnchor": "w"}, {"id": "r8jnvqzhmjnw", "type": "arrow", "x": 645, "y": 447, "w": 298, "h": 83, "angle": 0, "seed": 775950949, "stroke": "ink", "fill": "none", "fillStyle": "solid", "dash": "solid", "sw": 2, "sketch": 1, "round": 1, "opacity": 100, "text": "yes", "font": "sans", "size": 16, "align": "center", "groupId": null, "points": [[0, 0], [298, 83]], "curve": 0, "elbow": true, "elbowPts": null, "startHead": "none", "endHead": "arrow", "startBind": "dir1v0ezmjnw", "endBind": "ctocinljmjnw", "startAnchor": "s", "endAnchor": "w"}, {"id": "0gi37a46mjnw", "type": "arrow", "x": 645, "y": 180, "w": 298, "h": 93, "angle": 0, "seed": 46787742, "stroke": "gdark", "fill": "none", "fillStyle": "solid", "dash": "dashed", "sw": 2, "sketch": 1, "round": 1, "opacity": 100, "text": "no", "font": "sans", "size": 16, "align": "center", "groupId": null, "points": [[0, 93], [298, 0]], "curve": 0, "elbow": false, "elbowPts": null, "startHead": "circle", "endHead": "triangle", "startBind": "dir1v0ezmjnw", "endBind": "v6olo8tfmjnw", "startAnchor": "n", "endAnchor": "w"}, {"id": "82yxylponivs", "type": "text", "x": 1360, "y": 60, "w": 376.4277648925781, "h": 25, "angle": 0, "seed": 1016531882, "stroke": "gdark", "fill": "none", "fillStyle": "solid", "dash": "solid", "sw": 3.3, "sketch": 1, "round": 1, "opacity": 100, "text": "Icon stamps + 3,000 Google Material icons", "font": "sans", "size": 19, "align": "left", "groupId": null}, {"id": "2z1rap0jnivs", "type": "icon", "x": 1360, "y": 100, "w": 64, "h": 64, "angle": 0, "seed": 985671382, "stroke": "none", "fill": "coral", "fillStyle": "solid", "dash": "solid", "sw": 3.3, "sketch": 1, "round": 1, "opacity": 100, "text": "", "font": "sans", "size": 21, "align": "center", "groupId": null, "kind": "asterisk"}, {"id": "e4h3twjnnivs", "type": "icon", "x": 1445, "y": 100, "w": 64, "h": 64, "angle": 0, "seed": 26653908, "stroke": "ink", "fill": "butter", "fillStyle": "solid", "dash": "solid", "sw": 3.3, "sketch": 1, "round": 1, "opacity": 100, "text": "", "font": "sans", "size": 21, "align": "center", "groupId": null, "kind": "star"}, {"id": "h05zl6e3nivt", "type": "icon", "x": 1530, "y": 100, "w": 64, "h": 64, "angle": 0, "seed": 504412456, "stroke": "coral", "fill": "none", "fillStyle": "solid", "dash": "solid", "sw": 3.3, "sketch": 1, "round": 1, "opacity": 100, "text": "", "font": "sans", "size": 21, "align": "center", "groupId": null, "kind": "material", "glyphName": "rocket_launch", "mpath": "m226-559 78 33q14-28 29-54t33-52l-56-11-84 84Zm142 83 114 113q42-16 90-49t90-75q70-70 109.5-155.5T806-800q-72-5-158 34.5T492-656q-42 42-75 90t-49 90Zm155-121.5q0-33.5 23-56.5t57-23q34 0 57 23t23 56.5q0 33.5-23 56.5t-57 23q-34 0-57-23t-23-56.5ZM565-220l84-84-11-56q-26 18-52 32.5T532-299l33 79Zm313-653q19 121-23.5 235.5T708-419l20 99q4 20-2 39t-20 33L538-80l-84-197-171-171-197-84 167-168q14-14 33.5-20t39.5-2l99 20q104-104 218-147t235-24ZM157-321q35-35 85.5-35.5T328-322q35 35 34.5 85.5T327-151q-25 25-83.5 43T82-76q14-103 32-161.5t43-83.5Zm57 56q-10 10-20 36.5T180-175q27-4 53.5-13.5T270-208q12-12 13-29t-11-29q-12-12-29-11.5T214-265Z"}, {"id": "o5pxp8dgnivt", "type": "icon", "x": 1615, "y": 100, "w": 64, "h": 64, "angle": 0, "seed": 1837740069, "stroke": "ink", "fill": "none", "fillStyle": "solid", "dash": "solid", "sw": 3.3, "sketch": 1, "round": 1, "opacity": 100, "text": "", "font": "sans", "size": 21, "align": "center", "groupId": null, "kind": "material", "glyphName": "lightbulb", "mpath": "M423.5-103.5Q400-127 400-160h160q0 33-23.5 56.5T480-80q-33 0-56.5-23.5ZM320-200v-80h320v80H320Zm10-120q-69-41-109.5-110T180-580q0-125 87.5-212.5T480-880q125 0 212.5 87.5T780-580q0 81-40.5 150T630-320H330Zm24-80h252q45-32 69.5-79T700-580q0-92-64-156t-156-64q-92 0-156 64t-64 156q0 54 24.5 101t69.5 79Zm126 0Z"}, {"id": "us3u3r0rnivt", "type": "icon", "x": 1700, "y": 100, "w": 64, "h": 64, "angle": 0, "seed": 2026524433, "stroke": "plum", "fill": "none", "fillStyle": "solid", "dash": "solid", "sw": 3.3, "sketch": 1, "round": 1, "opacity": 100, "text": "", "font": "sans", "size": 21, "align": "center", "groupId": null, "kind": "material", "glyphName": "favorite", "mpath": "m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Zm0-108q96-86 158-147.5t98-107q36-45.5 50-81t14-70.5q0-60-40-100t-100-40q-47 0-87 26.5T518-680h-76q-15-41-55-67.5T300-774q-60 0-100 40t-40 100q0 35 14 70.5t50 81q36 45.5 98 107T480-228Zm0-273Z"}, {"id": "ip6icl2fnivt", "type": "text", "x": 1360, "y": 230, "w": 231.9708709716797, "h": 25, "angle": 0, "seed": 236564073, "stroke": "gdark", "fill": "none", "fillStyle": "solid", "dash": "solid", "sw": 3.3, "sketch": 1, "round": 1, "opacity": 100, "text": "32 Google Fonts, grouped", "font": "sans", "size": 19, "align": "left", "groupId": null}, {"id": "cjawbwarnivt", "type": "text", "x": 1360, "y": 268, "w": 289.2780456542969, "h": 39, "angle": 0, "seed": 476534020, "stroke": "ink", "fill": "none", "fillStyle": "solid", "dash": "solid", "sw": 3.3, "sketch": 1, "round": 1, "opacity": 100, "text": "Playfair for headlines", "font": "playfair", "size": 30, "align": "left", "groupId": null}, {"id": "g3vihsvwnivv", "type": "text", "x": 1360, "y": 312, "w": 281.84503173828125, "h": 31, "angle": 0, "seed": 881635022, "stroke": "ink", "fill": "none", "fillStyle": "solid", "dash": "solid", "sw": 3.3, "sketch": 1, "round": 1, "opacity": 100, "text": "Space Grotesk for labels", "font": "spacegrotesk", "size": 24, "align": "left", "groupId": null}, {"id": "ytytyxemnivv", "type": "text", "x": 1360, "y": 352, "w": 239.66123962402344, "h": 36, "angle": 0, "seed": 868433174, "stroke": "ink", "fill": "none", "fillStyle": "solid", "dash": "solid", "sw": 3.3, "sketch": 1, "round": 1, "opacity": 100, "text": "Caveat feels handwritten", "font": "caveat", "size": 28, "align": "left", "groupId": null}, {"id": "vo8an76pnivx", "type": "text", "x": 1360, "y": 398, "w": 215.9967041015625, "h": 31, "angle": 0, "seed": 142098600, "stroke": "plum", "fill": "none", "fillStyle": "solid", "dash": "solid", "sw": 3.3, "sketch": 1, "round": 1, "opacity": 100, "text": "DOTO GOES PIXEL", "font": "doto", "size": 24, "align": "left", "groupId": null}, {"id": "5hm51jc6nivy", "type": "text", "x": 1360, "y": 480, "w": 308.540771484375, "h": 25, "angle": 0, "seed": 1081807178, "stroke": "gdark", "fill": "none", "fillStyle": "solid", "dash": "solid", "sw": 3.3, "sketch": 1, "round": 1, "opacity": 100, "text": "Six fill styles, greys & custom colors", "font": "sans", "size": 19, "align": "left", "groupId": null}, {"id": "67550eqlnivy", "type": "rect", "x": 1360, "y": 518, "w": 66, "h": 54, "angle": 0, "seed": 1112376777, "stroke": "ink", "fill": "coral", "fillStyle": "hachure", "dash": "solid", "sw": 2, "sketch": 1, "round": 1, "opacity": 100, "text": "", "font": "sans", "size": 21, "align": "center", "groupId": null}, {"id": "hdj7ikbxnivy", "type": "rect", "x": 1442, "y": 518, "w": 66, "h": 54, "angle": 0, "seed": 155990492, "stroke": "ink", "fill": "periwinkle", "fillStyle": "cross", "dash": "solid", "sw": 2, "sketch": 1, "round": 1, "opacity": 100, "text": "", "font": "sans", "size": 21, "align": "center", "groupId": null}, {"id": "2pyp3dtanivy", "type": "rect", "x": 1524, "y": 518, "w": 66, "h": 54, "angle": 0, "seed": 1559630904, "stroke": "ink", "fill": "sage", "fillStyle": "dots", "dash": "solid", "sw": 2, "sketch": 1, "round": 1, "opacity": 100, "text": "", "font": "sans", "size": 21, "align": "center", "groupId": null}, {"id": "0dg1ok4snivy", "type": "rect", "x": 1606, "y": 518, "w": 66, "h": 54, "angle": 0, "seed": 1738911614, "stroke": "ink", "fill": "butter", "fillStyle": "waves", "dash": "solid", "sw": 2, "sketch": 1, "round": 1, "opacity": 100, "text": "", "font": "sans", "size": 21, "align": "center", "groupId": null}, {"id": "vz5kccohnivy", "type": "rect", "x": 1688, "y": 518, "w": 66, "h": 54, "angle": 0, "seed": 198655483, "stroke": "ink", "fill": "blush", "fillStyle": "dense", "dash": "solid", "sw": 2, "sketch": 1, "round": 1, "opacity": 100, "text": "", "font": "sans", "size": 21, "align": "center", "groupId": null}, {"id": "y5fgfy0pnivy", "type": "rect", "x": 1770, "y": 518, "w": 66, "h": 54, "angle": 0, "seed": 1321413693, "stroke": "ink", "fill": "sky", "fillStyle": "solid", "dash": "solid", "sw": 2, "sketch": 1, "round": 1, "opacity": 100, "text": "", "font": "sans", "size": 21, "align": "center", "groupId": null}, {"id": "ir7kcfd1nivy", "type": "rect", "x": 100, "y": 800, "w": 220, "h": 130, "angle": -0.06, "seed": 1879784952, "stroke": "ink", "fill": "butter", "fillStyle": "solid", "dash": "solid", "sw": 2, "sketch": 1, "round": 1, "opacity": 100, "text": "Sticky notes!", "font": "sans", "size": 20, "align": "center", "groupId": null}, {"id": "mxn106gknivy", "type": "draw", "x": 360, "y": 828, "w": 144, "h": 44, "angle": 0, "seed": 720660386, "stroke": "coral", "fill": "none", "fillStyle": "solid", "dash": "solid", "sw": 3.3, "sketch": 1, "round": 1, "opacity": 100, "text": "", "font": "sans", "size": 16, "align": "center", "groupId": null, "points": [[0, 32], [18, 2], [36, 44], [54, 6], [72, 40], [90, 10], [108, 36], [126, 0], [144, 28]], "curve": 0, "elbow": false, "elbowPts": null, "startHead": "none", "endHead": "none", "startBind": null, "endBind": null}, {"id": "llifafkjnivy", "type": "text", "x": 360, "y": 890, "w": 74.91896057128906, "h": 22, "angle": 0, "seed": 346038499, "stroke": "gmid", "fill": "none", "fillStyle": "solid", "dash": "solid", "sw": 3.3, "sketch": 1, "round": 1, "opacity": 100, "text": "free draw", "font": "sans", "size": 17, "align": "left", "groupId": null}, {"id": "d0ox5lxxnivy", "type": "rect", "x": 560, "y": 780, "w": 320, "h": 180, "angle": 0, "seed": 2050039600, "stroke": "gmid", "fill": "none", "fillStyle": "solid", "dash": "dashed", "sw": 2, "sketch": 1, "round": 1, "opacity": 100, "text": "Drop a photo \u2192\n13 algorithmic art styles\n(stipple \u00b7 string \u00b7 one line\u2026)", "font": "sans", "size": 18, "align": "center", "groupId": null}, {"id": "xogxt423nivy", "type": "chip", "x": 980, "y": 850, "w": 205, "h": 52, "angle": 0, "seed": 513653181, "stroke": "ink", "fill": "periwinkle", "fillStyle": "solid", "dash": "solid", "sw": 2, "sketch": 1, "round": 1, "opacity": 100, "text": "Templates", "font": "sans", "size": 16, "align": "center", "groupId": null}, {"id": "uevei43snivy", "type": "chip", "x": 1205, "y": 850, "w": 205, "h": 52, "angle": 0, "seed": 19110247, "stroke": "ink", "fill": "sage", "fillStyle": "solid", "dash": "solid", "sw": 2, "sketch": 1, "round": 1, "opacity": 100, "text": "Multi-page", "font": "sans", "size": 16, "align": "center", "groupId": null}, {"id": "0pp4du5onivy", "type": "chip", "x": 1430, "y": 850, "w": 205, "h": 52, "angle": 0, "seed": 1611643190, "stroke": "ink", "fill": "blush", "fillStyle": "solid", "dash": "solid", "sw": 2, "sketch": 1, "round": 1, "opacity": 100, "text": "PNG \u00b7 SVG \u00b7 PDF", "font": "sans", "size": 16, "align": "center", "groupId": null}, {"id": "bnxfaw1nnivy", "type": "chip", "x": 1655, "y": 850, "w": 205, "h": 52, "angle": 0, "seed": 1799528250, "stroke": "ink", "fill": "butter", "fillStyle": "solid", "dash": "solid", "sw": 2, "sketch": 1, "round": 1, "opacity": 100, "text": "Excalidraw \u21c4", "font": "sans", "size": 16, "align": "center", "groupId": null}, {"id": "si2dom62nivy", "type": "text", "x": 980, "y": 800, "w": 337.4397277832031, "h": 25, "angle": 0, "seed": 1775187621, "stroke": "gdark", "fill": "none", "fillStyle": "solid", "dash": "solid", "sw": 3.3, "sketch": 1, "round": 1, "opacity": 100, "text": "Documents: pages, templates, exports", "font": "sans", "size": 19, "align": "left", "groupId": null}, {"id": "v8zqe6jlnivy", "type": "line", "x": 1360, "y": 660, "w": 0, "h": 0, "angle": 0, "seed": 1640630983, "stroke": "ink", "fill": "none", "fillStyle": "solid", "dash": "solid", "sw": 2, "sketch": 1, "round": 1, "opacity": 100, "text": "arrowheads & line labels", "font": "sans", "size": 16, "align": "center", "groupId": null, "points": [[0, 0], [440, 0]], "curve": 0, "elbow": false, "elbowPts": null, "startHead": "circle", "endHead": "triangle", "startBind": null, "endBind": null}], "board": {"name": "Tour", "w": 1920, "h": 1080, "x": 0, "y": 0}, "grid": "dots"};
function loadDemo(){
  syncPageRef();
  state.pages.push(makePage(clonePageElements(TOUR_DOC.elements), 'KoralPaper tour'));
  state.pageIndex = state.pages.length - 1;
  state.elements = state.pages[state.pageIndex].elements;
  state.board = { ...TOUR_DOC.board };
  state.grid = TOUR_DOC.grid;
  state.selection = new Set();
  updateBoundArrows(state.elements);
  preloadDocFonts();
  syncToggles(); syncBoardBtn(); buildBoardMenuSel();
  commit(); buildPageStrip(); zoomToFit(); syncPanel();
  showHint('The KoralPaper tour: every feature on this page is real');
}

/* ── platform-aware shortcut labels ─────────────────
   Every shortcut WORKS with Ctrl/Alt on Windows and Linux already;
   this makes the LABELS say so. One translator, applied at the three
   choke points: tooltips (lazily, in tipTextOf), hints, and a one-time
   boot pass over the static help card and menus. */
const IS_MAC = /Mac|iP(hone|ad|od)/.test(navigator.platform || '') || /Macintosh/.test(navigator.userAgent);
function kbdLocal(s, force){
  if ((IS_MAC && !force) || typeof s !== 'string') return s;
  return s
    .replace(/⌥⌘/g, 'Ctrl+Alt+')
    .replace(/⇧⌘/g, 'Ctrl+Shift+')
    .replace(/⌘/g, 'Ctrl+')
    .replace(/⇧(?=\S)/g, 'Shift+')
    .replace(/⇧/g, 'Shift')
    .replace(/⌥(?=\S)/g, 'Alt+')
    .replace(/⌥/g, 'Alt');
}
if (!IS_MAC){
  window.addEventListener('DOMContentLoaded', () => {
    for (const id of ['shortcutsCard', 'fileMenu', 'exportMenu']){
      const w = document.createTreeWalker($(id), NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) n.nodeValue = kbdLocal(n.nodeValue);
    }
  });
}

/* ── tooltips ───────────────────────────────────────
   Every control's `title` becomes a fast, styled tooltip: the title is
   consumed into data-tip on first hover (so the browser's slow native
   bubble never shows) and re-consumed whenever code writes a fresh
   title (grid button, page tabs, size presets all update theirs).
   A "Name — ⌘K" pattern renders the shortcut as a key chip. */
const tipEl = document.createElement('div');
tipEl.id = 'tooltip';
document.body.appendChild(tipEl);
let tipTimer = null, tipTarget = null, tipShownAt = 0;
function tipTextOf(el){
  const t = el.getAttribute('title');
  if (t){ el.dataset.tip = kbdLocal(t); el.removeAttribute('title'); }
  return el.dataset.tip || null;
}
function renderTip(text){
  tipEl.textContent = '';
  const m = text.match(/^(.*?) — ((?:[⌘⇧⌥⌃]|Ctrl\+|Shift\+|Alt\+)*(?:[A-Za-z?!0-9]{1,2}|drag))$/);
  if (m){
    tipEl.append(m[1]);
    const key = document.createElement('span');
    key.className = 'tipkey';
    key.textContent = m[2];
    tipEl.append(key);
  } else {
    tipEl.append(text.replace(/ — /g, ': '));
  }
}
function placeTip(target){
  const r = target.getBoundingClientRect();
  tipEl.style.left = '0px'; tipEl.style.top = '0px';    // reset before measuring
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  let x = r.left + r.width / 2 - w / 2;
  x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
  let y = r.bottom + 9;
  if (y + h + 8 > window.innerHeight) y = r.top - h - 9;
  tipEl.style.left = x + 'px';
  tipEl.style.top = y + 'px';
}
function hideTip(){
  clearTimeout(tipTimer); tipTimer = null;
  if (tipEl.classList.contains('show')) tipShownAt = performance.now();
  tipEl.classList.remove('show');
  tipTarget = null;
}
document.addEventListener('pointerover', ev => {
  if (ev.pointerType === 'touch') return;
  const t = ev.target.closest ? ev.target.closest('[title], [data-tip]') : null;
  if (!t || t.tagName === 'SELECT' || t.tagName === 'OPTION'){ if (tipTarget) hideTip(); return; }
  if (t === tipTarget) return;
  hideTip();
  tipTarget = t;
  // chain quickly when the user is scanning from button to button
  const delay = performance.now() - tipShownAt < 450 ? 60 : 350;
  tipTimer = setTimeout(() => {
    if (tipTarget !== t || !document.contains(t)) return;
    const text = tipTextOf(t);
    if (!text) return;
    renderTip(text);
    placeTip(t);
    tipEl.classList.add('show');
  }, delay);
}, true);
document.addEventListener('pointerout', ev => {
  if (tipTarget && !tipTarget.contains(ev.relatedTarget)) hideTip();
}, true);
document.addEventListener('pointerdown', hideTip, true);
window.addEventListener('blur', hideTip);
document.addEventListener('wheel', hideTip, { passive: true, capture: true });

/* ── mind map: fold & unfold branches ───────────────
   Right-click a shape → "Mark as mind-map root". Two persisted flags
   only (el.mindRoot, el.folded); everything else is DERIVED from the
   glued arrows at render time, so cross-links, shared children and
   later edits can never leave stale state. Rule: a node is hidden iff
   it is unreachable from the root once folded branches are cut — a
   shared child stays visible while any expanded path reaches it.
   Fold badges: − to fold, +N shows how many nodes a click reveals. */
function mindChildrenMap(els){
  const shapes = new Set(els.filter(e => !isLinear(e)).map(e => e.id));
  const out = new Map();
  for (const a of els)
    if (a.type === 'arrow' && a.startBind && a.endBind && a.startBind !== a.endBind &&
        shapes.has(a.startBind) && shapes.has(a.endBind)){
      if (!out.has(a.startBind)) out.set(a.startBind, []);
      out.get(a.startBind).push(a.endBind);
    }
  return out;
}
function mindInfoFor(els){
  const root = els.find(e => e.mindRoot);
  if (!root) return null;
  const byIdL = new Map(els.map(e => [e.id, e]));
  const out = mindChildrenMap(els);
  const bfs = stopAtFolded => {
    const seen = new Set([root.id]);
    const q = [root.id];
    while (q.length){
      const id = q.shift();
      const el = byIdL.get(id);
      if (stopAtFolded && el && el.folded) continue;
      for (const c of out.get(id) || [])
        if (!seen.has(c)){ seen.add(c); q.push(c); }
    }
    return seen;
  };
  const visible = bfs(true);
  const component = bfs(false);
  const hidden = new Set();
  for (const id of component) if (!visible.has(id)) hidden.add(id);
  for (const a of els){
    if (!(a.type === 'arrow' || a.type === 'line')) continue;
    if (hidden.has(a.startBind) || hidden.has(a.endBind)) hidden.add(a.id);
    else if (a.type === 'arrow' && a.startBind && a.endBind){
      const src = byIdL.get(a.startBind);
      if (src && src.folded && component.has(a.endBind)) hidden.add(a.id);
    }
  }
  return { root, out, hidden, byIdL, component, visible };
}
function visibleEls(els){
  const info = mindInfoFor(els);
  if (!info || !info.hidden.size) return els;
  return els.filter(e => !info.hidden.has(e.id));
}
function mindRevealCount(info, nodeId){
  // how many nodes appear if THIS node unfolds (not descending into
  // still-folded descendants — their branches stay put, as remembered)
  const seen = new Set([nodeId]);
  const q = [nodeId];
  let count = 0;
  while (q.length){
    const id = q.shift();
    const el = info.byIdL.get(id);
    if (id !== nodeId && el && el.folded) continue;
    for (const c of info.out.get(id) || [])
      if (!seen.has(c)){
        seen.add(c);
        if (info.hidden.has(c)) count++;
        q.push(c);
      }
  }
  return count;
}
function mindBadgesFor(els){
  const info = mindInfoFor(els);
  if (!info) return [];
  const z = state.camera.z;
  const r = Math.max(9 / z, 7);
  const badges = [];
  for (const el of els){
    if (isLinear(el) || info.hidden.has(el.id)) continue;
    const kids = info.out.get(el.id) || [];
    if (!kids.length) continue;
    // badge sits just outside the edge the branch leaves from
    let dx = 0, dy = 0;
    for (const cid of kids){
      const c = info.byIdL.get(cid);
      if (c){ dx += (c.x + c.w / 2) - (el.x + el.w / 2); dy += (c.y + c.h / 2) - (el.y + el.h / 2); }
    }
    const horiz = Math.abs(dx) >= Math.abs(dy);
    const b = boundsOf(el);
    const bx = horiz ? (dx >= 0 ? b.x + b.w + r + 5 / z : b.x - r - 5 / z) : b.x + b.w / 2;
    const by = horiz ? b.y + b.h / 2 : (dy >= 0 ? b.y + b.h + r + 5 / z : b.y - r - 5 / z);
    badges.push({ id: el.id, x: bx, y: by, r,
      folded: !!el.folded,
      count: el.folded ? mindRevealCount(info, el.id) : 0 });
  }
  return badges;
}
function mindBadgeAt(sx, sy){
  for (const b of mindBadgesFor(state.elements))
    if (Math.hypot(sx - b.x, sy - b.y) <= b.r * 1.5) return b;
  return null;
}
function mindToggle(id){
  const el = byId(id);
  if (!el) return;
  el.folded = !el.folded;
  commit(); requestRender();
}
function mindClearPage(){
  for (const el of state.elements){ delete el.mindRoot; delete el.folded; }
  commit(); requestRender();
  showHint('Mind map unmarked: every branch is visible again');
}

/* ── Claude link: the MCP bridge client ─────────────
   When the KoralPaper MCP extension runs inside Claude Desktop it
   opens a tiny bridge on 127.0.0.1:8137. The app long-polls it;
   Claude's tool calls arrive as commands, results go back, and the
   ✳ indicator lights up while the link is alive. Everything Claude
   draws lands as ordinary elements — editable, undoable (one ⌘Z per
   command), saved like anything else. */
const CLAUDE_BRIDGE = 'http://127.0.0.1:8137';
let claudeLinked = false;

function setClaudeLinked(on){
  if (on === claudeLinked) return;
  claudeLinked = on;
  $('claudeLinkBtn').classList.toggle('hidden', !on);
  const s = $('claudeTabStatus');
  if (s){
    s.textContent = on ? 'Linked: Claude Desktop can draw on this paper right now.'
      : 'Not linked. Install the extension and keep Claude Desktop open, then this page links automatically.';
    s.classList.toggle('on', on);
  }
}

function claudeColor(v, keys, fallback){
  if (typeof v !== 'string') return fallback;
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v;
  const k = v.toLowerCase().replace('black', 'ink');
  return keys.includes(k) ? k : fallback;
}
function claudeBuildElement(spec, idMap){
  const kind = ['rect', 'diamond', 'ellipse', 'chip', 'text', 'arrow', 'line'].includes(spec.type)
    ? spec.type : 'rect';
  const style = {
    stroke: claudeColor(spec.stroke, STROKE_KEYS, 'ink'),
    fill: claudeColor(spec.fill, FILL_KEYS,
      kind === 'text' || kind === 'arrow' || kind === 'line' ? 'none' : defaults.fillByType[kind] || 'none'),
    fillStyle: ['solid', 'hachure', 'dense', 'cross', 'dots', 'waves'].includes(spec.fillStyle) ? spec.fillStyle : 'solid',
    dash: ['solid', 'dotted', 'dashed'].includes(spec.dash) ? spec.dash : 'solid',
    sw: widths.medium, sketch: spec.sketch === 0 ? 0 : 1, round: 1, opacity: 100,
    font: (typeof spec.font === 'string' && FONTS[spec.font]) ? spec.font : 'sans',
    size: Number(spec.size) > 0 ? clamp(Number(spec.size), 8, 160)
      : (kind === 'chip' || kind === 'arrow' || kind === 'line' ? 16 : 21),
    align: ['left', 'center', 'right'].includes(spec.align) ? spec.align : (kind === 'text' ? 'left' : 'center'),
    lh: typo.lh, pgap: typo.pgap, lspace: typo.lspace, valign: 'middle',
  };
  if (spec.textColor) style.textColor = claudeColor(spec.textColor, STROKE_KEYS, null);
  const x = Number(spec.x) || 0, y = Number(spec.y) || 0;
  const el = newElement(kind, x, y, style);
  el.x = x; el.y = y;
  if (kind === 'arrow' || kind === 'line'){
    el.curve = 0;
    el.elbow = !!spec.elbow;
    el.startHead = 'none';
    el.endHead = kind === 'arrow' ? 'arrow' : 'none';
    const fromId = spec.from && idMap.get(String(spec.from));
    const toId = spec.to && idMap.get(String(spec.to));
    if (fromId && toId && fromId !== toId){
      el.startBind = fromId; el.endBind = toId;
      el.points = [[0, 0], [10, 0]];
    } else {
      const x2 = Number(spec.x2), y2 = Number(spec.y2);
      el.points = [[0, 0], [isNaN(x2) ? 160 : x2 - x, isNaN(y2) ? 0 : y2 - y]];
    }
    el.text = typeof spec.text === 'string' ? spec.text : '';
  } else {
    const defSize = { rect: [190, 92], diamond: [170, 120], ellipse: [160, 110], chip: [140, 40] }[kind];
    el.w = Number(spec.w) > 0 ? Number(spec.w) : (defSize ? defSize[0] : 120);
    el.h = Number(spec.h) > 0 ? Number(spec.h) : (defSize ? defSize[1] : 60);
    el.text = typeof spec.text === 'string' ? spec.text : '';
    if (kind === 'text') autosizeText(el);
  }
  if (spec.id) idMap.set(String(spec.id), el.id);
  return el;
}
function claudeCompact(el){
  const c = { id: el.id, type: el.type, x: Math.round(el.x), y: Math.round(el.y),
    w: Math.round(el.w), h: Math.round(el.h) };
  if (el.text) c.text = el.text;
  if (el.stroke && el.stroke !== 'ink') c.stroke = el.stroke;
  if (el.fill && el.fill !== 'none') c.fill = el.fill;
  if (el.type === 'arrow' || el.type === 'line'){
    if (el.startBind) c.from = el.startBind;
    if (el.endBind) c.to = el.endBind;
  }
  if (el.type === 'icon') c.icon = el.kind;
  if (el.textColor) c.textColor = el.textColor;
  if (el.mindRoot) c.mindRoot = true;
  if (el.folded) c.folded = true;
  return c;
}

async function claudeExecute(action, args){
  if (action === 'read_document'){
    syncPageRef();
    return {
      board: state.board ? { w: state.board.w, h: state.board.h, name: state.board.name } : null,
      theme: state.theme,
      pages: state.pages.map((p, i) => ({
        name: p.name, current: i === state.pageIndex,
        elements: p.elements.map(claudeCompact),
      })),
    };
  }
  if (action === 'create_page'){
    const specs = Array.isArray(args.elements) ? args.elements : [];
    if (!specs.length) return { error: 'No elements given.' };
    syncPageRef();
    const idMap = new Map();
    const shapes = specs.filter(s => s.type !== 'arrow' && s.type !== 'line');
    const linears = specs.filter(s => s.type === 'arrow' || s.type === 'line');
    const els = shapes.map(s => claudeBuildElement(s, idMap))
      .concat(linears.map(s => claudeBuildElement(s, idMap)));
    state.pages.push(makePage(els, typeof args.name === 'string' && args.name.trim() ? args.name.trim() : 'Claude page'));
    state.pageIndex = state.pages.length - 1;
    state.elements = state.pages[state.pageIndex].elements;
    state.selection = new Set();
    if (args.board && Number(args.board.w) > 0 && Number(args.board.h) > 0){
      state.board = { name: args.board.name || 'Custom', w: Number(args.board.w), h: Number(args.board.h), x: 0, y: 0 };
    }
    if (typeof args.paper === 'string' && args.paper[0] === '#') state.bgColor = args.paper;
    updateBoundArrows(state.elements);
    preloadDocFonts();
    syncToggles(); syncBoardBtn(); buildBoardMenuSel(); syncPaperUI();
    commit(); buildPageStrip(); zoomToFit(); syncPanel();
    showHint('Claude drew a new page: every element is fully editable');
    return { ok: true, page: state.pages[state.pageIndex].name,
      ids: Object.fromEntries(idMap), elements: state.elements.length };
  }
  if (action === 'add_elements'){
    const specs = Array.isArray(args.elements) ? args.elements : [];
    if (!specs.length) return { error: 'No elements given.' };
    const idMap = new Map();
    for (const el of state.elements) idMap.set(el.id, el.id); // arrows may bind existing shapes
    const shapes = specs.filter(s => s.type !== 'arrow' && s.type !== 'line');
    const linears = specs.filter(s => s.type === 'arrow' || s.type === 'line');
    for (const s of shapes) state.elements.push(claudeBuildElement(s, idMap));
    for (const s of linears) state.elements.push(claudeBuildElement(s, idMap));
    updateBoundArrows(state.elements);
    preloadDocFonts();
    commit(); requestRender(); syncPanel();
    showHint('Claude added to this page');
    return { ok: true, ids: Object.fromEntries(idMap), elements: state.elements.length };
  }
  if (action === 'update_elements'){
    const ups = Array.isArray(args.updates) ? args.updates : [];
    let touched = 0;
    for (const u of ups){
      const el = byId(String(u.id));
      if (!el) continue;
      touched++;
      if (u.x !== undefined) el.x = Number(u.x) || el.x;
      if (u.y !== undefined) el.y = Number(u.y) || el.y;
      if (u.w !== undefined && Number(u.w) > 0) el.w = Number(u.w);
      if (u.h !== undefined && Number(u.h) > 0) el.h = Number(u.h);
      if (u.text !== undefined){ el.text = String(u.text); delete el.runs; }
      if (u.stroke !== undefined) el.stroke = claudeColor(u.stroke, STROKE_KEYS, el.stroke);
      if (u.fill !== undefined) el.fill = claudeColor(u.fill, FILL_KEYS, el.fill);
      if (u.fillStyle !== undefined && ['solid','hachure','dense','cross','dots','waves'].includes(u.fillStyle)) el.fillStyle = u.fillStyle;
      if (u.dash !== undefined && ['solid','dotted','dashed'].includes(u.dash)) el.dash = u.dash;
      if (u.size !== undefined && Number(u.size) > 0) el.size = clamp(Number(u.size), 8, 160);
      if (u.font !== undefined && FONTS[u.font]) el.font = u.font;
      if (u.align !== undefined && ['left','center','right'].includes(u.align)) el.align = u.align;
      if (u.textColor !== undefined) el.textColor = (!u.textColor || u.textColor === 'auto') ? null : claudeColor(u.textColor, STROKE_KEYS, el.textColor);
      if (u.folded !== undefined) el.folded = !!u.folded;
      if (u.mindRoot !== undefined){
        if (u.mindRoot) for (const other of state.elements) delete other.mindRoot;
        el.mindRoot = !!u.mindRoot;
        if (!u.mindRoot) delete el.mindRoot;
      }
      if (u.sketch !== undefined) el.sketch = u.sketch === 0 ? 0 : 1;
      if (el.type === 'text') autosizeText(el);
      delete el._prims; delete el._pkey;
    }
    if (!touched) return { error: 'No matching element ids on the current page.' };
    updateBoundArrows(state.elements);
    preloadDocFonts();
    commit(); requestRender(); syncPanel();
    return { ok: true, updated: touched };
  }
  if (action === 'delete_elements'){
    const ids = new Set((Array.isArray(args.ids) ? args.ids : []).map(String));
    const before = state.elements.length;
    state.elements = state.elements.filter(e => !ids.has(e.id));
    state.pages[state.pageIndex].elements = state.elements;
    state.selection = new Set();
    updateBoundArrows(state.elements);
    commit(); requestRender(); syncPanel();
    return { ok: true, deleted: before - state.elements.length };
  }
  if (action === 'render_page'){
    const blob = await renderPagePNGBlob(state.elements, false);
    if (!blob) return { error: 'The current page is empty.' };
    // downscale for the eye check — Claude needs layout, not print quality
    const img = await createImageBitmap(blob);
    const scale = Math.min(1, 1100 / img.width);
    const off = document.createElement('canvas');
    off.width = Math.round(img.width * scale);
    off.height = Math.round(img.height * scale);
    off.getContext('2d').drawImage(img, 0, 0, off.width, off.height);
    const dataUrl = off.toDataURL('image/png');
    return { png: dataUrl.slice(dataUrl.indexOf(',') + 1),
      note: `Current page "${state.pages[state.pageIndex].name}", ${state.elements.length} elements.` };
  }
  return { error: 'Unknown action: ' + action };
}

async function claudePollLoop(){
  for (;;){
    try {
      // quick status ping first: the long-poll below holds ~25s, and the
      // ✳ indicator should light up within a second of the bridge appearing
      const s = await fetch(CLAUDE_BRIDGE + '/status');
      if (!s.ok) throw new Error('bridge');
      setClaudeLinked(true);
      const r = await fetch(CLAUDE_BRIDGE + '/poll', { headers: { 'X-Koralpaper': '1' } });
      if (!r.ok) throw new Error('bridge');
      const cmds = await r.json();
      for (const c of cmds){
        let result;
        try { result = await claudeExecute(c.action, c.args); }
        catch (e){ result = { error: String(e && e.message || e) }; }
        await fetch(CLAUDE_BRIDGE + '/result', {
          method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-Koralpaper': '1' },
          body: JSON.stringify({ id: c.id, result }),
        });
      }
    } catch (e){
      setClaudeLinked(false);
      await new Promise(res => setTimeout(res, 4000));
    }
  }
}
claudePollLoop();

/* ── share as a self-contained web page ─────────────
   One .html file, zero dependencies: every page becomes an inline SVG
   (images ride along as data URLs, Google fonts arrive via each SVG's
   own @import when online, system fallbacks offline) plus a tiny
   built-in viewer with page navigation. Send it to anyone — it opens
   in any browser with no app, no server, no account. */
function shareHTML(){
  syncPageRef();
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const docname = (localStorage.getItem('asterisk.docname') || 'koralpaper-sketch');
  const pages = [];
  for (const p of state.pages){
    const svg = renderSceneSVG(visibleEls(p.elements), {
      pal: pal(), transparent: false, bg: effectiveBg(),
      board: state.board, grid: state.board ? state.grid : false,
      gridColor: effectiveGridColor(), gridSize: gsize(),
    });
    if (svg) pages.push({ name: p.name || 'Page', svg });
  }
  if (!pages.length){ alert('Nothing to share yet — draw something first.'); return; }
  const sections = pages.map((p, i) =>
    `<section class="pg${i === 0 ? ' cur' : ''}" data-name="${esc(p.name)}">${p.svg}</section>`).join('\n');
  const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(docname)} · KoralPaper</title>
<style>
  :root{color-scheme:dark}
  *{margin:0;box-sizing:border-box}
  body{min-height:100vh;background:#24221E;color:#ECE7DA;
    font:14px/1.5 -apple-system,'Segoe UI',Roboto,sans-serif;
    display:flex;flex-direction:column;align-items:center}
  header{width:100%;display:flex;justify-content:space-between;align-items:baseline;
    padding:16px 22px 6px;opacity:.85}
  header .t{font-size:15px;font-weight:600}
  header .n{font-size:12.5px;opacity:.75}
  main{flex:1;width:100%;display:flex;align-items:center;justify-content:center;padding:10px 20px}
  .pg{display:none}
  .pg.cur{display:block}
  .pg svg{max-width:min(1400px,94vw);max-height:80vh;width:auto;height:auto;
    border-radius:10px;box-shadow:0 24px 60px -20px rgba(0,0,0,.7)}
  nav{display:flex;align-items:center;gap:8px;padding:10px 0 6px}
  nav button{background:#3A362F;border:none;color:#ECE7DA;font-size:17px;line-height:1;
    padding:7px 14px;border-radius:99px;cursor:pointer}
  nav button:disabled{opacity:.3;cursor:default}
  nav .c{font-size:12.5px;letter-spacing:.4px;min-width:52px;text-align:center;opacity:.85}
  footer{padding:8px 0 18px;font-size:12px;opacity:.6;text-align:center}
  footer a{color:#E4906F;text-decoration:none}
</style>
<header><span class="t">${esc(docname)}</span><span class="n" id="pn"></span></header>
<main>
${sections}
</main>
<nav id="nav"><button id="pv">‹</button><span class="c" id="ct"></span><button id="nx">›</button></nav>
<footer>Made with <b>KoralPaper</b> · a creation by Stefanos Karagos, CAIO Group ·
  <a href="https://wearecaio.com">wearecaio.com</a> ·
  <a href="https://github.com/karagos/koralpaper">get the app</a></footer>
<script>
var pgs=[].slice.call(document.querySelectorAll('.pg')),i=0;
function show(n){i=Math.max(0,Math.min(n,pgs.length-1));
  pgs.forEach(function(p,j){p.classList.toggle('cur',j===i)});
  document.getElementById('ct').textContent=(i+1)+' / '+pgs.length;
  document.getElementById('pn').textContent=pgs[i].dataset.name;
  document.getElementById('pv').disabled=i===0;
  document.getElementById('nx').disabled=i===pgs.length-1;}
document.getElementById('pv').onclick=function(){show(i-1)};
document.getElementById('nx').onclick=function(){show(i+1)};
addEventListener('keydown',function(e){
  if(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown')show(i+1);
  if(e.key==='ArrowLeft'||e.key==='PageUp')show(i-1);
  if(e.key==='Home')show(0); if(e.key==='End')show(pgs.length-1);});
if(pgs.length<2)document.getElementById('nav').style.display='none';
show(0);
</script>`;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const safe = docname.replace(/[\/\\:*?"<>|]/g, '-');
  download(`${safe}.html`, URL.createObjectURL(blob));
  showHint(`Shared ${pages.length} page${pages.length > 1 ? 's' : ''} as one self-contained .html: send it to anyone`);
}

/* ── Tab-to-create flow diagramming ─────────────────
   With one shape selected, Tab drops a connected twin to the right
   (⇧Tab: below) — same type, same style, glued arrow, editor open and
   ready to type. Type, Tab, type, Tab: a flowchart in seconds. */
function tabOverlaps(a, b){
  const M = 24;
  return a.x < b.x + b.w + M && a.x + a.w + M > b.x &&
         a.y < b.y + b.h + M && a.y + a.h + M > b.y;
}
function tabCreate(below){
  const sel = selected();
  if (sel.length !== 1) return false;
  const src = sel[0];
  if (!['rect', 'diamond', 'ellipse', 'chip', 'icon', 'image'].includes(src.type)) return false;
  const nu = JSON.parse(JSON.stringify(src));
  nu.id = uid();
  nu.seed = Math.floor(Math.random() * 2 ** 31);
  nu.groupId = null;
  nu.text = src.type === 'image' ? (src.text || '') : '';
  delete nu._prims; delete nu._pkey;
  if (below){ nu.x = src.x; nu.y = src.y + src.h + 90; }
  else { nu.x = src.x + src.w + 110; nu.y = src.y; }
  let guard = 0;
  while (guard++ < 30 &&
         state.elements.some(e => e !== src && !isLinear(e) && tabOverlaps(nu, e))){
    if (below) nu.x += src.w + 40;
    else nu.y += src.h + 40;
  }
  state.elements.push(nu);
  const arrow = newElement('arrow', 0, 0, {
    stroke: defaults.stroke === 'none' ? 'ink' : defaults.stroke,
    sw: defaults.sw, sketch: defaults.sketch, round: defaults.round,
    opacity: 100, fillStyle: 'solid', dash: defaults.dash,
    font: defaults.font, size: 16, align: 'center',
    lh: defaults.lh, pgap: defaults.pgap, lspace: defaults.lspace, valign: defaults.valign,
  });
  arrow.curve = defaults.curve;
  arrow.elbow = !!defaults.elbow;
  arrow.startHead = 'none';
  arrow.endHead = defaults.endHead === 'none' ? 'arrow' : defaults.endHead;
  arrow.points = [[0, 0], [10, 0]];
  arrow.startBind = src.id; arrow.startAnchor = below ? 's' : 'e';
  arrow.endBind = nu.id;    arrow.endAnchor = below ? 'n' : 'w';
  state.elements.push(arrow);
  updateBoundArrows(state.elements);
  setSelection(new Set([nu.id]));
  commit(); requestRender();
  if (canHaveText(nu)) openTextEditor(nu, false);
  return true;
}

/* ── Tidy: auto-arrange the connected flow ──────────
   Shapes joined by glued arrows become a left-to-right layered graph:
   depth = longest path from the roots, one column per depth, rows
   ordered by current vertical position. Standalone elements stay put. */
function tidyLayout(){
  const pool = (state.selection.size >= 2 ? selected() : state.elements);
  const shapes = pool.filter(e => !isLinear(e) && e.type !== 'text');
  const ids = new Set(shapes.map(s => s.id));
  const edges = state.elements.filter(e => e.type === 'arrow' &&
    e.startBind && e.endBind && ids.has(e.startBind) && ids.has(e.endBind) &&
    e.startBind !== e.endBind);
  if (!edges.length){
    showHint('Tidy arranges shapes connected with glued arrows: none found');
    return;
  }
  const inFlow = new Set();
  for (const a of edges){ inFlow.add(a.startBind); inFlow.add(a.endBind); }
  const nodes = shapes.filter(s => inFlow.has(s.id));
  // depth = longest path from any root; bounded relaxation survives cycles
  const depth = new Map(nodes.map(n => [n.id, 0]));
  for (let pass = 0; pass < nodes.length + 1; pass++){
    let changed = false;
    for (const a of edges){
      const d = depth.get(a.startBind) + 1;
      if (d > depth.get(a.endBind) && d <= nodes.length){
        depth.set(a.endBind, d); changed = true;
      }
    }
    if (!changed) break;
  }
  const cols = new Map();
  for (const n of nodes){
    const d = depth.get(n.id);
    if (!cols.has(d)) cols.set(d, []);
    cols.get(d).push(n);
  }
  const box = sceneBounds(nodes);
  const GX = 120, GY = 56;
  const colW = new Map(), colH = new Map();
  for (const [d, list] of cols){
    list.sort((a, b) => a.y - b.y || a.x - b.x);
    colW.set(d, Math.max(...list.map(n => n.w)));
    colH.set(d, list.reduce((h, n) => h + n.h, 0) + GY * (list.length - 1));
  }
  const maxH = Math.max(...[...colH.values()]);
  let x = box.x;
  const depths = [...cols.keys()].sort((a, b) => a - b);
  for (const d of depths){
    const list = cols.get(d);
    let y = box.y + (maxH - colH.get(d)) / 2;
    for (const n of list){
      n.x = Math.round(x + (colW.get(d) - n.w) / 2);
      n.y = Math.round(y);
      y += n.h + GY;
    }
    x += colW.get(d) + GX;
  }
  // stale manual elbow corners would fight the new geometry, and the
  // columns flow left-to-right now — re-aim every edge east → west
  for (const a of edges){
    if (a.elbow) a.elbowPts = null;
    a.startAnchor = 'e'; a.endAnchor = 'w';
    if (depth.get(a.startBind) > depth.get(a.endBind)){
      // back-edge in a cycle: flip sides so it leaves west, returns east
      a.startAnchor = 'w'; a.endAnchor = 'e';
    }
  }
  updateBoundArrows(state.elements);
  commit(); requestRender(); syncPanel();
  showHint(`Tidied ${nodes.length} shapes into ${depths.length} columns`);
}

/* ── draw-on replay + animated export ───────────────
   Replays the current page as if a hand were drawing it: freehand
   strokes reveal point by point, arrows sweep out from their start
   (an expanding clip — works for straight, curved and elbow routes),
   shapes and text ink in with a fade-and-settle. Optionally records
   the animation to a .webm via MediaRecorder — still zero deps. */
let replaying = null;
const rpEase = p => 1 - Math.pow(1 - p, 3);
function rpSchedule(els){
  const times = [];
  let t = 0;
  for (const el of els){
    const linear = Array.isArray(el.points) && el.points.length > 1;
    const dur = linear ? 520 : 340;
    times.push({ start: t, dur });
    t += linear ? 300 : 210;   // overlap: the next element starts early
  }
  const total = t + 520;
  const squeeze = Math.min(1, 20000 / total);   // cap the show at ~20s
  for (const s of times){ s.start *= squeeze; s.dur *= squeeze; }
  return { times, total: total * squeeze };
}
function rpPartialDraw(el, p){
  // freehand: reveal the real points along the path
  const pts = el.points;
  const n = Math.max(2, Math.ceil(pts.length * p));
  return { ...el, points: pts.slice(0, n) };
}
function rpFrame(ctx2, w, h, camera, els, progs){
  renderScene(ctx2, [], {
    width: w, height: h, camera, pal: pal(),
    grid: state.grid, gridSize: gsize(), bg: effectiveBg(),
    gridColor: effectiveGridColor(), board: state.board,
    outside: state.board ? (state.theme === 'light' ? '#DAD4C8' : '#12110F') : null,
  });
  const labelBg = effectiveBg();
  ctx2.save();
  ctx2.translate(camera.x, camera.y);
  ctx2.scale(camera.z, camera.z);
  for (let i = 0; i < els.length; i++){
    const p = progs[i];
    if (p <= 0) continue;
    const el = els[i];
    if (p >= 1){ drawElement(ctx2, el, pal(), labelBg); continue; }
    const e = rpEase(p);
    if (el.type === 'draw' && el.points && el.points.length > 2){
      drawElement(ctx2, rpPartialDraw(el, e), pal(), labelBg);
    } else if (Array.isArray(el.points) && el.points.length > 1){
      // arrows & lines sweep out of their start point
      const sx = el.x + el.points[0][0], sy = el.y + el.points[0][1];
      const reach = Math.hypot(el.w || 0, el.h || 0) + 80;
      ctx2.save();
      ctx2.beginPath();
      ctx2.arc(sx, sy, Math.max(6, e * reach), 0, Math.PI * 2);
      ctx2.clip();
      drawElement(ctx2, el, pal(), labelBg);
      ctx2.restore();
    } else {
      ctx2.save();
      ctx2.globalAlpha = e;
      const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
      const s = 0.94 + 0.06 * e;
      ctx2.translate(cx, cy); ctx2.scale(s, s); ctx2.translate(-cx, -cy);
      drawElement(ctx2, el, pal(), labelBg);
      ctx2.restore();
    }
  }
  ctx2.restore();
}
function replayTick(){
  if (!replaying) return;
  const now = performance.now();
  const { els, times, t0 } = replaying;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const progs = els.map((e, i) =>
    clamp((now - t0 - times[i].start) / times[i].dur, 0, 1));
  rpFrame(ctx, w, h, state.camera, els, progs);
  ctx.restore();
  const done = now - t0 > replaying.total;
  if (done && now - t0 > replaying.total + 700){ stopReplay(); return; }
  replaying.raf = requestAnimationFrame(replayTick);
}
function stopReplay(){
  if (!replaying) return;
  if (replaying.raf) cancelAnimationFrame(replaying.raf);
  if (replaying.rec && replaying.rec.state !== 'inactive') replaying.rec.stop();
  replaying = null;
  requestRender();
}
function startReplay(record){
  if (replaying) stopReplay();
  if (presenting) return;
  if (!state.elements.length){ showHint('Nothing to replay: the page is empty'); return; }
  if (editing) commitTextEdit();
  closeMenus();
  setSelection(new Set());
  zoomToFit();
  const replayEls = visibleEls(state.elements);
  const { times, total } = rpSchedule(replayEls);
  replaying = { els: replayEls, times, total,
    t0: performance.now() + 400, raf: null, rec: null };
  if (record){
    try {
      const stream = canvas.captureStream(60);
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9' : 'video/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      const chunks = [];
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const name = (localStorage.getItem('asterisk.docname') || 'koralpaper') + '-replay.webm';
        download(name, URL.createObjectURL(blob));
        showHint('Replay saved as a .webm video');
      };
      rec.start();
      replaying.rec = rec;
      showHint('Recording the replay… it saves automatically when done');
    } catch (e){
      showHint('Video recording is not available in this browser: playing the replay instead');
    }
  }
  replaying.raf = requestAnimationFrame(replayTick);
}

/* ── presentation mode + laser pen ──────────────────
   ⇧⌘P (or ☰ → Present). All chrome hides, the page fits the screen,
   ←/→/click turn pages, dragging draws a fading coral laser stroke,
   Esc ends the show. The control bar wakes on mouse move. */
let presenting = false;
let presentSaved = null;          // camera + tool to restore on exit
let presentFS = false;            // did we actually get fullscreen?
let presentIdle = null;
let laserEl = null, laserCtx2 = null, laserStrokes = [], laserRAF = null;
let laserLive = null;             // stroke being drawn right now
let presTapStart = null;          // to tell a click (next page) from a drag (laser)

function presentFit(){
  zoomToFit();
}
function syncPresentBar(){
  $('presPage').textContent = `${state.pageIndex + 1} / ${state.pages.length}`;
  $('presPrev').disabled = state.pageIndex === 0;
  $('presNext').disabled = state.pageIndex === state.pages.length - 1;
}
function presentWake(){
  $('presentBar').classList.add('awake');
  clearTimeout(presentIdle);
  presentIdle = setTimeout(() => $('presentBar').classList.remove('awake'), 2500);
}
function presentGo(delta){
  const i = clamp(state.pageIndex + delta, 0, state.pages.length - 1);
  if (i !== state.pageIndex){ switchPage(i); presentFit(); }
  syncPresentBar();
}
function drawLaser(){
  if (!presenting){ laserRAF = null; return; }
  const now = performance.now();
  const dpr = window.devicePixelRatio || 1;
  laserCtx2.clearRect(0, 0, laserEl.width, laserEl.height);
  laserCtx2.save();
  laserCtx2.scale(dpr, dpr);
  laserCtx2.lineCap = 'round'; laserCtx2.lineJoin = 'round';
  for (const s of laserStrokes){
    // each point fades out ~1s after it was drawn — the tail evaporates
    s.pts = s === laserLive ? s.pts : s.pts.filter(p => now - p.t < 1000);
    for (let i = 1; i < s.pts.length; i++){
      const p = s.pts[i], q = s.pts[i - 1];
      const age = now - p.t;
      const a = s === laserLive && i === s.pts.length - 1 ? 1 : Math.max(0, 1 - age / 1000);
      if (a <= 0) continue;
      laserCtx2.strokeStyle = `rgba(228, 87, 46, ${0.9 * a})`;
      laserCtx2.lineWidth = 3.5;
      laserCtx2.shadowColor = `rgba(228, 87, 46, ${0.55 * a})`;
      laserCtx2.shadowBlur = 7;
      laserCtx2.beginPath();
      laserCtx2.moveTo(q.x, q.y);
      laserCtx2.lineTo(p.x, p.y);
      laserCtx2.stroke();
    }
  }
  laserCtx2.restore();
  laserStrokes = laserStrokes.filter(s => s === laserLive || s.pts.length > 1);
  laserRAF = requestAnimationFrame(drawLaser);
}
function sizeLaser(){
  if (!laserEl) return;
  const dpr = window.devicePixelRatio || 1;
  laserEl.width = window.innerWidth * dpr;
  laserEl.height = window.innerHeight * dpr;
}
function enterPresent(){
  if (presenting) return;
  if (editing) commitTextEdit();
  closeMenus();
  presenting = true;
  presentSaved = { camera: { ...state.camera }, tool: state.tool };
  setSelection(new Set());
  setTool('select');
  document.body.classList.add('presenting');
  laserEl = document.createElement('canvas');
  laserEl.id = 'laser';
  document.body.appendChild(laserEl);
  laserCtx2 = laserEl.getContext('2d');
  sizeLaser();
  laserStrokes = []; laserLive = null;
  laserRAF = requestAnimationFrame(drawLaser);
  presentFit(); syncPresentBar(); presentWake();
  try {
    const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
    if (p && p.then) p.then(() => { presentFS = true; presentFit(); }, () => {});
  } catch (e){}
}
function exitPresent(){
  if (!presenting) return;
  presenting = false;
  document.body.classList.remove('presenting');
  $('presentBar').classList.remove('awake');
  clearTimeout(presentIdle);
  if (laserRAF) cancelAnimationFrame(laserRAF);
  laserRAF = null;
  if (laserEl){ laserEl.remove(); laserEl = null; laserCtx2 = null; }
  laserStrokes = []; laserLive = null;
  if (presentSaved){
    state.camera = presentSaved.camera;
    setTool(presentSaved.tool);
    presentSaved = null;
  }
  if (presentFS && document.fullscreenElement){
    try { document.exitFullscreen(); } catch (e){}
  }
  presentFS = false;
  syncZoomLabel(); requestRender();
}
document.addEventListener('fullscreenchange', () => {
  // the user pressed Esc inside real fullscreen — that keypress never
  // reaches our keydown handler, so leaving fullscreen ends the show
  if (presentFS && !document.fullscreenElement && presenting) exitPresent();
});
window.addEventListener('resize', () => { if (presenting){ sizeLaser(); presentFit(); } });
document.addEventListener('mousemove', () => { if (presenting) presentWake(); });
$('presPrev').addEventListener('click', () => presentGo(-1));
$('presNext').addEventListener('click', () => presentGo(1));
$('presExit').addEventListener('click', exitPresent);

/* ── foldable panel sections ────────────────────────
   Click any section title in the style panel to fold it; folds are
   remembered per browser. Everything is open by default, so the
   richness stays — each user compresses only what they never use. */
const FOLD_KEY = 'koralpaper.panelfold';
{
  let folded = {};
  try { folded = JSON.parse(localStorage.getItem(FOLD_KEY)) || {}; } catch (e){}
  document.querySelectorAll('#stylePanel .row[id]').forEach(row => {
    const label = row.querySelector(':scope > label');
    if (!label || row.id === 'rowActions') return;
    row.classList.add('foldable');
    if (folded[row.id]) row.classList.add('foldedrow');
    label.addEventListener('click', () => {
      row.classList.toggle('foldedrow');
      folded[row.id] = row.classList.contains('foldedrow');
      if (!folded[row.id]) delete folded[row.id];
      try { localStorage.setItem(FOLD_KEY, JSON.stringify(folded)); } catch (e){}
    });
  });
}

/* ── first-run welcome ─────────────────────────────── */
const WELCOME_KEY = 'koralpaper.welcomed';
function maybeShowWelcome(hadSave){
  let welcomed = false;
  try { welcomed = !!localStorage.getItem(WELCOME_KEY); } catch (e){}
  if (hadSave || welcomed) return;
  showWelcome();
}
function showWelcome(){
  $('welcomeWrap').classList.remove('hidden');
  $('shortcutsCard').classList.add('hidden');
}
/* welcome buttons — wired once, so the card can also be replayed from
   Settings ("Show the welcome screen again") */
{
  const wrap = $('welcomeWrap');
  const dismiss = () => {
    wrap.classList.add('hidden');
    try { localStorage.setItem(WELCOME_KEY, '1'); } catch (e){}
  };
  $('welcomeStart').addEventListener('click', dismiss);
  $('welcomeTour').addEventListener('click', () => {
    dismiss();
    // a virgin doc is one empty page — the tour replaces it instead of
    // leaving a blank Page 1 behind
    const virgin = state.pages.length === 1 && state.elements.length === 0;
    loadDemo();
    if (virgin && state.pages.length > 1){
      state.pages.splice(0, 1);
      state.pageIndex = 0;
      state.elements = state.pages[0].elements;
      commit(); buildPageStrip();
    }
  });
  // clicking the dim backdrop = start drawing
  wrap.addEventListener('pointerdown', ev => { if (ev.target === wrap) dismiss(); });
  $('setShowWelcome').addEventListener('click', showWelcome);
}

/* ── work protection: banners + second-tab guard ──── */
$('storageWarnSave').addEventListener('click', saveJSON);
$('tabWarnOk').addEventListener('click', () => $('tabWarn').classList.add('hidden'));
/* a second open tab overwrites this tab's autosave and competes for
   Claude's commands. Each living tab leaves a heartbeat in storage;
   seeing a FRESH beat from another tab id means two tabs are truly
   alive — no cooperation needed, so it works even when the browser
   throttles or freezes the other tab. */
const TAB_ID = uid();
const BEAT_KEY = 'koralpaper.tabbeat';
let tabWarnShown = false;
function tabBeat(){
  try { localStorage.setItem(BEAT_KEY, JSON.stringify({ id: TAB_ID, t: Date.now() })); }
  catch (e){}
}
function tabCheck(){
  try {
    const b = JSON.parse(localStorage.getItem(BEAT_KEY) || 'null');
    if (b && b.id !== TAB_ID && Date.now() - b.t < 6000 && !tabWarnShown){
      tabWarnShown = true;
      $('tabWarn').classList.remove('hidden');
    }
  } catch (e){}
}
tabCheck();
tabBeat();
setInterval(() => { tabCheck(); tabBeat(); }, 2500);
window.addEventListener('pagehide', () => {
  // a reload must not scare the reborn tab with its own ghost beat
  try {
    const b = JSON.parse(localStorage.getItem(BEAT_KEY) || 'null');
    if (b && b.id === TAB_ID) localStorage.removeItem(BEAT_KEY);
  } catch (e){}
});

/* ── PWA: offline + installable when served over the web ── */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

/* ── boot ──────────────────────────────────────────── */
function boot(){
  $('menuVersion').textContent = `KoralPaper v${APP_VERSION}`;
  syncExpToggle();
  document.querySelector('.brand .name').title = `KoralPaper v${APP_VERSION}`;
  buildSwatches();
  buildPaperSwatches();
  buildFontSelect();
  syncSettingsUI();
  applyWidthPresets();
  buildIconMenu();
  buildBoardMenu();
  loadGoogleFonts();
  const hadSave = loadSaved();
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
  maybeShowWelcome(hadSave);
  showHint('Double-click any shape to type in it · press ? for shortcuts');
}
boot();
