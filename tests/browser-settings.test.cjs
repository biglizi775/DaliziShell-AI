const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const defaults = {
  homeUrl: 'https://www.google.com/', newTabPage: 'home', searchEngine: 'google',
  recordHistory: true, restoreSession: false, allowNewWindows: true, zoom: 1, javascriptEnabled: true,
  contextMenusEnabled: true, devToolsEnabled: true, autofillEnabled: true,
  passwordAutosaveEnabled: false, colorScheme: 'system', downloadDirectory: '',
};
const plain = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(setImmediate);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};

// Run the real browser modules against observable storage and IPC. The small DOM
// adapter models form values and events; no URL or settings logic is reproduced.
function harness({ settings, history = [], browser = false, sessions = false, invoke = async () => undefined } = {}) {
  const fields = new Map(), named = new Map(), saved = [], calls = [], notices = [];
  const storage = new Map([['urlHistory', structuredClone(history)]]);
  if (settings !== undefined) storage.set('browserSettings', structuredClone(settings));
  let nextId = 0;
  const elements = [];
  const find = (selector) => {
    if (selector.startsWith('#')) return fields.get(selector.slice(1)) || null;
    const match = selector.match(/^\[name=["']?([^\]"']+)["']?\]$/);
    if (match) return named.get(match[1]) || null;
    if (selector === 'dialog[open]') return elements.find((node) => node.tagName === 'DIALOG' && node.open) || null;
    if (selector === 'form') return elements.findLast((node) => node.tagName === 'FORM') || null;
    if (selector === '[type=submit]') return elements.findLast((node) => node.type === 'submit') || null;
    return null;
  };
  function element(tag = 'div') {
    let id = '', html = '';
    const node = {
      tagName: tag.toUpperCase(), value: '', checked: false, disabled: false, open: false,
      hidden: false, textContent: '', dataset: {}, listeners: {}, attributes: {},
      classList: { contains: () => true, toggle() {}, add() {}, remove() {} },
      setAttribute(key, value) { this.attributes[key] = value; },
      removeAttribute(key) { delete this.attributes[key]; },
      addEventListener(type, handler) { this.listeners[type] = handler; },
      querySelector: find,
      querySelectorAll(selector) {
        if (selector === 'input:checked:not(:disabled)') return [...named.values()].filter((node) => node.tagName === 'INPUT' && node.checked && !node.disabled);
        if (selector.includes('input') || selector.includes('select') || selector === '[name]') return [...named.values()];
        return [];
      },
      appendChild(child) { return child; }, focus() {}, select() {},
      remove() { if (id) fields.delete(id); },
      showModal() { this.open = true; },
      close() { this.open = false; this.listeners.close?.({}); },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      elements: { namedItem: (name) => named.get(name) || null },
    };
    Object.defineProperty(node, 'id', { get: () => id, set: (value) => { id = value; fields.set(value, node); } });
    Object.defineProperty(node, 'innerHTML', {
      get: () => html,
      set: (value) => {
        html = String(value);
        for (const match of html.matchAll(/<(form|input|select|button|p|span|div)\b([^>]*)>/g)) {
          const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)=["']([^"']*)["']/g)].map((attr) => [attr[1], attr[2]]));
          const child = element(match[1]);
          if (attrs.id) child.id = attrs.id;
          if (attrs.name) { child.name = attrs.name; named.set(attrs.name, child); }
          if (attrs.value) child.value = attrs.value;
          if (attrs.type) child.type = attrs.type;
          child.disabled = /\bdisabled(?:\s|$)/.test(match[2]);
        }
      },
    });
    elements.push(node);
    return node;
  }
  const els = new Proxy({}, { get(target, key) { return target[key] ||= element(); } });
  const state = { tabs: [], tab: -1, navToken: 0, folderHistory: [] };
  const noop = () => {};
  const context = vm.createContext({
    URL, TextEncoder, console, locale: 'en', state, els, setTimeout, clearTimeout,
    crypto: { randomUUID: () => `browser-${++nextId}` },
    $: (id) => fields.get(id) || null,
    esc: (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    store: {
      get: (key, fallback) => storage.has(key) ? structuredClone(storage.get(key)) : fallback,
      set: (key, value) => { saved.push({ key, value: plain(value) }); storage.set(key, plain(value)); },
    },
    invoke: async (command, args) => { calls.push({ command, args: plain(args ?? {}) }); return invoke(command, args); },
    listen: async () => noop, toast: (...args) => notices.push(args),
    curTab: () => state.tabs[state.tab], isBrowserTab: (tab) => tab?.kind === 'browser',
    renderAll: noop, renderTabs: noop, renderCrumbs: noop, renderStatus: noop, updateTitle: noop,
    document: { createElement: element, body: element('body'), querySelector: find },
    window: { addEventListener: noop }, MutationObserver: class { observe() {} },
    IC: {}, openBrowserExtensions: noop, openWorkspaceSettings: noop, closeMenu: noop,
  });
  vm.runInContext(readFileSync(path.join(__dirname, '../ui/browser-settings.js'), 'utf8'), context);
  if (sessions) vm.runInContext(readFileSync(path.join(__dirname, '../ui/browser-sessions.js'), 'utf8'), context);
  if (browser) vm.runInContext(readFileSync(path.join(__dirname, '../ui/browser.js'), 'utf8'), context);
  return {
    context, state, calls, saved, notices, storage, named,
    get: (id) => fields.get(id), run: (code) => vm.runInContext(code, context),
    async open() { await vm.runInContext('openBrowserSettings()', context); },
    async submit() { await fields.get('browserSettingsForm').listeners.submit({ preventDefault() {} }); await tick(); },
  };
}

