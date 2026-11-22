/* Tests for the "Should" and "Nice" features of the KoralPaper MCP server:
   comments, changes, selection, snapshots, named styles, the master page,
   locks, SVG import, batch pages and the safe-area guide.
   Run from the repo root:   node --test mcp/test/*.test.js

   © 2026 Stefanos Karagos, CAIO Group · wearecaio.com · MIT */
'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { start } = require('./harness');

let k;
before(async () => { k = await start(); });
after(async () => { if (k) await k.stop(); });

const BOARD = { w: 1080, h: 1350 };
const ok = r => { assert.equal(r.isError, false, 'tool reported an error: ' + r.text); return r.json; };
const read = async (documentId, pageId) => ok(await k.tool('koralpaper_read_document', { documentId, pageId }));

describe('6. comments', () => {
  let docId, ids, commentId;
  test('a comment the user pins to an element is listed with its element and page', async () => {
    docId = ok(await k.tool('koralpaper_create_document', { name: 'Comments', board: BOARD })).documentId;
    ids = ok(await k.tool('koralpaper_create_page', { documentId: docId, name: 'Cover', elements: [{ id: 'h', type: 'text', x: 80, y: 80, text: 'A very long headline', size: 60 }] })).ids;
    // the user right-clicks the headline and chooses Add comment
    await k.page(`window.prompt = () => 'Make this shorter please';
      commentAddFor(state.elements.find(e => e.id === ${JSON.stringify(ids.h)}));`);
    const r = ok(await k.tool('koralpaper_list_comments', { documentId: docId }));
    assert.equal(r.open, 1);
    const c = r.comments[0];
    commentId = c.id;
    assert.equal(c.text, 'Make this shorter please');
    assert.equal(c.author, 'user');
    assert.equal(c.elementId, ids.h);
    assert.equal(c.element.text, 'A very long headline');
    assert.equal(c.page, 'Cover');
    assert.equal(c.resolved, false);
    assert.equal((await read(docId)).openComments, 1);
  });
  test('Claude replies and marks it resolved; the user sees both in the app', async () => {
    const r = ok(await k.tool('koralpaper_reply_comment', { id: commentId, text: 'Cut it to three words.', resolve: true }));
    assert.equal(r.comment.resolved, true);
    assert.equal(r.comment.replies[0].author, 'claude');
    assert.equal(ok(await k.tool('koralpaper_list_comments', { documentId: docId })).comments.length, 0);
    const all = ok(await k.tool('koralpaper_list_comments', { documentId: docId, includeResolved: true }));
    assert.equal(all.resolved, 1);
    assert.equal(all.comments[0].replies[0].text, 'Cut it to three words.');
    const shown = await k.page(`openCommentsDialog(); document.getElementById('commentsShowDone').checked = true; buildCommentsList();
      return document.getElementById('commentsList').textContent;`);
    assert.match(shown, /Make this shorter please/);
    assert.match(shown, /Cut it to three words\./);
    assert.match(shown, /resolved/);
  });
  test('resolve:false reopens, and a missing comment or empty reply is refused', async () => {
    assert.equal(ok(await k.tool('koralpaper_reply_comment', { id: commentId, resolve: false })).comment.resolved, false);
    assert.equal((await k.tool('koralpaper_reply_comment', { id: 'c_nope', text: 'x' })).isError, true);
    assert.equal((await k.tool('koralpaper_reply_comment', { id: commentId })).isError, true);
  });
  test('comments survive a reload of the app', async () => {
    await k.page(`flushAutosave(); return true;`);
    const saved = JSON.parse(await k.page(`return localStorage.getItem('asterisk.sketch.v1')`));
    assert.equal(saved.meta.comments[0].text, 'Make this shorter please');
    assert.equal(saved.meta.id, docId);
  });
});

