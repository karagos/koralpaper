/* Regression tests around the new document model: old saves, reloads, the
   app's own New / Open / Documents, undo, two Claude apps at once, an older
   app, the tool catalogue, and running straight from disk.
   Run from the repo root:   node --test mcp/test/*.test.js

   © 2026 Stefanos Karagos, CAIO Group · wearecaio.com · MIT */
'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { start, spawnServer, freePort, sleep, ROOT } = require('./harness');

const BOARD = { w: 1080, h: 1350 };
const ok = r => { assert.equal(r.isError, false, 'tool reported an error: ' + r.text); return r.json; };

describe('the app around the new document model', () => {
  let k;
  before(async () => { k = await start(); });
  after(async () => { if (k) await k.stop(); });
  const read = async (documentId, pageId) => ok(await k.tool('koralpaper_read_document', { documentId, pageId }));

  test('a document saved by the previous version opens intact and gets an identity', async () => {
    const old = { v: 6, appVersion: '3.83.7', pageIndex: 1, images: {}, camera: { x: 0, y: 0, z: 1 }, grid: 'grid', gridSize: 22, snap: true,
      theme: 'light', bgColor: null, board: { name: 'LinkedIn', w: 1080, h: 1350, x: 0, y: 0 },
      pages: [{ id: 'oldp1', name: 'First', elements: [{ id: 'olde1', type: 'rect', x: 10, y: 20, w: 190, h: 92, angle: 0, seed: 1, stroke: 'ink', fill: 'cream', fillStyle: 'solid', dash: 'solid', sw: 3.3, sketch: 1, round: 1, opacity: 100, fillOpacity: 100, text: 'from 3.83', font: 'sans', size: 21, align: 'center', lh: 1.3, pgap: 0, lspace: 0, valign: 'middle', groupId: null }] },
        { id: 'oldp2', name: 'Second', bg: '#112233', elements: [] }] };
    await k.page(`localStorage.setItem('asterisk.sketch.v1', ${JSON.stringify(JSON.stringify(old))}); localStorage.setItem('asterisk.docname', 'My old deck');
      window.onbeforeunload = null; clearTimeout(autosaveTimer); writeAutosave = () => true;`);
    await k.reload();
    const doc = await read();
    assert.match(doc.documentId, /^doc_/);
    assert.equal(doc.name, 'My old deck');
    assert.deepEqual(doc.pages.map(p => [p.id, p.name]), [['oldp1', 'First'], ['oldp2', 'Second']]);
    assert.equal(doc.pages[0].elements[0].text, 'from 3.83');
    assert.equal(doc.pages[1].paper, '#112233');
    assert.equal(doc.pages[1].current, true);
    assert.deepEqual({ w: doc.board.w, h: doc.board.h }, BOARD);
    assert.ok(doc.pages.every(p => p.version > 0));
    assert.doesNotMatch(await k.page(`return document.getElementById('hint').textContent`), /could not be read/);
  });

  test('identity, versions and the library survive a reload', async () => {
    const first = (await read()).documentId;
    const made = ok(await k.tool('koralpaper_create_document', { name: 'Survivor', board: BOARD }));
    ok(await k.tool('koralpaper_create_page', { documentId: made.documentId, name: 'P', elements: [{ type: 'text', x: 80, y: 80, text: 'still here', font: 'Gelasio' }] }));
    const before = await read();
    await k.page(`flushAutosave(); await librarySaveCurrent(true);`);
    await k.reload();
    const after = await read();
    assert.equal(after.documentId, made.documentId);
    assert.equal(after.pages[0].elements[0].text, 'still here');
    assert.equal(after.pages[0].version, before.pages[0].version, 'a reload is not a change');
    assert.equal(after.version, before.version);
    const list = ok(await k.tool('koralpaper_list_documents')).documents;
    assert.ok(list.some(d => d.id === first && d.name === 'My old deck'), 'the earlier document is in the library');
    ok(await k.tool('koralpaper_open_document', { id: first }));
    assert.equal((await read()).pages[0].elements[0].text, 'from 3.83');
    ok(await k.tool('koralpaper_open_document', { id: made.documentId }));
  });

  test('panning and zooming do not count as a change', async () => {
    const before = await read();
    await k.page(`state.camera.x += 120; state.camera.z = 0.7; scheduleAutosave(); flushAutosave(); zoomToFit();`);
    const after = await read();
    assert.equal(after.version, before.version);
    assert.equal(after.pages[0].version, before.pages[0].version);
  });

  test('one Cmd+Z in the app takes back one Claude step', async () => {
    const doc = await read();
    const r = ok(await k.tool('koralpaper_add_elements', { elements: [{ type: 'rect', x: 400, y: 400, text: 'oops' }] }));
    assert.equal(r.elements, 2);
    await k.page(`undo();`);
    assert.deepEqual((await read()).pages[0].elements.map(e => e.text), ['still here']);
    await k.page(`redo();`);
    assert.equal((await read()).pages[0].elements.length, 2);
    assert.equal((await read()).documentId, doc.documentId);
  });

  test('New document in the app keeps the old one in Documents', async () => {
    const old = await read();
    await k.page(`window.confirm = () => true; newDocument();`);
    const fresh = await read();
    assert.notEqual(fresh.documentId, old.documentId);
    assert.equal(fresh.pages.length, 1);
    assert.equal(fresh.pages[0].elements.length, 0);
    await sleep(300);
    const list = ok(await k.tool('koralpaper_list_documents')).documents;
    const kept = list.find(d => d.id === old.documentId);
    assert.ok(kept, 'the previous document is listed');
    assert.equal(kept.name, 'Survivor');
    assert.equal((await read(old.documentId)).pages[0].elements.length, 2);
  });

  test('the Documents dialog lists every document and opens one with a click', async () => {
    const here = (await read()).documentId;
    const rows = JSON.parse(await k.page(`openDocsDialog(); await new Promise(r => setTimeout(r, 400));
      return JSON.stringify([...document.querySelectorAll('#docsList .tplrow')].map(r => r.querySelector('b').textContent))`));
    assert.ok(rows.some(t => /open now/.test(t)));
    assert.ok(rows.some(t => t === 'My old deck'));
    await k.page(`const row = [...document.querySelectorAll('#docsList .tplrow')].find(r => r.querySelector('b').textContent === 'My old deck');
      [...row.querySelectorAll('button')].find(b => b.textContent === 'Open').click(); await new Promise(r => setTimeout(r, 500));`);
    const now = await read();
    assert.notEqual(now.documentId, here);
    assert.equal(now.name, 'My old deck');
    assert.equal(await k.page(`return document.getElementById('docsDialog').classList.contains('hidden')`), true);
  });

  test('opening a .json file makes it its own document and brings its comments along', async () => {
    const before = await read();
    const file = { app: 'koralpaper', version: 6, pageIndex: 0, images: {},
      pages: [{ id: 'fp1', name: 'From a file', elements: [{ id: 'fe1', type: 'text', x: 5, y: 5, w: 50, h: 27, angle: 0, seed: 2, stroke: 'ink', fill: 'none', fillStyle: 'solid', dash: 'solid', sw: 3.3, sketch: 1, round: 1, opacity: 100, fillOpacity: 100, text: 'filed', font: 'sans', size: 21, align: 'left', lh: 1.3, pgap: 0, lspace: 0, valign: 'middle', groupId: null }] }],
      meta: { id: before.documentId, name: 'ignored', comments: [{ id: 'c_file', elementId: 'fe1', pageId: 'fp1', text: 'note in the file', author: 'user', at: '2026-01-01T00:00:00.000Z', resolved: false, replies: [] }],
        styles: { text: {}, colors: { accent: '#ABCDEF' } } } };
    await k.page(`const dt = new DataTransfer();
      dt.items.add(new File([${JSON.stringify(JSON.stringify(file))}], 'client deck.json', { type: 'application/json' }));
      fileInput.files = dt.files; fileInput.dispatchEvent(new Event('change')); await new Promise(r => setTimeout(r, 600));`);
    const now = await read();
    assert.notEqual(now.documentId, before.documentId, 'a file never takes over a library document\'s id');
    assert.equal(now.name, 'client deck');
    assert.equal(now.pages[0].elements[0].text, 'filed');
    assert.equal(now.styles.colors.accent, '#ABCDEF');
    assert.equal(ok(await k.tool('koralpaper_list_comments')).comments[0].text, 'note in the file');
    await sleep(300);
    assert.equal((await read(before.documentId)).pages[0].elements[0].text, 'from 3.83', 'the document that was open is safe in the library');
  });

  test('a second Claude app shares the same bridge and can do everything, exports included', async () => {
    const second = await spawnServer(k.serverEnv);          // same port: it becomes a proxy to the first
    try {
      const st = await second.tool('koralpaper_status');
      assert.match(st.text, /open and linked/);
      const d = ok(await second.tool('koralpaper_create_document', { name: 'Via proxy', board: BOARD }));
      ok(await second.tool('koralpaper_create_page', { documentId: d.documentId, name: 'P', elements: [{ type: 'rect', x: 80, y: 80, text: 'proxy' }] }));
      assert.equal((await read(d.documentId)).pages[0].elements[0].text, 'proxy');
      const ex = ok(await second.tool('koralpaper_export', { documentId: d.documentId, format: 'pdf', folder: 'proxy' }));
      assert.equal(fs.readFileSync(ex.paths[0]).subarray(0, 5).toString('latin1'), '%PDF-');
      const refused = await second.tool('koralpaper_add_elements', { documentId: d.documentId, ifVersion: 1, elements: [{ type: 'rect' }] });
      assert.equal(refused.isError, true);
      assert.match(refused.text, /Refused, nothing was written/);
    } finally { second.kill(); }
  });

  test('screenshots of the editor: safe-area guide, footer, comment badge, dialogs', async () => {
    const dir = process.env.KORALPAPER_SHOTS;
    const d = ok(await k.tool('koralpaper_create_document', { name: 'Shots', board: { w: 1080, h: 1350, safeArea: 80 } }));
    ok(await k.tool('koralpaper_set_styles', { documentId: d.documentId, colors: { ink: '#111111', accent: '#E4572E' }, textStyles: { headline: { font: 'Inter Tight', weight: 800, size: 96, lineHeight: 1.05, color: '$ink' } } }));
    const p = ok(await k.tool('koralpaper_create_page', { documentId: d.documentId, name: 'Cover', paper: '#F7F3EA', elements: [
      { id: 'h', type: 'text', x: 80, y: 300, w: 920, wrap: true, text: 'Five myths about AI at work', style: 'headline' },
      { id: 's', type: 'text', x: 80, y: 640, w: 800, wrap: true, text: 'What the numbers really say, in Gelasio italic.', font: 'Gelasio', italic: true, size: 44 },
      { id: 'b', type: 'rect', x: 80, y: 820, w: 300, h: 16, fill: '$accent', stroke: 'none', sketch: 0 }] }));
    ok(await k.tool('koralpaper_set_master', { documentId: d.documentId, elements: [
      { type: 'text', x: 80, y: 1240, text: 'CAIO Group · wearecaio.com', font: 'JetBrains Mono', size: 22 },
      { type: 'text', x: 700, y: 1240, w: 300, wrap: true, align: 'right', text: '{page} / {pages}', font: 'JetBrains Mono', size: 22 }] }));
    await k.page(`window.prompt = () => 'Can this be two lines?'; commentAddFor(byId(${JSON.stringify(p.ids.h)})); zoomToFit(); render();`);
    const info = JSON.parse(await k.page(`return JSON.stringify({ hint: document.getElementById('hint').textContent,
      footer: state.elements.filter(e => e.master).map(e => e.text) })`));
    assert.deepEqual(info.footer, ['CAIO Group · wearecaio.com', '01 / 01']);
    if (dir){
      fs.mkdirSync(dir, { recursive: true });
      await k.page(`document.querySelectorAll('.welcome, #welcome').forEach(n => n.classList.add('hidden')); render();`);
      await k.shot(path.join(dir, 'editor.png'));
      await k.page(`openCommentsDialog();`);
      await k.shot(path.join(dir, 'comments.png'));
      await k.page(`document.getElementById('commentsDialog').classList.add('hidden'); openDocsDialog(); await new Promise(r => setTimeout(r, 400));`);
      await k.shot(path.join(dir, 'documents.png'));
      const ex = ok(await k.tool('koralpaper_export', { documentId: d.documentId, format: 'png', folder: 'shots', filenamePrefix: 'cover' }));
      fs.copyFileSync(ex.paths[0], path.join(dir, 'export-cover.png'));
    }
  });
});