test('browser settings normalize missing and malformed storage into usable defaults', () => {
  const h = harness();
  for (const value of [undefined, null, false, 'invalid', [], {}]) {
    h.context.raw = value;
    assert.deepEqual(plain(h.run('normalizeBrowserSettings(raw)')), defaults);
  }
  assert.deepEqual(plain(h.run('browserSettings()')), defaults);
  assert.equal(h.saved.length, 0, 'reading old or missing settings does not write storage');
});

test('browser settings preserve explicit false values and discard unknown fields', () => {
  const settings = {
    ...defaults, recordHistory: false, allowNewWindows: false, javascriptEnabled: false,
    contextMenusEnabled: false, devToolsEnabled: false, autofillEnabled: false,
    passwordAutosaveEnabled: true, newTabPage: 'blank', colorScheme: 'dark',
    searchEngine: 'bing', homeUrl: 'https://example.test/start', zoom: 1.5,
    downloadDirectory: 'C:\\Downloads', apiKey: 'unrelated-secret', arbitrary: { code: true },
  };
  const h = harness({ settings });
  const expected = { ...settings }; delete expected.apiKey; delete expected.arbitrary;
  assert.deepEqual(plain(h.run('browserSettings()')), expected);
  assert.equal(h.saved.length, 0);
});

test('invalid enum values and executable home URLs cannot become live browser settings', () => {
  const h = harness();
  h.context.raw = { searchEngine: 'injected', newTabPage: 'script', colorScheme: 'purple', homeUrl: 'javascript:alert(1)', zoom: NaN };
  assert.deepEqual(plain(h.run('normalizeBrowserSettings(raw)')), defaults);
  for (const zoom of [-5, 0, Infinity, 'not-a-number']) {
    h.context.raw = { zoom };
    const normalized = h.run('normalizeBrowserSettings(raw).zoom');
    assert.ok(Number.isFinite(normalized) && normalized > 0, `${zoom} must not reach native zoom`);
  }
});

test('browser address resolution separates explicit URLs, local servers and search text', () => {
  const h = harness({ settings: { ...defaults, homeUrl: 'https://home.example/start' } });
  const cases = [
    ['', 'https://home.example/start'], ['  ', 'https://home.example/start'],
    ['https://example.com/path?q=x#section', 'https://example.com/path?q=x#section'],
    ['http://example.com/', 'http://example.com/'], ['about:blank', 'about:blank'],
    [' example.com/path ', 'https://example.com/path'],
    ['localhost:3000/app', 'http://localhost:3000/app'],
    ['127.0.0.1:8080/api', 'http://127.0.0.1:8080/api'],
    ['192.168.1.20:9090/', 'https://192.168.1.20:9090/'],
    ['[::1]:3000/app', 'http://[::1]:3000/app'],
  ];
  for (const [value, expected] of cases) {
    h.context.value = value;
    assert.equal(h.run('resolveBrowserAddress(value)'), expected, value);
  }
});

