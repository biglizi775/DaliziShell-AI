// Real EXE/WebView2/Win32 regression with isolated files and a main-view profile.
// Browser child views use a separate native harness (browser_smoke), because a
// global WEBVIEW2_USER_DATA_FOLDER would merge incompatible environment options.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(root, 'src-tauri/target/render-stability-'));
const exe = path.join(output, 'DaliziFiles.exe');
const work = path.join(output, '文件工作区');
fs.mkdirSync(work);
fs.copyFileSync(process.env.DALIZI_EXE || path.join(root, 'src-tauri/target/release/dalizi-files.exe'), exe);
for (let i = 1; i <= 300; i++) fs.writeFileSync(path.join(work, `Project-notes-${i}.md`), `# Fixture ${i}\n`);
function fixturePdf() {
  const streams = ['0.1 0.5 0.9 rg 20 20 200 200 re f\n', '0.2 0.8 0.4 rg 40 40 200 200 re f\n'];
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>', ...streams.flatMap((content, i) => [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 340 280] /Resources << >> /Contents ${4 + i * 2} 0 R >>`, `<< /Length ${content.length} >>\nstream\n${content}endstream`])];
  let data = '%PDF-1.7\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(data.length); data += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = data.length;
  return data + `xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
}
fs.writeFileSync(path.join(work, '预览示例.pdf'), fixturePdf());
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let app, browser;
(async () => {
  try {
    const probe = http.createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
    app = spawn(exe, [], { cwd: output, windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: path.join(output, 'profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port}` } });
    let endpoint;
    for (let i = 0; i < 150; i++) { try { endpoint = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()); break; } catch { await delay(200); } }
    assert.ok(endpoint, 'native WebView2 starts');
    browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
    let page;
    for (let i = 0; i < 100; i++) { page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('tauri.localhost')); if (page) break; await delay(100); }
    assert.ok(page); const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const control = (action, width = 1280, height = 800) => execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'tools/window_fixture.ps1'), '-FixturePid', String(app.pid), '-FixtureExe', exe, '-Action', action, '-Width', String(width), '-Height', String(height)], { windowsHide: true, timeout: 15000, stdio: 'pipe' });
    if (process.argv.includes('--tabs')) {
      control('resize', 1280, 800);
      await require('./tab_overflow_checks.cjs')(page, { folder: work, output, native: true, resize: async (width, height) => { control('resize', width, height); } });
      assert.deepEqual(errors, []);
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ exe, tabCount: 60, errors }, null, 2));
      console.log('Native EXE tab overflow passed: wheel, scrollbar drag, fixed actions, active reveal, edge sorting and narrow window.');
      console.log(output);
      return;
    }
    const metrics = await require('./render_stability_checks.cjs')(page, { folder: work, output, resize: async (width, height) => { control('resize', width, height); } });
    await page.evaluate(async () => { previewOpen = false; state.filter = ''; els.search.value = ''; renderAll(); await applyWorkspaceTheme('light'); });
    // Actual filesystem notifications: a busy editor defers, then catches up.
    await page.evaluate(() => startRename('Project-notes-1.md'));
    fs.writeFileSync(path.join(work, 'arrived-while-editing.txt'), 'watcher fixture');
    await delay(700);
    assert.equal(await page.locator('input.rn').count(), 1);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => state.entries.some((entry) => entry.name === 'arrived-while-editing.txt'));
    const marker = await page.evaluate(() => (window.fixtureMarker = crypto.randomUUID()));
    control('resize', 1280, 800);
    control('restore');
    await page.waitForFunction(() => document.visibilityState === 'visible');
    assert.equal(await page.evaluate(() => window.fixtureMarker), marker, 'minimize/restore keeps the existing page alive');
    assert.equal(await page.evaluate(() => state.path), work);
    const soak = process.argv.includes('--soak') ? await require('./render_stability_soak.cjs')(page, work) : null;
    await page.screenshot({ path: path.join(output, 'native-files-restored.png') });
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ exe, metrics, minimizeRestoreCycles: 3, errors, soak, browserHarness: 'cargo run --locked --bin browser_smoke' }, null, 2));
    console.log('Native EXE render stability passed: stable rows/headers/editor, real filesystem events, PDF swap, three Win32 minimize/restore cycles, no main-page reload or script errors. Browser native layout is tested separately by browser_smoke.');
    console.log(output);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (app && app.exitCode == null) { try { execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {} }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