describe('7. changes and 8. selection', () => {
  let docId, pageId, ids, v;
  test('get_changes lists what was added, changed and removed since a version', async () => {
    docId = ok(await k.tool('koralpaper_create_document', { name: 'Changes', board: BOARD })).documentId;
    const made = ok(await k.tool('koralpaper_create_page', { documentId: docId, name: 'P', elements: [
      { id: 'a', type: 'rect', x: 0, y: 0, text: 'A' }, { id: 'b', type: 'rect', x: 300, y: 0, text: 'B' }, { id: 'c', type: 'rect', x: 600, y: 0, text: 'C' }] }));
    pageId = made.pageId; ids = made.ids; v = made.documentVersion;
    const none = ok(await k.tool('koralpaper_get_changes', { documentId: docId, sinceVersion: v }));
    assert.deepEqual([none.added.length, none.changed.length, none.removed.length], [0, 0, 0]);
    // the user moves A, deletes B and draws a new shape; Claude changes nothing
    await k.page(`const a = byId(${JSON.stringify(ids.a)}); a.x = 40; commit();
      state.selection = new Set([${JSON.stringify(ids.b)}]); deleteSelection();
      const n = newElement('ellipse', 100, 500, {}); n.w = 100; n.h = 100; n.text = 'New'; state.elements.push(n); commit();`);
    const ch = ok(await k.tool('koralpaper_get_changes', { documentId: docId, sinceVersion: v }));
    assert.deepEqual(ch.changed.map(e => e.id), [ids.a]);
    assert.equal(ch.changed[0].x, 40);
    assert.deepEqual(ch.added.map(e => e.text), ['New']);
    assert.deepEqual(ch.removed.map(e => e.id), [ids.b]);
    assert.equal(ch.added[0].pageId, pageId);
    assert.ok(ch.version > v);
    assert.deepEqual(ch.pagesChanged.map(p => p.id), [pageId]);
    // from the new version on, nothing is pending
    const again = ok(await k.tool('koralpaper_get_changes', { documentId: docId, sinceVersion: ch.version }));
    assert.deepEqual([again.added.length, again.changed.length, again.removed.length], [0, 0, 0]);
  });
  test('get_selection returns what the user has selected', async () => {
    await k.page(`setSelection(new Set([${JSON.stringify(ids.a)}, ${JSON.stringify(ids.c)}]));`);
    const s = ok(await k.tool('koralpaper_get_selection'));
    assert.deepEqual(s.ids.sort(), [ids.a, ids.c].sort());
    assert.equal(s.pageId, pageId);
    assert.equal(s.documentId, docId);
    assert.equal(s.elements.length, 2);
    await k.page(`setSelection(new Set());`);
    assert.deepEqual(ok(await k.tool('koralpaper_get_selection')).ids, []);
  });
});

