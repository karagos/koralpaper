/* Tests for the five "Must" features of the KoralPaper MCP server.
   Run from the repo root:   node --test mcp/test/*.test.js
   They drive the real server and the real app (headless Chrome, throwaway
   profile, test ports). See harness.js.

   © 2026 Stefanos Karagos, CAIO Group · wearecaio.com · MIT */
'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start, ROOT } = require('./harness');

let k;
before(async () => { k = await start(); });
after(async () => { if (k) await k.stop(); });

const BOARD = { w: 1080, h: 1350 };
const ok = r => { assert.equal(r.isError, false, 'tool reported an error: ' + r.text); return r.json; };

/* ── 1. Documents ─────────────────────────────────── */
describe('1. documents', () => {
  let first, firstPage, second;

  test('without documentId or pageId the tools act on what is on screen, as before', async () => {
    const before = ok(await k.tool('koralpaper_read_document'));
    first = before.documentId;
    const made = ok(await k.tool('koralpaper_create_page', { name: 'Existing work', elements: [{ id: 'a', type: 'rect', x: 10, y: 10, text: 'keep me' }] }));
    firstPage = made.pageId;
    const added = ok(await k.tool('koralpaper_add_elements', { elements: [{ id: 'b', type: 'ellipse', x: 300, y: 10 }] }));
    assert.equal(added.pageId, firstPage);
    assert.equal(added.documentId, first);
    assert.equal(added.elements, 2);
    assert.equal(ok(await k.tool('koralpaper_update_elements', { updates: [{ id: made.ids.a, text: 'kept' }] })).updated, 1);
    assert.equal(ok(await k.tool('koralpaper_delete_elements', { ids: [added.ids.b] })).deleted, 1);
    assert.ok((await k.tool('koralpaper_render_page')).image, 'render_page returns an image');
  });

  test('create_document starts a separate document and leaves the other one untouched', async () => {
    const made = ok(await k.tool('koralpaper_create_document', { name: 'Carousel A', board: BOARD }));
    second = made.documentId;
    assert.notEqual(second, first);
    assert.deepEqual({ w: made.board.w, h: made.board.h }, BOARD);
    const now = ok(await k.tool('koralpaper_read_document'));
    assert.equal(now.documentId, second);
    assert.equal(now.name, 'Carousel A');
    assert.equal(now.pages.length, 1);
    assert.equal(now.pages[0].elements.length, 0);
  });

  test('the first created page replaces the blank starter page', async () => {
    const p = ok(await k.tool('koralpaper_create_page', { documentId: second, name: 'Cover', elements: [{ type: 'text', x: 80, y: 80, text: 'Cover' }] }));
    const doc = ok(await k.tool('koralpaper_read_document', { documentId: second }));
    assert.equal(doc.pages.length, 1);
    assert.equal(doc.pages[0].id, p.pageId);
    assert.equal(doc.pages[0].name, 'Cover');
  });

  test('list_documents shows both, with the open one marked', async () => {
    const list = ok(await k.tool('koralpaper_list_documents')).documents;
    const a = list.find(d => d.id === first), b = list.find(d => d.id === second);
    assert.ok(a && b, 'both documents are listed');
    assert.equal(b.open, true);
    assert.equal(a.open, false);
    assert.equal(b.name, 'Carousel A');
  });

  test('open_document brings the first document back exactly as it was', async () => {
    const opened = ok(await k.tool('koralpaper_open_document', { id: first }));
    assert.equal(opened.documentId, first);
    const doc = ok(await k.tool('koralpaper_read_document'));
    assert.equal(doc.documentId, first);
    const page = doc.pages.find(p => p.id === firstPage);
    assert.ok(page, 'the page drawn earlier is still there');
    assert.deepEqual(page.elements.map(e => e.text), ['kept']);
  });

  test('a documentId on a drawing tool lands the write in that document, not the open one', async () => {
    const onScreen = ok(await k.tool('koralpaper_read_document')).documentId;
    assert.equal(onScreen, first);
    const added = ok(await k.tool('koralpaper_create_page', { documentId: second, name: 'Two', elements: [{ type: 'rect', x: 0, y: 0, text: 'B2' }] }));
    assert.equal(added.documentId, second);
    const a = ok(await k.tool('koralpaper_read_document', { documentId: first }));
    assert.equal(a.pages.some(p => p.name === 'Two'), false, 'the first document did not get the page');
    const b = ok(await k.tool('koralpaper_read_document', { documentId: second }));
    assert.deepEqual(b.pages.map(p => p.name), ['Cover', 'Two']);
  });

  test('a pageId aims a write at that page, and reads list only that page', async () => {
    const b = ok(await k.tool('koralpaper_read_document', { documentId: second }));
    const cover = b.pages[0], two = b.pages[1];
    const added = ok(await k.tool('koralpaper_add_elements', { documentId: second, pageId: cover.id, elements: [{ id: 'x', type: 'chip', x: 80, y: 300, text: 'on cover' }] }));
    assert.equal(added.pageId, cover.id);
    const one = ok(await k.tool('koralpaper_read_document', { documentId: second, pageId: cover.id }));
    assert.ok(one.pages[0].elements.some(e => e.text === 'on cover'));
    assert.equal(one.pages[1].elements, undefined);
    assert.equal(one.pages[1].elementCount, 1);
    const twoNow = ok(await k.tool('koralpaper_read_document', { documentId: second, pageId: two.id }));
    assert.equal(twoNow.pages[1].elements.some(e => e.text === 'on cover'), false);
  });

  test('unknown ids are refused with a clear message', async () => {
    const d = await k.tool('koralpaper_read_document', { documentId: 'doc_nope' });
    assert.equal(d.isError, true);
    assert.match(d.text, /No document with id "doc_nope"/);
    const p = await k.tool('koralpaper_add_elements', { documentId: second, pageId: 'nope', elements: [{ type: 'rect' }] });
    assert.equal(p.isError, true);
    assert.match(p.text, /No page with id "nope"/);
    const o = await k.tool('koralpaper_open_document', { id: 'doc_nope' });
    assert.equal(o.isError, true);
  });
});

