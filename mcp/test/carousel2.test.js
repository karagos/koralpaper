/* Second carousel round: what a real 10-slide build turned up.
   A. the image section of the sidebar, the safe area, refused types and
      properties, exact corner radius, lines that read back with their ends;
   B. image elements from a file, and the page tools.
   Real server + real app, as in the other suites.
   Run from the repo root:   node --test mcp/test/*.test.js

   © 2026 Stefanos Karagos, CAIO Group · wearecaio.com · MIT */
'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('./harness');

const BOARD = { w: 1080, h: 1350 };
const ok = r => { assert.equal(r.isError, false, 'tool reported an error: ' + r.text); return r.json; };
const refused = (r, re) => { assert.equal(r.isError, true, 'this call should have been refused: ' + r.text.slice(0, 200)); if (re) assert.match(r.text, re); return r.text; };
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const J = v => JSON.stringify(v);

let k, pics;
const read = async (documentId, pageId) => ok(await k.tool('koralpaper_read_document', { documentId, pageId }));
/* the colour the app paints at each point of a page, at artboard size */
const pixels = async (pageId, pts) => JSON.parse(await k.page(`
  const p = state.pages.find(x => x.id === ${J(pageId)});
  const r = await claudeRenderPage(p, { format: 'png', scale: 1 });
  const bytes = Uint8Array.from(atob(r.data), c => c.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
  return JSON.stringify(${J(pts)}.map(([x, y]) => [...g.getImageData(x, y, 1, 1).data].slice(0, 3)));`));
const isRed = c => c[0] > 180 && c[1] < 90 && c[2] < 90;
const isBlue = c => c[2] > 180 && c[0] < 90 && c[1] < 90;
const isWhite = c => c[0] > 245 && c[1] > 245 && c[2] > 245;
const isColour = (c, rgb) => c.every((v, i) => Math.abs(v - rgb[i]) <= 6);
/* which sections of the sidebar are showing, and whether each is folded */
const panel = async () => JSON.parse(await k.page(`
  const vis = n => !!(n && n.offsetParent !== null && n.getBoundingClientRect().height > 0);
  return JSON.stringify({
    hidden: $('stylePanel').classList.contains('hidden'),
    rows: [...document.querySelectorAll('#stylePanel .row')].filter(r => !r.classList.contains('hidden')).map(r => r.id),
    folded: [...document.querySelectorAll('#stylePanel .row.foldedrow')].map(r => r.id),
    label: $('rowArt').querySelector('label').textContent.trim(),
    info: $('imgInfo').textContent,
    controls: { crop: vis($('cropBtn')), uncrop: vis($('cropResetBtn')), fit: vis($('imgFitSeg')), styles: vis($('artSeg')),
      detail: vis($('artDetailSeg')), bright: vis($('adjBright')), alt: vis($('imgAlt')), corners: vis($('imgRadiusRange')), frame: vis($('frameOn')) },
    fit: ($('imgFitSeg').querySelector('.sel') || {}).dataset ? $('imgFitSeg').querySelector('.sel').dataset.fit : null,
  });`));
const select = id => k.page(`setTool('select'); setSelection(new Set([${J(id)}])); syncPanel();`);

before(async () => {
  k = await start();
  await k.page(`const b = document.getElementById('welcomeStart'); if (b) b.click();`);
  /* test pictures, written as real files: left half red, right half blue */
  const made = JSON.parse(await k.page(`
    const mk = (w, h, mime, q) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
      g.fillStyle = '#FF0000'; g.fillRect(0, 0, w / 2, h); g.fillStyle = '#0000FF'; g.fillRect(w / 2, 0, w / 2, h);
      return c.toDataURL(mime, q).split(',')[1]; };
    return JSON.stringify({ jpg: mk(600, 400, 'image/jpeg', 0.92), png: mk(300, 200, 'image/png'), small: mk(60, 40, 'image/png') });`));
  pics = { dir: path.join(k.docsDir, 'pics') };
  fs.mkdirSync(pics.dir);
  pics.jpg = path.join(pics.dir, 'split photo.jpg'); fs.writeFileSync(pics.jpg, Buffer.from(made.jpg, 'base64'));
  pics.png = path.join(pics.dir, 'split.png'); fs.writeFileSync(pics.png, Buffer.from(made.png, 'base64'));
  pics.small = path.join(pics.dir, 'small.png'); fs.writeFileSync(pics.small, Buffer.from(made.small, 'base64'));
  pics.svg = path.join(pics.dir, 'mark.svg');
  fs.writeFileSync(pics.svg, '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60"><rect width="120" height="60" fill="#00AA00"/></svg>');
  pics.desk = path.join(k.desktopDir, 'on desktop.png'); fs.writeFileSync(pics.desk, Buffer.from(made.png, 'base64'));
  pics.fake = path.join(pics.dir, 'notes.jpg'); fs.writeFileSync(pics.fake, 'these are notes, not a picture');
  pics.outsideDir = path.join(k.tmp, 'elsewhere'); fs.mkdirSync(pics.outsideDir);
  pics.outside = path.join(pics.outsideDir, 'secret.png'); fs.writeFileSync(pics.outside, Buffer.from(made.png, 'base64'));
  pics.link = path.join(pics.dir, 'link.png'); fs.symlinkSync(pics.outside, pics.link);
});
after(async () => { if (k) await k.stop(); });

