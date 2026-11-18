// Native workspace checks against a separately identified debug fixture, never a production profile.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { chromium } = require('playwright');
const FIXTURE_ID = 'com.dalizi.files.workspace-test';
const checks = { '--file-tab-scope': './file_tab_scope_checks.cjs', '--terminal-restore': './terminal_restore_checks.cjs' };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const listen = (server) => new Promise((ok, no) => server.once('error', no).listen(0, '127.0.0.1', ok));
async function until(operation) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { const value = await operation(); if (value) return value; await delay(100); }
  throw Error('timed out waiting for native fixture');
}
async function main() {
  const exe = process.argv[2];
  const flag = Object.keys(checks).find((name) => process.argv.includes(name));
  if (!exe || path.basename(exe) !== 'workspace-fixture.exe') throw Error('Pass the separately identified workspace-fixture.exe');
  if (!flag) throw Error('Choose one of: ' + Object.keys(checks).join(', '));
  assert.ok((await fs.readFile(exe)).includes(FIXTURE_ID), 'Expected a test-only desktop identity');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dalizi-workspace-'));
  const a = path.join(dir, 'A'), b = path.join(dir, 'B');
  for (const folder of [a, b]) await fs.mkdir(folder);
  const errors = [];
  let app, browser, page;
  async function launch() {
    const probe = http.createServer(); await listen(probe); const port = probe.address().port; await new Promise((ok) => probe.close(ok));
    app = spawn(path.resolve(exe), [], { cwd: dir, windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: path.join(dir, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port}` } });
    const endpoint = await until(async () => { if (app.exitCode != null) throw Error('fixture exited ' + app.exitCode); try { return await (await fetch('http://127.0.0.1:' + port + '/json/version')).json(); } catch { return null; } });
    browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
    page = await until(() => browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('tauri.localhost')));
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.waitForFunction(() => typeof workspaceSessionReady !== 'undefined' && workspaceSessionReady && !state.loading);
  }
  async function close() {
    if (browser) { await browser.close().catch(() => {}); browser = null; }
    if (app && app.exitCode === null && !app.signalCode) { const done = once(app, 'exit'); app.kill(); await done; }
    app = null;
  }
  try {
    await launch();
    await require(checks[flag])({ page, a, b, dir, until, app, getPage: () => page, launch, close });
    assert.deepEqual(errors, []);
  } finally {
    await close();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
