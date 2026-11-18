// Exercise the actual workbench and Windows single-instance transport. A separate
// Tauri identifier isolates both WebView2 profiles and the single-instance lock.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(root, 'src-tauri/target/browser-login-'));
const exe = path.join(output, 'DaliziFiles.exe');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

(async () => {
  const identifier = 'com.dalizi.login-smoke-' + process.pid + '-' + Date.now();
  execFileSync('cargo', ['build', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--bin', 'dalizi-files'], {
    cwd: root, env: { ...process.env, TAURI_CONFIG: JSON.stringify({ identifier }) }, stdio: 'inherit', windowsHide: true,
  });
  fs.copyFileSync(path.join(root, 'src-tauri/target/debug/dalizi-files.exe'), exe);
  let app, browser, main;
  const routes = [];
  const server = http.createServer((req, res) => {
    const route = req.url.split('?')[0];
    routes.push(route);
    let body = '<title>desktop-client</title>';
    if (route === '/device') body = `<title>device-verification</title><script>
      onmessage=e=>{if(e.origin===location.origin && e.data==='approved')document.title='signed-in'};
      setTimeout(()=>{const w=window.open('','device-fixture');setTimeout(()=>{w.location.href='/approve'},100)},250);
      </script>`;
    if (route === '/approve') body = `<title>approve-device</title><script>
      opener.postMessage('approved',location.origin);setTimeout(()=>window.close(),250);
      </script>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body);
  });
  try {
    await listen(server);
    const origin = 'http://127.0.0.1:' + server.address().port;
    const probe = http.createServer(); await listen(probe);
    const port = probe.address().port; await new Promise((ok) => probe.close(ok));
    const env = { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + port };
    delete env.WEBVIEW2_USER_DATA_FOLDER;
    const launch = (url) => spawn(exe, ['--open-url', url], { cwd: output, env, windowsHide: true, stdio: 'ignore' });
    app = launch(origin + '/device?user_code=only-for-fixture');
    let endpoint;
    for (let i = 0; i < 150 && !endpoint; i++) {
      try { endpoint = await fetch('http://127.0.0.1:' + port + '/json/version').then((r) => r.json()); }
      catch { await delay(150); }
    }
    assert.ok(endpoint, 'isolated workbench started');
    browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
    for (let i = 0; i < 100 && !main; i++) {
      main = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('tauri.localhost'));
      if (!main) await delay(100);
    }
    assert.ok(main);
    const problems = []; main.on('pageerror', (error) => problems.push(error.message));
    await main.waitForFunction(() => typeof curTab === 'function' && curTab()?.title === 'signed-in' && state.tabs.filter(isBrowserTab).length === 1);
    assert.equal(await main.evaluate(() => JSON.stringify(localStorage).includes('only-for-fixture')), false);
    const forward = async (url) => {
      const second = launch(url);
      const [code] = await once(second, 'exit', { signal: AbortSignal.timeout(15000) });
      assert.equal(code, 0);
      await main.waitForFunction((url) => curTab()?.url === url && curTab()?.title === 'desktop-client', url);
    };
    await forward(origin + '/warm');
    const windowAction = (action) => execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'tools/window_fixture.ps1'),
      '-FixturePid', String(app.pid), '-FixtureExe', exe, '-Action', action], { windowsHide: true });
    windowAction('minimize');
    await forward(origin + '/tray');
    windowAction('verify-visible');
    assert.equal(await main.evaluate(() => state.tabs.filter(isBrowserTab).length), 3);
    await main.evaluate(() => openBrowserSettings());
    await main.locator('[data-browser-section="windows"]').click();
    const diagnostics = main.locator('#windowsLinkResult');
    await diagnostics.locator('dl').waitFor();
    const values = await diagnostics.locator('dd').allTextContents();
    assert.ok(values[0].includes(require('../package.json').version), 'report identifies this build');
    assert.match(values[1], /\d+\.\d+\.\d+\.\d+/);
    assert.equal(values.length, 6);
    // Inspect the shareable text without overwriting the user's clipboard.
    await main.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', {
      value: async (text) => { window.fixtureDiagnostics = text; }, configurable: true,
    }));
    await main.locator('[data-browser-settings-action="copy-links"]').click();
    await main.waitForFunction(() => Boolean(window.fixtureDiagnostics));
    const summary = await main.evaluate(() => window.fixtureDiagnostics);
    assert.equal(summary.split('\n').length, 6);
    assert.doesNotMatch(summary, /only-for-fixture|https?:\/\/|[a-z]:\\/i);
    console.log('Browser diagnostics passed: runtime, registration, effective defaults, popup policy and bounded clipboard summary.');
    assert.deepEqual(problems, []);
    console.log('Workbench login passed: cold launch, device popup late navigation, opener reply, automatic close and focus return, warm launch, tray restore, one-time URL omitted from storage.');
  } catch (error) {
    if (main) console.error('Workbench state:', await main.evaluate(() => ({
      ready: typeof workspaceSessionReady !== 'undefined' && workspaceSessionReady,
      tabs: state.tabs.map(({ kind, title, url, error }) => ({ kind, title, url, error })),
      notices: document.getElementById('toasts')?.textContent,
    })).catch(() => null));
    console.error('Fixture requests:', routes);
    throw error;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (app && app.exitCode == null) {
      try { execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {}
    }
    server.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