/* ───────────────────────────────────────────────────── */
describe('A1. the image section of the sidebar', () => {
  let docId, imgId;
  const drop = name => k.page(`
    const c = document.createElement('canvas'); c.width = 600; c.height = 400;
    const g = c.getContext('2d'); g.fillStyle = '#FF0000'; g.fillRect(0, 0, 300, 400); g.fillStyle = '#0000FF'; g.fillRect(300, 0, 300, 400);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    const before = new Set(state.elements.map(e => e.id));
    insertImageFiles([new File([blob], ${J(name)}, { type: 'image/jpeg' })], 400, 400);
    for (let i = 0; i < 100 && !state.elements.some(e => !before.has(e.id)); i++) await new Promise(r => setTimeout(r, 30));
    const el = state.elements.find(e => !before.has(e.id));
    for (let i = 0; i < 100 && !getImageEntry(el._src).ready; i++) await new Promise(r => setTimeout(r, 30));
    syncPanel();
    return el.id;`);

  test('a JPG dragged onto the page shows every image control when it is selected', async () => {
    docId = ok(await k.tool('koralpaper_create_document', { name: 'Image panel', board: BOARD })).documentId;
    imgId = await drop('holiday.jpg');
    const p = await panel();
    assert.equal(p.hidden, false);
    assert.ok(p.rows.includes('rowArt') && p.rows.includes('rowImgRadius') && p.rows.includes('rowFrame'), 'image rows: ' + p.rows);
    assert.deepEqual(p.folded, []);
    assert.equal(p.label, 'Image');
    for (const [name, shown] of Object.entries(p.controls)) assert.equal(shown, true, name + ' is on screen');
    assert.equal(p.info, 'holiday.jpg · 600 × 400 px · JPEG');
    assert.equal(p.fit, 'stretch');
  });

  test('a dropped image never takes the last-used outline colour or thickness', async () => {
    // the user styles a shape first, which is what "last used" remembers
    await k.page(`setSelection(new Set()); applyStyle({ stroke: '#aeb9cc', sw: 9 });`);
    const id = await drop('after styling.jpg');
    const el = JSON.parse(await k.page(`const e = state.elements.find(x => x.id === ${J(id)}); return JSON.stringify({ stroke: e.stroke, sw: e.sw, frame: !!e.frame });`));
    assert.deepEqual(el, { stroke: 'ink', sw: 3.3, frame: false });
    await k.page(`defaults.stroke = 'ink'; defaults.sw = 3.3;`);
  });

  test('read_document describes the image, not an outlined box: name, format, real size, fit, crop, no bytes', async () => {
    const doc = await read(docId);
    const im = doc.pages[0].elements.find(e => e.id === imgId);
    assert.equal(im.type, 'image');
    assert.equal(im.name, 'holiday.jpg');
    assert.equal(im.format, 'jpeg');
    assert.deepEqual([im.naturalWidth, im.naturalHeight], [600, 400]);
    assert.ok(im.bytes > 500);
    assert.equal(im.fit, 'stretch');
    assert.deepEqual([im.focalX, im.focalY, im.crop], [0.5, 0.5, null]);
    assert.equal(im.stroke, undefined, 'no outline colour on a plain picture');
    assert.equal(im.sw, undefined, 'no outline width on a plain picture');
    assert.ok(!J(doc).includes('base64'), 'the bytes never travel in a read');
  });

  test('a section folded by an old stray click is opened once, and every fold now says "Show"', async () => {
    // the state the owner was in: the image section folded, saved by a version that showed only an arrow
    await k.page(`localStorage.setItem('koralpaper.panelfold', JSON.stringify({ rowArt: true, rowFrame: true })); localStorage.removeItem('koralpaper.panelfold.v');`);
    await k.reload();
    await select(imgId);
    let p = await panel();
    assert.ok(!p.folded.includes('rowArt'), 'the image section is open again');
    assert.ok(p.folded.includes('rowFrame'), 'other folds are kept');
    assert.equal(p.controls.crop, true);
    const tag = await k.page(`return getComputedStyle($('rowFrame').querySelector('label'), '::after').content;`);
    assert.equal(tag, '"Show"', 'a folded section is labelled');
    // a fold the user makes from now on is theirs: it survives a reload
    await k.page(`$('rowArt').querySelector('label').click(); $('rowFrame').querySelector('label').click();`);
    await k.reload();
    await select(imgId);
    p = await panel();
    assert.deepEqual(p.folded, ['rowArt']);
    assert.equal(p.controls.crop, false);
    await k.page(`$('rowArt').querySelector('label').click();`);
    assert.equal((await panel()).controls.crop, true);
  });

  test('Fill, Fit and Stretch change how the picture sits in its box, in the app and in the export', async () => {
    const pageId = (await read(docId)).pages[0].id;
    await k.page(`for (const e of state.elements.slice()) if (e.id !== ${J(imgId)}) state.elements.splice(state.elements.indexOf(e), 1);
      const el = state.elements.find(e => e.id === ${J(imgId)}); el.x = 100; el.y = 100; el.w = 200; el.h = 400; commit();
      state.pages[state.pageIndex].bg = '#FFFFFF';`);
    await select(imgId);
    // Stretch: the 600 x 400 picture is squeezed into 200 x 400, red left, blue right
    let px = await pixels(pageId, [[120, 300], [280, 300]]);
    assert.ok(isRed(px[0]) && isBlue(px[1]), 'stretch: ' + J(px));
    // Fill: the middle of the picture covers the box (the red/blue split stays in the middle)
    await k.page(`$('imgFitSeg').querySelector('[data-fit="cover"]').click();`);
    assert.equal((await panel()).fit, 'cover');
    px = await pixels(pageId, [[120, 110], [280, 490]]);
    assert.ok(isRed(px[0]) && isBlue(px[1]), 'cover: ' + J(px));
    // Fit: the whole picture shows, so there is paper above and below it
    await k.page(`$('imgFitSeg').querySelector('[data-fit="contain"]').click();`);
    px = await pixels(pageId, [[200, 110], [120, 300], [280, 300], [200, 490]]);
    assert.ok(isWhite(px[0]) && isRed(px[1]) && isBlue(px[2]) && isWhite(px[3]), 'contain: ' + J(px));
    assert.equal(ok(await k.tool('koralpaper_read_document', { documentId: docId })).pages[0].elements[0].fit, 'contain');
    await k.page(`undo();`);
    assert.equal((await panel()).fit, 'cover', 'one undo per click');
  });

  test('the alt text typed in the sidebar is saved with the picture', async () => {
    await k.page(`const i = $('imgAlt'); i.value = 'A red and blue test card'; i.dispatchEvent(new Event('change'));`);
    assert.equal((await read(docId)).pages[0].elements[0].alt, 'A red and blue test card');
  });

  test('the picture kept from an SVG import opens with the same image controls', async () => {
    const r = ok(await k.tool('koralpaper_import_svg', { documentId: docId, pageName: 'From SVG',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1350"><path d="M100 100 L400 100 L250 400 Z" fill="#E4572E"/></svg>' }));
    const im = r.elements.find(e => e.type === 'image');
    assert.ok(im, 'the path stayed as one picture');
    assert.equal(im.format, 'svg');
    assert.equal(im.stroke, undefined);
    await select(im.id);
    const p = await panel();
    assert.ok(p.rows.includes('rowArt'));
    assert.equal(p.controls.crop, true);
    assert.equal(p.controls.fit, true);
  });
});

/* ───────────────────────────────────────────────────── */
describe('A2. the safe area is kept, shown and checked', () => {
  let docId, pageId, ids;
  test('create_document confirms it, and it is still there after pages are created with a plain board', async () => {
    const c = ok(await k.tool('koralpaper_create_document', { name: 'Safe', board: { w: 1080, h: 1350, safeArea: 80 } }));
    docId = c.documentId;
    assert.equal(c.board.safeArea, 80);
    // exactly what a carousel build sends next: the board again, without the safe area
    const made = ok(await k.tool('koralpaper_create_page', { documentId: docId, name: 'One', board: { w: 1080, h: 1350 }, paper: '#FFFFFF', elements: [
      { id: 'edge', type: 'text', x: 1021, y: 300, text: 'Edge', size: 30 },
      { id: 'inside', type: 'text', x: 120, y: 300, text: 'Inside', size: 30 },
      { id: 'card', type: 'rect', x: 40, y: 500, w: 300, h: 200, sketch: 0 },
      { id: 'okcard', type: 'rect', x: 400, y: 500, w: 300, h: 200, sketch: 0 },
      { id: 'pic', type: 'image', x: 700, y: 900, w: 360, h: 240, src: { path: pics.png } },
      { id: 'rule', type: 'line', x: 80, y: 1300, x2: 1000, y2: 1300, sketch: 0 },
    ] }));
    pageId = made.pageId; ids = made.ids;
    assert.equal((await read(docId)).board.safeArea, 80);
    assert.equal(ok(await k.tool('koralpaper_open_document', { id: docId })).board.safeArea, 80);
    assert.equal(ok(await k.tool('koralpaper_list_documents', {})).documents.find(d => d.id === docId).board.safeArea, 80);
  });

  test('the editor draws the dashed guide on every page', async () => {
    ok(await k.tool('koralpaper_create_page', { documentId: docId, name: 'Two', elements: [{ type: 'text', x: 100, y: 100, text: 'Second' }] }));
    for (const idx of [0, 1]){
      const drawn = JSON.parse(await k.page(`
        switchPage(${idx});
        const calls = [];
        const fake = new Proxy({}, { get: (t, p) => p === 'strokeRect' ? (...a) => calls.push(a) : (typeof p === 'string' ? (() => {}) : undefined), set: () => true });
        drawBridgeOverlay(fake, 1);
        return JSON.stringify(calls);`));
      assert.deepEqual(drawn, [[80, 80, 920, 1190]], 'page ' + (idx + 1));
    }
  });

  test('measure flags every kind of element that leaves it: text, shape, image and line', async () => {
    const r = ok(await k.tool('koralpaper_measure', { documentId: docId, pageId, elementIds: [ids.edge, ids.inside, ids.card, ids.okcard, ids.pic, ids.rule] }));
    const m = Object.fromEntries(r.elements.map(e => [e.id, e]));
    // the text at x = 1021 on a 1080 board, which used to pass
    assert.equal(m[ids.edge].outsideSafeArea, true);
    assert.equal(m[ids.edge].fits, false);
    assert.ok(m[ids.edge].safeAreaExcess.right > 20);
    assert.match(m[ids.edge].reasons.join(' '), /leaves the 80px safe area/);
    assert.equal(m[ids.inside].outsideSafeArea, false);
    assert.equal(m[ids.inside].fits, true);
    assert.equal(m[ids.card].outsideSafeArea, true);
    assert.deepEqual(m[ids.card].safeAreaExcess, { left: 40 });
    assert.equal(m[ids.card].outsideArtboard, false);
    assert.equal(m[ids.okcard].fits, true);
    assert.equal(m[ids.pic].type, 'image');
    assert.equal(m[ids.pic].outsideSafeArea, true);
    assert.deepEqual(m[ids.pic].safeAreaExcess, { right: 60 });
    assert.equal(m[ids.rule].outsideSafeArea, true);
    assert.ok(m[ids.rule].safeAreaExcess.bottom >= 30);
    assert.deepEqual(r.notFitting.sort(), [ids.edge, ids.card, ids.pic, ids.rule].sort());
    // no ids: the whole page
    const all = ok(await k.tool('koralpaper_measure', { documentId: docId, pageId }));
    assert.equal(all.elements.length, 6);
  });

  test('it survives a reload, a change of artboard size in the app, and leaving and reopening the document', async () => {
    await k.reload();
    assert.equal((await read(docId)).board.safeArea, 80);
    await k.page(`setBoard('4 : 5', 1200, 1500);`);
    const b = (await read(docId)).board;
    assert.deepEqual([b.w, b.h, b.safeArea], [1200, 1500, 80]);
    ok(await k.tool('koralpaper_set_board', { documentId: docId, w: 1080, h: 1350 }));
    const other = ok(await k.tool('koralpaper_create_document', { name: 'No safe area', board: BOARD })).documentId;
    assert.equal((await read(other)).board.safeArea, undefined, 'a new document does not inherit it');
    assert.equal((await read(docId)).board.safeArea, 80);
  });

  test('set_board adds, changes and removes it on an existing document; the app has the same field', async () => {
    assert.equal(ok(await k.tool('koralpaper_set_board', { documentId: docId, safeArea: 64 })).board.safeArea, 64);
    assert.equal((await read(docId)).board.safeArea, 64);
    assert.equal(ok(await k.tool('koralpaper_set_board', { documentId: docId, safeArea: 0 })).board.safeArea, undefined);
    assert.match(ok(await k.tool('koralpaper_measure', { documentId: docId, pageId, elementIds: [ids.inside] })).note, /no safe area/);
    // the user types it in the artboard menu
    await k.page(`const i = $('safeAreaInput'); i.value = '80'; i.dispatchEvent(new Event('change'));`);
    assert.equal((await read(docId)).board.safeArea, 80);
    refused(await k.tool('koralpaper_set_board', { documentId: docId, safeAera: 80 }), /unknown property "safeAera"/);
  });

  test('a document saved before 3.86, with the safe area inside the artboard record, keeps it', async () => {
    const got = await k.page(`
      const keep = docPayload();
      const old = JSON.parse(JSON.stringify(keep));
      old.board = { name: 'Custom', w: 1080, h: 1350, x: 0, y: 0, safe: 72 };
      delete old.meta.safe;
      applyDocData(old);
      const r = JSON.stringify({ safe: docSafe(), onBoard: state.board.safe });
      applyDocData(keep); docActivate();
      return r;`);
    assert.deepEqual(JSON.parse(got), { safe: 72 });
  });

  test('the guide is never exported', async () => {
    const withGuide = await k.page(`const r = await claudeRenderPage(state.pages[0], { format: 'png', scale: 1 }); return r.data;`);
    ok(await k.tool('koralpaper_set_board', { documentId: docId, safeArea: 0 }));
    const without = await k.page(`const r = await claudeRenderPage(state.pages[0], { format: 'png', scale: 1 }); return r.data;`);
    assert.equal(sha(withGuide), sha(without));
    ok(await k.tool('koralpaper_set_board', { documentId: docId, safeArea: 80 }));
  });
});

/* ───────────────────────────────────────────────────── */
describe('A3. unknown types and properties are refused by name', () => {
  let docId, pageId, ids, version;
  const state = async () => { const d = await read(docId); return { pages: d.pages.length, els: d.pages[0].elements.length, v: d.version }; };
  test('set up', async () => {
    docId = ok(await k.tool('koralpaper_create_document', { name: 'Strict', board: BOARD })).documentId;
    const made = ok(await k.tool('koralpaper_create_page', { documentId: docId, name: 'P', elements: [{ id: 'box', type: 'rect', x: 100, y: 100, w: 200, h: 100, text: 'Box' }] }));
    pageId = made.pageId; ids = made.ids; version = made.version;
  });
  test('an unknown type is refused, named, and nothing is drawn (it used to become a cream rectangle)', async () => {
    const before = await state();
    const msg = refused(await k.tool('koralpaper_add_elements', { documentId: docId, pageId, elements: [
      { type: 'rect', x: 400, y: 100 }, { id: 'p', type: 'picture', x: 100, y: 400, w: 300, h: 200 }] }), /nothing was written/);
    assert.match(msg, /element 2 \("p"\) has an unknown type "picture"/);
    assert.match(msg, /Types: rect, diamond, ellipse, polygon, chip, text, arrow, line, image/);
    assert.deepEqual(await state(), before);
    refused(await k.tool('koralpaper_add_elements', { documentId: docId, pageId, elements: [{ x: 1, y: 1 }] }), /element 1 has no type/);
  });
  test('an unknown property is refused and named, with the right name offered', async () => {
    const before = await state();
    const msg = refused(await k.tool('koralpaper_add_elements', { documentId: docId, pageId, elements: [{ id: 'c', type: 'rect', x: 0, y: 0, w: 10, h: 10, borderRadius: 0 }] }));
    assert.match(msg, /element 1 \("c"\) has an unknown property "borderRadius"\. Use "radius" instead\./);
    assert.match(msg, /Known properties: id, type, x, y/);
    refused(await k.tool('koralpaper_add_elements', { documentId: docId, pageId, elements: [{ type: 'text', x: 0, y: 0, text: 'x', fontSize: 30 }] }), /unknown property "fontSize"\. Use "size" instead/);
    refused(await k.tool('koralpaper_add_elements', { documentId: docId, pageId, elements: [{ type: 'text', x: 0, y: 0, text: 'x', zzz: 1 }] }), /unknown property "zzz"/);
    assert.deepEqual(await state(), before);
  });
  test('one bad element in a batch of pages stops the whole batch', async () => {
    const before = await state();
    const msg = refused(await k.tool('koralpaper_create_page', { documentId: docId, pages: [
      { name: 'fine', elements: [{ type: 'rect' }] }, { name: 'bad', elements: [{ type: 'rect' }, { type: 'hexagon' }] }] }));
    assert.match(msg, /page 2, element 2 has an unknown type "hexagon"/);
    refused(await k.tool('koralpaper_create_page', { documentId: docId, pages: [{ name: 'x', background: '#000', elements: [{ type: 'rect' }] }] }), /unknown page property "background"/);
    assert.deepEqual(await state(), before);
  });
  test('updates are held to the same rule, and a type cannot be changed', async () => {
    const before = await state();
    refused(await k.tool('koralpaper_update_elements', { documentId: docId, pageId, updates: [{ id: ids.box, colour: '#FF0000' }] }), /update 1 \("[^"]+"\) has an unknown property "colour"/);
    refused(await k.tool('koralpaper_update_elements', { documentId: docId, pageId, updates: [{ id: ids.box, type: 'ellipse' }] }), /type of an element cannot be changed \(it is "rect", you sent "ellipse"\)/);
    refused(await k.tool('koralpaper_update_elements', { documentId: docId, pageId, updates: [{ id: ids.box, fit: 'cover' }] }), /"fit" only applies to image elements, and this one is "rect"/);
    assert.deepEqual(await state(), before);
    assert.equal((await read(docId)).pages[0].version, version, 'the page version did not move');
  });
  test('the master page and properties on the wrong kind of element are refused too', async () => {
    refused(await k.tool('koralpaper_set_master', { documentId: docId, elements: [{ type: 'footer', text: 'x' }] }), /master element 1 has an unknown type "footer"/);
    assert.equal((await read(docId)).master, undefined);
    refused(await k.tool('koralpaper_add_elements', { documentId: docId, pageId, elements: [{ type: 'ellipse', x: 0, y: 0, radius: 4 }] }), /"radius" applies to rect and image elements, and this one is "ellipse"/);
    refused(await k.tool('koralpaper_add_elements', { documentId: docId, pageId, elements: [{ type: 'image', x: 0, y: 0 }] }), /is an image with no picture/);
    refused(await k.tool('koralpaper_add_elements', { documentId: docId, pageId, elements: [{ type: 'image', x: 0, y: 0, src: { path: pics.png }, text: 'caption' }] }), /"text" does not apply to an image/);
    refused(await k.tool('koralpaper_add_elements', { documentId: docId, pageId, elements: [{ type: 'image', x: 0, y: 0, src: { path: pics.png }, fit: 'fill' }] }), /"fit" must be "cover" or "contain", not "fill"/);
    refused(await k.tool('koralpaper_add_elements', { documentId: docId, pageId, elements: [{ type: 'image', x: 0, y: 0, src: { path: pics.png }, stroke: '#FF0000' }] }), /"stroke" does not apply to an image/);
  });
  test('a refused update leaves the user on the page they were looking at', async () => {
    const other = ok(await k.tool('koralpaper_create_page', { documentId: docId, name: 'Second', elements: [{ type: 'text', x: 80, y: 80, text: 'second' }] })).pageId;
    assert.equal(await k.page(`return state.pages[state.pageIndex].id;`), other);
    refused(await k.tool('koralpaper_update_elements', { documentId: docId, pageId, updates: [{ id: ids.box, wobble: 1 }] }), /unknown property "wobble"/);
    assert.equal(await k.page(`return state.pages[state.pageIndex].id;`), other, 'the view did not move');
    ok(await k.tool('koralpaper_delete_page', { documentId: docId, pageId: other }));
  });
  test('everything a correct call sends still works', async () => {
    const r = ok(await k.tool('koralpaper_add_elements', { documentId: docId, pageId, elements: [
      { id: 'a', type: 'rect', x: 400, y: 300, w: 200, h: 100, text: 'A', fill: 'cream', stroke: 'ink', fillStyle: 'solid', dash: 'solid', size: 20, bold: true, italic: false, weight: 700,
        font: 'Inter Tight', align: 'center', valign: 'middle', lineHeight: 1.2, letterSpacing: 0, locked: false, sketch: 0, sw: 2, opacity: 100, fillOpacity: 100, radius: 8, textColor: 'ink' },
      { id: 'b', type: 'polygon', x: 700, y: 300, w: 120, h: 120, sides: 5 },
      { id: 't', type: 'text', x: 400, y: 500, w: 300, wrap: true, maxHeight: 200, text: 'Wrapped' },
      { type: 'arrow', from: 'a', to: 'b', elbow: true, startHead: 'none', endHead: 'triangle' },
      { type: 'line', x: 100, y: 800, x2: 500, y2: 800 },
    ] }));
    assert.equal(r.warnings, undefined);
    assert.equal(r.elements, 6);
  });
});

/* ───────────────────────────────────────────────────── */
describe('A4. corner radius per element, whatever the brand kit says', () => {
  let docId, pageId, ids;
  const DARK = [17, 34, 51];
  test('a full-page rectangle has soft corners by default, and square ones with radius 0', async () => {
    docId = ok(await k.tool('koralpaper_create_document', { name: 'Corners', board: BOARD })).documentId;
    const made = ok(await k.tool('koralpaper_create_page', { documentId: docId, name: 'P', paper: '#FFFFFF', elements: [
      { id: 'bg', type: 'rect', x: 0, y: 0, w: 1080, h: 1350, fill: '#112233', stroke: 'none', sketch: 0 }] }));
    pageId = made.pageId; ids = made.ids;
    let px = await pixels(pageId, [[1, 1], [540, 675]]);
    assert.ok(isWhite(px[0]) && isColour(px[1], DARK), 'default corners show the paper: ' + J(px));
    assert.equal((await read(docId)).pages[0].elements[0].radius, 18, 'the default corner is reported, not hidden');
    ok(await k.tool('koralpaper_update_elements', { documentId: docId, pageId, updates: [{ id: ids.bg, radius: 0 }] }));
    px = await pixels(pageId, [[1, 1], [1078, 1], [1, 1348], [1078, 1348]]);
    for (const c of px) assert.ok(isColour(c, DARK), 'square corner: ' + J(px));
    assert.equal((await read(docId)).pages[0].elements[0].radius, 0);
  });
  test('with a brand kit that rounds corners, radius 0 still gives square corners', async () => {
    await k.page(`brand = normalizeBrand({ active: true, primary: '#E4572E', style: { round: 1, sketch: 0 } });`);
    assert.equal(await k.page(`return brandActive() && brand.style.round === 1;`), true);
    const made = ok(await k.tool('koralpaper_create_page', { documentId: docId, name: 'Branded', paper: '#FFFFFF', elements: [
      { id: 'bg', type: 'rect', x: 0, y: 0, w: 1080, h: 1350, fill: '#112233', stroke: 'none', radius: 0 },
      { id: 'soft', type: 'rect', x: 200, y: 200, w: 300, h: 200, fill: '#FF0000', stroke: 'none' },
      { id: 'pill', type: 'rect', x: 200, y: 600, w: 400, h: 100, fill: '#0000FF', stroke: 'none', radius: 999 },
    ] }));
    const px = await pixels(made.pageId, [[1, 1], [1078, 1348], [201, 201], [350, 300], [203, 603], [400, 650]]);
    assert.ok(isColour(px[0], DARK) && isColour(px[1], DARK), 'the background is square: ' + J(px));
    assert.ok(isColour(px[2], DARK) && isRed(px[3]), 'the brand kit still rounds a rect that gives no radius: ' + J(px));
    assert.ok(isColour(px[4], DARK) && isBlue(px[5]), 'radius 999 is a pill: ' + J(px));
    const els = Object.fromEntries((await read(docId, made.pageId)).pages.find(p => p.id === made.pageId).elements.map(e => [e.id, e]));
    assert.equal(els[made.ids.bg].radius, 0);
    assert.equal(els[made.ids.soft].radius, 18);
    assert.equal(els[made.ids.pill].radius, 50, 'a pill reads back as half its height');
    await k.page(`brand = null;`);
  });
  test('radius null goes back to the default, and the Corners slider in the app takes over cleanly', async () => {
    ok(await k.tool('koralpaper_update_elements', { documentId: docId, pageId, updates: [{ id: ids.bg, radius: null }] }));
    assert.equal((await read(docId, pageId)).pages[0].elements[0].radius, 18);
    ok(await k.tool('koralpaper_update_elements', { documentId: docId, pageId, updates: [{ id: ids.bg, radius: 40 }] }));
    await k.page(`switchPage(0);`);
    await select(ids.bg);
    assert.equal(await k.page(`return $('imgRadiusVal').textContent;`), '40px');
    await k.page(`const r = $('imgRadiusRange'); r.value = 10; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change'));`);
    assert.equal((await read(docId, pageId)).pages[0].elements[0].radius, 108, '10% of the short side');
  });
});

/* ───────────────────────────────────────────────────── */
describe('A5. lines and arrows read back with both ends', () => {
  test('x, y, x2, y2 instead of a width and height of 0, in read_document and get_changes', async () => {
    const docId = ok(await k.tool('koralpaper_create_document', { name: 'Lines', board: BOARD })).documentId;
    const made = ok(await k.tool('koralpaper_create_page', { documentId: docId, name: 'P', elements: [
      { id: 'a', type: 'rect', x: 100, y: 100, w: 200, h: 100 }, { id: 'b', type: 'rect', x: 600, y: 100, w: 200, h: 100 },
      { id: 'rule', type: 'line', x: 80, y: 1236, x2: 1000, y2: 1236, sketch: 0 },
      { id: 'diag', type: 'line', x: 900, y: 400, x2: 300, y2: 700 },
      { id: 'link', type: 'arrow', from: 'a', to: 'b' },
    ] }));
    const els = Object.fromEntries((await read(docId)).pages[0].elements.map(e => [e.id, e]));
    const rule = els[made.ids.rule];
    assert.deepEqual([rule.x, rule.y, rule.x2, rule.y2], [80, 1236, 1000, 1236]);
    assert.equal(rule.w, undefined); assert.equal(rule.h, undefined);
    const diag = els[made.ids.diag];
    assert.deepEqual([diag.x, diag.y, diag.x2, diag.y2], [900, 400, 300, 700]);
    const link = els[made.ids.link];
    assert.equal(link.from, made.ids.a); assert.equal(link.to, made.ids.b);
    assert.ok(link.x >= 290 && link.x <= 310 && link.x2 >= 590 && link.x2 <= 610, 'a glued arrow reports where it really runs: ' + J(link));
    const ch = ok(await k.tool('koralpaper_get_changes', { documentId: docId, sinceVersion: 0 }));
    const cr = ch.added.find(e => e.id === made.ids.rule);
    assert.deepEqual([cr.x, cr.y, cr.x2, cr.y2], [80, 1236, 1000, 1236]);
    // moving the end with an update reads back at the new place
    ok(await k.tool('koralpaper_measure', { documentId: docId, elementIds: [made.ids.rule] }));
    assert.equal(els[made.ids.a].w, 200, 'shapes keep w and h');
  });
});

/* ───────────────────────────────────────────────────── */
describe('B6. image elements from a file', () => {
  let docId, pageId, ids;
  const stored = id => k.page(`const e = state.pages.flatMap(p => p.elements).find(x => x.id === ${J(id)}); return state.images[e.imgId];`);
  test('an image element is a real picture, embedded with the file\'s own bytes', async () => {
    docId = ok(await k.tool('koralpaper_create_document', { name: 'Pictures', board: { w: 1080, h: 1350, safeArea: 80 } })).documentId;
    const made = ok(await k.tool('koralpaper_create_page', { documentId: docId, name: 'Photos', paper: '#FFFFFF', elements: [
      { id: 'hero', type: 'image', x: 80, y: 80, w: 400, h: 400, src: { path: pics.jpg }, alt: 'Red and blue halves', radius: 0 },
      { id: 'title', type: 'text', x: 80, y: 520, text: 'Under the picture', size: 40 },
    ] }));
    pageId = made.pageId; ids = made.ids;
    const im = (await read(docId)).pages[0].elements.find(e => e.id === ids.hero);
    assert.equal(im.type, 'image', 'not a rectangle');
    assert.equal(im.name, 'split photo.jpg');
    assert.equal(im.format, 'jpeg');
    assert.deepEqual([im.x, im.y, im.w, im.h], [80, 80, 400, 400]);
    assert.deepEqual([im.naturalWidth, im.naturalHeight], [600, 400]);
    assert.equal(im.bytes, fs.statSync(pics.jpg).size);
    assert.deepEqual([im.fit, im.focalX, im.focalY, im.crop], ['cover', 0.5, 0.5, null]);
    assert.equal(im.alt, 'Red and blue halves');
    assert.equal(im.radius, 0);
    assert.equal(im.stroke, undefined); assert.equal(im.sw, undefined);
    // the JPEG was copied in, never compressed again
    const data = await stored(ids.hero);
    assert.ok(data.startsWith('data:image/jpeg;base64,'));
    assert.equal(sha(Buffer.from(data.split(',')[1], 'base64')), sha(fs.readFileSync(pics.jpg)));
    // and it is painted: cover keeps the middle, so red on the left and blue on the right
    const px = await pixels(pageId, [[100, 280], [460, 280], [600, 280]]);
    assert.ok(isRed(px[0]) && isBlue(px[1]) && isWhite(px[2]), J(px));
  });

  test('selecting it in the app shows the image controls with its name and size', async () => {
    await select(ids.hero);
    const p = await panel();
    assert.equal(p.info, 'split photo.jpg · 600 × 400 px · JPEG');
    assert.equal(p.fit, 'cover');
    assert.equal(p.controls.crop, true);
  });

  test('the focal point chooses what a cover shows; contain shows everything', async () => {
    const up = u => k.tool('koralpaper_update_elements', { documentId: docId, pageId, updates: [Object.assign({ id: ids.hero }, u)] });
    // the 400px box shows 400 of the picture's 600px; the red/blue split is at 300
    ok(await up({ focalX: 0 }));
    let px = await pixels(pageId, [[100, 280], [360, 280], [460, 280]]);
    assert.ok(isRed(px[0]) && isRed(px[1]) && isBlue(px[2]), 'focalX 0 keeps the left of the picture: ' + J(px));
    ok(await up({ focalX: 1 }));
    px = await pixels(pageId, [[100, 280], [200, 280], [460, 280]]);
    assert.ok(isRed(px[0]) && isBlue(px[1]) && isBlue(px[2]), 'focalX 1 keeps the right: ' + J(px));
    ok(await up({ fit: 'contain', focalX: 0.5, focalY: 0 }));
    px = await pixels(pageId, [[100, 100], [460, 100], [280, 460]]);
    assert.ok(isRed(px[0]) && isBlue(px[1]) && isWhite(px[2]), 'contain at the top of its box: ' + J(px));
    const im = (await read(docId)).pages[0].elements.find(e => e.id === ids.hero);
    assert.deepEqual([im.fit, im.focalX, im.focalY], ['contain', 0.5, 0]);
    ok(await up({ fit: 'cover', focalY: 0.5 }));
  });

  test('size rules: one side follows the picture, no size means its own size, and never larger than the artboard', async () => {
    const made = ok(await k.tool('koralpaper_add_elements', { documentId: docId, pageId, elements: [
      { id: 'w', type: 'image', x: 80, y: 700, w: 300, src: { path: pics.jpg } },
      { id: 'h', type: 'image', x: 500, y: 700, h: 100, src: { path: 'pics/split.png' } },
      { id: 'own', type: 'image', x: 80, y: 1000, src: { path: pics.small }, opacity: 60, radius: 999 },
      { id: 'desk', type: 'image', x: 700, y: 1000, w: 120, src: { path: pics.desk } },
      { id: 'mark', type: 'image', x: 900, y: 1000, w: 120, src: { path: pics.svg } },
    ] }));
    Object.assign(ids, made.ids);
    const els = Object.fromEntries((await read(docId)).pages[0].elements.map(e => [e.id, e]));
    assert.deepEqual([els[ids.w].w, els[ids.w].h], [300, 200]);
    assert.deepEqual([els[ids.h].w, els[ids.h].h], [150, 100], 'a path relative to Documents works');
    assert.deepEqual([els[ids.own].w, els[ids.own].h, els[ids.own].opacity, els[ids.own].radius], [60, 40, 60, 20]);
    assert.equal(els[ids.desk].name, 'on desktop.png', 'the Desktop is allowed too');
    assert.equal(els[ids.mark].format, 'svg');
    assert.deepEqual([els[ids.mark].w, els[ids.mark].h], [120, 60]);
  });

  test('files outside Documents and Desktop, links that lead out, and files that are not pictures are refused', async () => {
    const before = (await read(docId)).pages[0].elements.length;
    const add = src => k.tool('koralpaper_add_elements', { documentId: docId, pageId, elements: [{ id: 'x', type: 'image', x: 0, y: 0, src }] });
    refused(await add({ path: pics.outside }), /pictures can only be read from inside/);
    refused(await add({ path: '/etc/hosts' }), /pictures can only be read from inside/);
    refused(await add({ path: '../elsewhere/secret.png' }), /pictures can only be read from inside/);
    refused(await add({ path: path.join(os.homedir(), '.ssh', 'id_rsa') }), /pictures can only be read from inside/);
    refused(await add({ path: pics.link }), /pictures can only be read from inside/);
    refused(await add({ path: pics.fake }), /"notes\.jpg" is not a JPEG, PNG, GIF, WebP or SVG picture/);
    refused(await add({ path: path.join(pics.dir, 'missing.jpg') }), /no file at/);
    refused(await add({ path: pics.dir }), /is a folder/);
    refused(await add({ path: 'https://example.com/a.jpg' }), /is a web address/);
    refused(await add({ url: 'https://example.com/a.jpg' }), /src takes only a path/);
    refused(await add({ path: pics.png, data: 'data:image/png;base64,AAAA' }), /src takes only a path.*"data" is not accepted/);
    refused(await add('pics/split.png'), /src must be an object/);
    assert.equal((await read(docId)).pages[0].elements.length, before, 'nothing was added by any refused call');
  });

  test('an update can swap the picture and set alt, radius and opacity; get_changes reports images without bytes', async () => {
    const v = (await read(docId)).version;
    ok(await k.tool('koralpaper_update_elements', { documentId: docId, pageId, updates: [
      { id: ids.hero, src: { path: pics.png }, alt: 'Swapped', radius: 24, opacity: 80 }] }));
    const ch = ok(await k.tool('koralpaper_get_changes', { documentId: docId, sinceVersion: v }));
    const im = ch.changed.find(e => e.id === ids.hero);
    assert.equal(im.name, 'split.png'); assert.equal(im.format, 'png');
    assert.deepEqual([im.naturalWidth, im.naturalHeight, im.alt, im.radius, im.opacity], [300, 200, 'Swapped', 24, 80]);
    assert.ok(!J(ch).includes('base64'));
    assert.equal(sha(Buffer.from((await stored(ids.hero)).split(',')[1], 'base64')), sha(fs.readFileSync(pics.png)));
    ok(await k.tool('koralpaper_update_elements', { documentId: docId, pageId, updates: [{ id: ids.hero, src: { path: pics.jpg }, alt: '', opacity: 100 }] }));
    assert.equal((await read(docId)).pages[0].elements.find(e => e.id === ids.hero).alt, undefined);
  });

  test('measure checks a picture against the safe area and says when it is enlarged too far', async () => {
    const r = ok(await k.tool('koralpaper_measure', { documentId: docId, pageId, elementIds: [ids.hero, ids.own] })).elements;
    assert.equal(r[0].fits, true);
    assert.deepEqual([r[0].image.naturalWidth, r[0].image.fit], [600, 'cover']);
    assert.equal(r[0].image.scale, 1, 'a 400px box shows 400 of the picture\'s 600px at full size');
    ok(await k.tool('koralpaper_update_elements', { documentId: docId, pageId, updates: [{ id: ids.own, w: 300, h: 200 }] }));
    const big = ok(await k.tool('koralpaper_measure', { documentId: docId, pageId, elementIds: [ids.own] })).elements[0];
    assert.equal(big.image.scale, 5);
    assert.match(big.note, /500% of its real size/);
    assert.equal(big.outsideSafeArea, false);
  });

  test('pictures survive a reload, leaving and reopening the document, and a snapshot', async () => {
    const want = sha(fs.readFileSync(pics.jpg));
    const snap = ok(await k.tool('koralpaper_snapshot', { documentId: docId, name: 'with pictures' })).snapshotId;
    await k.reload();
    assert.equal(sha(Buffer.from((await stored(ids.hero)).split(',')[1], 'base64')), want);
    ok(await k.tool('koralpaper_create_document', { name: 'Somewhere else', board: BOARD }));
    const back = await read(docId);
    assert.equal(back.pages[0].elements.find(e => e.id === ids.hero).name, 'split photo.jpg');
    assert.equal(sha(Buffer.from((await stored(ids.hero)).split(',')[1], 'base64')), want);
    ok(await k.tool('koralpaper_delete_elements', { documentId: docId, pageId, ids: [ids.hero] }));
    ok(await k.tool('koralpaper_restore', { snapshotId: snap }));
    const again = await read(docId);
    const hero = again.pages[0].elements.find(e => e.name === 'split photo.jpg' && e.w === 400);
    assert.ok(hero, 'the snapshot brought the picture back');
    const px = await pixels(again.pages[0].id, [[100, 280], [460, 280]]);
    assert.ok(isRed(px[0]) && isBlue(px[1]), 'and it is painted: ' + J(px));
  });

  test('a carousel of full-size photos still autosaves, and every photo comes back after a reload', async () => {
    // about 7 MB of photos: more than a browser's whole local storage, which used to switch autosave off
    const noise = Buffer.from(await k.page(`const c = document.createElement('canvas'); c.width = 1600; c.height = 1100; const g = c.getContext('2d');
      const d = g.createImageData(1600, 1100); for (let i = 0; i < d.data.length; i++) d.data[i] = (i % 4 === 3) ? 255 : Math.random() * 255; g.putImageData(d, 0, 0);
      return c.toDataURL('image/jpeg', 0.9).split(',')[1];`), 'base64');
    assert.ok(noise.length > 1200000, 'the test photo is big: ' + noise.length);
    const d = ok(await k.tool('koralpaper_create_document', { name: 'Photo carousel', board: BOARD })).documentId;
    const files = [];
    for (let n = 0; n < 5; n++){
      const b = Buffer.concat([noise, Buffer.from([n])]);                // five different files
      files.push(path.join(pics.dir, 'photo-' + n + '.jpg'));
      fs.writeFileSync(files[n], b);
    }
    const made = ok(await k.tool('koralpaper_create_page', { documentId: d, pages: files.map((f, n) => ({ name: 'Slide ' + (n + 1),
      elements: [{ id: 'ph', type: 'image', x: 0, y: 0, w: 1080, h: 720, src: { path: f } }] })) })).pages;
    await k.page(`for (let i = 0; i < 200 && (autosavePending || pixWriting.size); i++) await new Promise(r => setTimeout(r, 50)); flushAutosave();`);
    const saved = JSON.parse(await k.page(`const raw = localStorage.getItem('asterisk.sketch.v1'); const p = JSON.parse(raw);
      return JSON.stringify({ warn: !$('storageWarn').classList.contains('hidden'), chars: raw.length, named: (p.imageRefs || []).length, inside: Object.keys(p.images).length });`));
    assert.equal(saved.warn, false, 'autosave stayed on');
    assert.deepEqual([saved.named, saved.inside], [5, 0], 'the autosave names the photos instead of carrying them');
    assert.ok(saved.chars < 100000, 'and stays small: ' + saved.chars);
    await k.reload();
    const doc = await read(d);
    for (let n = 0; n < 5; n++){
      const im = doc.pages[n].elements[0];
      assert.equal(im.bytes, fs.statSync(files[n]).size, 'slide ' + (n + 1));
      assert.equal(im.naturalWidth, 1600);
      assert.equal(sha(Buffer.from((await stored(made[n].ids.ph)).split(',')[1], 'base64')), sha(fs.readFileSync(files[n])), 'slide ' + (n + 1) + ' has its own bytes back');
    }
    // the library copy and a saved file still carry the photos whole
    ok(await k.tool('koralpaper_create_document', { name: 'Away', board: BOARD }));
    assert.equal((await read(d)).pages[4].elements[0].bytes, fs.statSync(files[4]).size);
    ok(await k.tool('koralpaper_create_document', { name: 'Small again', board: BOARD }));
  });

  test('a photo the picture database cannot give back is taken from the library copy; one found nowhere is never papered over', async () => {
    const file = path.join(pics.dir, 'photo-1.jpg'), want = sha(fs.readFileSync(file));
    const d = ok(await k.tool('koralpaper_create_document', { name: 'Lost and found', board: BOARD })).documentId;
    const id = ok(await k.tool('koralpaper_create_page', { documentId: d, name: 'P', elements: [{ id: 'ph', type: 'image', x: 0, y: 0, w: 1080, h: 720, src: { path: file } }] })).ids.ph;
    const settle = `for (let i = 0; i < 200 && (autosavePending || pixWriting.size); i++) await new Promise(r => setTimeout(r, 50)); flushAutosave();`;
    await k.page(settle + ` await librarySaveCurrent(true);`);
    // the database loses the picture (a cleared store, a failed read): the library copy still has it
    await k.page(`await pixRun('readwrite', st => { st.clear(); });`);
    await k.reload();
    assert.equal((await read(d)).pages[0].elements[0].bytes, fs.statSync(file).size);
    assert.equal(sha(Buffer.from((await stored(id)).split(',')[1], 'base64')), want, 'the bytes came back from the library copy');
    // now it is gone from both: the document says so, keeps naming it, and leaves the library copy alone
    await k.page(settle + ` await pixRun('readwrite', st => { st.clear(); });
      const rec = await libGet('docs', state.meta.id); const pay = JSON.parse(rec.payload); pay.images = {}; rec.payload = JSON.stringify(pay); rec.marker = 'older copy'; await libPut('docs', rec);`);
    await k.reload();
    const im = (await read(d)).pages[0].elements[0];
    assert.equal(im.missing, true);
    const after = JSON.parse(await k.page(`state.elements[0].x = 10; commit(); flushAutosave();
      const filed = await librarySaveCurrent(true);
      const rec = await libGet('docs', state.meta.id);
      return JSON.stringify({ filed, marker: rec.marker, named: JSON.parse(localStorage.getItem('asterisk.sketch.v1')).imageRefs });`));
    assert.equal(after.filed, false, 'the library copy is not written over while a picture is missing');
    assert.equal(after.marker, 'older copy');
    assert.equal(after.named.length, 1, 'the autosave still names the picture, so a later reload can find it');
    ok(await k.tool('koralpaper_create_document', { name: 'Small, again', board: BOARD }));
  });

  test('a picture on the master page shows on every page, and is exported', async () => {
    const d = ok(await k.tool('koralpaper_create_document', { name: 'Master picture', board: BOARD })).documentId;
    const pages = ok(await k.tool('koralpaper_create_page', { documentId: d, pages: [
      { name: 'One', paper: '#FFFFFF', elements: [{ type: 'text', x: 80, y: 80, text: 'One' }] },
      { name: 'Two', paper: '#FFFFFF', elements: [{ type: 'text', x: 80, y: 80, text: 'Two' }] }] })).pages;
    const ms = ok(await k.tool('koralpaper_set_master', { documentId: d, elements: [{ type: 'image', x: 900, y: 1200, w: 120, h: 80, src: { path: pics.png }, alt: 'Logo' }] }));
    assert.equal(ms.master.elements[0].type, 'image');
    assert.equal(ms.master.elements[0].name, 'split.png');
    for (const p of pages){
      const px = await pixels(p.pageId, [[910, 1240], [1010, 1240]]);
      assert.ok(isRed(px[0]) && isBlue(px[1]), p.name + ': ' + J(px));
    }
    await k.reload();
    const px = await pixels(pages[1].pageId, [[910, 1240], [1010, 1240]]);
    assert.ok(isRed(px[0]) && isBlue(px[1]), 'after a reload: ' + J(px));
    const ex = ok(await k.tool('koralpaper_export', { documentId: d, format: 'png', folder: 'out', filenamePrefix: 'm' }));
    assert.equal(ex.files.length, 2);
    assert.ok(fs.statSync(ex.paths[0]).size > 1000);
  });
  test('a big picture on the master page is stored once, never inside the document record', async () => {
    const d = ok(await k.tool('koralpaper_create_document', { name: 'Master photo', board: BOARD })).documentId;
    ok(await k.tool('koralpaper_create_page', { documentId: d, name: 'One', paper: '#FFFFFF', elements: [{ type: 'text', x: 80, y: 80, text: 'One' }] }));
    ok(await k.tool('koralpaper_set_master', { documentId: d, front: false, elements: [{ type: 'image', x: 0, y: 0, w: 1080, h: 1350, src: { path: path.join(pics.dir, 'photo-0.jpg') } }] }));
    await k.page(`for (let i = 0; i < 200 && (autosavePending || pixWriting.size); i++) await new Promise(r => setTimeout(r, 50)); flushAutosave();`);
    const saved = JSON.parse(await k.page(`const raw = localStorage.getItem('asterisk.sketch.v1'); const p = JSON.parse(raw);
      const lib = await libGet('docs', state.meta.id);
      return JSON.stringify({ warn: !$('storageWarn').classList.contains('hidden'), chars: raw.length, named: (p.imageRefs || []).length,
        metaChars: JSON.stringify(p.meta).length, libMetaChars: lib ? JSON.stringify(JSON.parse(lib.payload).meta).length : -1 });`));
    assert.equal(saved.warn, false);
    assert.equal(saved.named, 1);
    assert.ok(saved.chars < 100000 && saved.metaChars < 20000, 'the autosave does not carry the pixels: ' + J(saved));
    await k.reload();
    const doc = await read(d);
    assert.equal(doc.master.elements[0].bytes, fs.statSync(path.join(pics.dir, 'photo-0.jpg')).size);
    assert.equal(await k.page(`const m = state.pages[0].elements.find(e => e.master); return !!(m && m._src && m._src.length > 1000000);`), true, 'the master picture is painted again after a reload');
    ok(await k.tool('koralpaper_create_document', { name: 'Small once more', board: BOARD }));
  });
});

/* ───────────────────────────────────────────────────── */
describe('B7. page tools', () => {
  let docId, p;
  const names = async () => (await read(docId)).pages.map(x => x.name);
  const footer = async pageId => (await k.page(`
    const pg = state.pages.find(x => x.id === ${J(pageId)});
    const m = pg.elements.find(e => e.master); return m ? m.text : '';`));
  test('set up four pages with a page-number master', async () => {
    docId = ok(await k.tool('koralpaper_create_document', { name: 'Pages', board: BOARD })).documentId;
    p = ok(await k.tool('koralpaper_create_page', { documentId: docId, pages: ['Cover', 'Myth', 'Proof', 'End'].map(n => ({ name: n, elements: [
      { id: 'h', type: 'text', x: 80, y: 80, text: n, size: 60 }, { id: 'box', type: 'rect', x: 80, y: 300, w: 300, h: 200 },
      { id: 'tag', type: 'chip', x: 500, y: 300, text: 'tag' }, { type: 'arrow', from: 'box', to: 'tag' }] })) })).pages;
    ok(await k.tool('koralpaper_set_master', { documentId: docId, elements: [{ type: 'text', x: 80, y: 1260, text: '{page} / {pages}', size: 20 }], skipPageIds: [p[0].pageId] }));
    assert.equal(await footer(p[1].pageId), '02 / 04');
  });

  test('rename_page and set_page change a page\'s name and paper, and nothing else', async () => {
    const r = ok(await k.tool('koralpaper_rename_page', { documentId: docId, pageId: p[1].pageId, name: '02 · The myth' }));
    assert.equal(r.name, '02 · The myth');
    assert.deepEqual(r.pages.map(x => x.name), ['Cover', '02 · The myth', 'Proof', 'End']);
    ok(await k.tool('koralpaper_set_styles', { documentId: docId, colors: { navy: '#0B1A33' } }));
    const s = ok(await k.tool('koralpaper_set_page', { documentId: docId, pageId: p[2].pageId, name: 'The proof', paper: '$navy' }));
    assert.equal(s.paper, '#0B1A33');
    let doc = await read(docId);
    assert.equal(doc.pages[2].paper, '#0B1A33');
    assert.equal(doc.pages[2].name, 'The proof');
    assert.equal(doc.pages[2].elements.length, 4);
    const px = await pixels(p[2].pageId, [[2, 2], [1077, 1347]]);
    assert.ok(isColour(px[0], [11, 26, 51]) && isColour(px[1], [11, 26, 51]), 'paper fills the page to its square corners: ' + J(px));
    ok(await k.tool('koralpaper_set_page', { documentId: docId, pageId: p[2].pageId, paper: null }));
    assert.equal((await read(docId)).pages[2].paper, undefined);
    refused(await k.tool('koralpaper_set_page', { documentId: docId, pageId: p[2].pageId, paper: 'dark blue' }), /is not a paper colour/);
    refused(await k.tool('koralpaper_rename_page', { documentId: docId, pageId: p[2].pageId, name: '   ' }), /name is empty/);
    refused(await k.tool('koralpaper_rename_page', { documentId: docId, pageId: 'nope', name: 'x' }), /No page with id "nope"/);
    refused(await k.tool('koralpaper_set_page', { documentId: docId, pageId: p[2].pageId, name: 'late', ifVersion: 1 }), /changed since version 1/);
    assert.deepEqual(await names(), ['Cover', '02 · The myth', 'The proof', 'End']);
  });

  test('duplicate_page copies a page with new ids, and the original is left exactly as it was', async () => {
    const before = await read(docId);
    const src = before.pages[1];
    const r = ok(await k.tool('koralpaper_duplicate_page', { documentId: docId, pageId: src.id, name: '03 · Myth two' }));
    assert.equal(r.number, 3);
    assert.deepEqual(r.pages.map(x => x.name), ['Cover', '02 · The myth', '03 · Myth two', 'The proof', 'End']);
    const doc = await read(docId);
    const copy = doc.pages[2];
    assert.equal(copy.id, r.pageId);
    assert.equal(copy.elements.length, src.elements.length);
    const srcIds = new Set(src.elements.map(e => e.id));
    for (const e of copy.elements) assert.ok(!srcIds.has(e.id), 'every copy has its own id');
    assert.deepEqual(Object.keys(r.ids).sort(), [...srcIds].sort());
    const arrow = copy.elements.find(e => e.type === 'arrow');
    assert.ok(copy.elements.some(e => e.id === arrow.from) && copy.elements.some(e => e.id === arrow.to), 'the copied arrow is glued to the copied shapes');
    // the copy can be edited straight away through the id map
    const head = src.elements.find(e => e.type === 'text');
    ok(await k.tool('koralpaper_update_elements', { documentId: docId, pageId: copy.id, ifVersion: copy.version, updates: [{ id: r.ids[head.id], text: 'Myth two' }] }));
    const after = await read(docId);
    assert.equal(after.pages[1].version, src.version, 'the original page did not change version');
    assert.equal(after.pages[1].elements.find(e => e.type === 'text').text, 'Myth');
    assert.equal(after.pages[2].elements.find(e => e.type === 'text').text, 'Myth two');
    assert.equal(await footer(after.pages[2].id), '03 / 05', 'page numbers follow');
    // a copy of the cover is a cover too, and position puts it where asked
    const c = ok(await k.tool('koralpaper_duplicate_page', { documentId: docId, pageId: p[0].pageId, position: 6 }));
    assert.equal(c.number, 6);
    assert.equal(await footer(c.pageId), '', 'the master page skips the copied cover as it skips the cover');
    ok(await k.tool('koralpaper_delete_page', { documentId: docId, pageId: c.pageId }));
  });

  test('versions stay still when nothing changes: a duplicated page does not make pages look edited', async () => {
    const a = await read(docId);
    await k.page(`flushAutosave(); docTrack(); docTrack();`);
    const b = await read(docId);
    assert.deepEqual(b.pages.map(x => x.version), a.pages.map(x => x.version));
    assert.equal(b.version, a.version);
    // the same holds for a page the user duplicates by hand in the app
    await k.page(`duplicatePage(1);`);
    const all = JSON.parse(await k.page(`return JSON.stringify(state.pages.flatMap(pg => pg.elements.filter(e => !e.master).map(e => e.id)));`));
    assert.equal(new Set(all).size, all.length, 'no two pages share an element id');
    const c = await read(docId);
    await k.page(`flushAutosave(); docTrack();`);
    assert.equal((await read(docId)).version, c.version);
    await k.page(`undo();`);
  });

  test('reorder_pages puts the pages in the order given, and page numbers follow', async () => {
    const doc = await read(docId);
    const ids = doc.pages.map(x => x.id);
    const order = [ids[0], ids[3], ids[1], ids[2], ids[4]];
    const r = ok(await k.tool('koralpaper_reorder_pages', { documentId: docId, order, ifVersion: doc.version }));
    assert.equal(r.moved, true);
    assert.deepEqual(r.pages.map(x => x.id), order);
    assert.deepEqual(await names(), ['Cover', 'The proof', '02 · The myth', '03 · Myth two', 'End']);
    assert.equal(await footer(ids[3]), '02 / 05');
    assert.equal(await footer(ids[1]), '03 / 05');
    // anything but every page once is refused, and nothing moves
    refused(await k.tool('koralpaper_reorder_pages', { documentId: docId, order: order.slice(1) }), /must name every page once, and "Cover" \([^)]+\) is missing/);
    refused(await k.tool('koralpaper_reorder_pages', { documentId: docId, order: order.concat('ghost') }), /no page with id "ghost"/);
    refused(await k.tool('koralpaper_reorder_pages', { documentId: docId, order: [order[0], order[0], order[1], order[2], order[3], order[4]] }), /listed more than once/);
    refused(await k.tool('koralpaper_reorder_pages', { documentId: docId, order: ids, ifVersion: doc.version }), /document "Pages" changed since version/);
    assert.deepEqual((await read(docId)).pages.map(x => x.id), order);
    assert.equal(ok(await k.tool('koralpaper_reorder_pages', { documentId: docId, order })).moved, false);
    await k.page(`undo();`);
    assert.deepEqual((await read(docId)).pages.map(x => x.id), ids, 'one undo in the app puts the old order back');
  });

  test('delete_page removes one page; the last page, a stale version and an unknown id are refused', async () => {
    const doc = await read(docId);
    const victim = doc.pages[2];
    refused(await k.tool('koralpaper_delete_page', { documentId: docId, pageId: victim.id, ifVersion: victim.version - 1 }), /changed since version/);
    refused(await k.tool('koralpaper_delete_page', { documentId: docId }), /Give the pageId of the page to delete/);
    refused(await k.tool('koralpaper_delete_page', { documentId: docId, pageId: 'nope' }), /No page with id "nope"/);
    assert.equal((await read(docId)).pages.length, 5);
    const r = ok(await k.tool('koralpaper_delete_page', { documentId: docId, pageId: victim.id, ifVersion: victim.version }));
    assert.deepEqual(r.deleted, { id: victim.id, name: victim.name, elements: 4 });
    assert.equal(r.pages.length, 4);
    assert.ok(!(await names()).includes(victim.name));
    assert.equal(await footer(doc.pages[3].id), '03 / 04', 'page numbers close the gap');
    await k.page(`undo();`);
    assert.equal((await read(docId)).pages.length, 5, 'Cmd+Z brings the page back');
    await k.page(`redo();`);
    // a deleted cover that is brought back is still a cover: the master page keeps skipping it
    const coverId = (await read(docId)).pages[0].id;
    assert.equal(await footer(coverId), '');
    ok(await k.tool('koralpaper_delete_page', { documentId: docId, pageId: coverId }));
    await k.page(`undo();`);
    assert.equal((await read(docId)).pages[0].id, coverId);
    assert.equal(await footer(coverId), '', 'the cover came back without the page number');
    // down to one page, which cannot go
    let left = (await read(docId)).pages;
    for (const pg of left.slice(1)) ok(await k.tool('koralpaper_delete_page', { documentId: docId, pageId: pg.id }));
    left = (await read(docId)).pages;
    assert.equal(left.length, 1);
    refused(await k.tool('koralpaper_delete_page', { documentId: docId, pageId: left[0].id }), /this is the only page/);
    assert.equal((await read(docId)).pages.length, 1);
  });
});

/* ───────────────────────────────────────────────────── */
describe('a document saved by 3.85.2, in a browser where the image section was folded', () => {
  /* The shape of the carousel this round was tested on: two tinted SVG marks and a
     photo dropped in by hand, a master page with a rule, no safe area left in the
     saved artboard, and the image section of the sidebar folded. */
  const img = (id, x, y, w, h, imgId, extra) => Object.assign({ id, type: 'image', x, y, w, h, angle: 0, seed: 7, stroke: 'ink', fill: 'none',
    fillStyle: 'solid', dash: 'solid', sw: 3.3, sketch: 1, round: 1, opacity: 100, fillOpacity: 100, text: '', font: 'sans', size: 21, align: 'center',
    lh: 1.3, pgap: 0, lspace: 0, valign: 'middle', groupId: null, imgId, artStyle: 'photo', detail: 2, bright: 0, contrast: 0, gamma: 1, sharp: 0 }, extra);
  let ids;
  test('it opens with its pictures, and selecting one shows every image control', async () => {
    const jpg = 'data:image/jpeg;base64,' + fs.readFileSync(pics.jpg).toString('base64');
    const svg = 'data:image/svg+xml;base64,' + fs.readFileSync(pics.svg).toString('base64');
    const payload = { v: 6, appVersion: '3.85.2', pageIndex: 0, images: { imsvg1: svg, imjpg1: jpg },
      camera: { x: 0, y: 0, z: 0.5 }, grid: 'grid', gridSize: 24, snap: true, theme: 'light', bgColor: null,
      board: { name: 'Custom', w: 1080, h: 1350, x: 0, y: 0 },
      pages: [
        { id: 'own_p1', name: 'Cover', bg: '#0B1A33', elements: [
          img('own_logo', 880, 85, 120, 60, 'imsvg1', { stroke: '#aeb9cc', tint: true }),
          img('own_mark', 28, 320, 240, 120, 'imsvg1', { stroke: '#aeb9cc', tint: true }) ] },
        { id: 'own_p2', name: 'Photo', bg: '#FFFFFF', elements: [ img('own_photo', 0, 0, 1080, 720, 'imjpg1', { detail: 3 }) ] } ],
      meta: { id: 'doc_owner_copy01', name: 'Owner copy', clock: 5, pv: {}, ev: {}, gone: [], comments: [],
        styles: { text: {}, colors: { hair: '#CFCFCB', navygray: '#AEB9CC' } },
        master: { rev: 1, front: true, skip: ['own_p1'], elements: [{ id: 'own_rule', type: 'line', x: 80, y: 1236, w: 0, h: 0, angle: 0, seed: 3, stroke: '#CFCFCB',
          fill: 'none', fillStyle: 'solid', dash: 'solid', sw: 2, sketch: 0, round: 1, opacity: 100, fillOpacity: 100, text: '', font: 'sans', size: 16, align: 'center',
          lh: 1.3, pgap: 0, lspace: 0, valign: 'middle', groupId: null, points: [[0, 0], [920, 0]], curve: 0, elbow: false, elbowPts: null, startHead: 'none', endHead: 'none',
          startBind: null, endBind: null, tok: { stroke: 'hair' } }] }, starter: null } };
    await k.page(`flushAutosave();
      localStorage.setItem('asterisk.sketch.v1', ${J(JSON.stringify(payload))});
      localStorage.setItem('asterisk.docname', 'Owner copy');
      localStorage.setItem('koralpaper.panelfold', JSON.stringify({ rowArt: true }));
      localStorage.removeItem('koralpaper.panelfold.v');
      autosavePending = false; clearTimeout(autosaveTimer);`);
    await k.reload();
    assert.equal(await k.page(`return state.meta.id + '|' + state.pages.length;`), 'doc_owner_copy01|2');
    await k.page(`switchPage(1); for (let i = 0; i < 100 && !getImageEntry(state.elements[0]._src).ready; i++) await new Promise(r => setTimeout(r, 30));`);
    await select('own_photo');
    let p = await panel();
    assert.deepEqual(p.folded, []);
    assert.equal(p.label, 'Image');
    for (const [name, shown] of Object.entries(p.controls)) assert.equal(shown, true, name + ' is on screen');
    assert.equal(p.info, '600 × 400 px · JPEG');
    assert.equal(p.fit, 'stretch', 'pictures placed before 3.86 keep the look they had');
    assert.equal(await k.page(`return document.querySelector('#artDetailSeg .sel').dataset.detail;`), '3', 'its own settings are intact');
    await k.page(`switchPage(0);`);
    await select('own_logo');
    p = await panel();
    assert.equal(p.controls.crop, true);
    assert.equal(await k.page(`return $('strokeLabel').textContent;`), 'Tint', 'the colour on an SVG mark is its tint');
  });

  test('read_document tells them apart from outlined boxes, and the master rule has both ends', async () => {
    const doc = await read('doc_owner_copy01');
    const logo = doc.pages[0].elements.find(e => e.id === 'own_logo'), photo = doc.pages[1].elements[0];
    assert.deepEqual([logo.type, logo.format, logo.naturalWidth, logo.naturalHeight, logo.fit], ['image', 'svg', 120, 60, 'stretch']);
    assert.equal(logo.tint, '#aeb9cc', 'the grey is reported as what it is: a tint');
    assert.equal(logo.stroke, undefined); assert.equal(logo.sw, undefined);
    assert.deepEqual([photo.type, photo.format, photo.naturalWidth, photo.fit, photo.crop], ['image', 'jpeg', 600, 'stretch', null]);
    assert.equal(photo.stroke, undefined); assert.equal(photo.sw, undefined);
    const rule = doc.master.elements[0];
    assert.deepEqual([rule.x, rule.y, rule.x2, rule.y2, rule.w], [80, 1236, 1000, 1236, undefined]);
    assert.equal(doc.board.safeArea, undefined, 'the safe area was already lost when this copy was saved');
    ids = { logo: logo.id, photo: photo.id };
  });

  test('the safe area can be put back, and then the guide shows and measure checks against it', async () => {
    assert.equal(ok(await k.tool('koralpaper_set_board', { documentId: 'doc_owner_copy01', safeArea: 80 })).board.safeArea, 80);
    const r = ok(await k.tool('koralpaper_measure', { documentId: 'doc_owner_copy01', elementIds: [ids.logo, ids.photo] })).elements;
    assert.equal(r[0].outsideSafeArea, false, 'the logo ends at x = 1000, right on the safe edge');
    assert.equal(r[1].outsideSafeArea, true, 'a full-width photo is meant to leave it, and says so');
    await k.reload();
    assert.equal((await read('doc_owner_copy01')).board.safeArea, 80);
  });
});
