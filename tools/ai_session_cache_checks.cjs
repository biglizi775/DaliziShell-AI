const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

// Invoked only with the test desktop identity, disposable directories and a loopback provider.
module.exports = async function checkSessionCache({page,a,b,dir,addr,requests,responses,until}) {
  const idle=Array.from({length:32},(_,i)=>path.join(dir,'empty-'+i));
  await Promise.all(idle.map(p=>fs.mkdir(p)));
  const firstDraft='only the first A tab should show this', bDraft='B draft stays local';
  const target='after-review.txt', content='Created after returning to the second A tab';
  const prompt=page.locator('#aiPrompt');
  const firstTab=await page.evaluate(async({a,addr})=>{
    setLocale('zh'); aiProjectRoot=''; await navigate(a); openAiAssistant();
    aiSettings={endpoint:addr,model:'deepseek-v4-pro',apiFormat:'anthropic-messages'};aiSessionKey='fixture-only';
    return state.tab;
  },{a,addr});
  await prompt.fill(firstDraft);
  const secondTab=await page.evaluate(async root=>{await newTab(root);return state.tab;},a);
  assert.equal(await prompt.inputValue(),'');
  await page.locator('#aiProjectTools').check();
  await prompt.fill('Prepare a file for this folder.');await prompt.press('Enter');
  await until(()=>requests.length===1);
  const request=JSON.parse(requests[0].messages.at(-1).content);
  assert.equal(path.normalize(request.authorizedRoot),path.normalize(a));
  assert.ok(!JSON.stringify(request).includes(firstDraft));
  const reply={summary:'A plan to review on return',actions:[{kind:'create_text',target,content}]};
  responses[0].writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({
    role:'assistant',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(reply)}],
  }));
  await page.waitForFunction(()=>aiCurrentSession()?.messages.some(m=>m.planState==='pending') && !aiArchiveNeedsFlush(aiCurrentSession()));
  const id=await page.evaluate(()=>{
    const m=aiCurrentSession().messages.find(m=>m.planState==='pending');
    if(m.plan.validForMs!==15*60*1000)throw Error('Missing native pending-plan lifetime');
    return m.plan.id;
  });
  const archive=path.join(a,'.dalizi','chat-history.json'), before=await fs.readFile(archive);
  await page.evaluate(root=>navigate(root),b);
  await prompt.fill(bDraft);
  await page.evaluate(async roots=>{for(const root of roots)await navigate(root);},idle);
  assert.equal(await page.evaluate(()=>aiSessions.size),24);
  assert.equal(await prompt.inputValue(),'');
  assert.deepEqual(await fs.readFile(archive),before);
  assert.ok(!before.toString('utf8').includes(firstDraft));
  for(const root of [b,...idle])await assert.rejects(fs.stat(path.join(root,'.dalizi','chat-history.json')),{code:'ENOENT'});
  await page.evaluate(i=>switchTab(i),firstTab);
  await page.waitForFunction(root=>state.path===root && !state.loading,a);
  assert.equal(await prompt.inputValue(),firstDraft);
  assert.equal(await page.locator('[data-ai-plan-details]').count(),0);
  await page.evaluate(i=>switchTab(i),secondTab);
  await page.waitForFunction(root=>state.path===root && !state.loading,idle.at(-1));
  await page.evaluate(root=>navigate(root),b);assert.equal(await prompt.inputValue(),bDraft);
  await page.evaluate(root=>navigate(root),a);assert.equal(await prompt.inputValue(),'');
  assert.equal(await page.evaluate(()=>aiCurrentSession().messages.find(m=>m.planState==='pending')?.plan.id),id);
  await assert.rejects(fs.stat(path.join(a,target)),{code:'ENOENT'});
  const card=page.locator('[data-ai-plan-details]');
  await card.locator('summary').click();
  assert.ok(await card.locator('[data-ai-action=execute]').isDisabled());
  await card.locator('input[type=checkbox]').check();await card.locator('[data-ai-action=execute]').click();
  await page.waitForFunction(()=>aiCurrentSession().messages.some(m=>m.planState==='done'));
  assert.equal(await fs.readFile(path.join(a,target),'utf8'),content);
  await assert.rejects(fs.stat(path.join(b,target)),{code:'ENOENT'});
  assert.equal(requests.length,1);
  console.log('Native session cache OK: 32 folders, 24 resident sessions, two independent drafts, one original plan confirmed once, no draft-only chat archives.');
};
