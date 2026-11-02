const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = (name) => fs.readFileSync(path.join(__dirname, '../ui', name), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));
function harness(initial = {}) {
  const storage = new Map(Object.entries(structuredClone(initial))), calls = [], events = {};
  let id = 0;
  const state = { tabs: [{ path: null, history: [], hIdx: -1 }], tab: 0, path: null, navToken: 0 };
  const context = vm.createContext({ state, URL, TextEncoder, console, locale: 'en', crypto: { randomUUID: () => `id-${++id}` },
    store: { get: (key, fallback) => storage.has(key) ? structuredClone(storage.get(key)) : fallback, set: (key, value) => storage.set(key, plain(value)) },
    normalizeNavigationPath: (p) => p.replace(/\//g, '\\').replace(/^([a-z]):/i, (_, letter) => letter + ':'),
    curTab: () => state.tabs[state.tab], isTermTab: (t) => t?.kind === 'term', isBrowserTab: (t) => t?.kind === 'browser',
    basename: (p) => p.split('\\').at(-1), t: (s) => s, $: () => null,
    renderAll: () => calls.push('render'), window: { addEventListener: (key, fn) => { events[key] = fn; } },
    createBrowserTabState: (url, title) => ({ kind: 'browser', key: `browser-${++id}`, url, title, browserReady: false }),
    ensureBrowserTab: async (t) => { t.browserReady = true; calls.push(['browser', t.url]); },
    navigate: async (p) => { state.path = p; state.tabs[state.tab].path = p; state.navToken++; calls.push(['folder', p]); },
    newTab: (p) => calls.push(['new-file', p]), newBrowserTab: (p) => calls.push(['new-web', p]),
    switchTab: (i) => { state.tab = i; calls.push(['switch', i]); }, toast: () => {},
  });
  for (const name of ['browser-settings.js', 'browser-sessions.js', 'places.js']) vm.runInContext(source(name), context);
  return { state, storage, calls, events, run: (s) => vm.runInContext(s, context), context };
}
const saved = { version: 1, updatedAt: 100, active: 1, tabs: [{ kind: 'files', path: 'D:\\项目 A' }, { kind: 'files', path: 'C:\\Work' }, { kind: 'browser', url: 'https://example.org/docs', title: 'Docs' }] };
test('favorites validate destinations, deduplicate case-insensitive folders and preserve names', () => {
  const h = harness();
  for (const value of ['javascript:alert(1)', 'file:///C:/secret', 'https://name:password@example.com/', 'relative/path', '\\\\?\\C:\\x', 'C:\\x:stream', 'C:\\bad\0name']) {
    h.context.input = value; assert.equal(h.run('placeTarget(input)'), null, value);
  }
  h.context.folder = 'C:\\Work';
  h.run("addFavorite({kind:'files',path:folder}, 'Work')");
  h.run("addFavorite({kind:'browser',url:'https://example.org/'}, '<img onerror=bad()>')");
  assert.equal(h.run('readFavorites().length'), 2);
  assert.throws(() => h.run("addFavorite({kind:'files',path:folder.toLowerCase()}, 'Duplicate')"));
  h.context.network = '\\\\server\\share\\中文'; assert.equal(h.run('placeTarget(network).kind'), 'files');
  assert.equal(h.run('readFavorites()[1].name'), '<img onerror=bad()>', 'stored labels are data, escaped on rendering');
  h.run('openFavorite(readFavorites()[1])'); assert.deepEqual(h.calls.at(-1), ['new-web', 'https://example.org/']);
});
test('failed favorite writes surface an error instead of reporting success', () => {
  const h = harness(); h.context.store.set = () => {};
  assert.throws(() => h.run("addFavorite({kind:'browser',url:'https://example.org/'}, 'Docs')"), /save favorites/);
});
test('startup restores mixed tab order, active folder and lazy webpages; runtime fields never persist', async () => {
  const h = harness({ workspaceSession: saved });
  h.run('persistWorkspaceSession()'); assert.deepEqual(h.storage.get('workspaceSession'), saved);
  await h.run('restoreWorkspaceOnStartup({initialTab:curTab(),initialToken:state.navToken})');
  assert.equal(h.state.tabs.length, 3); assert.equal(h.state.tab, 1);
  assert.equal(h.state.path, 'C:\\Work'); assert.equal(h.state.tabs[2].browserReady, false);
  assert.deepEqual(h.storage.get('workspacePreviousSession'), saved);
  h.state.tabs.push({ kind: 'term', sshConfig: { password: 'secret' }, termId: 42 });
  h.run('persistWorkspaceSession()');
  assert.doesNotMatch(JSON.stringify(h.storage.get('workspaceSession')), /secret|termId|key|browserReady/);
  h.events.beforeunload(); h.state.tabs = []; h.run('persistWorkspaceSession()');
  assert.equal(h.storage.get('workspaceSession').tabs.length, 3, 'teardown cannot erase saved tabs');
});
test('manual restoration remains available when automatic restoration is off and runs once', async () => {
  const h = harness({ workspaceSession: saved, workspacePreferences: { restoreOnStartup: false }, lastPath: null });
  await h.run('restoreWorkspaceOnStartup({initialTab:curTab(),initialToken:state.navToken})');
  assert.equal(h.state.tabs.length, 1);
  await h.run('restorePreviousWorkspace()'); assert.equal(h.state.tabs.length, 3);
  await h.run('restorePreviousWorkspace()'); assert.equal(h.state.tabs.length, 3);
});
test('manual restoration reuses an existing folder without losing intentional duplicate tabs', async () => {
  const h = harness({ workspaceSession: { ...saved, tabs: [...saved.tabs, saved.tabs[1]], active: 3 }, workspacePreferences: { restoreOnStartup: false }, lastPath: 'C:\\Work' });
  await h.run('restoreWorkspaceOnStartup({initialTab:curTab(),initialToken:state.navToken})');
  await h.run('restorePreviousWorkspace()');
  assert.equal(h.state.tabs.length, 4);
  assert.equal(h.state.tabs.filter(x => x.path === 'C:\\Work').length, 2);
  assert.equal(h.state.tabs[h.state.tab].path, 'C:\\Work');
});
test('slow startup never steals a user-selected tab or starts saved background pages', async () => {
  const h = harness({ workspaceSession: { ...saved, active: 2 } });
  h.context.initialTab = h.state.tabs[0];
  h.state.tabs.push({ kind: 'browser', url: 'https://current.example/', browserReady: true }); h.state.tab = 1; h.state.navToken = 2;
  await h.run('restoreWorkspaceOnStartup({initialTab,initialToken:0})');
  assert.equal(h.state.tab, 1); assert.equal(h.state.tabs[1].url, 'https://current.example/');
  assert.equal(h.calls.filter((x) => Array.isArray(x) && x[0] === 'browser').length, 0);
  assert.equal(h.state.tabs.length, 5);
});
test('privacy clears URLs from both snapshots while preserving folders and manual recovery', async () => {
  const h = harness({ workspaceSession: saved });
  await h.run('restoreWorkspaceOnStartup({initialTab:curTab(),initialToken:state.navToken})');
  h.storage.set('browserSettings', { recordHistory: false }); h.run('syncWorkspaceSessionPrivacy()');
  for (const key of ['workspaceSession', 'workspacePreviousSession']) assert.deepEqual(h.storage.get(key).tabs, saved.tabs.slice(0, 2));
  h.run('saveWorkspacePreferences({rememberSession:false})');
  assert.equal(h.storage.get('workspaceSession'), null); assert.equal(h.storage.get('workspacePreviousSession'), null);
  h.run('persistWorkspaceSession()'); assert.equal(h.storage.get('workspaceSession'), null);
});
test('corrupt snapshots and unsafe URLs are rejected; duplicate tabs and active tab beyond limit are retained', () => {
  const h = harness();
  h.context.raw = { ...saved, active: 55 }; assert.equal(h.run('normalizeWorkspaceSession(raw)'), null);
  h.context.raw = { ...saved, tabs: [{ kind: 'browser', url: 'javascript:bad()' }, ...saved.tabs], active: 2 };
  assert.equal(h.run('normalizeWorkspaceSession(raw).active'), 1);
  h.state.tabs = Array.from({ length: 55 }, (_, i) => ({ kind: 'files', path: 'C:\\folder' + i })); h.state.tab = 54;
  h.run('workspaceSessionReady=true; persistWorkspaceSession()');
  const stored = h.storage.get('workspaceSession'); assert.equal(stored.tabs.length, 50); assert.equal(stored.tabs[stored.active].path, 'C:\\folder54');
});
