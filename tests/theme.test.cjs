const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const themeSource = fs.readFileSync(path.join(__dirname, '../ui/theme.js'), 'utf8');
const settingsSource = fs.readFileSync(path.join(__dirname, '../ui/workspace-settings.js'), 'utf8');

function harness(raw = {}) {
  const storage = new Map(Object.entries(raw));
  const dataset = {}, calls = [];
  const context = vm.createContext({
    document: { documentElement: { dataset } },
    localStorage: { getItem: (key) => storage.get(key) ?? null },
    window: { __TAURI__: { core: { invoke: async (cmd, args) => { calls.push({ cmd, args: JSON.parse(JSON.stringify(args)) }); } } } },
  });
  vm.runInContext(themeSource, context);
  return { context, storage, dataset, calls, run: (source) => vm.runInContext(source, context) };
}

test('pre-paint defaults use studio while saved style and color theme restore independently', () => {
  assert.deepEqual(harness().dataset, { theme: 'light', visualStyle: 'studio' });
  for (const visualStyle of ['studio', 'classic']) for (const theme of ['light', 'dark']) {
    const h = harness({ 'df.visualStyle': JSON.stringify(visualStyle), 'df.theme': JSON.stringify(theme) });
    assert.deepEqual(h.dataset, { theme, visualStyle });
    assert.equal(h.calls.length, 0, 'pre-paint restoration needs no asynchronous native request');
  }
});

test('malformed storage values and denied storage cannot break early appearance restoration', () => {
  for (const raw of ['broken JSON', 'null', '{}', 'true', '42', '"unknown"', '["classic"]']) {
    assert.deepEqual(harness({ 'df.theme': '"dark"', 'df.visualStyle': raw }).dataset,
      { theme: 'dark', visualStyle: 'studio' });
  }
  const h = harness({ 'df.theme': 'not json', 'df.visualStyle': '"classic"' });
  assert.deepEqual(h.dataset, { theme: 'light', visualStyle: 'classic' });
  h.context.localStorage.getItem = () => { throw new Error('Storage denied'); };
  h.run(themeSource);
  assert.deepEqual(h.dataset, { theme: 'light', visualStyle: 'studio' });
});

test('style switches preserve light/dark while synchronizing the native backing surface', async () => {
  const h = harness({ 'df.theme': '"dark"' });
  h.run('applyWorkspaceVisualStyle("classic")');
  assert.deepEqual(h.dataset, { theme: 'dark', visualStyle: 'classic' });
  await h.run('applyWorkspaceTheme("light")');
  assert.deepEqual(h.dataset, { theme: 'light', visualStyle: 'classic' });
  h.run('applyWorkspaceVisualStyle("studio")');
  await h.run('applyWorkspaceTheme("dark")');
  assert.deepEqual(h.dataset, { theme: 'dark', visualStyle: 'studio' });
  h.run('applyWorkspaceVisualStyle("invalid")');
  assert.equal(h.dataset.visualStyle, 'studio');
  assert.deepEqual(h.calls, [
    { cmd: 'ui_set_theme', args: { theme: 'dark', visualStyle: 'classic' } },
    { cmd: 'ui_set_theme', args: { theme: 'light', visualStyle: 'classic' } },
    { cmd: 'ui_set_theme', args: { theme: 'light', visualStyle: 'studio' } },
    { cmd: 'ui_set_theme', args: { theme: 'dark', visualStyle: 'studio' } },
    { cmd: 'ui_set_theme', args: { theme: 'dark', visualStyle: 'studio' } },
  ]);
});

test('the settings control saves and restores a classic-to-studio change without changing theme', () => {
  const h = harness({ 'df.theme': '"dark"', 'df.visualStyle': '"studio"' });
  const controls = Object.fromEntries(['workspaceTheme', 'workspaceVisualStyle', 'workspacePreview', 'workspaceSettingsStatus']
    .map((id) => [id, { value: '', checked: false, textContent: '', listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } }]));
  const dialog = { open: false, innerHTML: '', setAttribute() {}, querySelectorAll: () => [],
    querySelector: (selector) => controls[selector.slice(1)], showModal() { this.open = true; } };
  let layoutChanges = 0;
  Object.assign(h.context, {
    locale: 'zh', previewOpen: false, IC: {}, esc: String, closeMenu() {},
    $: (id) => id === 'workspaceSettings' ? dialog : controls[id],
    store: { set: (key, value) => h.storage.set('df.' + key, JSON.stringify(value)) },
    renderWorkspace: () => h.run('syncWorkspaceSettings()'), scheduleContentLayout: () => { layoutChanges++; },
  });
  h.run(settingsSource + '\nopenWorkspaceSettings()');
  assert.match(dialog.innerHTML, /界面风格/);
  assert.equal(controls.workspaceVisualStyle.value, 'studio');
  const changeStyle = (value) => controls.workspaceVisualStyle.listeners.change({ target: { value } });
  changeStyle('classic');
  assert.equal(controls.workspaceVisualStyle.value, 'classic');
  assert.equal(h.storage.get('df.visualStyle'), '"classic"');
  assert.deepEqual(harness(Object.fromEntries(h.storage)).dataset, { theme: 'dark', visualStyle: 'classic' });
  changeStyle('studio');
  assert.equal(controls.workspaceVisualStyle.value, 'studio');
  assert.equal(h.storage.get('df.visualStyle'), '"studio"');
  assert.deepEqual(harness(Object.fromEntries(h.storage)).dataset, { theme: 'dark', visualStyle: 'studio' });
  assert.deepEqual(h.calls, [
    { cmd: 'ui_set_theme', args: { theme: 'dark', visualStyle: 'classic' } },
    { cmd: 'ui_set_theme', args: { theme: 'dark', visualStyle: 'studio' } },
  ]);
  assert.equal(layoutChanges, 2);
  assert.equal(controls.workspaceSettingsStatus.textContent, '界面风格已保存');
});
