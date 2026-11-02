const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const section = source.slice(source.indexOf('async function navigate('), source.indexOf('function goBack('));
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { resolve, promise };
};
const folder = (name, size = null, extra = {}) => ({ name, isDir: true, dirSize: size, size: 0, ...extra });

function harness(handler = async () => undefined) {
  const tab = { path: 'C:\\work', history: [], hIdx: -1 };
  const state = {
    navToken: 0, gen: 1, path: tab.path, tabs: [tab], tab: 0,
    entries: [], view: [], roots: {}, selection: new Set(), dirSizes: new Map(),
    loading: false, sortKey: 'name', viewMode: 'details',
  };
  const calls = [], frames = [], snapshots = [], cells = [];
  let rowVisits = 0;
  const noop = () => {};
  const context = vm.createContext({
    state, Set, Map,
    invoke: async (cmd, args) => { calls.push({ cmd, args }); return handler(cmd, args); },
    els: {
      search: { value: '' }, scroller: { scrollTop: 0 },
      rows: { querySelectorAll() { rowVisits++; return cells.map((cell, i) => ({ dataset: { i }, querySelector: () => cell })); } },
    },
    curTab: () => state.tabs[state.tab], isTermTab: (t) => t?.kind === 'term',
    renderAll: () => {
      state.view = state.entries || [];
      if (!state.loading) snapshots.push((state.entries || []).map((e) => ({ name: e.name, dirSize: e.dirSize })));
    },
    renderStatus: noop, renderPreview: noop, rebuildView: noop, renderList: noop,
    addRecent: noop, toast: noop, store: { set: noop },
    join: (a, b) => `${a}\\${b}`, fmtSize: (n) => `${n} B`, t: (key) => key,
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    setTimeout: () => 1, clearTimeout: noop,
  });
  vm.runInContext(section + '\nfunction renderDirectoryRefresh() { renderAll(); }', context);
  return {
    state, context, calls, frames, snapshots, cells,
    get rowVisits() { return rowVisits; },
    run: (s) => vm.runInContext(s, context),
    prepare(raw) {
      context.raw = raw;
      vm.runInContext('state.entries = prepareEntries(raw, state.path); state.view = state.entries;', context);
    },
  };
}

test('listing renders indexed sizes immediately without lookup or repeat scan', async () => {
  const h = harness(async (cmd) => cmd === 'list_dir' ? [folder('indexed', 8192)] : undefined);
  await h.run("navigate('C:\\\\work')");
  assert.equal(h.snapshots[0][0].dirSize, 8192);
  assert.equal(h.calls.some((c) => c.cmd === 'sizes_lookup'), false);
  assert.equal(h.calls.some((c) => c.cmd === 'dir_sizes' && c.args.paths.length), false);
  assert.equal(h.calls.some((c) => c.cmd === 'dir_sizes' && !c.args.paths.length), true);
});

test('memory cache fills the first render; backend values take precedence', async () => {
  const h = harness(async (cmd) => cmd === 'list_dir' ? [folder('cached'), folder('fresh', 200)] : undefined);
  h.run("cacheDirectorySize('C:\\\\work\\\\cached', 100); cacheDirectorySize('C:\\\\work\\\\fresh', 50)");
  await h.run("navigate('C:\\\\work')");
  assert.deepEqual(h.snapshots[0].map((e) => e.dirSize), [100, 200]);
});

test('only missing ordinary directories are measured and unknown labels are honest', async () => {
  const h = harness();
  h.prepare([folder('known', 1), folder('missing'), folder('link', null, { isReparse: true }), { name: 'file', isDir: false, size: 1 }]);
  await h.run('requestDirSizes()');
  const request = h.calls.find((c) => c.cmd === 'dir_sizes');
  assert.deepEqual([...request.args.paths], ['C:\\work\\missing']);
  assert.equal(h.run('folderSizeLabel(state.entries[1])'), 'calculatingSize');
  assert.equal(h.run('folderSizeLabel(state.entries[2])'), '—');
  h.state.path = '\\\\server\\share';
  assert.equal(h.run('folderSizeLabel(state.entries[1])'), '—');
});