describe('9. snapshots', () => {
  let docId, snapId, ids;
  test('snapshot then restore puts the whole document back', async () => {
    docId = ok(await k.tool('koralpaper_create_document', { name: 'Snaps', board: BOARD })).documentId;
    const made = ok(await k.tool('koralpaper_create_page', { documentId: docId, pages: [
      { name: 'One', elements: [{ id: 't', type: 'text', x: 80, y: 80, text: 'Original' }] },
      { name: 'Two', elements: [{ id: 't', type: 'text', x: 80, y: 80, text: 'Second' }] }] }));
    ids = made.pages[0].ids;
    const snap = ok(await k.tool('koralpaper_snapshot', { documentId: docId, name: 'Before the restyle' }));
    snapId = snap.snapshotId;
    assert.equal(snap.pages, 2);
    ok(await k.tool('koralpaper_update_elements', { documentId: docId, pageId: made.pages[0].pageId, updates: [{ id: ids.t, text: 'Ruined' }] }));
    ok(await k.tool('koralpaper_create_page', { documentId: docId, name: 'Three', elements: [{ type: 'rect' }] }));
    const before = await read(docId);
    assert.equal(before.pages.length, 3);
    const r = ok(await k.tool('koralpaper_restore', { snapshotId: snapId }));
    assert.equal(r.documentId, docId);
    const after = await read(docId);
    assert.deepEqual(after.pages.map(p => p.name), ['One', 'Two']);
    assert.equal(after.pages[0].elements[0].text, 'Original');
    assert.ok(after.version > before.version, 'versions move forward on restore');
    assert.ok(after.pages[0].version > before.pages[0].version);
  });
  test('snapshots are listed with their document, and restore finds its document even when another is open', async () => {
    const other = ok(await k.tool('koralpaper_create_document', { name: 'Elsewhere' })).documentId;
    const list = ok(await k.tool('koralpaper_list_documents')).documents;
    assert.equal(list.find(d => d.id === docId).snapshots[0].snapshotId, snapId);
    assert.equal(list.find(d => d.id === docId).snapshots[0].name, 'Before the restyle');
    const r = ok(await k.tool('koralpaper_restore', { snapshotId: snapId }));
    assert.equal(r.documentId, docId);
    assert.equal((await read()).documentId, docId);
    assert.ok(ok(await k.tool('koralpaper_list_documents')).documents.some(d => d.id === other));
    assert.equal((await k.tool('koralpaper_restore', { snapshotId: 'snap_nope' })).isError, true);
  });
});

