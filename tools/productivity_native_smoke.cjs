// Real EXE, folder-local archives and fresh profiles; only generated fixture files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(root, 'src-tauri/target/productivity-native-'));
const exe = path.join(output, 'DaliziFiles.exe'), work = path.join(output, '标签工作区');
fs.copyFileSync(process.env.DALIZI_EXE || path.join(root, 'src-tauri/target/release/dalizi-files.exe'), exe);
fs.mkdirSync(work); fs.writeFileSync(path.join(work, '说明.txt'), 'Local fixture only');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let app, browser; const errors = [];
async function stop() {
  if (browser) { await browser.close().catch(() => {}); browser = null; }
  if (app && app.exitCode == null) { try { execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {} }
  app = null;
}
async function launch(profile) {
  const probe = http.createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
  app = spawn(exe, [], { cwd: output, windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: path.join(output, profile), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port}` } });
  let endpoint;
  for (let i = 0; i < 150; i++) { try { endpoint = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()); break; } catch { await delay(200); } }
  assert.ok(endpoint); browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
  let page;
  for (let i = 0; i < 100; i++) { page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('tauri.localhost')); if (page) break; await delay(100); }
  assert.ok(page); page.on('pageerror', (error) => errors.push(String(error)));
  await page.waitForFunction(() => typeof workspaceSessionReady !== 'undefined' && workspaceSessionReady && !state.loading);
  await page.evaluate(() => setLocale('zh')); return page;
}
(async () => {
  try {
    const page = await launch('first-profile');
    let metrics;
    try { metrics = await require('./productivity_checks.cjs')(page, { folder: work, output, native: true }); }
    catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }); console.log(output); console.log(await page.evaluate(() => ({ errors: state.error, tabs: state.tabs.map((t) => ({ kind: t.kind, path: t.path })), loading: state.loading, visibility: document.visibilityState, dialogs: [...document.querySelectorAll('dialog[open]')].map((d) => d.id) }))); throw error; }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ metrics, errors }, null, 2));
    console.log('Native tab checks passed: drag ordering keeps the active tab, reopen creates a fresh tab, keyboard reordering.');
    console.log(output);
  } finally { await stop(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
