// Real EXE + isolated WebView2 profiles. Fixture data only; no remote websites.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(root, 'src-tauri/target/portable-smoke-'));
const source = process.env.DALIZI_EXE || path.join(root, 'src-tauri/target/release/dalizi-files.exe');
const first = path.join(output, 'first-machine'), second = path.join(output, 'second-machine');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
for (const dir of [first, second]) { fs.mkdirSync(dir); fs.copyFileSync(source, path.join(dir, 'DaliziFiles.exe')); }
let app, browser;
async function stop() {
  if (browser) { await browser.close(); browser = null; }
  if (app && app.exitCode == null) {
    // This process belongs exclusively to this fixture; all writes are awaited first.
    const exited = new Promise((resolve) => app.once('exit', resolve));
    app.kill(); await exited;
  }
  app = null;
}
async function launch(dir, profile) {
  const probe = http.createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
  app = spawn(path.join(dir, 'DaliziFiles.exe'), [], { cwd: output, windowsHide: true, stdio: 'ignore', env: { ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: path.join(output, profile), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port}` } });
  let endpoint;
  for (let i = 0; i < 150; i++) { try { endpoint = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()); break; } catch { await delay(200); } }
  assert.ok(endpoint, 'native WebView2 debugging endpoint starts');
  browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
  let page;
  for (let i = 0; i < 100; i++) { page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('tauri.localhost')); if (page) break; await delay(100); }
  assert.ok(page); await page.waitForFunction(() => typeof portableLoaded !== 'undefined' && portableLoaded && workspaceSessionReady && !state.loading);
  return page;
}
(async () => {
  try {
    let page = await launch(first, 'first-profile');
    assert.equal(fs.existsSync(path.join(first, 'DaliziData')), false, 'default startup creates no portable data');
    await page.evaluate(async () => {
      setLocale('zh'); document.documentElement.dataset.theme = 'dark'; store.set('theme', 'dark');
      applyAiRuntimeSettings({ endpoint: 'https://api.example.test/v1', model: 'migration-fixture', apiFormat: 'openai-responses' }, 'fixture-secret-never-export');
      store.set('pinned', ['C:\\FirstMachineOnly']);
      store.set('browserSettings', { homeUrl: 'about:blank', downloadDirectory: 'C:\\FirstMachineDownloads' });
      addFavorite({ kind: 'browser', url: 'https://bookmark.example.test/', name: '迁移书签' });
      addFavorite({ kind: 'files', path: 'C:\\FirstMachineOnly', name: 'Local fixture' });
      rememberUrl('https://history.example.test/', '迁移历史');
      await setPortableEnabled(true);
    });
    const file = path.join(first, 'DaliziData/preferences.json');
    const bytes = fs.readFileSync(file, 'utf8'); const saved = JSON.parse(bytes);
    assert.equal(saved.enabled, true); assert.equal(saved.settings.aiSettings.apiFormat, 'openai-responses');
    assert.equal(bytes.includes('fixture-secret-never-export'), false); assert.equal(bytes.includes('FirstMachine'), false);
    await stop();
    fs.mkdirSync(path.join(second, 'DaliziData')); fs.copyFileSync(file, path.join(second, 'DaliziData/preferences.json'));
    page = await launch(second, 'second-profile');
    assert.deepEqual(await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, locale, model: aiSettings.model, format: aiSettings.apiFormat, key: aiSessionKey, favorites: readFavorites().map((v) => v.kind), history: store.get('urlHistory', []), pinned: state.pinned, downloads: browserSettings().downloadDirectory })), {
      theme: 'dark', locale: 'zh', model: 'migration-fixture', format: 'openai-responses', key: '', favorites: ['browser'], history: [{ url: 'https://history.example.test/', title: '迁移历史', visitedAt: saved.settings.urlHistory[0].visitedAt }], pinned: [], downloads: '',
    });
    await page.evaluate(() => openPortableSettings());
    await page.screenshot({ path: path.join(output, 'migrated-settings.png') });
    await page.evaluate(async () => { store.set('urlHistory', []); await writePortableQueue(); });
    const secondFile = path.join(second, 'DaliziData/preferences.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(secondFile, 'utf8')).settings.urlHistory, []);
    await stop();
    page = await launch(second, 'third-fresh-profile');
    assert.deepEqual(await page.evaluate(() => store.get('urlHistory', [])), []);
    assert.equal(await page.evaluate(() => readFavorites()[0].name), '迁移书签');
    await page.evaluate(() => setPortableEnabled(false)); await stop();
    page = await launch(second, 'disabled-fresh-profile');
    assert.equal(await page.evaluate(() => portableStatus.enabled), false);
    assert.equal(await page.evaluate(() => aiSettings.model || ''), '');
    assert.equal(await page.evaluate(() => readFavorites().length), 0);
    console.log('Native portable settings passed: opt-in, real JSON writes, copy to a second EXE directory and fresh profile, boot hydration, credentials/path exclusions, history clearing across restarts, disabled startup.');
    console.log('Artifacts: ' + output);
  } finally { await stop(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