describe('10. named styles and the master page', () => {
  let docId, pages;
  test('elements take a text style and colour tokens by name', async () => {
    docId = ok(await k.tool('koralpaper_create_document', { name: 'Styled', board: BOARD })).documentId;
    const st = ok(await k.tool('koralpaper_set_styles', { documentId: docId,
      colors: { ink: '#111111', accent: '#E4572E' },
      textStyles: { headline: { font: 'Inter Tight', weight: 800, size: 88, lineHeight: 1.05, color: '$ink' }, label: { font: 'JetBrains Mono', weight: 500, size: 22, color: '$accent' } } }));
    assert.equal(st.styles.colors.accent, '#E4572E');
    const made = ok(await k.tool('koralpaper_create_page', { documentId: docId, pages: [1, 2, 3].map(n => ({ name: 'Page ' + n, elements: [
      { id: 'h', type: 'text', x: 80, y: 120, text: 'Headline ' + n, style: 'headline' },
      { id: 'l', type: 'text', x: 80, y: 60, text: 'LABEL', style: 'label' },
      { id: 'box', type: 'rect', x: 80, y: 400, w: 300, h: 200, fill: '$accent', stroke: '$ink', sketch: 0 },
      { id: 'own', type: 'text', x: 80, y: 700, text: 'bigger', style: 'headline', size: 120 }] })) }));
    pages = made.pages;
    const p1 = (await read(docId)).pages[0].elements;
    const h = p1.find(e => e.text === 'Headline 1');
    assert.deepEqual([h.style, h.font, h.weight, h.size, h.textColor], ['headline', 'Inter Tight', 800, 88, '$ink']);
    assert.deepEqual([p1.find(e => e.type === 'rect').fill, p1.find(e => e.type === 'rect').stroke], ['$accent', '$ink']);
    assert.equal(p1.find(e => e.text === 'bigger').size, 120, 'a value set on the element wins over the style');
    const raw = JSON.parse(await k.page(`return JSON.stringify(state.pages[0].elements.map(e => [e.fill, e.textColor, e.lh]))`));
    assert.equal(raw.find(r => r[0] === '#E4572E')[0], '#E4572E', 'the token is stored resolved, so every renderer draws it');
  });
  test('changing a style or token restyles every element that uses it, on every page', async () => {
    ok(await k.tool('koralpaper_set_styles', { documentId: docId, colors: { accent: '#0055FF' }, textStyles: { headline: { font: 'Gelasio', weight: 700, size: 72, color: '$accent' } } }));
    const doc = await read(docId);
    for (const p of doc.pages){
      const h = p.elements.find(e => e.text.startsWith('Headline'));
      assert.deepEqual([h.font, h.weight, h.size, h.textColor], ['Gelasio', 700, 72, '$accent']);
    }
    const fills = JSON.parse(await k.page(`return JSON.stringify(state.pages.map(p => p.elements.find(e => e.type === 'rect').fill))`));
    assert.deepEqual(fills, ['#0055FF', '#0055FF', '#0055FF']);
    assert.equal(doc.styles.text.label.font, 'JetBrains Mono', 'styles that were not sent are left alone');
  });
  test('unknown names are reported; null deletes', async () => {
    const r = ok(await k.tool('koralpaper_add_elements', { documentId: docId, pageId: pages[0].pageId, elements: [{ type: 'text', x: 0, y: 0, text: 'x', style: 'nope', textColor: '$nope' }] }));
    assert.match(r.warnings.join(' '), /Unknown text style "nope"/);
    assert.match(r.warnings.join(' '), /Unknown colour token "\$nope"/);
    const d = ok(await k.tool('koralpaper_set_styles', { documentId: docId, textStyles: { label: null } }));
    assert.equal(d.styles.text.label, undefined);
  });
  test('the master page puts a footer with an automatic page number on every page', async () => {
    const before = (await read(docId)).pages.map(p => p.version);
    const m = ok(await k.tool('koralpaper_set_master', { documentId: docId, elements: [
      { type: 'text', x: 80, y: 1262, text: 'CAIO Group', font: 'JetBrains Mono', size: 20 },
      { type: 'text', x: 900, y: 1262, text: '{page} / {pages}', align: 'right', font: 'JetBrains Mono', size: 20 }] }));
    assert.equal(m.master.onPages, 3);
    const numbers = async () => JSON.parse(await k.page(`return JSON.stringify(state.pages.map(p => p.elements.filter(e => e.master).map(e => e.text)))`));
    assert.deepEqual(await numbers(), [['CAIO Group', '01 / 03'], ['CAIO Group', '02 / 03'], ['CAIO Group', '03 / 03']]);
    const doc = await read(docId);
    assert.equal(doc.master.elements[1].text, '{page} / {pages}');
    assert.equal(doc.pages[0].elements.some(e => /\/ 03/.test(e.text || '')), false, 'master copies are not listed as page elements');
    assert.deepEqual(doc.pages.map(p => p.version), before, 'adding a footer does not make the pages look edited');
    const locked = JSON.parse(await k.page(`return JSON.stringify(state.pages[0].elements.filter(e => e.master).map(e => e.locked))`));
    assert.deepEqual(locked, [true, true]);
    // right-aligned numbers share one right edge
    const rights = JSON.parse(await k.page(`return JSON.stringify(state.pages.map(p => { const e = p.elements.find(x => x.master && /\\//.test(x.text)); return Math.round(e.x + e.w); }))`));
    assert.equal(new Set(rights).size, 1);
    // x is where the number starts on page 1, so it sits where it was put, inside the board
    const first = JSON.parse(await k.page(`const e = state.pages[0].elements.find(x => x.master && /\\//.test(x.text)); return JSON.stringify([Math.round(e.x), Math.round(e.x + e.w)])`));
    assert.equal(first[0], 900);
    assert.ok(first[1] < 1080, 'the page number is not pushed off the artboard');
    // the exact way: a box with wrap and align right puts the right edge at x + w
    ok(await k.tool('koralpaper_set_master', { documentId: docId, elements: [
      { type: 'text', x: 80, y: 1262, text: 'CAIO Group', font: 'JetBrains Mono', size: 20 },
      { type: 'text', x: 700, y: 1262, w: 300, wrap: true, align: 'right', text: '{page} / {pages}', font: 'JetBrains Mono', size: 20 }] }));
    const boxes = JSON.parse(await k.page(`return JSON.stringify(state.pages.map(p => { const e = p.elements.find(x => x.master && /\\//.test(x.text)); return [e.x, e.w, e.text]; }))`));
    assert.deepEqual(boxes, [[700, 300, '01 / 03'], [700, 300, '02 / 03'], [700, 300, '03 / 03']]);
  });
  test('page numbers follow when pages are added, removed or reordered, and other pages keep their versions', async () => {
    const before = (await read(docId)).pages.map(p => p.version);
    ok(await k.tool('koralpaper_create_page', { documentId: docId, pages: Array.from({ length: 7 }, (_, i) => ({ name: 'Extra ' + i, elements: [{ type: 'rect', x: 80, y: 80 }] })) }));
    const texts = JSON.parse(await k.page(`return JSON.stringify(state.pages.map(p => p.elements.find(e => e.master && /\\//.test(e.text)).text))`));
    assert.equal(texts.length, 10);
    assert.equal(texts[2], '03 / 10');
    assert.equal(texts[9], '10 / 10');
    assert.deepEqual((await read(docId)).pages.slice(0, 3).map(p => p.version), before);
    // the user deletes the last page and moves page 1 to the end
    await k.page(`state.pages.pop(); state.pageIndex = 0; state.elements = state.pages[0].elements;
      state.pages.push(state.pages.shift()); state.elements = state.pages[0].elements; commit(); buildPageStrip();`);
    const after = JSON.parse(await k.page(`return JSON.stringify(state.pages.map(p => p.elements.find(e => e.master && /\\//.test(e.text)).text))`));
    assert.equal(after.length, 9);
    assert.deepEqual([after[0], after[8]], ['01 / 09', '09 / 09']);
  });
  test('the footer is in exports; skipPageIds hides it on a page; an empty list removes it', async () => {
    const doc = await read(docId);
    ok(await k.tool('koralpaper_set_master', { documentId: docId, skipPageIds: [doc.pages[0].id], elements: [{ type: 'text', x: 900, y: 1262, text: '{n}/{N}', align: 'right', size: 20 }] }));
    const texts = JSON.parse(await k.page(`return JSON.stringify(state.pages.map(p => p.elements.filter(e => e.master).map(e => e.text)))`));
    assert.deepEqual(texts[0], []);
    assert.deepEqual(texts[1], ['2/9']);
    ok(await k.tool('koralpaper_set_master', { documentId: docId, elements: [] }));
    assert.equal(await k.page(`return state.pages.some(p => p.elements.some(e => e.master))`), false);
    assert.equal((await read(docId)).master, undefined);
  });
});