test('hard refresh keeps old numbers visible and requests a forced background scan', async () => {
  const h = harness(async (cmd) => cmd === 'list_dir' ? [folder('cached')] : undefined);
  h.prepare([folder('cached', 4096)]);
  await h.run('refresh(true, true)');
  assert.equal(h.state.entries[0].dirSize, 4096);
  assert.equal(h.snapshots.length, 0, 'unchanged numbers need no redraw while the forced scan runs');
  const forced = h.calls.find((c) => c.cmd === 'dir_sizes' && c.args.force);
  assert.deepEqual([...forced.args.paths], ['C:\\work\\cached']);
});

test('stale index lookup and old generation events cannot overwrite current entries', async () => {
  const pending = deferred();
  const h = harness((cmd) => cmd === 'sizes_lookup' ? pending.promise : Promise.resolve());
  h.prepare([folder('cached', 8)]);
  const lookup = h.run('refreshIndexedSizes()');
  h.state.navToken++;
  h.state.gen++;
  pending.resolve([999]);
  await lookup;
  h.run("queueDirSize(state.gen - 1, 'C:\\\\work\\\\cached', 999)");
  assert.equal(h.frames.length, 0);
  assert.equal(h.state.entries[0].dirSize, 8);
});

test('multiple size events share one frame and one visible-row pass', () => {
  const h = harness();
  h.prepare(Array.from({ length: 500 }, (_, i) => folder(`dir${i}`)));
  h.cells.push({ textContent: '' }, { textContent: '' });
  h.state.entries.find = () => { throw new Error('must not search all entries for every event'); };
  h.state.view.findIndex = () => { throw new Error('must not search all entries for every event'); };
  h.run("queueDirSize(state.gen, 'C:\\\\work\\\\dir0', 10); queueDirSize(state.gen, 'C:\\\\work\\\\dir1', 20)");
  assert.equal(h.frames.length, 1);
  h.frames[0]();
  assert.equal(h.rowVisits, 1);
  assert.deepEqual(h.cells.map((cell) => cell.textContent), ['10 B', '20 B']);
});

test('cache evicts only oldest values instead of blanking every folder', () => {
  const h = harness();
  h.run("for (let i = 0; i < 4097; i++) cacheDirectorySize('C:\\\\work\\\\' + i, i)");
  assert.equal(h.state.dirSizes.size, 4096);
  assert.equal(h.state.dirSizes.has('c:\\work\\0'), false);
  assert.equal(h.state.dirSizes.get('c:\\work\\4096'), 4096);
});

test('failed measurements keep cached values and stop displaying or repeating pending work', async () => {
  const h = harness();
  h.prepare([folder('cached', 123), folder('unreadable')]);
  h.run("queueDirSize(state.gen, 'C:\\\\work\\\\cached', null); queueDirSize(state.gen, 'C:\\\\work\\\\unreadable', null)");
  h.frames.shift()();
  assert.equal(h.run('folderSizeLabel(state.entries[0])'), '123 B');
  assert.equal(h.run('folderSizeLabel(state.entries[1])'), 'sizeUnavailable');
  await h.run('requestDirSizes()');
  assert.equal(h.calls.filter((c) => c.cmd === 'dir_sizes').length, 0);
  await h.run('requestDirSizes(true)');
  const request = h.calls.find((c) => c.cmd === 'dir_sizes');
  assert.equal(request.args.force, true);
  assert.equal(request.args.paths.length, 2);
  assert.equal(h.run('folderSizeLabel(state.entries[1])'), 'calculatingSize');
  h.run("queueDirSize(state.gen, 'C:\\\\work\\\\unreadable', 456)");
  h.frames.shift()();
  assert.equal(h.run('folderSizeLabel(state.entries[1])'), '456 B');
  assert.equal(h.state.entries[1].dirSizeUnavailable, false);
});
