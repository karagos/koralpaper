/* The acceptance walk-through, as a script you can run and read:
     node mcp/test/verify.js [folder-to-copy-the-exports-into]
   It builds a 3-page 1080x1350 document, changes a page in the app, shows the
   write with the old version being refused, exports a PDF and PNGs, and
   measures an overflowing text box. Same isolated setup as the tests.

   © 2026 Stefanos Karagos, CAIO Group · wearecaio.com · MIT */
'use strict';
const fs = require('fs');
const path = require('path');
const { start } = require('./harness');

(async () => {
  const k = await start();
  const say = (label, r) => console.log(`\n── ${label}\n${r.isError ? 'REFUSED / ERROR: ' : ''}${r.text.length > 900 ? r.text.slice(0, 900) + ' …' : r.text}`);
  let failed = 0;
  const check = (what, cond) => { console.log(`${cond ? '  PASS' : '  FAIL'}  ${what}`); if (!cond) failed++; };
  try {
    say('status', await k.tool('koralpaper_status'));

    const doc = await k.tool('koralpaper_create_document', { name: 'Verify carousel', board: { w: 1080, h: 1350, safeArea: 80 } });
    say('create_document', doc);
    const documentId = doc.json.documentId;

    const LONG = 'This paragraph is much too long for the small box it has been given, so it must overflow.';
    const made = await k.tool('koralpaper_create_page', { documentId, pages: [
      { name: 'Cover', paper: '#111111', elements: [
        { id: 'title', type: 'text', x: 80, y: 420, w: 920, wrap: true, text: 'Five myths about AI at work', font: 'Inter Tight', weight: 800, size: 110, lineHeight: 1.05, textColor: '#FFFFFF' },
        { id: 'kicker', type: 'text', x: 80, y: 340, text: 'CAIO EDGE', font: 'JetBrains Mono', weight: 500, size: 26, textColor: '#E4572E' }] },
      { name: 'Myth 1', paper: '#F7F3EA', elements: [
        { id: 'h', type: 'text', x: 80, y: 160, w: 920, wrap: true, text: 'Myth 1: AI replaces whole jobs', font: 'Inter Tight', weight: 700, size: 76, lineHeight: 1.1 },
        { id: 'box', type: 'rect', x: 80, y: 520, w: 420, h: 150, text: LONG, font: 'Gelasio', size: 34, sketch: 0, fill: '#FFFFFF' }] },
      { name: 'Close', paper: '#F7F3EA', elements: [
        { id: 'h', type: 'text', x: 80, y: 500, w: 920, wrap: true, text: 'Start with one workflow.', font: 'Gelasio', italic: true, size: 84, lineHeight: 1.1 }] },
    ] });
    say('create_page (3 pages in one call)', made);
    const pages = made.json.pages;
    check('3 pages created', pages.length === 3);

    const read1 = await k.tool('koralpaper_read_document', { documentId });
    const v = read1.json.pages[1].version;
    console.log(`\n── read_document: page versions ${read1.json.pages.map(p => `${p.name}=v${p.version}`).join(', ')}`);
    check('every page has a version', read1.json.pages.every(p => p.version > 0));
    check('artboard is 1080x1350', read1.json.board.w === 1080 && read1.json.board.h === 1350);

    console.log('\n── the user drags the headline on page 2 in the app');
    await k.page(`switchPage(1); const el = state.elements[0]; el.y += 60; commit(); requestRender();`);

    const refused = await k.tool('koralpaper_update_elements', { documentId, pageId: pages[1].pageId, ifVersion: v, updates: [{ id: pages[1].ids.h, text: 'OVERWRITTEN' }] });
    say(`update_elements with the OLD ifVersion ${v}`, refused);
    check('the write was refused', refused.isError && /Refused, nothing was written/.test(refused.text));
    const read2 = await k.tool('koralpaper_read_document', { documentId, pageId: pages[1].pageId });
    const head = read2.json.pages[1].elements[0];
    check('the page is untouched: text kept, the user\'s move kept', head.text === 'Myth 1: AI replaces whole jobs' && head.y === 220);
    const changes = await k.tool('koralpaper_get_changes', { documentId, sinceVersion: read1.json.version });
    say('get_changes since the first read', changes);
    check('get_changes shows the one element the user moved', changes.json.changed.length === 1 && changes.json.changed[0].id === pages[1].ids.h);
    const retry = await k.tool('koralpaper_update_elements', { documentId, pageId: pages[1].pageId, ifVersion: read2.json.pages[1].version, updates: [{ id: pages[1].ids.h, text: 'Myth 1: AI replaces whole jobs. It does not.' }] });
    say(`update_elements with the NEW ifVersion ${read2.json.pages[1].version}`, retry);
    check('the retry with the fresh version went through', !retry.isError);

    const m = await k.tool('koralpaper_measure', { documentId, elementIds: [pages[1].ids.box, pages[0].ids.title] });
    say('measure (an overflowing box, and the cover title)', m);
    const box = m.json.elements[0], title = m.json.elements[1];
    check('the small box overflows', box.overflow === true && box.textHeight > box.availableHeight);
    check('its line breaks are reported', box.lines.length > 1 && box.lines.join(' ') === LONG);
    check('the cover title does not overflow and used the real font', title.overflow === false && title.fontLoaded === true);

    const pdf = await k.tool('koralpaper_export', { documentId, pageIds: 'all', format: 'pdf', scale: 2, folder: 'Carousels/Verify', filenamePrefix: 'verify' });
    say('export pdf', pdf);
    const png = await k.tool('koralpaper_export', { documentId, pageIds: 'all', format: 'png', scale: 1, folder: 'Carousels/Verify', filenamePrefix: 'verify' });
    say('export png', png);
    const pdfBytes = fs.readFileSync(pdf.json.paths[0]);
    check('one PDF with 3 pages', pdf.json.paths.length === 1 && /\/Count 3/.test(pdfBytes.toString('latin1')));
    check('3 PNGs at 1080x1350', png.json.paths.length === 3 && png.json.paths.every(p => { const b = fs.readFileSync(p); return b.readUInt32BE(16) === 1080 && b.readUInt32BE(20) === 1350; }));
    check('all files are inside the Documents folder', [...pdf.json.paths, ...png.json.paths].every(p => fs.realpathSync(p).startsWith(fs.realpathSync(k.docsDir))));

    const out = process.argv[2];
    if (out){
      fs.mkdirSync(out, { recursive: true });
      for (const p of [...pdf.json.paths, ...png.json.paths]) fs.copyFileSync(p, path.join(out, path.basename(p)));
      console.log('\nexports copied to ' + out);
    }
    console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
  } finally { await k.stop(); }
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
