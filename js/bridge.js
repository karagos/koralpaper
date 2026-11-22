/* KoralPaper: documents, versions, comments, named styles, the master page,
   and the Claude link (the MCP bridge client).

   Loaded BEFORE app.js: everything here is a function that runs later, once
   the app has booted, so it can use the app's state and helpers freely.

   © 2026 Stefanos Karagos, CAIO Group · wearecaio.com · MIT */
'use strict';

/* ════════════════════════════════════════════════════
   1. DOCUMENT IDENTITY AND VERSIONS
   Every document carries a small `meta` record: its id and name, a version
   clock, a version per page and per element, comments, named styles and the
   master page. It is saved with the document and travels in .json files.
   ════════════════════════════════════════════════════ */
const DOCNAME_KEY = 'asterisk.docname';
function strHash(s){
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36) + s.length.toString(36);
}
function storedDocName(){
  try { return localStorage.getItem(DOCNAME_KEY) || ''; } catch (e){ return ''; }
}
function newMeta(name){
  return {
    id: 'doc_' + uid(), name: (name || storedDocName() || 'Untitled').slice(0, 120),
    clock: 0,            // document version: goes up by one on every change
    pv: {},              // pageId → { v: version of the last change, h: content hash }
    ev: {},              // elementId → { b: born at, v: last changed at, h: hash, p: pageId }
    gone: [],            // removed elements: { id, p, v, b }
    comments: [],
    styles: { text: {}, colors: {} },
    master: null,        // { rev, front, skip: [pageId], elements: [...] }
    starter: null,       // id of the blank first page of a document Claude just created
  };
}
function normalizeMeta(m){
  const fresh = newMeta();
  if (!m || typeof m !== 'object' || Array.isArray(m)) return fresh;
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
  const out = fresh;
  if (typeof m.id === 'string' && /^[A-Za-z0-9_-]{4,60}$/.test(m.id)) out.id = m.id;
  if (typeof m.name === 'string' && m.name.trim()) out.name = m.name.trim().slice(0, 120);
  out.clock = Number.isFinite(Number(m.clock)) ? Math.max(0, Math.floor(Number(m.clock))) : 0;
  out.pv = obj(m.pv) || {};
  out.ev = obj(m.ev) || {};
  out.gone = Array.isArray(m.gone) ? m.gone.filter(g => g && typeof g.id === 'string').slice(-3000) : [];
  out.comments = Array.isArray(m.comments) ? m.comments.filter(c => c && typeof c.id === 'string' && typeof c.text === 'string')
    .map(c => ({
      id: c.id, elementId: String(c.elementId || ''), pageId: String(c.pageId || ''),
      text: c.text.slice(0, 4000), author: c.author === 'claude' ? 'claude' : 'user',
      at: typeof c.at === 'string' ? c.at : new Date().toISOString(), resolved: !!c.resolved,
      replies: Array.isArray(c.replies) ? c.replies.filter(r => r && typeof r.text === 'string').map(r => ({
        id: String(r.id || uid()), text: r.text.slice(0, 4000), author: r.author === 'claude' ? 'claude' : 'user',
        at: typeof r.at === 'string' ? r.at : new Date().toISOString(),
      })) : [],
    })) : [];
  const st = obj(m.styles) || {};
  out.styles = { text: obj(st.text) || {}, colors: {} };
  for (const [k, v] of Object.entries(obj(st.colors) || {}))
    if (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v)) out.styles.colors[k] = v;
  const ms = obj(m.master);
  if (ms && Array.isArray(ms.elements) && ms.elements.length)
    out.master = { rev: Number(ms.rev) || 1, front: ms.front !== false,
      skip: Array.isArray(ms.skip) ? ms.skip.map(String) : [],
      elements: ms.elements.filter(e => e && typeof e.id === 'string' && typeof e.type === 'string') };
  out.starter = typeof m.starter === 'string' ? m.starter : null;
  return out;
}
const elJson = el => JSON.stringify(el, (k, v) => k.startsWith('_') ? undefined : v);

/* Bring the version records in line with what is on the pages right now.
   Cheap, and safe to call any time: it is run before every autosave and at the
   start of every Claude command, so a version check always compares against
   the document as it really is, including edits made by hand a moment ago. */
function docTrack(){
  const m = state.meta;
  if (!m || !Array.isArray(state.pages) || !state.pages.length) return;
  syncPageRef();
  let ticked = false;
  const tick = () => { if (!ticked){ m.clock++; ticked = true; } return m.clock; };
  const seen = new Set(), livePages = new Set();
  for (const p of state.pages){
    livePages.add(p.id);
    const parts = [p.name || '', p.bg || ''];
    for (const el of p.elements){
      if (el.master) continue;                 // master copies are regenerated, never versioned
      const h = strHash(elJson(el));
      parts.push(el.id + ':' + h);
      seen.add(el.id);
      const r = m.ev[el.id];
      if (!r) m.ev[el.id] = { b: tick(), v: m.clock, h, p: p.id };
      else if (r.h !== h || r.p !== p.id){ r.h = h; r.p = p.id; r.v = tick(); }
    }
    const ph = strHash(parts.join('|'));
    const pr = m.pv[p.id];
    if (!pr) m.pv[p.id] = { v: tick(), h: ph };
    else if (pr.h !== ph){ pr.h = ph; pr.v = tick(); }
  }
  for (const id of Object.keys(m.ev)){
    if (seen.has(id)) continue;
    m.gone.push({ id, p: m.ev[id].p, b: m.ev[id].b, v: tick() });
    delete m.ev[id];
  }
  for (const pid of Object.keys(m.pv)) if (!livePages.has(pid)){ delete m.pv[pid]; tick(); }
  if (m.gone.length > 3000) m.gone.splice(0, m.gone.length - 3000);
  if (m.starter && !state.pages.some(p => p.id === m.starter && !p.elements.length)) m.starter = null;
}
const pageVersion = p => { const r = state.meta && state.meta.pv[p.id]; return r ? r.v : 0; };
function docHasContent(){
  return state.pages.length > 1 || state.pages.some(p => p.elements.length);
}
function docSyncName(){
  const n = storedDocName();
  if (n && state.meta && n !== state.meta.name) state.meta.name = n.slice(0, 120);
}
function docSetName(name){
  if (!state.meta) return;
  state.meta.name = String(name || 'Untitled').trim().slice(0, 120) || 'Untitled';
  try { localStorage.setItem(DOCNAME_KEY, state.meta.name); } catch (e){}
}

/* ════════════════════════════════════════════════════
   2. THE DOCUMENT LIBRARY (IndexedDB)
   The open document lives in local storage as before. Every other document
   rests here, whole, until it is opened again. Snapshots made by Claude sit
   in the second store.
   ════════════════════════════════════════════════════ */
function libOpen(){
  return new Promise((res, rej) => {
    const rq = indexedDB.open('koralpaper-docs', 1);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('snaps')) db.createObjectStore('snaps', { keyPath: 'id' });
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function libRun(store, mode, fn){
  const db = await libOpen();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const rq = fn(t.objectStore(store));
    t.oncomplete = () => { db.close(); res(rq ? rq.result : undefined); };
    t.onerror = () => { db.close(); rej(t.error); };
    t.onabort = () => { db.close(); rej(t.error); };
  });
}
const libPut = (store, rec) => libRun(store, 'readwrite', s => s.put(rec));
const libGet = (store, id) => libRun(store, 'readonly', s => s.get(id));
const libAll = store => libRun(store, 'readonly', s => s.getAll());
const libDel = (store, id) => libRun(store, 'readwrite', s => s.delete(id));

function libraryRecord(){
  docSyncName(); docTrack();
  return {
    id: state.meta.id, name: state.meta.name, updatedAt: Date.now(),
    pages: state.pages.length, version: state.meta.clock,
    board: state.board ? { w: state.board.w, h: state.board.h, name: state.board.name } : null,
    payload: JSON.stringify(docPayload()),
  };
}
let libTimer = null, libKnown = new Set();
/* keep the library copy of the open document fresh, a moment after each autosave */
function libraryTouch(){
  clearTimeout(libTimer);
  libTimer = setTimeout(() => { librarySaveCurrent(false).catch(() => {}); }, 1500);
}
async function librarySaveCurrent(force){
  if (!state.meta) return false;
  // an untouched blank document is not worth a library entry, unless it already has one
  if (!force && !docHasContent() && !libKnown.has(state.meta.id)) return false;
  const rec = libraryRecord();
  await libPut('docs', rec);
  libKnown.add(rec.id);
  return true;
}
/* the open document is about to be replaced by a different one: file it in the
   library and give what comes next its own identity. Synchronous on purpose, so
   it can sit inside New document and Open file; the write finishes on its own. */
function docFork(name){
  if (!state.meta){ state.meta = newMeta(name); return; }
  clearTimeout(libTimer);
  if (docHasContent() || libKnown.has(state.meta.id)){
    try { const rec = libraryRecord(); libKnown.add(rec.id); libPut('docs', rec).catch(() => {}); } catch (e){}
  }
  state.meta = newMeta(name || 'Untitled');
  masterSig = null;
  try { localStorage.removeItem(DOCNAME_KEY); } catch (e){}
}
/* a file was just opened into the state: take its comments, styles and master
   page, but under a fresh id, so it can never overwrite a library document */
function docAdopt(meta, name){
  const fresh = state.meta ? state.meta.id : ('doc_' + uid());
  const m = normalizeMeta(meta);
  m.id = fresh; m.pv = {}; m.ev = {}; m.gone = []; m.starter = null;
  if (name) m.name = name.slice(0, 120);
  state.meta = m;
  masterSig = null;
  try { localStorage.setItem(DOCNAME_KEY, m.name); } catch (e){}
}
/* everything on screen follows the state after a whole-document swap */
function docActivate(){
  state.selection = new Set();
  document.body.classList.toggle('dark', state.theme === 'dark');
  try { localStorage.setItem(DOCNAME_KEY, state.meta.name); } catch (e){}
  masterSig = null;
  paintSwatches(); syncToggles(); syncPaperUI(); syncBoardBtn(); buildBoardMenuSel();
  updateBoundArrows(state.elements);
  preloadDocFonts();
  masterSync();
  history = [serialize()]; histIndex = 0; syncHistoryButtons();
  docTrack();
  buildPageStrip(); syncPanel(); zoomToFit(); syncZoomLabel(); requestRender();
  flushAutosave();
}
async function docOpen(id){
  if (state.meta && state.meta.id === id) return true;
  const rec = await libGet('docs', id);
  if (!rec || typeof rec.payload !== 'string') return false;
  let data;
  try { data = JSON.parse(rec.payload); } catch (e){ return false; }
  if (editing) commitTextEdit();
  clearTimeout(libTimer);
  await librarySaveCurrent(false);
  const keep = docPayload();                        // put the current one back if the stored copy is unusable
  if (!applyDocData(data) || !docUsable()){ applyDocData(keep); docActivate(); return false; }
  state.meta.id = id;
  if (!data.meta || !data.meta.name) state.meta.name = rec.name || state.meta.name;
  docActivate();
  return true;
}
async function docCreate(name, board){
  if (editing) commitTextEdit();
  clearTimeout(libTimer);
  await librarySaveCurrent(false);
  const cleanName = String(name || '').trim().slice(0, 120) || 'Untitled';
  state.meta = newMeta(cleanName);
  const first = { id: uid(), name: 'Page 1', elements: [] };
  state.pages = [first];
  state.pageIndex = 0;
  state.elements = first.elements;
  state.meta.starter = first.id;
  state.images = {};
  state.camera = { x: 0, y: 0, z: 1 };
  state.board = claudeBoard(board);
  state.bgColor = (brandActive() && brand.usePaper && brand.paper) ? brand.paper : null;
  if (typeof tl !== 'undefined' && tl.frames.length) tlRestore([]);
  docActivate();
  await librarySaveCurrent(true);
}
async function docList(){
  const recs = await libAll('docs');
  libKnown = new Set(recs.map(r => r.id));
  const out = recs.map(r => ({ id: r.id, name: r.name, pages: r.pages, board: r.board || null,
    version: r.version || 0, updatedAt: r.updatedAt, open: !!state.meta && r.id === state.meta.id }));
  if (state.meta && !out.some(r => r.open)){
    docSyncName(); docTrack();
    out.push({ id: state.meta.id, name: state.meta.name, pages: state.pages.length,
      board: state.board ? { w: state.board.w, h: state.board.h, name: state.board.name } : null,
      version: state.meta.clock, updatedAt: Date.now(), open: true });
  }
  for (const r of out) if (r.open){ r.name = state.meta.name; r.pages = state.pages.length; r.version = state.meta.clock; }
  out.sort((a, b) => (b.open - a.open) || (b.updatedAt - a.updatedAt));
  return out;
}
function claudeBoard(b){
  if (!b || !(Number(b.w) > 0) || !(Number(b.h) > 0)) return null;
  const w = clamp(Math.round(Number(b.w)), 16, 20000), h = clamp(Math.round(Number(b.h)), 16, 20000);
  const board = { name: typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 60) : 'Custom', w, h, x: 0, y: 0 };
  const safe = Number(b.safeArea);
  if (safe > 0) board.safe = clamp(Math.round(safe), 1, Math.floor(Math.min(w, h) / 2) - 1);
  return board;
}