test('each search engine receives correctly encoded words and Chinese queries', () => {
  const h = harness();
  const engines = {
    google: ['www.google.com', 'q'], bing: ['www.bing.com', 'q'],
    baidu: ['www.baidu.com', 'wd'], duckduckgo: ['duckduckgo.com', 'q'],
  };
  for (const [searchEngine, [host, parameter]] of Object.entries(engines)) {
    for (const value of ['rust', '文件搜索', 'rust & Windows #tips']) {
      h.context.value = value; h.context.options = { ...defaults, searchEngine };
      const resolved = new URL(h.run('resolveBrowserAddress(value, options)'));
      assert.equal(resolved.protocol, 'https:'); assert.equal(resolved.hostname, host);
      assert.equal(resolved.searchParams.get(parameter), value);
    }
  }
});

test('unsupported explicit schemes are rejected instead of turned into searches', () => {
  const h = harness();
  for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'file:///C:/private.txt', 'ftp://example.com/', 'mailto:user@example.com', 'about:config']) {
    h.context.value = value;
    assert.throws(() => h.run('resolveBrowserAddress(value)'), undefined, value);
  }
  assert.equal(h.calls.length, 0);
});

test('addresses reject credentials, oversized input and embedded control characters', () => {
  const h = harness();
  for (const value of ['https://name:secret@example.com/', 'https://name@example.com/', 'https://example.com/a\u0000b', 'a'.repeat(4097)]) {
    h.context.value = value;
    assert.throws(() => h.run('resolveBrowserAddress(value)'), undefined, value.slice(0, 80));
  }
});

test('history-disabled browsing keeps tab navigation but never persists page or title events', () => {
  const existing = [{ url: 'https://example.test/', title: 'Old title', visitedAt: 10 }];
  const h = harness({ browser: true, settings: { ...defaults, recordHistory: false }, history: existing });
  const tab = { kind: 'browser', key: 'tab-a', url: 'https://example.test/', title: '', history: [], hIdx: -1 };
  h.state.tabs.push(tab); h.state.tab = 0;
  h.run("onBrowserPage({ payload: { key: 'tab-a', phase: 'finished', url: 'https://example.test/' } }); onBrowserPage({ payload: { key: 'tab-a', phase: 'title', title: 'Private title' } });");
  assert.deepEqual([...tab.history], ['https://example.test/']); assert.equal(tab.hIdx, 0);
  assert.equal(h.saved.filter((entry) => entry.key === 'urlHistory').length, 0);
  assert.deepEqual(h.storage.get('urlHistory'), existing);
});

test('enabled URL history deduplicates visits and refreshes the visible title', () => {
  const h = harness({ browser: true, settings: defaults });
  h.state.tabs.push({ kind: 'browser', key: 'tab-a', url: '', title: '', history: [], hIdx: -1 }); h.state.tab = 0;
  h.run("onBrowserPage({ payload: { key: 'tab-a', phase: 'finished', url: 'https://example.test/' } }); onBrowserPage({ payload: { key: 'tab-a', phase: 'title', title: 'Example' } }); onBrowserPage({ payload: { key: 'tab-a', phase: 'finished', url: 'https://example.test/' } });");
  const history = h.storage.get('urlHistory');
  assert.equal(history.length, 1); assert.equal(history[0].title, 'Example');
});

test('popup preference blocks new-window requests without disabling ordinary browser tabs', async () => {
  const h = harness({ browser: true, settings: { ...defaults, allowNewWindows: false } });
  h.state.tabs.push({ kind: 'browser', key: 'tab-a', history: [], hIdx: -1 }); h.state.tab = 0;
  h.run("onBrowserPage({ payload: { key: 'tab-a', phase: 'new-window', url: 'https://popup.example/' } })");
  await tick();
  assert.equal(h.state.tabs.length, 1); assert.equal(h.calls.length, 0);
  await h.run("newBrowserTab('https://requested.example/')");
  assert.equal(h.state.tabs.length, 2);
  assert.equal(h.calls.find((call) => call.command === 'browser_create').args.url, 'https://requested.example/');
});

test('new-tab blank preference differs from empty address and explicit navigation', async () => {
  const settings = { ...defaults, newTabPage: 'blank', homeUrl: 'https://home.example/' };
  const h = harness({ browser: true, settings });
  await h.run('newBrowserTab()');
  assert.equal(h.calls.find((call) => call.command === 'browser_create').args.url, 'about:blank');
  assert.equal(h.run("resolveBrowserAddress('')"), 'https://home.example/');
  await h.run("newBrowserTab('https://explicit.example/')");
  assert.equal(h.calls.filter((call) => call.command === 'browser_create').at(-1).args.url, 'https://explicit.example/');
});