describe('straight from disk (file://)', () => {
  let k;
  before(async () => { k = await start({ file: true }); });
  after(async () => { if (k) await k.stop(); });

  test('the app links, the bundled fonts load, and a carousel exports', async () => {
    assert.equal(await k.page(`return location.protocol`), 'file:');
    const loaded = JSON.parse(await k.page(`
      const out = [];
      for (const css of ['800 40px "Inter Tight"', 'italic 400 40px "Gelasio"', '500 40px "JetBrains Mono"']){
        const got = await document.fonts.load(css);
        out.push(got.length > 0 && got.every(f => f.status === 'loaded'));
      }
      return JSON.stringify(out);`));
    assert.deepEqual(loaded, [true, true, true]);
    const d = ok(await k.tool('koralpaper_create_document', { name: 'From disk', board: BOARD }));
    const p = ok(await k.tool('koralpaper_create_page', { documentId: d.documentId, name: 'One', elements: [{ id: 't', type: 'text', x: 80, y: 80, text: 'Offline type', font: 'Inter Tight', weight: 800, size: 90 }] }));
    const m = ok(await k.tool('koralpaper_measure', { documentId: d.documentId, elementIds: [p.ids.t] })).elements[0];
    assert.equal(m.fontLoaded, true);
    const ex = ok(await k.tool('koralpaper_export', { documentId: d.documentId, format: 'png' }));
    assert.equal(fs.readFileSync(ex.paths[0]).readUInt32BE(16), 1080);
    const list = ok(await k.tool('koralpaper_list_documents')).documents;
    assert.ok(list.some(x => x.id === d.documentId && x.open));
  });
});

