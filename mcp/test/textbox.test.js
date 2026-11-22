/* The eight handles of a text box, dragged with real pointer events in the real app.
   Corners scale the type. Left and right set the width (the text reflows).
   Top and bottom set the HEIGHT of the box and never touch the font size.
   Run from the repo root:   node --test mcp/test/*.test.js

   © 2026 Stefanos Karagos, CAIO Group · wearecaio.com · MIT */
'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./harness');

const BOARD = { w: 1080, h: 1350 };
const ok = r => { assert.equal(r.isError, false, 'tool reported an error: ' + r.text); return r.json; };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, wanted ${b} (within ${tol})`);
const SNAP = 12;                       // drags snap to half a grid step

describe('text box handles', () => {
  let k, docId, id, plainId;
  before(async () => { k = await start(); });
  after(async () => { if (k) await k.stop(); });

  /* select the element, grab one handle, drag it by (dx, dy) page pixels, let go */
  const drag = async (elId, handle, dx, dy, opts = {}) => JSON.parse(await k.page(`
    const id = ${JSON.stringify(elId)};
    const get = () => state.elements.find(e => e.id === id);
    const snap = () => { const el = get(); return { x: el.x, y: el.y, w: el.w, h: el.h, size: el.size, maxH: el.maxH || null, wrap: !!el.wrap, valign: el.valign }; };
    if (typeof setTool === 'function') setTool('select');
    state.selection = new Set([id]); requestRender();
    const before = snap();
    const b = selectionBounds();
    const [hx, hy] = handlePositions(b)[HANDLE_KEYS.indexOf(${JSON.stringify(handle)})];
    const rect = canvas.getBoundingClientRect();
    const fire = (type, wx, wy) => { const [px, py] = toScreen(wx, wy);
      canvas.dispatchEvent(new PointerEvent(type, { clientX: rect.left + px, clientY: rect.top + py, button: 0, buttons: type === 'pointerup' ? 0 : 1,
        pointerId: 1, bubbles: true, isPrimary: true, shiftKey: ${opts.shift ? 'true' : 'false'} })); };
    const dx = ${Number(dx)}, dy = ${Number(dy)};
    fire('pointerdown', hx, hy); fire('pointermove', hx + dx / 2, hy + dy / 2); fire('pointermove', hx + dx, hy + dy); fire('pointerup', hx + dx, hy + dy);
    return JSON.stringify({ before, after: snap() });`));
  /* where the canvas really paints the lines of an element: the baseline y of each */
  const painted = async elId => JSON.parse(await k.page(`
    const r = await claudeRenderPage(state.pages[state.pageIndex], { format: 'png', scale: 1, texts: true });
    const el = state.elements.find(e => e.id === ${JSON.stringify(elId)});
    const lines = layoutText(el, el.wrap ? Math.max(40, el.w) : null).lines.map(l => l.text);
    return JSON.stringify(r.texts.filter(t => lines.includes(t.text)).map(t => t.y));`));
  const textHeight = async elId => Number(await k.page(`
    const el = state.elements.find(e => e.id === ${JSON.stringify(elId)});
    return String(Math.max(elLH(el), layoutText(el, el.wrap ? Math.max(40, el.w) : null).totalH));`));

  test('set up a wrapped headline and a plain one-line text', async () => {
    docId = ok(await k.tool('koralpaper_create_document', { name: 'Handles', board: BOARD })).documentId;
    const made = ok(await k.tool('koralpaper_create_page', { documentId: docId, name: 'P', paper: '#111111', elements: [
      { id: 't', type: 'text', x: 80, y: 420, w: 920, wrap: true, text: 'Five myths about AI at work', font: 'Inter Tight', weight: 800, size: 96, lineHeight: 1.05, textColor: '#FFFFFF', sketch: 0 },
      { id: 'p', type: 'text', x: 80, y: 1000, text: 'One plain line', font: 'Inter Tight', size: 40, textColor: '#FFFFFF', sketch: 0 },
    ] }));
    id = made.ids.t; plainId = made.ids.p;
  });

  test('the bottom handle makes the box taller and leaves the font size alone', async () => {
    const lines0 = await painted(id);
    const r = await drag(id, 's', 0, 132);
    near(r.after.h, r.before.h + 132, SNAP, 'the box grew by the drag');
    assert.equal(r.after.size, r.before.size, 'font size untouched');
    assert.deepEqual([r.after.x, r.after.y, r.after.w], [r.before.x, r.before.y, r.before.w], 'the top edge and the width stay put');
    assert.deepEqual(await painted(id), lines0, 'the text itself did not move: it stays at the top of the taller box');
  });

  test('the top handle grows the box upward and keeps the bottom edge where it was', async () => {
    const r = await drag(id, 'n', 0, -110);
    near(r.after.y, r.before.y - 110, SNAP, 'the top edge followed the pointer');
    near(r.after.y + r.after.h, r.before.y + r.before.h, 0.5, 'the bottom edge did not move');
    assert.ok(r.after.h > r.before.h + 90, 'the box is taller');
    assert.equal(r.after.size, r.before.size, 'font size untouched');
    assert.equal(r.after.w, r.before.w);
  });

  test('both handles also shrink the box again, but never below its text', async () => {
    const th = await textHeight(id);
    let r = await drag(id, 's', 0, -66);
    near(r.after.h, r.before.h - 66, SNAP, 'the bottom handle shrinks the box');
    assert.equal(r.after.y, r.before.y);
    r = await drag(id, 'n', 0, 44);
    near(r.after.h, r.before.h - 44, SNAP, 'the top handle shrinks the box');
    near(r.after.y + r.after.h, r.before.y + r.before.h, 0.5, 'bottom edge fixed');
    r = await drag(id, 's', 0, -2000);
    near(r.after.h, th, 0.5, 'dragged far past the text, the box stops at the height of the text');
    assert.equal(r.after.maxH, null, 'and hugs the text again');
    assert.equal(r.after.size, 96);
    r = await drag(id, 'n', 0, 2000);
    near(r.after.h, th, 0.5, 'the same from the top');
    near(r.after.y + r.after.h, r.before.y + r.before.h, 0.5, 'bottom edge fixed even when the drag overshoots');
  });

  test('the left and right handles still set the width only, and the corners still scale the type', async () => {
    let r = await drag(id, 'e', -220, 0);
    near(r.after.w, r.before.w - 220, SNAP, 'narrower');
    assert.equal(r.after.size, r.before.size);
    assert.ok(r.after.h > r.before.h, 'the text reflowed onto more lines');
    r = await drag(id, 'w', -66, 0);
    near(r.after.w, r.before.w + 66, SNAP, 'wider from the left');
    near(r.after.x, r.before.x - 66, SNAP, 'the left edge moved');
    assert.equal(r.after.size, r.before.size);
    r = await drag(id, 'se', 200, 200);
    assert.ok(r.after.size > r.before.size, 'a corner makes the letters bigger');
    await k.page(`undo(); return 0;`);
  });

  test('Text position places the text at the top, middle or bottom of a taller box', async () => {
    const th = await textHeight(id);
    const r = await drag(id, 's', 0, 220);
    const boxH = r.after.h, top = (await painted(id))[0];
    assert.ok(boxH > th + 150);
    assert.equal(await k.page(`state.selection = new Set([${JSON.stringify(id)}]); syncPanel();
      return String(!document.getElementById('rowValign').classList.contains('hidden')
        && document.querySelector('#valignSeg button.sel').dataset.v)`), 'top', 'the panel offers Text position and shows Top');
    await k.page(`document.querySelector('#valignSeg button[data-v="bottom"]').click(); return 0;`);
    near((await painted(id))[0], top + (boxH - th), 0.6, 'bottom: the text sits on the bottom edge');
    await k.page(`document.querySelector('#valignSeg button[data-v="middle"]').click(); return 0;`);
    near((await painted(id))[0], top + (boxH - th) / 2, 0.6, 'middle: centred in the box');
    // the SVG export and the text editor put the text in the same place
    const where = JSON.parse(await k.page(`
      const el = state.elements.find(e => e.id === ${JSON.stringify(id)});
      const svg = renderSceneSVG([el], { pal: pal(), board: state.board, transparent: true });
      const ys = [...svg.matchAll(/<text[^>]* y="([-\\d.]+)"/g)].map(m => Number(m[1]));
      // the editor's selection is painted on the canvas: its first band starts where the first line does
      openTextEditor(el, false);
      const band = textSelectionRects(el, 0, el.text.length)[0];
      const rc = editorEl.getBoundingClientRect(), [, bandTop] = toScreen(band.x, band.y), [, bandBottom] = toScreen(band.x, band.y + band.h);
      const covers = rc.top <= bandTop && rc.bottom >= bandBottom;
      commitTextEdit();
      return JSON.stringify({ svgFirst: ys[0], middle: el.y + (el.h - ${th}) / 2 + elLH(el) / 2, edOffset: band.y - el.y, want: (el.h - ${th}) / 2, covers });`));
    near(where.svgFirst, where.middle, 0.6, 'SVG export');
    near(where.edOffset, where.want, 1, 'the editor shows its selection over the text');
    assert.equal(where.covers, true, 'and the typing layer covers that line, so a click on it reaches the editor');
    await k.page(`document.querySelector('#valignSeg button[data-v="top"]').click(); return 0;`);
    near((await painted(id))[0], top, 0.6, 'top again');
  });

  test('measure checks the copy against the box, and Claude reads the box height', async () => {
    const el = ok(await k.tool('koralpaper_read_document', { documentId: docId })).pages[0].elements.find(e => e.id === id);
    assert.ok(el.maxHeight > 0, 'the dragged height is reported as maxHeight');
    near(el.h, el.maxHeight, 0.5, 'h is the height of the box');
    let m = ok(await k.tool('koralpaper_measure', { documentId: docId, elementIds: [id] })).elements[0];
    assert.equal(m.overflow, false, JSON.stringify(m.reasons));
    near(m.availableHeight, el.maxHeight, 0.5, 'available height is the box');
    ok(await k.tool('koralpaper_update_elements', { documentId: docId, updates: [{ id, text: 'Five myths about AI at work. '.repeat(8) }] }));
    m = ok(await k.tool('koralpaper_measure', { documentId: docId, elementIds: [id] })).elements[0];
    assert.equal(m.overflow, true, 'too much copy for the box is reported');
    ok(await k.tool('koralpaper_update_elements', { documentId: docId, updates: [{ id, text: 'Five myths about AI at work' }] }));
  });

  test('Fit height to text gives the box back to its text, and undo brings the height back', async () => {
    const th = await textHeight(id);
    const res = JSON.parse(await k.page(`
      const get = () => state.elements.find(e => e.id === ${JSON.stringify(id)});
      state.selection = new Set([get().id]);
      const before = get().h;
      fitTextHeight(get());
      const fitted = { h: get().h, maxH: get().maxH || null };
      undo();
      return JSON.stringify({ before, fitted, undone: get().h });`));
    near(res.fitted.h, th, 0.5, 'fitted to the text');
    assert.equal(res.fitted.maxH, null);
    near(res.undone, res.before, 0.5, 'undo restores the box height');
  });

  test('a plain, unwrapped text gets a box height the same way and keeps its width', async () => {
    const r = await drag(plainId, 's', 0, 110);
    near(r.after.h, r.before.h + 110, SNAP, 'taller');
    assert.deepEqual([r.after.w, r.after.size, r.after.wrap], [r.before.w, r.before.size, false]);
    const up = await drag(plainId, 'n', 0, -88);
    near(up.after.y + up.after.h, up.before.y + up.before.h, 0.5, 'bottom edge fixed');
    assert.ok(up.after.h > up.before.h + 60);
  });

  test('a corner drag scales the box height together with the type', async () => {
    const r = await drag(plainId, 'se', 150, 150);
    const s = r.after.size / r.before.size;
    assert.ok(s > 1.2);
    near(r.after.maxH, r.before.maxH * s, r.before.maxH * 0.06, 'the box height scaled with the letters');
  });

  test('texts from before this change look exactly the same', async () => {
    const res = JSON.parse(await k.page(`
      const el = newElement('text', 100, 100, { font: 'intertight', size: 40, valign: 'middle' });
      el.text = 'old text'; autosizeText(el);
      const plain = { h: el.h, top: textBlockTop(el, layoutText(el, null).totalH) };
      // a height Claude set in an earlier version, on a text that was created with the old default position
      el.maxH = 300; autosizeText(el);
      return JSON.stringify({ plain, y: el.y, lh: elLH(el) });`));
    assert.equal(res.plain.h, res.lh, 'no box height: the box is the text');
    assert.equal(res.plain.top, res.y, 'and the text starts at the top');
  });

  test('a page with a tall text box exports, with the text where the editor shows it', async () => {
    await k.page(`const el = state.elements.find(e => e.id === ${JSON.stringify(id)}); el.valign = 'bottom'; commit(); return 0;`);
    const first = (await painted(id))[0];
    const r = ok(await k.tool('koralpaper_export', { documentId: docId, format: 'pdf', scale: 1, folder: 'Handles' }));
    const body = require('fs').readFileSync(r.paths[0]).toString('latin1');
    const run = [...body.matchAll(/([-\d.]+) ([-\d.]+) Tm <([0-9A-F]+)> Tj/g)]
      .map(m => ({ y: +m[2], text: Buffer.from(m[3], 'hex').swap16().toString('utf16le') })).find(t => t.text.startsWith('Five myths'));
    near(1350 - run.y, first, 0.6, 'the selectable text in the PDF follows the text position');
  });
});