test('configured home and native page preferences reach newly created tabs', async () => {
  const settings = { ...defaults, homeUrl: 'https://home.example/start', zoom: 1.5, javascriptEnabled: false, colorScheme: 'dark' };
  const h = harness({ browser: true, settings });
  await h.run('newBrowserTab()');
  const create = h.calls.find((call) => call.command === 'browser_create').args;
  assert.equal(create.url, settings.homeUrl);
  assert.deepEqual(create.settings, {
    zoom: 1.5, javascriptEnabled: false, contextMenusEnabled: true, devToolsEnabled: true,
    autofillEnabled: true, passwordAutosaveEnabled: false, colorScheme: 'dark', downloadDirectory: '',
  });
  assert.equal(await h.run("newBrowserTab('javascript:alert(1)')"), null);
  assert.equal(h.state.tabs.length, 1, 'invalid addresses do not create broken tabs');
});

test('failed native settings application retains the saved configuration and editable draft', async () => {
  const h = harness({ browser: true, settings: defaults, invoke: async () => { throw new Error('native settings rejected'); } });
  await h.open();
  h.named.get('zoom').value = '1.5'; h.named.get('recordHistory').checked = false;
  await h.submit();
  assert.ok(h.calls.length > 0, 'save must first attempt native configuration');
  assert.equal(h.saved.filter((entry) => entry.key === 'browserSettings').length, 0);
  assert.deepEqual(h.storage.get('browserSettings'), defaults);
  assert.equal(h.get('browserSettingsDialog').open, true);
  assert.equal(h.named.get('zoom').value, '1.5');
  assert.match(h.get('browserSettingsStatus').textContent, /native settings rejected/);
  assert.equal(h.named.get('zoom').disabled, false, 'failure permits correction and retry');
});

test('browser settings are persisted only after the native application succeeds', async () => {
  const native = deferred();
  const h = harness({ browser: true, settings: defaults, invoke: async () => native.promise });
  await h.open();
  h.named.get('zoom').value = '1.5';
  const saving = h.submit();
  await tick();
  assert.equal(h.saved.length, 0, 'in-flight native application must not change preferences');
  await h.submit();
  assert.equal(h.calls.filter((call) => call.command === 'browser_settings_apply').length, 1, 'repeated submit cannot race the pending save');
  native.resolve(); await saving;
  assert.equal(h.storage.get('browserSettings').zoom, 1.5);
  assert.match(h.get('browserSettingsStatus').textContent, /Saved/);
});

test('failed local persistence reapplies previous native preferences and reports the failure', async () => {
  const h = harness({ settings: defaults });
  h.context.store.set = () => {}; // Match storage being unavailable without throwing.
  h.context.draft = { ...defaults, zoom: 1.5, javascriptEnabled: false };
  await assert.rejects(h.run('saveBrowserSettings(draft)'), /Could not save preferences/);
  assert.deepEqual(h.calls.map((call) => call.command), ['browser_settings_apply', 'browser_settings_apply']);
  assert.equal(h.calls[0].args.settings.zoom, 1.5);
  assert.equal(h.calls[1].args.settings.zoom, 1);
  assert.equal(h.calls[1].args.settings.javascriptEnabled, true);
  assert.deepEqual(h.storage.get('browserSettings'), defaults);
});

test('reset and close edit only the draft, and an invalid home never reaches native apply', async () => {
  const settings = { ...defaults, zoom: 1.5, recordHistory: false };
  const h = harness({ settings });
  await h.open();
  h.named.get('homeUrl').value = 'javascript:alert(1)';
  await h.submit();
  assert.equal(h.calls.length, 0); assert.equal(h.saved.length, 0);
  const action = (name) => h.get('browserSettingsDialog').listeners.click({ target: { closest: (selector) => selector === '[data-browser-settings-action]' ? { dataset: { browserSettingsAction: name } } : null } });
  action('reset');
  assert.equal(h.named.get('zoom').value, '1'); assert.equal(h.named.get('recordHistory').checked, true);
  assert.equal(h.saved.length, 0); assert.equal(h.calls.length, 0);
  action('close');
  assert.deepEqual(h.storage.get('browserSettings'), settings);
});

