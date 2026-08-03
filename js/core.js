/* KoralPaper — core engine: model, geometry, hand-drawn renderer.
   No dependencies. Everything renders from plain element objects. */
'use strict';

const APP_VERSION = '3.10.0';
const TAU = Math.PI * 2;

/* ── utils ─────────────────────────────────────────── */
function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
class Rand{
  constructor(seed){ this.f = mulberry32(seed); }
  next(){ return this.f(); }
  range(a, b){ return a + (b - a) * this.f(); }
  jitter(m){ return (this.f() - .5) * 2 * m; }
}
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const lerp = (a, b, t) => a + (b - a) * t;

function rotatePoint(px, py, cx, cy, ang){
  if (!ang) return [px, py];
  const c = Math.cos(ang), s = Math.sin(ang);
  const dx = px - cx, dy = py - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

function distToSegment(px, py, x1, y1, x2, y2){
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  return dist(px, py, x1 + t * dx, y1 + t * dy);
}

/* ── palette (theme-resolvable color tokens) ───────── */
const PALETTES = {
  light: {
    bg: '#F2EFE6', grid: 'rgba(32,29,24,0.075)',
    stroke: { ink:'#26221C', gdark:'#524E45', gmid:'#8B8578', glight:'#BEB8AA', white:'#FFFFFF',
              coral:'#C96442', blue:'#5B6BB8', green:'#5E7F65', plum:'#8C5A78', paper:'#F6F3EA' },
    fill:   { none:null, cream:'#FAF7EE', white:'#FFFFFF', coral:'#C96442', terracotta:'#E6C2AC', blush:'#F0D8CB', periwinkle:'#C6CFEE',
              sage:'#C4D4C4', butter:'#EEDFA9', sky:'#C6DBDF',
              glight:'#DCD7CA', gmid:'#ACA69A', gdark:'#6E6A5F', ink:'#26221C' },
    select: '#C96442', guide: '#C96442', bindHint: '#5B6BB8',
  },
  dark: {
    bg: '#23211C', grid: 'rgba(236,231,218,0.06)',
    stroke: { ink:'#EAE4D6', gdark:'#CFC9BC', gmid:'#948E82', glight:'#635E55', white:'#FFFFFF',
              coral:'#DE8B6B', blue:'#93A2E4', green:'#94B39A', plum:'#C08FAD', paper:'#2A2823' },
    fill:   { none:null, cream:'#37342D', white:'#FFFFFF', coral:'#DE8B6B', terracotta:'#69452F', blush:'#5F443A', periwinkle:'#3D4569',
              sage:'#3C4F41', butter:'#5C5230', sky:'#39505A',
              glight:'#3B3831', gmid:'#59544B', gdark:'#8B857A', ink:'#EAE4D6' },
    select: '#DE8B6B', guide: '#DE8B6B', bindHint: '#93A2E4',
  },
};
const STROKE_KEYS = ['none','ink','gdark','gmid','glight','white','coral','blue','green','plum'];
const FILL_KEYS = ['none','ink','gdark','gmid','glight','white','cream','coral','terracotta','blush','periwinkle','sage','butter','sky'];
const COLOR_TITLES = { ink:'black', gdark:'dark grey', gmid:'grey', glight:'light grey' };

/* fonts: three offline system stacks + a curated Google Fonts list.
   Google fonts load via a <link> when online and fall back gracefully offline. */
const FONT_GROUPS = ['Built-in', 'Sans & display', 'Serif', 'Mono', 'Hand & script', 'Pixel & dot'];
const FONTS = {
  serif: { label:'Serif — classic', stack:'"Iowan Old Style","Palatino Linotype",Palatino,"Times New Roman",Georgia,serif', weight:'500', group:'Built-in' },
  sans:  { label:'Sans — notes', stack:'"Avenir Next",Avenir,"Helvetica Neue",Helvetica,Arial,sans-serif', weight:'600', group:'Built-in' },
  hand:  { label:'Hand — marker', stack:'"Chalkboard SE","Comic Sans MS","Segoe Print","Bradley Hand",cursive', weight:'400', group:'Built-in' },

  inter:      { label:'Inter', stack:'"Inter","Helvetica Neue",sans-serif', weight:'500', google:'Inter:wght@400;500;700', group:'Sans & display' },
  montserrat: { label:'Montserrat', stack:'"Montserrat","Helvetica Neue",sans-serif', weight:'500', google:'Montserrat:wght@400;500;700', group:'Sans & display' },
  robotocond: { label:'Roboto Condensed', stack:'"Roboto Condensed","Helvetica Neue",sans-serif', weight:'500', google:'Roboto+Condensed:wght@400;700', group:'Sans & display' },
  bebas:      { label:'Bebas Neue', stack:'"Bebas Neue","Helvetica Neue",sans-serif', weight:'400', google:'Bebas+Neue', group:'Sans & display' },
  fjalla:     { label:'Fjalla One', stack:'"Fjalla One","Helvetica Neue",sans-serif', weight:'400', google:'Fjalla+One', group:'Sans & display' },
  oswald:     { label:'Oswald', stack:'"Oswald","Helvetica Neue",sans-serif', weight:'500', google:'Oswald:wght@400;600', group:'Sans & display' },
  imbue:      { label:'Imbue', stack:'"Imbue",Georgia,serif', weight:'500', google:'Imbue:wght@400;600', group:'Serif' },
  dmsans:     { label:'DM Sans', stack:'"DM Sans","Helvetica Neue",sans-serif', weight:'500', google:'DM+Sans:wght@400;500;700', group:'Sans & display' },
  spacegrotesk:{ label:'Space Grotesk', stack:'"Space Grotesk","Helvetica Neue",sans-serif', weight:'500', google:'Space+Grotesk:wght@400;500;600', group:'Sans & display' },

  playfair:   { label:'Playfair Display', stack:'"Playfair Display",Georgia,serif', weight:'500', google:'Playfair+Display:wght@400;500;600', group:'Serif' },
  ptserif:    { label:'PT Serif', stack:'"PT Serif",Georgia,serif', weight:'400', google:'PT+Serif:wght@400;700', group:'Serif' },
  lora:       { label:'Lora', stack:'"Lora",Georgia,serif', weight:'500', google:'Lora:wght@400;500;600', group:'Serif' },

  jetbrains:  { label:'JetBrains Mono', stack:'"JetBrains Mono","SF Mono",Menlo,monospace', weight:'500', google:'JetBrains+Mono:wght@400;500;600', group:'Mono' },
  ibmplex:    { label:'IBM Plex Mono', stack:'"IBM Plex Mono","SF Mono",Menlo,monospace', weight:'500', google:'IBM+Plex+Mono:wght@400;500;600', group:'Mono' },
  sharetech:  { label:'Share Tech Mono', stack:'"Share Tech Mono","SF Mono",Menlo,monospace', weight:'400', google:'Share+Tech+Mono', group:'Mono' },

  caveat:     { label:'Caveat', stack:'"Caveat","Chalkboard SE",cursive', weight:'600', google:'Caveat:wght@400;600', group:'Hand & script' },
  patrick:    { label:'Patrick Hand', stack:'"Patrick Hand","Chalkboard SE",cursive', weight:'400', google:'Patrick+Hand', group:'Hand & script' },
  kalam:      { label:'Kalam', stack:'"Kalam","Chalkboard SE",cursive', weight:'400', google:'Kalam:wght@400;700', group:'Hand & script' },
  architects: { label:'Architects Daughter', stack:'"Architects Daughter","Chalkboard SE",cursive', weight:'400', google:'Architects+Daughter', group:'Hand & script' },
  shadows:    { label:'Shadows Into Light', stack:'"Shadows Into Light","Bradley Hand",cursive', weight:'400', google:'Shadows+Into+Light', group:'Hand & script' },
  lobster:    { label:'Lobster Two', stack:'"Lobster Two",cursive', weight:'400', google:'Lobster+Two:wght@400;700', group:'Hand & script' },
  playwritenz:{ label:'Playwrite NZ Guides', stack:'"Playwrite NZ Guides",cursive', weight:'400', google:'Playwrite+NZ+Guides', group:'Hand & script' },
  unkempt:    { label:'Unkempt', stack:'"Unkempt","Chalkboard SE",cursive', weight:'400', google:'Unkempt:wght@400;700', group:'Hand & script' },
  kaushan:    { label:'Kaushan Script', stack:'"Kaushan Script",cursive', weight:'400', google:'Kaushan+Script', group:'Hand & script' },

  bitcountprop:{ label:'Bitcount Prop Single', stack:'"Bitcount Prop Single",monospace', weight:'400', google:'Bitcount+Prop+Single', group:'Pixel & dot' },
  bitcountsingle:{ label:'Bitcount Single', stack:'"Bitcount Single",monospace', weight:'400', google:'Bitcount+Single', group:'Pixel & dot' },
  bitcountink:{ label:'Bitcount Prop Double Ink', stack:'"Bitcount Prop Double Ink",monospace', weight:'400', google:'Bitcount+Prop+Double+Ink', group:'Pixel & dot' },
  tiny5:      { label:'Tiny5', stack:'"Tiny5",monospace', weight:'400', google:'Tiny5', group:'Pixel & dot' },
  doto:       { label:'Doto', stack:'"Doto",monospace', weight:'600', google:'Doto:wght@400;600;700', group:'Pixel & dot' },
};
function fontCSS(font, size){
  const f = FONTS[font] || FONTS.sans;
  return `${f.weight} ${size}px ${f.stack}`;
}
function googleFontsHref(){
  const fams = Object.values(FONTS).filter(f => f.google).map(f => 'family=' + f.google).join('&');
  return 'https://fonts.googleapis.com/css2?' + fams + '&display=swap';
}
function lineHeightOf(size, mult){ return Math.round(size * (mult || 1.3)); }

/* colors are tokens (theme-resolved) OR raw '#rrggbb' custom values.
   stroke 'none' resolves to null → the stroke pass is skipped entirely. */
function resolveStroke(pal, key){
  if (key === 'none') return null;
  return pal.stroke[key] || (typeof key === 'string' && key[0] === '#' ? key : pal.stroke.ink);
}
function resolveFill(pal, key){
  if (!key || key === 'none') return null;
  return pal.fill[key] || pal.stroke[key] || (typeof key === 'string' && key[0] === '#' ? key : null);
}

/* ── element model ─────────────────────────────────── */
const SHAPE_TYPES = ['rect','diamond','ellipse','chip','icon','image'];
const LINEAR_TYPES = ['arrow','line','draw'];
const isShape = el => SHAPE_TYPES.includes(el.type);
const isLinear = el => LINEAR_TYPES.includes(el.type);
const canHaveText = el => ['rect','diamond','ellipse','chip','text','arrow','line'].includes(el.type);

function newElement(type, x, y, style){
  const el = {
    id: uid(), type, x, y, w: 0, h: 0, angle: 0,
    seed: Math.floor(Math.random() * 2 ** 31),
    stroke: 'ink', fill: 'none', fillStyle: 'solid', dash: 'solid',
    sw: 3.3, sketch: 1, round: 1, opacity: 100,
    text: '', font: 'sans', size: 21, align: 'center',
    lh: 1.3, pgap: 0, lspace: 0, valign: 'middle',
    groupId: null,
  };
  if (type === 'chip'){ el.fill = 'periwinkle'; el.size = 16; }
  if (type === 'rect'){ el.fill = 'cream'; }
  if (type === 'icon'){ el.kind = 'asterisk'; el.stroke = 'none'; el.fill = 'coral'; }
  if (type === 'image'){
    el.src = ''; el.artStyle = 'photo'; el.detail = 2;
    el.bright = 0; el.contrast = 0; el.gamma = 1; el.sharp = 0;
  }
  if (type === 'text'){ el.align = 'left'; el.font = 'sans'; }
  if (isLinear({type})){
    el.points = [[0,0],[0,0]];
    el.size = 16; // labels ride smaller
    el.curve = 0;
    el.elbow = false;
    el.elbowPts = null;
    el.startHead = 'none';
    el.endHead = (type === 'arrow') ? 'arrow' : 'none';
    el.startBind = null; el.endBind = null;
  }
  if (style) Object.assign(el, style);
  return el;
}

/* bbox in scene coords, ignoring rotation */
function boundsOf(el){
  if (isLinear(el)){
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [px, py] of el.points){
      minX = Math.min(minX, px); minY = Math.min(minY, py);
      maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
    }
    if (!isFinite(minX)){ minX = minY = maxX = maxY = 0; }
    return { x: el.x + minX, y: el.y + minY, w: maxX - minX || 1, h: maxY - minY || 1 };
  }
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

function boundsWithRotation(el){
  const b = boundsOf(el);
  if (!el.angle) return b;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const pts = [[b.x,b.y],[b.x+b.w,b.y],[b.x+b.w,b.y+b.h],[b.x,b.y+b.h]]
    .map(([px,py]) => rotatePoint(px, py, cx, cy, el.angle));
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

function sceneBounds(elements){
  if (!elements.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements){
    const b = boundsWithRotation(el);
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/* ── text measurement & layout ─────────────────────── */
const _measureCtx = document.createElement('canvas').getContext('2d');
function applyTracking(ctx2, el){
  try { ctx2.letterSpacing = ((el && el.lspace) || 0) + 'px'; } catch (e){}
}
/* typography accessors — every element carries lh (line-height multiple),
   pgap (extra px at hard line breaks = paragraphs) and lspace (tracking) */
const elLH = el => lineHeightOf(el.size, el.lh);
const elPgap = el => el.pgap || 0;
/* the ONE text layout used by canvas, SVG, autosize and the editor:
   maxW == null → hard \n breaks only; with maxW, soft-wraps each paragraph.
   Returns positioned lines with per-line paragraph flags. */
function layoutText(el, maxW){
  _measureCtx.font = fontCSS(el.font, el.size);
  applyTracking(_measureCtx, el);
  const lh = elLH(el), pgap = elPgap(el);
  const lines = [];
  String(el.text ?? '').split('\n').forEach((raw, pi) => {
    if (maxW == null || !raw){
      lines.push({ text: raw, para: pi > 0 });
      return;
    }
    let line = '', first = true;
    for (const word of raw.split(' ')){
      const test = line ? line + ' ' + word : word;
      if (_measureCtx.measureText(test).width <= maxW || !line) line = test;
      else {
        lines.push({ text: line, para: first && pi > 0 });
        first = false; line = word;
      }
    }
    lines.push({ text: line, para: first && pi > 0 });
  });
  let w = 0;
  for (const l of lines) w = Math.max(w, _measureCtx.measureText(l.text).width);
  const totalH = lines.length * lh + lines.filter(l => l.para).length * pgap;
  applyTracking(_measureCtx, null);
  return { lines, lh, pgap, totalH, w };
}
function measureText(text, font, size, tyEl){
  _measureCtx.font = fontCSS(font, size);
  applyTracking(_measureCtx, tyEl);
  const lines = String(text).split('\n');
  let w = 0;
  for (const ln of lines) w = Math.max(w, _measureCtx.measureText(ln).width);
  applyTracking(_measureCtx, null);
  const lh = tyEl ? lineHeightOf(size, tyEl.lh) : lineHeightOf(size);
  const pg = tyEl ? (tyEl.pgap || 0) : 0;
  return { w, h: lines.length * lh + Math.max(0, lines.length - 1) * pg, lines };
}
function wrapText(text, maxW, font, size){
  _measureCtx.font = fontCSS(font, size);
  const out = [];
  for (const raw of String(text).split('\n')){
    if (!raw){ out.push(''); continue; }
    let line = '';
    for (const word of raw.split(' ')){
      const test = line ? line + ' ' + word : word;
      if (_measureCtx.measureText(test).width <= maxW || !line) line = test;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

/* ── shape outline points (clean, pre-wobble) ──────── */
function roundedRectOutline(x, y, w, h, rad){
  const r = clamp(rad, 0, Math.min(w, h) / 2);
  const pts = [];
  const arc = (cx, cy, a0, a1) => {
    const n = 6;
    for (let i = 0; i <= n; i++){
      const a = a0 + (a1 - a0) * (i / n);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  if (r < 0.5){
    pts.push([x,y],[x+w,y],[x+w,y+h],[x,y+h]);
    return pts;
  }
  arc(x + r,     y + r,     Math.PI,       Math.PI * 1.5);
  arc(x + w - r, y + r,     Math.PI * 1.5, TAU);
  arc(x + w - r, y + h - r, 0,             Math.PI * .5);
  arc(x + r,     y + h - r, Math.PI * .5,  Math.PI);
  return pts;
}
function ellipseOutline(cx, cy, rx, ry, n){
  const pts = [];
  n = n || Math.max(16, Math.round((rx + ry) / 6));
  for (let i = 0; i < n; i++){
    const a = (i / n) * TAU;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}
function diamondOutline(x, y, w, h){
  return [[x + w/2, y],[x + w, y + h/2],[x + w/2, y + h],[x, y + h/2]];
}
function shapeOutline(el){
  const { x, y, w, h } = el;
  switch (el.type){
    case 'rect': return roundedRectOutline(x, y, w, h, el.round ? Math.min(18, Math.min(w,h)*.25) : 0);
    case 'chip': return roundedRectOutline(x, y, w, h, h / 2);
    case 'ellipse': return ellipseOutline(x + w/2, y + h/2, w/2, h/2);
    case 'diamond': return diamondOutline(x, y, w, h);
    case 'icon': return ellipseOutline(x + w/2, y + h/2, w/2, h/2, 24);
    default: { const b = boundsOf(el); return [[b.x,b.y],[b.x+b.w,b.y],[b.x+b.w,b.y+b.h],[b.x,b.y+b.h]]; }
  }
}

/* point on shape outline, walking from the shape's center toward `from` — used
   to glue arrow endpoints to shape borders (with a small paper gap). */
function boundaryPointToward(el, fromX, fromY, gap){
  const b = boundsOf(el);
  const cx = b.x + b.w/2, cy = b.y + b.h/2;
  // account for shape rotation: rotate the outside point into local space
  let [fx, fy] = rotatePoint(fromX, fromY, cx, cy, -(el.angle || 0));
  const dx = fx - cx, dy = fy - cy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  let t;
  if (el.type === 'ellipse' || el.type === 'icon'){
    const rx = b.w/2 || 1, ry = b.h/2 || 1;
    t = 1 / Math.sqrt((ux*ux)/(rx*rx) + (uy*uy)/(ry*ry));
  } else if (el.type === 'diamond'){
    const rx = b.w/2 || 1, ry = b.h/2 || 1;
    t = 1 / (Math.abs(ux)/rx + Math.abs(uy)/ry);
  } else {
    const rx = b.w/2 || 1, ry = b.h/2 || 1;
    t = Math.min(rx / (Math.abs(ux) || 1e-9), ry / (Math.abs(uy) || 1e-9));
  }
  t = Math.min(t + (gap || 0), len - 2);
  t = Math.max(t, 4);
  const lx = cx + ux * t, ly = cy + uy * t;
  return rotatePoint(lx, ly, cx, cy, el.angle || 0);
}

/* ── hit testing ───────────────────────────────────── */
function pointInShape(el, px, py, slack){
  const b = boundsOf(el);
  const cx = b.x + b.w/2, cy = b.y + b.h/2;
  [px, py] = rotatePoint(px, py, cx, cy, -(el.angle || 0));
  slack = slack || 0;
  const nx = (px - cx) / (b.w/2 + slack || 1), ny = (py - cy) / (b.h/2 + slack || 1);
  switch (el.type){
    case 'ellipse': return nx*nx + ny*ny <= 1;
    case 'diamond': return Math.abs(nx) + Math.abs(ny) <= 1;
    default: return Math.abs(nx) <= 1 && Math.abs(ny) <= 1;
  }
}

/* ── elbow (right-angle) arrows ────────────────────── */
/* Routing needs to see the other elements to steer around them; renderScene /
   renderSceneSVG (and the app) publish the active element list here. */
let ROUTE_ELEMENTS = null;
function setRouteContext(els){ ROUTE_ELEMENTS = els; }

function elbowObstacles(el){
  if (!ROUTE_ELEMENTS) return [];
  const m = 14; // clearance margin around shapes
  const out = [];
  for (const o of ROUTE_ELEMENTS){
    if (o.id === el.id || o.id === el.startBind || o.id === el.endBind) continue;
    if (isLinear(o) || o.type === 'text') continue;
    const b = boundsWithRotation(o);
    out.push({ x: b.x - m, y: b.y - m, w: b.w + 2*m, h: b.h + 2*m });
  }
  return out;
}
function segBlocked(x1, y1, x2, y2, rects){
  for (const r of rects){
    if (y1 === y2){
      if (y1 > r.y && y1 < r.y + r.h && Math.max(x1,x2) > r.x && Math.min(x1,x2) < r.x + r.w) return true;
    } else {
      if (x1 > r.x && x1 < r.x + r.w && Math.max(y1,y2) > r.y && Math.min(y1,y2) < r.y + r.h) return true;
    }
  }
  return false;
}
function cornersBlocked(corners, rects){
  for (let i = 1; i < corners.length; i++)
    if (segBlocked(corners[i-1][0], corners[i-1][1], corners[i][0], corners[i][1], rects)) return true;
  return false;
}
function simplifyCorners(corners){
  const out = [corners[0]];
  for (let i = 1; i < corners.length - 1; i++){
    const a = out[out.length-1], c = corners[i], n = corners[i+1];
    const collinear = (a[0] === c[0] && c[0] === n[0]) || (a[1] === c[1] && c[1] === n[1]);
    if (!collinear && !(a[0] === c[0] && a[1] === c[1])) out.push(c);
  }
  out.push(corners[corners.length-1]);
  return out;
}
/* grid A* over the edges of inflated obstacle rects — used when every
   simple route is blocked. Cost = length + a penalty per bend. */
function elbowAStar(A2, B2, d0, d1, rects){
  const xs = new Set([A2[0], B2[0]]), ys = new Set([A2[1], B2[1]]);
  for (const r of rects){ xs.add(r.x); xs.add(r.x + r.w); ys.add(r.y); ys.add(r.y + r.h); }
  const X = [...xs].sort((a,b) => a-b), Y = [...ys].sort((a,b) => a-b);
  if (X.length * Y.length > 6000) return null;
  const xi = new Map(X.map((v,i) => [v,i])), yi = new Map(Y.map((v,i) => [v,i]));
  const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
  const dirIdx = d => DIRS.findIndex(v => v[0] === d[0] && v[1] === d[1]);
  const BEND = 60;
  const sKey = (i,j,d) => (i * Y.length + j) * 4 + d;
  const gBest = new Map(), from = new Map();
  const open = [];
  const h = (i,j) => Math.abs(X[i]-B2[0]) + Math.abs(Y[j]-B2[1]);
  const si = xi.get(A2[0]), sj = yi.get(A2[1]);
  const gi = xi.get(B2[0]), gj = yi.get(B2[1]);
  const sd = dirIdx(d0), wantEnd = dirIdx([-d1[0], -d1[1]]);
  open.push({ i: si, j: sj, d: sd, g: 0, f: h(si,sj) });
  gBest.set(sKey(si,sj,sd), 0);
  let goal = null;
  let guard = 0;
  while (open.length && guard++ < 30000){
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (open[k].f < open[bi].f) bi = k;
    const cur = open.splice(bi, 1)[0];
    if (cur.i === gi && cur.j === gj){ goal = cur; break; }
    for (let d = 0; d < 4; d++){
      const ni = cur.i + DIRS[d][0], nj = cur.j + DIRS[d][1];
      if (ni < 0 || nj < 0 || ni >= X.length || nj >= Y.length) continue;
      if (segBlocked(X[cur.i], Y[cur.j], X[ni], Y[nj], rects)) continue;
      let g = cur.g + Math.abs(X[ni]-X[cur.i]) + Math.abs(Y[nj]-Y[cur.j])
            + (d !== cur.d ? BEND : 0);
      if (ni === gi && nj === gj && d !== wantEnd) g += BEND;
      const k2 = sKey(ni, nj, d);
      if (g < (gBest.get(k2) ?? Infinity)){
        gBest.set(k2, g);
        from.set(k2, sKey(cur.i, cur.j, cur.d));
        open.push({ i: ni, j: nj, d, g, f: g + h(ni, nj) });
      }
    }
  }
  if (!goal) return null;
  const pts = [];
  let k = sKey(goal.i, goal.j, goal.d);
  while (k !== undefined){
    const d = k % 4, j = ((k - d) / 4) % Y.length, i = ((k - d) / 4 - j) / Y.length;
    pts.unshift([X[i], Y[j]]);
    k = from.get(k);
  }
  return pts;
}
function elbowEndInfo(el){
  const A = [el.x + el.points[0][0], el.y + el.points[0][1]];
  const B = [el.x + el.points[el.points.length-1][0], el.y + el.points[el.points.length-1][1]];
  const dirOf = a => a === 'n' ? [0,-1] : a === 's' ? [0,1]
              : a === 'w' ? [-1,0] : a === 'e' ? [1,0] : null;
  const dx = B[0] - A[0], dy = B[1] - A[1];
  let d0 = dirOf(el.startAnchor);
  let d1 = dirOf(el.endAnchor);   // direction pointing OUT of the end side
  if (!d0) d0 = Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1];
  if (!d1) d1 = Math.abs(dx) >= Math.abs(dy) ? [-(Math.sign(dx) || 1), 0] : [0, -(Math.sign(dy) || 1)];
  return { A, B, d0, d1 };
}
function elbowRoute(el){
  /* manual corners (user-dragged segments) win; else heuristic routes,
     skipping any that cross another shape; else A* around the obstacles. */
  const { A, B, d0, d1 } = elbowEndInfo(el);
  if (el.elbowPts && el.elbowPts.length){
    const corners = [A, ...el.elbowPts.map(p => [el.x + p[0], el.y + p[1]]), B];
    return { corners, manual: true };
  }
  const pad = 30;
  const A2 = [A[0] + d0[0]*pad, A[1] + d0[1]*pad];
  const B2 = [B[0] + d1[0]*pad, B[1] + d1[1]*pad];
  const ax0 = d0[0] !== 0 ? 'x' : 'y';
  const ax1 = d1[0] !== 0 ? 'x' : 'y';
  const candidates = [];
  if (ax0 === ax1){
    const i = ax0 === 'x' ? 0 : 1;
    let from, to;
    if (d0[i] === d1[i]){
      const dir = d0[i];
      const base = dir > 0 ? Math.max(A2[i], B2[i]) : Math.min(A2[i], B2[i]);
      from = base; to = base;
    } else { from = A2[i]; to = B2[i]; }
    for (const t of [0.5, 0.25, 0.75]){
      const m = from + (to - from) * t;
      candidates.push(i === 0
        ? [A, [m, A[1]], [m, B[1]], B]
        : [A, [A[0], m], [B[0], m], B]);
      if (from === to) break;
    }
  } else {
    candidates.push(ax0 === 'x' ? [A, [B[0], A[1]], B] : [A, [A[0], B[1]], B]);
    // alternate: go out the stub first, then two bends
    candidates.push(ax0 === 'x'
      ? [A, A2, [A2[0], B[1]], B]
      : [A, A2, [B[0], A2[1]], B]);
  }
  const rects = elbowObstacles(el);
  if (!rects.length) return { corners: simplifyCorners(candidates[0]) };
  for (const c of candidates)
    if (!cornersBlocked(c, rects)) return { corners: simplifyCorners(c) };
  const path = elbowAStar(A2, B2, d0, d1, rects);
  if (path) return { corners: simplifyCorners([A, ...path, B]) };
  return { corners: simplifyCorners(candidates[0]) };
}
/* keep a manual route orthogonal after its endpoints move (bound shape
   dragged/resized): the corner next to each end inherits the end's
   coordinate on the axis their shared segment runs along. */
function rectifyElbow(el){
  if (!el.elbow || !el.elbowPts || !el.elbowPts.length) return;
  const A = el.points[0], B = el.points[el.points.length-1];
  const first = el.elbowPts[0], last = el.elbowPts[el.elbowPts.length-1];
  if (Math.abs(first[0] - A[0]) < Math.abs(first[1] - A[1])) first[0] = A[0];
  else first[1] = A[1];
  if (Math.abs(last[0] - B[0]) < Math.abs(last[1] - B[1])) last[0] = B[0];
  else last[1] = B[1];
}
function roundedPolyline(corners, r){
  /* soften every corner with a small quadratic arc, sampled into points */
  if (corners.length <= 2) return corners.map(p => p.slice());
  const out = [corners[0].slice()];
  for (let i = 1; i < corners.length - 1; i++){
    const p = corners[i-1], c = corners[i], n = corners[i+1];
    const d1 = Math.hypot(c[0]-p[0], c[1]-p[1]);
    const d2 = Math.hypot(n[0]-c[0], n[1]-c[1]);
    const rr = Math.min(r, d1/2, d2/2);
    if (rr < 0.5 || !d1 || !d2){ out.push(c.slice()); continue; }
    const s = [c[0] - (c[0]-p[0])/d1*rr, c[1] - (c[1]-p[1])/d1*rr];
    const e = [c[0] + (n[0]-c[0])/d2*rr, c[1] + (n[1]-c[1])/d2*rr];
    for (let j = 0; j <= 5; j++){
      const tt = j/5, it = 1 - tt;
      out.push([it*it*s[0] + 2*it*tt*c[0] + tt*tt*e[0],
                it*it*s[1] + 2*it*tt*c[1] + tt*tt*e[1]]);
    }
  }
  out.push(corners[corners.length-1].slice());
  /* densify straight runs so the index-middle of the array ≈ the middle of
     the route by length — label and drag handle land mid-segment */
  const dense = [out[0]];
  for (let i = 1; i < out.length; i++){
    const a = out[i-1], b = out[i];
    const d = Math.hypot(b[0]-a[0], b[1]-a[1]);
    const n = Math.floor(d / 16);
    for (let j = 1; j <= n; j++){
      const tt = j / (n + 1);
      dense.push([a[0] + (b[0]-a[0])*tt, a[1] + (b[1]-a[1])*tt]);
    }
    dense.push(b);
  }
  return dense;
}

function linearPathPoints(el){
  /* absolute sampled polyline incl. curve bow — reused by render + hit test */
  const abs = el.points.map(([px,py]) => [el.x + px, el.y + py]);
  if (el.type !== 'draw' && el.elbow && abs.length === 2)
    return roundedPolyline(elbowRoute(el).corners, 11);
  if (el.type === 'draw' || !el.curve || abs.length !== 2) return abs;
  const [a, b] = abs;
  const mx = (a[0]+b[0])/2, my = (a[1]+b[1])/2;
  const dx = b[0]-a[0], dy = b[1]-a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy/len, ny = dx/len;
  const cxp = mx + nx * len * el.curve, cyp = my + ny * len * el.curve;
  const out = [];
  const n = Math.max(12, Math.round(len / 14));
  for (let i = 0; i <= n; i++){
    const t = i / n, it = 1 - t;
    out.push([it*it*a[0] + 2*it*t*cxp + t*t*b[0], it*it*a[1] + 2*it*t*cyp + t*t*b[1]]);
  }
  return out;
}

function pathMidpoint(pts){
  if (pts.length === 2)
    return [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
  return pts[(pts.length / 2) | 0];
}

function hitTest(el, px, py, zoom){
  const tol = 8 / (zoom || 1);
  if (isLinear(el)){
    const pts = linearPathPoints(el);
    for (let i = 0; i < pts.length - 1; i++){
      if (distToSegment(px, py, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]) < tol + el.sw/2) return true;
    }
    if (el.text && el.text.trim() && el.type !== 'draw'){
      const mid = pathMidpoint(pts);
      const m = measureText(el.text, el.font, el.size, el);
      if (Math.abs(px - mid[0]) < m.w/2 + 9 && Math.abs(py - mid[1]) < m.h/2 + 6) return true;
    }
    return false;
  }
  if (el.type === 'text'){
    const b = boundsOf(el);
    const cx = b.x + b.w/2, cy = b.y + b.h/2;
    const [lx, ly] = rotatePoint(px, py, cx, cy, -(el.angle || 0));
    return lx >= b.x - tol && lx <= b.x + b.w + tol && ly >= b.y - tol && ly <= b.y + b.h + tol;
  }
  if (el.type === 'icon' || el.type === 'image') return pointInShape(el, px, py, 0);
  const filled = el.fill !== 'none' || (el.text && el.text.trim());
  if (filled) return pointInShape(el, px, py, tol * .5);
  return pointInShape(el, px, py, tol) && !pointInShape(el, px, py, -tol);
}

/* ── hand-drawn rendering ──────────────────────────── */
function wobblyPath(pts, closed, rnd, mag){
  /* subdivide each segment and displace midpoints — returns list of points */
  const out = [];
  const n = pts.length + (closed ? 0 : -1);
  for (let i = 0; i < n; i++){
    const a = pts[i], b = pts[(i+1) % pts.length];
    const segLen = dist(a[0],a[1],b[0],b[1]);
    const div = Math.max(1, Math.min(4, Math.round(segLen / 45)));
    for (let d = 0; d < div; d++){
      const t0 = d / div;
      const px = lerp(a[0], b[0], t0) + (i+d ? rnd.jitter(mag) : rnd.jitter(mag*.5));
      const py = lerp(a[1], b[1], t0) + (i+d ? rnd.jitter(mag) : rnd.jitter(mag*.5));
      out.push([px, py]);
    }
  }
  out.push(closed ? out[0].slice() : [
    pts[pts.length-1][0] + rnd.jitter(mag*.5),
    pts[pts.length-1][1] + rnd.jitter(mag*.5),
  ]);
  return out;
}

function strokePolyline(ctx, pts){
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++){
    const mx = (pts[i][0] + pts[i+1][0]) / 2, my = (pts[i][1] + pts[i+1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length-1];
  ctx.lineTo(last[0], last[1]);
  ctx.stroke();
}

function traceClosed(ctx, pts){
  /* starts at the midpoint of the first edge so the seam corner gets the same
     rounding as every other vertex (no lone sharp spike) */
  const n = pts.length;
  ctx.beginPath();
  ctx.moveTo((pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2);
  for (let i = 1; i <= n; i++){
    const p = pts[i % n], nx = pts[(i + 1) % n];
    ctx.quadraticCurveTo(p[0], p[1], (p[0] + nx[0]) / 2, (p[1] + nx[1]) / 2);
  }
  ctx.closePath();
}
function subdivideClosed(pts){
  /* same subdivision the wobbly stroke gets, but with zero jitter — so fills
     round their corners exactly as much as the sketchy outline does */
  return wobblyPath(pts, true, new Rand(1), 0).slice(0, -1);
}
function traceFillPath(ctx, pts, neat){
  if (!neat) return traceClosed(ctx, subdivideClosed(pts));
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/* dash pattern for a stroke — round caps turn the tiny 'on' length into dots */
function dashArrayOf(el){
  if (el.dash === 'dotted') return [Math.max(0.5, el.sw * 0.08), el.sw * 2.8];
  if (el.dash === 'dashed') return [el.sw * 3.4, el.sw * 2.4];
  return null;
}

/* shared by the canvas renderer and the SVG exporter — same seed, same wobble */
function sketchPolylines(cleanPts, closed, el, level){
  if (level === 0) return [{ pts: cleanPts, closed, clean: true }];
  const rnd = new Rand(el.seed);
  const mag = level === 2 ? 2.6 : 1.35;
  const passes = level === 2 ? 2 : 1;
  const out = [];
  for (let p = 0; p < passes; p++){
    const w = wobblyPath(cleanPts, closed, rnd, mag * (p ? .8 : 1));
    out.push(closed ? { pts: w.slice(0, -1), closed: true } : { pts: w, closed: false });
  }
  return out;
}
function sketchStroke(ctx, cleanPts, closed, el, level){
  for (const poly of sketchPolylines(cleanPts, closed, el, level)){
    if (poly.clean){
      ctx.beginPath();
      ctx.moveTo(poly.pts[0][0], poly.pts[0][1]);
      for (let i = 1; i < poly.pts.length; i++) ctx.lineTo(poly.pts[i][0], poly.pts[i][1]);
      if (poly.closed) ctx.closePath();
      ctx.stroke();
    }
    else if (poly.closed){ traceClosed(ctx, poly.pts); ctx.stroke(); }
    else strokePolyline(ctx, poly.pts);
  }
}

/* ── fill patterns ─────────────────────────────────
   Every non-solid fill style reduces to primitives (lines / dots / wavy
   paths) generated from the element's seed. Canvas strokes them clipped to
   the shape; the SVG exporter serializes the same lists. */
const FILL_STYLE_KEYS = ['solid','hachure','dense','cross','dots','waves'];

function fillPatternPrims(el){
  const rnd = new Rand(el.seed + 7);
  const b = boundsOf(el);
  const cx = b.x + b.w/2, cy = b.y + b.h/2;
  const diag = Math.hypot(b.w, b.h);
  const prims = { lines: [], dots: [], paths: [] };
  const gap = 7 + el.sw * 1.5;
  const lineSet = (angle, g) => {
    const c = Math.cos(angle), s = Math.sin(angle);
    const P = (x, y) => [cx + x * c - y * s, cy + x * s + y * c];
    for (let yy = -diag/2; yy <= diag/2; yy += g){
      const j1 = rnd.jitter(2), j2 = rnd.jitter(2);
      prims.lines.push([
        ...P(-diag/2 + rnd.jitter(4), yy + j1),
        ...P(diag/2 + rnd.jitter(4), yy + j2),
      ]);
    }
  };
  switch (el.fillStyle){
    case 'hachure': lineSet(-Math.PI/4, gap); break;
    case 'dense': lineSet(-Math.PI/4, Math.max(3.4, gap * 0.5)); break;
    case 'cross': lineSet(-Math.PI/4, gap); lineSet(Math.PI/4, gap); break;
    case 'dots': {
      const g = Math.max(5.5, 6.5 + el.sw * 1.2);
      const r = Math.max(0.9, el.sw * 0.45);
      for (let yy = b.y + g/2; yy < b.y + b.h; yy += g)
        for (let xx = b.x + g/2; xx < b.x + b.w; xx += g)
          prims.dots.push([xx + rnd.jitter(1.6), yy + rnd.jitter(1.6), r]);
      break;
    }
    case 'waves': {
      const g = Math.max(6.5, gap * 0.95);
      const half = 8; // half wavelength
      for (let yy = b.y + g/2; yy < b.y + b.h; yy += g){
        const pts = [];
        const ph = rnd.jitter(1.5);
        let k = Math.round(rnd.range(0, 1));
        for (let xx = b.x - 4; xx <= b.x + b.w + 4; xx += half){
          pts.push([xx, yy + ((k++ % 2) ? g * 0.26 : -g * 0.26) + ph * 0.4]);
        }
        prims.paths.push(pts);
      }
      break;
    }
  }
  return prims;
}

function strokePatternPrims(ctx, el, color, prims){
  prims = prims || fillPatternPrims(el);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.1, el.sw * .55);
  ctx.lineCap = 'round';
  ctx.setLineDash([]);
  for (const [x1, y1, x2, y2] of prims.lines){
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  if (prims.dots.length){
    ctx.beginPath();
    for (const [dx, dy, r] of prims.dots){ ctx.moveTo(dx + r, dy); ctx.arc(dx, dy, r, 0, TAU); }
    ctx.fill();
  }
  for (const pts of prims.paths) strokePolyline(ctx, pts);
}
function patternFill(ctx, outline, el, color){
  ctx.save();
  traceFillPath(ctx, outline, el.sketch === 0);
  ctx.clip();
  strokePatternPrims(ctx, el, color);
  ctx.restore();
}

/* ── icon library ──────────────────────────────────
   Every icon reduces to primitives:
     {kind:'fill', pts, use:'stroke'|'fill'}  smooth-closed filled polygon
     {kind:'stroke', pts, closed, widthMul}   sketchy stroked path
     {kind:'dot', x, y, r}                    filled dot in stroke color
   Canvas and SVG both consume the same list, so exports match the screen. */
const ICON_KINDS = ['asterisk','paperast','paperstroke','paperthought','spiral','cloud','star','heart','bolt','bubble','bang','question','check'];

function sampleQuad(p0, c, p1, n){
  const out = [];
  for (let i = 0; i <= n; i++){
    const t = i / n, it = 1 - t;
    out.push([it*it*p0[0] + 2*it*t*c[0] + t*t*p1[0], it*it*p0[1] + 2*it*t*c[1] + t*t*p1[1]]);
  }
  return out;
}

function iconPrims(el){
  const b = boundsOf(el);
  const x = b.x, y = b.y, w = b.w, h = b.h;
  const cx = x + w/2, cy = y + h/2, rx = w/2, ry = h/2;
  const R = Math.min(rx, ry);
  const rnd = new Rand(el.seed);
  const prims = [];
  const P = (u, v) => [x + u * w, y + v * h]; // unit-box helper

  /* 6-spoke KoralPaper asterisk (vertical bar + two diagonals) — each spoke
     is a closed rounded capsule, so it can be filled, stroked, or both */
  const asterCapsules = (acx, acy, aR, sxA, syA, withOutline) => {
    const base = -Math.PI / 2 + rnd.jitter(0.05);
    const PT = (px, py) => [acx + px * sxA, acy + py * syA];
    for (let i = 0; i < 6; i++){
      const a = base + (i / 6) * TAU + rnd.jitter(0.05);
      const rr = aR * rnd.range(0.88, 1.0);
      const ux = Math.cos(a), uy = Math.sin(a);
      const nx = -uy, ny = ux;
      const halfW = aR * rnd.range(0.115, 0.135);
      const r0 = aR * 0.08;
      const tipR = rr - halfW;
      const at = (r, side, wamt) => [ux * r + nx * side * wamt, uy * r + ny * side * wamt];
      const pts = [
        PT(...at(r0, 1, halfW * 0.95)),
        PT(...at(rr * 0.55, 1, halfW)),
        PT(...at(tipR, 1, halfW * 0.9)),
        PT(ux * rr, uy * rr),                                  // rounded tip apex
        PT(...at(tipR, -1, halfW * 0.9)),
        PT(...at(rr * 0.55, -1, halfW)),
        PT(...at(r0, -1, halfW * 0.95)),
        PT(ux * (r0 - halfW * 0.5), uy * (r0 - halfW * 0.5)),  // rounded base
      ];
      prims.push({ kind:'fill', pts, use:'fill' });
      if (withOutline) prims.push({ kind:'stroke', pts, closed: true });
    }
  };
  /* thicken an open polyline into a closed fillable ribbon */
  const ribbon = (pts, hw) => {
    const left = [], right = [];
    for (let i = 0; i < pts.length; i++){
      const o = pts[Math.max(i - 1, 0)], q = pts[Math.min(i + 1, pts.length - 1)];
      let dx = q[0] - o[0], dy = q[1] - o[1];
      const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      left.push([pts[i][0] - dy * hw, pts[i][1] + dx * hw]);
      right.push([pts[i][0] + dy * hw, pts[i][1] - dx * hw]);
    }
    return left.concat(right.reverse());
  };

  switch (el.kind || 'asterisk'){
    case 'asterisk': {
      asterCapsules(cx, cy, R, rx / R, ry / R, true);
      break;
    }
    case 'paperast':
    case 'paperthought': {
      /* the KoralPaper brand mark: wobbly page + asterisk (+ thought dots) */
      const isThought = el.kind === 'paperthought';
      const pw = isThought ? w * 0.84 : w, ph = isThought ? h * 0.76 : h;
      const px0 = x + (isThought ? w * 0.16 : 0), py0 = y;
      const rad = clamp(Math.min(pw, ph) * 0.15, 3, 22);
      prims.push({ kind:'stroke', pts: roundedRectOutline(px0, py0, pw, ph, rad), closed: true });
      asterCapsules(px0 + pw/2, py0 + ph/2, Math.min(pw, ph) * 0.34, 1, 1, false);
      if (isThought){
        const m = Math.min(w, h);
        prims.push({ kind:'dot', x: x + w * 0.115, y: y + h * 0.855, r: m * 0.055 });
        prims.push({ kind:'dot', x: x + w * 0.032, y: y + h * 0.965, r: m * 0.038 });
      }
      break;
    }
    case 'paperstroke': {
      /* wobbly page with a loose scribble across it */
      const rad = clamp(Math.min(w, h) * 0.15, 3, 22);
      prims.push({ kind:'stroke', pts: roundedRectOutline(x, y, w, h, rad), closed: true });
      const wave = (v, amp, ph2) => {
        const pts = [];
        for (let i = 0; i <= 16; i++){
          const t = i / 16;
          pts.push([x + w * (0.20 + 0.60 * t), y + h * v + Math.sin(t * TAU * 1.25 + ph2) * h * amp]);
        }
        return pts;
      };
      const hw = Math.min(w, h) * 0.05;
      prims.push({ kind:'fill', pts: ribbon(wave(0.40, 0.055, rnd.range(0, TAU)), hw), use:'fill' });
      prims.push({ kind:'fill', pts: ribbon(wave(0.62, 0.048, rnd.range(0, TAU)), hw), use:'fill' });
      break;
    }
    case 'spiral': {
      const turns = 2.6, n = 72;
      const phase = rnd.range(0, TAU);
      const pts = [];
      for (let i = 0; i <= n; i++){
        const t = i / n;
        const a = phase + t * turns * TAU;
        const r = 0.10 + 0.90 * t;
        pts.push([cx + Math.cos(a) * rx * r * 0.96, cy + Math.sin(a) * ry * r * 0.96]);
      }
      prims.push({ kind:'stroke', pts, closed: false });
      break;
    }
    case 'cloud': {
      const n = 44;
      const p1 = rnd.range(0, TAU), p2 = rnd.range(0, TAU);
      const pts = [];
      for (let i = 0; i < n; i++){
        const a = (i / n) * TAU;
        const puff = 0.78 + 0.15 * Math.abs(Math.sin(a * 2.5 + p1)) + 0.07 * Math.abs(Math.sin(a * 4 + p2));
        pts.push([cx + Math.cos(a) * rx * puff, cy + Math.sin(a) * ry * puff]);
      }
      prims.push({ kind:'fill', pts, use:'fill' });
      prims.push({ kind:'stroke', pts, closed: true });
      break;
    }
    case 'star': {
      const pts = [];
      for (let i = 0; i < 10; i++){
        const a = -Math.PI/2 + (i / 10) * TAU;
        const r = i % 2 === 0 ? 1 : 0.46;
        pts.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r]);
      }
      prims.push({ kind:'fill', pts, use:'fill' });
      prims.push({ kind:'stroke', pts, closed: true });
      break;
    }
    case 'heart': {
      const n = 44;
      const pts = [];
      for (let i = 0; i < n; i++){
        const t = (i / n) * TAU;
        const hx = 16 * Math.pow(Math.sin(t), 3);
        const hy = 13*Math.cos(t) - 5*Math.cos(2*t) - 2*Math.cos(3*t) - Math.cos(4*t);
        pts.push([cx + (hx / 17) * rx * 0.97, cy - (hy / 17) * ry * 0.97 + ry * 0.08]);
      }
      prims.push({ kind:'fill', pts, use:'fill' });
      prims.push({ kind:'stroke', pts, closed: true });
      break;
    }
    case 'bolt': {
      const pts = [P(.56,.02), P(.16,.52), P(.42,.52), P(.30,.98), P(.84,.40), P(.55,.40), P(.76,.02)];
      prims.push({ kind:'fill', pts, use:'fill' });
      prims.push({ kind:'stroke', pts, closed: true });
      break;
    }
    case 'bubble': {
      const bh = h * 0.74;
      const rad = clamp(Math.min(w, bh) * 0.28, 4, 26);
      const body = roundedRectOutline(x, y, w, bh, rad);
      // splice the tail into the bottom edge (outline order: tl,tr,br,bl arcs — 7 pts each)
      const yb = y + bh;
      const pts = body.slice(0, 21)
        .concat([[x + w*0.52, yb], [x + w*0.30, y + h], [x + w*0.38, yb]])
        .concat(body.slice(21));
      prims.push({ kind:'fill', pts, use:'fill' });
      prims.push({ kind:'stroke', pts, closed: true });
      break;
    }
    case 'bang': {
      const pts = [P(.42,.03), P(.58,.03), P(.545,.60), P(.455,.60)];
      prims.push({ kind:'fill', pts, use:'stroke' });
      prims.push({ kind:'dot', x: cx, y: y + h*0.84, r: Math.min(w, h) * 0.085 });
      break;
    }
    case 'question': {
      const pts = sampleQuad(P(.26,.30), P(.22,.03), P(.52,.05), 8)
        .concat(sampleQuad(P(.52,.05), P(.82,.07), P(.76,.33), 8).slice(1))
        .concat(sampleQuad(P(.76,.33), P(.70,.50), P(.51,.54), 6).slice(1));
      pts.push(P(.505,.66));
      prims.push({ kind:'stroke', pts, closed: false, widthMul: 1.5 });
      prims.push({ kind:'dot', x: x + w*0.505, y: y + h*0.87, r: Math.min(w, h) * 0.075 });
      break;
    }
    case 'check': {
      const pts = [P(.12,.55), P(.40,.84), P(.90,.16)];
      prims.push({ kind:'stroke', pts, closed: false, widthMul: 1.8 });
      break;
    }
  }
  return prims;
}

/* Google Material Symbols: path data lives ON the element (el.mpath, fetched
   once when stamped), so saved documents render fully offline. ViewBox is
   Google's "0 -960 960 960". */
function materialTransform(el){
  const b = boundsOf(el);
  const s = Math.min(b.w, b.h) / 960;
  return { s, tx: b.x + (b.w - 960 * s) / 2, ty: b.y + (b.h - 960 * s) / 2 + 960 * s };
}
function drawIcon(ctx, el, pal){
  const strokeColor = resolveStroke(pal, el.stroke);
  const fillColor = resolveFill(pal, el.fill);
  if (el.kind === 'material'){
    const col = strokeColor || fillColor;
    if (!col || !el.mpath) return;
    const { s, tx, ty } = materialTransform(el);
    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(s, s);
    ctx.fillStyle = col;
    ctx.fill(new Path2D(el.mpath));
    ctx.restore();
    return;
  }
  const dash = dashArrayOf(el);
  const patterned = el.fillStyle && el.fillStyle !== 'solid';
  let patternCache = null;
  for (const pr of iconPrims(el)){
    if (pr.kind === 'fill'){
      const col = pr.use === 'fill' ? fillColor : strokeColor;
      if (!col) continue;
      if (patterned && pr.use === 'fill'){
        if (!patternCache) patternCache = fillPatternPrims(el);
        ctx.save();
        traceFillPath(ctx, pr.pts, el.sketch === 0);
        ctx.clip();
        strokePatternPrims(ctx, el, col, patternCache);
        ctx.restore();
        continue;
      }
      traceFillPath(ctx, pr.pts, el.sketch === 0);
      ctx.fillStyle = col;
      ctx.fill();
    } else if (pr.kind === 'dot'){
      const col = strokeColor || fillColor;
      if (!col) continue;
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, pr.r, 0, TAU);
      ctx.fillStyle = col;
      ctx.fill();
    } else {
      if (!strokeColor) continue;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = el.sw * (pr.widthMul || 1);
      ctx.setLineDash(dash || []);
      sketchStroke(ctx, pr.pts, !!pr.closed, el, el.sketch);
      ctx.setLineDash([]);
    }
  }
}

function drawArrowhead(ctx, x, y, angle, size, el){
  const rnd = new Rand(el.seed + 3);
  const spread = 0.42;
  ctx.beginPath();
  const a1 = angle + Math.PI - spread + rnd.jitter(0.05);
  const a2 = angle + Math.PI + spread + rnd.jitter(0.05);
  ctx.moveTo(x + Math.cos(a1) * size, y + Math.sin(a1) * size);
  ctx.lineTo(x, y);
  ctx.lineTo(x + Math.cos(a2) * size, y + Math.sin(a2) * size);
  ctx.stroke();
}
/* head kinds: 'arrow' open V · 'triangle' hollow outline · 'circle' ring */
function headGeometry(el, kind, x, y, angle, size){
  const rnd = new Rand(el.seed + 5);
  if (kind === 'triangle'){
    const spread = 0.5;
    const a1 = angle + Math.PI - spread + rnd.jitter(0.04);
    const a2 = angle + Math.PI + spread + rnd.jitter(0.04);
    return { tri: [
      [x, y],
      [x + Math.cos(a1) * size * 1.15, y + Math.sin(a1) * size * 1.15],
      [x + Math.cos(a2) * size * 1.15, y + Math.sin(a2) * size * 1.15],
    ] };
  }
  if (kind === 'circle'){
    const r = size * 0.42;
    return { circ: [x - Math.cos(angle) * r, y - Math.sin(angle) * r, r] };
  }
  return null;
}
function drawHead(ctx, el, kind, x, y, angle, size, bg){
  if (kind === 'arrow'){ drawArrowhead(ctx, x, y, angle, size, el); return; }
  const g = headGeometry(el, kind, x, y, angle, size);
  if (!g) return;
  ctx.beginPath();
  if (g.tri){
    ctx.moveTo(g.tri[0][0], g.tri[0][1]);
    ctx.lineTo(g.tri[1][0], g.tri[1][1]);
    ctx.lineTo(g.tri[2][0], g.tri[2][1]);
    ctx.closePath();
  } else {
    ctx.arc(g.circ[0], g.circ[1], g.circ[2], 0, TAU);
  }
  if (bg){ ctx.fillStyle = bg; ctx.fill(); } // hollow: paper shows through
  ctx.stroke();
}

/* starting baseline offset for a text block inside a box, honoring valign */
function boxTextTop(el, box, totalH, pad){
  if (el.valign === 'top') return box.y + pad;
  if (el.valign === 'bottom') return box.y + box.h - pad - totalH;
  return box.y + box.h / 2 - totalH / 2;
}
/* draw text lines inside a box */
function drawBoxText(ctx, el, pal, box){
  if (el._editing) return;
  if (!el.text || !el.text.trim()) return;
  const pad = el.type === 'chip' ? 10 : 12;
  const maxW = Math.max(20, box.w - pad * 2);
  const lay = layoutText(el, maxW);
  ctx.font = fontCSS(el.font, el.size);
  applyTracking(ctx, el);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = (el.fill === 'ink') ? pal.bg : (resolveStroke(pal, el.stroke) || pal.stroke.ink);
  let ty = boxTextTop(el, box, lay.totalH, pad) + lay.lh / 2;
  for (const ln of lay.lines){
    if (ln.para) ty += lay.pgap;
    let tx;
    if (el.align === 'left'){ ctx.textAlign = 'left'; tx = box.x + pad; }
    else if (el.align === 'right'){ ctx.textAlign = 'right'; tx = box.x + box.w - pad; }
    else { ctx.textAlign = 'center'; tx = box.x + box.w/2; }
    ctx.fillText(ln.text, tx, ty);
    ty += lay.lh;
  }
  applyTracking(ctx, null);
}

function drawTextElement(ctx, el, pal){
  if (el._editing) return;
  const lay = layoutText(el, null);
  ctx.font = fontCSS(el.font, el.size);
  applyTracking(ctx, el);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = resolveStroke(pal, el.stroke) || pal.stroke.ink;
  let ty = el.y + lay.lh/2;
  for (const ln of lay.lines){
    if (ln.para) ty += lay.pgap;
    let tx;
    if (el.align === 'right'){ ctx.textAlign = 'right'; tx = el.x + el.w; }
    else if (el.align === 'center'){ ctx.textAlign = 'center'; tx = el.x + el.w/2; }
    else { ctx.textAlign = 'left'; tx = el.x; }
    ctx.fillText(ln.text, tx, ty);
    ty += lay.lh;
  }
  applyTracking(ctx, null);
}

/* ── images + algorithmic art ───────────────────────
   Imported images are elements. `artStyle` switches how the element renders:
   'photo' draws the bitmap; every other style reads the image as a brightness
   field and emits seeded vector primitives — so SVG exports stay pure vector. */
const ART_STYLES = ['photo','halftone','lines','stipple','hatch','poly','polymono','flow','scribble','contour','string','type','duotone'];
function hexAlpha(hex, a){
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
}
const IMG_CACHE = new Map();

/* luminance field + auto-contrast percentiles + Sobel-ish edge map —
   lines/stipple read these so dark photos still use the full tonal range */
function analyzeSampleBuffer(data, dw, dh){
  const n = dw * dh;
  const lums = new Float32Array(n);
  for (let i = 0; i < n; i++){
    const j = i * 4;
    lums[i] = data[j+3] < 40 ? 1
      : (0.299*data[j] + 0.587*data[j+1] + 0.114*data[j+2]) / 255;
  }
  const sorted = Float32Array.from(lums).sort();
  let lumLo = sorted[Math.floor(n * 0.03)];
  let lumHi = sorted[Math.min(n - 1, Math.floor(n * 0.97))];
  if (lumHi - lumLo < 0.08){ lumLo = 0; lumHi = 1; }
  const edge = new Float32Array(n);
  for (let y = 1; y < dh - 1; y++){
    for (let x = 1; x < dw - 1; x++){
      const i = y * dw + x;
      const ex = lums[i + 1] - lums[i - 1];
      const ey = lums[i + dw] - lums[i - dw];
      edge[i] = Math.min(1, Math.hypot(ex, ey) * 3);
    }
  }
  return { data, dw, dh, lum: lums, lumLo, lumHi, edge };
}

/* ── photo adjustments (brightness / contrast / gamma / sharpness) ──
   Applied to a cached full-res copy via a 256-entry LUT + optional unsharp
   mask. Both the Photo display and the art samplers read the adjusted copy,
   and the tonal analysis is recomputed on it. */
function adjKey(el){
  return `${el.bright || 0}|${el.contrast || 0}|${(el.gamma || 1).toFixed(2)}|${el.sharp || 0}`;
}
function buildAdjusted(base, el){
  const bright = (el.bright || 0) * 1.28;
  const cVal = (el.contrast || 0) * 2.55;
  const cf = (259 * (cVal + 255)) / (255 * (259 - cVal));
  const gamma = el.gamma || 1;
  const sharp = (el.sharp || 0) / 100;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++){
    let x = v + bright;
    x = cf * (x - 128) + 128;
    x = 255 * Math.pow(clamp(x, 0, 255) / 255, 1 / gamma);
    lut[v] = clamp(Math.round(x), 0, 255);
  }
  const c = document.createElement('canvas');
  c.width = base.img.naturalWidth; c.height = base.img.naturalHeight;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(base.img, 0, 0);
  const id = cx.getImageData(0, 0, c.width, c.height);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4){
    d[i] = lut[d[i]]; d[i+1] = lut[d[i+1]]; d[i+2] = lut[d[i+2]];
  }
  if (sharp > 0){
    const w = c.width, h = c.height;
    const src = Uint8ClampedArray.from(d);
    const amt = sharp * 1.4;
    for (let y = 1; y < h - 1; y++){
      for (let x = 1; x < w - 1; x++){
        const i = (y * w + x) * 4;
        for (let ch = 0; ch < 3; ch++){
          const j = i + ch;
          const blur = (src[j] * 4 + src[j-4] + src[j+4] + src[j-w*4] + src[j+w*4]) / 8;
          d[j] = clamp(Math.round(src[j] + (src[j] - blur) * amt), 0, 255);
        }
      }
    }
  }
  cx.putImageData(id, 0, 0);
  // re-analyze on a small copy of the adjusted pixels
  const s = Math.min(1, 220 / Math.max(c.width, c.height));
  const sw = Math.max(2, Math.round(c.width * s)), sh = Math.max(2, Math.round(c.height * s));
  const sc = document.createElement('canvas');
  sc.width = sw; sc.height = sh;
  const scx = sc.getContext('2d', { willReadFrequently: true });
  scx.drawImage(c, 0, 0, sw, sh);
  const entry = analyzeSampleBuffer(scx.getImageData(0, 0, sw, sh).data, sw, sh);
  return { canvas: c, entry };
}
function getAdjusted(el){
  const base = getImageEntry(el.src);
  if (!base.ready) return null;
  const key = adjKey(el);
  if (key === '0|0|1.00|0') return { canvas: base.img, entry: base };
  base.adj = base.adj || new Map();
  let a = base.adj.get(key);
  if (!a){
    a = buildAdjusted(base, el);
    base.adj.set(key, a);
    if (base.adj.size > 3) base.adj.delete(base.adj.keys().next().value);
  }
  return a;
}

function getImageEntry(src){
  let e = IMG_CACHE.get(src);
  if (e) return e;
  e = { img: new Image(), ready: false, data: null, dw: 0, dh: 0 };
  e.img.onload = () => {
    const s = Math.min(1, 220 / Math.max(e.img.naturalWidth, e.img.naturalHeight));
    e.dw = Math.max(2, Math.round(e.img.naturalWidth * s));
    e.dh = Math.max(2, Math.round(e.img.naturalHeight * s));
    const c = document.createElement('canvas');
    c.width = e.dw; c.height = e.dh;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(e.img, 0, 0, e.dw, e.dh);
    Object.assign(e, analyzeSampleBuffer(cx.getImageData(0, 0, e.dw, e.dh).data, e.dw, e.dh));
    e.ready = true;
    if (typeof requestRender === 'function') requestRender();
  };
  e.img.src = src;
  IMG_CACHE.set(src, e);
  return e;
}
function sampleRGBA(e, u, v){
  const x = clamp(Math.floor(u * e.dw), 0, e.dw - 1);
  const y = clamp(Math.floor(v * e.dh), 0, e.dh - 1);
  const i = (y * e.dw + x) * 4;
  return [e.data[i], e.data[i+1], e.data[i+2], e.data[i+3]];
}
function sampleLum(e, u, v){
  const [r, g, b, a] = sampleRGBA(e, u, v);
  if (a < 40) return 1; // transparency reads as paper (light)
  return (0.299*r + 0.587*g + 0.114*b) / 255;
}
function sampleLumN(e, u, v){
  // contrast-stretched luminance (3%..97% percentile window)
  const l = sampleLum(e, u, v);
  return clamp((l - e.lumLo) / Math.max(0.05, e.lumHi - e.lumLo), 0, 1);
}
function sampleEdge(e, u, v){
  if (!e.edge) return 0;
  const x = clamp(Math.floor(u * e.dw), 0, e.dw - 1);
  const y = clamp(Math.floor(v * e.dh), 0, e.dh - 1);
  return e.edge[y * e.dw + x];
}

function cropUV(el, u, v){
  const c = el.crop;
  if (!c) return [u, v];
  return [c[0] + u * (c[2] - c[0]), c[1] + v * (c[3] - c[1])];
}
function artPrims(el, entry){
  /* PRIMS ARE IN ELEMENT-LOCAL COORDS (0..w, 0..h) so moving the element
     never regenerates them — only resize / restyle / recrop does. */
  const cropKey = el.crop ? el.crop.map(n => n.toFixed(4)).join(',') : 'full';
  const key = `${el.artStyle}|${el.detail}|${Math.round(el.w)}x${Math.round(el.h)}|${el.seed}|${cropKey}|${adjKey(el)}`;
  if (el._pkey === key && el._prims) return el._prims;
  const rnd = new Rand(el.seed + 11);
  const b = { w: el.w, h: el.h }; // local space
  const d = clamp(el.detail || 2, 1, 3);
  const prims = { dots: [], segs: [], paths: [], tris: [], rects: [], glyphs: [] };
  const X = u => u * b.w, Y = v => v * b.h;
  const lum = (u, v) => sampleLum(entry, ...cropUV(el, u, v));

  if (el.artStyle === 'halftone'){
    const cols = [26, 38, 72][d-1];
    const cw = b.w / cols;
    const rows = Math.max(2, Math.round(b.h / cw));
    for (let r = 0; r < rows; r++){
      for (let c = 0; c < cols; c++){
        const u = (c + 0.5) / cols, v = (r + 0.5) / rows;
        const dark = 1 - lum(u, v);
        const rad = cw * 0.52 * Math.pow(dark, 0.85);
        if (rad > cw * 0.06)
          prims.dots.push([X(u) + rnd.jitter(cw*0.06), Y(v) + rnd.jitter(cw*0.06), rad]);
      }
    }
  }
  else if (el.artStyle === 'lines'){
    /* tight rows + contrast-stretched tone with gamma, so light areas run
       nearly straight and dark areas churn — subjects read against busy fields */
    const lumN = (u, v) => sampleLumN(entry, ...cropUV(el, u, v));
    const rows = [40, 60, 110][d-1];
    const rh = b.h / rows;
    const step = Math.max(1, b.w / 300);
    for (let r = 0; r < rows; r++){
      const v = (r + 0.5) / rows;
      const pts = [];
      let ph = rnd.range(0, TAU);
      for (let x = 0; x <= b.w; x += step){
        const dark = Math.pow(1 - lumN(x / b.w, v), 1.5);
        ph += 0.2 + dark * 2.6;                        // darker → busier
        pts.push([x, Y(v) + Math.sin(ph) * rh * 0.47 * dark]);
      }
      prims.paths.push(pts);
    }
  }
  else if (el.artStyle === 'stipple'){
    /* density saturates in true darks (solid shape, not grain) + edge
       emphasis keeps contours readable regardless of tone */
    const lumN = (u, v) => sampleLumN(entry, ...cropUV(el, u, v));
    const edgeAt = (u, v) => sampleEdge(entry, ...cropUV(el, u, v));
    const target = [2600, 5200, 12000][d-1];
    const rBase = Math.max(0.55, (b.w + b.h) / 2 * 0.0030);
    let placed = 0, tries = 0;
    while (placed < target && tries < target * 8){
      tries++;
      const u = rnd.next(), v = rnd.next();
      const dark = 1 - lumN(u, v);
      const p = Math.min(1, Math.pow(dark, 1.6) * 1.35 + edgeAt(u, v) * 0.85);
      if (rnd.next() < p){
        prims.dots.push([X(u), Y(v), rBase * (0.6 + dark * 0.6)]);
        placed++;
      }
    }
  }
  else if (el.artStyle === 'hatch'){
    const cols = [26, 38, 66][d-1];
    const cw = b.w / cols;
    const rows = Math.max(2, Math.round(b.h / cw));
    for (let r = 0; r < rows; r++){
      for (let c = 0; c < cols; c++){
        const u = (c + 0.5) / cols, v = (r + 0.5) / rows;
        const dark = 1 - lum(u, v);
        const x0 = c * cw, y0 = r * (b.h / rows);
        const ch = b.h / rows;
        const j = () => rnd.jitter(cw * 0.1);
        if (dark > 0.22) prims.segs.push([x0 + j(), y0 + ch + j(), x0 + cw + j(), y0 + j()]);
        if (dark > 0.5)  prims.segs.push([x0 + j(), y0 + j(), x0 + cw + j(), y0 + ch + j()]);
        if (dark > 0.75) prims.segs.push([x0 + cw*0.5 + j(), y0 + ch + j(), x0 + cw + j(), y0 + ch*0.5 + j()]);
      }
    }
  }
  else if (el.artStyle === 'poly' || el.artStyle === 'polymono'){
    const mono = el.artStyle === 'polymono';
    const cols = [14, 22, 34][d-1];
    const rows = Math.max(2, Math.round(cols * b.h / b.w));
    const grid = [];
    for (let r = 0; r <= rows; r++){
      grid[r] = [];
      for (let c = 0; c <= cols; c++){
        const edgeX = c === 0 || c === cols, edgeY = r === 0 || r === rows;
        grid[r][c] = [
          X(c / cols) + (edgeX ? 0 : rnd.jitter(b.w / cols * 0.3)),
          Y(r / rows) + (edgeY ? 0 : rnd.jitter(b.h / rows * 0.3)),
        ];
      }
    }
    const facetAt = (pts) => {
      const cu = (pts[0][0] + pts[1][0] + pts[2][0]) / 3, cv = (pts[0][1] + pts[1][1] + pts[2][1]) / 3;
      const [u2, v2] = cropUV(el, cu / b.w, cv / b.h);
      const [r, g, bl, a] = sampleRGBA(entry, u2, v2);
      if (a < 40) return null;
      if (mono){
        // facets as shades of the stroke color — tint resolves at draw time
        const dark = 1 - sampleLumN(entry, u2, v2);
        return { shade: clamp(Math.pow(dark, 1.1) + rnd.jitter(0.05), 0, 1) };
      }
      const k = 1 + rnd.jitter(0.07); // faceted light, the cubist wink
      return { color: `rgb(${clamp(Math.round(r*k),0,255)},${clamp(Math.round(g*k),0,255)},${clamp(Math.round(bl*k),0,255)})` };
    };
    for (let r = 0; r < rows; r++){
      for (let c = 0; c < cols; c++){
        const p00 = grid[r][c], p10 = grid[r][c+1], p01 = grid[r+1][c], p11 = grid[r+1][c+1];
        const pair = rnd.next() < 0.5
          ? [[p00, p10, p11], [p00, p11, p01]]
          : [[p00, p10, p01], [p10, p11, p01]];
        for (const tri of pair){
          const f = facetAt(tri);
          if (f) prims.tris.push({ pts: tri, ...f });
        }
      }
    }
  }

  else if (el.artStyle === 'flow'){
    /* streamlines along the luminance contour field: stroke direction is the
       90°-rotated gradient, so lines wrap around features like engraving */
    const lumN = (u, v) => sampleLumN(entry, ...cropUV(el, u, v));
    const eps = 1.5 / entry.dw;
    const smooth = (u, v) =>
      (lumN(u, v) * 2 + lumN(u+eps, v) + lumN(u-eps, v) + lumN(u, v+eps) + lumN(u, v-eps)) / 6;
    const dirAt = (u, v) => {
      const gx = smooth(u+eps, v) - smooth(u-eps, v);
      const gy = smooth(u, v+eps) - smooth(u, v-eps);
      const m = Math.hypot(gx, gy);
      if (m < 0.004) return null;
      return [-gy / m, gx / m];
    };
    const seeds = [1000, 1900, 3400][d-1];
    const stepL = 1 / [70, 95, 130][d-1];
    const cell = 1 / [48, 66, 92][d-1];
    const occ = new Map();
    const okey = (u, v) => ((u / cell) | 0) * 4096 + ((v / cell) | 0);
    const occMax = dark => dark > 0.75 ? 3 : dark > 0.4 ? 2 : 1;
    const edgeAt2 = (u, v) => sampleEdge(entry, ...cropUV(el, u, v));
    let made = 0, tries = 0;
    while (made < seeds && tries < seeds * 4){
      tries++;
      const u0 = rnd.next(), v0 = rnd.next();
      const dark0 = 1 - lumN(u0, v0);
      if (rnd.next() > 0.06 + Math.pow(dark0, 1.15) + edgeAt2(u0, v0) * 0.5) continue;
      if ((occ.get(okey(u0, v0)) || 0) >= occMax(dark0)) continue;
      const line = [[u0, v0]];
      const maxSteps = 5 + Math.round(dark0 * 15);
      // flat regions have no gradient — shade them with a steady per-stroke bearing
      const fa = rnd.range(0, TAU);
      const fallback = [Math.cos(fa), Math.sin(fa)];
      for (const sgn of [1, -1]){
        let u = u0, v = v0, dprev = null;
        for (let i = 0; i < maxSteps; i++){
          let t = dirAt(u, v) || dprev || fallback;
          if (!t) break;
          if (dprev && (t[0]*dprev[0] + t[1]*dprev[1]) < 0) t = [-t[0], -t[1]];
          u += t[0] * stepL * sgn;
          v += t[1] * stepL * sgn;
          if (u < 0.002 || u > 0.998 || v < 0.002 || v > 0.998) break;
          if ((occ.get(okey(u, v)) || 0) >= occMax(1 - lumN(u, v))) break;
          sgn === 1 ? line.push([u, v]) : line.unshift([u, v]);
          dprev = t;
        }
      }
      if (line.length < 4) continue;
      for (const [u, v] of line){
        const k2 = okey(u, v);
        occ.set(k2, (occ.get(k2) || 0) + 1);
      }
      prims.paths.push({
        pts: line.map(([u, v]) => [u * b.w, v * b.h]),
        wMul: 0.45 + dark0 * 0.8,
      });
      made++;
    }
  }

  else if (el.artStyle === 'contour'){
    /* ONE-LINE portrait, Edge-Drawing style (Topal & Akinlar):
       blur → Sobel magnitude/orientation → anchor points (gradient maxima)
       → walk along each edge picking the strongest neighboring edge pixel
       → long clean contour chains → keep the most salient → connect nearest
       endpoints into a single continuous traveling line. */
    const dw = entry.dw, dh = entry.dh;
    const cc = el.crop || [0, 0, 1, 1];
    const px0 = clamp(Math.floor(cc[0] * dw), 0, dw - 3);
    const px1 = clamp(Math.ceil(cc[2] * dw), px0 + 3, dw);
    const py0 = clamp(Math.floor(cc[1] * dh), 0, dh - 3);
    const py1 = clamp(Math.ceil(cc[3] * dh), py0 + 3, dh);
    const W2 = px1 - px0, H2 = py1 - py0, N = W2 * H2;
    let L = new Float32Array(N);
    for (let y = 0; y < H2; y++)
      for (let x = 0; x < W2; x++)
        L[y * W2 + x] = entry.lum[(y + py0) * dw + (x + px0)];
    const blur = src => {
      const out = new Float32Array(N);
      for (let y = 0; y < H2; y++){
        for (let x = 0; x < W2; x++){
          let s = 0, n = 0;
          for (let dy = -1; dy <= 1; dy++){
            for (let dx = -1; dx <= 1; dx++){
              const xx = x + dx, yy = y + dy;
              if (xx >= 0 && xx < W2 && yy >= 0 && yy < H2){ s += src[yy * W2 + xx]; n++; }
            }
          }
          out[y * W2 + x] = s / n;
        }
      }
      return out;
    };
    L = blur(blur(L));
    const at = (x, y) => L[clamp(y, 0, H2 - 1) * W2 + clamp(x, 0, W2 - 1)];
    const mag = new Float32Array(N);
    const horiz = new Uint8Array(N); // 1 → edge runs horizontally (walk in x)
    for (let y = 0; y < H2; y++){
      for (let x = 0; x < W2; x++){
        const gx = (at(x+1,y-1) + 2*at(x+1,y) + at(x+1,y+1)) - (at(x-1,y-1) + 2*at(x-1,y) + at(x-1,y+1));
        const gy = (at(x-1,y+1) + 2*at(x,y+1) + at(x+1,y+1)) - (at(x-1,y-1) + 2*at(x,y-1) + at(x+1,y-1));
        const i = y * W2 + x;
        mag[i] = Math.hypot(gx, gy);
        horiz[i] = Math.abs(gy) > Math.abs(gx) ? 1 : 0;
      }
    }
    const sample = [];
    for (let i = 0; i < N; i += 3) if (mag[i] > 0.02) sample.push(mag[i]);
    sample.sort((a, b2) => a - b2);
    const q = p => sample.length ? sample[Math.floor(p * (sample.length - 1))] : 0.1;
    const hiT = q([0.93, 0.9, 0.82][d-1]);
    const loT = Math.max(q(0.55), hiT * 0.32);
    // anchors: maxima across the gradient direction
    const anchors = [];
    for (let y = 1; y < H2 - 1; y++){
      for (let x = 1; x < W2 - 1; x++){
        const i = y * W2 + x;
        if (mag[i] < hiT) continue;
        if (horiz[i] ? (mag[i] >= mag[i - W2] && mag[i] >= mag[i + W2])
                     : (mag[i] >= mag[i - 1] && mag[i] >= mag[i + 1]))
          anchors.push(i);
      }
    }
    anchors.sort((a, b2) => mag[b2] - mag[a]);
    const visited = new Uint8Array(N);
    const walk = (sx, sy, sgn) => {
      const pts = [];
      let x = sx, y = sy;
      for (let s = 0; s < 2500; s++){
        if (x < 1 || x >= W2 - 1 || y < 1 || y >= H2 - 1) break;
        const i = y * W2 + x;
        if (visited[i] || mag[i] < loT) break;
        visited[i] = 1;
        pts.push([x, y]);
        const cands = horiz[i]
          ? [[x + sgn, y - 1], [x + sgn, y], [x + sgn, y + 1]]
          : [[x - 1, y + sgn], [x, y + sgn], [x + 1, y + sgn]];
        let bx = -1, by = -1, bm = -1;
        for (const [cx2, cy2] of cands){
          if (cx2 < 0 || cx2 >= W2 || cy2 < 0 || cy2 >= H2) continue;
          const ci = cy2 * W2 + cx2;
          if (visited[ci]) continue;
          if (mag[ci] > bm){ bm = mag[ci]; bx = cx2; by = cy2; }
        }
        if (bm < loT) break;
        x = bx; y = by;
      }
      return pts;
    };
    const chains = [];
    const minLen = Math.max(6, Math.min(W2, H2) * [0.09, 0.09, 0.065][d-1]);
    for (const a of anchors){
      if (visited[a]) continue;
      const ax = a % W2, ay = (a / W2) | 0;
      const back = walk(ax, ay, -1);
      if (back.length) visited[a] = 0; // let the forward walk restart at the seed
      const fwd = walk(ax, ay, 1);
      const chain = back.reverse().concat(fwd.length ? fwd.slice(back.length ? 1 : 0) : []);
      if (chain.length >= minLen) chains.push(chain);
    }
    chains.sort((A, B) => B.length - A.length);
    const kept = chains.slice(0, [8, 14, 30][d-1]);
    const paths = kept.map(ch => {
      const pts = [];
      for (let i = 0; i < ch.length; i += 3) pts.push([ch[i][0], ch[i][1]]);
      if ((ch.length - 1) % 3) pts.push([ch[ch.length-1][0], ch[ch.length-1][1]]);
      for (let pass = 0; pass < 3; pass++)
        for (let i = 1; i < pts.length - 1; i++)
          pts[i] = [(pts[i-1][0] + pts[i][0] * 2 + pts[i+1][0]) / 4,
                    (pts[i-1][1] + pts[i][1] * 2 + pts[i+1][1]) / 4];
      return pts.map(([x, y]) => [(x + 0.5) / W2 * b.w, (y + 0.5) / H2 * b.h]);
    }).filter(p => p.length > 3);
    if (paths.length){
      paths.sort((A, B) => B.length - A.length);
      /* connectors are Hermite curves: leave the last contour along its own
         tangent, arrive at the next along its tangent — swooping pen travel,
         never straight segments or sharp junction angles */
      const hermite = (p0, m0, p1, m1, n) => {
        const out = [];
        for (let i = 1; i < n; i++){
          const t = i / n, t2 = t*t, t3 = t2*t;
          const h00 = 2*t3 - 3*t2 + 1, h10 = t3 - 2*t2 + t;
          const h01 = -2*t3 + 3*t2, h11 = t3 - t2;
          out.push([
            h00*p0[0] + h10*m0[0] + h01*p1[0] + h11*m1[0],
            h00*p0[1] + h10*m0[1] + h01*p1[1] + h11*m1[1],
          ]);
        }
        return out;
      };
      const tangent = (a, b2, scale) => {
        const dx = b2[0] - a[0], dy = b2[1] - a[1];
        const m = Math.hypot(dx, dy) || 1;
        return [dx / m * scale, dy / m * scale];
      };
      const line = paths.shift().slice();
      while (paths.length){
        const end = line[line.length - 1];
        let bi = 0, brev = false, bd = Infinity;
        for (let i2 = 0; i2 < paths.length; i2++){
          const p = paths[i2];
          const d0 = dist(end[0], end[1], p[0][0], p[0][1]);
          const d1 = dist(end[0], end[1], p[p.length-1][0], p[p.length-1][1]);
          if (d0 < bd){ bd = d0; bi = i2; brev = false; }
          if (d1 < bd){ bd = d1; bi = i2; brev = true; }
        }
        const nxt = paths.splice(bi, 1)[0];
        if (brev) nxt.reverse();
        const prev = line[line.length - 2] || end;
        const start = nxt[0], second = nxt[1] || start;
        const sc = clamp(bd * 0.9, 10, 70);
        line.push(
          ...hermite(end, tangent(prev, end, sc), start, tangent(start, second, sc),
            clamp(Math.round(bd / 5) + 3, 4, 16)),
          ...nxt);
      }
      prims.paths.push(line);
    }
  }
  else if (el.artStyle === 'scribble'){
    /* one restless pen, constant width: every coverage cell "owes" ink
       proportional to its darkness (+ an edge bonus); the walker steps toward
       the largest residual debt, with turns penalized by local brightness —
       so it curls tightly inside shadows and glides through highlights. */
    const lumN = (u, v) => sampleLumN(entry, ...cropUV(el, u, v));
    const edgeAt = (u, v) => sampleEdge(entry, ...cropUV(el, u, v));
    const G = [42, 58, 80][d-1];
    const gw = G, gh = Math.max(4, Math.round(G * b.h / b.w));
    const cw = b.w / gw, chh = b.h / gh;
    const target = new Float32Array(gw * gh);
    const inked = new Float32Array(gw * gh);
    const order = [];
    let totalDebt = 0;
    for (let cy = 0; cy < gh; cy++){
      for (let cx = 0; cx < gw; cx++){
        const u = (cx + 0.5) / gw, v = (cy + 0.5) / gh;
        const dark = 1 - lumN(u, v);
        const i = cy * gw + cx;
        target[i] = 6.0 * Math.pow(dark, 1.2) + edgeAt(u, v) * 2.2;
        totalDebt += target[i];
        order.push(i);
      }
    }
    order.sort((a, b2) => target[b2] - target[a]);
    const idxAt = (x, y) =>
      clamp((y / chh) | 0, 0, gh - 1) * gw + clamp((x / cw) | 0, 0, gw - 1);
    const res = i => target[i] - inked[i];
    const step = Math.max(2.2, cw * 0.85);
    // the pen keeps drawing until the whole image's ink debt is paid (capped)
    const budget = Math.min([9000, 18000, 34000][d-1], Math.round(totalDebt * 1.05));
    let steps = 0, seedPtr = 0;
    while (steps < budget){
      while (seedPtr < order.length - 1 && res(order[seedPtr]) <= 0.35) seedPtr++;
      if (res(order[seedPtr]) <= 0.35) break; // image fully paid off
      const sc = order[seedPtr];
      let x = ((sc % gw) + rnd.next()) * cw;
      let y = (((sc / gw) | 0) + rnd.next()) * chh;
      let heading = rnd.range(0, TAU);
      const pts = [[x, y]];
      let stuck = 0;
      while (steps < budget && stuck < 8 && pts.length < 420){
        steps++;
        let best = null;
        for (let c = 0; c < 7; c++){
          const off = (c / 6 - 0.5) * 3.8; // candidate turns up to ±109°
          const a = heading + off + rnd.jitter(0.25);
          const nx = x + Math.cos(a) * step, ny = y + Math.sin(a) * step;
          if (nx < 1 || nx > b.w - 1 || ny < 1 || ny > b.h - 1) continue;
          const i = idxAt(nx, ny);
          const turnPen = Math.abs(off) * (0.12 + lumN(nx / b.w, ny / b.h) * 0.55);
          const score = res(i) - turnPen + rnd.jitter(0.15);
          if (!best || score > best.score) best = { score, a, nx, ny, i };
        }
        if (!best) break;
        stuck = res(best.i) <= 0 ? stuck + 1 : 0;
        heading = best.a; x = best.nx; y = best.ny;
        inked[best.i] += 1;
        pts.push([x, y]);
      }
      if (pts.length > 3) prims.paths.push(pts);
      else steps += 3;
    }
  }

  else if (el.artStyle === 'string'){
    /* one thread around a ring of pins: each next pin is chosen greedily so
       the chord crosses the most unpaid darkness; crossing threads add up */
    const lumN = (u, v) => sampleLumN(entry, ...cropUV(el, u, v));
    const Gs = [56, 72, 96][d-1];
    const gw = Gs, gh = Math.max(4, Math.round(Gs * b.h / b.w));
    const res = new Float32Array(gw * gh);
    for (let cy = 0; cy < gh; cy++)
      for (let cx = 0; cx < gw; cx++)
        res[cy * gw + cx] = Math.pow(1 - lumN((cx + 0.5) / gw, (cy + 0.5) / gh), 1.15) * 1.7;
    const P = [140, 190, 250][d-1];
    const cx0 = b.w / 2, cy0 = b.h / 2, rx = b.w / 2 * 0.99, ry = b.h / 2 * 0.99;
    const pins = [];
    for (let i = 0; i < P; i++){
      const a = (i / P) * TAU;
      pins.push([cx0 + Math.cos(a) * rx, cy0 + Math.sin(a) * ry]);
    }
    const cellAt = (x, y) =>
      clamp((y / b.h * gh) | 0, 0, gh - 1) * gw + clamp((x / b.w * gw) | 0, 0, gw - 1);
    const chords = [1600, 2700, 4300][d-1];
    const INK = 0.26, S = 26;
    let cur = 0, dry = 0;
    for (let c = 0; c < chords && dry < 40; c++){
      let bestJ = (cur + (P >> 1)) % P, bestScore = -Infinity;
      for (let t = 0; t < 60; t++){
        const j = (cur + 8 + ((rnd.next() * (P - 16)) | 0)) % P;
        let s = 0;
        for (let k = 1; k <= S; k++){
          const f = k / (S + 1);
          // each sample pays a toll: chords must EARN their crossings,
          // so exhausted and light regions stay uncrossed (contrast!)
          s += res[cellAt(
            pins[cur][0] + (pins[j][0] - pins[cur][0]) * f,
            pins[cur][1] + (pins[j][1] - pins[cur][1]) * f)] - 0.07;
        }
        if (s > bestScore){ bestScore = s; bestJ = j; }
      }
      if (bestScore / S < 0.02){ dry++; } else dry = 0;
      for (let k = 1; k <= S; k++){
        const f = k / (S + 1);
        const i2 = cellAt(
          pins[cur][0] + (pins[bestJ][0] - pins[cur][0]) * f,
          pins[cur][1] + (pins[bestJ][1] - pins[cur][1]) * f);
        res[i2] = Math.max(-0.35, res[i2] - INK);
      }
      prims.segs.push([pins[cur][0], pins[cur][1], pins[bestJ][0], pins[bestJ][1]]);
      cur = bestJ;
    }
  }
  else if (el.artStyle === 'type'){
    /* typewriter portrait: a monospace glyph per cell, chosen by darkness */
    const lumN = (u, v) => sampleLumN(entry, ...cropUV(el, u, v));
    const RAMP = ' .·:;=+*xoeaXHM@';
    const cols = [38, 56, 80][d-1];
    const cw2 = b.w / cols;
    const ch2 = cw2 * 1.72;
    const rows = Math.max(2, Math.round(b.h / ch2));
    prims.glyphSize = ch2 * 1.02;
    for (let r = 0; r < rows; r++){
      for (let c = 0; c < cols; c++){
        const dark = 1 - lumN((c + 0.5) / cols, (r + 0.5) / rows);
        const idx = Math.round(Math.pow(dark, 1.05) * (RAMP.length - 1));
        if (idx <= 0) continue;
        prims.glyphs.push({
          x: (c + 0.5) * cw2,
          y: (r + 0.5) * (b.h / rows),
          ch: RAMP[idx],
        });
      }
    }
  }
  else if (el.artStyle === 'duotone'){
    /* two-ink print poster: posterize into shadow (stroke color) and midtone
       (fill color) cells, merged into row runs — levels resolve at draw time
       so the poster re-inks with your palette and theme */
    const lumN = (u, v) => sampleLumN(entry, ...cropUV(el, u, v));
    const cols = [48, 72, 104][d-1];
    const cw2 = b.w / cols;
    const rows = Math.max(2, Math.round(b.h / cw2));
    const rh2 = b.h / rows;
    for (let r = 0; r < rows; r++){
      let runStart = -1, runLevel = 0;
      const flush = endC => {
        if (runLevel > 0 && runStart >= 0)
          prims.rects.push({
            x: runStart * cw2, y: r * rh2,
            w: (endC - runStart) * cw2 + 0.6, h: rh2 + 0.6,
            level: runLevel,
          });
        runStart = -1; runLevel = 0;
      };
      for (let c = 0; c < cols; c++){
        const dark = 1 - lumN((c + 0.5) / cols, (r + 0.5) / rows) + rnd.jitter(0.025);
        const level = dark > 0.60 ? 2 : dark > 0.30 ? 1 : 0;
        if (level !== runLevel){ flush(c); if (level > 0){ runStart = c; runLevel = level; } }
      }
      flush(cols);
    }
  }

  el._prims = prims;
  el._pkey = key;
  return prims;
}

function drawImageEl(ctx, el, pal){
  const b = boundsOf(el);
  if (!el.src) return;
  const entry = getImageEntry(el.src);
  if (!entry.ready){
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.setLineDash([]);
    return;
  }
  const A = getAdjusted(el);
  if (!el.artStyle || el.artStyle === 'photo'){
    const src = A.canvas;
    const nw = src.naturalWidth || src.width, nh = src.naturalHeight || src.height;
    const c = el.crop;
    if (c){
      ctx.drawImage(src,
        c[0] * nw, c[1] * nh, Math.max(1, (c[2] - c[0]) * nw), Math.max(1, (c[3] - c[1]) * nh),
        b.x, b.y, b.w, b.h);
    } else {
      ctx.drawImage(src, b.x, b.y, b.w, b.h);
    }
    return;
  }
  const prims = artPrims(el, A.entry);
  const col = resolveStroke(pal, el.stroke) || pal.stroke.ink;
  ctx.save();
  ctx.translate(b.x, b.y); // prims are element-local
  for (const t of prims.tris){
    ctx.beginPath();
    ctx.moveTo(t.pts[0][0], t.pts[0][1]);
    ctx.lineTo(t.pts[1][0], t.pts[1][1]);
    ctx.lineTo(t.pts[2][0], t.pts[2][1]);
    ctx.closePath();
    ctx.fillStyle = t.color || hexAlpha(col, 0.06 + t.shade * 0.94);
    ctx.fill();
  }
  if (prims.dots.length){
    ctx.beginPath();
    for (const [dx, dy, r] of prims.dots){ ctx.moveTo(dx + r, dy); ctx.arc(dx, dy, r, 0, TAU); }
    ctx.fillStyle = col;
    ctx.fill();
  }
  if (prims.rects.length){
    const midCol = resolveFill(pal, el.fill) || hexAlpha(col, 0.45);
    for (const r of prims.rects){
      ctx.fillStyle = r.level === 2 ? col : midCol;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
  }
  if (prims.glyphs.length){
    ctx.font = fontCSS('jetbrains', prims.glyphSize);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = col;
    for (const gph of prims.glyphs) ctx.fillText(gph.ch, gph.x, gph.y);
  }
  if (prims.segs.length){
    const stringy = el.artStyle === 'string';
    ctx.strokeStyle = stringy ? hexAlpha(col, 0.82) : col;
    ctx.lineWidth = stringy ? Math.max(0.5, el.sw * 0.32) : Math.max(0.8, el.sw * 0.5);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of prims.segs){ ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
    ctx.stroke();
  }
  if (prims.paths.length){
    ctx.strokeStyle = col;
    const baseW = Math.max(0.8, el.sw * 0.5);
    for (const p of prims.paths){
      const pts = p.pts || p;
      ctx.lineWidth = baseW * (p.wMul || 1);
      strokePolyline(ctx, pts);
    }
  }
  ctx.restore();
}

/* ── main element renderer ─────────────────────────── */
function drawElement(ctx, el, pal, bg){
  ctx.save();
  ctx.globalAlpha = (el.opacity == null ? 100 : el.opacity) / 100;
  const b = boundsOf(el);
  if (el.angle){
    const cx = b.x + b.w/2, cy = b.y + b.h/2;
    ctx.translate(cx, cy); ctx.rotate(el.angle); ctx.translate(-cx, -cy);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const strokeColor = resolveStroke(pal, el.stroke);
  if (strokeColor) ctx.strokeStyle = strokeColor;
  ctx.lineWidth = el.sw;
  const dash = dashArrayOf(el);

  if (el.type === 'image'){
    drawImageEl(ctx, el, pal);
    ctx.restore();
    return;
  }
  if (el.type === 'icon'){
    drawIcon(ctx, el, pal);
    ctx.restore();
    return;
  }
  if (el.type === 'text'){
    drawTextElement(ctx, el, pal);
    ctx.restore();
    return;
  }
  if (isLinear(el)){
    if (!strokeColor){ ctx.restore(); return; }
    const pts = linearPathPoints(el);
    ctx.setLineDash(dash || []);
    if (el.type === 'draw'){
      const rnd = new Rand(el.seed);
      const jpts = el.sketch === 2 ? pts.map(p => [p[0] + rnd.jitter(1), p[1] + rnd.jitter(1)]) : pts;
      strokePolyline(ctx, jpts);
    } else {
      sketchStroke(ctx, pts, false, el, el.sketch);
      ctx.setLineDash([]); // arrowheads stay solid
      const hs = clamp(9 + el.sw * 2.2, 10, 22);
      if (el.endHead && el.endHead !== 'none' && pts.length >= 2){
        const [ax, ay] = pts[pts.length-2], [bx, by] = pts[pts.length-1];
        drawHead(ctx, el, el.endHead, bx, by, Math.atan2(by-ay, bx-ax), hs, bg);
      }
      if (el.startHead && el.startHead !== 'none' && pts.length >= 2){
        const [ax, ay] = pts[1], [bx, by] = pts[0];
        drawHead(ctx, el, el.startHead, bx, by, Math.atan2(by-ay, bx-ax), hs, bg);
      }
      /* label riding the midpoint — derived from the path, so it follows
         every move, bend, and re-anchor automatically */
      if (el.text && el.text.trim() && !el._editing){
        const mid = pathMidpoint(pts);
        const lay = layoutText(el, null);
        ctx.font = fontCSS(el.font, el.size);
        applyTracking(ctx, el);
        const padX = 7, padY = 3;
        const bw2 = lay.w + padX * 2, bh2 = lay.totalH + padY * 2;
        const x0 = mid[0] - bw2/2, y0 = mid[1] - bh2/2;
        if (bg){
          ctx.fillStyle = bg;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(x0, y0, bw2, bh2, 7);
          else ctx.rect(x0, y0, bw2, bh2);
          ctx.fill();
        }
        ctx.fillStyle = resolveStroke(pal, el.stroke) || pal.stroke.ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        let ly = y0 + padY + lay.lh/2;
        for (const ln of lay.lines){
          if (ln.para) ly += lay.pgap;
          ctx.fillText(ln.text, mid[0], ly);
          ly += lay.lh;
        }
        applyTracking(ctx, null);
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
    return;
  }

  /* filled sketchy shapes */
  const outline = shapeOutline(el);
  if (el.fill && el.fill !== 'none'){
    const fillColor = resolveFill(pal, el.fill);
    if (fillColor){
      if (el.fillStyle && el.fillStyle !== 'solid'){
        patternFill(ctx, outline, el, fillColor);
      } else {
        traceFillPath(ctx, outline, el.sketch === 0);
        ctx.fillStyle = fillColor;
        ctx.fill();
      }
    }
  }
  if (strokeColor){
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = el.sw;
    ctx.setLineDash(dash || []);
    sketchStroke(ctx, outline, true, el, el.sketch);
    ctx.setLineDash([]);
  }
  drawBoxText(ctx, el, pal, b);
  ctx.restore();
}

/* ── whole-scene renderer (screen + PNG export) ────── */
function renderScene(ctx, elements, opts){
  const { width, height, camera, pal, grid, gridSize, board } = opts;
  setRouteContext(elements);
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  if (!opts.transparent){
    // with an artboard, the area outside it is dimmed; the board is the paper
    ctx.fillStyle = (board && opts.outside) ? opts.outside : (opts.bg || pal.bg);
    ctx.fillRect(0, 0, width, height);
  }
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.z, camera.z);

  if (board && !opts.transparent){
    ctx.fillStyle = opts.bg || pal.bg;
    ctx.fillRect(board.x, board.y, board.w, board.h);
  }

  if (grid && grid !== 'off' && !opts.transparent){
    ctx.save();
    if (board){
      ctx.beginPath();
      ctx.rect(board.x, board.y, board.w, board.h);
      ctx.clip(); // grid lives only on the artboard
    }
    let gs = gridSize || 22;
    if (grid === 'dots'){ while (gs * camera.z < 11) gs *= 2; } // keep dots sparse when zoomed out
    const x0 = Math.floor((-camera.x / camera.z) / gs) * gs;
    const y0 = Math.floor((-camera.y / camera.z) / gs) * gs;
    const x1 = (-camera.x + width) / camera.z, y1 = (-camera.y + height) / camera.z;
    const gridColor = opts.gridColor || pal.grid;
    if (grid === 'dots'){
      ctx.fillStyle = gridColor;
      const r = 1.4 / camera.z;
      ctx.beginPath();
      for (let gx = x0; gx <= x1 + gs; gx += gs){
        for (let gy = y0; gy <= y1 + gs; gy += gs){
          ctx.moveTo(gx + r, gy);
          ctx.arc(gx, gy, r, 0, TAU);
        }
      }
      ctx.fill();
    } else {
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1 / camera.z;
      ctx.beginPath();
      for (let gx = x0; gx <= x1; gx += gs){ ctx.moveTo(gx, y0); ctx.lineTo(gx, y1 + gs); }
      for (let gy = y0; gy <= y1; gy += gs){ ctx.moveTo(x0, gy); ctx.lineTo(x1 + gs, gy); }
      ctx.stroke();
    }
    ctx.restore();
  }

  if (board && !opts.transparent && !opts.hideBoardFrame){
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1.5 / camera.z;
    ctx.strokeRect(board.x, board.y, board.w, board.h);
  }

  const labelBg = opts.transparent ? null : (opts.bg || pal.bg);
  for (const el of elements) drawElement(ctx, el, pal, labelBg);
  ctx.restore();
}

/* ── anchors: 4 fixed connection points per shape (N/E/S/W, rotated) ── */
function anchorPoints(el){
  const b = boundsOf(el);
  const cx = b.x + b.w/2, cy = b.y + b.h/2;
  const raw = [['n', cx, b.y], ['e', b.x + b.w, cy], ['s', cx, b.y + b.h], ['w', b.x, cy]];
  return raw.map(([key, px, py]) => {
    const [X, Y] = rotatePoint(px, py, cx, cy, el.angle || 0);
    return { key, x: X, y: Y, cx, cy };
  });
}
function anchorPointOf(el, key, gap){
  const a = anchorPoints(el).find(p => p.key === key);
  if (!a) return null;
  const dx = a.x - a.cx, dy = a.y - a.cy;
  const len = Math.hypot(dx, dy) || 1;
  return [a.x + dx / len * (gap || 0), a.y + dy / len * (gap || 0)];
}

/* ── arrow binding maintenance ─────────────────────── */
function updateBoundArrows(elements){
  const byId = new Map(elements.map(e => [e.id, e]));
  for (const el of elements){
    if (!isLinear(el) || el.type === 'draw') continue;
    if (!el.startBind && !el.endBind) continue;
    const pts = el.points;
    const absStart = () => [el.x + pts[0][0], el.y + pts[0][1]];
    const absEnd = () => [el.x + pts[pts.length-1][0], el.y + pts[pts.length-1][1]];
    const startEl = el.startBind ? byId.get(el.startBind) : null;
    const endEl = el.endBind ? byId.get(el.endBind) : null;
    if (el.startBind && !startEl) el.startBind = null;
    if (el.endBind && !endEl) el.endBind = null;

    const gap = 7;
    let refForStart, refForEnd;
    if (startEl && endEl){
      const sb = boundsOf(startEl), eb = boundsOf(endEl);
      refForStart = [eb.x + eb.w/2, eb.y + eb.h/2];
      refForEnd = [sb.x + sb.w/2, sb.y + sb.h/2];
    } else {
      refForStart = absEnd();
      refForEnd = absStart();
    }
    if (startEl){
      const p = (el.startAnchor && anchorPointOf(startEl, el.startAnchor, gap))
        || boundaryPointToward(startEl, refForStart[0], refForStart[1], gap);
      pts[0] = [p[0] - el.x, p[1] - el.y];
    }
    if (endEl){
      const p = (el.endAnchor && anchorPointOf(endEl, el.endAnchor, gap))
        || boundaryPointToward(endEl, refForEnd[0], refForEnd[1], gap);
      pts[pts.length-1] = [p[0] - el.x, p[1] - el.y];
    }
    rectifyElbow(el);
    normalizeLinear(el);
  }
}

/* keep el.x/y at the min corner and points non-negative-ish; refresh w/h */
function normalizeLinear(el){
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of el.points){
    minX = Math.min(minX, px); minY = Math.min(minY, py);
    maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
  }
  el.x += minX; el.y += minY;
  el.points = el.points.map(([px, py]) => [px - minX, py - minY]);
  if (el.elbowPts) el.elbowPts = el.elbowPts.map(([px, py]) => [px - minX, py - minY]);
  el.w = maxX - minX; el.h = maxY - minY;
}

/* ── SVG export ─────────────────────────────────────
   Mirrors the canvas renderer primitive-for-primitive with the same seeds,
   so the exported wobble matches the screen exactly. */
function svgNum(v){ return Math.round(v * 100) / 100; }
function svgEsc(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function dPolygon(pts, closed){
  let d = `M${svgNum(pts[0][0])} ${svgNum(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) d += `L${svgNum(pts[i][0])} ${svgNum(pts[i][1])}`;
  return closed ? d + 'Z' : d;
}
function dSmoothOpen(pts){
  if (pts.length < 2) return '';
  let d = `M${svgNum(pts[0][0])} ${svgNum(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++){
    const mx = (pts[i][0] + pts[i+1][0]) / 2, my = (pts[i][1] + pts[i+1][1]) / 2;
    d += `Q${svgNum(pts[i][0])} ${svgNum(pts[i][1])} ${svgNum(mx)} ${svgNum(my)}`;
  }
  const last = pts[pts.length-1];
  return d + `L${svgNum(last[0])} ${svgNum(last[1])}`;
}
function dSmoothClosed(pts){
  const n = pts.length;
  let d = `M${svgNum((pts[0][0] + pts[1][0]) / 2)} ${svgNum((pts[0][1] + pts[1][1]) / 2)}`;
  for (let i = 1; i <= n; i++){
    const p = pts[i % n], nx = pts[(i + 1) % n];
    d += `Q${svgNum(p[0])} ${svgNum(p[1])} ${svgNum((p[0] + nx[0]) / 2)} ${svgNum((p[1] + nx[1]) / 2)}`;
  }
  return d + 'Z';
}
function dFillPath(pts, neat){ return neat ? dPolygon(pts, true) : dSmoothClosed(subdivideClosed(pts)); }
function dForPoly(poly){
  if (poly.clean) return dPolygon(poly.pts, poly.closed);
  return poly.closed ? dSmoothClosed(poly.pts) : dSmoothOpen(poly.pts);
}

function renderSceneSVG(elements, opts){
  const pal = opts.pal;
  setRouteContext(elements);
  const b = sceneBounds(elements);
  if (!b && !opts.board) return null;
  let minX, minY, W, H;
  if (opts.board){
    minX = opts.board.x; minY = opts.board.y;
    W = opts.board.w; H = opts.board.h;
  } else {
    const pad = opts.pad == null ? 72 : opts.pad;
    W = Math.ceil(b.w + pad * 2); H = Math.ceil(b.h + pad * 2);
    minX = b.x - pad; minY = b.y - pad;
  }
  const defs = [];
  const body = [];
  let clipN = 0;

  // artboard exports carry the grid (lines / dots) as a tiling pattern
  let gridMarkup = '';
  if (opts.board && opts.grid && opts.grid !== 'off' && !opts.transparent){
    const gs = opts.gridSize || 22;
    const gc = opts.gridColor || pal.grid;
    defs.push(opts.grid === 'dots'
      ? `<pattern id="gp" width="${gs}" height="${gs}" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="1.4" fill="${gc}"/><circle cx="${gs}" cy="0" r="1.4" fill="${gc}"/><circle cx="0" cy="${gs}" r="1.4" fill="${gc}"/><circle cx="${gs}" cy="${gs}" r="1.4" fill="${gc}"/></pattern>`
      : `<pattern id="gp" width="${gs}" height="${gs}" patternUnits="userSpaceOnUse"><path d="M ${gs} 0 L 0 0 0 ${gs}" fill="none" stroke="${gc}" stroke-width="1"/></pattern>`);
    gridMarkup = `<rect x="${svgNum(minX)}" y="${svgNum(minY)}" width="${W}" height="${H}" fill="url(#gp)"/>`;
  }

  const strokeAttrs = (el, mul, noDash) => {
    const dash = noDash ? null : dashArrayOf(el);
    return `fill="none" stroke="${resolveStroke(pal, el.stroke)}" stroke-width="${svgNum(el.sw * (mul || 1))}" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash.map(svgNum).join(' ')}"` : ''}`;
  };

  const fontAttrs = (el) => {
    const f = FONTS[el.font] || FONTS.sans;
    const track = el.lspace ? ` letter-spacing="${svgNum(el.lspace)}"` : '';
    return `font-family="${svgEsc(f.stack.replace(/"/g, "'"))}" font-size="${el.size}" font-weight="${f.weight}"${track}`;
  };

  const textLinesSVG = (el, lay, box) => {
    const out = [];
    const pad2 = el.type === 'chip' ? 10 : 12;
    const color = (el.type !== 'text' && el.fill === 'ink')
      ? (opts.bg || pal.bg)
      : (resolveStroke(pal, el.stroke) || pal.stroke.ink);
    let ty = el.type === 'text'
      ? el.y + lay.lh / 2
      : boxTextTop(el, box, lay.totalH, pad2) + lay.lh / 2;
    for (const ln of lay.lines){
      if (ln.para) ty += lay.pgap;
      let tx, anchor;
      const align = el.align || 'center';
      if (el.type === 'text'){
        if (align === 'right'){ anchor = 'end'; tx = el.x + el.w; }
        else if (align === 'center'){ anchor = 'middle'; tx = el.x + el.w/2; }
        else { anchor = 'start'; tx = el.x; }
      } else {
        if (align === 'left'){ anchor = 'start'; tx = box.x + pad2; }
        else if (align === 'right'){ anchor = 'end'; tx = box.x + box.w - pad2; }
        else { anchor = 'middle'; tx = box.x + box.w/2; }
      }
      if (ln.text) out.push(`<text x="${svgNum(tx)}" y="${svgNum(ty)}" ${fontAttrs(el)} fill="${color}" text-anchor="${anchor}" dominant-baseline="central">${svgEsc(ln.text)}</text>`);
      ty += lay.lh;
    }
    return out.join('');
  };

  const svgPatternGroup = (el, col, clipD) => {
    const id = 'hc' + (clipN++);
    defs.push(`<clipPath id="${id}"><path d="${clipD}"/></clipPath>`);
    const prims = fillPatternPrims(el);
    const inner = [];
    for (const [x1, y1, x2, y2] of prims.lines)
      inner.push(`<line x1="${svgNum(x1)}" y1="${svgNum(y1)}" x2="${svgNum(x2)}" y2="${svgNum(y2)}"/>`);
    for (const [dx2, dy2, r] of prims.dots)
      inner.push(`<circle cx="${svgNum(dx2)}" cy="${svgNum(dy2)}" r="${svgNum(r)}" fill="${col}" stroke="none"/>`);
    for (const pts of prims.paths)
      inner.push(`<path d="${dSmoothOpen(pts)}"/>`);
    return `<g clip-path="url(#${id})" fill="none" stroke="${col}" stroke-width="${svgNum(Math.max(1.1, el.sw * .55))}" stroke-linecap="round">${inner.join('')}</g>`;
  };

  const arrowheadSVG = (el, x, y, angle, size) => {
    const rnd = new Rand(el.seed + 3);
    const spread = 0.42;
    const a1 = angle + Math.PI - spread + rnd.jitter(0.05);
    const a2 = angle + Math.PI + spread + rnd.jitter(0.05);
    const d = `M${svgNum(x + Math.cos(a1)*size)} ${svgNum(y + Math.sin(a1)*size)}L${svgNum(x)} ${svgNum(y)}L${svgNum(x + Math.cos(a2)*size)} ${svgNum(y + Math.sin(a2)*size)}`;
    return `<path d="${d}" ${strokeAttrs(el, 1, true)}/>`;
  };
  const headSVG = (el, kind, x, y, angle, size) => {
    if (kind === 'arrow') return arrowheadSVG(el, x, y, angle, size);
    const g = headGeometry(el, kind, x, y, angle, size);
    if (!g) return '';
    const fill = opts.transparent ? 'none' : (opts.bg || pal.bg);
    const col = resolveStroke(pal, el.stroke) || pal.stroke.ink;
    const attrs = `fill="${fill}" stroke="${col}" stroke-width="${svgNum(el.sw)}" stroke-linejoin="round"`;
    if (g.tri)
      return `<path d="${dPolygon(g.tri, true)}" ${attrs}/>`;
    return `<circle cx="${svgNum(g.circ[0])}" cy="${svgNum(g.circ[1])}" r="${svgNum(g.circ[2])}" ${attrs}/>`;
  };

  for (const el of elements){
    const eb = boundsOf(el);
    const parts = [];

    if (el.type === 'image'){
      const baseEntry = getImageEntry(el.src);
      const A = baseEntry.ready ? getAdjusted(el) : null;
      const photoHref = () => (A && A.canvas !== baseEntry.img)
        ? A.canvas.toDataURL(el.src.startsWith('data:image/png') ? 'image/png' : 'image/jpeg', 0.9)
        : el.src;
      if (!el.artStyle || el.artStyle === 'photo' || !baseEntry.ready){
        if (el.crop){
          // scale the full image so the crop window fills the element, clipped
          const c = el.crop;
          const fw = eb.w / Math.max(0.001, c[2] - c[0]);
          const fh = eb.h / Math.max(0.001, c[3] - c[1]);
          const id = 'imclip' + (clipN++);
          defs.push(`<clipPath id="${id}"><rect x="${svgNum(eb.x)}" y="${svgNum(eb.y)}" width="${svgNum(eb.w)}" height="${svgNum(eb.h)}"/></clipPath>`);
          parts.push(`<g clip-path="url(#${id})"><image x="${svgNum(eb.x - c[0] * fw)}" y="${svgNum(eb.y - c[1] * fh)}" width="${svgNum(fw)}" height="${svgNum(fh)}" href="${photoHref()}" preserveAspectRatio="none"/></g>`);
        } else {
          parts.push(`<image x="${svgNum(eb.x)}" y="${svgNum(eb.y)}" width="${svgNum(eb.w)}" height="${svgNum(eb.h)}" href="${photoHref()}" preserveAspectRatio="none"/>`);
        }
      } else {
        const prims = artPrims(el, A.entry);
        const col = resolveStroke(pal, el.stroke) || pal.stroke.ink;
        const inner = [];
        for (const t of prims.tris)
          inner.push(t.color
            ? `<path d="${dPolygon(t.pts, true)}" fill="${t.color}"/>`
            : `<path d="${dPolygon(t.pts, true)}" fill="${col}" fill-opacity="${svgNum(0.06 + t.shade * 0.94)}"/>`);
        if (prims.rects && prims.rects.length){
          const midCol = resolveFill(pal, el.fill) || hexAlpha(col, 0.45);
          for (const r of prims.rects)
            inner.push(`<rect x="${svgNum(r.x)}" y="${svgNum(r.y)}" width="${svgNum(r.w)}" height="${svgNum(r.h)}" fill="${r.level === 2 ? col : midCol}"/>`);
        }
        if (prims.glyphs && prims.glyphs.length){
          const f = FONTS.jetbrains;
          const gl = prims.glyphs.map(gph =>
            `<text x="${svgNum(gph.x)}" y="${svgNum(gph.y)}" dominant-baseline="central">${svgEsc(gph.ch)}</text>`);
          inner.push(`<g fill="${col}" font-family="${svgEsc(f.stack.replace(/"/g, "'"))}" font-size="${svgNum(prims.glyphSize)}" font-weight="${f.weight}" text-anchor="middle">${gl.join('')}</g>`);
        }
        for (const [dx2, dy2, r] of prims.dots)
          inner.push(`<circle cx="${svgNum(dx2)}" cy="${svgNum(dy2)}" r="${svgNum(r)}" fill="${col}"/>`);
        if (prims.segs.length || prims.paths.length){
          const stringy = el.artStyle === 'string';
          const strokes = [];
          const baseW = stringy ? Math.max(0.5, el.sw * 0.32) : Math.max(0.8, el.sw * 0.5);
          for (const [x1, y1, x2, y2] of prims.segs)
            strokes.push(`<line x1="${svgNum(x1)}" y1="${svgNum(y1)}" x2="${svgNum(x2)}" y2="${svgNum(y2)}"/>`);
          for (const p of prims.paths){
            const pts = p.pts || p;
            strokes.push(p.wMul
              ? `<path d="${dSmoothOpen(pts)}" stroke-width="${svgNum(baseW * p.wMul)}"/>`
              : `<path d="${dSmoothOpen(pts)}"/>`);
          }
          inner.push(`<g fill="none" stroke="${col}"${stringy ? ' stroke-opacity="0.82"' : ''} stroke-width="${svgNum(baseW)}" stroke-linecap="round">${strokes.join('')}</g>`);
        }
        // prims are element-local — translate into place
        parts.push(`<g transform="translate(${svgNum(eb.x)} ${svgNum(eb.y)})">${inner.join('')}</g>`);
      }
    }
    else if (el.type === 'icon' && el.kind === 'material'){
      const col = resolveStroke(pal, el.stroke) || resolveFill(pal, el.fill);
      if (col && el.mpath){
        const { s, tx, ty } = materialTransform(el);
        parts.push(`<path d="${el.mpath}" transform="translate(${svgNum(tx)} ${svgNum(ty)}) scale(${svgNum(s)})" fill="${col}"/>`);
      }
    }
    else if (el.type === 'icon'){
      const strokeColor = resolveStroke(pal, el.stroke);
      const fillColor = resolveFill(pal, el.fill);
      const patterned = el.fillStyle && el.fillStyle !== 'solid';
      for (const pr of iconPrims(el)){
        if (pr.kind === 'fill'){
          const col = pr.use === 'fill' ? fillColor : strokeColor;
          if (!col) continue;
          if (patterned && pr.use === 'fill')
            parts.push(svgPatternGroup(el, col, dFillPath(pr.pts, el.sketch === 0)));
          else
            parts.push(`<path d="${dFillPath(pr.pts, el.sketch === 0)}" fill="${col}"/>`);
        } else if (pr.kind === 'dot'){
          const col = strokeColor || fillColor;
          if (col) parts.push(`<circle cx="${svgNum(pr.x)}" cy="${svgNum(pr.y)}" r="${svgNum(pr.r)}" fill="${col}"/>`);
        } else if (strokeColor){
          for (const poly of sketchPolylines(pr.pts, !!pr.closed, el, el.sketch))
            parts.push(`<path d="${dForPoly(poly)}" ${strokeAttrs(el, pr.widthMul)}/>`);
        }
      }
    }
    else if (el.type === 'text'){
      if (el.text && el.text.trim())
        parts.push(textLinesSVG(el, layoutText(el, null), eb));
    }
    else if (isLinear(el)){
      if (!resolveStroke(pal, el.stroke)){ body.push(''); continue; }
      const pts = linearPathPoints(el);
      if (el.type === 'draw'){
        const rnd = new Rand(el.seed);
        const jpts = el.sketch === 2 ? pts.map(p => [p[0] + rnd.jitter(1), p[1] + rnd.jitter(1)]) : pts;
        parts.push(`<path d="${dSmoothOpen(jpts)}" ${strokeAttrs(el)}/>`);
      } else {
        for (const poly of sketchPolylines(pts, false, el, el.sketch))
          parts.push(`<path d="${dForPoly(poly)}" ${strokeAttrs(el)}/>`);
        const hs = clamp(9 + el.sw * 2.2, 10, 22);
        if (el.endHead && el.endHead !== 'none' && pts.length >= 2){
          const [ax, ay] = pts[pts.length-2], [bx2, by2] = pts[pts.length-1];
          parts.push(headSVG(el, el.endHead, bx2, by2, Math.atan2(by2-ay, bx2-ax), hs));
        }
        if (el.startHead && el.startHead !== 'none' && pts.length >= 2){
          const [ax, ay] = pts[1], [bx2, by2] = pts[0];
          parts.push(headSVG(el, el.startHead, bx2, by2, Math.atan2(by2-ay, bx2-ax), hs));
        }
        if (el.text && el.text.trim()){
          const mid = pathMidpoint(pts);
          const lay = layoutText(el, null);
          const padX = 7, padY = 3;
          const bw2 = lay.w + padX * 2, bh2 = lay.totalH + padY * 2;
          const x0 = mid[0] - bw2/2, y0 = mid[1] - bh2/2;
          if (!opts.transparent)
            parts.push(`<rect x="${svgNum(x0)}" y="${svgNum(y0)}" width="${svgNum(bw2)}" height="${svgNum(bh2)}" rx="7" fill="${opts.bg || pal.bg}"/>`);
          const color = resolveStroke(pal, el.stroke) || pal.stroke.ink;
          let ly = y0 + padY + lay.lh/2;
          for (const ln of lay.lines){
            if (ln.para) ly += lay.pgap;
            if (ln.text) parts.push(`<text x="${svgNum(mid[0])}" y="${svgNum(ly)}" ${fontAttrs(el)} fill="${color}" text-anchor="middle" dominant-baseline="central">${svgEsc(ln.text)}</text>`);
            ly += lay.lh;
          }
        }
      }
    }
    else {
      const outline = shapeOutline(el);
      const fillColor = resolveFill(pal, el.fill);
      if (fillColor){
        if (el.fillStyle && el.fillStyle !== 'solid')
          parts.push(svgPatternGroup(el, fillColor, dFillPath(outline, el.sketch === 0)));
        else
          parts.push(`<path d="${dFillPath(outline, el.sketch === 0)}" fill="${fillColor}"/>`);
      }
      if (resolveStroke(pal, el.stroke)){
        for (const poly of sketchPolylines(outline, true, el, el.sketch))
          parts.push(`<path d="${dForPoly(poly)}" ${strokeAttrs(el)}/>`);
      }
      if (el.text && el.text.trim()){
        const pad2 = el.type === 'chip' ? 10 : 12;
        parts.push(textLinesSVG(el, layoutText(el, Math.max(20, eb.w - pad2*2)), eb));
      }
    }

    const op = (el.opacity == null ? 100 : el.opacity) / 100;
    let transform = '';
    if (el.angle){
      const cx = eb.x + eb.w/2, cy = eb.y + eb.h/2;
      transform = ` transform="rotate(${svgNum(el.angle * 180 / Math.PI)} ${svgNum(cx)} ${svgNum(cy)})"`;
    }
    body.push(`<g${transform}${op < 1 ? ` opacity="${op}"` : ''}>${parts.join('')}</g>`);
  }

  const usedFonts = new Set(
    elements.filter(e => e.type === 'text' || (e.text && e.text.trim())).map(e => e.font));
  const googleUsed = [...usedFonts].map(f => FONTS[f]).filter(f => f && f.google);
  const style = googleUsed.length
    ? `<style>@import url(&quot;https://fonts.googleapis.com/css2?${googleUsed.map(f => 'family=' + f.google).join('&amp;')}&amp;display=swap&quot;);</style>`
    : '';
  const bg = opts.transparent ? '' :
    `<rect x="${svgNum(minX)}" y="${svgNum(minY)}" width="${W}" height="${H}" fill="${opts.bg || pal.bg}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${svgNum(minX)} ${svgNum(minY)} ${W} ${H}" width="${W}" height="${H}">${style}${defs.length ? '<defs>' + defs.join('') + '</defs>' : ''}${bg}${gridMarkup}${body.join('')}</svg>`;
}

/* ── minimal PDF writer ─────────────────────────────
   Zero-dependency: each page is a JPEG rendered by the canvas engine,
   embedded as a DCTDecode image XObject. Latin-1 byte encoding throughout —
   PDF cross-reference offsets are byte positions, so UTF-8 would corrupt them. */
function latin1Bytes(str){
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xFF;
  return out;
}
function dataURLToBytes(dataURL){
  const bin = atob(dataURL.split(',')[1]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function buildPDF(pages){
  /* pages: [{bytes: Uint8Array (JPEG data), w, h, pxW, pxH}] — w/h in PDF points */
  const chunks = [];
  let offset = 0;
  const objOffsets = [];
  const push = data => {
    const bytes = typeof data === 'string' ? latin1Bytes(data) : data;
    chunks.push(bytes);
    offset += bytes.length;
  };
  const obj = (n, body) => {
    objOffsets[n] = offset;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };
  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A])); // binary marker

  const n = pages.length;
  const pageObj = i => 3 + i * 3, contObj = i => 4 + i * 3, imgObj = i => 5 + i * 3;
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${n} >>`);
  pages.forEach((p, i) => {
    obj(pageObj(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.w} ${p.h}] ` +
      `/Resources << /XObject << /Im${i} ${imgObj(i)} 0 R >> >> /Contents ${contObj(i)} 0 R >>`);
    const stream = `q ${p.w} 0 0 ${p.h} 0 0 cm /Im${i} Do Q`;
    obj(contObj(i), `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    objOffsets[imgObj(i)] = offset;
    push(`${imgObj(i)} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.pxW} /Height ${p.pxH} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`);
    push(p.bytes);
    push('\nendstream\nendobj\n');
  });

  const total = 3 + n * 3;
  const xrefOffset = offset;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++)
    xref += String(objOffsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(xref);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return new Blob(chunks, { type: 'application/pdf' });
}

/* refresh a text element's box from its content */
function autosizeText(el){
  const m = measureText(el.text || ' ', el.font, el.size, el);
  el.w = Math.max(10, m.w);
  el.h = Math.max(elLH(el), m.h);
}
