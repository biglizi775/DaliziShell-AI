// Old desktop -> current desktop -> old desktop -> current, using only synthetic projects.
// On developer machines both hosts must be compiled with the two dedicated test IDs.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), http = require('node:http');
const { createHash } = require('node:crypto'), { spawn } = require('node:child_process'), { once } = require('node:events');
const { chromium } = require('playwright');
const pause = ms => new Promise(r=>setTimeout(r,ms));
const sha = b => createHash('sha256').update(b).digest('hex');
async function until(op) {
  const end=Date.now()+35000;
  do { const result=await op(); if(result)return result; await pause(100); } while(Date.now()<end);
  throw Error('Desktop fixture timed out');
}
async function main() {
  const [oldHost,newHost,mode,reportFile,releaseTag]=process.argv.slice(2);
  assert.ok(oldHost&&newHost); assert.ok(['isolated','pinned-rehearsal','disposable'].includes(mode));
  assert.ok(!releaseTag || mode==='pinned-rehearsal','Select a release only for a pinned rehearsal');
  const released=mode==='disposable';
  const oldBytes=await fs.readFile(oldHost),newBytes=await fs.readFile(newHost);
  if(released) {
    assert.ok(process.env.GITHUB_ACTIONS==='true' && process.env.RUNNER_ENVIRONMENT==='github-hosted' ||
      process.env.DALIZI_DISPOSABLE_GUEST==='yes','Public binaries require a disposable test guest');
    for(const parent of ['LOCALAPPDATA','APPDATA'])for(const id of ['com.dalizi.files']){
      await assert.rejects(fs.stat(path.join(process.env[parent],id)),{code:'ENOENT'});
    }
    for(const b of [oldBytes,newBytes])assert.ok(b.includes('com.dalizi.files'));
  } else if(mode==='pinned-rehearsal') {
    const tag=releaseTag||'rc4';
    assert.ok(/^rc[1-9][0-9]*$/.test(tag),'Invalid release tag');
    const record=require('../docs/verification/harness-m5-'+tag+'-windows11.json');
    const hashes=[sha(oldBytes),sha(newBytes)];
    assert.deepEqual(hashes,record.rehearsalExeSha256,'Expected the exact isolated hosts for '+tag);
    const publicHosts=[record.candidate.exeSha256,record.archiveCompatibility.officialInput.exeSha256];
    assert.ok(hashes.every(hash=>!publicHosts.includes(hash)) && hashes[0]!==hashes[1]);
    assert.ok(oldBytes.includes('com.dalizi.rollback-baseline-test') &&
      newBytes.includes(tag==='rc4'?'com.dalizi.qa-rc4-':'com.dalizi.harness-release-test-'));
  } else {
    assert.ok(oldBytes.includes('com.dalizi.rollback-baseline-test'));
    assert.ok(newBytes.includes('com.dalizi.rollback-candidate-test'));
  }
  const root=await fs.mkdtemp(path.resolve(__dirname,'../src-tauri/target/rollback-run-'));
  const old=path.join(root,'old'),next=path.join(root,'new'),src=path.join(root,'旧 项目'),moved=path.join(root,'迁移 项目'),early=path.join(root,'早期 候选');
  for(const p of [old,next,src])await fs.mkdir(p);
  await fs.writeFile(path.join(old,'DaliziFiles.exe'),oldBytes,{flag:'wx'});
  await fs.writeFile(path.join(next,'DaliziFiles.exe'),newBytes,{flag:'wx'});
  let app,browser,page;const errors=[];
  async function launch(dir) {
    const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
    app=spawn(path.join(dir,'DaliziFiles.exe'),[],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,
      WEBVIEW2_USER_DATA_FOLDER:path.join(root,'webview-'+path.basename(dir)),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-address=127.0.0.1 --remote-debugging-port='+port}});
    const endpoint=await until(async()=>{if(app.exitCode!==null)throw Error('Desktop exited '+app.exitCode);try{return await(await fetch('http://127.0.0.1:'+port+'/json/version')).json()}catch{return null}});
    browser=await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
    page=await until(()=>browser.contexts().flatMap(ctx=>ctx.pages()).find(p=>p.url().includes('tauri.localhost')));
    page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>typeof workspaceSessionReady!=='undefined' && workspaceSessionReady && !state.loading);
  }
  async function close() {
    if(browser) await browser.close(); browser=null;
    if(app&&app.exitCode===null&&!app.signalCode){const exit=once(app,'exit');app.kill();await exit;} app=null;
  }
  const c=(name,args={})=>page.evaluate(([n,a])=>invoke(n,a),[name,args]);
  const disk=p=>path.join(p,'.dalizi','chat-history.json');
  const before=(p)=>fs.readFile(disk(p));
  const read=(p,id)=>c('agent_chat_read',{root:p,id});
  const list=p=>c('agent_chat_list',{root:p});
  const save=(p,snapshot,expectedRevision=0)=>c('agent_chat_save',{root:p,snapshot,expectedRevision});
  const msg=(id,text,steps)=>({id,role:'assistant',text,omitHistory:false,...(steps&&{steps})});
  const record=(id,text)=>({id,title:id,messages:[msg('reply',text)],summary:'SYNTHETIC_SUMMARY',summarizedIds:[],compactedMessages:0});
  const receipt={kind:'inspect',path:'notes.md',status:'success',elapsedMs:8,detail:'SYNTHETIC_RECEIPT'};
  const prefs=dir=>path.join(dir,'DaliziData','preferences.json');
  const mem=async p=>{const v=await c('agent_profile',{root:p});assert.deepEqual(v.memories.map(m=>m.content),['SYNTHETIC_MEMORY']);};
  try {
    await launch(old);
    const original=record('legacy-chat','SYNTHETIC_OLD_TRANSCRIPT');
    await save(src,original);const oldArt=await before(src);
    await c('agent_memory_save',{memory:{root:src,scope:'folder',content:'SYNTHETIC_MEMORY',enabled:true}});
    await mem(src);await c('portable_settings_save',{enabled:true,settings:{locale:'en',theme:'dark',viewMode:'grid'}});
    await fs.cp(src,early,{recursive:true});
    const inline=JSON.parse(await before(early));inline.conversations[0].snapshot.messages[0].steps=[receipt];
    await fs.writeFile(disk(early),JSON.stringify(inline));
    await assert.rejects(list(early),/Invalid chat archive/); // the published v1 contract
    await close();
    const origPrefs=await fs.readFile(prefs(old));
    await fs.cp(path.join(old,'DaliziData'),path.join(next,'DaliziData'),{recursive:true});
    await fs.cp(src,moved,{recursive:true}); // original remains as a byte-for-byte baseline
    await launch(next);
    assert.equal((await c('harness_engine_status')).enabled,false);
    assert.equal((await c('portable_settings_load')).settings.theme,'dark');await mem(moved);
    assert.deepEqual((await read(moved,'legacy-chat')).snapshot,original);
    assert.deepEqual(await before(moved),oldArt);assert.equal((await list(moved)).length,1);
    const rich=record('current-chat','SYNTHETIC_NEW_TRANSCRIPT');rich.messages[0].steps=[receipt];
    const revision=await save(moved,rich);assert.deepEqual((await read(moved,rich.id)).snapshot,rich);
    // Same message ID and text in a second chat: only the owner and revision distinguish receipts.
    const edited=record('edited-chat',rich.messages[0].text);
    edited.messages[0].steps=[{...receipt,detail:'SECOND_CHAT_ONLY'}];
    await save(moved,edited);assert.deepEqual((await read(moved,edited.id)).snapshot,edited);
    const noEdit=await before(early);assert.deepEqual((await read(early,'legacy-chat')).snapshot.messages[0].steps,[receipt]);
    assert.deepEqual(await before(early),noEdit);assert.equal((await list(early))[0].inlineSteps,true);
    await page.evaluate(async root=>{await navigate(root);openAiAssistant();openAiChatHistory()},early);
    await page.locator('#chatPrepareRollback').click();
    await page.waitForFunction(()=>document.querySelector('#chatPrepareRollback')?.hidden && /1/.test(document.querySelector('#chatHistoryStatus')?.textContent));
    assert.equal(await c('agent_chat_prepare_rollback',{root:early}),0);
    assert.deepEqual((await read(early,'legacy-chat')).snapshot.messages[0].steps,[receipt]);
    const repaired=JSON.parse(await before(early));assert.deepEqual(repaired,JSON.parse(oldArt));
    await close();
    await launch(old);await mem(moved);
    assert.equal((await c('portable_settings_load')).settings.viewMode,'grid');assert.deepEqual(await fs.readFile(prefs(old)),origPrefs);
    assert.deepEqual((await read(early,'legacy-chat')).snapshot,original);
    assert.deepEqual((await list(moved)).map(t=>t.id).sort(),['current-chat','edited-chat','legacy-chat']);
    const publicView=await read(moved,rich.id);assert.equal(publicView.snapshot.messages[0].text,'SYNTHETIC_NEW_TRANSCRIPT');
    assert.equal(publicView.snapshot.messages[0].steps,undefined);
    const oldEdited=await read(moved,edited.id);
    assert.equal(oldEdited.snapshot.messages[0].steps,undefined);
    oldEdited.snapshot.messages[0].text='REVISED_IN_OLD_RELEASE';
    oldEdited.snapshot.messages.push(msg('old-append','ADDED_IN_OLD_RELEASE'));
    const editedRevision=await save(moved,oldEdited.snapshot,oldEdited.revision);
    const legacy=await read(moved,original.id);legacy.snapshot.messages.push(msg('reply2','OLD_AFTER_ROLLBACK'));
    await save(moved,legacy.snapshot,legacy.revision);await close();
    await launch(next);await mem(moved);
    assert.deepEqual((await read(moved,original.id)).snapshot,legacy.snapshot);
    const restored=await read(moved,edited.id);
    assert.equal(restored.revision,editedRevision.revision);
    assert.deepEqual(restored.snapshot,oldEdited.snapshot);
    assert.ok(!restored.receiptWarning);
    assert.deepEqual((await read(moved,rich.id)).snapshot,rich);
    await c('agent_chat_delete',{root:moved,id:edited.id,expectedRevision:editedRevision.revision});
    const receiptDir=path.join(moved,'.dalizi'), sidecars=(await fs.readdir(receiptDir)).filter(n=>n.startsWith('chat-steps-v1-'));
    assert.equal(sidecars.length,1,'Discard only the edited revision’s obsolete receipt');
    assert.deepEqual((await read(moved,rich.id)).snapshot,rich);
    const receiptPath=path.join(receiptDir,sidecars[0]);
    const originalReceipt=await fs.readFile(receiptPath), origText=await before(moved);
    await fs.writeFile(receiptPath,'incomplete fixture');const degraded=await read(moved,rich.id);
    assert.ok(degraded.receiptWarning);assert.equal(degraded.snapshot.messages[0].steps,undefined);
    assert.equal(degraded.snapshot.messages[0].text,'SYNTHETIC_NEW_TRANSCRIPT');
    await assert.rejects(save(moved,degraded.snapshot,revision.revision),/Receipts unavailable/);
    assert.deepEqual(await before(moved),origText);await fs.writeFile(receiptPath,originalReceipt);
    await assert.rejects(save(moved,original,1),/Conversation changed/);
    await c('agent_chat_delete',{root:moved,id:rich.id,expectedRevision:revision.revision});
    assert.ok(!(await fs.readdir(path.join(moved,'.dalizi'))).some(n=>n.startsWith('chat-steps-v1-')));
    assert.deepEqual(await before(src),oldArt);assert.deepEqual(errors,[]);
    const report={schema:1,suite:'desktop-chat-rollback',utc:new Date().toISOString(),mode,...(mode==='pinned-rehearsal'?{release:releaseTag||'rc4'}:{}),oldExeSha256:sha(oldBytes),newExeSha256:sha(newBytes),
      passed:['old rejected early inline steps','original chat and memory at relocated path','portable preferences across versions','new receipts and text survive reopens','explicit early archive conversion preserves original fields and revision','old reads old and new transcripts','old edits visible after return; stale write rejected','old revision edited in place: no obsolete receipts; sibling chat retains its own receipt','obsolete receipt pruned without removing sibling receipt','damaged receipts allow transcript reading but prevent replacement','deletion removed associated receipts']};
    await fs.writeFile(path.join(root,'acceptance.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    if(reportFile)await fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    console.log('Rollback OK: '+JSON.stringify(report)+'; '+root);
  } finally { await close(); }
}
main().catch(e=>{console.error(e);process.exitCode=1});