/* ── 2. Version guard ─────────────────────────────── */
describe('2. version guard', () => {
  let docId, pageId, otherPage, elId, v0;

  test('read_document returns a version per page', async () => {
    docId = ok(await k.tool('koralpaper_create_document', { name: 'Guarded', board: BOARD })).documentId;
    const made = ok(await k.tool('koralpaper_create_page', { documentId: docId, pages: [
      { name: 'P1', elements: [{ id: 'h', type: 'text', x: 80, y: 80, text: 'Headline' }] },
      { name: 'P2', elements: [{ id: 'h', type: 'text', x: 80, y: 80, text: 'Second' }] },
    ] }));
    pageId = made.pages[0].pageId; otherPage = made.pages[1].pageId; elId = made.pages[0].ids.h;
    const doc = ok(await k.tool('koralpaper_read_document', { documentId: docId }));
    for (const p of doc.pages) assert.ok(Number.isInteger(p.version) && p.version > 0, 'page has a version');
    assert.deepEqual(made.pages.map(p => p.version), doc.pages.map(p => p.version), 'the versions a write returns are the ones a read returns');
    assert.equal(made.documentVersion, doc.version);
    assert.ok(Number.isInteger(doc.version));
    v0 = doc.pages[0].version;
  });

  test('a write with the current ifVersion goes through and returns the new version', async () => {
    const r = ok(await k.tool('koralpaper_update_elements', { documentId: docId, pageId, ifVersion: v0, updates: [{ id: elId, text: 'Headline v2' }] }));
    assert.ok(r.version > v0);
    v0 = r.version;
  });

  test('after the user changes the page in the app, a write with the old ifVersion is refused', async () => {
    // the user drags the headline in the app
    await k.page(`const i = state.pages.findIndex(p => p.id === ${JSON.stringify(pageId)}); switchPage(i);
      state.elements[0].x += 40; commit(); requestRender();`);
    const r = await k.tool('koralpaper_update_elements', { documentId: docId, pageId, ifVersion: v0, updates: [{ id: elId, text: 'SHOULD NOT LAND' }] });
    assert.equal(r.isError, true);
    assert.match(r.text, /Refused, nothing was written/);
    assert.match(r.text, /changed since version/);
    const doc = ok(await k.tool('koralpaper_read_document', { documentId: docId, pageId }));
    const el = doc.pages[0].elements[0];
    assert.equal(el.text, 'Headline v2', 'the refused write changed nothing');
    assert.equal(el.x, 120, 'the user\'s move is intact');
    assert.ok(doc.pages[0].version > v0);
    // the same guard on add and delete
    const a = await k.tool('koralpaper_add_elements', { documentId: docId, pageId, ifVersion: v0, elements: [{ type: 'rect' }] });
    assert.equal(a.isError, true);
    const d = await k.tool('koralpaper_delete_elements', { documentId: docId, pageId, ifVersion: v0, ids: [elId] });
    assert.equal(d.isError, true);
    assert.equal(ok(await k.tool('koralpaper_read_document', { documentId: docId, pageId })).pages[0].elements.length, 1);
    v0 = doc.pages[0].version;
  });

  test('retrying with the fresh version works', async () => {
    const r = ok(await k.tool('koralpaper_update_elements', { documentId: docId, pageId, ifVersion: v0, updates: [{ id: elId, text: 'Headline v3' }] }));
    assert.ok(r.version > v0);
  });

  test('a change to one page does not disturb the version of another', async () => {
    const before = ok(await k.tool('koralpaper_read_document', { documentId: docId })).pages.find(p => p.id === otherPage).version;
    ok(await k.tool('koralpaper_add_elements', { documentId: docId, pageId, elements: [{ type: 'rect', x: 500, y: 500 }] }));
    const afterV = ok(await k.tool('koralpaper_read_document', { documentId: docId })).pages.find(p => p.id === otherPage).version;
    assert.equal(afterV, before);
    ok(await k.tool('koralpaper_update_elements', { documentId: docId, pageId: otherPage, ifVersion: before, updates: [{ id: ok(await k.tool('koralpaper_read_document', { documentId: docId, pageId: otherPage })).pages[1].elements[0].id, text: 'Second v2' }] }));
  });

  test('undo in the app also counts as a change', async () => {
    // Claude writes to the page, then the user undoes that write in the app
    const v = ok(await k.tool('koralpaper_update_elements', { documentId: docId, pageId, updates: [{ id: elId, text: 'Headline v4' }] })).version;
    await k.page(`const i = state.pages.findIndex(p => p.id === ${JSON.stringify(pageId)}); switchPage(i); undo();`);
    const r = await k.tool('koralpaper_add_elements', { documentId: docId, pageId, ifVersion: v, elements: [{ type: 'rect' }] });
    assert.equal(r.isError, true);
    const doc = ok(await k.tool('koralpaper_read_document', { documentId: docId, pageId }));
    assert.equal(doc.pages[0].elements.find(e => e.id === elId).text, 'Headline v3');
    assert.ok(doc.pages[0].version > v, 'versions only ever go up, even after an undo');
  });
});

