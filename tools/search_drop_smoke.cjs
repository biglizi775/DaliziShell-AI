// Real EXE + isolated WebView2 profile. Synthetic native-drop payloads, real shell file transfers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(root, 'src-tauri/target/search-drop-smoke-'));
const exe = path.join(output, 'DaliziFiles.exe');
fs.copyFileSync(process.env.DALIZI_EXE || path.join(root, 'src-tauri/target/release/dalizi-files.exe'), exe);
const work = path.join(output, '文件工作区'), origin = path.join(output, '拖入来源'), destination = path.join(work, '目标文件夹');
for (const dir of [work, origin, destination]) fs.mkdirSync(dir);
const fixtures = [
  ['年度 报告.pdf', 2048], ['预算.docx', 8192], ['报告草稿.pdf', 512], ['报告🌟.pdf', 4096], ['隐藏报告.pdf', 3072], ['notes.txt', 12],
];
for (const [name, size] of fixtures) fs.writeFileSync(path.join(work, name), Buffer.alloc(size, 65));
execFileSync('attrib.exe', ['+h', path.join(work, '隐藏报告.pdf')], { windowsHide: true });
for (const name of ['移动样本.txt', '复制样本.txt', '同名样本.txt', '取消样本.txt']) fs.writeFileSync(path.join(origin, name), 'source-' + name);
fs.writeFileSync(path.join(destination, '同名样本.txt'), 'keep-original');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let app, browser;
(async () => {
  try {
    const probe = http.createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
    app = spawn(exe, [], { cwd: output, windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: path.join(output, 'profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port} --force-device-scale-factor=1.5` } });
    let endpoint;
    for (let i = 0; i < 150; i++) { try { endpoint = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()); break; } catch { await delay(200); } }
    assert.ok(endpoint, 'native WebView2 starts');
    browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
    let page;
    for (let i = 0; i < 100; i++) { page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('tauri.localhost')); if (page) break; await delay(100); }
    assert.ok(page);
    await page.waitForFunction(() => typeof portableLoaded !== 'undefined' && portableLoaded && workspaceSessionReady && !state.loading);
    await page.evaluate(async () => {
      const unlisten = await window.__TAURI__.webview.getCurrentWebview().onDragDropEvent(() => {});
      unlisten();
    });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.evaluate(async (folder) => { setLocale('zh'); await navigate(folder); state.showHidden = true; setWorkspaceSearchMode('local'); renderAll(); }, work);
    const cases = [
      ['*.pdf|*.docx !草稿 size:>=2kb', ['年度 报告.pdf', '预算.docx', '报告🌟.pdf', '隐藏报告.pdf']],
      ['"年度 报告"', ['年度 报告.pdf']], ['报告?.pdf', ['报告🌟.pdf']],
      ['file: ext:txt size:<=12', ['notes.txt']], ['folder:', ['目标文件夹']],
      ['dm:today file: ext:docx', ['预算.docx']], ['dm:thismonth ext:docx', ['预算.docx']],
      [`parent:"${work}" ext:docx`, ['预算.docx']],
      ['<预算 ext:docx>|<报告 ext:pdf !草稿>', ['年度 报告.pdf', '预算.docx', '报告🌟.pdf', '隐藏报告.pdf']],
    ];
    // Feed the real parser AST through local filtering, then compare with the real indexed query.
    await page.evaluate(async (folder) => { await invoke('dir_sizes', { gen: state.gen, paths: [folder], force: false }); }, work);
    for (const [query, names] of cases) {
      await page.locator('#search').fill(query);
      await page.waitForFunction(() => !document.getElementById('search').hasAttribute('aria-busy') && !state.filterError);
      assert.deepEqual((await page.evaluate(() => state.view.map((e) => e.name))).sort(), [...names].sort(), 'local: ' + query);
      let indexed;
      for (let retry = 0; retry < 100; retry++) {
        indexed = await page.evaluate((args) => invoke('search_files', args), { query, limit: 200, scope: work });
        if (!indexed.cancelled && indexed.total === names.length) break;
        await delay(100);
      }
      assert.deepEqual(indexed.items.map((e) => e.name).sort(), [...names].sort(), 'index: ' + query);
    }
    await page.locator('#search').fill('regex:.*');
    await page.waitForFunction(() => document.getElementById('search').getAttribute('aria-invalid') === 'true');
    assert.equal(await page.evaluate(() => state.view.length), 0);
    await page.locator('#search').fill('');
    await page.evaluate(() => { state.showHidden = false; renderAll(); });
    assert.equal(await page.evaluate(() => state.view.some((e) => e.name === '隐藏报告.pdf')), false);
    await page.locator('#searchMode').selectOption('tree');
    await page.locator('#search').fill('隐藏报告.pdf');
    await page.locator('[data-quick-result]').first().waitFor();
    const before = await page.evaluate(() => state.tabs.length);
    await page.locator('[data-quick-action="reveal"]').first().click();
    await page.waitForFunction(() => !state.loading && state.selection.has('隐藏报告.pdf'));
    assert.equal(await page.evaluate(() => state.tabs.length), before + 1);
    assert.equal(await page.evaluate(() => state.view.some((e) => e.name === '隐藏报告.pdf')), true, 'hidden target is revealed without changing hidden-file preferences');
    assert.equal(await page.evaluate(() => state.showHidden), false);
    await page.screenshot({ path: path.join(output, 'native-reveal.png') });
    await page.locator('#searchMode').selectOption('local');
    async function drop(name, kind) {
      await page.waitForFunction(() => !state.loading && !fileOpBusy);
      await page.evaluate(({ source, destinationName }) => {
        const row = [...document.querySelectorAll('[data-i]')].find((n) => state.view[Number(n.dataset.i)]?.name === destinationName);
        if (!row) throw new Error('Missing drop-target row');
        const rect = row.getBoundingClientRect(), position = { x: (rect.x + 24) * devicePixelRatio, y: (rect.y + rect.height / 2) * devicePixelRatio };
        handleExternalDrag({ type: 'enter', paths: [source], position });
        handleExternalDrag({ type: 'drop', paths: [source], position });
      }, { source: path.join(origin, name), destinationName: '目标文件夹' });
      await page.locator('#externalDropDialog').waitFor();
      assert.equal(await page.locator('.drop-destination').textContent(), destination);
      await page.screenshot({ path: path.join(output, 'native-drop.png') });
      if (kind === 'cancel') await page.locator('#externalDropDialog [data-drop-close]').last().click();
      else await page.locator(`[data-drop-kind="${kind}"]`).click();
      await page.locator('#externalDropDialog').waitFor({ state: 'detached', timeout: 30000 });
      await page.waitForFunction(() => !fileOpBusy && !state.loading);
    }
    await drop('取消样本.txt', 'cancel');
    assert.equal(fs.existsSync(path.join(origin, '取消样本.txt')), true);
    assert.equal(fs.existsSync(path.join(destination, '取消样本.txt')), false);
    await drop('移动样本.txt', 'move');
    assert.equal(fs.existsSync(path.join(origin, '移动样本.txt')), false);
    assert.equal(fs.readFileSync(path.join(destination, '移动样本.txt'), 'utf8'), 'source-移动样本.txt');
    await drop('复制样本.txt', 'copy');
    assert.equal(fs.readFileSync(path.join(origin, '复制样本.txt'), 'utf8'), fs.readFileSync(path.join(destination, '复制样本.txt'), 'utf8'));
    await drop('同名样本.txt', 'move');
    assert.equal(fs.readFileSync(path.join(destination, '同名样本.txt'), 'utf8'), 'keep-original');
    assert.equal(fs.existsSync(path.join(origin, '同名样本.txt')), false);
    assert.ok(fs.readdirSync(destination).some((name) => name !== '同名样本.txt' && fs.readFileSync(path.join(destination, name), 'utf8') === 'source-同名样本.txt'), 'colliding file is renamed, never overwritten');
    const rejected = await page.evaluate(async ({ work, destination }) => { try { await invoke('external_drop_transfer', { kind: 'move', sources: [work], dest: destination }); return ''; } catch (error) { return String(error); } }, { work, destination });
    assert.match(rejected, /自身或子目录/);
    assert.equal(fs.existsSync(work), true);
    const paneName = '双面板测试.txt'; fs.writeFileSync(path.join(work, paneName), 'dual pane fixture');
    await page.evaluate(async ({ work, destination, name }) => {
      await navigate(work); toggleDualPane(true); await loadCompanion(destination);
      state.selection = new Set([name]); applySelectionDom(); renderBar2();
    }, { work, destination, name: paneName });
    await page.locator('#companionPane [data-to-right]').click();
    await page.locator('[data-drop-kind="copy"]').click(); await page.waitForFunction(() => !fileOpBusy && !state.loading && !companionFor().loading);
    assert.equal(fs.readFileSync(path.join(destination, paneName), 'utf8'), 'dual pane fixture');
    assert.equal(fs.existsSync(path.join(work, paneName)), true);
    await page.evaluate(origin => navigate(origin), origin);
    await page.screenshot({ path: path.join(output, 'native-dual-pane-before-move.png') });
    await page.locator('.pane-file').filter({ hasText: paneName }).click();
    await page.locator('#companionPane [data-to-left]').click();
    await page.locator('[data-drop-kind="move"]').click(); await page.waitForFunction(() => !fileOpBusy && !state.loading && !companionFor().loading);
    assert.equal(fs.existsSync(path.join(destination, paneName)), false);
    assert.equal(fs.readFileSync(path.join(origin, paneName), 'utf8'), 'dual pane fixture');
    await page.screenshot({ path: path.join(output, 'native-dual-pane.png') });
    console.log('Native dual pane copy/move and independent folder refresh passed.');
    assert.deepEqual(errors, []);
    console.log('Native search/drop passed: real parser and indexed/local parity, Unicode/wildcards/boolean/date/size/path, invalid-query feedback, in-app tab + hidden target selection, DPI coordinate mapping, cancel/move/copy/collision preservation and descendant rejection. Drop payloads were simulated; physical Explorer mouse dragging requires manual acceptance.');
    console.log('Artifacts: ' + output);
  } finally {
    if (browser) await browser.close();
    if (app && app.exitCode == null) { const exited = new Promise((resolve) => app.once('exit', resolve)); app.kill(); await exited; }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