/* ════════════════════════════════════════════════════
   3. NAMED STYLES AND THE MASTER PAGE
   Styles are stored once per document and referenced by name. An element
   remembers the name it was given (el.tstyle for a text style, el.tok for
   colour tokens) next to the resolved values, so the renderer needs no
   lookup, and changing a style rewrites every element that uses it.
   ════════════════════════════════════════════════════ */
function styleToSpec(st){
  const out = {};
  if (!st) return out;
  for (const k of ['font', 'size', 'weight', 'italic', 'bold', 'align', 'lineHeight', 'letterSpacing'])
    if (st[k] !== undefined && st[k] !== null) out[k] = st[k];
  if (st.color) out.textColor = st.color;
  return out;
}
/* resolve a spec's style name and $token colours against the document.
   Returns the plain spec plus what was referenced, and collects warnings. */
function claudeExpandSpec(spec, warnings){
  const m = state.meta;
  let s = Object.assign({}, spec), tstyle = null;
  const tok = {};
  if (typeof s.style === 'string' && s.style){
    const st = m && m.styles.text[s.style];
    if (st){ tstyle = s.style; s = Object.assign(styleToSpec(st), s); }
    else if (warnings) warnings.push(`Unknown text style "${s.style}": define it with koralpaper_set_styles.`);
  }
  for (const prop of ['stroke', 'fill', 'textColor']){
    const v = s[prop];
    if (typeof v !== 'string' || v[0] !== '$') continue;
    const name = v.slice(1), hex = m && m.styles.colors[name];
    if (hex){ tok[prop] = name; s[prop] = hex; }
    else { delete s[prop]; if (warnings) warnings.push(`Unknown colour token "${v}": define it with koralpaper_set_styles.`); }
  }
  return { s, tok, tstyle };
}
function claudeRemember(el, spec, ex){
  if (ex.tstyle) el.tstyle = ex.tstyle;
  else if (spec.style === null || spec.style === '') delete el.tstyle;
  for (const prop of ['stroke', 'fill', 'textColor']){
    if (ex.tok[prop]){ el.tok = el.tok || {}; el.tok[prop] = ex.tok[prop]; }
    else if (spec[prop] !== undefined && el.tok){ delete el.tok[prop]; if (!Object.keys(el.tok).length) delete el.tok; }
  }
}
/* after a style or token changed: rewrite every element that references one */
function stylesReapply(){
  const m = state.meta;
  const each = el => {
    if (el.tstyle && m.styles.text[el.tstyle]){
      const ex = claudeExpandSpec(styleToSpec(m.styles.text[el.tstyle]), null);
      claudeApplyUpdate(el, ex.s);
      for (const prop of Object.keys(ex.tok)){ el.tok = el.tok || {}; el.tok[prop] = ex.tok[prop]; }
    }
    if (el.tok) for (const [prop, name] of Object.entries(el.tok))
      if (m.styles.colors[name]) el[prop] = m.styles.colors[name];
    if (el.type === 'text') autosizeText(el);
    delete el._prims; delete el._pkey;
  };
  for (const p of state.pages) for (const el of p.elements) if (!el.master) each(el);
  if (m.master){ for (const el of m.master.elements) each(el); m.master.rev++; }
}
/* replace an element's text while keeping a whole-text bold / italic run */
function setTextKeepRuns(el, text){
  const old = String(el.text || '');
  const whole = (el.runs && el.runs.length === 1 && el.runs[0].s === 0 && el.runs[0].e >= old.length) ? el.runs[0] : null;
  el.text = text;
  if (whole && text.length) el.runs = [Object.assign({}, whole, { e: text.length })];
  else delete el.runs;
}
function setWholeRun(el, patch){
  const len = String(el.text || '').length;
  const cur = (el.runs && el.runs.length === 1 && el.runs[0].s === 0 && el.runs[0].e >= len) ? el.runs[0]
    : { s: 0, e: len, b: false, i: false, hl: null, co: null };
  const next = Object.assign({}, cur, patch, { s: 0, e: len });
  if (!len || (!next.b && !next.i && !next.hl && !next.co)) delete el.runs;
  else el.runs = [next];
}
const pageNo = (n, pad) => String(n).padStart(pad, '0');
function masterFill(text, n, total){
  return String(text)
    .replace(/\{page\}/g, pageNo(n, 2)).replace(/\{pages\}/g, pageNo(total, 2))
    .replace(/\{n\}/g, String(n)).replace(/\{N\}/g, String(total));
}
let masterSig = null;
/* Master elements are stored once in the document and copied onto every page
   as locked elements, with page numbers filled in. Copies are rebuilt whenever
   the master or the page list changes, and they are left out of versions,
   change lists and reads, so adding a page never makes another page look edited. */
function masterSync(){
  const m = state.meta;
  if (!m || !Array.isArray(state.pages) || !state.pages.length) return;
  const ms = m.master;
  const sig = ms ? ms.rev + '|' + (ms.front ? 'f' : 'b') + '|' + ms.skip.join(',') + '|' + state.pages.map(p => p.id).join(',') : 'none';
  if (sig === masterSig) return;
  const hadCopies = state.pages.some(p => p.elements.some(e => e.master));
  masterSig = sig;
  if (!ms && !hadCopies) return;
  syncPageRef();
  const total = state.pages.length;
  /* A free text (no wrap width) has only a left edge, yet "3 / 10" and "10 / 10"
     differ in width. So x is where the text starts on page 1, and with align
     right or center every other page keeps that same right edge or centre. */
  const refW = new Map();
  if (ms) for (const src of ms.elements){
    if (src.type !== 'text' || src.wrap || !src.text || !['right', 'center'].includes(src.align)) continue;
    const ref = JSON.parse(elJson(src));
    setTextKeepRuns(ref, masterFill(ref.text, 1, total));
    autosizeText(ref);
    refW.set(src.id, ref.w);
  }
  state.pages.forEach((p, i) => {
    const own = p.elements.filter(e => !e.master);
    let copies = [];
    if (ms && !ms.skip.includes(p.id)){
      copies = ms.elements.map(src => {
        const c = JSON.parse(elJson(src));
        c.id = 'm_' + src.id + '_' + p.id;
        c.master = src.id; c.locked = true; c.groupId = null;
        if (c.text){
          setTextKeepRuns(c, masterFill(c.text, i + 1, total));
          if (c.type === 'text'){
            autosizeText(c);
            if (refW.has(src.id))
              c.x = c.align === 'right' ? src.x + refW.get(src.id) - c.w : src.x + refW.get(src.id) / 2 - c.w / 2;
          }
        }
        return c;
      });
    }
    const next = (ms && ms.front) ? own.concat(copies) : copies.concat(own);
    p.elements.length = 0;                     // in place: state.elements stays the same array
    for (const e of next) p.elements.push(e);
  });
  state.selection = new Set([...state.selection].filter(id => state.elements.some(e => e.id === id && !e.master)));
}

/* ════════════════════════════════════════════════════
   4. COMMENTS
   A comment is anchored to one element. Anyone can add one from the
   right-click menu; Claude reads them, replies, and marks them resolved.
   ════════════════════════════════════════════════════ */