/* ── 3. Export ────────────────────────────────────── */
describe('3. export', () => {
  let docId, pageIds;
  const pngSize = buf => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

  test('build a 3-page 1080x1350 document', async () => {
    docId = ok(await k.tool('koralpaper_create_document', { name: 'Export: test/deck', board: BOARD })).documentId;
    const made = ok(await k.tool('koralpaper_create_page', { documentId: docId, pages: [
      { name: 'Red', paper: '#C0392B', elements: [{ type: 'text', x: 80, y: 80, text: 'One', size: 120 }] },
      { name: 'Green', paper: '#27AE60', elements: [{ type: 'text', x: 80, y: 80, text: 'Two', size: 120 }] },
      { name: 'Blue', paper: '#2980B9', elements: [{ type: 'text', x: 80, y: 80, text: 'Three', size: 120 }] },
    ] }));
    pageIds = made.pages.map(p => p.pageId);
    assert.equal(pageIds.length, 3);
  });

  test('png: one file per page inside the Documents folder, at the artboard size', async () => {
    const r = ok(await k.tool('koralpaper_export', { documentId: docId, pageIds: 'all', format: 'png', scale: 1, folder: 'Carousels/Test', filenamePrefix: 'deck' }));
    assert.equal(r.paths.length, 3);
    assert.deepEqual(r.paths.map(p => path.basename(p)), ['deck-01.png', 'deck-02.png', 'deck-03.png']);
    for (const p of r.paths){
      assert.ok(fs.realpathSync(p).startsWith(fs.realpathSync(k.docsDir) + path.sep), 'file is inside the Documents folder');
      const buf = fs.readFileSync(p);
      assert.equal(buf.subarray(1, 4).toString('latin1'), 'PNG');
      assert.deepEqual(pngSize(buf), { w: 1080, h: 1350 });
    }
  });

  test('scale multiplies the pixels; a page list exports just those pages, in document order', async () => {
    const r = ok(await k.tool('koralpaper_export', { documentId: docId, pageIds: [pageIds[2], pageIds[0]], format: 'png', scale: 2, folder: 'Carousels/Test', filenamePrefix: 'big' }));
    assert.deepEqual(r.paths.map(p => path.basename(p)), ['big-01.png', 'big-03.png']);
    assert.deepEqual(pngSize(fs.readFileSync(r.paths[0])), { w: 2160, h: 2700 });
  });

  test('jpg export writes JPEG files', async () => {
    const r = ok(await k.tool('koralpaper_export', { documentId: docId, format: 'jpg', scale: 2, folder: 'Carousels/Test', filenamePrefix: 'photo' }));
    assert.equal(r.paths.length, 3);
    for (const p of r.paths) assert.deepEqual([...fs.readFileSync(p).subarray(0, 3)], [0xFF, 0xD8, 0xFF]);
  });

  test('pdf: one multi-page file, pages in document order, each JPEG embedded byte for byte', async () => {
    const jpg = ok(await k.tool('koralpaper_export', { documentId: docId, format: 'jpg', scale: 2, folder: 'Carousels/Test', filenamePrefix: 'ref', overwrite: true }));
    const r = ok(await k.tool('koralpaper_export', { documentId: docId, pageIds: 'all', format: 'pdf', scale: 2, folder: 'Carousels/Test', filenamePrefix: 'deck' }));
    assert.equal(r.paths.length, 1);
    assert.equal(path.basename(r.paths[0]), 'deck.pdf');
    const pdf = fs.readFileSync(r.paths[0]);
    assert.equal(pdf.subarray(0, 8).toString('latin1'), '%PDF-1.4');
    assert.equal(pdf.subarray(-5).toString('latin1'), '%%EOF');
    const body = pdf.toString('latin1');
    assert.match(body, /\/Type \/Pages \/Kids \[3 0 R 6 0 R 9 0 R\] \/Count 3/);
    assert.equal(body.split('/MediaBox [0 0 1080 1350]').length - 1, 3, 'three pages at the artboard size');
    assert.equal(body.split('/Filter /DCTDecode').length - 1, 3);
    // each page's JPEG, exactly as a jpg export writes it, sits in the PDF, in page order
    let last = -1;
    for (const p of jpg.paths){
      const at = pdf.indexOf(fs.readFileSync(p));
      assert.ok(at > last, path.basename(p) + ' is embedded untouched and in order');
      last = at;
    }
    // the cross-reference table points at real objects
    const xref = Number(body.slice(body.lastIndexOf('startxref') + 9).trim().split('\n')[0]);
    assert.equal(body.slice(xref, xref + 4), 'xref');
    const rows = body.slice(xref).split('\n').slice(3, 3 + 11);
    rows.forEach((row, i) => assert.equal(body.slice(Number(row.slice(0, 10)), Number(row.slice(0, 10)) + String(i + 1).length + 6), `${i + 1} 0 obj`));
  });

  test('an existing file is not overwritten unless asked', async () => {
    const r = ok(await k.tool('koralpaper_export', { documentId: docId, format: 'pdf', folder: 'Carousels/Test', filenamePrefix: 'deck' }));
    assert.equal(path.basename(r.paths[0]), 'deck (2).pdf');
    const o = ok(await k.tool('koralpaper_export', { documentId: docId, format: 'pdf', folder: 'Carousels/Test', filenamePrefix: 'deck', overwrite: true }));
    assert.equal(path.basename(o.paths[0]), 'deck.pdf');
  });

  test('the default file name comes from the document name, made safe for a file system', async () => {
    const r = ok(await k.tool('koralpaper_export', { documentId: docId, pageIds: [pageIds[0]], format: 'png' }));
    assert.equal(path.basename(r.paths[0]), 'Export- test-deck-01.png');
    assert.equal(path.basename(path.dirname(r.paths[0])), 'KoralPaper Exports');
  });

  test('folders outside Documents are refused and nothing is written there', async () => {
    const outside = path.join(k.tmp, 'outside');
    for (const folder of ['../outside', '../../etc', outside, 'ok/../../outside', '~/Desktop']){
      const r = await k.tool('koralpaper_export', { documentId: docId, format: 'png', folder });
      assert.equal(r.isError, true, folder + ' should be refused');
      assert.match(r.text, /Refused: exports can only be written inside/);
    }
    assert.equal(fs.existsSync(outside), false);
    // a link inside Documents that points outside is refused too
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(k.docsDir, 'sneaky'));
    const r = await k.tool('koralpaper_export', { documentId: docId, format: 'png', folder: 'sneaky' });
    assert.equal(r.isError, true);
    assert.deepEqual(fs.readdirSync(outside), []);
  });

  test('a bad format or page id is refused', async () => {
    assert.equal((await k.tool('koralpaper_export', { documentId: docId, format: 'gif' })).isError, true);
    const r = await k.tool('koralpaper_export', { documentId: docId, format: 'png', pageIds: ['nope'] });
    assert.equal(r.isError, true);
    assert.match(r.text, /No page with id "nope"/);
  });

  test('the real Documents folder is the default root', () => {
    // the server is only pointed elsewhere by the test suite's own environment variable
    const src = fs.readFileSync(path.join(ROOT, 'mcp', 'server.js'), 'utf8');
    assert.match(src, /process\.env\.KORALPAPER_DOCS_DIR \|\| path\.join\(os\.homedir\(\), 'Documents'\)/);
    assert.ok(os.homedir().length > 1);
  });
});

