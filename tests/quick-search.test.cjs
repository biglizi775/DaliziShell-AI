const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../ui/quick-search.js'), 'utf8');
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function harness(invoke) {
  let tab = { kind: 'files' };
  const nodes = {
    quickSearchPopover: { classList: { add() {} } }, search: { value: 'project', setAttribute() {} },
    quickSearchResults: { innerHTML: '' }, quickSearchStatus: {}, quickSearchCount: {},
    searchMode: { value: 'global', options: ['local', 'tree', 'global'].map((value) => ({ value })), setAttribute() {} },
    searchClear: { style: {} },
  };
  const state = { path: 'C:\\work', filter: '' };
  const ctx = vm.createContext({ locale: 'zh', $: (id) => nodes[id], invoke, state, curTab: () => tab, isTermTab: (item) => item.kind === 'terminal', els: { scroller: {} }, renderAll() {}, setTimeout, clearTimeout, clearInterval, setInterval, console });
  vm.runInContext(source, ctx);
  vm.runInContext("paintQuickResults = (r) => { painted = r; }; paintQuickStatus = () => {}; positionQuickSearch = () => {}; quickState.token = 1; quickState.open = true; quickState.mode = 'global'; quickState.owner = curTab(); quickState.folder = state.path; quickState.locale = locale;", ctx);
  return { nodes, state, ctx, switchTab: (next) => { tab = next; }, run: (s) => vm.runInContext(s, ctx) };
}
test('quick search composes type filters and leaves empty query empty', () => {
  const h = harness();
  assert.equal(h.run("quickQuery('  notes ext:md ', 'file')"), 'type:file notes ext:md');
  assert.equal(h.run("quickQuery(' ', 'dir')"), '');
  assert.equal(h.run("quickQuery('report', 'all')"), 'report');
});
test('search sends bounded scoped request and paints returned results', async () => {
  let call;
  const h = harness(async (cmd, args) => { call = { cmd, args }; return { items: [{ name: 'notes.md', path: 'C:\\work\\notes.md' }], total: 1 }; });
  h.run("quickState.mode = 'tree'; quickState.kind = 'file';");
  await h.run('runQuickSearch(1)');
  assert.equal(call.cmd, 'search_files');
  assert.equal(call.args.query, 'type:file project');
  assert.equal(call.args.limit, 200);
  assert.equal(call.args.scope, 'C:\\work');
  assert.equal(h.run('quickState.items[0].name'), 'notes.md');
  assert.equal(h.run('quickState.pending'), false);
});
test('old search completion cannot overwrite a newer query', async () => {
  const first = deferred(), second = deferred(); let n = 0;
  const h = harness(() => (++n === 1 ? first.promise : second.promise));
  const a = h.run('runQuickSearch(1)');
  h.run('quickState.token = 2');
  const b = h.run('runQuickSearch(2)');
  second.resolve({ items: [{ name: 'new' }], total: 1 }); await b;
  first.resolve({ items: [{ name: 'old' }], total: 1 }); await a;
  assert.equal(h.run('quickState.items[0].name'), 'new');
});
test('closing a search ignores late responses and empty queries do no IPC', async () => {
  const reply = deferred(); let calls = 0;
  const h = harness(() => { calls++; return reply.promise; });
  const p = h.run('runQuickSearch(1)');
  h.run('closeQuickSearch()');
  reply.resolve({ items: [{ name: 'late' }], total: 1 }); await p;
  assert.equal(h.run('quickState.items.length'), 0);
  h.run('quickState.open = true'); h.nodes.search.value = ' ';
  await h.run('runQuickSearch(quickState.token)');
  assert.equal(calls, 1);
});

test('changing folders invalidates pending searches and clears old scope text', async () => {
  const reply = deferred();
  const h = harness(() => reply.promise);
  h.run("quickState.mode = 'tree'");
  const pending = h.run('runQuickSearch(1)');
  h.state.path = 'D:\\next';
  h.run('syncQuickSearchWorkspace()');
  assert.equal(h.nodes.search.value, '');
  assert.equal(h.run('quickState.open'), false);
  reply.resolve({ items: [{ name: 'old folder' }], total: 1 }); await pending;
  assert.equal(h.run('quickState.items.length'), 0);
});

test('switching tabs at the same path cannot accept a previous tab reply', async () => {
  const reply = deferred();
  const h = harness(() => reply.promise);
  const pending = h.run('runQuickSearch(1)');
  h.switchTab({ kind: 'files' });
  reply.resolve({ items: [{ name: 'old tab' }], total: 1 }); await pending;
  assert.equal(h.run('quickState.items.length'), 0);
});

test('local mode filters immediately without querying the index', () => {
  let calls = 0;
  const h = harness(() => { calls++; });
  h.run("quickState.mode = 'local'; handleWorkspaceSearchInput()");
  assert.equal(h.state.filter, 'project');
  assert.equal(h.run('quickState.open'), false);
  assert.equal(calls, 0);
});

test('terminal subfolder search uses the terminal starting folder and disables local filtering', async () => {
  let args;
  const h = harness(async (_cmd, value) => { args = value; return { items: [], total: 0 }; });
  h.switchTab({ kind: 'terminal', cwd: 'D:\\shell' });
  h.run("quickState.mode = 'tree'; syncQuickSearchWorkspace(); quickState.open = true");
  h.nodes.search.value = 'log';
  await h.run('runQuickSearch(quickState.token)');
  assert.equal(args.scope, 'D:\\shell');
  assert.equal(h.nodes.searchMode.options[0].disabled, true);
  assert.equal(h.nodes.searchMode.value, 'tree');
});
test('search failures clear pending results and are displayed as escaped text', async () => {
  const h = harness(async () => { throw new Error('<bad>'); });
  h.ctx.esc = (text) => text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  await h.run('runQuickSearch(1)');
  assert.equal(h.run('quickState.pending'), false);
  assert.match(h.nodes.quickSearchResults.innerHTML, /&lt;bad&gt;/);
  assert.doesNotMatch(h.nodes.quickSearchResults.innerHTML, /<bad>/);
});