describe('11. locked', () => {
  let docId, ids;
  test('locked:true on create, readable, and honoured by the app', async () => {
    docId = ok(await k.tool('koralpaper_create_document', { name: 'Locks', board: BOARD })).documentId;
    ids = ok(await k.tool('koralpaper_create_page', { documentId: docId, name: 'P', elements: [
      { id: 'logo', type: 'rect', x: 80, y: 80, text: 'LOGO', locked: true }, { id: 'free', type: 'rect', x: 400, y: 80, text: 'free' },
      { id: 'ln', type: 'line', x: 0, y: 300, x2: 400, y2: 300, locked: true }, { id: 'tx', type: 'text', x: 80, y: 400, text: 'locked text', locked: true }] })).ids;
    const els = (await read(docId)).pages[0].elements;
    assert.equal(els.find(e => e.text === 'LOGO').locked, true);
    assert.equal(els.find(e => e.text === 'free').locked, undefined);
    assert.equal(els.find(e => e.type === 'line').locked, true);
    assert.equal(els.find(e => e.text === 'locked text').locked, true);
    // in the app a locked element ignores clicks; the user can unlock it
    const hit = await k.page(`const e = byId(${JSON.stringify(ids.logo)}); const t = topElementAt(e.x + 20, e.y + 20, false); return t ? t.id : null;`);
    assert.notEqual(hit, ids.logo);
  });
  test('updates and deletes skip locked elements and say so', async () => {
    const u = ok(await k.tool('koralpaper_update_elements', { documentId: docId, updates: [{ id: ids.logo, text: 'CHANGED' }, { id: ids.free, text: 'changed' }] }));
    assert.equal(u.updated, 1);
    assert.deepEqual(u.skippedLocked, [ids.logo]);
    const only = await k.tool('koralpaper_update_elements', { documentId: docId, updates: [{ id: ids.logo, text: 'CHANGED' }] });
    assert.equal(only.isError, true);
    assert.match(only.text, /locked/);
    const d = await k.tool('koralpaper_delete_elements', { documentId: docId, ids: [ids.logo] });
    assert.equal(d.isError, true);
    const els = (await read(docId)).pages[0].elements;
    assert.equal(els.find(e => e.id === ids.logo).text, 'LOGO');
  });
  test('locked:false in the same update unlocks and changes; the user can unlock in the app too', async () => {
    const u = ok(await k.tool('koralpaper_update_elements', { documentId: docId, updates: [{ id: ids.logo, locked: false, text: 'NEW LOGO' }] }));
    assert.equal(u.updated, 1);
    const el = (await read(docId)).pages[0].elements.find(e => e.id === ids.logo);
    assert.deepEqual([el.text, el.locked], ['NEW LOGO', undefined]);
    await k.page(`state.selection = new Set([${JSON.stringify(ids.tx)}]); toggleLockSelection(false);`);
    assert.equal((await read(docId)).pages[0].elements.find(e => e.id === ids.tx).locked, undefined);
    assert.equal(ok(await k.tool('koralpaper_update_elements', { documentId: docId, updates: [{ id: ids.free, locked: true }] })).updated, 1);
  });
});

