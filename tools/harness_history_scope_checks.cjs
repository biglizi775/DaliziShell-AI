'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function checkHistoryScope({page, a, b, addr, requests, responses, until}) {
  const missing = path.join(b, 'temporarily-unavailable');
  const filename = 'notes.md';
  await fs.writeFile(path.join(a, filename), 'Only project A owns this snapshot.');
  await page.evaluate(async ({a,addr,filename}) => {
    setLocale('zh'); aiProjectRoot=''; await navigate(a); openAiAssistant();
    aiSettings={endpoint:addr,model:'deepseek-v4-pro',apiFormat:'anthropic-messages'};
    aiSessionKey='fixture-local';
    state.selection=new Set([filename]); renderAll();
  }, {a,addr,filename});
  const tasks = page.locator('#harnessTasksDialog');
  await page.locator('#harnessTasksButton').click(); await tasks.locator('[data-prepare]').click();
  await tasks.locator('textarea').fill('A question');
  await tasks.locator('form button').click();
  await until(()=>requests.length===1);
  const listed = tasks.locator('[data-history] details');
  await listed.waitFor(); const taskId = await listed.getAttribute('data-id');
  const row = tasks.locator('[data-history] details[data-id="'+taskId+'"]');
  await tasks.locator('[data-close]').click();
  await page.locator('[data-file-history]').click();
  const history=page.locator('#fileHistoryDialog');
  await history.locator('[data-source=harness]').click();
  await history.locator('[data-related-row]').filter({hasText:'A question'}).click();
  await history.locator('[data-open-harness]').click();
  await page.waitForFunction(id=>document.querySelector('#harnessTasksDialog details[open]')?.dataset.id===id,taskId);
  await tasks.locator('[data-close]').click();
  // A pinned path can be missing when a removable drive or a moved project is reopened.
  await page.evaluate(async ({b,missing})=>{
    await navigate(b); aiProjectRoot=missing; syncAiWorkspace();
  },{b,missing});
  await page.locator('#harnessTasksButton').click();
  const all = tasks.locator('[data-all]');
  await all.check(); await row.waitFor();
  assert.equal(await row.getAttribute('data-id'),taskId);
  assert.equal(await row.locator('summary .harness-history-owner').textContent(),a);
  const staleRows = await all.evaluate(box=>{
    // Observe the first frame of the change, before the real Rust list request can settle.
    box.click();
    return document.querySelectorAll('#harnessTasksDialog [data-history] details').length;
  });
  assert.equal(staleRows,0,'switching to B exposed a clickable row belonging to A');
  const retry = tasks.locator('[data-history-retry]');
  await retry.waitFor(); assert.equal(await row.count(),0);
  assert.match(await tasks.locator('[data-history-message]').textContent(),/无法读取任务记录/);
  assert.equal(await tasks.locator('[data-history-action]').count(),0);
  const records = root=>page.evaluate(root=>invoke('harness_list',{root}),root);
  assert.equal((await records(a))[0].status,'running');
  await fs.mkdir(missing);
  await retry.click(); await retry.waitFor({state:'hidden'});
  assert.match(await tasks.locator('[data-history]').textContent(),/暂无任务记录/);
  assert.deepEqual(await records(missing),[]);
  const frames=[
    {type:'message_start',message:{role:'assistant',usage:{input_tokens:1,output_tokens:0}}},
    {type:'content_block_start',index:0,content_block:{type:'text',text:'Answer for A'}},
    {type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:1}},
    {type:'message_stop'},
  ];
  responses[0].writeHead(200,{'Content-Type':'text/event-stream'}).end(frames.map(f=>'event: '+f.type+'\ndata: '+JSON.stringify(f)+'\n\n').join(''));
  await until(async()=>(await records(a)).some(record=>record.id===taskId && record.status==='succeeded'));
  const finished=(await records(a))[0];
  assert.equal(await row.count(),0); assert.equal(finished.unread,true); assert.equal(finished.result,'Answer for A');
  assert.match(JSON.stringify(requests[0]),/Only project A owns this snapshot/);
  await all.check(); await row.waitFor(); assert.equal(await row.getAttribute('data-id'),taskId);
  await row.locator('summary').click();
  await until(async()=>!(await records(a))[0].unread);
  await row.locator('[data-history-action]').click();
  const confirm=page.locator('#harnessConfirmDialog');
  await confirm.waitFor();
  await all.evaluate(box=>box.click());
  await confirm.locator('[data-confirm]').click();
  await page.waitForFunction(()=>!document.getElementById('harnessConfirmDialog') &&
    document.querySelector('#harnessTasksDialog [data-history]').textContent.includes('暂无任务记录'));
  assert.equal((await records(a))[0].id,taskId,'a confirmation from a prior view must not remove A');
  assert.deepEqual(await records(missing),[]); assert.equal(requests.length,1);
  await page.evaluate(id=>invoke('harness_forget',{id}),taskId);
  console.log('Native task history OK: scope switch immediately removed A, missing B exposed no actions, retry restored B, A finished once and remained unread until opened.');
};
