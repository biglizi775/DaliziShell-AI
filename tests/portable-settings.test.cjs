const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../ui/portable-settings.js'), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
function harness(initial = {}, invoke = async () => null) {
  const storage = new Map(Object.entries(initial).map(([k, v]) => ['df.' + k, JSON.stringify(v)]));
  const notices = [], calls = [];
  const context = vm.createContext({ console, URL, Date, Map, Set, crypto: require('node:crypto').webcrypto,
    locale: 'en', dfmt: null, previewOpen: false, agentFloating: false, aiPanelOpen: true, columnLayout: {}, aiSettings: {}, aiModelPresets: [],
    state: { viewMode: 'details', sortKey: 'name', sortDir: 1, showHidden: false }, PLACE_LIMIT: 100,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    store: { get: (k, d) => storage.has('df.' + k) ? JSON.parse(storage.get('df.' + k)) : d },
    $: () => null, toast: (...args) => notices.push(args), normalizeColumns: (v) => v,
    aiPublicSettings: (v) => ({ endpoint: v.endpoint || '', model: v.model || '' }),
    workspacePreferences: () => ({}), aiMemoryPreferences: () => ({}), browserSettings: () => ({}),
    readFavorites: () => JSON.parse(storage.get('df.favorites') || '{"items":[]}').items,
    invoke: async (cmd, args) => { calls.push({ cmd, args: args && plain(args) }); return invoke(cmd, args); },
  });
  vm.runInContext(source, context);
  return { context, storage, notices, calls, run: (s) => vm.runInContext(s, context), get: (key) => JSON.parse(storage.get('df.' + key) || 'null') };
}
const folder = { id: 'folder', kind: 'files', path: 'D:\\Local', name: 'Local' };
const website = { id: 'web', kind: 'browser', url: 'https://example.com/', name: 'Example' };

test('startup loads portable values before hydration and preserves this computer’s paths', async () => {
  const h = harness({ pinned: ['D:\\Local'], lastPath: 'D:\\Local', favorites: { version: 1, items: [folder] }, browserSettings: { downloadDirectory: 'D:\\Downloads', homeUrl: 'https://old.example/' } }, async () => ({ enabled: true, settings: { theme: 'dark', locale: 'zh', 'columns.v1': { order: ['size', 'name'] }, aiSettings: { endpoint: 'https://api.example/v1', model: 'fixture' }, browserSettings: { homeUrl: 'https://example.com/' }, favorites: { version: 1, items: [website] }, urlHistory: [] } }));
  await h.run('initPortableSettings()');
  assert.equal(h.context.locale, 'zh'); assert.equal(h.get('theme'), 'dark');
  assert.equal(h.context.aiSettings.model, 'fixture');
  assert.equal(h.get('browserSettings').downloadDirectory, 'D:\\Downloads');
  assert.equal(h.get('lastPath'), 'D:\\Local');
  assert.deepEqual(h.get('favorites').items, [website, folder]);
  assert.deepEqual(h.get('urlHistory'), []);
  assert.equal(h.notices.length, 0);
});

test('disabled or corrupt files leave local settings untouched and never auto-save', async () => {
  for (const reply of [{ enabled: false, settings: { theme: 'dark' } }, { enabled: false, error: 'corrupt file preserved' }]) {
    const h = harness({ theme: 'light' }, async () => reply);
    await h.run('initPortableSettings()');
    h.run('portableSettingsChanged("theme")');
    assert.equal(h.get('theme'), 'light'); assert.equal(h.calls.length, 1);
  }
});

test('portable import is all-or-nothing when localStorage fails', () => {
  const h = harness({ theme: 'light', locale: 'en' });
  const original = h.context.localStorage.setItem;
  let failed = false;
  h.context.localStorage.setItem = (key, value) => { if (key === 'df.theme' && !failed) { failed = true; throw new Error('quota'); } return original(key, value); };
  assert.throws(() => h.run('applyPortableSettings({locale:"zh",theme:"dark"})'), /quota/);
  assert.equal(h.get('locale'), 'en'); assert.equal(h.get('theme'), 'light');
});

test('bookmark capacity conflicts preserve both sources instead of dropping entries', () => {
  const h = harness({ favorites: { version: 1, items: Array.from({ length: 100 }, (_, i) => ({ ...folder, id: 'folder-' + i })) }, theme: 'light' });
  h.context.input = { theme: 'dark', favorites: { version: 1, items: [website] } };
  assert.throws(() => h.run('applyPortableSettings(input)'), /exceed 100/);
  assert.equal(h.get('theme'), 'light'); assert.equal(h.get('favorites').items.length, 100);
});

test('queued writes serialize and persist history clearing while another write is pending', async () => {
  let release;
  const h = harness({ urlHistory: [{ url: 'https://example.com/', title: 'Example' }] }, async (cmd, args) => {
    if (cmd === 'portable_settings_load') return { enabled: true, settings: {} };
    if (!release) await new Promise((resolve) => { release = resolve; });
    return { enabled: args.enabled, updatedAt: 1 };
  });
  await h.run('initPortableSettings()');
  h.storage.set('df.theme', '"dark"'); h.run('portableSettingsChanged("theme")');
  h.storage.set('df.urlHistory', '[]'); h.run('portableSettingsChanged("urlHistory")');
  release(); await h.run('writePortableQueue()');
  const writes = h.calls.filter((c) => c.cmd === 'portable_settings_save');
  assert.equal(writes.length, 2); assert.deepEqual(writes[1].args.settings.urlHistory, []);
  assert.equal(h.run('portableWriter'), null);
});

test('write failure pauses automatic writes and an explicit retry can recover', async () => {
  let fail = true;
  const h = harness({}, async (cmd, args) => {
    if (cmd === 'portable_settings_load') return { enabled: true, settings: {} };
    if (fail) throw new Error('read-only directory');
    return { enabled: args.enabled, updatedAt: 1 };
  });
  await h.run('initPortableSettings()');
  h.storage.set('df.theme', '"dark"'); h.run('portableSettingsChanged("theme")'); await h.run('writePortableQueue()');
  assert.equal(h.run('portablePaused'), true); assert.equal(h.notices.length, 1);
  const before = h.calls.length; h.run('portableSettingsChanged("theme")'); assert.equal(h.calls.length, before);
  fail = false; await h.run('setPortableEnabled(true)'); assert.equal(h.run('portablePaused'), false);
});
