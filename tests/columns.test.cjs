const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../ui/columns.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');

function harness(saved = null) {
  const values = {}, writes = [], listeners = {};
  const classes = new Set();
  const track = { style: {} };
  const classList = { add: (...keys) => keys.forEach((k) => classes.add(k)), remove: (...keys) => keys.forEach((k) => classes.delete(k)), toggle: (k, enabled) => enabled ? classes.add(k) : classes.delete(k) };
  const dhead = { addEventListener: (name, fn) => { listeners[name] = fn; }, querySelectorAll: () => [], querySelector: () => track };
  const els = {
    content: { classList, style: { setProperty: (key, value) => { values[key] = value; } } },
    dhead, scroller: { clientWidth: 900, scrollLeft: 0, scrollTop: 0, addEventListener: () => {} },
  };
  const state = { viewMode: 'details', sortKey: 'name', sortDir: 1, view: [], path: 'C:\\Docs' };
  let renders = 0;
  const context = vm.createContext({
    store: { get: () => saved, set: (key, value) => writes.push([key, structuredClone(value)]) },
    state, els, document: { body: { classList } },
    locale: 'zh', esc: (value) => String(value), Date,
    fmtDate: (value) => `date:${value}`, fmtSize: (value) => `${value} B`,
    folderSizeLabel: (entry) => entry.dirSize == null ? '…' : `${entry.dirSize} B`,
    typeLabel: (entry) => entry.isDir ? '文件夹' : entry.ext || '文件',
    join: (base, name) => base + '\\' + name, fileIcon: () => '<svg></svg>',
    renderList: () => { renders++; }, renderAll: () => { renders++; },
  });
  vm.runInContext(source, context);
  return { context, els, state, values, writes, listeners, classes, track, get renders() { return renders; }, run: (code) => vm.runInContext(code, context) };
}

test('stored layout is normalized without duplicated or unknown columns and invalid widths', () => {
  const h = harness({ order: ['size', 'size', 'wrong', 'name'], widths: { name: -1, date: Infinity, type: 9000, size: '150' } });
  assert.deepEqual(JSON.parse(h.run('JSON.stringify(columnLayout)')), {
    order: ['size', 'name', 'date', 'type', 'created', 'accessed', 'extension', 'attributes', 'path'],
    widths: { name: 160, date: 160, type: 500, size: 100, created: 160, accessed: 160, extension: 100, attributes: 170, path: 300 },
    visible: ['name', 'date', 'type', 'size'],
  });
});

test('narrow viewports keep all four columns and expose a shared horizontal width', () => {
  const h = harness();
  h.els.scroller.clientWidth = 300;
  h.run('syncColumnLayout()');
  assert.equal(h.values['--columns-template'], '160px 160px 120px 100px');
  assert.equal(h.values['--columns-width'], '540px');
  assert.ok(h.classes.has('adjustable-columns'));
  h.els.scroller.scrollLeft = 170;
  h.run('syncColumnScroll()');
  assert.equal(h.track.style.transform, 'translateX(-170px)');
  h.state.viewMode = 'grid';
  h.run('syncColumnLayout()');
  assert.equal(h.els.scroller.scrollLeft, 0);
  assert.equal(h.classes.has('adjustable-columns'), false);
});

test('reordering preserves all columns and maps headings and row cells to the same positions', () => {
  const h = harness();
  h.run("columnLayout.order = moveColumn(columnLayout.order, 'size', 'name', false); syncColumnLayout()");
  assert.deepEqual([...h.run('visibleColumns()')], ['size', 'name', 'date', 'type']);
  assert.equal(h.values['--column-size-order'], '0');
  assert.equal(h.values['--column-name-order'], '1');
  const html = h.run("renderColumnHeaders([['name','名称'],['date','修改日期'],['type','类型'],['size','大小']])");
  assert.ok(html.indexOf('data-k="size"') < html.indexOf('data-k="name"'));
  assert.equal((html.match(/role="separator"/g) || []).length, 4);
  assert.ok(html.includes('aria-sort="ascending"'));
  assert.deepEqual([...h.run("moveColumn(columnLayout.order, 'size', 'type', true)")], ['name', 'date', 'type', 'size', 'created', 'accessed', 'extension', 'attributes', 'path']);
});

