'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function checkArchiveRecovery({page,a,b,requests}) {
  const modal=page.locator('#chatRecoveryDialog');
  async function choose(operation,folder,choice) {
    await modal.waitFor();
    assert.equal(await modal.locator('.chat-root').textContent(),folder);
    assert.match(await modal.locator('[role=status]').textContent(),/\S/);
    assert.equal(await modal.locator('[data-recovery=keep]').evaluate(el=>el===document.activeElement),true);
    if(choice==='escape') await page.keyboard.press('Escape');
    else await modal.locator('[data-recovery='+choice+']').click();
    await operation;
  }
  const original = await page.evaluate(async root=>{
    setLocale('zh'); aiProjectRoot=''; await navigate(root); openAiAssistant();
    const owner=aiCurrentSession(); addAiMessage(owner,'user','initial');
    if(!await saveAiArchive(owner)) throw Error('Could not create fixture conversation');
    const snapshot=aiArchiveSnapshot(owner); snapshot.messages[0].text='other writer';
    await invoke('agent_chat_save',{root,snapshot,expectedRevision:owner.archive.revision});
    addAiMessage(owner,'user','local changes');
    return {id:owner.archive.id,tab:state.tab};
  },a);
  await page.waitForFunction(()=>!!aiCurrentSession().archive.failedWrite);
  for(const choice of ['escape','keep']){
    await choose(page.evaluate(()=>newAiConversation()),a,choice);
    assert.equal(await page.evaluate(()=>aiCurrentSession().messages.at(-1).text),'local changes');
  }
  await page.evaluate(root=>newTab(root),b);
  await page.locator('#aiPrompt').fill('B draft');
  const disk=path.join(a,'.dalizi','chat-history.json'), before=await fs.readFile(disk);
  await choose(page.evaluate(()=>closeOtherTabs(state.tab)),a,'keep');
  assert.deepEqual(await fs.readFile(disk),before);
  const closeOriginal=()=>page.evaluate(i=>closeTab(i),original.tab);
  await choose(closeOriginal(),a,'copy');
  assert.equal(await page.locator('#aiPrompt').inputValue(),'B draft');
  assert.equal(await page.evaluate(root=>state.tabs.some(tab=>tab.path===root),a),false);
  const records = await page.evaluate(async root=>{
    const list=await invoke('agent_chat_list',{root});
    return Promise.all(list.map(({id})=>invoke('agent_chat_read',{root,id})));
  },a);
  assert.equal(records.length,2);
  const prior=records.find(r=>r.snapshot.id===original.id), copy=records.find(r=>r.snapshot.id!==original.id);
  assert.equal(prior.revision,2); assert.equal(prior.snapshot.messages[0].text,'other writer');
  assert.equal(copy.revision,1); assert.equal(copy.snapshot.messages.at(-1).text,'local changes');

  // A regular file in the disposable work directory prevents .dalizi from becoming a directory.
  const blocker=path.join(b,'.dalizi'); await fs.writeFile(blocker,'fixture',{flag:'wx'});
  await page.evaluate(()=>addAiMessage(aiCurrentSession(),'user','B only'));
  await page.waitForFunction(()=>!!aiCurrentSession().archive.failedWrite);
  await choose(page.evaluate(()=>newAiConversation()),b,'discard');
  assert.equal(await page.evaluate(()=>aiCurrentSession().messages.length),0);
  assert.equal(await fs.readFile(blocker,'utf8'),'fixture');
  await page.evaluate(()=>addAiMessage(aiCurrentSession(),'user','B retry'));
  await page.waitForFunction(()=>!!aiCurrentSession().archive.failedWrite);
  const retry=page.evaluate(()=>newAiConversation()); await modal.waitFor();
  await fs.unlink(blocker);
  await choose(retry,b,'retry');
  assert.equal(await page.evaluate(()=>aiCurrentSession().messages.length),0);
  const saved=await page.evaluate(async root=>{
    const list=await invoke('agent_chat_list',{root});
    if(list.length!==1) throw Error('Unexpected folder B records');
    return (await invoke('agent_chat_read',{root,id:list[0].id})).snapshot.messages;
  },b);
  assert.deepEqual(saved.map(m=>m.text),['B retry']);
  // Resume the copy in the pinned project, then attempt to replace its unsaved text with the older chat.
  await page.evaluate(root=>{aiProjectRoot=root; syncAiWorkspace();},a);
  await page.waitForFunction(id=>aiCurrentSession()?.archive?.id===id && !aiCurrentSession().restoring,copy.snapshot.id);
  await page.evaluate(async()=>{
    const s=aiCurrentSession(), snapshot=aiArchiveSnapshot(s);
    snapshot.messages[0].text='updated copy on disk';
    await invoke('agent_chat_save',{root:s.root,snapshot,expectedRevision:s.archive.revision});
    addAiMessage(s,'user','pinned unsaved');
  });
  await page.waitForFunction(()=>!!aiCurrentSession().archive.failedWrite);
  const priorRestore=await fs.readFile(disk);
  await page.locator('[data-chat-open]').click();await page.locator('[data-chat-item]').first().waitFor();
  const index=await page.evaluate(id=>chatHistoryView.items.findIndex(item=>item.id===id),original.id);
  await page.locator('[data-chat-item="'+index+'"]').click(); await page.locator('#chatContinue').waitFor();
  await choose(page.locator('#chatContinue').click(),a,'keep');
  await page.waitForFunction(()=>chatHistoryView && !chatHistoryView.busy);
  assert.equal(await page.evaluate(()=>aiCurrentSession().messages.at(-1).text),'pinned unsaved');
  await choose(page.locator('#chatContinue').click(),a,'discard');
  await page.waitForFunction(id=>aiCurrentSession().archive.id===id && !document.querySelector('#chatHistoryDialog'),original.id);
  assert.equal(await page.evaluate(()=>aiCurrentSession().messages[0].text),'other writer');
  assert.deepEqual(await fs.readFile(disk),priorRestore);
  const multiTab=await page.evaluate(async({a,b})=>{
    aiProjectRoot='';syncAiWorkspace();await newTab(a);
    for(const root of [a,b]){
      if(root!==state.path) await navigate(root);
      const s=aiCurrentSession();addAiMessage(s,'user','saved before conflict');
      if(!await saveAiArchive(s))throw Error('Could not prepare both folder conversations');
      await invoke('agent_chat_save',{root,snapshot:aiArchiveSnapshot(s),expectedRevision:s.archive.revision});
      addAiMessage(s,'user','still only in memory');
      if(await saveAiArchive(s))throw Error('Expected version conflict');
    }
    return state.tab;
  },{a,b});
  const bulk=page.evaluate(i=>closeTab(i),multiTab);
  await choose(Promise.resolve(),a,'discard'); await choose(bulk,b,'keep');
  // The later refusal kept the entire tab. An earlier discard must not authorize a new attempt.
  await choose(page.evaluate(i=>closeTab(i),multiTab),a,'keep');
  assert.equal(await page.evaluate(()=>aiCurrentSession().messages.at(-1).text),'still only in memory');
  assert.equal(requests.length,0);
  console.log('Native archive recovery OK: repeated new chat, background close, pinned history restore, version conflict, independent copy, keep/discard/retry, two isolated folders; zero model requests.');
};
