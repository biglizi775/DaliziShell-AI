'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

module.exports = async function checkModelSwitch({page, a, b, addr, requests, responses, until}) {
  let held;
  const secondRequests = [], second = http.createServer(async (req, res) => {
    let body = '';
    for await (const part of req) body += part;
    secondRequests.push({url:req.url, body:JSON.parse(body), key:req.headers['x-api-key']});
    if (body.includes('A_STOP_NEXT')) held=res;
    else reply(res,'B_ONLY_ANSWER');
  });
  function reply(res, text) {
    res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({
      role:'assistant',stop_reason:'end_turn',content:[{type:'text',text}],
    }));
  }
  const target = 'review-in-a.txt';
  await new Promise((resolve,reject)=>second.once('error',reject).listen(0,'127.0.0.1',resolve));
  try {
    const next = 'http://127.0.0.1:' + second.address().port + '/v1';
    await page.evaluate(async ({a,addr}) => {
      setLocale('en'); aiProjectRoot=''; await navigate(a); openAiAssistant();
      applyAiRuntimeSettings({endpoint:addr,model:'model-a',apiFormat:'anthropic-messages'},'fixture-a-key');
      aiStreamReplies=false;
      for(let i=0;i<14;i++) addAiMessage(aiCurrentSession(),i%2?'assistant':'user','A_OLDER_TURN '+i+' '+'context '.repeat(15));
    }, {a,addr});
    const prompt=page.locator('#aiPrompt');
    const tabA=await page.evaluate(()=>state.tab);
    await page.locator('#aiProjectTools').check();
    await prompt.fill('A_REQUEST make a file after review'); await prompt.press('Enter');
    await until(()=>responses.length===1);
    assert.ok(JSON.stringify(requests[0]).includes('A_OLDER_TURN'));
    const id=await page.evaluate(()=>aiCurrentSession().requestId);
    const tabB=await page.evaluate(async b=>{await newTab(b); return state.tab;},b);
    await page.locator('.ai-settings-entry').click();
    await page.locator('#aiKey').fill('replacement-for-A-only');
    await page.locator('#aiEndpoint').fill(next);
    const cleared=await page.locator('#aiKey').inputValue()==='';
    await page.locator('#aiModel').fill('model-b'); await page.locator('#aiKey').fill('fixture-b-key');
    await page.locator('#aiRememberKey').uncheck(); await page.locator('#aiStreamReplies').uncheck();
    await page.locator('[data-ai-action=save-settings]').click();
    const retained=await page.evaluate(id=>Array.from(aiSessions.values()).some(s=>s.requestId===id),id);
    assert.deepEqual({cleared,retained},{cleared:true,retained:true});
    await prompt.fill('B_REQUEST'); await prompt.press('Enter');
    await page.waitForFunction(()=>aiCurrentSession().messages.some(m=>m.text==='B_ONLY_ANSWER'));
    assert.equal(secondRequests.length,1);
    assert.equal(secondRequests[0].url,'/v1/messages'); assert.equal(secondRequests[0].key,'fixture-b-key');
    assert.equal(secondRequests[0].body.model,'model-b');
    assert.doesNotMatch(JSON.stringify(secondRequests[0].body),/A_OLDER_TURN|A_REQUEST/);
    await prompt.fill('independent B draft');
    await page.evaluate(i=>switchTab(i),tabA);
    assert.match(await page.locator('.ai-thinking').innerText(),/model-a/);
    assert.equal(await page.locator('#aiModelLabel').innerText(),'model-b');
    await page.evaluate(i=>switchTab(i),tabB);
    reply(responses[0],JSON.stringify({summary:'A_ONLY_SUMMARY'}));
    await until(()=>responses.length===2);
    assert.ok(JSON.stringify(requests[1]).includes('A_ONLY_SUMMARY'));
    assert.doesNotMatch(JSON.stringify(requests[1]),/B_REQUEST|B_ONLY_ANSWER/);
    for (const [i,request] of requests.entries()) {
      assert.equal(request.model,'model-a'); assert.equal(responses[i].req.headers['x-api-key'],'fixture-a-key');
    }
    const request=JSON.parse(requests[1].messages.at(-1).content);
    assert.equal(path.normalize(request.authorizedRoot),a);
    reply(responses[1],JSON.stringify({summary:'A_ONLY_PROPOSAL',actions:[{kind:'create_text',target,content:'reviewed in A'}]}));
    await page.waitForFunction(a=>Array.from(aiSessions.values()).find(s=>s.root===a)?.messages.some(m=>m.planState==='pending'),a);
    assert.equal(await prompt.inputValue(),'independent B draft');
    assert.equal(await page.locator('[data-ai-plan-details]').count(),0);
    await page.evaluate(i=>switchTab(i),tabA);
    await page.waitForFunction(a=>state.path===a && !state.loading,a);
    const card=page.locator('[data-ai-plan-details]');
    const received=page.locator('.ai-message.assistant').filter({has:card});
    assert.match(await received.locator('.ai-message-label').innerText(),/model-a/);
    assert.equal(await page.locator('#aiModelLabel').innerText(),'model-b');
    await page.locator('.ai-settings-entry').click(); await page.locator('#aiModel').fill('model-b-next');
    await page.locator('[data-ai-action=save-settings]').click();
    await assert.rejects(fs.stat(path.join(a,target)),{code:'ENOENT'});
    await card.locator('summary').click();
    assert.ok(await card.locator('[data-ai-action=execute]').isDisabled());
    await card.locator('input[type=checkbox]').check(); await card.locator('[data-ai-action=execute]').click();
    await page.waitForFunction(()=>aiCurrentSession().messages.some(m=>m.planState==='done') && !aiArchiveNeedsFlush(aiCurrentSession()));
    assert.equal(await fs.readFile(path.join(a,target),'utf8'),'reviewed in A');
    await assert.rejects(fs.stat(path.join(b,target)),{code:'ENOENT'});
    await page.evaluate(i=>switchTab(i),tabB); await page.waitForFunction(b=>state.path===b && !state.loading,b);
    assert.equal(await prompt.inputValue(),'independent B draft');
    const savedA=await fs.readFile(path.join(a,'.dalizi','chat-history.json'),'utf8');
    const savedB=await fs.readFile(path.join(b,'.dalizi','chat-history.json'),'utf8');
    assert.match(savedA,/A_ONLY_PROPOSAL/); assert.doesNotMatch(savedA,/B_ONLY_ANSWER|fixture-[ab]-key/);
    assert.match(savedB,/B_ONLY_ANSWER/); assert.doesNotMatch(savedB,/A_ONLY_PROPOSAL|fixture-[ab]-key/);
    await page.evaluate(i=>switchTab(i),tabA);
    await page.waitForFunction(a=>state.path===a && !state.loading,a);
    await prompt.fill('A_STOP_NEXT');
    await page.evaluate(()=>{ window.qaStoppedTurn=sendAiMessage(); }); await until(()=>held);
    const nextRequest=secondRequests[1];
    assert.equal(nextRequest.body.model,'model-b-next'); assert.equal(nextRequest.key,'fixture-b-key');
    assert.equal(path.normalize(JSON.parse(nextRequest.body.messages.at(-1).content).authorizedRoot),a);
    await page.locator('[data-ai-action=cancel]').click();
    reply(held,JSON.stringify({summary:'LATE_CANCELLED_REPLY',actions:[]}));
    await page.evaluate(()=>window.qaStoppedTurn);
    await page.waitForFunction(()=>!aiCurrentSession().requestId && !aiArchiveNeedsFlush(aiCurrentSession()));
    assert.doesNotMatch(await page.locator('#aiMessages').innerText(),/LATE_CANCELLED_REPLY/);
    assert.equal(requests.length,2); assert.equal(secondRequests.length,2);
    console.log('Model switch OK: original summary and proposal, concurrent B chat, review in A, separate archives, new A turn on new default and explicit stop; four loopback requests.');
  } finally {
    second.closeAllConnections(); await new Promise(resolve=>second.close(resolve));
  }
};