/* ── 4. Custom fonts ──────────────────────────────── */
describe('4. custom fonts', () => {
  const FACES = [
    ...[400, 500, 600, 700, 800, 900].map(w => ['Inter Tight', w, 'normal']),
    ['Inter Tight', 400, 'italic'], ['Inter Tight', 700, 'italic'],
    ['JetBrains Mono', 400, 'normal'], ['JetBrains Mono', 500, 'normal'], ['JetBrains Mono', 700, 'normal'],
    ['Gelasio', 400, 'normal'], ['Gelasio', 700, 'normal'], ['Gelasio', 400, 'italic'], ['Gelasio', 700, 'italic'],
  ];

  test('every font file is in the fonts folder', () => {
    const slug = { 'Inter Tight': 'inter-tight', 'JetBrains Mono': 'jetbrains-mono', 'Gelasio': 'gelasio' };
    for (const [fam, w, style] of FACES){
      const f = path.join(ROOT, 'fonts', `${slug[fam]}-latin-${w}-${style}.woff2`);
      assert.ok(fs.existsSync(f) && fs.statSync(f).size > 5000, path.basename(f) + ' exists');
      assert.equal(fs.readFileSync(f).subarray(0, 4).toString('latin1'), 'wOF2');
    }
  });

  test('every weight and style loads from the fonts folder, not from the network', async () => {
    const res = await k.page(`
      const faces = ${JSON.stringify(FACES)};
      const out = [];
      for (const [fam, w, style] of faces){
        const got = await document.fonts.load((style === 'italic' ? 'italic ' : '') + w + ' 40px "' + fam + '"');
        const hit = got.find(f => f.family.replace(/["']/g, '') === fam && String(f.weight) === String(w) && f.style === style);
        out.push({ fam, w, style, loaded: !!hit && hit.status === 'loaded' });
      }
      const css = document.getElementById('kpLocalFonts').textContent;
      return JSON.stringify({ out, local: (css.match(/url\\("fonts\\//g) || []).length, remote: /https?:/.test(css) });`);
    const r = JSON.parse(res);
    for (const f of r.out) assert.equal(f.loaded, true, `${f.fam} ${f.w} ${f.style} loaded`);
    assert.equal(r.local, FACES.length);
    assert.equal(r.remote, false);
  });

  test('font accepts the three names, with weight and italic, and reads them back', async () => {
    const docId = ok(await k.tool('koralpaper_create_document', { name: 'Fonts', board: BOARD })).documentId;
    const made = ok(await k.tool('koralpaper_create_page', { documentId: docId, name: 'Type', elements: [
      { id: 'a', type: 'text', x: 80, y: 80, text: 'Inter Tight Black', font: 'Inter Tight', weight: 900, size: 60 },
      { id: 'b', type: 'text', x: 80, y: 200, text: 'Inter Tight Italic', font: 'inter tight', weight: 400, italic: true, size: 60 },
      { id: 'c', type: 'text', x: 80, y: 320, text: 'const x = 1;', font: 'JetBrains Mono', weight: 500, size: 40 },
      { id: 'd', type: 'text', x: 80, y: 440, text: 'Gelasio bold italic', font: 'Gelasio', weight: 700, italic: true, size: 60 },
      { id: 'e', type: 'rect', x: 80, y: 600, w: 500, h: 160, text: 'In a box', font: 'Gelasio', size: 40 },
    ] }));
    assert.equal(made.warnings, undefined, 'no unknown-font warnings');
    const els = ok(await k.tool('koralpaper_read_document', { documentId: docId })).pages[0].elements;
    const by = t => els.find(e => e.text === t);
    assert.equal(by('Inter Tight Black').font, 'Inter Tight');
    assert.equal(by('Inter Tight Black').weight, 900);
    assert.equal(by('Inter Tight Italic').italic, true);
    assert.equal(by('const x = 1;').font, 'JetBrains Mono');
    assert.equal(by('const x = 1;').weight, 500);
    assert.equal(by('Gelasio bold italic').font, 'Gelasio');
    assert.equal(by('Gelasio bold italic').italic, true);
    assert.equal(by('In a box').font, 'Gelasio');

    // the canvas really uses these faces: widths match the real font, not the fallback
    const m = ok(await k.tool('koralpaper_measure', { documentId: docId, elementIds: Object.values(made.ids) }));
    for (const e of m.elements) assert.equal(e.fontLoaded, true);
    const widths = JSON.parse(await k.page(`
      const c = document.createElement('canvas').getContext('2d');
      const w = (font, text) => { c.font = font; return c.measureText(text).width; };
      return JSON.stringify({
        real: w('900 60px "Inter Tight"', 'Inter Tight Black'), fallback: w('900 60px "Helvetica Neue"', 'Inter Tight Black'),
        mono: w('500 40px "JetBrains Mono"', 'const x = 1;'), monoI: w('500 40px "JetBrains Mono"', 'iiiiiiiiiiii'),
      });`));
    assert.notEqual(Math.round(widths.real), Math.round(widths.fallback), 'Inter Tight is not the fallback font');
    assert.equal(Math.round(m.elements[0].textWidth), Math.round(widths.real));
    assert.equal(Math.round(widths.mono), Math.round(widths.monoI), 'JetBrains Mono is monospaced');

    // update_elements accepts a name too
    ok(await k.tool('koralpaper_update_elements', { documentId: docId, updates: [{ id: made.ids.e, font: 'JetBrains Mono', weight: 700 }] }));
    const after = ok(await k.tool('koralpaper_read_document', { documentId: docId })).pages[0].elements.find(e => e.text === 'In a box');
    assert.equal(after.font, 'JetBrains Mono');
    assert.equal(after.weight, 700);
  });

  test('an unknown font is reported, not silently swapped', async () => {
    const r = ok(await k.tool('koralpaper_add_elements', { elements: [{ type: 'text', x: 80, y: 900, text: 'x', font: 'no such font!!' }] }));
    assert.match(r.warnings.join(' '), /Unknown font "no such font!!"/);
  });

  test('the fonts are in the app\'s font menu', async () => {
    const labels = JSON.parse(await k.page(`return JSON.stringify([...document.querySelectorAll('#fontMenu button[data-font]')].map(b => b.textContent))`));
    for (const name of ['Inter Tight', 'JetBrains Mono', 'Gelasio']) assert.ok(labels.includes(name), name + ' is in the font menu');
  });
});

