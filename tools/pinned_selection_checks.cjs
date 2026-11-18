'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function checkPinnedSelection({page, a, b, addr, requests, responses, until}) {
  const child = path.join(a, 'child');
  await fs.mkdir(child);
  const note = 'selected-child-note.md', other = 'second-child-note.md', local = 'root-note.md';
  await fs.writeFile(path.join(child,note), 'private child fixture');
  await fs.writeFile(path.join(child,other), 'other child fixture');
  await fs.writeFile(path.join(a,local), 'root fixture');
  await fs.writeFile(path.join(b,note), 'independent project fixture');
  await page.evaluate(async ({a,addr}) => {
    setLocale('en'); await navigate(a); openAiAssistant();
    store.set('aiProjects',[{root:a,name:'Test project A'}]);
    aiSettings={endpoint:addr,model:'deepseek-v4-pro',apiFormat:'anthropic-messages'}; aiSessionKey='fixture-only';
  }, {a,addr});
  await page.locator('#aiProjectsButton').click(); await page.locator('[data-project="0"]').click();
  await page.waitForFunction(root=>aiCurrentSession()?.root===root && !aiCurrentSession().restoring,a);
  await page.locator('#aiProjectTools').check();
  const prompt = page.locator('#aiPrompt'), reference = page.locator('#aiReferenceStatus');
  const toggle = page.locator('#aiSelectionContext [data-ai-action="selection"]');
  const select = name=>page.locator('.row').filter({hasText:name}).first().click();
  async function ask(question, expected) {
    const index=requests.length;
    await prompt.fill(question); await prompt.press('Enter'); await until(()=>responses.length===index+1);
    const request=JSON.parse(requests[index].messages.at(-1).content);
    assert.equal(path.normalize(request.authorizedRoot),a);
    assert.deepEqual(request.selectedEntries.map(entry=>entry.path),expected,question);
    responses[index].writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({
      role:'assistant',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({summary:'Done',actions:[]})}],
    }));
    await page.waitForFunction(()=>!aiCurrentSession().requestId);
  }
  await page.evaluate(root=>newTab(root),child); await select(note);
  await ask('Ask about the pinned root without attachments',[]);
  assert.match(await reference.innerText(),/None/);
  await toggle.click(); assert.match(await reference.innerText(),/selected-child-note/);
  await select(other); assert.match(await reference.innerText(),/None/);
  await select(note); assert.match(await reference.innerText(),/None/);
  await toggle.click();
  const childTab=await page.evaluate(()=>state.tab);
  await page.evaluate(root=>newTab(root),b); await select(note);
  assert.equal(await toggle.count(),0); assert.match(await reference.innerText(),/None/);
  await page.evaluate(i=>switchTab(i),childTab);
  await page.waitForFunction(root=>state.path===root && !state.loading,child);
  await select(note); assert.match(await reference.innerText(),/None/);
  await toggle.click();
  await page.evaluate(()=>refresh(true, true));
  assert.match(await reference.innerText(),/selected-child-note/);
  await ask('Use the explicitly attached child file',[path.join('child',note)]);
  assert.match(await reference.innerText(),/None/);
  await ask('Follow up without attaching the child file again',[]);
  await page.evaluate(root=>navigate(root),a); await select(local);
  await ask('Use the current project selection',[local]);
  await page.evaluate(root=>navigate(root),child);
  await page.locator('.row').filter({hasText:note}).first().click({button:'right'});
  await page.getByText('Edit with Agent…',{exact:true}).click();
  assert.match(await reference.innerText(),/selected-child-note/);
  await ask('Review my explicitly referenced document',[path.join('child',note)]);
  assert.equal(requests.length,5);
  console.log('Pinned selection: five loopback requests verified; child attachment explicit, changes revoked it, refresh preserved it, consumed once, root selection and explicit document edit preserved.');
};