describe('12. SVG import', () => {
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1350">
    <script>window.__pwned = true</script>
    <rect width="1080" height="1350" fill="#111111"/>
    <rect x="80" y="900" width="400" height="200" rx="16" fill="#E4572E" onclick="window.__pwned = true"/>
    <circle cx="800" cy="1000" r="100" fill="none" stroke="#FFFFFF" stroke-width="6"/>
    <line x1="80" y1="1200" x2="1000" y2="1200" stroke="#FFFFFF" stroke-width="4"/>
    <text x="80" y="300" font-family="Inter Tight" font-size="96" font-weight="800" fill="#FFFFFF">Hello world</text>
    <text x="80" y="420" font-family="Gelasio, serif" font-size="40" font-style="italic" fill="#E4572E">A serif line</text>
    <text x="1000" y="560" text-anchor="end" font-family="JetBrains Mono" font-size="28" fill="#AAAAAA">right aligned</text>
    <g transform="translate(100 600) scale(2)"><text x="0" y="0" font-family="Inter Tight" font-size="20" fill="#00FF00">Scaled</text></g>
    <path d="M 600 100 L 900 100 L 750 300 Z" fill="#3355FF"/>
  </svg>`;
  let docId, r, els;
  test('text stays text with its font, size, weight and colour', async () => {
    docId = ok(await k.tool('koralpaper_create_document', { name: 'From SVG', board: BOARD })).documentId;
    r = ok(await k.tool('koralpaper_import_svg', { documentId: docId, svg: SVG, pageName: 'Imported' }));
    assert.equal(r.page, 'Imported');
    assert.equal(r.texts, 4);
    els = r.elements;
    const hello = els.find(e => e.text === 'Hello world');
    assert.deepEqual([hello.type, hello.font, hello.size, hello.weight, hello.stroke], ['text', 'Inter Tight', 96, 800, '#FFFFFF']);
    const serif = els.find(e => e.text === 'A serif line');
    assert.deepEqual([serif.font, serif.size, serif.italic, serif.stroke], ['Gelasio', 40, true, '#E4572E']);
    const right = els.find(e => e.text === 'right aligned');
    assert.deepEqual([right.font, right.align], ['JetBrains Mono', 'right']);
    assert.ok(Math.abs(right.x + right.w - 1000) < 3, 'right-anchored text keeps its right edge');
    const scaled = els.find(e => e.text === 'Scaled');
    assert.equal(scaled.size, 40, 'a scale transform is applied to the size');
    assert.ok(Math.abs(scaled.x - 100) < 3);
  });
  test('text lands where the SVG drew it', async () => {
    const hello = els.find(e => e.text === 'Hello world');
    assert.ok(Math.abs(hello.x - 80) < 8, 'left edge near x=80, got ' + hello.x);
    const baseline = hello.y + hello.h / 2 + 96 * 0.35;          // approximate baseline of a line centred in its box
    assert.ok(Math.abs(baseline - 300) < 24, 'baseline near y=300, got ' + baseline);
  });
  test('shapes become shapes, the background becomes the paper, and the rest stays as one picture', async () => {
    const doc = await read(docId);
    assert.equal(doc.pages.length, 1, 'the import used the blank first page');
    assert.equal(doc.pages[0].paper, '#111111');
    const box = els.find(e => e.type === 'rect');
    assert.deepEqual([box.x, box.y, box.w, box.h, box.fill], [80, 900, 400, 200, '#E4572E']);
    const circle = els.find(e => e.type === 'ellipse');
    assert.deepEqual([circle.x, circle.y, circle.w, circle.h, circle.stroke], [700, 900, 200, 200, '#FFFFFF']);
    assert.ok(els.find(e => e.type === 'line'));
    assert.equal(els.filter(e => e.type === 'image').length, 1);
    assert.match(r.warnings.join(' '), /could not become editable elements/);
    assert.equal(els[0].type, 'image', 'the leftover picture sits behind the editable elements');
  });
  test('scripts and event handlers never run or survive', async () => {
    assert.equal(await k.page(`return window.__pwned === true`), false);
    const src = await k.page(`const im = state.elements.find(e => e.type === 'image'); return atob(im._src.split(',')[1]);`);
    assert.equal(/script|onclick/i.test(src), false);
    assert.match(src, /<path/);
  });
  test('the imported text is editable like any other, and the page renders', async () => {
    const hello = els.find(e => e.text === 'Hello world');
    ok(await k.tool('koralpaper_update_elements', { documentId: docId, updates: [{ id: hello.id, text: 'Hello again' }] }));
    assert.ok((await read(docId)).pages[0].elements.some(e => e.text === 'Hello again' && e.weight === 800));
    assert.ok((await k.tool('koralpaper_render_page', { documentId: docId })).image);
  });
  test('rubbish is refused', async () => {
    assert.equal((await k.tool('koralpaper_import_svg', { documentId: docId, svg: 'not svg at all' })).isError, true);
    assert.equal((await k.tool('koralpaper_import_svg', { documentId: docId, svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' })).isError, true);
  });
});

describe('13. batch pages and 14. safe area', () => {
  let docId;
  test('create_page makes several pages in one call, in order, each with its own ids', async () => {
    docId = ok(await k.tool('koralpaper_create_document', { name: 'Batch', board: { w: 1080, h: 1350, safeArea: 80 } })).documentId;
    const made = ok(await k.tool('koralpaper_create_page', { documentId: docId, pages: ['A', 'B', 'C', 'D'].map(n => ({ name: n, paper: '#FFFFFF', elements: [
      { id: 'box', type: 'rect', x: 100, y: 100, text: n }, { id: 'to', type: 'rect', x: 500, y: 100 }, { type: 'arrow', from: 'box', to: 'to' }] })) }));
    assert.deepEqual(made.pages.map(p => p.name), ['A', 'B', 'C', 'D']);
    assert.equal(new Set(made.pages.map(p => p.ids.box)).size, 4);
    const doc = await read(docId);
    assert.deepEqual(doc.pages.map(p => p.name), ['A', 'B', 'C', 'D']);
    for (const p of doc.pages){
      assert.equal(p.elements.length, 3);
      const arrow = p.elements.find(e => e.type === 'arrow');
      assert.ok(p.elements.some(e => e.id === arrow.from) && p.elements.some(e => e.id === arrow.to), 'arrows bind within their own page');
    }
    // one undo in the app takes the whole batch back
    await k.page(`undo();`);
    assert.equal((await read(docId)).pages.length, 1);
    await k.page(`redo();`);
    assert.equal((await read(docId)).pages.length, 4);
  });
  test('a page without elements in the batch is refused and nothing is created', async () => {
    const r = await k.tool('koralpaper_create_page', { documentId: docId, pages: [{ name: 'ok', elements: [{ type: 'rect' }] }, { name: 'bad' }] });
    assert.equal(r.isError, true);
    assert.equal((await read(docId)).pages.length, 4);
  });
  test('the safe-area guide is stored on the board, reported by measure, and never exported', async () => {
    const doc = await read(docId);
    assert.equal(doc.board.safeArea, 80);
    const ids = ok(await k.tool('koralpaper_add_elements', { documentId: docId, pageId: doc.pages[0].id, elements: [
      { id: 'in', type: 'text', x: 100, y: 600, text: 'inside' }, { id: 'out', type: 'text', x: 20, y: 700, text: 'too close to the edge' }] })).ids;
    const m = ok(await k.tool('koralpaper_measure', { documentId: docId, elementIds: [ids.in, ids.out] })).elements;
    assert.deepEqual(m.map(e => e.outsideSafeArea), [false, true]);
    assert.equal(m[1].overflow, false, 'outside the safe area is a warning, not an overflow');
    // the editor draws it: the overlay asks the canvas for a dashed rectangle at the inset
    const drawn = JSON.parse(await k.page(`
      const calls = [];
      const fake = new Proxy({}, { get: (t, p) => p === 'strokeRect' ? (...a) => calls.push(a) : (typeof p === 'string' ? (() => {}) : undefined), set: () => true });
      drawBridgeOverlay(fake, 1);
      return JSON.stringify(calls);`));
    assert.deepEqual(drawn, [[80, 80, 920, 1190]]);
    // a page with an empty white paper exports as pure white: no guide, no grid
    ok(await k.tool('koralpaper_create_page', { documentId: docId, name: 'Blank white', paper: '#FFFFFF', elements: [{ type: 'rect', x: 500, y: 600, w: 10, h: 10, fill: '#FFFFFF', stroke: 'none', sketch: 0 }] }));
    const last = (await read(docId)).pages.at(-1);
    const ex = ok(await k.tool('koralpaper_export', { documentId: docId, pageIds: [last.id], format: 'png', folder: 'safe', filenamePrefix: 'blank' }));
    const whites = await k.page(`
      const bytes = Uint8Array.from(atob(${JSON.stringify(fs.readFileSync(ex.paths[0]).toString('base64'))}), c => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let other = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] !== 255 || d[i + 1] !== 255 || d[i + 2] !== 255) other++;
      return other;`);
    assert.equal(whites, 0, 'no guide or grid pixels in the export');
  });
  test('create_page can set the safe area on an existing document', async () => {
    const d2 = ok(await k.tool('koralpaper_create_document', { name: 'Late guide' })).documentId;
    ok(await k.tool('koralpaper_create_page', { documentId: d2, name: 'P', board: { w: 1080, h: 1080, safeArea: 60 }, elements: [{ type: 'rect' }] }));
    assert.deepEqual((await read(d2)).board, { w: 1080, h: 1080, name: 'Custom', safeArea: 60 });
  });
});
