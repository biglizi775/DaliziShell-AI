'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const execFile = require('node:util').promisify(require('node:child_process').execFile);

// The caller has verified the executable identity and owns these two disposable directories.
module.exports = async function checkDesktopExit({page, a, b, addr, requests, responses, until, app}) {
  const closeWindow = () => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'if (!(Get-Process -Id ' + app.pid + ').CloseMainWindow()) { exit 1 }'], {windowsHide:true, timeout:10000});
  const chats = async root => JSON.parse(await fs.readFile(path.join(root,'.dalizi','chat-history.json'),'utf8')).conversations;
  const originalId = await page.evaluate(async ({a,b,addr}) => {
    setLocale('zh'); aiProjectRoot=''; await navigate(a); openAiAssistant();
    const folder = aiCurrentSession(); addAiMessage(folder,'user','Original A');
    if (!await saveAiArchive(folder)) throw Error('Could not create the source conversation');
    const external = aiArchiveSnapshot(folder); external.messages[0].text='Disk version A';
    await invoke('agent_chat_save',{root:a,snapshot:external,expectedRevision:folder.archive.revision});
    aiProjectRoot=b; syncAiWorkspace();
    addAiMessage(folder,'user','Local version A');
    if (await saveAiArchive(folder)) throw Error('Expected an archive conflict');
    aiSettings={endpoint:addr,model:'deepseek-v4-pro',apiFormat:'anthropic-messages'};
    aiSessionKey='fixture-only'; aiStreamReplies=true;
    return folder.archive.id;
  },{a,b,addr});
  await page.waitForFunction(root => aiCurrentSession()?.root===root && !aiCurrentSession().restoring,b);
  const prompt=page.locator('#aiPrompt');
  await prompt.fill('Question in pinned B'); await prompt.press('Enter');
  await until(()=>requests.length===1);
  responses[0].writeHead(200,{'Content-Type':'text/event-stream'});
  function fragment(text) {
    responses[0].write('data: '+JSON.stringify({type:'content_block_delta',index:0,delta:{type:'text_delta',text}})+'\r\n\r\n');
  }
  fragment('Stream B');
  await page.waitForFunction(()=>aiCurrentSession().streamText==='Stream B');
  await closeWindow();
  await until(async()=>app.exitCode!==null || page.isClosed() || (await page.locator('#chatRecoveryDialog').count())===1);
  assert.equal(page.isClosed(),false,'normal Windows close destroyed the main window with an unresolved archive conflict');
  const modal=page.locator('#chatRecoveryDialog');
  assert.equal(await modal.locator('.chat-root').textContent(),a);
  await closeWindow();
  assert.equal(await modal.count(),1);
  await modal.locator('[data-recovery=keep]').click();
  await modal.waitFor({state:'detached'});
  assert.equal(app.exitCode,null); assert.equal((await chats(a))[0].snapshot.messages[0].text,'Disk version A');
  fragment(' after Keep');
  await page.waitForFunction(()=>aiCurrentSession().streamText==='Stream B after Keep');
  await closeWindow();
  await modal.locator('[data-recovery=copy]').click();
  await until(()=>app.exitCode!==null); assert.equal(app.exitCode,0);
  const savedA=await chats(a), savedB=await chats(b);
  assert.equal(savedA.length,2); assert.equal(savedB.length,1);
  assert.equal(savedA.find(c=>c.snapshot.id===originalId).snapshot.messages[0].text,'Disk version A');
  assert.equal(savedA.find(c=>c.snapshot.id!==originalId).snapshot.messages.at(-1).text,'Local version A');
  const reply=savedB[0].snapshot.messages.at(-1);
  assert.match(reply.text,/未完成的回复/); assert.match(reply.text,/Stream B after Keep/); assert.equal(reply.omitHistory,true);
  assert.equal(requests.length,1);
  console.log('Native close OK: repeated Windows close, Keep and live reply, independent copy in A, incomplete pinned B reply read back after process exit (code 0).');
};