describe('the connector on its own', () => {
  test('with no app open, status says so in plain words', async () => {
    const port = await freePort();
    const s = await spawnServer({ KORALPAPER_PORT: String(port) });
    try {
      const st = await s.tool('koralpaper_status');
      assert.match(st.text, /KoralPaper is not linked/);
    } finally { s.kill(); }
  });

  test('an older app is recognised and the new tools say what to do', async () => {
    const port = await freePort();
    const s = await spawnServer({ KORALPAPER_PORT: String(port) });
    // a stand-in for a KoralPaper page from before this release: it only knows the old commands
    let alive = true;
    const call = (method, urlPath, body) => new Promise((res, rej) => {
      const rq = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers: { 'X-Koralpaper': '1' } }, r => {
        let d = ''; r.on('data', c => { d += c; }); r.on('end', () => res(d));
      });
      rq.on('error', rej); rq.end(body);
    });
    (async () => {
      while (alive){
        try {
          const cmds = JSON.parse(await call('GET', '/poll'));
          for (const c of cmds){
            const result = c.action === 'read_document' ? { board: null, pages: [{ name: 'Page 1', current: true, elements: [] }] } : { error: 'Unknown action: ' + c.action };
            await call('POST', '/result', JSON.stringify({ id: c.id, result }));
          }
        } catch (e){ await sleep(100); }
      }
    })();
    try {
      await sleep(300);
      const st = await s.tool('koralpaper_status');
      assert.match(st.text, /older version/);
      assert.match(st.text, /reload the KoralPaper tab/i);
      const old = await s.tool('koralpaper_read_document');
      assert.equal(old.isError, false, 'the old commands keep working');
      const nw = await s.tool('koralpaper_create_document', { name: 'x' });
      assert.equal(nw.isError, true);
      assert.match(nw.text, /older version/);
      const ex = await s.tool('koralpaper_export', { format: 'png' });
      assert.equal(ex.isError, true);
      assert.match(ex.text, /older version/);
    } finally { alive = false; s.kill(); }
  });

  test('every tool documents itself: a description, a schema, and one example that fits the schema', async () => {
    const port = await freePort();
    const s = await spawnServer({ KORALPAPER_PORT: String(port) });
    try {
      const tools = (await s.rpc('tools/list')).result.tools;
      assert.equal(tools.length, 21);
      for (const t of tools){
        assert.match(t.name, /^koralpaper_[a-z_]+$/);
        assert.ok(t.description.length > 60, t.name + ' has a real description');
        assert.equal(t.inputSchema.type, 'object');
        assert.equal(typeof t.annotations.readOnlyHint, 'boolean');
        const at = t.description.lastIndexOf(' Example: ');
        assert.ok(at > 0, t.name + ' has an example');
        assert.equal(t.description.split(' Example: ').length, 2, t.name + ' has exactly one example');
        const example = JSON.parse(t.description.slice(at + 10));
        const props = t.inputSchema.properties || {};
        for (const key of Object.keys(example)) assert.ok(key in props, `${t.name}: example uses "${key}", which is in the schema`);
        for (const req of t.inputSchema.required || []) assert.ok(req in example, `${t.name}: example gives the required "${req}"`);
      }
      const doc = ['read_document', 'create_page', 'add_elements', 'update_elements', 'delete_elements', 'render_page'];
      for (const n of doc){
        const p = tools.find(t => t.name === 'koralpaper_' + n).inputSchema.properties;
        assert.ok(p.documentId, n + ' takes documentId');
        if (n !== 'create_page') assert.ok(p.pageId, n + ' takes pageId');
      }
      for (const n of ['create_page', 'add_elements', 'update_elements', 'delete_elements'])
        assert.ok(tools.find(t => t.name === 'koralpaper_' + n).inputSchema.properties.ifVersion, n + ' takes ifVersion');
    } finally { s.kill(); }
  });

  test('versions, the manifest and the installable bundle agree', () => {
    const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
    const server = rd('mcp/server.js'), manifest = JSON.parse(rd('mcp/manifest.json'));
    const sv = server.match(/SERVER_VERSION = '([\d.]+)'/)[1];
    assert.equal(manifest.version, sv);
    const names = [...server.matchAll(/name: '(koralpaper_[a-z_]+)'/g)].map(m => m[1]);
    assert.deepEqual(manifest.tools.map(t => t.name), names);
    const av = rd('js/core.js').match(/APP_VERSION = '([\d.]+)'/)[1];
    assert.ok(rd('sw.js').includes(`koralpaper-v${av}`), 'the offline cache carries the app version');
    assert.ok(rd('CHANGELOG.md').includes(`## v${av}`), 'the changelog has this version');
    assert.ok(rd('README.md').includes(`Version-${av}-`));
    for (const f of fs.readdirSync(path.join(ROOT, 'fonts')).filter(n => n.endsWith('.woff2')))
      assert.ok(rd('sw.js').includes(`./fonts/${f}`), f + ' is cached for offline use');
    const bundle = path.join(ROOT, 'mcp', 'koralpaper.mcpb');
    const inZip = n => execFileSync('unzip', ['-p', bundle, n], { maxBuffer: 1 << 26 }).toString('utf8');
    assert.equal(inZip('server.js'), server, 'the bundle holds this server.js');
    assert.equal(inZip('manifest.json'), rd('mcp/manifest.json'), 'the bundle holds this manifest');
  });
});
