// Run the application's real navigation/operation functions with deferred IPC.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(require('node:path').join(__dirname, '../ui/app.js'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(setImmediate);

function harness(invoke) {
  const tab = { path: 'C:\\A', history: [], hIdx: -1 };
  const state = {
    navToken: 0, gen: 0, path: tab.path, tabs: [tab], tab: 0,
    entries: [], roots: {}, selection: new Set(), dirSizes: new Map(), loading: false,
  };
  const noop = () => {};
  const context = vm.createContext({
    state, invoke, Set, Map,
    els: { search: { value: '' }, scroller: { scrollTop: 0 } },
    curTab: () => state.tabs[state.tab], isTermTab: (t) => t?.kind === 'term',
    renderAll: noop, renderTabs: noop, renderBar2: noop, applySelectionDom: noop,
    renderStatus: noop, addRecent: noop, toast: noop, store: { set: noop },
    join: (a, b) => `${a}\\${b}`,
  });
  vm.runInContext(
    section('async function navigate(', '// Update one row') +
    section('function copySel()', '/* ============================== rename') +
    '\nfunction requestDirSizes() {}', context);
  return { state, context, run: (s) => vm.runInContext(s, context) };
}

test('late directory response cannot replace a newer navigation', async () => {
  const a = deferred(), b = deferred();
  const h = harness((cmd, args) => cmd === 'list_dir' ? (args.path === 'A' ? a.promise : b.promise) : Promise.resolve());
  const first = h.run("navigate('A')");
  await tick();
  const second = h.run("navigate('B')");
  await tick();
  b.resolve([{ name: 'new.txt' }]);
  await second;
  a.resolve([{ name: 'old.txt' }]);
  await first;
  assert.equal(h.state.path, 'B');
  assert.equal(h.state.entries[0].name, 'new.txt');
});

for (const [input, expected] of [
  ['C:\\work\\child\\..', 'C:\\work'],
  ['c:/Work//child/.././Docs//', 'c:\\Work\\Docs'],
  ['D:\\\\Mixed/./Child\\..\\Keep', 'D:\\Mixed\\Keep'],
  ['C:\\..\\..\\work\\..', 'C:\\'],
  ['C:/../.././', 'C:\\'],
  ['C:\\Work\\..notes\\report...', 'C:\\Work\\..notes\\report...'],
]) {
  test(`navigation uses one normalized folder identity for ${input}`, async () => {
    const calls = [], listing = deferred();
    const h = harness((cmd, args) => {
      calls.push({ cmd, args });
      return cmd === 'list_dir' ? listing.promise : Promise.resolve();
    });
    const pending = h.run(`navigate(${JSON.stringify(input)})`);
    assert.equal(h.state.path, expected, 'UI scope is normalized before the first render');
    await tick();
    assert.equal(calls.find((call) => call.cmd === 'watch').args.path, expected);
    assert.equal(calls.find((call) => call.cmd === 'list_dir').args.path, expected);
    listing.resolve([]); await pending;
    assert.equal(h.state.tabs[0].path, expected);
    assert.deepEqual([...h.state.tabs[0].history], [expected]);
  });
}

test('navigation leaves UNC, device, relative and home path semantics unchanged', async () => {
  const h = harness(async (cmd) => cmd === 'list_dir' ? [] : {});
  for (const input of ['\\\\server\\share\\child\\..', '\\\\?\\C:\\work\\..', 'C:relative', 'relative/../folder', null]) {
    await h.run(`navigate(${JSON.stringify(input)})`);
    assert.equal(h.state.path, input);
    assert.equal(h.state.tabs[0].path, input);
  }
});

test('address bar recognizes a forward-slash drive path instead of joining it to the active folder', async () => {
  const calls = [], handlers = {};
  const h = harness(async (cmd, args) => { calls.push({ cmd, args }); return cmd === 'list_dir' ? [] : {}; });
  const input = { value: '', focus() {}, select() {}, addEventListener: (name, handler) => { handlers[name] = handler; } };
  h.context.els.crumbs = { innerHTML: '', querySelector: () => input };
  h.context.renderCrumbs = () => {};
  vm.runInContext('let crumbEditing = false;\n' + section('function enterPathEdit()', 'function renderBar2()'), h.context);
  h.run('enterPathEdit()');
  input.value = 'D:/Work/child/..';
  handlers.keydown({ key: 'Enter', stopPropagation() {}, preventDefault() {} });
  await tick();
  assert.equal(calls.find((call) => call.cmd === 'list_dir').args.path, 'D:\\Work');
  assert.equal(h.state.tabs[0].path, 'D:\\Work');
});

test('late refresh cannot overwrite navigation or its selection', async () => {
  const old = deferred();
  const h = harness((cmd, args) => cmd === 'list_dir'
    ? (args.path === 'C:\\A' ? old.promise : Promise.resolve([{ name: 'B.txt' }])) : Promise.resolve());
  const refresh = h.run('refresh()');
  await h.run("navigate('B')");
  old.resolve([{ name: 'A.txt' }]);
  await refresh;
  assert.equal(h.state.entries[0].name, 'B.txt');
});

test('terminal tab does not receive an in-flight file navigation', async () => {
  const listing = deferred();
  const h = harness((cmd) => cmd === 'list_dir' ? listing.promise : Promise.resolve());
  const pending = h.run("navigate('A')");
  await tick();
  h.state.tabs.push({ kind: 'term' });
  h.state.tab = 1;
  listing.resolve([{ name: 'late.txt' }]);
  await pending;
  assert.equal(h.state.entries.length, 0);
  assert.equal(h.state.tabs[1].history, undefined);
});

test('refresh retains only selected entries still present', async () => {
  const h = harness(() => Promise.resolve([{ name: 'keep' }, { name: 'other' }]));
  h.state.selection = new Set(['keep', 'removed']);
  await h.run('refresh()');
  assert.deepEqual([...h.state.selection], ['keep']);
});

test('cancelled move preserves clipboard; successful move clears it', async () => {
  let completed = false;
  const h = harness((cmd) => Promise.resolve(cmd === 'file_op' ? completed : []));
  const clipboard = { mode: 'cut', paths: ['C:\\source'] };
  h.state.clipboard = clipboard;
  await h.run('pasteClip()');
  assert.equal(h.state.clipboard, clipboard);
  completed = true;
  await h.run('pasteClip()');
  assert.equal(h.state.clipboard, null);
});

test('pending operation rejects duplicate submission and preserves newer clipboard', async () => {
  const operation = deferred();
  let calls = 0;
  const h = harness((cmd) => {
    if (cmd === 'file_op') { calls++; return operation.promise; }
    return Promise.resolve([]);
  });
  h.state.clipboard = { mode: 'cut', paths: ['C:\\source'] };
  const pending = h.run('pasteClip()');
  await h.run('pasteClip()');
  const replacement = { mode: 'copy', paths: ['C:\\another'] };
  h.state.clipboard = replacement;
  operation.resolve(true);
  await pending;
  assert.equal(calls, 1);
  assert.equal(h.state.clipboard, replacement);
});
