const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function harness() {
  const a = { path: 'C:\\A' }, b = { kind: 'term', connection: 'ssh', termId: 42, sshConfig: { host: 'private.test' } }, c = { kind: 'browser', url: 'https://example.test/' };
  const state = { tabs: [a, b, c], tab: 1 }, calls = [];
  const context = vm.createContext({ state, a, b, c, privacy: true, locale: 'zh', $: () => null, curTab: () => state.tabs[state.tab],
    isTermTab: (t) => t?.kind === 'term', isBrowserTab: (t) => t?.kind === 'browser', browserSettings: () => ({ recordHistory: context.privacy }),
    window: { addEventListener() {} }, crypto: { randomUUID: () => 'new-tab' }, switchTab(i) { state.tab = i; },
    placeFolder: (p) => /^[a-z]:\\/i.test(p) ? p : null, placeTarget: (url) => /^https?:/.test(url) ? { kind: 'browser', url } : null,
    renderTabs: () => calls.push('render'), newTab: (path) => calls.push({ path }), newBrowserTab: (url) => calls.push({ url }),
  });
  for (const name of ['places.js', 'tab-management.js']) vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../ui', name), 'utf8'), context);
  vm.runInContext('placeTarget = url => ({ kind: "browser", url }); placeFolder = path => path;', context);
  return { state, calls, a, b, c, run: (code) => vm.runInContext(code, context) };
}
test('reordering retains active session and tab identity without restarting processes', () => {
  const h = harness(); assert.equal(h.run('moveWorkbenchTab(a, 2)'), true);
  assert.deepEqual(h.state.tabs, [h.b, h.c, h.a]); assert.equal(h.state.tabs[h.state.tab], h.b); assert.equal(h.b.termId, 42);
  assert.deepEqual(h.calls, ['render']); assert.equal(h.run('moveWorkbenchTab(a, 99)'), false);
  h.run('moveWorkbenchTab(b, 2)'); assert.equal(h.state.tabs[h.state.tab], h.b);
});
test('closed tab history is bounded and never stores terminal connections or disabled URL history', async () => {
  const h = harness(); h.run('rememberClosedTab(a); rememberClosedTab(b); rememberClosedTab(c)'); assert.equal(h.run('recentlyClosedTabs.length'), 3);
  assert.deepEqual(JSON.parse(h.run('JSON.stringify(recentlyClosedTabs[1])')), { kind: 'ssh', profileId: null, index: 1 });
  await h.run('reopenClosedTab()'); assert.deepEqual(h.calls.at(-1), { url: h.c.url });
  h.state.tabs.splice(1, 1); h.state.tab = 0;
  await h.run('reopenClosedTab()');
  assert.equal(h.state.tab, 1); assert.equal(h.state.tabs[1].pendingTerminal, true);
  assert.equal(h.state.tabs[1].termId, null);
  h.run('rememberClosedTab(c); privacy = false; clearClosedBrowserTabs(); rememberClosedTab(c)');
  assert.equal(h.run('recentlyClosedTabs.length'), 1); await h.run('reopenClosedTab()'); assert.deepEqual(h.calls.at(-1), { path: h.a.path });
  h.run('for (let i = 0; i < 25; i++) rememberClosedTab({ path: "C:\\\\folder" + i })'); assert.equal(h.run('recentlyClosedTabs.length'), 20);
  assert.equal(h.run('recentlyClosedTabs[0].path'), 'C:\\folder5');
});
test('tab wheels accept both axes and delta units without hijacking Ctrl zoom', () => {
  const h = harness();
  assert.equal(h.run('tabWheelDistance({deltaX:0,deltaY:120,deltaMode:0},400)'), 120);
  assert.equal(h.run('tabWheelDistance({deltaX:-50,deltaY:3,deltaMode:0},400)'), -50);
  assert.equal(h.run('tabWheelDistance({deltaX:0,deltaY:3,deltaMode:1},400)'), 96);
  assert.equal(h.run('tabWheelDistance({deltaX:0,deltaY:-1,deltaMode:2},400)'), -400);
  assert.equal(h.run('tabWheelDistance({deltaX:0,deltaY:120,deltaMode:0,ctrlKey:true},400)'), 0);
});