/* ── 5. Measure ───────────────────────────────────── */
describe('5. measure', () => {
  let docId, ids;
  const LONG = 'This headline is far too long to sit inside the small box it was given, so it has to overflow.';

  test('set up boxes that overflow and boxes that fit', async () => {
    docId = ok(await k.tool('koralpaper_create_document', { name: 'Measure', board: BOARD })).documentId;
    const made = ok(await k.tool('koralpaper_create_page', { documentId: docId, name: 'Boxes', elements: [
      { id: 'over', type: 'rect', x: 80, y: 80, w: 320, h: 120, text: LONG, font: 'Inter Tight', weight: 700, size: 36, sketch: 0 },
      { id: 'fits', type: 'rect', x: 80, y: 300, w: 600, h: 300, text: 'Short and sweet', font: 'Inter Tight', size: 36, sketch: 0 },
      { id: 'wrapOver', type: 'text', x: 80, y: 700, w: 400, wrap: true, maxHeight: 100, text: LONG, font: 'Gelasio', size: 32 },
      { id: 'wrapFits', type: 'text', x: 600, y: 700, w: 400, wrap: true, maxHeight: 400, text: 'Two short\nlines', font: 'Gelasio', size: 32 },
      { id: 'word', type: 'rect', x: 80, y: 1000, w: 160, h: 200, text: 'Supercalifragilisticexpialidocious', size: 30, sketch: 0 },
      { id: 'edge', type: 'text', x: 900, y: 1200, text: 'Runs off the right edge of the board', size: 40 },
      { id: 'arrow', type: 'line', x: 0, y: 0, x2: 50, y2: 50 },
    ] }));
    ids = made.ids;
  });

  test('an overflowing box: line breaks, real height, overflow true with the reason', async () => {
    const m = ok(await k.tool('koralpaper_measure', { documentId: docId, elementIds: [ids.over] })).elements[0];
    assert.equal(m.overflow, true);
    assert.ok(m.lineCount >= 4, 'the text wrapped onto several lines');
    assert.equal(m.lines.join(' '), LONG, 'the lines are the text, broken where it really breaks');
    assert.equal(m.lines.length, m.lineCount);
    assert.equal(m.textHeight, m.lineCount * m.lineHeight);
    assert.equal(m.availableHeight, 120 - 24);
    assert.equal(m.availableWidth, 320 - 24);
    assert.ok(m.textHeight > m.availableHeight);
    assert.match(m.reasons[0], /px too much/);
    for (const line of m.lines) assert.ok(line.length > 0);
  });

  test('the measured lines match what the canvas draws', async () => {
    const m = ok(await k.tool('koralpaper_measure', { documentId: docId, elementIds: [ids.over] })).elements[0];
    const drawn = JSON.parse(await k.page(`
      const el = state.pages.flatMap(p => p.elements).find(e => e.id === ${JSON.stringify(ids.over)});
      const lay = layoutText(el, el.w - 24);
      return JSON.stringify({ lines: lay.lines.map(l => l.text), h: lay.totalH });`));
    assert.deepEqual(m.lines, drawn.lines);
    assert.equal(m.textHeight, drawn.h);
  });

  test('a box that fits reports overflow false', async () => {
    const m = ok(await k.tool('koralpaper_measure', { documentId: docId, elementIds: [ids.fits] })).elements[0];
    assert.equal(m.overflow, false);
    assert.deepEqual(m.lines, ['Short and sweet']);
    assert.deepEqual(m.reasons, []);
  });

  test('wrapped text is checked against its maxHeight', async () => {
    const r = ok(await k.tool('koralpaper_measure', { documentId: docId, elementIds: [ids.wrapOver, ids.wrapFits] })).elements;
    assert.equal(r[0].overflow, true);
    assert.equal(r[0].availableHeight, 100);
    assert.ok(r[0].lineCount > 2);
    assert.equal(r[1].overflow, false);
    assert.deepEqual(r[1].lines, ['Two short', 'lines']);
  });

  test('a word too long for the box, and text past the artboard edge, both count as overflow', async () => {
    const r = ok(await k.tool('koralpaper_measure', { documentId: docId, elementIds: [ids.word, ids.edge] })).elements;
    assert.equal(r[0].overflow, true);
    assert.match(r[0].reasons.join(' '), /too long to wrap/);
    assert.equal(r[1].overflow, true);
    assert.match(r[1].reasons.join(' '), /edge of the artboard/);
  });

  test('fixing the text makes the overflow go away', async () => {
    ok(await k.tool('koralpaper_update_elements', { documentId: docId, updates: [{ id: ids.over, text: 'Short', size: 30 }] }));
    const m = ok(await k.tool('koralpaper_measure', { documentId: docId, elementIds: [ids.over] })).elements[0];
    assert.equal(m.overflow, false);
    assert.equal(m.lineCount, 1);
  });

  test('ids that are not text, or do not exist, are reported per element', async () => {
    const r = ok(await k.tool('koralpaper_measure', { documentId: docId, elementIds: [ids.arrow, 'nope'] })).elements;
    assert.match(r[0].error, /no text box/);
    assert.match(r[1].error, /No element with this id/);
    assert.equal((await k.tool('koralpaper_measure', { documentId: docId, elementIds: [] })).isError, true);
  });
});
