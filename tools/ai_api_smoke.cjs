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
let finishFixtureStream = null;
const firstFragment = '正在生成测试正文 🌟';
async function streamFixture(res, format, first, last, interrupt) {
  const write = value => res.write('data: ' + (typeof value === 'string' ? value : JSON.stringify(value)) + '\r\n\r\n');
  const delta = content => format === 'openai-completions' ? {choices:[{index:0,delta:{content}}]}
    : format === 'openai-responses' ? {type:'response.output_text.delta',delta:content}
    : {type:'content_block_delta',index:0,delta:{type:'text_delta',text:content}};
  res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
  if(format === 'anthropic-messages') write({type:'message_start',message:{role:'assistant'}});
  write(delta(first));
  // The remaining bytes cannot be delivered until the UI has painted the first fragment.
  await new Promise(resolve => {
    const watchdog = setTimeout(resolve,15000);
    finishFixtureStream = () => { clearTimeout(watchdog); resolve(); };
  });
  finishFixtureStream = null;
  if(interrupt) { res.end(); return; }
  write(delta(last));
  if(format === 'openai-completions') {
    write({choices:[{index:0,delta:{},finish_reason:'stop'}]}); write('[DONE]');
  } else if(format === 'openai-responses') {
    write({type:'response.completed',response:{status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:first+last}]}]}});
  } else {
    write({type:'message_delta',delta:{stop_reason:'end_turn'}}); write({type:'message_stop'});
  }
  res.end();
}
const reviewedText = '# 项目纪要\n\nFixture only · <strong>原文</strong> & 符号';
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
    let reply = test ? 'OK' : compact ? JSON.stringify({ summary: 'Keep date-based names. Earlier file operations were proposed, never executed.' }) : conversation.at(-1).content === 'Summarize the fixture folder' ? 'Fixture answer: ' + body.model : JSON.stringify({ summary: 'Fixture answer: ' + body.model, actions: [] });
    const latest = (() => { try { return JSON.parse(conversation.at(-1).content); } catch { return {}; } })();
    if (latest.request?.includes('Review fixture schedule')) {
      reply = JSON.stringify({inspect:{kind:'read',path:'notes.md'}});
    } else if (latest.toolResult && conversation.some(m => String(m.content).includes('Review fixture schedule'))) {
      reply = JSON.stringify({summary:'已更新评审时间，保留原有的交付约定。',actions:[{kind:'edit_text',target:'notes.md',content:latest.toolResult.Ok.replace('周三','周五')}]});
    } else if (conversation.some(m => String(m.content).includes('Inspect project fixture'))) {
      const step = JSON.parse(conversation.at(-1).content);
      if (step.request) reply = JSON.stringify({inspect:{kind:'list', path:'.'}});
      else if (conversation.at(-2).content.includes('"list"')) {
        assert.match(step.toolResult.Ok, /note.txt/);
        reply = JSON.stringify({inspect:{kind:'read', path:'missing-fixture.txt'}});
      } else if (conversation.at(-2).content.includes('missing-fixture.txt')) {
        assert.ok(step.toolResult.Err);
        reply = JSON.stringify({inspect:{kind:'read', path:'note.txt'}});
      } else {
        assert.equal(step.toolResult.Ok, 'Fixture only');
        reply = JSON.stringify({summary:'Verified fixture contents',actions:[{kind:'create_text', target:'notes.md', content:reviewedText}]});
      }
    }
    if (conversation.at(-1).content === 'Summarize the fixture folder') {
      assert.ok(!data.includes('authorizedRoot') && !data.includes('note.txt'));
    }
    if (test) assert.equal(data.includes(workspace), false);
    const prompt = conversation.at(-1).content;
    if (body.stream && ['Summarize the fixture folder','Fixture cancel','Fixture interrupt'].includes(prompt)) {
      assert.match(req.headers.accept,/text\/event-stream/);
      await streamFixture(res, body.model, firstFragment, ' / '+body.model, prompt==='Fixture interrupt'); return;
    }
    if (prompt === 'Fixture JSON response') reply = 'JSON fallback received';
    const result = messages ? { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: reply }] }
      : responses ? { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: reply }] }] }
      : { choices: [{ finish_reason: 'stop', message: { content: reply } }] };
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
  } catch (error) { failures.push(error.message); res.writeHead(500).end('{}'); }
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  let app, browser, page;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    const exe = process.env.DALIZI_EXE || path.join(root, 'src-tauri/target/release/dalizi-files.exe');
    app = spawn(exe, [], { cwd: output, windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: path.join(output, 'webview-profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port}` } });
    let endpoint;
    for (let i = 0; i < 100; i++) { try { endpoint = await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json()); break; } catch { await delay(200); } }
    assert.ok(endpoint); browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);

    for (let i = 0; i < 100; i++) { page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('tauri.localhost')); if (page) break; await delay(100); }
    assert.ok(page); await page.waitForFunction(() => typeof workspaceSessionReady !== 'undefined' && workspaceSessionReady && !state.loading);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(async workspace => { setLocale('zh'); await navigate(workspace); openAiAssistant(); }, workspace);
    assert.equal(await page.evaluate(() => aiCurrentSession().root), workspace);
    for (const format of ['openai-completions', 'openai-responses', 'anthropic-messages']) {
      await page.evaluate(() => { aiCurrentSession().projectTools = false; toggleAiSettings(true); });
      await page.locator('#aiApiFormat').selectOption(format);
      if (format !== 'anthropic-messages') await page.locator('#aiApiDialect').selectOption('openai');
      await page.locator('#aiEndpoint').fill(`http://127.0.0.1:${server.address().port}/v1`);
      await page.locator('#aiModel').fill(format); await page.locator('#aiKey').fill('fixture-key');
      await page.locator('[data-ai-action="test-api"]').click();
      await page.waitForFunction(() => $('aiApiTestStatus').textContent.includes('测试成功'));
      await page.locator('[data-ai-action="save-settings"]').click();
      await page.locator('#aiSettingsPanel').waitFor({state:'hidden'});
      await page.locator('#aiPrompt').fill('Summarize the fixture folder'); await page.locator('#aiPrompt').press('Enter');
      await page.waitForFunction(first => document.getElementById('aiStreamingBody')?.textContent === first,firstFragment);
      assert.ok(finishFixtureStream, 'UI shows first fragment before server completion');
      assert.ok(await page.evaluate(() => !!aiCurrentSession().requestId));
      finishFixtureStream();
      await page.waitForFunction(answer => aiCurrentSession().messages.some(m => m.text === answer) && !aiCurrentSession().requestId,firstFragment+' / '+format);
      assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('fixture-key')), false);
      if (workbench) {
        await page.evaluate(() => {
          return Promise.resolve(newAiConversation()).then(() => { aiCurrentSession().projectTools = true; setAiPermissionMode('read-only');
          for (let i = 0; i < 14; i++) addAiMessage(aiCurrentSession(), i % 2 ? 'assistant' : 'user', `Round ${i}: ` + 'Use date-based names. Proposed file operations have not been executed. '.repeat(12));
          renderAiConversation(); updateAiComposer(); });
        });
        await page.locator('#aiPrompt').fill('Continue summarizing the fixture requirements'); await page.locator('#aiPrompt').press('Enter');
        await page.waitForFunction(() => aiCurrentSession().compactionCount === 1 && !aiCurrentSession().requestId);
        assert.equal(await page.evaluate(() => aiCurrentSession().messages.length), 16);
        const lastBody = requests.at(-1).body, conversation = lastBody.input || lastBody.messages;
        const context = JSON.parse(conversation.at(-1).content);
        assert.match(context.conversationSummary, /never executed/);
        assert.equal(context.permissionMode, 'read-only');
        assert.equal(context.savedMemories.length, 1, JSON.stringify({root:context.authorizedRoot, expected:workspace, format, memories:context.savedMemories.length}));
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
    await page.evaluate(async folder => {await navigate(folder); openAiAssistant();},workspace);
    for (const prompt of ['Fixture cancel','Fixture interrupt']) {
      await page.evaluate(async () => { await newAiConversation(); });
      await page.locator('#aiPrompt').fill(prompt); await page.locator('#aiPrompt').press('Enter');
      await page.waitForFunction(first => document.getElementById('aiStreamingBody')?.textContent===first,firstFragment);
      if(prompt === 'Fixture cancel') await page.locator('[data-ai-action="cancel"]').click();
      finishFixtureStream();
      await page.waitForFunction(() => !aiCurrentSession().requestId && aiCurrentSession().messages.some(m=>m.role==='assistant' && m.omitHistory && m.text.includes('未完成')));
      assert.equal(await page.locator('#aiStreamingBody').count(),0);
      assert.equal(await page.evaluate(() => aiHistory(aiCurrentSession()).some(m=>m.content.includes('未完成的回复'))),false);
    }
    for(const enabled of [true,false]) {
      await page.evaluate(() => toggleAiSettings(true));
      if(!enabled) {
        await page.locator('#aiStreamReplies').uncheck();
        await page.locator('[data-ai-action="save-settings"]').click();
        await page.locator('#aiSettingsPanel').waitFor({state:'hidden'});
      } else await page.keyboard.press('Escape');
      await page.evaluate(async () => { await newAiConversation(); });
      await page.locator('#aiPrompt').fill('Fixture JSON response'); await page.locator('#aiPrompt').press('Enter');
      await page.waitForFunction(() => !aiCurrentSession().requestId && aiCurrentSession().messages.some(m=>m.text==='JSON fallback received'));
      assert.equal(requests.at(-1).body.stream,enabled);
    }
    console.log('All three wire formats rendered before completion; stop, premature EOF, JSON fallback and streaming opt-out passed.');
    // After a reload the JS key is empty. Exercise the real vault through the normal send path.
    await page.evaluate(async folder => {
      await navigate(folder); openAiAssistant();
      store.set('aiProjects', [{root:folder,name:'Fixture project'}]);
    }, workspace);
    await page.locator('#aiProjectsButton').click(); await page.locator('[data-project="0"]').click();
    await page.locator('.project-dialog').waitFor({state:'detached'});
    await page.waitForFunction(folder => aiProjectRoot === folder && aiCurrentSession()?.root === folder && !aiCurrentSession().restoring, workspace);
    await page.evaluate(async () => { await newAiConversation(); });
    await page.locator('#aiProjectTools').check();
    await page.locator('#aiPrompt').fill('Inspect project fixture and save the findings as notes.md'); await page.locator('#aiPrompt').press('Enter');
    await page.waitForFunction(() => aiCurrentSession().messages.some(m => m.text === 'Verified fixture contents') && aiCurrentSession().archive.revision > 0 && !aiArchiveNeedsFlush(aiCurrentSession()));
    const timeline = page.locator('[data-ai-steps]').last();
    await timeline.locator('summary').click();
    assert.deepEqual(await timeline.locator('li code').allTextContents(), ['.', 'missing-fixture.txt', 'note.txt']);
    assert.equal(await timeline.locator('li .failed').count(), 1);
    const savedTrace = await page.evaluate(async () => {
      const session = aiCurrentSession();
      const record = await invoke('agent_chat_read', {root:session.root,id:session.archive.id});
      return record.snapshot.messages.find(m => m.text.includes('Verified fixture contents')).steps;
    });
    assert.deepEqual(savedTrace.map(s => s.status), ['success','failed','success']);
    assert.ok(savedTrace.every(s => Number.isInteger(s.elapsedMs)));
    assert.ok(!JSON.stringify(savedTrace).includes('Fixture only'));
    assert.equal(fs.existsSync(path.join(workspace, 'notes.md')), false);
    await page.locator('[data-ai-plan-details] summary').click();
    assert.equal(await page.locator('.ai-document-preview pre').textContent(), reviewedText);
    await page.locator('[data-ai-confirm]').check();
    await page.locator('[data-ai-action="execute"]').click();
    await page.waitForFunction(() => aiCurrentSession().messages.some(m => m.planState === 'done'));
    assert.equal(fs.readFileSync(path.join(workspace,'notes.md'),'utf8'), reviewedText);
    await page.locator('[data-ai-action="save-reply"]').last().click();
    const editor = page.locator('.ai-save-document');
    const directHistory = () => page.evaluate(root=>invoke('ai_file_history_list',{root,before:null}),workspace);
    const directCount = async () => (await directHistory()).rows.filter(row=>['save_reply','undo_edit'].includes(row.firstKind)).length;
    assert.equal(await directCount(),0);
    await editor.locator('[data-cancel]').click();
    assert.equal(await directCount(),0);
    await page.locator('[data-ai-action="save-reply"]').last().click();
    await editor.locator('[data-name]').fill('notes.md');
    await editor.locator('[data-content]').fill('Edited draft · 第二份');
    await editor.locator('[type=submit]').click();
    await page.waitForFunction(() => document.querySelector('.ai-save-document [role=status]')?.textContent.includes('Target already exists'));
    assert.equal(await editor.locator('[data-content]').inputValue(),'Edited draft · 第二份');
    const collision=(await directHistory()).rows.find(r=>r.firstKind==='save_reply' && r.firstTarget==='notes.md');
    assert.equal(collision.status,'failed');
    assert.equal(fs.readFileSync(path.join(workspace,'notes.md'),'utf8'), reviewedText);
    await editor.locator('[data-name]').fill('reply.txt'); await editor.locator('[type=submit]').click();
    await editor.waitFor({state:'detached'});
    assert.equal(fs.readFileSync(path.join(workspace,'reply.txt'),'utf8'),'Edited draft · 第二份');
    const savedReply=(await directHistory()).rows.find(r=>r.firstKind==='save_reply' && r.firstTarget==='reply.txt');
    assert.equal(savedReply.status,'completed');
    await page.locator(`[data-ai-action=file-receipt][data-record="${savedReply.id}"]`).click();
    await page.locator('#fileHistoryDialog .file-history-detail li strong').filter({hasText:/保存回复|Save reply/}).waitFor();
    await page.locator('#fileHistoryDialog [data-close]').click();
    await page.waitForFunction(() => !aiArchiveNeedsFlush(aiCurrentSession()));
    await page.evaluate(async parent => { await navigate(parent); }, path.dirname(workspace));
    assert.equal(await page.evaluate(() => aiCurrentSession().root), workspace);
    await page.reload();
    await page.waitForFunction(() => aiCurrentSession()?.messages.some(m => m.text.startsWith('Verified fixture contents')));
    assert.equal(await page.locator('[data-ai-action="execute"]').count(), 0, 'restoring the archive must not replay document writes');
    assert.equal(await page.evaluate(() => aiCurrentSession().permissionMode), 'confirm');
    assert.equal(await page.evaluate(() => aiSessionKey), '');
    const meeting = '# 项目会议纪要\n\n## 本周安排\n设计评审安排在周三下午。\n\n## 交付约定\n提交体验报告和兼容性验证记录。';
    fs.writeFileSync(path.join(workspace,'notes.md'),meeting);
    await page.evaluate(async folder => { await navigate(folder); await newAiConversation(); },workspace);
    const docRow = page.locator('.row').filter({hasText:'notes.md'}).first();
    await docRow.click({button:'right'});
    await page.getByText('让 Agent 修改…',{exact:true}).click();
    assert.match(await page.locator('#aiReferenceStatus').textContent(),/notes.md/);
    await page.locator('#aiPermissionMode').selectOption('auto');
    await page.locator('#aiPrompt').fill('Review fixture schedule. 请把设计评审从周三改为周五。');
    await page.locator('#aiPrompt').press('Enter');
    await page.locator('[data-ai-action="review-edit"]').click();
    const review = page.locator('.document-review');
    assert.equal(fs.readFileSync(path.join(workspace,'notes.md'),'utf8'),meeting);
    assert.match(await review.locator('.diff-cell.added').innerText(),/周五/);
    await page.screenshot({path:path.join(output,'document-review.png')});
    const originalTheme=await page.evaluate(()=>document.documentElement.dataset.theme);
    await page.evaluate(()=>document.documentElement.dataset.theme='dark');
    await page.screenshot({path:path.join(output,'document-review-dark.png')});
    const mobile = await page.context().newCDPSession(page);
    await mobile.send('Emulation.setDeviceMetricsOverride',{width:960,height:560,deviceScaleFactor:1,mobile:false});
    assert.ok(await review.locator('[data-apply]').evaluate(b=>b.getBoundingClientRect().bottom<=innerHeight));
    await page.screenshot({path:path.join(output,'document-review-compact.png')});
    await mobile.send('Emulation.clearDeviceMetricsOverride');
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,originalTheme);
    await page.keyboard.press('Escape');
    await page.locator('[data-ai-action="review-edit"]').click();
    await review.locator('[data-apply]').click();
    await page.locator('[data-ai-action="undo-edit"]').waitFor();
    await page.locator('[data-ai-action="review-edit"]').click();
    assert.equal(await review.locator('[data-apply]').count(), 0);
    await page.keyboard.press('Escape');
    assert.equal(fs.readFileSync(path.join(workspace,'notes.md'),'utf8'),meeting.replace('周三','周五'));
    const editedMeeting=fs.readFileSync(path.join(workspace,'notes.md'),'utf8');
    fs.writeFileSync(path.join(workspace,'notes.md'),editedMeeting+'\nmanual text');
    await page.locator('.row').filter({hasText:'notes.md'}).first().click({button:'right'});
    await page.locator('[data-mid=agent-undo]').click();
    await page.waitForFunction(()=>aiCurrentSession().messages.some(m=>m.error && m.journalId && m.text.includes('内容已变化')));
    assert.match(fs.readFileSync(path.join(workspace,'notes.md'),'utf8'),/manual text$/);
    fs.writeFileSync(path.join(workspace,'notes.md'),editedMeeting);
    await page.locator('[data-ai-action="undo-edit"]').click();
    await page.waitForFunction(()=>aiCurrentSession().messages.some(m=>m.undone));
    assert.equal(fs.readFileSync(path.join(workspace,'notes.md'),'utf8'),meeting);
    const directRecords=(await directHistory()).rows.filter(row=>['save_reply','undo_edit'].includes(row.firstKind));
    assert.equal(directRecords.length,4);
    assert.deepEqual(directRecords.filter(r=>r.firstKind==='undo_edit').map(r=>r.status).sort(),['completed','failed']);
    for (const record of directRecords) {
      const raw=fs.readFileSync(path.join(workspace,'.dalizi','tasks','local-'+record.id+'.jsonl'),'utf8');
      assert.ok(!raw.includes('第二份') && !raw.includes('设计评审') && !raw.includes('manual text'));
      assert.ok(record.approved && !record.role);
    }
    await page.locator('#aiProjectsButton').click(); await page.locator('[data-follow]').click();
    const projectName = 'Regression-' + require('node:crypto').randomUUID();
    await page.locator('#aiProjectsButton').click();
    await page.locator('[data-name]').fill(projectName);
    await page.locator('[data-create]').click();
    await page.waitForFunction(name => aiCurrentSession()?.root.endsWith(name) && !aiCurrentSession().restoring, projectName);
    const createdRoot = await page.evaluate(() => aiCurrentSession().root);
    assert.equal(path.basename(createdRoot), projectName);
    assert.equal(path.basename(path.dirname(createdRoot)), 'AgentProjects');
    assert.ok(fs.statSync(createdRoot).isDirectory());
    await page.locator('#aiProjectsButton').click(); await page.locator('[data-follow]').click();
    fs.rmdirSync(createdRoot); // empty, uniquely named fixture only
    await page.evaluate(folder => navigate(folder), workspace);
    console.log('Independent project, on-demand tool loop, automatic transcript recovery and remembered model key passed.');
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
      await page.waitForLoadState('domcontentloaded');
      await page.waitForFunction(() => typeof workspaceSessionReady !== 'undefined' && workspaceSessionReady && !state.loading && state.tabs.length === 2);
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
      await page.waitForLoadState('domcontentloaded');
      await page.waitForFunction(() => typeof workspaceSessionReady !== 'undefined' && workspaceSessionReady && !state.loading && state.tabs.length === 2);
      assert.equal(await page.evaluate(() => state.path), workspace);
      assert.equal(await page.evaluate(() => readFavorites().length), 2);
      assert.equal(await page.evaluate(() => state.tabs[1].browserReady), false);
      assert.equal(await page.evaluate(() => aiSessionKey), '', 'restart never restores API credentials from preferences');
      const beforeHistoryRequests=requests.length;
      assert.deepEqual((await directHistory()).rows.filter(row=>['save_reply','undo_edit'].includes(row.firstKind)),directRecords);
      await page.evaluate(() => openAiAssistant());
      await page.locator('[data-file-history]').click();
      const successfulUndo=directRecords.find(r=>r.firstKind==='undo_edit' && r.status==='completed');
      await page.locator(`#fileHistoryDialog [data-file-id="${successfulUndo.id}"]`).click();
      await page.locator('#fileHistoryDialog .file-history-detail li strong').filter({hasText:/撤销修改|Undo edit/}).waitFor();
      await page.locator('#fileHistoryDialog [data-close]').click();
      assert.equal(fs.readFileSync(path.join(workspace,'notes.md'),'utf8'),meeting);
      assert.equal(requests.length,beforeHistoryRequests);
      await page.evaluate(() => toggleAiSettings(true));
      assert.equal(await page.locator('#aiKey').inputValue(), '');
      await page.locator('[data-ai-action="test-api"]').click();
      await page.waitForFunction(() => $('aiApiTestStatus').textContent.includes('测试成功'));
      assert.deepEqual(errors, []);
      console.log('Native workbench passed: automatic summaries through all 3 API formats, summary reuse, scoped memory deduplication/backup/import/enable states, favorites and mixed lazy session restoration after a real process restart.');
    }
    console.log('Native API test and chat passed for all 3 formats; headers, history, JSON parsing, HTTP 401, wrong content and credential storage verified.');
    console.log('Artifacts: ' + path.basename(output));
  } finally {
    if (page && !page.isClosed()) await page.evaluate(async endpoint => {
      for (const apiFormat of ['openai-completions','openai-responses','anthropic-messages'])
        await invoke('ai_save_key',{endpoint,apiFormat,key:''});
    }, `http://127.0.0.1:${server.address().port}/v1`).catch(() => {});
    if (browser) await browser.close();
    if (app && app.exitCode == null) {
      try { execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${app.pid} -ErrorAction SilentlyContinue).CloseMainWindow() | Out-Null`], { windowsHide: true, stdio: 'ignore', timeout: 10000 }); } catch {}
      for (let i = 0; i < 50 && app.exitCode == null; i++) await delay(100);
      if (app.exitCode == null) app.kill();
    }
    server.close(); server.closeAllConnections();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