test('resizing a non-name column fixes the name width so the dragged edge moves correctly', () => {
  const h = harness();
  const before = h.run('columnGeometry(columnLayout, 900)');
  h.run("setColumnWidth('date', 220)");
  const after = h.run('columnGeometry(columnLayout, 900)');
  assert.equal(after.widths.name, before.widths.name);
  assert.equal(after.widths.date, 220);
  assert.equal(after.total - before.total, 60);
  h.run("setColumnWidth('date', -200)");
  assert.equal(h.run('columnLayout.widths.date'), 135);
});

test('pointer resize persists once and cancellation restores flexible defaults', () => {
  const h = harness();
  h.run('initColumns()');
  const handle = { dataset: { resize: 'date' }, setPointerCapture() {}, hasPointerCapture: () => false };
  const target = { closest: () => handle };
  h.listeners.pointerdown({ target, button: 0, clientX: 100, pointerId: 2, preventDefault() {}, stopPropagation() {} });
  h.listeners.pointermove({ clientX: 150, pointerId: 2 });
  assert.equal(h.run('columnLayout.widths.date'), 210);
  assert.equal(h.writes.length, 0);
  h.listeners.pointercancel({ pointerId: 2 });
  assert.equal(h.run('columnLayout.widths.name'), null);
  assert.equal(h.run('columnLayout.widths.date'), 160);
  h.listeners.pointerdown({ target, button: 0, clientX: 100, pointerId: 3, preventDefault() {}, stopPropagation() {} });
  h.listeners.pointermove({ clientX: 180, pointerId: 3 });
  h.listeners.pointerup({ pointerId: 3 });
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0][0], 'columns.v1');
  assert.equal(h.writes[0][1].widths.date, 240);
  assert.equal(h.classes.has('resizing-column'), false);
});

