const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = (name) => readFileSync(path.join(__dirname, '../ui', name), 'utf8');
const app = source('app.js');
const section = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));
const plain = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const snapshot = (active = -1) => ({ version: 1, tabs: [
  { url: 'https://one.example/', title: 'One' },
  { url: 'https://same.example/', title: 'Duplicate A' },
  { url: 'https://same.example/', title: 'Duplicate B' },
], active });

function harness({ saved = snapshot(), settings = { restoreSession: true, recordHistory: true }, handler = async () => undefined } = {}) {
  const storage = new Map([['browserSession', structuredClone(saved)], ['browserSettings', structuredClone(settings)]]);
  const writes = [], calls = [], events = {}, notices = [];
  const state = { tabs: [{ path: 'C:\\files', history: ['C:\\files'], hIdx: 0 }], tab: 0, path: 'C:\\files', navToken: 0, gen: 0 };
  const node = () => ({ value: '', innerHTML: '', disabled: false, listeners: {}, classList: { contains: () => true }, addEventListener(name, callback) { this.listeners[name] = callback; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) });
  const els = new Proxy({}, { get(target, key) { return target[key] ||= node(); } });
  const noop = () => {};
  let nextId = 0;
  const context = vm.createContext({
    state, els, locale: 'en', URL, TextEncoder, console, setTimeout, clearTimeout,
    crypto: { randomUUID: () => `browser-${++nextId}` },
    store: {
      get: (key, fallback) => storage.has(key) ? structuredClone(storage.get(key)) : fallback,
      set: (key, value) => { writes.push({ key, value: plain(value) }); storage.set(key, plain(value)); },
    },
    invoke: async (command, args) => { calls.push({ command, args: plain(args ?? {}) }); return handler(command, args); },
    listen: async () => noop, curTab: () => state.tabs[state.tab],
    isBrowserTab: (tab) => tab?.kind === 'browser', isTermTab: (tab) => tab?.kind === 'term',
    navigate: async (folder) => { state.path = folder; }, killTerm: (tab) => { tab.disposed = true; },
    renderCrumbs: noop, renderStatus: noop, updateTitle: noop,
    renderAll: () => vm.runInContext('renderTabs(); syncBrowserWorkspace()', context),
    renderWorkspace: () => vm.runInContext('syncBrowserWorkspace()', context),
    esc: (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    basename: (value) => String(value || '').split('\\').at(-1), t: (value) => value, IC: {},
    toast: (...args) => notices.push(args),
    document: { body: {}, documentElement: {}, querySelector: () => null },
    window: { addEventListener(name, callback) { events[name] = callback; } },
    MutationObserver: class { observe() {} },
  });
  for (const name of ['browser-settings.js', 'browser-sessions.js', 'browser.js']) vm.runInContext(source(name), context);
  vm.runInContext(section('function switchTab(', '// ---- embedded terminal') + section('function renderTabs()', '/* ============================== view building'), context);
  return { context, state, calls, writes, notices, storage, events, els, run: (code) => vm.runInContext(code, context) };
}

test('session validation bounds the schema and filters unsafe URLs without deduplicating tabs', () => {
  const h = harness();
  h.context.saved = { version: 1, active: 2, tabs: [
    { url: 'javascript:alert(1)', title: 'Unsafe' },
    { url: 'https://user:secret@example.com/', title: 'Credentials' },
    { url: 'https://same.example/', title: 'A' },
    { url: 'https://same.example/', title: 'B' },
    { url: 'about:blank', title: '' },
  ] };
  assert.deepEqual(plain(h.run('normalizeBrowserSession(saved)')), {
    version: 1, active: 0, tabs: [{ url: 'https://same.example/', title: 'A' }, { url: 'https://same.example/', title: 'B' }, { url: 'about:blank', title: '' }],
  });
  for (const saved of [null, 'invalid', { ...snapshot(), version: 2 }, { ...snapshot(), active: 3 }, { ...snapshot(), formData: 'private' }, { version: 1, active: 0, tabs: Array(31).fill({ url: 'about:blank', title: '' }) }, { version: 1, active: 0, tabs: [{ url: 'about:blank', title: 'x'.repeat(513) }] }, { ...snapshot(), extra: 'x'.repeat(256 * 1024) }]) {
    h.context.saved = saved; assert.equal(h.run('normalizeBrowserSession(saved)'), null);
  }
});

test('file rendering before restoration cannot overwrite the previous snapshot', async () => {
  const saved = snapshot(); const h = harness({ saved });
  h.run('renderTabs(); persistBrowserSession()');
  assert.deepEqual(h.storage.get('browserSession'), saved);
  assert.equal(h.writes.length, 0);
  await h.run('restoreBrowserSession()');
  assert.equal(h.state.tabs.length, 4); assert.equal(h.state.tabs[0].path, 'C:\\files');
  assert.equal(h.state.tab, 0);
  assert.equal(h.calls.length, 0, 'file-active restoration opens no websites');
  assert.ok(h.state.tabs.slice(1).every((tab) => tab.browserPending && !tab.browserReady));
  assert.deepEqual(h.storage.get('browserSession'), saved);
});

test('restoration appends all tabs once and creates only the active restored tab', async () => {
  const gate = deferred(), h = harness({ saved: snapshot(2), handler: async (command) => { if (command === 'browser_create') await gate.promise; } });
  const restoring = h.run('restoreBrowserSession()'); await tick();
  assert.equal(h.state.tabs.length, 4); assert.equal(h.state.tab, 3);
  assert.equal(h.calls.filter((call) => call.command === 'browser_create').length, 1);
  assert.deepEqual(h.storage.get('browserSession'), snapshot(2), 'loading keeps every lazy tab in the snapshot');
  assert.deepEqual([...await h.run('restoreBrowserSession()')], []);
  h.run('renderAll(); renderAll()');
  assert.equal(h.calls.filter((call) => call.command === 'browser_create').length, 1);
  gate.resolve(); await restoring;
  assert.equal(h.state.tabs[3].browserReady, true); assert.equal(h.state.tabs[1].browserReady, false);
  assert.deepEqual(h.storage.get('browserSession'), snapshot(2));
});

test('switching and closing lazy tabs maintains activity and order without creating closed pages', async () => {
  const h = harness(); await h.run('restoreBrowserSession()');
  h.run('switchTab(2)'); await tick();
  assert.equal(h.calls.filter((call) => call.command === 'browser_create').length, 1);
  assert.equal(h.storage.get('browserSession').active, 1);
  h.run('closeTab(1)'); await tick();
  assert.equal(h.calls.filter((call) => call.command === 'browser_close').length, 0);
  assert.deepEqual(h.storage.get('browserSession'), { version: 1, tabs: snapshot().tabs.slice(1), active: 0 });
  h.run('switchTab(0)');
  assert.equal(h.storage.get('browserSession').active, -1);
});

test('background title and navigation events update session URLs independently of current tab', async () => {
  const h = harness(); await h.run('restoreBrowserSession()');
  h.context.key = h.state.tabs[2].key;
  h.run("onBrowserPage({ payload: { key, phase: 'finished', url: 'https://redirect.example/' } }); onBrowserPage({ payload: { key, phase: 'title', title: '<script>Title</script>' } });");
  assert.deepEqual(h.storage.get('browserSession').tabs[1], { url: 'https://redirect.example/', title: '<script>Title</script>' });
  assert.equal(h.storage.get('browserSession').active, -1);
  assert.equal(h.state.tabs[3].url, 'https://same.example/', 'duplicate URL tabs keep independent identities');
});

test('failed restoration preserves the page and retries only after an explicit reload', async () => {
  let failures = 1;
  const h = harness({ saved: snapshot(0), handler: async (command) => { if (command === 'browser_create' && failures-- > 0) throw new Error('runtime unavailable'); } });
  await h.run('restoreBrowserSession()');
  assert.equal(h.state.tabs[1].browserReady, false); assert.match(h.state.tabs[1].error, /runtime unavailable/);
  assert.match(h.els.browserHost.innerHTML, /data-browser-retry/);
  h.run('renderAll(); renderAll()'); await tick();
  assert.equal(h.calls.filter((call) => call.command === 'browser_create').length, 1);
  await h.run("browserAction('reload')");
  assert.equal(h.state.tabs[1].browserReady, true);
  assert.equal(h.calls.filter((call) => call.command === 'browser_create').length, 2);
  assert.equal(h.storage.get('browserSession').tabs.length, 3);
});

test('closing a tab during native startup cleans up the late child and cannot resurrect its snapshot', async () => {
  const gate = deferred(), h = harness({ saved: null, handler: async (command) => { if (command === 'browser_create') await gate.promise; } });
  await h.run('restoreBrowserSession()');
  const creation = h.run("newBrowserTab('https://pending.example/')"); await tick();
  const key = h.state.tabs[1].key;
  h.run('closeTab(1)'); assert.equal(h.storage.get('browserSession'), null);
  gate.resolve(); await creation;
  assert.equal(h.calls.filter((call) => call.command === 'browser_close' && call.args.key === key).length, 1);
  h.context.key = key;
  h.run("onBrowserPage({ payload: { key, phase: 'finished', url: 'https://pending.example/' } })");
  assert.equal(h.state.tabs.length, 1); assert.equal(h.storage.get('browserSession'), null);
});

test('disabling session restore or URL history clears snapshots and prevents future persistence', async () => {
  for (const preference of ['restoreSession', 'recordHistory']) {
    const h = harness(); await h.run('restoreBrowserSession()');
    h.context.settings = { restoreSession: true, recordHistory: true, homeUrl: 'https://www.google.com/', [preference]: false };
    await h.run('saveBrowserSettings(settings)');
    assert.equal(h.storage.get('browserSession'), null);
    h.run('persistBrowserSession(); renderTabs()');
    assert.equal(h.storage.get('browserSession'), null);
    assert.equal(h.state.tabs.length, 4, 'privacy preference does not close current tabs');
    const restarted = harness({ saved: snapshot(), settings: plain(h.storage.get('browserSettings')) });
    await restarted.run('restoreBrowserSession()');
    assert.equal(restarted.state.tabs.length, 1); assert.equal(restarted.storage.get('browserSession'), null);
  }
});

test('session persistence contains only bounded page metadata and retains the active tab at the limit', async () => {
  const h = harness({ saved: null }); await h.run('restoreBrowserSession()');
  for (let i = 0; i < 40; i++) h.state.tabs.push({ kind: 'browser', key: `tab-${i}`, url: `https://example.com/${i}`, title: '😀'.repeat(600), formData: 'secret', dom: '<input value=secret>', history: ['private'] });
  h.state.tabs.push({ kind: 'term', cwd: 'C:\\secret', output: 'secret' });
  h.state.tab = 40; h.run('persistBrowserSession()');
  const saved = h.storage.get('browserSession');
  assert.equal(saved.tabs.length, 30); assert.equal(saved.active, 29);
  assert.equal(saved.tabs[29].url, 'https://example.com/39');
  assert.ok(saved.tabs.every((tab) => [...tab.title].length === 512));
  assert.ok(saved.tabs.every((tab) => Object.keys(tab).sort().join(',') === 'title,url'));
  assert.equal(JSON.stringify(saved).includes('secret'), false);
  assert.ok(new TextEncoder().encode(JSON.stringify(saved)).length <= 256 * 1024);
});

test('exit preserves the final snapshot even if native teardown disposes every browser tab', async () => {
  const h = harness(); await h.run('restoreBrowserSession()');
  h.events.beforeunload();
  const saved = h.storage.get('browserSession');
  h.run('state.tabs.forEach((tab) => closeBrowserTab(tab)); state.tabs = []; persistBrowserSession()');
  h.events.pagehide();
  assert.deepEqual(h.storage.get('browserSession'), saved);
  const early = harness(); early.events.beforeunload();
  assert.deepEqual(early.storage.get('browserSession'), snapshot(), 'exiting during file initialization preserves unread restoration data');
});

test('app startup waits for file initialization before restoring browser pages', async () => {
  const gate = deferred(), h = harness({ saved: snapshot(0) });
  h.context.initWorkspace = () => {};
  h.context.navigate = async () => { h.run('persistBrowserSession()'); await gate.promise; };
  vm.runInContext(app.slice(app.indexOf("window.addEventListener('DOMContentLoaded'")), h.context);
  const initializing = h.events.DOMContentLoaded(); await tick();
  assert.equal(h.state.tabs.length, 1); assert.equal(h.calls.filter((call) => call.command === 'browser_create').length, 0);
  assert.deepEqual(h.storage.get('browserSession'), snapshot(0));
  gate.resolve(); await initializing;
  assert.equal(h.state.tabs.length, 4); assert.equal(h.calls.filter((call) => call.command === 'browser_create').length, 1);
});

test('navigation entered during startup survives late initial-page events and reaches the native tab', async () => {
  const gate = deferred(), h = harness({ saved: snapshot(0), handler: async (command) => { if (command === 'browser_create') await gate.promise; } });
  const restoring = h.run('restoreBrowserSession()'); await tick();
  h.context.key = h.state.tabs[1].key;
  h.run("onBrowserPage({ payload: { key, phase: 'finished', url: 'about:blank' } })");
  assert.equal(h.storage.get('browserSession').tabs[0].url, 'https://one.example/');
  h.run("browserNavigate('https://changed.example/'); onBrowserPage({ payload: { key, phase: 'finished', url: 'https://one.example/' } })");
  assert.equal(h.storage.get('browserSession').tabs[0].url, 'https://changed.example/');
  gate.resolve(); await restoring;
  assert.equal(h.calls.find((call) => call.command === 'browser_navigate').args.url, 'https://changed.example/');
  assert.equal(h.state.tabs[1].url, 'https://changed.example/');
});

test('a failed snapshot cleanup does not roll back the saved privacy preference', async () => {
  const h = harness(); await h.run('restoreBrowserSession()');
  const write = h.context.store.set;
  h.context.store.set = (key, value) => { if (key !== 'browserSession') write(key, value); };
  h.context.settings = { restoreSession: false, recordHistory: true, homeUrl: 'https://www.google.com/' };
  await assert.rejects(h.run('saveBrowserSettings(settings)'), /Browser settings saved, but saving or clearing the session snapshot failed/);
  assert.equal(h.storage.get('browserSettings').restoreSession, false);
  assert.equal(h.calls.filter((call) => call.command === 'browser_settings_apply').length, 1, 'no rollback re-enables session saving');
});

test('stale native visibility loops stop before hiding tabs after a newer synchronization', async () => {
  const gate = deferred(); let blocked = false;
  const h = harness({ saved: null, handler: async (command) => { if (command === 'browser_set_active' && !blocked) { blocked = true; await gate.promise; } } });
  await h.run('restoreBrowserSession()');
  h.state.tabs.push({ kind: 'browser', key: 'first', browserReady: true }, { kind: 'browser', key: 'second', browserReady: true });
  h.state.tab = 2;
  h.context.document.querySelector = () => ({ open: true });
  const old = h.run('syncBrowserBounds()'); await tick();
  h.context.document.querySelector = () => null;
  const latest = h.run('syncBrowserBounds()');
  gate.resolve(); await Promise.all([old, latest]);
  const second = h.calls.filter((call) => call.command === 'browser_set_active' && call.args.key === 'second');
  assert.equal(second.length, 1); assert.equal(second[0].args.active, true);
});

test('unchanged browser surfaces cause no repeated resize/show IPC', async () => {
  const h = harness({ saved: null });
  h.state.tabs.push({ kind: 'browser', key: 'first', browserReady: true }, { kind: 'browser', key: 'second', browserReady: true });
  h.state.tab = 1;
  await h.run('syncBrowserBounds()');
  const before = h.calls.length;
  await h.run('Promise.all([syncBrowserBounds(), syncBrowserBounds(), syncBrowserBounds()])');
  assert.equal(h.calls.length, before);
  h.state.tab = 2;
  await h.run('syncBrowserBounds()');
  const changed = h.calls.slice(before);
  assert.deepEqual(changed.map((call) => [call.args.key, call.args.active]), [['first', false], ['second', true]]);
  assert.ok(changed.every((call) => call.command === 'browser_set_active'));
});

test('exit during a queued native navigation preserves the user address despite old page completion', async () => {
  const creating = deferred(), navigating = deferred();
  const h = harness({ saved: snapshot(0), handler: async (command) => {
    if (command === 'browser_create') await creating.promise;
    if (command === 'browser_navigate') await navigating.promise;
  } });
  const restoring = h.run('restoreBrowserSession()'); await tick();
  h.context.key = h.state.tabs[1].key;
  h.run("browserNavigate('https://requested.example/')");
  creating.resolve(); await tick();
  assert.equal(h.calls.filter((call) => call.command === 'browser_navigate').length, 1);
  h.run("onBrowserPage({ payload: { key, phase: 'finished', url: 'https://one.example/' } })");
  h.events.beforeunload();
  assert.equal(h.storage.get('browserSession').tabs[0].url, 'https://requested.example/');
  navigating.resolve(); await restoring;
});

test('a newer address supersedes a pending navigation without old IPC completion clearing it', async () => {
  const creating = deferred(), firstNavigation = deferred();
  const h = harness({ saved: snapshot(0), handler: async (command, args) => {
    if (command === 'browser_create') await creating.promise;
    if (command === 'browser_navigate' && args.url === 'https://first.example/') await firstNavigation.promise;
  } });
  const restoring = h.run('restoreBrowserSession()'); await tick();
  h.context.key = h.state.tabs[1].key;
  h.run("browserNavigate('https://first.example/')");
  creating.resolve(); await tick();
  await h.run("browserNavigate('https://latest.example/')");
  h.run("onBrowserPage({ payload: { key, phase: 'navigating', url: 'https://first.example/' } }); onBrowserPage({ payload: { key, phase: 'finished', url: 'https://first.example/' } })");
  firstNavigation.resolve(); await restoring;
  assert.equal(h.state.tabs[1].url, 'https://latest.example/');
  assert.equal(h.state.tabs[1].pendingNavigation, 'https://latest.example/');
  assert.equal(h.storage.get('browserSession').tabs[0].url, 'https://latest.example/');
  h.run("onBrowserPage({ payload: { key, phase: 'navigating', url: 'https://latest.example/' } }); onBrowserPage({ payload: { key, phase: 'navigating', url: 'https://redirected.example/' } }); onBrowserPage({ payload: { key, phase: 'finished', url: 'https://first.example/' } }); onBrowserPage({ payload: { key, phase: 'finished', url: 'https://redirected.example/' } })");
  assert.equal(h.state.tabs[1].pendingNavigation, null);
  assert.equal(h.storage.get('browserSession').tabs[0].url, 'https://redirected.example/');
});

test('slow root discovery preserves tabs opened during startup and does not restore old activity over them', async () => {
  const roots = deferred();
  const h = harness({ saved: snapshot(2), handler: async (command) => command === 'roots' ? roots.promise : undefined });
  h.context.initWorkspace = () => {};
  let fileNavigations = 0; h.context.navigate = async () => { fileNavigations++; };
  vm.runInContext(app.slice(app.indexOf("window.addEventListener('DOMContentLoaded'")), h.context);
  const initializing = h.events.DOMContentLoaded(); await tick();
  const requested = await h.run("newBrowserTab('https://user-opened.example/')");
  roots.resolve({}); await initializing;
  assert.equal(h.state.tabs.length, 5); assert.equal(h.state.tabs[h.state.tab], requested);
  assert.equal(h.calls.filter((call) => call.command === 'browser_create').length, 1);
  assert.equal(h.calls.filter((call) => call.command === 'browser_close').length, 0);
  assert.equal(fileNavigations, 0, 'startup does not replace user navigation with the saved file path');
  assert.equal(h.storage.get('browserSession').active, 0);
  assert.equal(h.storage.get('browserSession').tabs[0].url, 'https://user-opened.example/');
});

test('switching while initial file navigation is pending retains the new active tab after restoration', async () => {
  const files = deferred(), h = harness({ saved: snapshot(1) });
  h.context.initWorkspace = () => {};
  h.context.navigate = async () => { h.state.navToken++; await files.promise; };
  vm.runInContext(app.slice(app.indexOf("window.addEventListener('DOMContentLoaded'")), h.context);
  const initializing = h.events.DOMContentLoaded(); await tick();
  const requested = await h.run("newBrowserTab('https://chosen.example/')");
  files.resolve(); await initializing;
  assert.equal(h.state.tabs[h.state.tab], requested);
  assert.equal(h.calls.filter((call) => call.command === 'browser_create').length, 1);
});

test('back navigation supersedes an unstarted address request and accepts the destination events', async () => {
  const navigating = deferred();
  const h = harness({ saved: snapshot(0), handler: async (command) => { if (command === 'browser_navigate') await navigating.promise; } });
  await h.run('restoreBrowserSession()');
  h.context.key = h.state.tabs[1].key;
  const pending = h.run("browserNavigate('https://pending.example/')");
  const revision = h.state.tabs[1].navigationRevision;
  h.run("browserAction('back'); onBrowserPage({ payload: { key, phase: 'navigating', url: 'https://previous.example/' } }); onBrowserPage({ payload: { key, phase: 'finished', url: 'https://previous.example/' } })");
  assert.equal(h.state.tabs[1].pendingNavigation, null);
  assert.ok(h.state.tabs[1].navigationRevision > revision);
  assert.equal(h.storage.get('browserSession').tabs[0].url, 'https://previous.example/');
  navigating.resolve(); await pending;
  assert.equal(h.state.tabs[1].url, 'https://previous.example/');
});
