const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const workspace = readFileSync(path.join(__dirname, '../ui/workspace.js'), 'utf8');
const section = (source, start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `source section exists: ${start}`);
  return source.slice(a, b);
};
const tick = () => new Promise(setImmediate);

function navigationHarness(tabs, active = 0) {
  const calls = [];
  const state = {
    navToken: 9, gen: 1, tabs, tab: active, path: tabs[active].path || 'C:\\files',
    entries: [{ name: 'selected.txt' }], roots: {}, selection: new Set(['selected.txt']),
    dirSizes: new Map(), loading: false, filter: 'selected', typeFilter: 'all', anchorIdx: 2,
  };
  const noop = () => {};
  const context = vm.createContext({
    state, Set, Map,
    invoke: async (cmd, args) => { calls.push({ cmd, args }); return cmd === 'list_dir' ? [{ name: 'file.txt' }] : {}; },
    els: { search: { value: 'selected' }, scroller: { scrollTop: 440 } },
    curTab: () => state.tabs[state.tab], isTermTab: (tb) => tb?.kind === 'term',
    renderAll: noop, renderTabs: noop, requestDirSizes: noop, addRecent: noop,
    prepareEntries: (raw) => raw.map((entry) => ({ ...entry, nameLower: entry.name.toLowerCase() })),
    store: { set: noop }, killTerm: (tb) => { tb.disposed = true; },
  });
  vm.runInContext(section(app, 'async function navigate(', 'async function refresh(') +
    section(app, 'function newTab(', 'function closeOtherTabs('), context);
  return { state, calls, context, run: (s) => vm.runInContext(s, context) };
}

test('navigating from a terminal opens a file tab and preserves the running terminal', async () => {
  const terminal = { kind: 'term', cwd: 'C:\\work', termId: 10 };
  const h = navigationHarness([terminal]);
  await h.run("navigate('D:\\\\projects')");
  await tick();
  assert.equal(h.state.tabs[0], terminal);
  assert.equal(terminal.disposed, undefined);
  assert.equal(terminal.history, undefined);
  assert.equal(h.state.tabs.length, 2);
  assert.notEqual(h.state.tabs[h.state.tab], terminal);
  assert.equal(h.state.tabs[h.state.tab].path, 'D:\\projects');
  assert.equal(h.state.entries[0].name, 'file.txt');
});

for (const position of ['before', 'after']) {
  test(`closing a background tab ${position} the active one preserves browsing state`, async () => {
    const current = { path: 'C:\\files', history: ['C:\\files'], hIdx: 0 };
    const background = { path: 'D:\\other', history: ['D:\\other'], hIdx: 0 };
    const tabs = position === 'before' ? [background, current] : [current, background];
    const h = navigationHarness(tabs, position === 'before' ? 1 : 0);
    const entries = h.state.entries, selection = h.state.selection;
    h.run(`closeTab(${position === 'before' ? 0 : 1})`);
    await tick();
    assert.equal(h.state.tabs[h.state.tab], current);
    assert.equal(h.state.entries, entries);
    assert.equal(h.state.selection, selection);
    assert.equal(h.state.filter, 'selected');
    assert.equal(h.state.navToken, 9);
    assert.equal(h.context.els.scroller.scrollTop, 440);
    assert.equal(h.calls.length, 0);
  });
}

test('file type filters separate folders, images and documents regardless of extension case', () => {
  const context = vm.createContext({ Set });
  vm.runInContext(section(workspace, 'const FILE_GROUPS =', 'let previewOpen ='), context);
  const matches = (entry, group) => {
    context.entry = entry; context.group = group;
    return vm.runInContext('matchesFileType(entry, group)', context);
  };
  const image = { isDir: false, ext: 'PNG' };
  const document = { isDir: false, ext: 'pdf' };
  const folder = { isDir: true, ext: 'png' };
  for (const entry of [image, document, folder, { isDir: false, ext: '' }]) assert.equal(matches(entry, 'all'), true);
  assert.equal(matches(image, 'images'), true);
  assert.equal(matches(image, 'documents'), false);
  assert.equal(matches(document, 'documents'), true);
  assert.equal(matches(document, 'images'), false);
  assert.equal(matches(folder, 'folders'), true);
  assert.equal(matches(folder, 'images'), false);
  assert.equal(matches(image, 'folders'), false);
  assert.equal(matches({ isDir: false, ext: '' }, 'documents'), false);
  assert.equal(matches(image, 'unknown-group'), false);
});

function keyboardHarness(mode = 'details') {
  const view = Array.from({ length: 12 }, (_, i) => ({ name: `file-${i}`, isDir: false, ext: 'txt' }));
  const state = {
    entries: view, view, viewMode: mode, gridCols: 3, selection: new Set(),
    anchorIdx: -1, focusName: null, loading: false, renaming: null,
  };
  const calls = { previews: 0, renders: 0 };
  const tab = { kind: 'files' };
  const noop = () => {};
  const context = vm.createContext({
    state, Set, curTab: () => tab, isTermTab: (tb) => tb?.kind === 'term',
    els: { scroller: { scrollTop: 0, clientHeight: mode === 'grid' ? 272 : 88 } },
    ROWH: { details: 44, grid: 136 },
    selectAt: noop, applySelectionDom: noop, renderStatus: noop, renderBar2: noop,
    togglePreview: () => { calls.previews++; }, renderRows: () => { calls.renders++; },
  });
  vm.runInContext(section(app, 'function selectAt(', 'function clearSelection(') +
    section(workspace, 'function handleFileKeys(', 'function openCommands('), context);
  const key = (name, options = {}) => {
    const event = { key: name, prevented: false, preventDefault() { this.prevented = true; }, ...options };
    context.event = event;
    return { handled: vm.runInContext('handleFileKeys(event)', context), event };
  };
  return { state, tab, calls, context, key };
}

