const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../ui/quick-search.js'), 'utf8');
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function harness(invoke) {
  let tab = { kind: 'files', get path() { return state.path; } };
  const nodes = {
    quickSearchPopover: { classList: { add() {} } }, search: { value: 'project', setAttribute() {} },
    quickSearchResults: { innerHTML: '' }, quickSearchStatus: {}, quickSearchCount: {},
    searchMode: { value: 'global', options: ['local', 'tree', 'global'].map((value) => ({ value })), setAttribute() {} },
    searchClear: { style: {} },
  };
  const state = { path: 'C:\\work', filter: '' };
  const ctx = vm.createContext({ locale: 'zh', $: (id) => nodes[id], invoke, state, curTab: () => tab, isTermTab: (item) => item.kind === 'terminal', els: { scroller: {} }, renderAll() {}, setTimeout, clearTimeout, clearInterval, setInterval, console });
  const app = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
  vm.runInContext(app.slice(app.indexOf('function tabLocalFolder('), app.indexOf('function fileListingReady(')) + source, ctx);
  vm.runInContext("paintQuickResults = (r) => { painted = r; }; paintQuickStatus = () => {}; positionQuickSearch = () => {}; quickState.token = 1; quickState.open = true; quickState.mode = 'global'; quickState.owner = curTab(); quickState.folder = state.path; quickState.locale = locale;", ctx);
  return { nodes, state, ctx, switchTab: (next) => { tab = next; }, run: (s) => vm.runInContext(s, ctx) };
}
test('search request identity includes filter, scope and query', () => {
  const h = harness();
  h.nodes.search.value = '  notes|ext:md ';
  h.run("quickState.kind='file'; quickState.mode='tree'");
  assert.deepEqual(JSON.parse(h.run('quickRequestKey()')), ['notes|ext:md','file','tree','C:\\work']);
});
test('search sends bounded scoped request and paints returned results', async () => {
  let call;
  const h = harness(async (cmd, args) => { call = { cmd, args }; return { items: [{ name: 'notes.md', path: 'C:\\work\\notes.md' }], total: 1 }; });
  h.run("quickState.mode = 'tree'; quickState.kind = 'file';");
  await h.run('runQuickSearch(1)');
  assert.equal(call.cmd, 'search_files');
  assert.equal(call.args.query, 'project');
  assert.equal(call.args.kind, 'file');
  assert.equal(call.args.paginate, true);
  assert.equal(call.args.limit, 200);
  assert.equal(call.args.scope, 'C:\\work');
  assert.equal(h.run('quickState.items[0].name'), 'notes.md');
  assert.equal(h.run('quickState.pending'), false);
});

test('index refresh preserves visible results, selection by path and coalesces pending updates', async () => {
  const reply = deferred();
  const h = harness(() => reply.promise);
  h.run("quickState.items = [{name:'first',path:'A'}, {name:'chosen',path:'B'}]; quickState.selected = 1; quickState.resultKey = quickRequestKey();");
  h.run('scheduleQuickSearch(60000, true)');
  assert.equal(h.run('quickState.items.length'), 2, 'rows stay visible during debounce');
  assert.equal(h.run('quickState.selected'), 1);
  h.run('clearTimeout(quickState.timer); quickState.timer = null');
  const pending = h.run('runQuickSearch(quickState.token)');
  h.run('requestQuickRefresh(); requestQuickRefresh(); requestQuickRefresh()');
  assert.equal(h.run('quickState.timer'), null, 'index events cannot abort or restart an in-flight query');
  reply.resolve({ items: [{ name: 'chosen', path: 'B' }, { name: 'first', path: 'A' }], total: 2 });
  await pending;
  assert.equal(h.run('quickState.selected'), 0, 'selection follows the same path after reordering');
  assert.equal(h.run('quickState.items[quickState.selected].path'), 'B');
  assert.equal(h.run('quickState.refreshQueued'), false);
  assert.notEqual(h.run('quickState.timer'), null, 'one follow-up refresh is queued');
  h.run('closeQuickSearch()');
});

test('reveal opens an in-app tab during background refresh; stale user-query results cannot activate', async () => {
  const opened = [], invoked = [];
  const h = harness(async (...args) => invoked.push(args));
  h.ctx.openContainingFolder = async (path) => opened.push(path);
  h.run("quickState.items = [{name:'chosen',path:'C:\\\\work\\\\chosen'}]; quickState.resultKey = quickRequestKey(); quickState.pending = true;");
  h.nodes.search.value = 'changed query';
  await h.run("activateQuickResult(0, 'reveal')");
  assert.equal(opened.length, 0);
  h.nodes.search.value = 'project';
  await h.run("activateQuickResult(0, 'reveal')");
  assert.deepEqual(opened, ['C:\\work\\chosen']);
  assert.deepEqual(invoked, [], 'no Windows Explorer command is sent');
  assert.equal(h.run('quickState.open'), false);
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

test('index notifications leave the browsed snapshot stable and a late page cannot enter a different tab', async () => {
  const next = deferred(), calls = [];
  const h = harness(async (cmd, args) => { calls.push([cmd,args]); if (cmd === 'search_page') return next.promise; });
  h.run("quickState.result={ snapshotId:17, page:1, pageSize:2, total:3 }; quickState.resultKey=quickRequestKey();quickState.items=[{path:'old'}];requestQuickRefresh()");
  assert.equal(h.run('quickState.timer'), null);
  const pending = h.run('goQuickPage(2)');
  await h.run("activateQuickResult(0,'open')");
  assert.deepEqual(calls.map(c => c[0]), ['search_page']);
  h.switchTab({kind:'files',path:'C:\\work'});
  h.run('syncQuickSearchWorkspace()');
  next.resolve({snapshotId:17,page:2,items:[{name:'late'}]}); await pending;
  assert.equal(h.run('quickState.items.length'), 0);
  assert.equal(calls.at(-1)[0], 'search_release');
});

test('a late first page releases only the discarded native snapshot', async () => {
  const first = deferred(), releases = [];
  const h = harness((cmd,args) => cmd === 'search_files' ? first.promise : (releases.push(args.snapshotId), Promise.resolve()));
  const old = h.run('runQuickSearch(1)');
  h.run('closeQuickSearch()');
  first.resolve({ snapshotId:31, items:[], total:300 }); await old;
  assert.deepEqual(releases,[31]); assert.equal(h.run('quickState.result'), null);
});

test('a page error keeps the original page and can be retried', async () => {
  let calls = 0;
  const h = harness(async () => {
    if (++calls === 1) throw Error('Unavailable page');
    return {snapshotId:7,page:2,pageSize:1,items:[{name:'second'}],total:2};
  });
  h.run("quickState.result={snapshotId:7,page:1,pageSize:1,total:2};quickState.resultKey=quickRequestKey();quickState.items=[{name:'first'}]");
  await h.run('goQuickPage(2)');
  assert.equal(h.run('quickState.items[0].name'), 'first');
  assert.match(h.nodes.quickSearchCount.textContent,/Unavailable page/);
  await h.run('goQuickPage(2)');
  assert.equal(h.run('quickState.items[0].name'), 'second');
});
