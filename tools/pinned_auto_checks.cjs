// Run only inside the separately identified native desktop fixture, using a loopback provider.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function checkPinnedAuto({page,a,b,addr,requests,responses,until}) {
  const target = 'reviewed-only.txt', content = 'A confirmed this plan';
  await fs.writeFile(path.join(b,'only-in-folder-B.md'),'B private fixture');
  const doc='shared.md', original='Original text in A', revised='Reviewed text in A';
  await fs.writeFile(path.join(a,doc),original);
  await fs.writeFile(path.join(b,doc),'Private text in B');
  const answer=(index,body)=>responses[index].writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({
    role:'assistant',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(body)}],
  }));
  await page.evaluate(async ({a,b,addr}) => {
    setLocale('zh'); aiProjectRoot=''; await navigate(b); openAiAssistant();
    store.set('aiProjects',[{root:a,name:'QA project A'}]);
    aiSettings={endpoint:addr,model:'deepseek-v4-pro',apiFormat:'anthropic-messages'};
    aiSessionKey='fixture-local';
  },{a,b,addr});
  const prompt=page.locator('#aiPrompt');
  await prompt.fill('independent draft B');
  const bTab=await page.evaluate(()=>state.tab);
  await page.evaluate(folder=>newTab(folder),a);
  const aTab=await page.evaluate(()=>state.tab);
  await page.locator('#aiProjectsButton').click();await page.locator('[data-project="0"]').click();
  await page.waitForFunction(root=>aiCurrentSession()?.root===root && !aiCurrentSession().restoring,a);
  await page.locator('#aiProjectTools').check();await page.locator('#aiPermissionMode').selectOption('auto');
  await prompt.fill('Create the reviewed file for A');await prompt.press('Enter');
  await until(()=>requests.length===1);
  const request=JSON.parse(requests[0].messages.at(-1).content);
  assert.equal(path.normalize(request.authorizedRoot),path.normalize(a));
  assert.equal(request.permissionMode,'auto');
  assert.doesNotMatch(JSON.stringify(request),/only-in-folder-B|independent draft B/);
  await page.evaluate(i=>switchTab(i),bTab);
  await page.waitForFunction(folder=>state.path===folder && !state.loading,b);
  assert.equal(await page.locator('#aiPermissionMode').inputValue(),'confirm');
  assert.equal(await page.locator('#aiPermissionMode option[value=auto]').isDisabled(),true);
  await prompt.fill('pinned draft A');
  const plan={summary:'Pinned A proposal',actions:[{kind:'create_text',target,content}]};
  answer(0,plan);
  await page.waitForFunction(()=>!aiCurrentSession().requestId && aiCurrentSession().messages.some(m=>m.planState==='pending'));
  assert.equal(await prompt.inputValue(),'pinned draft A');
  for(const root of [a,b])await assert.rejects(fs.stat(path.join(root,target)),{code:'ENOENT'});
  assert.deepEqual(await page.evaluate(root=>invoke('agent_chat_list',{root}),b),[]);
  await page.evaluate(i=>switchTab(i),aTab);
  await page.waitForFunction(root=>state.path===root && !state.loading,a);
  assert.equal(await page.locator('#aiPermissionMode').inputValue(),'confirm');
  const card=page.locator('[data-ai-plan-details]').last();
  await card.locator('summary').click();
  assert.equal(await card.locator('[data-ai-action=execute]').isDisabled(),true);
  await card.locator('input[type=checkbox]').check();await card.locator('[data-ai-action=execute]').click();
  await page.waitForFunction(()=>aiCurrentSession().messages.some(m=>m.planState==='done') && !aiArchiveNeedsFlush(aiCurrentSession()));
  assert.equal(await fs.readFile(path.join(a,target),'utf8'),content);
  await assert.rejects(fs.stat(path.join(b,target)),{code:'ENOENT'});
  const saved=await page.evaluate(async root=>{
    const rows=await invoke('agent_chat_list',{root});
    return (await invoke('agent_chat_read',{root,id:rows[0].id})).snapshot.messages;
  },a);
  assert.equal(saved.filter(m=>m.role==='assistant' && m.text.includes('Pinned A proposal')).length,1);
  // An edit generated under Auto still needs its diff review after the return to A.
  await page.locator('.row').filter({hasText:doc}).first().click();
  await page.locator('#aiPermissionMode').selectOption('auto');
  await prompt.fill('Update the selected document in A');await prompt.press('Enter');
  await until(()=>requests.length===2);
  answer(1,{inspect:{kind:'read',path:doc}});
  await until(()=>requests.length===3);
  assert.equal(JSON.parse(requests[2].messages.at(-1).content).toolResult.Ok,original);
  await page.evaluate(i=>switchTab(i),bTab);
  await page.waitForFunction(root=>state.path===root && !state.loading,b);
  await page.evaluate(i=>switchTab(i),aTab);
  await page.waitForFunction(root=>state.path===root && !state.loading,a);
  answer(2,{summary:'Review selected document',actions:[{kind:'edit_text',target:doc,content:revised}]});
  await page.locator('[data-ai-action=review-edit]').last().click();
  const diff=page.locator('.document-review');
  assert.match(await diff.innerText(),/Reviewed text in A/);
  assert.equal(await fs.readFile(path.join(a,doc),'utf8'),original);
  await diff.locator('[data-apply]').click();
  await page.waitForFunction(()=>aiCurrentSession().messages.filter(m=>m.planState==='done').length===2 && !aiArchiveNeedsFlush(aiCurrentSession()));
  assert.equal(await fs.readFile(path.join(a,doc),'utf8'),revised);
  assert.equal(await fs.readFile(path.join(b,doc),'utf8'),'Private text in B');
  await page.locator('#aiProjectsButton').click();await page.locator('[data-follow]').click();
  await page.evaluate(i=>switchTab(i),bTab);
  await page.waitForFunction(root=>state.path===root && !state.loading,b);
  assert.equal(await prompt.inputValue(),'independent draft B');
  assert.equal(requests.length,3);
  console.log('Pinned auto native OK: creating a file required confirmation, editing required diff approval after returning to A, same-name B file and independent B draft unchanged; three expected loopback requests.');
};
