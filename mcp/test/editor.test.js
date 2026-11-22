/* The text editor: the caret and the selection are painted on the canvas from the
   same layout that paints the letters, so they sit exactly on the text whatever
   its weight, style or wrapping. Real pointer and key events in the real app.
   Run from the repo root:   node --test mcp/test/*.test.js

   © 2026 Stefanos Karagos, CAIO Group · wearecaio.com · MIT */
'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./harness');

const ok = r => { assert.equal(r.isError, false, 'tool reported an error: ' + r.text); return r.json; };
const J = v => JSON.stringify(v);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, wanted ${b} (within ${tol})`);
const COPY = 'AI writes with the same confidence when it is wrong. The review is your job, and it takes a minute.';

describe('the text editor follows the painted text', () => {
  let k, ids;
  before(async () => {
    k = await start();
    await k.page(`const b = document.getElementById('welcomeStart'); if (b) b.click();`);
  });
  after(async () => { if (k) await k.stop(); });

  /* helpers that run in the page */
  const PAGE = `
    const elOf = id => state.elements.find(e => e.id === id);
    const open = async id => { if (editing) commitTextEdit(); const el = elOf(id); await claudeFontsReady([el]); if (el.type === 'text') autosizeText(el);
      setSelection(new Set([id])); openTextEditor(el, false); await new Promise(r => setTimeout(r, 60)); return el; };
    /* where the canvas really paints each line of one element: read from the painter itself,
       through the hook every painted line passes (the one PDF export uses), not from the editor's layout */
    const paintedLines = async el => { const off = document.createElement('canvas'); off.width = 1080; off.height = 1350;
      const cx = off.getContext('2d'); cx._kpText = [];
      const was = el.angle; el.angle = 0;
      renderScene(cx, [el], { width: 1080, height: 1350, camera: { x: 0, y: 0, z: 1 }, pal: pal(), bg: '#FFFFFF', transparent: false, grid: false, gridSize: gsize(), gridColor: '#000000' });
      el.angle = was;
      const lh = lineHeightOf(el.size, el.lh);
      return cx._kpText.map(t => ({ text: t.text, x: t.x, w: t.w, top: t.y - lh / 2, h: lh })); };
    /* a real click at a page position (un-rotated elements) */
    const fire = (type, x, y, extra) => { const [px, py] = toScreen(x, y);
      editorEl.dispatchEvent(new PointerEvent(type, Object.assign({ clientX: px, clientY: py, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, bubbles: true, cancelable: true, isPrimary: true }, extra || {}))); };
    const click = (x, y, extra) => { fire('pointerdown', x, y, extra); fire('pointerup', x, y, extra); };
    const key = (k2, extra) => editorEl.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k2, bubbles: true, cancelable: true }, extra || {})));
    const sel = () => [editorEl.selectionStart, editorEl.selectionEnd];
    /* what the overlay asks the canvas to paint for the caret and the selection */
    const overlay = () => { const calls = []; const fake = new Proxy({}, { get: (t, p) => p === 'fillRect' ? (...a) => calls.push(a.map(n => Math.round(n * 100) / 100)) : (typeof p === 'string' ? (() => {}) : undefined), set: () => true });
      caretBlinkFrom = performance.now(); drawTextCaret(fake, 1); return calls; };
  `;
  const run = body => k.page(PAGE + body);

  test('set up texts of every kind that used to drift', async () => {
    const d = ok(await k.tool('koralpaper_create_document', { name: 'Editor', board: { w: 1080, h: 1350 } })).documentId;
    ids = ok(await k.tool('koralpaper_create_page', { documentId: d, name: 'P', paper: '#ECECEA', elements: [
      { id: 'bold', type: 'text', x: 82, y: 60, w: 930, wrap: true, text: COPY, font: 'Inter Tight', size: 40, weight: 400, bold: true, sketch: 0 },
      { id: 'italic', type: 'text', x: 82, y: 260, w: 930, wrap: true, text: COPY, font: 'Gelasio', size: 40, italic: true },
      { id: 'mixed', type: 'text', x: 82, y: 460, w: 930, wrap: true, text: COPY, font: 'Inter Tight', size: 40 },
      { id: 'hyphen', type: 'text', x: 82, y: 640, w: 500, wrap: true, text: 'A well-known state-of-the-art non-technical decision-making follow-up check-list for every-day use', font: 'Inter Tight', size: 40 },
      { id: 'slash', type: 'text', x: 620, y: 640, w: 400, wrap: true, text: 'Input/output and/or yes/no questions/answers/replies?maybe', font: 'Inter Tight', size: 40 },
      { id: 'right', type: 'text', x: 82, y: 960, w: 600, wrap: true, align: 'right', text: 'Right aligned copy\nin two paragraphs that wrap', font: 'Inter Tight', size: 36, weight: 800, letterSpacing: -1.5 },
      { id: 'box', type: 'rect', x: 720, y: 940, w: 300, h: 200, text: 'Centred text inside a box', font: 'Inter Tight', size: 28, bold: true, sketch: 0 },
      { id: 'free', type: 'text', x: 82, y: 1180, text: 'One free line', font: 'Inter Tight', size: 40, weight: 900 },
      { id: 'a', type: 'rect', x: 500, y: 1180, w: 120, h: 80 }, { id: 'b', type: 'rect', x: 880, y: 1180, w: 120, h: 80 },
      { id: 'label', type: 'arrow', from: 'a', to: 'b', text: 'a label' },
    ] })).ids;
    // a few words in the middle made bold by hand: mixed formatting
    await run(`const el = elOf(${J(ids.mixed)}); el.runs = [{ s: 20, e: 60, b: true, i: false, hl: null, co: null }]; autosizeText(el); commit();`);
  });

  test('the text field shows nothing of its own: no caret, no highlight, no letters', async () => {
    const cs = JSON.parse(await run(`await open(${J(ids.bold)}); const c = getComputedStyle(editorEl), s = getComputedStyle(editorEl, '::selection');
      return JSON.stringify({ color: c.color, caret: c.caretColor, sel: s.backgroundColor });`));
    assert.match(cs.color, /rgba\(0, 0, 0, 0\)/);
    assert.match(cs.caret, /rgba\(0, 0, 0, 0\)/);
    assert.match(cs.sel, /rgba\(0, 0, 0, 0\)/);
  });

  for (const name of ['bold', 'italic', 'mixed', 'hyphen', 'slash', 'right', 'box', 'free', 'label']){
    test(`${name}: select all covers exactly the painted lines, and a click on any letter puts the caret there`, async () => {
      const r = JSON.parse(await run(`
        const el = await open(${J(ids[name])});
        const lines = await paintedLines(el);
        // 1. opening selects everything: one band per painted line, exactly as wide as its letters
        const bands = overlay();
        // 2. click just right of the left edge of several letters on every line: the caret lands on that letter
        const hits = [];
        const rows = textRows(el).rows;
        for (const row of rows){
          const n = row.ln.text.length;
          for (const kk of [0, Math.floor(n / 3), Math.floor(2 * n / 3), n]){
            const x = row.x + linePrefixWidth(el, row.ln, kk);
            click(x + 0.4, row.top + row.h / 2);
            hits.push({ want: row.start + kk, got: sel(), caret: overlay() });
          }
        }
        return JSON.stringify({ text: el.text.length, lines, bands, hits, size: el.size });`));
      assert.ok(r.lines.length >= 1);
      const drawn = r.lines.filter(l => l.w > 0);
      assert.equal(r.bands.length, drawn.length, 'one band per line: ' + J(r.bands));
      drawn.forEach((l, i) => {
        near(r.bands[i][0], l.x, 0.6, `${name} line ${i + 1}: the band starts at the first letter`);
        const last = i === drawn.length - 1;
        near(r.bands[i][2], l.w + (last ? 0 : r.size * 0.28), 0.6, `${name} line ${i + 1}: the band is as wide as the letters`);
        near(r.bands[i][1], l.top, 0.6, `${name} line ${i + 1}: the band sits on the line`);
      });
      for (const h of r.hits){
        assert.deepEqual(h.got, [h.want, h.want], `${name}: clicked letter ${h.want}`);
        assert.equal(h.caret.length, 1, 'a caret is painted');
      }
    });
  }

  test('the bold paragraph from the carousel: three painted lines, all of it selectable, the caret under the pointer', async () => {
    const r = JSON.parse(await run(`
      const el = await open(${J(ids.bold)});
      const rows = textRows(el).rows;
      const out = { lines: rows.map(r => r.ln.text), all: sel() };
      // click in the middle of "minute." on the third line, the part that could not be reached
      const row = rows[rows.length - 1];
      const x = row.x + linePrefixWidth(el, row.ln, 3) + 0.4;
      click(x, row.top + row.h / 2);
      out.click = sel(); out.want = row.start + 3;
      out.caretX = overlay()[0][0]; out.clickX = x;
      return JSON.stringify(out);`));
    assert.deepEqual(r.lines, ['AI writes with the same confidence when it is', 'wrong. The review is your job, and it takes a', 'minute.']);
    assert.deepEqual(r.all, [0, COPY.length]);
    assert.deepEqual(r.click, [r.want, r.want]);
    near(r.caretX, r.clickX, 2, 'the caret is painted where the pointer clicked');
  });

  test('dragging selects from letter to letter across lines; a double click takes the word, a third click everything', async () => {
    const r = JSON.parse(await run(`
      const el = await open(${J(ids.bold)});
      const rows = textRows(el).rows;
      const at = (ri, kk) => [rows[ri].x + linePrefixWidth(el, rows[ri].ln, kk) + 0.4, rows[ri].top + rows[ri].h / 2];
      const out = {};
      fire('pointerdown', ...at(0, 3)); fire('pointermove', ...at(1, 6)); fire('pointermove', ...at(2, 4)); fire('pointerup', ...at(2, 4));
      out.drag = sel(); out.wantDrag = [rows[0].start + 3, rows[2].start + 4]; out.bands = overlay().length;
      // backwards: from line 2 up to line 1
      fire('pointerdown', ...at(1, 10)); fire('pointermove', ...at(0, 5)); fire('pointerup', ...at(0, 5));
      out.back = sel(); out.dir = editorEl.selectionDirection; out.wantBack = [rows[0].start + 5, rows[1].start + 10];
      // shift-click extends from the anchor
      click(...at(0, 2)); click(...at(1, 4), { shiftKey: true });
      out.shift = sel(); out.wantShift = [rows[0].start + 2, rows[1].start + 4];
      // double click on "confidence", then a third click
      const w = el.text.indexOf('confidence');
      const p = at(0, w - rows[0].start + 4);
      click(...p); click(...p);
      out.word = el.text.slice(...sel());
      click(...p);
      out.triple = sel();
      return JSON.stringify(out);`));
    assert.deepEqual(r.drag, r.wantDrag);
    assert.equal(r.bands, 3, 'the selection is painted on all three lines');
    assert.deepEqual(r.back, r.wantBack);
    assert.equal(r.dir, 'backward');
    assert.deepEqual(r.shift, r.wantShift);
    assert.equal(r.word, 'confidence');
    assert.deepEqual(r.triple, [0, COPY.length]);
  });

  test('up, down, line start and line end move along the painted lines, and shift extends', async () => {
    const r = JSON.parse(await run(`
      const el = await open(${J(ids.bold)});
      const rows = textRows(el).rows;
      const xOf = i => { const row = rows[textRowOf(rows, i)]; return row.x + linePrefixWidth(el, row.ln, i - row.start); };
      const out = {};
      editorEl.setSelectionRange(rows[0].start + 12, rows[0].start + 12);
      const x0 = xOf(rows[0].start + 12);
      key('ArrowDown'); out.down1 = sel()[0]; out.down1Row = textRowOf(rows, out.down1); out.dx1 = Math.abs(xOf(out.down1) - x0);
      key('ArrowDown'); out.down2 = sel()[0]; out.down2Row = textRowOf(rows, out.down2);
      key('ArrowDown'); out.down3 = sel()[0];
      key('ArrowUp'); out.up1Row = textRowOf(rows, sel()[0]);
      key('ArrowUp'); out.back = sel()[0]; out.backDx = Math.abs(xOf(out.back) - x0);
      key('ArrowUp'); out.top = sel()[0];
      editorEl.setSelectionRange(rows[1].start + 9, rows[1].start + 9);
      key('End'); out.end = sel()[0]; out.wantEnd = rows[1].end;
      key('Home'); out.home = sel()[0]; out.wantHome = rows[1].start;
      key('ArrowRight', { metaKey: true }); out.cmdRight = sel()[0];
      key('ArrowLeft', { metaKey: true }); out.cmdLeft = sel()[0];
      editorEl.setSelectionRange(rows[0].start + 5, rows[0].start + 5);
      key('ArrowDown', { shiftKey: true }); out.shiftDown = sel(); out.wantShiftDownStart = rows[0].start + 5; out.shiftRow = textRowOf(rows, sel()[1]);
      key('End', { shiftKey: true }); out.shiftEnd = sel()[1];
      return JSON.stringify(out);`));
    assert.equal(r.down1Row, 1); assert.ok(r.dx1 < 14, 'down keeps the column: ' + r.dx1);
    assert.equal(r.down2Row, 2, 'down again reaches the third line');
    assert.equal(r.down3, COPY.length, 'down on the last line goes to the end of the text');
    assert.equal(r.up1Row, 1);
    assert.ok(r.backDx < 14, 'up and down come back to the same column: ' + r.backDx);
    assert.equal(r.top, 0, 'up on the first line goes to the start of the text');
    assert.equal(r.end, r.wantEnd); assert.equal(r.home, r.wantHome);
    assert.equal(r.cmdRight, r.wantEnd); assert.equal(r.cmdLeft, r.wantHome);
    assert.equal(r.shiftDown[0], r.wantShiftDownStart); assert.equal(r.shiftRow, 1);
    assert.equal(r.shiftEnd, r.wantEnd);
  });

  test('typing reflows the text and the caret stays on the letter just typed', async () => {
    const r = JSON.parse(await run(`
      const el = await open(${J(ids.bold)});
      const end = el.text.length;
      editorEl.setSelectionRange(end, end);
      editorEl.setRangeText(' And one more sentence that makes a fourth line here.', end, end, 'end');
      editorEl.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 30));
      const rows = textRows(el).rows;
      const caret = overlay()[0];
      const last = rows[rows.length - 1];
      const out = { lines: rows.length, at: sel(), len: el.text.length, caretX: caret[0] + caret[2] / 2, endX: last.x + last.ln.w, caretY: caret[1], rowTop: last.top, rowH: last.h, bold: !!(el.runs && el.runs[0].b && el.runs[0].e === el.text.length) };
      commitTextEdit(); undo();
      out.afterUndo = elOf(${J(ids.bold)}).text.length;
      return JSON.stringify(out);`));
    assert.ok(r.lines >= 4, 'the longer text takes another line: ' + r.lines);
    assert.deepEqual(r.at, [r.len, r.len]);
    near(r.caretX, r.endX, 1.5, 'the caret sits right after the last letter');
    assert.ok(r.caretY >= r.rowTop - 1 && r.caretY <= r.rowTop + r.rowH, 'on the last line');
    assert.equal(r.bold, true, 'what was typed is bold like the rest');
    assert.equal(r.afterUndo, COPY.length);
  });

  test('a turned text: a click on a letter still finds that letter', async () => {
    const r = JSON.parse(await run(`
      const el = elOf(${J(ids.hyphen)}); el.angle = 0.5; commit();
      await open(el.id);
      const rows = textRows(el).rows, b = boundsOf(el), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const hits = [];
      for (const row of rows){
        const kk = Math.floor(row.ln.text.length / 2);
        const [sx, sy] = rotatePoint(row.x + linePrefixWidth(el, row.ln, kk) + 0.4, row.top + row.h / 2, cx, cy, el.angle);
        click(sx, sy);
        hits.push([row.start + kk, sel()[0]]);
      }
      const rc = editorEl.getBoundingClientRect();
      commitTextEdit(); el.angle = 0; commit();
      return JSON.stringify({ hits, covers: rc.width > 0 && rc.height > 0 });`));
    for (const [want, got] of r.hits) assert.equal(got, want);
    assert.equal(r.covers, true);
  });

  test('an empty new text shows a caret at its start, and leaving it empty removes it', async () => {
    const r = JSON.parse(await run(`
      if (editing) commitTextEdit();
      const before = state.elements.length;
      const el = newElement('text', 300, 1300, { font: 'intertight', size: 30, align: 'left' });
      state.elements.push(el); openTextEditor(el, true);
      await new Promise(r => setTimeout(r, 60));
      const caret = overlay();
      commitTextEdit();
      return JSON.stringify({ caret, gone: state.elements.length === before });`));
    assert.equal(r.caret.length, 1);
    near(r.caret[0][0], 300, 2, 'the caret is at the start of the empty text');
    assert.equal(r.gone, true);
  });
});
