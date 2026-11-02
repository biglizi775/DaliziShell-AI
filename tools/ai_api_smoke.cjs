// Actual built app + local HTTP fixtures. No provider keys or external API calls.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const workbench = process.argv.includes('--workbench');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(root, 'src-tauri/target/ai-api-smoke-'));
const workspace = path.join(output, 'workspace'); fs.mkdirSync(workspace); fs.writeFileSync(path.join(workspace, 'note.txt'), 'Fixture only');
if (workbench) {
  fs.mkdirSync(path.join(workspace, '.dalizi'));
  fs.writeFileSync(path.join(workspace, '.dalizi/agent-memory.json'), JSON.stringify({ version: 1, memories: [
    { id: 'old', content: 'Keep project names.', enabled: true, updatedAt: 1 },
    { id: 'new', content: 'Keep project names.', enabled: true, updatedAt: 2 },
    { id: 'disabled', content: 'Keep project names.', enabled: false, updatedAt: 3 },
  ] }));
}
const requests = [], failures = [];
const server = http.createServer(async (req, res) => {
  try {
    let data = ''; for await (const chunk of req) data += chunk;
    const body = JSON.parse(data); requests.push({ path: req.url, body });
    assert.equal(req.method, 'POST');
    const messages = req.url.endsWith('/messages'), responses = req.url.endsWith('/responses');
    assert.equal(req.headers[messages ? 'x-api-key' : 'authorization'], messages ? 'fixture-key' : 'Bearer fixture-key');
    if (messages) { assert.equal(req.headers['anthropic-version'], '2023-06-01'); assert.ok(body.max_tokens > 0); }
    if (responses) { assert.equal(body.store, false); assert.equal(body.messages, undefined); }
    const conversation = responses ? body.input : body.messages;
    assert.ok(Array.isArray(conversation));
    if (body.model === 'reject') { res.writeHead(401).end('{}'); return; }
    if (body.model === 'wrong-format') { res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html>Login</html>'); return; }
    const test = conversation.length === 1 && conversation[0].content === 'Connection test. Reply with only OK.';
    let compact = false;
    try { compact = Array.isArray(JSON.parse(conversation.at(-1).content).olderMessages); } catch {}
    if (compact) { assert.equal(data.includes('authorizedRoot'), false); assert.equal(data.includes('savedMemories'), false); }
    const reply = test ? 'OK' : compact ? JSON.stringify({ summary: 'Keep date-based names. Earlier file operations were proposed, never executed.' }) : JSON.stringify({ summary: 'Fixture answer: ' + body.model, actions: [] });
    if (test) assert.equal(data.includes(workspace), false);
    const result = messages ? { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: reply }] }
      : responses ? { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: reply }] }] }
      : { choices: [{ finish_reason: 'stop', message: { content: reply } }] };
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
  } catch (error) { failures.push(error.message); res.writeHead(500).end('{}'); }
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  let app, browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    const exe = process.env.DALIZI_EXE || path.join(root, 'src-tauri/target/release/dalizi-files.exe');
    app = spawn(exe, [], { cwd: output, windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: path.join(output, 'webview-profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port}` } });
    let endpoint;
    for (let i = 0; i < 100; i++) { try { endpoint = await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json()); break; } catch { await delay(200); } }
    assert.ok(endpoint); browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
    let page;
    for (let i = 0; i < 100; i++) { page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('tauri.localhost')); if (page) break; await delay(100); }
    assert.ok(page); await page.waitForFunction(() => typeof testAiConnection === 'function' && !state.loading);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(async workspace => { setLocale('zh'); await navigate(workspace); openAiAssistant(); }, workspace);
    for (const format of ['openai-completions', 'openai-responses', 'anthropic-messages']) {
      await page.evaluate(() => toggleAiSettings(true));
      await page.locator('#aiApiFormat').selectOption(format);
      if (format !== 'anthropic-messages') await page.locator('#aiApiDialect').selectOption('openai');
      await page.locator('#aiEndpoint').fill(`http://127.0.0.1:${server.address().port}/v1`);
      await page.locator('#aiModel').fill(format); await page.locator('#aiKey').fill('fixture-key');
      await page.locator('[data-ai-action="test-api"]').click();
      await page.waitForFunction(() => $('aiApiTestStatus').textContent.includes('测试成功'));
      await page.locator('[data-ai-action="save-settings"]').click();
      await page.locator('#aiPrompt').fill('Summarize the fixture folder'); await page.locator('#aiPrompt').press('Enter');
      await page.waitForFunction(format => aiCurrentSession().messages.some(m => m.text === 'Fixture answer: ' + format), format);
      assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('fixture-key')), false);
      if (workbench) {
        await page.evaluate(() => {
          newAiConversation(); setAiPermissionMode('read-only');
          for (let i = 0; i < 14; i++) addAiMessage(aiCurrentSession(), i % 2 ? 'assistant' : 'user', `Round ${i}: ` + 'Use date-based names. Proposed file operations have not been executed. '.repeat(12));
          renderAiConversation(); updateAiComposer();
        });
        await page.locator('#aiPrompt').fill('Continue summarizing the fixture requirements'); await page.locator('#aiPrompt').press('Enter');
        await page.waitForFunction(() => aiCurrentSession().compactionCount === 1 && !aiCurrentSession().requestId);
        assert.equal(await page.evaluate(() => aiCurrentSession().messages.length), 16);
        const lastBody = requests.at(-1).body, conversation = lastBody.input || lastBody.messages;
        const context = JSON.parse(conversation.at(-1).content);
        assert.match(context.conversationSummary, /never executed/);
        assert.equal(context.permissionMode, 'read-only');
        assert.equal(context.savedMemories.length, 1);
      }
    }
    await page.evaluate(() => toggleAiSettings(true));
    for (const [model, expected] of [['reject', 'HTTP 401'], ['wrong-format', 'JSON']]) {
      await page.locator('#aiModel').fill(model); await page.locator('[data-ai-action="test-api"]').click();
      await page.waitForFunction(expected => $('aiApiTestStatus').textContent.includes(expected), expected);
    }
    await page.locator('#aiModel').fill('anthropic-messages');
    await page.locator('[data-ai-action="test-api"]').click();
    await page.waitForFunction(() => $('aiApiTestStatus').textContent.includes('测试成功'));
    await page.screenshot({ path: path.join(output, 'native-api-test.png') });
    await page.keyboard.press('Escape');
    await page.reload();
    await page.waitForFunction(() => typeof testAiConnection === 'function' && aiModelPresets.length === 3 && aiSettings.apiFormat === 'anthropic-messages');
    assert.equal(requests.length, workbench ? 15 : 9); assert.deepEqual(errors, []); assert.deepEqual(failures, []);
    if (workbench) {
      const file = JSON.parse(fs.readFileSync(path.join(workspace, '.dalizi/agent-memory.json'), 'utf8'));
      assert.deepEqual(file.memories.map(m => m.id), ['new', 'disabled']);
      const backups = fs.readdirSync(path.join(workspace, '.dalizi')).filter(n => n.startsWith('agent-memory-backup-'));
      assert.equal(backups.length, 1); assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, '.dalizi', backups[0]), 'utf8')).memories.length, 3);
      await page.evaluate(async workspace => {
        addFavorite({ kind: 'files', path: workspace }, 'Native fixture');
        await newBrowserTab('about:blank'); addFavorite(currentPlace(), 'Blank page');
        saveWorkspacePreferences({ restoreOnStartup: true, rememberSession: true });
        switchTab(0);
      }, workspace);
      await page.waitForFunction(() => !state.loading && !isBrowserTab(curTab()));
      await page.reload();
      await page.waitForFunction(() => workspaceSessionReady && !state.loading && state.tabs.length === 2);
      assert.equal(await page.evaluate(() => readFavorites().length), 2);
      assert.equal(await page.evaluate(() => state.tabs[1].browserReady), false);
      assert.equal(await page.evaluate(() => state.path), workspace);
      await page.screenshot({ path: path.join(output, 'native-workbench-restored.png') });
      const backupText = fs.readFileSync(path.join(workspace, '.dalizi', backups[0]), 'utf8');
      assert.deepEqual(await page.evaluate(text => parseAgentMemoryBackup(text), backupText), ['Keep project names.']);
      // Verify a real process restart, not only an in-process webview reload.
      execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${app.pid} -ErrorAction Stop).CloseMainWindow() | Out-Null`], { windowsHide: true, stdio: 'ignore', timeout: 10000 });
      for (let i = 0; i < 100 && app.exitCode == null; i++) await delay(100);
      assert.equal(app.exitCode, 0, 'test application exits normally before restart');
      await browser.close().catch(() => {});
      const restartProbe = http.createServer(); await new Promise(resolve => restartProbe.listen(0, '127.0.0.1', resolve));
      const restartPort = restartProbe.address().port; await new Promise(resolve => restartProbe.close(resolve));
      app = spawn(exe, [], { cwd: output, windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: path.join(output, 'webview-profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${restartPort}` } });
      let restartedEndpoint;
      for (let i = 0; i < 100; i++) { try { restartedEndpoint = await fetch(`http://127.0.0.1:${restartPort}/json/version`).then(r => r.json()); break; } catch { await delay(200); } }
      assert.ok(restartedEndpoint); browser = await chromium.connectOverCDP(restartedEndpoint.webSocketDebuggerUrl);
      for (let i = 0; i < 100; i++) { page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('tauri.localhost')); if (page) break; await delay(100); }
      assert.ok(page);
      await page.waitForFunction(() => workspaceSessionReady && !state.loading && state.tabs.length === 2);
      assert.equal(await page.evaluate(() => state.path), workspace);
      assert.equal(await page.evaluate(() => readFavorites().length), 2);
      assert.equal(await page.evaluate(() => state.tabs[1].browserReady), false);
      assert.equal(await page.evaluate(() => aiSessionKey), '', 'restart never restores API credentials from preferences');
      assert.deepEqual(errors, []);
      console.log('Native workbench passed: automatic summaries through all 3 API formats, summary reuse, scoped memory deduplication/backup/import/enable states, favorites and mixed lazy session restoration after a real process restart.');
    }
    console.log('Native API test and chat passed for all 3 formats; headers, history, JSON parsing, HTTP 401, wrong content and credential storage verified.');
    console.log('Artifacts: ' + path.basename(output));
  } finally {
    if (browser) await browser.close();
    if (app && app.exitCode == null) {
      try { execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${app.pid} -ErrorAction SilentlyContinue).CloseMainWindow() | Out-Null`], { windowsHide: true, stdio: 'ignore', timeout: 10000 }); } catch {}
      for (let i = 0; i < 50 && app.exitCode == null; i++) await delay(100);
      if (app.exitCode == null) app.kill();
    }
    server.close(); server.closeAllConnections();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