function commentsFor(elementId){
  const m = state.meta;
  return m ? m.comments.filter(c => c.elementId === elementId && !c.resolved) : [];
}
function commentChanged(){
  scheduleAutosave(); requestRender();
  if (!$('commentsDialog').classList.contains('hidden')) buildCommentsList();
}
function commentAddFor(el){
  const text = (prompt('Comment on this element (Claude can read it and reply):') || '').trim();
  if (!text) return;
  state.meta.comments.push({ id: 'c_' + uid(), elementId: el.id, pageId: state.pages[state.pageIndex].id,
    text: text.slice(0, 4000), author: 'user', at: new Date().toISOString(), resolved: false, replies: [] });
  commentChanged();
  showHint('Comment added: Claude sees it the next time it reads the comments');
}
function commentWhere(c){
  for (let i = 0; i < state.pages.length; i++){
    const el = state.pages[i].elements.find(e => e.id === c.elementId);
    if (el) return { pageIndex: i, page: state.pages[i], el };
  }
  return null;
}
function commentLabel(el){
  const t = (el.text || '').replace(/\s+/g, ' ').trim();
  return t ? '“' + (t.length > 46 ? t.slice(0, 45) + '…' : t) + '”' : el.type;
}
function commentPublic(c){
  const w = commentWhere(c);
  return {
    id: c.id, elementId: c.elementId, pageId: w ? w.page.id : c.pageId,
    page: w ? w.page.name : null, pageNumber: w ? w.pageIndex + 1 : null,
    element: w ? claudeCompact(w.el) : null, elementDeleted: !w,
    text: c.text, author: c.author, at: c.at, resolved: c.resolved,
    replies: c.replies.map(r => ({ id: r.id, text: r.text, author: r.author, at: r.at })),
  };
}
function buildCommentsList(){
  const box = $('commentsList');
  box.replaceChildren();
  const all = state.meta.comments;
  const showDone = $('commentsShowDone').checked;
  const list = all.filter(c => showDone || !c.resolved);
  if (!list.length){
    const p = document.createElement('p');
    p.className = 'snapempty';
    p.textContent = all.length ? 'No open comments. Tick the box below to see the resolved ones.'
      : 'No comments yet. Right-click any element and choose Add comment. Claude can read comments, reply, and mark them resolved.';
    box.appendChild(p);
    return;
  }
  const who = a => a === 'claude' ? 'Claude' : 'You';
  const when = at => { const d = new Date(at); return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  for (const c of list){
    const w = commentWhere(c);
    const row = document.createElement('div');
    row.className = 'cmtrow' + (c.resolved ? ' done' : '');
    const head = document.createElement('div');
    head.className = 'cmthead';
    head.textContent = (w ? `Page ${w.pageIndex + 1} · ${commentLabel(w.el)}` : 'Element deleted') + (c.resolved ? ' · resolved' : '');
    const body = document.createElement('div');
    body.className = 'cmtbody';
    const line = (author, text, at) => {
      const d = document.createElement('div');
      d.className = 'cmtline ' + author;
      const b = document.createElement('b'); b.textContent = who(author);
      const s = document.createElement('span'); s.textContent = ' ' + when(at);
      const t = document.createElement('p'); t.textContent = text;
      d.append(b, s, t);
      return d;
    };
    body.appendChild(line(c.author, c.text, c.at));
    for (const r of c.replies) body.appendChild(line(r.author, r.text, r.at));
    const acts = document.createElement('div');
    acts.className = 'cmtacts';
    const btn = (label, fn, cls) => {
      const b = document.createElement('button');
      b.className = 'minipill tplmini' + (cls ? ' ' + cls : '');
      b.textContent = label;
      b.addEventListener('click', fn);
      acts.appendChild(b);
    };
    if (w) btn('Show', () => {
      switchPage(w.pageIndex);
      setTool('select'); setSelection(new Set([w.el.id])); syncPanel(); requestRender();
    });
    btn('Reply', () => {
      const text = (prompt('Your reply:') || '').trim();
      if (!text) return;
      c.replies.push({ id: 'r_' + uid(), text: text.slice(0, 4000), author: 'user', at: new Date().toISOString() });
      commentChanged();
    });
    btn(c.resolved ? 'Reopen' : 'Resolve', () => { c.resolved = !c.resolved; commentChanged(); });
    btn('✕', () => {
      if (!confirm('Delete this comment and its replies?')) return;
      state.meta.comments = state.meta.comments.filter(x => x !== c);
      commentChanged();
    }, 'danger tpldel');
    row.append(head, body, acts);
    box.appendChild(row);
  }
}
function openCommentsDialog(){
  closeMenus();
  buildCommentsList();
  $('commentsDialog').classList.remove('hidden');
}

/* ── Documents dialog ──────────────────────────────── */
async function buildDocsList(){
  const box = $('docsList');
  let list = [];
  try { list = await docList(); } catch (e){ list = []; }
  box.replaceChildren();
  for (const d of list){
    const row = document.createElement('div');
    row.className = 'tplrow';
    const info = document.createElement('div');
    info.className = 'tplinfo';
    const nm = document.createElement('b');
    nm.textContent = d.name + (d.open ? '  ·  open now' : '');
    const meta = document.createElement('span');
    const dt = new Date(d.updatedAt);
    meta.textContent = d.pages + ' page' + (d.pages > 1 ? 's' : '') + (d.board ? ` · ${d.board.w} × ${d.board.h}` : '')
      + (d.open ? '' : ' · ' + dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    info.append(nm, meta);
    row.appendChild(info);
    if (d.open){
      const rn = document.createElement('button');
      rn.className = 'minipill tplmini';
      rn.textContent = 'Rename';
      rn.addEventListener('click', () => {
        const n = (prompt('Document name:', state.meta.name) || '').trim();
        if (!n) return;
        docSetName(n); scheduleAutosave(); buildDocsList();
      });
      row.appendChild(rn);
    } else {
      const op = document.createElement('button');
      op.className = 'minipill tplmini';
      op.textContent = 'Open';
      op.addEventListener('click', async () => {
        const ok = await docOpen(d.id);
        if (!ok){ alert('That document could not be opened.'); return; }
        $('docsDialog').classList.add('hidden');
        showHint('Opened “' + state.meta.name + '”. The previous document is in ☰ → Documents');
      });
      const del = document.createElement('button');
      del.className = 'minipill tplmini danger tpldel';
      del.textContent = '✕';
      del.title = 'Delete this document';
      del.addEventListener('click', async () => {
        if (!confirm('Delete “' + d.name + '” for good?\n\nThis cannot be undone.')) return;
        await libDel('docs', d.id);
        for (const s of await libAll('snaps')) if (s.docId === d.id) await libDel('snaps', s.id);
        buildDocsList();
      });
      row.append(op, del);
    }
    box.appendChild(row);
  }
}
function openDocsDialog(){
  closeMenus();
  $('docsDialog').classList.remove('hidden');
  buildDocsList();
}
function bridgeInitUI(){
  $('docsCloseBtn').addEventListener('click', () => $('docsDialog').classList.add('hidden'));
  $('commentsCloseBtn').addEventListener('click', () => $('commentsDialog').classList.add('hidden'));
  $('commentsShowDone').addEventListener('change', buildCommentsList);
  libAll('docs').then(recs => { libKnown = new Set(recs.map(r => r.id)); }).catch(() => {});
}

/* safe-area guide and comment badges: drawn over the canvas in the editor only.
   Called from drawOverlay with the context already in scene coordinates. */
function drawBridgeOverlay(c, z){
  if (presenting) return;
  const b = state.board;
  if (b && b.safe > 0){
    c.save();
    c.strokeStyle = state.theme === 'light' ? 'rgba(214,84,56,.75)' : 'rgba(255,150,120,.8)';
    c.lineWidth = 1.2 / z;
    c.setLineDash([7 / z, 5 / z]);
    c.strokeRect(b.x + b.safe, b.y + b.safe, b.w - b.safe * 2, b.h - b.safe * 2);
    c.setLineDash([]);
    c.font = `600 ${11 / z}px ${FONTS.sans.stack}`;
    c.fillStyle = c.strokeStyle;
    c.textAlign = 'right'; c.textBaseline = 'alphabetic';
    c.fillText(`safe area · ${b.safe}px`, b.x + b.w, b.y - 8 / z);
    c.restore();
  }
  const m = state.meta;
  if (!m || !m.comments.length) return;
  const counts = new Map();
  for (const cm of m.comments) if (!cm.resolved) counts.set(cm.elementId, (counts.get(cm.elementId) || 0) + 1);
  if (!counts.size) return;
  for (const el of state.elements){
    const n = counts.get(el.id);
    if (!n) continue;
    const bb = boundsOf(el), r = 9 / z;
    c.save();
    c.beginPath();
    c.arc(bb.x, bb.y, r, 0, TAU);
    c.fillStyle = '#E4572E';
    c.fill();
    c.fillStyle = '#FFFFFF';
    c.font = `700 ${11 / z}px ${FONTS.sans.stack}`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(n), bb.x, bb.y + 0.5 / z);
    c.restore();
  }
}

/* ════════════════════════════════════════════════════
   5. THE CLAUDE LINK: the MCP bridge client
   When the KoralPaper MCP extension runs inside Claude Desktop it opens a
   tiny bridge on 127.0.0.1:8137. The app long-polls it; Claude's tool calls
   arrive as commands, results go back, and the ✳ indicator lights up while
   the link is alive. Everything Claude draws lands as ordinary elements:
   editable, undoable (one ⌘Z per command), saved like anything else.
   ════════════════════════════════════════════════════ */
const CLAUDE_BRIDGE = (() => {
  // ?bridge=PORT points a test copy of the app at a test bridge; digits only
  let port = 8137;
  try {
    const q = new URLSearchParams(location.search).get('bridge');
    if (q && /^\d{2,5}$/.test(q) && Number(q) > 1023 && Number(q) < 65536) port = Number(q);
  } catch (e){}
  return 'http://127.0.0.1:' + port;
})();
const CLAUDE_CAPS = 2;       // raised whenever the app learns new bridge commands
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
/* Values arriving over the bridge are untrusted: NaN, Infinity and 1e308 all used
   to pass straight through into geometry, where they poison sceneBounds and make an
   export try to allocate an impossible canvas. Everything is clamped to a finite,
   sane canvas range instead. */
const CLAUDE_COORD = 1e6, CLAUDE_SIZE = 1e5, CLAUDE_TEXT_MAX = 20000;
function claudeNum(v, fallback, lo, hi){
  const n = Number(v);
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
}
function claudeText(v){
  return typeof v === 'string' ? v.slice(0, CLAUDE_TEXT_MAX) : '';
}
/* a font by key, by family name in any letter case ("Inter Tight"), or any
   Google font by its exact name */
function claudeFontKey(v){
  if (typeof v !== 'string' || !v) return null;
  const k = fontKeyByName(v);
  if (k) return k;
  if (v.startsWith('cg:') && ensureCustomFont(v)) return v;
  if (/^[A-Z][A-Za-z0-9 ]{2,30}$/.test(v) && ensureCustomFont('cg:' + v)) return 'cg:' + v;
  return null;
}
function claudeWeight(el, w){
  const n = Number(w);
  if (!(n >= 100 && n <= 900)) return;
  el.fweight = Math.round(n / 100) * 100;
  ensureWeightCss(el.font); requestFontLoad(el.font, el.fweight);
}
function claudeBuildElement(rawSpec, idMap, warnings){
  const ex = claudeExpandSpec(rawSpec, warnings);
  const spec = ex.s;
  const kind = ['rect', 'diamond', 'ellipse', 'polygon', 'chip', 'text', 'arrow', 'line'].includes(spec.type)
    ? spec.type : 'rect';
  // When a brand kit is active it supplies every value Claude did not specify, so
  // anything drawn over the bridge comes out in the same line style, weight,
  // corners, fill style, arrowheads, ink and body font as the rest of your work.
  const BK = brandActive() ? brand : null;
  const BS = BK ? BK.style : null;
  const fontKey = claudeFontKey(spec.font);
  if (spec.font && !fontKey && warnings) warnings.push(`Unknown font "${spec.font}": the default was used.`);
  const style = {
    stroke: claudeColor(spec.stroke, STROKE_KEYS, BK ? BK.ink : 'ink'),
    fill: claudeColor(spec.fill, FILL_KEYS,
      kind === 'text' || kind === 'arrow' || kind === 'line' ? 'none' : defaults.fillByType[kind] || 'none'),
    fillStyle: ['solid', 'hachure', 'dense', 'cross', 'dots', 'waves'].includes(spec.fillStyle)
      ? spec.fillStyle : (BS ? BS.fillStyle : 'solid'),
    dash: ['solid', 'dotted', 'dashed'].includes(spec.dash) ? spec.dash : (BS ? BS.dash : 'solid'),
    sw: Number(spec.sw) > 0 ? clamp(Number(spec.sw), 0.5, 40) : (BS ? swForWeight(BS.weight) : widths.medium),
    sketch: [0, 1, 2].includes(spec.sketch) ? spec.sketch : (BS ? BS.sketch : 1),
    round: [0, 1].includes(spec.round) ? spec.round : (BS ? BS.round : 1),
    opacity: spec.opacity != null ? clamp(Number(spec.opacity), 0, 100) : 100,
    fillOpacity: spec.fillOpacity != null ? clamp(Number(spec.fillOpacity), 0, 100) : 100,
    font: fontKey || (BK ? BK.bodyFont : 'sans'),
    size: Number(spec.size) > 0 ? clamp(Number(spec.size), 8, 600)
      : (kind === 'chip' || kind === 'arrow' || kind === 'line' ? 16 : 21),
    align: ['left', 'center', 'right'].includes(spec.align) ? spec.align : (kind === 'text' ? 'left' : 'center'),
    lh: Number(spec.lineHeight) > 0 ? clamp(Number(spec.lineHeight), 0.5, 2.5) : typo.lh,
    pgap: typo.pgap,
    lspace: spec.letterSpacing != null ? claudeNum(spec.letterSpacing, typo.lspace, -7, 15) : typo.lspace,
    valign: ['top', 'middle', 'bottom'].includes(spec.valign) ? spec.valign : 'middle',
  };
  if (spec.textColor) style.textColor = claudeColor(spec.textColor, STROKE_KEYS, null);
  if (kind === 'polygon') style.sides = clamp(Math.round(Number(spec.sides) || 6), 3, 12);
  const x = claudeNum(spec.x, 0, -CLAUDE_COORD, CLAUDE_COORD), y = claudeNum(spec.y, 0, -CLAUDE_COORD, CLAUDE_COORD);
  const el = newElement(kind, x, y, style);
  el.x = x; el.y = y;
  claudeWeight(el, spec.weight);
  if (el.font.startsWith('cg:')){
    const fam = el.font.slice(3).trim();
    loadFontCssFor(fam);
    rememberGFont(fam); // Claude-loaded fonts appear in the font menu too
  }
  requestFontLoad(el.font, el.fweight);
  if (kind === 'arrow' || kind === 'line'){
    el.curve = 0;
    el.elbow = !!spec.elbow;
    el.startHead = HEAD_KINDS.includes(spec.startHead) ? spec.startHead : (BS ? BS.startHead : 'none');
    el.endHead = HEAD_KINDS.includes(spec.endHead) ? spec.endHead
      : (kind === 'arrow' ? (BS ? BS.endHead : 'arrow') : 'none');   // a plain line never sprouts a head
    const fromId = spec.from && idMap.get(String(spec.from));
    const toId = spec.to && idMap.get(String(spec.to));
    if (fromId && toId && fromId !== toId){
      el.startBind = fromId; el.endBind = toId;
      el.points = [[0, 0], [10, 0]];
    } else {
      const x2 = claudeNum(spec.x2, NaN, -CLAUDE_COORD, CLAUDE_COORD);
      const y2 = claudeNum(spec.y2, NaN, -CLAUDE_COORD, CLAUDE_COORD);
      el.points = [[0, 0], [isNaN(x2) ? 160 : x2 - x, isNaN(y2) ? 0 : y2 - y]];
    }
    el.text = claudeText(spec.text);
  } else {
    const defSize = { rect: [190, 92], diamond: [170, 120], ellipse: [160, 110], chip: [140, 40] }[kind];
    // a missing OR non-positive size means "use the default", not "make it 1px wide"
    const wPos = Number(spec.w) > 0 ? spec.w : undefined, hPos = Number(spec.h) > 0 ? spec.h : undefined;
    el.w = claudeNum(wPos, defSize ? defSize[0] : 120, 1, CLAUDE_SIZE);
    el.h = claudeNum(hPos, defSize ? defSize[1] : 60, 1, CLAUDE_SIZE);
    el.text = claudeText(spec.text);
    if (kind === 'text'){
      // wrap:true keeps the given width and breaks lines inside it; maxHeight is the
      // height the copy must fit, which koralpaper_measure checks
      if (spec.wrap === true && wPos !== undefined) el.wrap = true;
      if (Number(spec.maxHeight) > 0) el.maxH = claudeNum(spec.maxHeight, 0, 1, CLAUDE_SIZE);
    }
  }
  if (el.text && (spec.bold || spec.italic)) setWholeRun(el, { b: !!spec.bold, i: !!spec.italic });
  if (kind === 'text') autosizeText(el);
  if (spec.locked === true) el.locked = true;
  claudeRemember(el, rawSpec, ex);
  if (spec.id) idMap.set(String(spec.id), el.id);
  return el;
}
/* change one element from an update spec (already expanded: no style name, no $tokens) */
function claudeApplyUpdate(el, u){
  if (u.x !== undefined) el.x = claudeNum(u.x, el.x, -CLAUDE_COORD, CLAUDE_COORD);
  if (u.y !== undefined) el.y = claudeNum(u.y, el.y, -CLAUDE_COORD, CLAUDE_COORD);
  if (u.w !== undefined && Number(u.w) > 0) el.w = claudeNum(u.w, el.w, 1, CLAUDE_SIZE);
  if (u.h !== undefined && Number(u.h) > 0) el.h = claudeNum(u.h, el.h, 1, CLAUDE_SIZE);
  if (u.text !== undefined) setTextKeepRuns(el, claudeText(String(u.text)));
  if (u.stroke !== undefined) el.stroke = claudeColor(u.stroke, STROKE_KEYS, el.stroke);
  if (u.fill !== undefined) el.fill = claudeColor(u.fill, FILL_KEYS, el.fill);
  if (u.fillStyle !== undefined && ['solid','hachure','dense','cross','dots','waves'].includes(u.fillStyle)) el.fillStyle = u.fillStyle;
  if (u.dash !== undefined && ['solid','dotted','dashed'].includes(u.dash)) el.dash = u.dash;
  if (u.size !== undefined && Number(u.size) > 0) el.size = clamp(Number(u.size), 8, 600);
  if (u.font !== undefined){
    const k = claudeFontKey(u.font);
    if (k){
      el.font = k;
      if (k.startsWith('cg:')){ loadFontCssFor(k.slice(3).trim()); rememberGFont(k.slice(3).trim()); }
    }
  }
  if (u.weight !== undefined){ if (u.weight === null) delete el.fweight; else claudeWeight(el, u.weight); }
  if (u.bold !== undefined || u.italic !== undefined){
    const patch = {};
    if (u.bold !== undefined) patch.b = !!u.bold;
    if (u.italic !== undefined) patch.i = !!u.italic;
    setWholeRun(el, patch);
  }
  if (u.align !== undefined && ['left','center','right'].includes(u.align)) el.align = u.align;
  if (u.valign !== undefined && ['top','middle','bottom'].includes(u.valign)) el.valign = u.valign;
  if (u.lineHeight !== undefined && Number(u.lineHeight) > 0) el.lh = clamp(Number(u.lineHeight), 0.5, 2.5);
  if (u.letterSpacing !== undefined) el.lspace = claudeNum(u.letterSpacing, el.lspace || 0, -7, 15);
  if (u.textColor !== undefined) el.textColor = (!u.textColor || u.textColor === 'auto') ? null : claudeColor(u.textColor, STROKE_KEYS, el.textColor);
  if (u.folded !== undefined) el.folded = !!u.folded;
  if (u.mindRoot !== undefined){
    if (u.mindRoot) for (const other of state.elements) delete other.mindRoot;
    el.mindRoot = !!u.mindRoot;
    if (!u.mindRoot) delete el.mindRoot;
  }
  if (u.sketch !== undefined) el.sketch = u.sketch === 0 ? 0 : 1;
  if (u.sw !== undefined && Number(u.sw) > 0) el.sw = clamp(Number(u.sw), 0.5, 40);
  if (u.opacity !== undefined && Number(u.opacity) >= 0) el.opacity = clamp(Number(u.opacity), 0, 100);
  if (u.fillOpacity !== undefined && Number(u.fillOpacity) >= 0) el.fillOpacity = clamp(Number(u.fillOpacity), 0, 100);
  if (u.sides !== undefined && el.type === 'polygon') el.sides = clamp(Math.round(Number(u.sides) || 6), 3, 12);
  if (u.startHead !== undefined && HEAD_KINDS.includes(u.startHead)) el.startHead = u.startHead;
  if (u.endHead !== undefined && HEAD_KINDS.includes(u.endHead)) el.endHead = u.endHead;
  if (el.type === 'text'){
    if (u.wrap !== undefined) el.wrap = u.wrap === true;
    if (u.maxHeight !== undefined){ if (Number(u.maxHeight) > 0) el.maxH = claudeNum(u.maxHeight, 0, 1, CLAUDE_SIZE); else delete el.maxH; }
    autosizeText(el);
  }
  if (u.locked !== undefined) el.locked = u.locked === true;
  requestFontLoad(el.font, el.fweight);
  delete el._prims; delete el._pkey;
}
function claudeCompact(el){
  const c = { id: el.id, type: el.type, x: Math.round(el.x), y: Math.round(el.y),
    w: Math.round(el.w), h: Math.round(el.h) };
  const tok = el.tok || {};
  if (el.text){
    c.text = el.text;
    c.size = el.size;
    if (el.font && el.font !== 'sans') c.font = (FONTS[el.font] && FONTS[el.font].label) || el.font;
    if (el.fweight) c.weight = el.fweight;
    const len = el.text.length;
    const whole = el.runs && el.runs.length === 1 && el.runs[0].s === 0 && el.runs[0].e >= len ? el.runs[0] : null;
    if (whole && whole.b) c.bold = true;
    if (whole && whole.i) c.italic = true;
    if (el.runs && !whole) c.mixedFormatting = true;
    if (el.align && el.align !== (el.type === 'text' ? 'left' : 'center')) c.align = el.align;
  }
  if (el.type === 'text'){
    if (el.wrap) c.wrap = true;
    if (el.maxH) c.maxHeight = el.maxH;
  }
  if (tok.stroke) c.stroke = '$' + tok.stroke; else if (el.stroke && el.stroke !== 'ink') c.stroke = el.stroke;
  if (tok.fill) c.fill = '$' + tok.fill; else if (el.fill && el.fill !== 'none') c.fill = el.fill;
  if (el.sw != null) c.sw = Math.round(el.sw * 10) / 10;
  if (el.sketch === 0) c.sketch = 0;
  if (el.fillStyle && el.fillStyle !== 'solid') c.fillStyle = el.fillStyle;
  if (el.opacity != null && el.opacity < 100) c.opacity = el.opacity;
  if (el.fillOpacity != null && el.fillOpacity < 100) c.fillOpacity = el.fillOpacity;
  if (el.type === 'arrow' || el.type === 'line'){
    if (el.startBind) c.from = el.startBind;
    if (el.endBind) c.to = el.endBind;
    if (el.startHead && el.startHead !== 'none') c.startHead = el.startHead;
    if (el.endHead) c.endHead = el.endHead;
  }
  if (el.type === 'icon') c.icon = el.kind;
  if (el.type === 'polygon') c.sides = el.sides || 6;
  if (tok.textColor) c.textColor = '$' + tok.textColor; else if (el.textColor) c.textColor = el.textColor;
  if (el.tstyle) c.style = el.tstyle;
  if (el.locked) c.locked = true;
  if (el.mindRoot) c.mindRoot = true;
  if (el.folded) c.folded = true;
  return c;
}
const ownEls = p => p.elements.filter(e => !e.master);

/* every font face a set of elements needs is fetched before measuring or
   rendering, so numbers and pictures never come from a fallback font */
async function claudeFontsReady(els){
  const jobs = [], seen = new Set();
  for (const el of els){
    if (!el.text) continue;
    ensureCustomFont(el.font);
    const f = FONTS[el.font];
    if (!f || !(f.google || f.local)) continue;
    if (el.font.startsWith('cg:')) loadFontCssFor(el.font.slice(3).trim());
    const variants = [{}];
    for (const r of el.runs || []) variants.push({ b: !!r.b, i: !!r.i });
    for (const st of variants){
      const css = fontCSS(el.font, 21, st, el.fweight);
      const tag = f.local ? css + '|' + el.text : css;       // bundled fonts load per script, so the text matters
      if (seen.has(tag)) continue;
      seen.add(tag);
      try { jobs.push(document.fonts.load(css, f.local ? 'A' + el.text : undefined).catch(() => [])); } catch (e){}
    }
  }
  if (!jobs.length) return;
  await Promise.race([Promise.all(jobs), new Promise(res => setTimeout(res, 5000))]);
}
/* text drawn a moment ago was sized with whatever font was at hand; once the
   real font is in, size it again so the stored box matches what is drawn */
async function claudeSettleText(els){
  await claudeFontsReady(els);
  for (const el of els) if (el.type === 'text') autosizeText(el);
}
function claudeFontLoaded(el){
  const f = FONTS[el.font];
  if (!f || !(f.google || f.local)) return true;          // system stacks are always there
  const fam = f.stack.split(',')[0].replace(/"/g, '');
  for (const ff of document.fonts)
    if (ff.family.replace(/["']/g, '') === fam && ff.status === 'loaded') return true;
  return false;
}
/* images draw from a cache that fills in the background; wait for it */
async function claudeImagesReady(els){
  const entries = [];
  for (const el of els){
    const src = el._src || el._imgFillSrc;
    if (src) entries.push(getImageEntry(src));
  }
  const t0 = Date.now();
  while (entries.some(e => !e.ready && !(e.img.complete && !e.img.naturalWidth)) && Date.now() - t0 < 6000)
    await new Promise(res => setTimeout(res, 40));
}

/* one page as an image, at a chosen scale. Used by export and by the preview. */
async function claudeRenderPage(page, opts){
  const els = visibleEls(page.elements);
  const crop = pageCrop(els);
  if (!crop) return { error: `Page "${page.name}" is empty and the document has no artboard, so there is nothing to render.` };
  await claudeFontsReady(els);
  await claudeImagesReady(els);
  const maxDim = 8000;
  const want = claudeNum(opts.scale, 1, 0.1, 8);
  const sc = Math.min(want, maxDim / crop.w, maxDim / crop.h);
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.round(crop.w * sc));
  off.height = Math.max(1, Math.round(crop.h * sc));
  const offCtx = off.getContext('2d');
  if (opts.texts) offCtx._kpText = [];
  renderScene(offCtx, els, {
    width: off.width, height: off.height,
    camera: { x: -crop.x * sc, y: -crop.y * sc, z: sc },
    pal: pal(), bg: pageBgOf(page), transparent: false,
    grid: (opts.grid && state.board) ? state.grid : false, gridSize: gsize(),
    gridColor: gridColorForBg(page.bg || state.bgColor),
  });
  const mime = opts.format === 'jpg' ? 'image/jpeg' : 'image/png';
  const url = off.toDataURL(mime, 0.92);
  const out = { data: url.slice(url.indexOf(',') + 1), mime, pxW: off.width, pxH: off.height,
    w: Math.round(crop.w), h: Math.round(crop.h), scale: Math.round(sc * 1000) / 1000 };
  if (opts.texts) out.texts = claudePageTexts(offCtx._kpText || [], sc);
  return out;
}
/* the lines the canvas really painted, in page units (1 unit = 1 artboard px, origin top-left),
   grouped by element and put in reading order: top to bottom, then left to right */
function claudePageTexts(raw, sc){
  const r2 = n => Math.round(n * 100) / 100;
  const groups = new Map();
  for (const t of raw){
    const [a, b, c, d, e, f] = t.m;
    const k = Math.hypot(a, b) || 1;                     // how much the page and any scaling enlarge the text
    const by = t.y + t.size * 0.34;                      // lines are painted around their middle; the baseline sits below it
    const line = {
      text: t.text, x: r2((a * t.x + c * by + e) / sc), y: r2((b * t.x + d * by + f) / sc),
      w: r2(t.w * k / sc), size: r2(t.size * k / sc), angle: Math.round(Math.atan2(b, a) * 10000) / 10000,
    };
    if (!groups.has(t.id)) groups.set(t.id, []);
    groups.get(t.id).push(line);
  }
  const ordered = [...groups.values()].sort((g1, g2) => {
    const y1 = Math.min(...g1.map(l => l.y - l.size)), y2 = Math.min(...g2.map(l => l.y - l.size));
    if (Math.abs(y1 - y2) > 4) return y1 - y2;
    return Math.min(...g1.map(l => l.x)) - Math.min(...g2.map(l => l.x));
  });
  return ordered.flat();
}

/* what a text really does inside its box */
function claudeMeasureOne(el, page){
  const out = { id: el.id, pageId: page.id, type: el.type };
  if (!canHaveText(el) || el.type === 'arrow' || el.type === 'line'){
    out.error = 'This element holds no text box to measure.';
    return out;
  }
  const isText = el.type === 'text';
  const pad = el.type === 'chip' ? 10 : 12;
  const availW = isText ? (el.wrap ? Math.max(40, el.w) : null) : Math.max(20, el.w - pad * 2);
  const availH = isText ? (el.maxH || null) : Math.max(0, el.h - pad * 2);
  const lay = layoutText(el, availW);
  const r1 = n => Math.round(n * 10) / 10;
  const reasons = [];
  if (availH != null && lay.totalH > availH + 0.5)
    reasons.push(`The text is ${r1(lay.totalH)}px tall but only ${r1(availH)}px fits: ${r1(lay.totalH - availH)}px too much.`);
  if (availW != null && lay.w > availW + 0.5)
    reasons.push(`The widest line is ${r1(lay.w)}px but only ${r1(availW)}px fits: a word is too long to wrap.`);
  const box = isText ? { x: el.x, y: el.y, w: el.wrap ? el.w : lay.w, h: lay.totalH } : { x: el.x, y: el.y, w: el.w, h: el.h };
  const b = state.board;
  let outsideBoard = false, outsideSafe = null;
  if (b){
    outsideBoard = box.x < b.x - 0.5 || box.y < b.y - 0.5 || box.x + box.w > b.x + b.w + 0.5 || box.y + box.h > b.y + b.h + 0.5;
    if (outsideBoard) reasons.push('The text box reaches past the edge of the artboard, so it is cut off in exports.');
    if (b.safe > 0)
      outsideSafe = box.x < b.x + b.safe - 0.5 || box.y < b.y + b.safe - 0.5
        || box.x + box.w > b.x + b.w - b.safe + 0.5 || box.y + box.h > b.y + b.h - b.safe + 0.5;
  }
  Object.assign(out, {
    box: { x: r1(box.x), y: r1(box.y), w: r1(box.w), h: r1(box.h) },
    font: (FONTS[el.font] && FONTS[el.font].label) || el.font, size: el.size,
    fontLoaded: claudeFontLoaded(el),
    lineHeight: lay.lh,
    lines: lay.lines.map(l => l.text), lineCount: lay.lines.length,
    textWidth: r1(lay.w), textHeight: r1(lay.totalH),
    availableWidth: availW == null ? null : r1(availW),
    availableHeight: availH == null ? null : r1(availH),
    overflow: reasons.length > 0, reasons,
  });
  if (outsideSafe !== null) out.outsideSafeArea = outsideSafe;
  if (isText && !el.wrap && !el.maxH && !b)
    out.note = 'A free text with no wrap width, no maxHeight and no artboard has nothing to overflow.';
  return out;
}

/* ── SVG import ────────────────────────────────────── */
function cssToHex(v){
  if (!v || v === 'none' || v === 'transparent') return null;
  const m = String(v).match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/);
  if (!m) return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : null;
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
  return '#' + [m[1], m[2], m[3]].map(n => clamp(Math.round(Number(n)), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}
// An allow list, not a block list: only known drawing elements in the SVG namespace survive,
// and only attributes that cannot run code or reach outside the file. Anything unknown is dropped.
const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_OK_ELEMENTS = new Set(['svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'path', 'polygon', 'polyline',
  'text', 'tspan', 'title', 'desc', 'defs', 'symbol', 'use', 'image', 'style',
  'linearGradient', 'radialGradient', 'stop', 'pattern', 'marker', 'clipPath', 'mask', 'filter',
  'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB',
  'feFuncG', 'feFuncR', 'feGaussianBlur', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'feTurbulence']);
const SVG_OK_ATTR_NS = new Set([null, 'http://www.w3.org/1999/xlink', 'http://www.w3.org/XML/1998/namespace', 'http://www.w3.org/2000/xmlns/']);
function svgCssSafe(css){
  // no imports, no escapes that could hide one, and url() may only point inside the file
  if (/@import|\\|expression\s*\(|javascript:/i.test(css)) return false;
  for (const m of css.matchAll(/url\(\s*(['"]?)([^)]*)/gi)) if (!m[2].trim().startsWith('#')) return false;
  return true;
}
function svgSanitize(root){
  for (const n of [root, ...root.querySelectorAll('*')]){
    if (n !== root && !root.contains(n)) continue;       // already dropped with its parent
    if (n.namespaceURI !== SVG_NS || !SVG_OK_ELEMENTS.has(n.localName)){
      if (n === root) return false;
      n.remove(); continue;
    }
    if (n.localName === 'style' && !svgCssSafe(n.textContent || '')){ n.remove(); continue; }
    for (const a of [...n.attributes]){
      const local = (a.localName || a.name).toLowerCase(), val = a.value.replace(/[\u0000- ]+/g, '').toLowerCase();
      let keep = SVG_OK_ATTR_NS.has(a.namespaceURI) && !local.startsWith('on');
      if (keep && local === 'href'){
        const picture = n.localName === 'image' && /^data:image\/(png|jpeg|gif|webp);base64,/.test(val);
        keep = val.startsWith('#') || picture;
      } else if (keep && local === 'style') keep = svgCssSafe(a.value);
      else if (keep && (/javascript:|data:text|vbscript:/.test(val))) keep = false;
      else if (keep && /url\(/.test(val)) keep = svgCssSafe(a.value);
      if (!keep) n.removeAttributeNode(a);
    }
  }
  return true;
}
async function claudeImportSvg(svgText, pageName){
  if (typeof svgText !== 'string' || !svgText.trim()) return { error: 'No SVG given.' };
  if (svgText.length > 6 * 1024 * 1024) return { error: 'That SVG is over 6 MB, too large to import.' };
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root0 = parsed.documentElement;
  if (!root0 || root0.localName !== 'svg' || parsed.querySelector('parsererror'))
    return { error: 'That text is not a readable SVG.' };
  if (!svgSanitize(root0)) return { error: 'That text is not a readable SVG.' };
  const vb = (root0.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  let W = parseFloat(root0.getAttribute('width')), H = parseFloat(root0.getAttribute('height'));
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0){ W = vb[2]; H = vb[3]; }
  if (!(W > 0) || !(H > 0)) return { error: 'The SVG has no size: give it a viewBox, or a width and a height.' };
  W = Math.min(W, 20000); H = Math.min(H, 20000);
  const host = document.createElement('div');
  // off screen but still laid out and "visible": a hidden host would make every child report visibility:hidden
  host.style.cssText = 'position:fixed;left:-99999px;top:0;opacity:0;pointer-events:none;';
  const root = document.importNode(root0, true);
  root.setAttribute('width', W); root.setAttribute('height', H);
  if (vb.length !== 4) root.setAttribute('viewBox', `0 0 ${W} ${H}`);
  host.appendChild(root);
  document.body.appendChild(host);
  const els = [], warnings = [];
  let paper = null, converted = 0;
  try {
    if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]);
    const mapBox = node => {
      const bb = node.getBBox(), m = node.getCTM();
      const pts = [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x + bb.width, bb.y + bb.height], [bb.x, bb.y + bb.height]]
        .map(([px, py]) => [m.a * px + m.c * py + m.e, m.b * px + m.d * py + m.f]);
      const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
      const angle = Math.atan2(m.b, m.a);
      if (Math.abs(angle) < 0.002){
        const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
        return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), scale, angle: 0 };
      }
      // rotated: keep the unrotated size, centred where the shape really sits
      const cx = (pts[0][0] + pts[2][0]) / 2, cy = (pts[0][1] + pts[2][1]) / 2;
      const w = bb.width * scale, h = bb.height * scale;
      return { x: cx - w / 2, y: cy - h / 2, w, h, scale, angle };
    };
    const paint = (node, box) => {
      const cs = getComputedStyle(node);
      if (/url\(/.test(cs.fill) || /url\(/.test(cs.stroke)) return null;       // gradients and patterns stay in the picture
      const fill = cssToHex(cs.fill), stroke = cssToHex(cs.stroke);
      const fo = parseFloat(cs.fillOpacity), op = parseFloat(cs.opacity);
      return {
        fill: fill || 'none', stroke: stroke || 'none',
        sw: stroke ? clamp((parseFloat(cs.strokeWidth) || 1) * box.scale, 0.5, 40) : 1,
        fillOpacity: Number.isFinite(fo) ? Math.round(clamp(fo, 0, 1) * 100) : 100,
        opacity: Number.isFinite(op) ? Math.round(clamp(op, 0, 1) * 100) : 100,
      };
    };
    const base = { sketch: 0, fillStyle: 'solid', dash: 'solid' };
    const shown = node => {
      for (let n = node; n && n !== host; n = n.parentElement){
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (['defs', 'clipPath', 'mask', 'symbol', 'pattern', 'marker', 'linearGradient', 'radialGradient'].includes(n.localName)) return false;
      }
      return true;
    };
    const clipped = node => {
      for (let n = node; n && n !== root; n = n.parentElement)
        if (n.getAttribute('clip-path') || n.getAttribute('mask') || n.getAttribute('filter')) return true;
      return false;
    };
    let first = true;
    for (const node of [...root.querySelectorAll('rect,circle,ellipse,line,text')]){
      if (!shown(node) || clipped(node)) continue;
      let box;
      try { box = mapBox(node); } catch (e){ continue; }
      const kind = node.localName;
      if (kind === 'text'){
        const cs = getComputedStyle(node);
        const size = clamp((parseFloat(cs.fontSize) || 16) * box.scale, 8, 600);
        const fam = (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim();
        // each tspan that starts its own line (its own x, y or dy) becomes a line break
        const spans = [...node.children].filter(n => n.localName === 'tspan');
        let text;
        const breaks = spans.filter(sp => sp.hasAttribute('dy') || sp.hasAttribute('y') || sp.hasAttribute('x'));
        if (spans.length > 1 && breaks.length >= spans.length - 1) text = spans.map(sp => sp.textContent).join('\n');
        else text = node.textContent;
        text = text.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
        if (!text) continue;
        const lines = text.split('\n').length;
        const fill = /url\(/.test(cs.fill) ? null : cssToHex(cs.fill);
        const anchor = cs.textAnchor || 'start';
        const el = newElement('text', box.x, box.y, Object.assign({}, base, {
          stroke: fill || '#000000', fill: 'none', size: Math.round(size * 10) / 10,
          font: claudeFontKey(fam) || 'sans',
          align: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left',
          lh: clamp(lines > 1 ? (box.h / lines) / size : 1.2, 0.8, 2.5), pgap: 0,
          lspace: clamp((parseFloat(cs.letterSpacing) || 0) * box.scale, -7, 15), valign: 'middle',
        }));
        if (fam && !claudeFontKey(fam)) warnings.push(`Font "${fam}" is not available in KoralPaper: "${text.slice(0, 24)}" uses the default sans.`);
        const wgt = parseInt(cs.fontWeight, 10);
        if (wgt >= 100 && wgt <= 900) el.fweight = Math.round(wgt / 100) * 100;
        el.text = claudeText(text);
        if (cs.fontStyle === 'italic' || cs.fontStyle === 'oblique') setWholeRun(el, { i: true });
        const op = parseFloat(cs.opacity);
        if (Number.isFinite(op)) el.opacity = Math.round(clamp(op, 0, 1) * 100);
        el.angle = box.angle;
        await claudeFontsReady([el]);
        autosizeText(el);
        // sit the laid-out text on the centre line of the original, anchored the same way
        el.y = box.y + box.h / 2 - el.h / 2;
        el.x = el.align === 'center' ? box.x + box.w / 2 - el.w / 2 : el.align === 'right' ? box.x + box.w - el.w : box.x;
        els.push(el);
      } else {
        const pt = paint(node, box);
        if (!pt) continue;
        if (pt.fill === 'none' && pt.stroke === 'none') continue;
        if (kind === 'rect' && first && !box.angle && pt.fill !== 'none' && pt.fillOpacity === 100 && pt.opacity === 100
            && box.x <= 0.5 && box.y <= 0.5 && box.w >= W - 1 && box.h >= H - 1){
          paper = pt.fill;                       // a full-size first rectangle is the page background
        } else if (kind === 'line'){
          const m = node.getCTM();
          const P = (px, py) => [m.a * px + m.c * py + m.e, m.b * px + m.d * py + m.f];
          const a = P(parseFloat(node.getAttribute('x1')) || 0, parseFloat(node.getAttribute('y1')) || 0);
          const b = P(parseFloat(node.getAttribute('x2')) || 0, parseFloat(node.getAttribute('y2')) || 0);
          const el = newElement('line', a[0], a[1], Object.assign({}, base, { stroke: pt.stroke === 'none' ? '#000000' : pt.stroke, sw: pt.sw, opacity: pt.opacity }));
          el.points = [[0, 0], [b[0] - a[0], b[1] - a[1]]];
          el.startHead = 'none'; el.endHead = 'none';
          els.push(el);
        } else {
          const rx = kind === 'rect' ? (parseFloat(node.getAttribute('rx')) || parseFloat(node.getAttribute('ry')) || 0) : 0;
          const el = newElement(kind === 'rect' ? 'rect' : 'ellipse', box.x, box.y, Object.assign({}, base, pt, { round: rx > 0 ? 1 : 0 }));
          el.w = Math.max(1, box.w); el.h = Math.max(1, box.h); el.angle = box.angle;
          els.push(el);
        }
      }
      first = false;
      converted++;
      node.setAttribute('data-kp-done', '1');
    }
    // whatever could not become an editable element stays as one vector picture behind them
    for (const n of [...root.querySelectorAll('[data-kp-done]')]) n.remove();
    const rest = [...root.querySelectorAll('path,polygon,polyline,image,use,rect,circle,ellipse,line,text')].filter(shown);
    if (rest.length){
      root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const xml = new XMLSerializer().serializeToString(root);
      const bytes = new TextEncoder().encode(xml);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      const img = newElement('image', 0, 0, {});
      img.stroke = 'none';
      img._src = 'data:image/svg+xml;base64,' + btoa(bin);
      img.w = W; img.h = H;
      internImage(img);
      els.unshift(img);
      warnings.push(`${rest.length} shape${rest.length > 1 ? 's' : ''} (paths, polygons, gradients or clipped art) could not become editable elements and were kept together as one vector picture behind the rest.`);
    }
  } finally {
    host.remove();
  }
  if (!els.length && !paper) return { error: 'Nothing drawable was found in that SVG.' };
  syncPageRef();
  const m = state.meta;
  const starter = m.starter && state.pages.find(p => p.id === m.starter && !p.elements.length);
  const name = typeof pageName === 'string' && pageName.trim() ? pageName.trim().slice(0, 80) : 'Imported SVG';
  let page;
  if (starter){ page = starter; page.name = name; page.elements = els; m.starter = null; }
  else { page = makePage(els, name); state.pages.push(page); }
  if (paper) page.bg = paper;
  state.pageIndex = state.pages.indexOf(page);
  state.elements = page.elements;
  state.selection = new Set();
  if (!state.board) state.board = { name: 'Custom', w: Math.round(W), h: Math.round(H), x: 0, y: 0 };
  else if (Math.round(W) !== state.board.w || Math.round(H) !== state.board.h)
    warnings.push(`The SVG is ${Math.round(W)} × ${Math.round(H)} but this document's artboard is ${state.board.w} × ${state.board.h}; positions were kept as they are in the SVG.`);
  preloadDocFonts();
  syncToggles(); syncBoardBtn(); buildBoardMenuSel(); syncPaperUI();
  commit(); buildPageStrip(); zoomToFit(); syncPanel();
  showHint('Claude imported an SVG: its text and shapes are editable');
  return { page, converted, texts: els.filter(e => e.type === 'text').length, warnings };
}

/* ── command handling ──────────────────────────────── */
function claudeBrandInfo(){
  if (!brandActive()) return null;
  return {
    name: brand.name || 'Brand',
    primary: brand.primary,
    secondary: brand.secondary,
    palette: brand.palette,
    ink: brand.ink,
    muted: brand.muted || null,
    accents: brandAccents(),
    paper: (brand.usePaper && brand.paper) || null,
    headingFont: brand.headFont.replace(/^cg:/, ''),
    bodyFont: brand.bodyFont.replace(/^cg:/, ''),
    style: brand.style,
    note: 'A brand kit is active. Use colors by role: primary = hero / first chart series / headline accent / the ✳; secondary = support / second series; palette = extra categorical colors; ink = outlines and body text; paper = background. Charts should run primary, secondary, then palette in order. Also match the brand style: draw shapes with sketch=style.sketch (0 neat, 1 sketchy, 2 scribbly), dash=style.dash, corners round=style.round, fill fillStyle=style.fillStyle, and arrows with style.startHead/endHead. Weight "' + brand.style.weight + '" ≈ sw ' + swForWeight(brand.style.weight) + '.',
  };
}
function claudeBoardInfo(){
  const b = state.board;
  if (!b) return null;
  const out = { w: b.w, h: b.h, name: b.name };
  if (b.safe > 0) out.safeArea = b.safe;
  return out;
}
/* Find the document and page a command is aimed at.
   - documentId: when it names another document, that document is opened first
     (the one on screen is filed in the library, nothing is lost).
   - pageId: the page to act on; without it, the page on screen.
   - ifVersion (writes): refuse when the page changed since that version. */
async function claudeTarget(args, forWrite){
  if (args.documentId != null && String(args.documentId) !== state.meta.id){
    const ok = await docOpen(String(args.documentId));
    if (!ok) return { error: `No document with id "${args.documentId}". Call koralpaper_list_documents to see the documents and their ids.` };
    showHint('Claude opened “' + state.meta.name + '”. Your other documents are in ☰ → Documents');
  }
  if (forWrite && editing) commitTextEdit();
  docTrack();
  let idx = state.pageIndex;
  if (args.pageId != null){
    idx = state.pages.findIndex(p => p.id === String(args.pageId));
    if (idx < 0) return { error: `No page with id "${args.pageId}" in document "${state.meta.name}". Its pages: ${state.pages.map((p, i) => `${i + 1}. ${p.name} (${p.id})`).join(', ')}.` };
  }
  const page = state.pages[idx];
  if (forWrite){
    if (args.ifVersion != null){
      const cur = pageVersion(page), given = Number(args.ifVersion);
      if (given !== cur)
        return { error: `Refused, nothing was written: page "${page.name}" changed since version ${args.ifVersion} (it is now at version ${cur}). Someone edited it after you read it. Call koralpaper_read_document again, look at what changed, then retry with ifVersion ${cur}.` };
    }
    if (idx !== state.pageIndex) switchPage(idx);
  }
  return { idx, page };
}
function claudeDone(page, extra, warnings){
  docTrack();
  const out = Object.assign({ ok: true, documentId: state.meta.id, pageId: page.id,
    version: pageVersion(page), documentVersion: state.meta.clock }, extra || {});
  if (warnings && warnings.length) out.warnings = [...new Set(warnings)];
  return out;
}
function claudeBuildAll(specs, idMap, warnings){
  const shapes = specs.filter(s => s && s.type !== 'arrow' && s.type !== 'line');
  const linears = specs.filter(s => s && (s.type === 'arrow' || s.type === 'line'));
  return shapes.map(s => claudeBuildElement(s, idMap, warnings))
    .concat(linears.map(s => claudeBuildElement(s, idMap, warnings)));
}
const STYLE_NAME = /^[A-Za-z0-9_-]{1,40}$/;

async function claudeExecute(action, args){
  args = (args && typeof args === 'object') ? args : {};
  if (!state.meta) state.meta = normalizeMeta(null);

  if (action === 'app_info'){
    docTrack();
    return { app: 'koralpaper', appVersion: APP_VERSION, caps: CLAUDE_CAPS,
      documentId: state.meta.id, document: state.meta.name, pages: state.pages.length };
  }

  /* ── documents ── */
  if (action === 'list_documents'){
    const docs = await docList();
    const snaps = await libAll('snaps');
    for (const d of docs){
      const mine = snaps.filter(s => s.docId === d.id).sort((a, b) => a.at < b.at ? 1 : -1);
      if (mine.length) d.snapshots = mine.map(s => ({ snapshotId: s.id, name: s.name, at: s.at, pages: s.pages }));
      d.updatedAt = new Date(d.updatedAt).toISOString();
    }
    return { documents: docs, openDocumentId: state.meta.id };
  }
  if (action === 'create_document'){
    await docCreate(args.name, args.board);
    showHint('Claude started a new document. Your previous one is in ☰ → Documents');
    return { ok: true, documentId: state.meta.id, name: state.meta.name, board: claudeBoardInfo(),
      pageId: state.pages[0].id, version: pageVersion(state.pages[0]), documentVersion: state.meta.clock,
      note: 'The document has one blank page. The first page you create with koralpaper_create_page takes its place.' };
  }
  if (action === 'open_document'){
    if (args.id == null && args.documentId == null) return { error: 'Give the id of the document to open.' };
    const id = String(args.id != null ? args.id : args.documentId);
    const was = state.meta.id;
    const ok = await docOpen(id);
    if (!ok) return { error: `No document with id "${id}". Call koralpaper_list_documents to see the documents and their ids.` };
    if (was !== id) showHint('Claude opened “' + state.meta.name + '”. Your other documents are in ☰ → Documents');
    return { ok: true, documentId: state.meta.id, name: state.meta.name, board: claudeBoardInfo(),
      documentVersion: state.meta.clock,
      pages: state.pages.map(p => ({ id: p.id, name: p.name, version: pageVersion(p), elements: ownEls(p).length })) };
  }

  /* ── reading ── */
  if (action === 'read_document'){
    const t = await claudeTarget(args, false);
    if (t.error) return t;
    const only = args.pageId != null ? t.page.id : null;
    const m = state.meta;
    const out = {
      documentId: m.id, name: m.name, version: m.clock,
      board: claudeBoardInfo(),
      brand: claudeBrandInfo(),
      theme: state.theme,
      pages: state.pages.map((p, i) => {
        const pg = { id: p.id, name: p.name, number: i + 1, version: pageVersion(p), current: i === state.pageIndex };
        if (p.bg) pg.paper = p.bg;
        if (!only || only === p.id) pg.elements = ownEls(p).map(claudeCompact);
        else pg.elementCount = ownEls(p).length;
        return pg;
      }),
    };
    if (Object.keys(m.styles.text).length || Object.keys(m.styles.colors).length)
      out.styles = { text: m.styles.text, colors: m.styles.colors };
    if (m.master) out.master = { front: m.master.front, skipPageIds: m.master.skip, elements: m.master.elements.map(claudeCompact) };
    const open = m.comments.filter(c => !c.resolved).length;
    if (open) out.openComments = open;
    return out;
  }
  if (action === 'get_selection'){
    docTrack();
    const page = state.pages[state.pageIndex];
    const sel = selected().filter(e => !e.master);
    return { documentId: state.meta.id, pageId: page.id, page: page.name, version: pageVersion(page),
      ids: sel.map(e => e.id), elements: sel.map(claudeCompact) };
  }
  if (action === 'get_changes'){
    const t = await claudeTarget(args, false);
    if (t.error) return t;
    const m = state.meta;
    const since = Math.max(0, Math.floor(Number(args.sinceVersion) || 0));
    const added = [], changed = [];
    for (const p of state.pages) for (const el of p.elements){
      if (el.master) continue;
      const r = m.ev[el.id];
      if (!r || r.v <= since) continue;
      (r.b > since ? added : changed).push(Object.assign({ pageId: p.id, changedAt: r.v }, claudeCompact(el)));
    }
    const removed = m.gone.filter(g => g.v > since && g.b <= since).map(g => ({ id: g.id, pageId: g.p, removedAt: g.v }));
    return { documentId: m.id, sinceVersion: since, version: m.clock, added, changed, removed,
      pagesChanged: state.pages.filter(p => pageVersion(p) > since).map(p => ({ id: p.id, name: p.name, version: pageVersion(p) })),
      note: since >= m.clock ? 'Nothing changed since that version.' : undefined };
  }
  if (action === 'measure'){
    const t = await claudeTarget(args, false);
    if (t.error) return t;
    const ids = (Array.isArray(args.elementIds) ? args.elementIds : []).map(String);
    if (!ids.length) return { error: 'Give the ids of the elements to measure in elementIds.' };
    const pages = args.pageId != null ? [t.page] : state.pages;
    const found = [];
    for (const id of ids){
      let hit = null;
      for (const p of pages){ const el = p.elements.find(e => e.id === id); if (el){ hit = { el, p }; break; } }
      found.push({ id, hit });
    }
    await claudeFontsReady(found.filter(f => f.hit).map(f => f.hit.el));
    return { documentId: state.meta.id, board: claudeBoardInfo(),
      elements: found.map(f => f.hit ? claudeMeasureOne(f.hit.el, f.hit.p) : { id: f.id, error: 'No element with this id.' }) };
  }
  if (action === 'render_page'){
    const t = await claudeTarget(args, false);
    if (t.error) return t;
    const els = visibleEls(t.page.elements);
    await claudeFontsReady(els);
    await claudeImagesReady(els);
    const blob = await renderPagePNGBlob(els, false, t.page);
    if (!blob) return { error: 'This page is empty.' };
    // downscale for the eye check: Claude needs layout, not print quality
    const img = await createImageBitmap(blob);
    const scale = Math.min(1, 1100 / img.width);
    const off = document.createElement('canvas');
    off.width = Math.round(img.width * scale);
    off.height = Math.round(img.height * scale);
    off.getContext('2d').drawImage(img, 0, 0, off.width, off.height);
    const dataUrl = off.toDataURL('image/png');
    return { png: dataUrl.slice(dataUrl.indexOf(',') + 1),
      note: `Page "${t.page.name}" (${t.idx + 1} of ${state.pages.length}), ${ownEls(t.page).length} elements, version ${pageVersion(t.page)}.` };
  }
  if (action === 'export_info'){
    const t = await claudeTarget(args, false);
    if (t.error) return t;
    let pages = state.pages.map((p, i) => ({ id: p.id, name: p.name, number: i + 1 }));
    if (Array.isArray(args.pageIds)){
      const want = args.pageIds.map(String);
      const missing = want.filter(id => !pages.some(p => p.id === id));
      if (missing.length) return { error: `No page with id ${missing.map(x => '"' + x + '"').join(', ')} in document "${state.meta.name}".` };
      pages = pages.filter(p => want.includes(p.id));        // document order, whatever order was asked
    }
    return { documentId: state.meta.id, name: state.meta.name, board: claudeBoardInfo(), totalPages: state.pages.length, pages };
  }
  if (action === 'export_page'){
    const t = await claudeTarget(args, false);
    if (t.error) return t;
    return claudeRenderPage(t.page, { format: args.format === 'jpg' ? 'jpg' : 'png', scale: args.scale, grid: args.grid === true, texts: args.texts === true });
  }

  /* ── drawing ── */
  if (action === 'create_page'){
    const batch = Array.isArray(args.pages) && args.pages.length ? args.pages
      : [{ name: args.name, paper: args.paper, elements: args.elements }];
    if (batch.length > 60) return { error: 'At most 60 pages in one call.' };
    for (const b of batch) if (!b || !Array.isArray(b.elements) || !b.elements.length)
      return { error: batch.length > 1 ? 'Every page in pages needs an elements list.' : 'No elements given.' };
    if (args.documentId != null && String(args.documentId) !== state.meta.id){
      const t = await claudeTarget({ documentId: args.documentId }, false);
      if (t.error) return t;
    }
    if (editing) commitTextEdit();
    docTrack();
    if (args.ifVersion != null && Number(args.ifVersion) !== state.meta.clock)
      return { error: `Refused, nothing was written: document "${state.meta.name}" changed since version ${args.ifVersion} (it is now at version ${state.meta.clock}). Call koralpaper_read_document again, then retry with ifVersion ${state.meta.clock}.` };
    syncPageRef();
    const warnings = [], made = [];
    for (const b of batch){
      const idMap = new Map();
      const els = claudeBuildAll(b.elements, idMap, warnings);
      await claudeSettleText(els);
      const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 80) : 'Claude page';
      // the blank first page of a document Claude just created is used, not left behind
      const starter = state.meta.starter && state.pages.find(p => p.id === state.meta.starter && !p.elements.length);
      let page;
      if (starter){ page = starter; page.name = name; page.elements = els; state.meta.starter = null; }
      else { page = makePage(els, name); state.pages.push(page); }
      if (typeof b.paper === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(b.paper)) page.bg = b.paper;
      updateBoundArrows(page.elements);
      made.push({ page, idMap });
    }
    const last = made[made.length - 1].page;
    state.pageIndex = state.pages.indexOf(last);
    state.elements = last.elements;
    state.selection = new Set();
    const board = claudeBoard(args.board);
    if (board) state.board = board;
    updateBoundArrows(state.elements);
    preloadDocFonts();
    syncToggles(); syncBoardBtn(); buildBoardMenuSel(); syncPaperUI();
    commit(); buildPageStrip(); zoomToFit(); syncPanel();
    showHint(made.length > 1 ? `Claude drew ${made.length} new pages: every element is fully editable`
      : 'Claude drew a new page: every element is fully editable');
    docTrack();                // versions are final before they are reported
    if (made.length === 1)
      return claudeDone(last, { page: last.name, ids: Object.fromEntries(made[0].idMap), elements: ownEls(last).length }, warnings);
    return claudeDone(last, { pages: made.map(x => ({ pageId: x.page.id, name: x.page.name, version: pageVersion(x.page),
      ids: Object.fromEntries(x.idMap), elements: ownEls(x.page).length })) }, warnings);
  }
  if (action === 'add_elements'){
    const specs = Array.isArray(args.elements) ? args.elements : [];
    if (!specs.length) return { error: 'No elements given.' };
    const t = await claudeTarget(args, true);
    if (t.error) return t;
    const idMap = new Map(), warnings = [];
    for (const el of state.elements) idMap.set(el.id, el.id); // arrows may bind existing shapes
    const fresh = claudeBuildAll(specs, idMap, warnings);
    await claudeSettleText(fresh);
    for (const el of fresh) state.elements.push(el);
    updateBoundArrows(state.elements);
    preloadDocFonts();
    commit(); requestRender(); syncPanel();
    showHint('Claude added to this page');
    return claudeDone(t.page, { ids: Object.fromEntries(idMap), elements: ownEls(t.page).length }, warnings);
  }
  if (action === 'update_elements'){
    const ups = Array.isArray(args.updates) ? args.updates : [];
    const t = await claudeTarget(args, true);
    if (t.error) return t;
    let touched = 0;
    const warnings = [], skippedLocked = [], notFound = [], changedEls = [];
    for (const u of ups){
      if (!u || u.id == null) continue;
      const el = byId(String(u.id));
      if (!el || el.master){ notFound.push(String(u.id)); continue; }
      // a locked element is left alone unless this very update unlocks it
      if (el.locked && u.locked !== false){ skippedLocked.push(el.id); continue; }
      const ex = claudeExpandSpec(u, warnings);
      claudeApplyUpdate(el, ex.s);
      claudeRemember(el, u, ex);
      changedEls.push(el);
      touched++;
    }
    await claudeSettleText(changedEls);
    if (!touched){
      if (skippedLocked.length) return { error: `Nothing was changed: ${skippedLocked.length === 1 ? 'that element is' : 'those elements are'} locked (${skippedLocked.join(', ')}). Send locked:false in the same update to unlock and change ${skippedLocked.length === 1 ? 'it' : 'them'}, or leave locked elements alone.` };
      return { error: `No matching element ids on page "${t.page.name}".` };
    }
    updateBoundArrows(state.elements);
    preloadDocFonts();
    commit(); requestRender(); syncPanel();
    const extra = { updated: touched };
    if (skippedLocked.length) extra.skippedLocked = skippedLocked;
    if (notFound.length) extra.notFound = notFound;
    return claudeDone(t.page, extra, warnings);
  }
  if (action === 'delete_elements'){
    const t = await claudeTarget(args, true);
    if (t.error) return t;
    const ids = new Set((Array.isArray(args.ids) ? args.ids : []).map(String));
    const skippedLocked = state.elements.filter(e => ids.has(e.id) && e.locked && !e.master).map(e => e.id);
    const before = state.elements.length;
    state.elements = state.elements.filter(e => !ids.has(e.id) || e.locked || e.master);
    state.pages[state.pageIndex].elements = state.elements;
    state.selection = new Set();
    updateBoundArrows(state.elements);
    const deleted = before - state.elements.length;
    if (!deleted && skippedLocked.length)
      return { error: `Nothing was deleted: ${skippedLocked.join(', ')} ${skippedLocked.length === 1 ? 'is' : 'are'} locked. Unlock with koralpaper_update_elements (locked:false) first, or leave locked elements alone.` };
    commit(); requestRender(); syncPanel();
    const extra = { deleted };
    if (skippedLocked.length) extra.skippedLocked = skippedLocked;
    return claudeDone(t.page, extra);
  }
  if (action === 'import_svg'){
    if (args.documentId != null && String(args.documentId) !== state.meta.id){
      const t = await claudeTarget({ documentId: args.documentId }, false);
      if (t.error) return t;
    }
    if (editing) commitTextEdit();
    const r = await claudeImportSvg(args.svg, args.pageName);
    if (r.error) return r;
    return claudeDone(r.page, { page: r.page.name, converted: r.converted, texts: r.texts,
      elements: ownEls(r.page).map(claudeCompact) }, r.warnings);
  }

  /* ── styles and the master page ── */
  if (action === 'set_styles'){
    const t = await claudeTarget(args, false);
    if (t.error) return t;
    if (editing) commitTextEdit();
    const m = state.meta, warnings = [];
    const ts = (args.textStyles && typeof args.textStyles === 'object') ? args.textStyles : {};
    const cs = (args.colors && typeof args.colors === 'object') ? args.colors : {};
    for (const [name, v] of Object.entries(cs)){
      if (!STYLE_NAME.test(name)){ warnings.push(`Colour name "${name}" was skipped: use letters, digits, - and _ only.`); continue; }
      if (v === null) delete m.styles.colors[name];
      else if (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v)) m.styles.colors[name] = v;
      else warnings.push(`Colour "${name}" was skipped: give a #hex value.`);
    }
    for (const [name, v] of Object.entries(ts)){
      if (!STYLE_NAME.test(name)){ warnings.push(`Style name "${name}" was skipped: use letters, digits, - and _ only.`); continue; }
      if (v === null){ delete m.styles.text[name]; continue; }
      if (!v || typeof v !== 'object'){ warnings.push(`Style "${name}" was skipped: give an object.`); continue; }
      const st = {};
      if (typeof v.font === 'string'){ if (claudeFontKey(v.font)) st.font = v.font; else warnings.push(`Style "${name}": unknown font "${v.font}".`); }
      if (Number(v.size) > 0) st.size = clamp(Number(v.size), 8, 600);
      if (Number(v.weight) >= 100 && Number(v.weight) <= 900) st.weight = Math.round(Number(v.weight) / 100) * 100;
      if (v.italic !== undefined) st.italic = !!v.italic;
      if (v.bold !== undefined) st.bold = !!v.bold;
      if (['left', 'center', 'right'].includes(v.align)) st.align = v.align;
      if (Number(v.lineHeight) > 0) st.lineHeight = clamp(Number(v.lineHeight), 0.5, 2.5);
      if (v.letterSpacing !== undefined && Number.isFinite(Number(v.letterSpacing))) st.letterSpacing = clamp(Number(v.letterSpacing), -7, 15);
      if (typeof v.color === 'string'){
        if (v.color[0] === '$' ? !!m.styles.colors[v.color.slice(1)] : (claudeColor(v.color, STROKE_KEYS, null) !== null)) st.color = v.color;
        else warnings.push(`Style "${name}": unknown colour "${v.color}".`);
      }
      m.styles.text[name] = st;
    }
    stylesReapply();
    const styled = [];
    for (const p of state.pages) for (const el of p.elements) if (el.tstyle && !el.master) styled.push(el);
    if (m.master) for (const el of m.master.elements) styled.push(el);
    await claudeSettleText(styled);
    if (m.master) m.master.rev++;
    for (const p of state.pages) updateBoundArrows(p.elements);
    preloadDocFonts();
    commit(); requestRender(); syncPanel();
    docTrack();
    const out = { ok: true, documentId: m.id, documentVersion: m.clock, styles: { text: m.styles.text, colors: m.styles.colors } };
    if (warnings.length) out.warnings = warnings;
    return out;
  }
  if (action === 'set_master'){
    const t = await claudeTarget(args, false);
    if (t.error) return t;
    if (editing) commitTextEdit();
    const m = state.meta, warnings = [];
    const specs = Array.isArray(args.elements) ? args.elements : [];
    const rev = (m.master ? m.master.rev : 0) + 1;
    if (!specs.length) m.master = null;
    else {
      const built = claudeBuildAll(specs.map(s => Object.assign({}, s, { from: undefined, to: undefined })), new Map(), warnings);
      for (const el of built){ el.startBind = null; el.endBind = null; }
      await claudeSettleText(built);
      const skip = Array.isArray(args.skipPageIds) ? args.skipPageIds.map(String).filter(id => state.pages.some(p => p.id === id)) : [];
      m.master = { rev, front: args.front !== false, skip, elements: built };
    }
    masterSig = null;
    preloadDocFonts();
    commit(); requestRender(); syncPanel();
    docTrack();
    const out = { ok: true, documentId: m.id, documentVersion: m.clock,
      master: m.master ? { front: m.master.front, skipPageIds: m.master.skip, elements: m.master.elements.map(claudeCompact),
        onPages: state.pages.length - m.master.skip.length } : null };
    if (warnings.length) out.warnings = warnings;
    return out;
  }

  /* ── comments ── */
  if (action === 'list_comments'){
    const t = await claudeTarget(args, false);
    if (t.error) return t;
    const all = state.meta.comments;
    const list = all.filter(c => args.includeResolved === true || !c.resolved).map(commentPublic);
    return { documentId: state.meta.id, open: all.filter(c => !c.resolved).length,
      resolved: all.filter(c => c.resolved).length, comments: list };
  }
  if (action === 'reply_comment'){
    if (args.documentId != null){ const t = await claudeTarget({ documentId: args.documentId }, false); if (t.error) return t; }
    const c = state.meta.comments.find(x => x.id === String(args.id));
    if (!c) return { error: `No comment with id "${args.id}" in document "${state.meta.name}". Call koralpaper_list_comments to see them.` };
    const text = typeof args.text === 'string' ? args.text.trim() : '';
    if (!text && args.resolve === undefined) return { error: 'Give a reply in text, or resolve:true to mark the comment resolved.' };
    if (text) c.replies.push({ id: 'r_' + uid(), text: text.slice(0, 4000), author: 'claude', at: new Date().toISOString() });
    if (args.resolve !== undefined) c.resolved = args.resolve === true;
    commentChanged();
    return { ok: true, comment: commentPublic(c) };
  }

  /* ── snapshots ── */
  if (action === 'snapshot'){
    const t = await claudeTarget(args, false);
    if (t.error) return t;
    if (editing) commitTextEdit();
    docTrack();
    const mine = (await libAll('snaps')).filter(s => s.docId === state.meta.id).sort((a, b) => a.at < b.at ? -1 : 1);
    const name = (typeof args.name === 'string' && args.name.trim() ? args.name.trim() : 'Snapshot ' + (mine.length + 1)).slice(0, 80);
    const rec = { id: 'snap_' + uid(), docId: state.meta.id, docName: state.meta.name, name,
      at: new Date().toISOString(), pages: state.pages.length, version: state.meta.clock,
      payload: JSON.stringify(docPayload()) };
    await libPut('snaps', rec);
    const SNAP_KEEP = 20;                         // per document; the oldest make room
    let dropped = 0;
    while (mine.length + 1 - dropped > SNAP_KEEP){ await libDel('snaps', mine[dropped].id); dropped++; }
    showHint('Claude saved a snapshot: “' + name + '”');
    return { ok: true, snapshotId: rec.id, documentId: rec.docId, name, at: rec.at, pages: rec.pages, documentVersion: rec.version };
  }
  if (action === 'restore'){
    const rec = await libGet('snaps', String(args.snapshotId));
    if (!rec) return { error: `No snapshot with id "${args.snapshotId}". Call koralpaper_list_documents to see each document's snapshots.` };
    let data;
    try { data = JSON.parse(rec.payload); } catch (e){ return { error: 'That snapshot cannot be read.' }; }
    if (rec.docId !== state.meta.id){
      const ok = await docOpen(rec.docId);
      if (!ok){               // its document was deleted: the snapshot brings it back under its own id
        await librarySaveCurrent(false);
        state.meta = newMeta(rec.docName);
        state.meta.id = rec.docId;
      }
    }
    if (editing) commitTextEdit();
    docTrack();
    const cur = state.meta, keep = docPayload();
    if (!applyDocData(data) || !docUsable()){ applyDocData(keep); state.meta = cur; docActivate(); return { error: 'That snapshot cannot be used.' }; }
    // versions keep counting forward: a restore is one more change, not a rewind of the clock
    const m = state.meta;
    m.id = cur.id; m.name = cur.name; m.clock = cur.clock; m.pv = cur.pv; m.ev = cur.ev; m.gone = cur.gone; m.starter = null;
    state.selection = new Set();
    masterSig = null;
    document.body.classList.toggle('dark', state.theme === 'dark');
    paintSwatches(); syncToggles(); syncPaperUI(); syncBoardBtn(); buildBoardMenuSel();
    updateBoundArrows(state.elements);
    preloadDocFonts();
    commit();
    buildPageStrip(); syncPanel(); zoomToFit(); requestRender(); flushAutosave();
    docTrack();
    showHint('Claude restored the snapshot “' + rec.name + '”: ⌘Z brings the pages back');
    return { ok: true, restored: rec.name, documentId: m.id, documentVersion: m.clock,
      pages: state.pages.map(p => ({ id: p.id, name: p.name, version: pageVersion(p), elements: ownEls(p).length })) };
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