test('resize handles never toggle sorting but ordinary header clicks still do', () => {
  const h = harness();
  const start = app.indexOf("els.dhead.addEventListener('click'");
  const end = app.indexOf("els.crumbs.addEventListener('click'", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(app.slice(start, end), h.context);
  h.listeners.click({ target: { closest: (selector) => selector === '[data-resize]' ? {} : { dataset: { k: 'date' } } } });
  assert.equal(h.state.sortKey, 'name');
  h.listeners.click({ target: { closest: (selector) => selector === '[data-resize]' ? null : { dataset: { k: 'date' } } } });
  assert.equal(h.state.sortKey, 'date');
  assert.equal(h.state.sortDir, 1);
  assert.equal(h.renders, 1);
});

test('visibility migrates old layouts, requires name, and persists optional column choices', () => {
  const old = harness({ order: ['type', 'name', 'size', 'date'], widths: { type: 180 } });
  assert.deepEqual([...old.run('visibleColumns()')], ['type', 'name', 'size', 'date']);
  old.run("columnLayout = normalizeColumns({ ...columnLayout, visible: ['created', 'path', 'created', 'invalid'] }); saveColumns()");
  assert.deepEqual([...old.run('visibleColumns()')], ['name', 'created', 'path']);
  const reopened = harness(old.writes[0][1]);
  assert.deepEqual([...reopened.run('visibleColumns()')], ['name', 'created', 'path']);
  assert.equal(reopened.run('columnLayout.widths.type'), 180);
  reopened.run('columnLayout = normalizeColumns({ visible: [] })');
  assert.deepEqual([...reopened.run('visibleColumns()')], ['name']);
});

test('hidden columns use no width and cells follow the same visible order as headings', () => {
  const h = harness({ order: ['created', 'name', 'size'], visible: ['name', 'created'], widths: { name: 200, type: 500 } });
  h.run('syncColumnLayout()');
  assert.equal(h.values['--columns-template'], '160px 200px');
  assert.equal(h.values['--columns-width'], '360px');
  const headings = h.run('renderColumnHeaders([])');
  assert.equal((headings.match(/role="columnheader"/g) || []).length, 2);
  assert.ok(headings.indexOf('data-k="created"') < headings.indexOf('data-k="name"'));
  const cells = h.run("renderColumnCells({ name: 'report.docx', ext: 'docx', ctime: 500 })");
  assert.ok(cells.indexOf('ccreated') < cells.indexOf('cname'));
  assert.ok(cells.includes('date:500'));
  assert.ok(!cells.includes('csize'));
});

test('metadata values expose dates, extension, full path and localized system flags without IO', () => {
  const h = harness();
  h.run("var entry = { name: '报告.docx', ext: 'docx', size: 512, ctime: 100, atime: 200, attributes: 0x803, readOnly: true }");
  assert.equal(h.run("columnValue(entry, 'created')"), 'date:100');
  assert.equal(h.run("columnValue(entry, 'accessed')"), 'date:200');
  assert.equal(h.run("columnValue(entry, 'extension')"), '.docx');
  assert.equal(h.run("columnValue(entry, 'path')"), 'C:\\Docs\\报告.docx');
  assert.equal(h.run("columnValue(entry, 'attributes')"), '只读 · 隐藏 · 压缩');
  assert.equal(h.run("columnValue({ isDir: true }, 'extension')"), '—');
  assert.equal(h.run("columnValue({}, 'created')"), '—');
  h.run("locale = 'en'");
  assert.equal(h.run('fileAttributeLabel(entry)'), 'Read-only · Hidden · Compressed');
});

test('new metadata sort keys keep folders first and compare underlying values', () => {
  const h = harness();
  h.context.matchesFileType = () => true;
  const start = app.indexOf('let collator = null;');
  const end = app.indexOf('/* ============================== rendering', start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(app.slice(start, end), h.context);
  h.state.selection = new Set();
  h.state.showHidden = true;
  h.state.entries = [
    { name: 'z.txt', ext: 'txt', ctime: 1, atime: 30, isDir: false },
    { name: 'a.pdf', ext: 'pdf', ctime: 20, atime: 10, isDir: false },
    { name: 'folder', ext: '', ctime: 50, atime: 60, isDir: true },
  ];
  for (const [key, expected] of [
    ['created', ['folder', 'z.txt', 'a.pdf']], ['accessed', ['folder', 'a.pdf', 'z.txt']], ['extension', ['folder', 'a.pdf', 'z.txt']],
  ]) {
    h.state.sortKey = key;
    h.run('rebuildView()');
    assert.deepEqual(Array.from(h.state.view, (entry) => entry.name), expected);
  }
});

test('background size batches update an open properties dialog only for its matching folder', () => {
  const h = harness(), frames = [];
  const sizeCell = { textContent: 'calculatingSize' };
  const dialog = { open: true, dataset: { propertyPath: 'c:\\docs\\folder' }, querySelector: () => sizeCell };
  h.context.document.getElementById = () => dialog;
  Object.assign(h.context, {
    curTab: () => ({}), isTermTab: () => false, canMeasureDirectory: () => true,
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    cacheDirectorySize: () => {}, renderStatus: () => {}, renderPreview: () => {}, t: (key) => key,
  });
  h.els.rows = { querySelectorAll: () => [] };
  const entry = { name: 'folder', isDir: true, dirSize: null };
  Object.assign(h.state, { gen: 7, selection: new Set(), sizeEntries: new Map([['c:\\docs\\folder', entry]]) });
  const start = app.indexOf('let pendingDirSizes = new Map();');
  const end = app.indexOf('function scheduleSizeSort()', start);
  vm.runInContext(app.slice(start, end), h.context);
  h.context.sizePathKey = (path) => path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  h.run("queueDirSize(7, 'C:\\\\Docs\\\\folder', 2048)");
  frames.shift()();
  assert.equal(sizeCell.textContent, '2048 B (2,048 字节)');
  const other = { name: 'folder', isDir: true, dirSize: 99 };
  h.state.sizeEntries = new Map([['c:\\other\\folder', other]]);
  h.run("queueDirSize(7, 'C:\\\\other\\\\folder', 50)");
  frames.shift()();
  assert.equal(sizeCell.textContent, '2048 B (2,048 字节)', 'same name in another directory cannot replace displayed properties');
  h.state.sizeEntries = new Map([['c:\\docs\\folder', entry]]);
  dialog.open = false;
  h.run("queueDirSize(7, 'C:\\\\Docs\\\\folder', 4096)");
  frames.shift()();
  assert.equal(sizeCell.textContent, '2048 B (2,048 字节)', 'closed dialogs are ignored');
  dialog.open = true;
  entry.dirSize = null;
  h.run("queueDirSize(7, 'C:\\\\Docs\\\\folder', null)");
  frames.shift()();
  assert.equal(sizeCell.textContent, 'sizeUnavailable', 'failed measurement replaces the calculating label');
});
