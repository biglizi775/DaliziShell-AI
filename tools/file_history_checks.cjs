'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function checkHistory({page,a,b,addr,requests,responses,until,close,launch,getPage}) {
  const privateText = 'Fixture text that must stay out of the journal';
  const tasks = path.join(a,'.dalizi','tasks');
  const dialog = () => page.locator('#fileHistoryDialog');
  const detail = () => dialog().locator('.file-history-detail');
  async function openFolder(root) {
    await page.evaluate(async root => {
      setLocale('en'); aiProjectRoot = ''; await navigate(root); openAiAssistant();
    },root);
    await page.locator('[data-file-history]').waitFor();
  }
  async function openEmpty(root) {
    await openFolder(root);
    await page.locator('[data-file-history]').click();
    await dialog().getByText('No file operations recorded in this folder.').waitFor();
    await dialog().locator('[data-close]').click();
    await assert.rejects(fs.stat(path.join(root,'.dalizi','tasks')),{code:'ENOENT'});
  }
  await openEmpty(a);
  await page.evaluate(addr => {
    applyAiRuntimeSettings({endpoint:addr, model:'receipt-fixture', apiFormat:'anthropic-messages'},'');
    aiStreamReplies=false;
  },addr);
  await page.locator('#aiRoleSelect').selectOption('organizer');
  await page.locator('#aiProjectTools').check();
  await page.locator('#aiPrompt').fill('Prepare three local changes for review');
  await page.locator('#aiPrompt').press('Enter');
  await until(()=>responses.length===1);
  responses[0].writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({
    role:'assistant',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({
      summary:'Review the three fixture changes',actions:[
        {kind:'create_text',target:'first.md',content:privateText},
        {kind:'mkdir',target:'collision'}, {kind:'mkdir',target:'later'},
      ],
    })}],
  }));
  const card = page.locator('[data-ai-plan-details]');
  await card.waitFor();
  await assert.rejects(fs.stat(tasks),{code:'ENOENT'});
  await fs.mkdir(path.join(a,'collision'));
  if (!await card.evaluate(el=>el.open)) await card.locator('summary').click();
  await card.locator('[data-ai-confirm]').check();
  await card.locator('[data-ai-action=execute]').click();
  await page.locator('[data-ai-action=file-receipt]').click();
  await detail().getByRole('heading',{name:'Failed',exact:true}).waitFor();
  assert.match(await detail().innerText(),/File organizer.*User confirmed/);
  assert.deepEqual(await detail().locator('li strong').allTextContents(),['Create document · Completed','Create folder · Failed','Create folder · Skipped']);
  assert.equal(await fs.readFile(path.join(a,'first.md'),'utf8'),privateText);
  await assert.rejects(fs.stat(path.join(a,'later')),{code:'ENOENT'});
  const filenames=await fs.readdir(tasks);
  assert.equal(filenames.length,1);
  const journal=path.join(tasks,filenames[0]), original=await fs.readFile(journal,'utf8');
  for (const value of [privateText,addr,'Prepare three local changes']) assert.ok(!original.includes(value));
  // Simulate a torn suffix in the disposable record and verify recovery after a fresh process.
  const prefix=original.trimEnd().split('\n').slice(0,4).join('\n')+'\n';
  await close();
  await fs.writeFile(journal,prefix+'{"event":"out');
  await launch(); page=getPage();
  await openEmpty(b);
  await openFolder(a);
  await page.locator('[data-file-history]').click();
  await dialog().locator('[data-file-id]').click();
  await detail().getByText('Outcome unconfirmed',{exact:false}).waitFor();
  assert.deepEqual(await detail().locator('li strong').allTextContents(),['Create document · Completed','Create folder · Outcome unconfirmed','Create folder · No recorded start']);
  assert.match(await detail().innerText(),/last entry is incomplete/);
  await fs.writeFile(journal,original);
  await detail().locator('[data-remove]').click();
  await detail().locator('[data-confirm-remove]').click();
  await dialog().locator('[data-history-status]').filter({hasText:'Record changed'}).waitFor();
  await dialog().locator('[data-refresh]').click();
  await detail().getByRole('heading',{name:'Failed',exact:true}).waitFor();
  await detail().locator('[data-remove]').click();
  await detail().locator('[data-confirm-remove]').click();
  await dialog().getByText('No file operations recorded in this folder.').waitFor();
  assert.deepEqual(await fs.readdir(tasks),[]);
  assert.equal(await fs.readFile(path.join(a,'first.md'),'utf8'),privateText);
  await assert.rejects(fs.stat(path.join(a,'later')),{code:'ENOENT'});
  assert.equal(requests.length,1);
  console.log('File history OK: reviewed plan, partial failure, process restart, torn suffix, folder scope and revision-checked removal.');
};