test('clearing only URL history leaves folder history and current back-forward lists intact', async () => {
  const h = harness({ browser: true, history: [{ url: 'https://old.example/', title: 'Old', visitedAt: 1 }] });
  h.state.folderHistory = [{ path: 'C:\\work', visitedAt: 2 }];
  h.state.tabs.push({ kind: 'browser', key: 'tab-a', browserReady: true, history: ['https://old.example/'], hIdx: 0 }); h.state.tab = 0;
  h.run('openBrowserClearData()');
  const form = h.get('browserClearDataForm');
  await form.listeners.submit({ preventDefault() {} });
  assert.equal(h.saved.length, 0, 'empty selection never clears anything');
  h.named.get('history').checked = true;
  await form.listeners.submit({ preventDefault() {} });
  assert.deepEqual(h.storage.get('urlHistory'), []);
  assert.deepEqual(h.state.folderHistory, [{ path: 'C:\\work', visitedAt: 2 }]);
  assert.deepEqual(h.state.tabs[0].history, ['https://old.example/']);
  assert.equal(h.calls.length, 0, 'app URL history does not request a native profile wipe');
});

test('native cleanup failure preserves selected app history and permits a retry', async () => {
  const history = [{ url: 'https://old.example/', title: 'Old', visitedAt: 1 }];
  const h = harness({ browser: true, history, invoke: async () => { throw new Error('profile is busy'); } });
  h.state.tabs.push({ kind: 'browser', key: 'original-tab', browserReady: true, history: [], hIdx: -1 }); h.state.tab = 0;
  h.run('openBrowserClearData()');
  h.named.get('history').checked = true; h.named.get('cache').checked = true;
  h.state.tabs.push({ kind: 'browser', key: 'other-tab', browserReady: true, history: [], hIdx: -1 }); h.state.tab = 1;
  await h.get('browserClearDataForm').listeners.submit({ preventDefault() {} });
  assert.deepEqual(h.calls, [{ command: 'browser_clear_data', args: { key: 'original-tab', kinds: ['cache'] } }]);
  assert.deepEqual(h.storage.get('urlHistory'), history);
  assert.equal(h.named.get('history').checked, true); assert.equal(h.named.get('cache').disabled, false);
  assert.match(h.get('browserClearStatus').textContent, /profile is busy/);
});

test('saved session cleanup is separately selectable without requesting native profile deletion', async () => {
  const h = harness({ browser: true, sessions: true });
  h.storage.set('browserSession', { version: 1, tabs: [{ url: 'https://saved.example/', title: 'Saved' }], active: -1 });
  h.storage.set('urlHistory', [{ url: 'https://history.example/', title: 'History', visitedAt: 1 }]);
  h.run('openBrowserClearData()');
  h.named.get('session').checked = true;
  await h.get('browserClearDataForm').listeners.submit({ preventDefault() {} });
  assert.equal(h.storage.get('browserSession'), null);
  assert.equal(h.storage.get('urlHistory').length, 1);
  assert.equal(h.calls.length, 0);
  assert.equal(h.named.get('session').disabled, false, 'snapshot cleanup remains available without a native browser');
});

test('download shortcuts retain unsaved settings and dispatch only clean forms', async () => {
  const h = harness(), actions = [];
  h.context.openBrowserDownloads = (dialog) => actions.push(['downloads', dialog]);
  h.context.openBrowserDownloadFolder = (dialog) => actions.push(['download-folder', dialog]);
  await h.open();
  const action = (name) => h.get('browserSettingsDialog').listeners.click({ target: { closest: (selector) => selector === '[data-browser-settings-action]' ? { dataset: { browserSettingsAction: name } } : null } });
  h.named.get('zoom').value = '1.5';
  action('downloads'); action('download-folder');
  assert.equal(actions.length, 0); assert.equal(h.get('browserSettingsDialog').open, true);
  assert.match(h.get('browserSettingsStatus').textContent, /Save your changes/);
  h.named.get('zoom').value = '1';
  action('downloads'); action('download-folder');
  assert.deepEqual(actions.map(([name]) => name), ['downloads', 'download-folder']);
  assert.ok(actions.every(([, dialog]) => dialog === h.get('browserSettingsDialog')));
  assert.equal(h.saved.length, 0, 'shortcuts never implicitly save the form');
});
