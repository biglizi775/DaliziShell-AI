// Real application, isolated profile, fixture files, and independent 7-Zip verification.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const sevenzip = process.env.DALIZI_7ZIP || path.join(process.env.ProgramFiles || 'C:/Program Files', '7-Zip/7z.exe');
assert.ok(fs.existsSync(sevenzip), 'Install 7-Zip for independent verification or set DALIZI_7ZIP; the app itself does not require it.');
const output = fs.mkdtempSync(path.join(root, 'src-tauri/target/archive-smoke-'));
const exe = path.join(output, 'DaliziFiles.exe'), work = path.join(output, '工作区'), folder = path.join(work, '资料');
fs.copyFileSync(process.env.DALIZI_EXE || path.join(root, 'src-tauri/target/release/dalizi-files.exe'), exe);
fs.mkdirSync(path.join(folder, '空目录'), { recursive: true });
fs.writeFileSync(path.join(folder, '加密正文🌟.txt'), '这是本地测试内容。\r\n'.repeat(1000));
fs.writeFileSync(path.join(folder, 'empty.txt'), ''); fs.writeFileSync(path.join(work, '第二项.txt'), 'second fixture');
// Fixed fixture credentials only. No personal passwords or user documents are used.
const password = 'fixture-中文🔒 password';
const hash = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const original = hash(path.join(folder, '加密正文🌟.txt'));
function seven(args) { return spawnSync(sevenzip, args, { windowsHide: true, encoding: 'utf8', input: '', timeout: 60000 }); }
function verify(archive, encrypted, hidden, secret = password) {
  const tested = seven(['t', archive, '-y', '-p' + (encrypted ? secret : 'unused')]);
  assert.equal(tested.status, 0, tested.stdout + tested.stderr);
  if (encrypted) {
    assert.notEqual(seven(['t', archive, '-y', '-pwrong-fixture-password']).status, 0, 'wrong password cannot read file contents');
    const listing = seven(['l', archive, '-y', '-pwrong-fixture-password']);
    assert.equal(listing.status === 0, !hidden, 'header encryption controls access to file names');
  }
  const extracted = path.join(output, 'extracted-' + path.basename(archive));
  const unpack = seven(['x', archive, '-y', '-aos', '-o' + extracted, '-p' + (encrypted ? secret : 'unused')]);
  assert.equal(unpack.status, 0, unpack.stdout + unpack.stderr);
  assert.equal(hash(path.join(extracted, '资料/加密正文🌟.txt')), original);
  assert.equal(fs.statSync(path.join(extracted, '资料/空目录')).isDirectory(), true);
  assert.equal(fs.statSync(path.join(extracted, '资料/empty.txt')).size, 0);
  assert.equal(fs.readFileSync(path.join(extracted, '第二项.txt'), 'utf8'), 'second fixture');
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let app, browser;
(async () => {
  try {
    const probe = http.createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
    app = spawn(exe, [], { cwd: output, windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: path.join(output, 'profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port}` } });
    let endpoint;
    for (let i = 0; i < 150; i++) { try { endpoint = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()); break; } catch { await delay(200); } }
    assert.ok(endpoint, 'native WebView2 starts'); browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
    let page;
    for (let i = 0; i < 100; i++) { page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('tauri.localhost')); if (page) break; await delay(100); }
    assert.ok(page); await page.waitForFunction(() => typeof portableLoaded !== 'undefined' && portableLoaded && workspaceSessionReady && !state.loading);
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.evaluate(async (folder) => { setLocale('zh'); await navigate(folder); state.selection = new Set(['资料', '第二项.txt']); applySelectionDom(); renderBar2(); }, work);
    await page.locator('.row').filter({ hasText: '第二项.txt' }).click({ button: 'right' });
    await page.locator('[data-mid="archive"]').click();
    assert.ok((await page.locator('#archiveDialog').textContent()).includes('已选择 2'));
    await page.locator('#archiveName').fill('加密归档.7z');
    await page.locator('#archiveLevel').selectOption('5');
    await page.locator('#archiveEncrypt').check();
    await page.locator('#archivePassword').fill(password); await page.locator('#archiveConfirm').fill(password);
    await page.screenshot({ path: path.join(output, 'native-archive-options.png') });
    await page.locator('#archiveStart').click();
    await page.waitForFunction(() => archiveDialogState?.output, null, { timeout: 60000 });
    assert.equal(await page.locator('#archivePassword').inputValue(), '');
    assert.equal(await page.evaluate((secret) => JSON.stringify(localStorage).includes(secret), password), false);
    await page.screenshot({ path: path.join(output, 'native-archive-complete.png') });
    const secured = path.join(work, '加密归档.7z'); verify(secured, true, true);
    const tabCount = await page.evaluate(() => state.tabs.length);
    await page.locator('#archiveLocate').click();
    await page.waitForFunction(() => !state.loading && state.selection.has('加密归档.7z'));
    assert.equal(await page.evaluate(() => state.tabs.length), tabCount + 1);
    const baseRequest = { sources: [folder, path.join(work, '第二项.txt')], directory: work, name: '', format: '7z', level: 1, password: '', encryptNames: false };
    async function start(overrides) { return page.evaluate((request) => invoke('archive_start', { request }), { ...baseRequest, ...overrides }); }
    async function done(id) {
      const until = Date.now() + 60000;
      while (Date.now() < until) {
        const p = await page.evaluate((id) => invoke('archive_progress', { id }), id);
        if (['done', 'error', 'cancelled'].includes(p.phase)) return p;
        await delay(60);
      }
      throw new Error('Archive task timed out');
    }
    await assert.rejects(() => start({ name: 'invalid.zip', format: 'zip', password }), /ZIP/);
    for (const options of [
      { name: '普通.7z', level: 9 }, { name: '仅打包.7z', level: 0 },
      { name: '公开文件名.7z', password },
      { name: '长密码.7z', password: '🔒'.repeat(256) },
      { name: '普通.zip', format: 'zip', level: 5 },
      { name: '加密.zip', format: 'zip', level: 9, password: 'fixture-ASCII long password!92' },
      { name: '长密码.zip', format: 'zip', level: 1, password: 'x'.repeat(99) },
      { name: '仅打包.zip', format: 'zip', level: 0 },
    ]) {
      const progress = await done(await start(options)); assert.equal(progress.phase, 'done', progress.error);
      verify(path.join(work, options.name), !!options.password, false, options.password);
    }
    const before = hash(secured), collision = await done(await start({ name: '加密归档.7z' }));
    assert.equal(collision.phase, 'error'); assert.match(collision.error, /已存在/); assert.equal(hash(secured), before);
    const self = await done(await start({ name: 'self.7z', directory: folder })); assert.equal(self.phase, 'error'); assert.match(self.error, /源文件夹内/);
    const busyFile = path.join(work, 'busy.bin'); fs.writeFileSync(busyFile, crypto.randomBytes(32 * 1024 * 1024));
    const id = await start({ name: 'cancelled.7z', sources: [busyFile], level: 9 });
    await assert.rejects(() => start({ name: 'duplicate-job.7z' }), /已经|已有/);
    await page.evaluate(async (id) => {
      for (let i = 0; i < 200; i++) { const p = await invoke('archive_progress', { id }); if (p.bytes > 0) break; await new Promise((r) => setTimeout(r, 10)); }
      await invoke('archive_cancel', { id });
    }, id);
    assert.equal((await done(id)).phase, 'cancelled'); assert.equal(fs.existsSync(path.join(work, 'cancelled.7z')), false);
    assert.equal(fs.statSync(busyFile).size, 32 * 1024 * 1024);
    assert.equal(fs.readdirSync(work).some((name) => name.endsWith('.partial')), false);
    assert.equal(hash(path.join(folder, '加密正文🌟.txt')), original);
    assert.deepEqual(errors, []);
    console.log('Native archive passed: real options UI and in-app locate, 7z/ZIP/store/levels/AES-256, encrypted and public headers, wrong-password rejection, independent 7-Zip extraction hashes, Unicode and empty entries, no overwrite/self-output, one active job, mid-stream cancellation and partial cleanup.');
    console.log('Artifacts: ' + output);
  } finally {
    if (browser) await browser.close();
    if (app && app.exitCode == null) { const exited = new Promise((resolve) => app.once('exit', resolve)); app.kill(); await exited; }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