test('list keyboard navigation selects rows and scrolls Home/End into view', () => {
  const h = keyboardHarness();
  assert.equal(h.key('ArrowDown').handled, true);
  assert.deepEqual([...h.state.selection], ['file-0']);
  h.key('ArrowDown');
  assert.deepEqual([...h.state.selection], ['file-1']);
  h.key('End');
  assert.deepEqual([...h.state.selection], ['file-11']);
  assert.equal(h.context.els.scroller.scrollTop, 440);
  h.key('Home');
  assert.deepEqual([...h.state.selection], ['file-0']);
  assert.equal(h.context.els.scroller.scrollTop, 0);
  h.key('ArrowUp');
  assert.equal(h.state.focusName, 'file-0');
});

test('grid navigation moves by columns and Shift extends from the selection anchor', () => {
  const h = keyboardHarness('grid');
  h.key('Home'); h.key('ArrowRight'); h.key('ArrowDown');
  assert.equal(h.state.focusName, 'file-4');
  h.key('ArrowDown', { shiftKey: true });
  assert.deepEqual([...h.state.selection], ['file-4', 'file-5', 'file-6', 'file-7']);
  assert.equal(h.state.anchorIdx, 4);
  assert.equal(h.context.els.scroller.scrollTop, 136);
  h.key('End'); h.key('ArrowDown');
  assert.equal(h.state.focusName, 'file-11');
});

test('PageUp/PageDown use the visible page height', () => {
  const h = keyboardHarness();
  h.key('Home'); h.key('PageDown');
  assert.equal(h.state.focusName, 'file-2');
  h.key('PageUp');
  assert.equal(h.state.focusName, 'file-0');
  const grid = keyboardHarness('grid');
  grid.key('Home'); grid.key('PageDown');
  assert.equal(grid.state.focusName, 'file-6');
});

test('keyboard handling leaves editors, modified shortcuts and terminals untouched', () => {
  const h = keyboardHarness();
  for (const options of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { target: { closest: () => ({}) } }]) {
    const result = h.key('ArrowDown', options);
    assert.equal(result.handled, false); assert.equal(result.event.prevented, false);
  }
  h.tab.kind = 'term'; assert.equal(h.key(' ').handled, false);
  h.tab.kind = 'files'; h.state.loading = true; assert.equal(h.key('ArrowDown').handled, false);
  h.state.loading = false; h.state.renaming = 'file-0'; assert.equal(h.key('ArrowDown').handled, false);
  assert.equal(h.calls.previews, 0); assert.equal(h.state.selection.size, 0);
});

test('Space toggles preview while an empty list does not consume navigation keys', () => {
  const h = keyboardHarness();
  const result = h.key(' ');
  assert.equal(result.handled, true); assert.equal(result.event.prevented, true);
  assert.equal(h.calls.previews, 1);
  h.state.view = [];
  assert.equal(h.key('ArrowDown').handled, false);
  assert.equal(h.calls.renders, 0);
});

test('quick actions distinguish SSH tabs from local PowerShell and activate the selected tab', () => {
  const nodes = { commandInput: { value: '' }, commandResults: { innerHTML: '' } };
  const calls = [];
  const tabs = [{ path: 'C:\\files' }, { kind: 'term', cwd: 'C:\\shell' }, { kind: 'term', remote: true, title: 'ops-box <prod>' }];
  const context = vm.createContext({
    locale: 'en', state: { tabs, pinned: [], recents: [], path: 'C:\\files' },
    $: (id) => nodes[id], u: (key) => key, t: (key) => key,
    curTab: () => tabs[2], isTermTab: (tb) => tb?.kind === 'term', isSshTab: (tb) => !!tb.remote,
    sshTabTitle: (tb) => tb.title, basename: (p) => p?.split('\\').pop(),
    esc: (value) => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    document: { documentElement: { dataset: {} } }, IC: {}, SUN_ICON: '',
    toggleTheme() {}, paintCommandSelection() {}, openSshConnect: () => calls.push('connect'), switchTab: (i) => calls.push(i),
  });
  vm.runInContext('let commandItems = [];\n' + section(workspace, 'function renderCommands()', 'function paintCommandSelection()'), context);
  vm.runInContext('renderCommands()', context);
  const items = vm.runInContext('commandItems', context);
  const remote = items.find((item) => item.title === 'ops-box <prod>');
  assert.equal(remote.sub, '3 · SSH');
  assert.equal(items.filter((item) => item.title === 'PowerShell').length, 1);
  assert.equal(items.some((item) => item.title === 'newFolderHere'), false, 'file actions are absent from remote terminal scope');
  assert.match(nodes.commandResults.innerHTML, /ops-box &lt;prod&gt;/);
  remote.run();
  items.find((item) => item.title === 'New SSH connection').run();
  assert.deepEqual(calls, [2, 'connect']);
  nodes.commandInput.value = 'ops-box';
  vm.runInContext('renderCommands()', context);
  assert.equal(vm.runInContext('commandItems.length', context), 1);
});
