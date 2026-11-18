// Runs inside the real desktop fixture; the model responds only on the local mock socket.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
module.exports=async function reviewChecks({getPage,launch,close,requests,responses,until,a,b,addr,name}) {
  const file=path.join(a,name), original='\uFEFF标题\r\n旧行\r\n', changed='\uFEFF标题\r\n新行\r\n';
  const send=(command,args)=>getPage().evaluate(([c,v])=>invoke(c,v),[command,args]);
  const rows=()=>send('harness_list',{root:a});
  const args={root:a,sourceRoot:a,files:[name],endpoint:addr,apiFormat:'anthropic-messages',model:'deepseek-v4-pro',kind:'edit',permissionMode:'confirm'};
  const get=id=>send('harness_get_review',{root:a,id,permissionMode:'confirm'});
  const apply=(id,token,extra)=>send('harness_apply_review',{root:a,id,token,permissionMode:'confirm',...extra});
  const checkStatus=async(id,status)=>until(async()=>(await rows()).find(t=>t.id===id)?.status===status);
  async function prepareTask() {
    const draft=await send('harness_prepare',args);
    const task=await send('harness_submit',{id:draft.id,question:'只修改第二行',apiKey:'local-test-key'});
    return task.id;
  }
  async function respond(index, text) {
    await until(()=>requests.length===index+1);
    assert.deepEqual(requests[index].tools??[],[]);
    assert.match(JSON.stringify(requests[index]),/outputContract/);
    const frames=[{type:'message_start',message:{id:'edit-fixture',model:'deepseek-v4-pro',usage:{input_tokens:1,output_tokens:0}}},
      {type:'content_block_start',index:0,content_block:{type:'text',text}}, {type:'content_block_stop',index:0},
      {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:1}},{type:'message_stop'}];
    responses[index].writeHead(200,{'content-type':'text/event-stream'}).end(frames.map(f=>'event: '+f.type+'\ndata: '+JSON.stringify(f)+'\n\n').join(''));
  }
  const answer=JSON.stringify({target:name,replacement:'标题\n新行\n'});
  async function pending() {
    const index=requests.length, id=await prepareTask();await respond(index,answer);await checkStatus(id,'awaiting_review');return id;
  }
  await fs.writeFile(file,original);
  await assert.rejects(send('harness_prepare',{...args,permissionMode:'auto'}),/确认后执行/);
  await assert.rejects(send('harness_prepare',{...args,permissionMode:'read-only'}),/确认后执行/);
  const page=getPage(),dialog='#harnessTasksDialog';
  await page.evaluate(async({a,addr,name})=>{
    setLocale('zh');aiProjectRoot='';await navigate(a);openAiAssistant();
    aiSettings={endpoint:addr,model:'deepseek-v4-pro',apiFormat:'anthropic-messages'};aiSessionKey='local-test-key';
    state.selection=new Set([name]);renderAll();
  },{a,addr,name});
  const index=requests.length;
  await page.click('#harnessTasksButton');await page.selectOption(dialog+' [data-kind]','edit');
  await page.click(dialog+' [data-prepare]');await page.fill(dialog+' textarea','只修改第二行');await page.click(dialog+' [type=submit]');
  await respond(index,answer);
  const id=(await rows())[0].id;
  await checkStatus(id,'awaiting_review');
  const pendingPlan=await send('harness_plan_cleanup',{root:a});
  assert.equal(pendingPlan.records,0);assert.equal(pendingPlan.retained,1);
  await send('harness_clear_workspace',{root:a,expected:pendingPlan});
  await page.waitForFunction(()=>document.querySelector('#harnessTasksButton .harness-unread-count')?.textContent==='1 条未读');
  const p=await get(id);
  assert.equal(p.original,original);assert.equal(p.replacement,changed);
  await assert.rejects(apply(id,p.token,{root:b}),/当前目录/);
  await send('harness_set_edit_mode',{root:b,permissionMode:'read-only'});
  assert.equal((await get(id)).token,p.token,'changing B must not revoke the review in A');
  await assert.rejects(apply(id,p.token,{permissionMode:'read-only'}),/确认后执行/);
  await assert.rejects(apply(id,'wrong-token'),/无效/);
  assert.equal(await fs.readFile(file,'utf8'),original);
  const row=dialog+' details[data-id="'+id+'"]';
  await page.click(row+' summary');await page.click(row+' [data-review-action=review]');
  assert.match(await page.locator('#harnessReviewDialog .diff-scroll').innerText(),/旧行/);
  assert.match(await page.locator('#harnessReviewDialog .diff-scroll').innerText(),/新行/);
  await page.click('#harnessReviewDialog [data-apply]');await checkStatus(id,'applied');
  await page.click(dialog+' [data-cleanup]');
  assert.match(await page.locator('#harnessConfirmDialog p').textContent(),/1 条已写入任务将失去.*撤销入口/);
  await page.click('#harnessConfirmDialog [data-cancel]');
  await assert.rejects(apply(id,p.token),/已处理|失效/);assert.equal(await fs.readFile(file,'utf8'),changed);
  await page.click(dialog+' [data-close]');
  await close();await launch();
  await checkStatus(id,'applied');
  const undo=()=>send('harness_undo_review',{id,root:a,permissionMode:'confirm'});
  await fs.writeFile(file,'manual');await assert.rejects(undo(),/内容已变化/);assert.equal(await fs.readFile(file,'utf8'),'manual');
  await fs.writeFile(file,changed);
  await getPage().evaluate(async root=>{await navigate(root);openAiAssistant();},a);
  await getPage().click('#harnessTasksButton');await getPage().click(row+' summary');
  await getPage().click(row+' [data-review-action=undo]');await getPage().click('#harnessConfirmDialog [data-cancel]');
  assert.equal(await fs.readFile(file,'utf8'),changed);
  await getPage().click(row+' [data-review-action=undo]');await getPage().click('#harnessConfirmDialog [data-confirm]');
  await checkStatus(id,'undone');assert.equal(await fs.readFile(file,'utf8'),original);
  await getPage().click(dialog+' [data-close]');
  await assert.rejects(undo(),/没有可撤销/);

  const conflict=await pending(), pc=await get(conflict);
  await fs.writeFile(file,'newer edit');await assert.rejects(apply(conflict,pc.token),/发生变化/);
  await checkStatus(conflict,'not_applied');assert.equal(await fs.readFile(file,'utf8'),'newer edit');
  await fs.writeFile(file,original);
  const revoked=await pending(), pr=await get(revoked);
  const editA1=await send('harness_prepare',args), editA2=await send('harness_prepare',args);
  const readA=await send('harness_prepare',{...args,kind:'question'});
  const editB=await send('harness_prepare',{...args,root:b,sourceRoot:b});
  await getPage().evaluate(async root=>{await navigate(root);openAiAssistant();setAiPermissionMode('read-only');},a);
  await checkStatus(revoked,'rejected');
  const checkDraft=id=>send('harness_submit',{id,question:'',apiKey:'local-test-key'});
  for(const d of [editA1,editA2])await assert.rejects(checkDraft(d.id),/预览已失效/);
  for(const d of [readA,editB]){
    await assert.rejects(checkDraft(d.id),/请输入/);
    await send('harness_discard_preview',{id:d.id});
  }
  await assert.rejects(apply(revoked,pr.token),/权限已关闭/);
  await assert.rejects(send('harness_prepare',args),/权限已关闭/);
  await getPage().evaluate(async()=>{setAiPermissionMode('confirm');await harnessRevocations.get(aiKey(aiCurrentSession().root));});
  await assert.rejects(apply(revoked,pr.token),/失效|已处理/);
  const activeIndex=requests.length, active=await prepareTask();
  await until(()=>requests.length===activeIndex+1);
  const activeRow=dialog+' details[data-id="'+active+'"]';
  await getPage().click('#harnessTasksButton');await getPage().click(activeRow+' summary');
  await send('harness_set_edit_mode',{root:a,permissionMode:'read-only'});
  await checkStatus(active,'cancelled');await until(()=>responses[activeIndex].destroyed);
  await getPage().locator(activeRow+' pre').scrollIntoViewIfNeeded();
  await until(async()=>(await rows()).find(t=>t.id===active)?.unread===false);
  assert.equal(await getPage().locator(activeRow+' summary').evaluate(el=>el===document.activeElement),true);
  await getPage().click(dialog+' [data-close]');
  await send('harness_set_edit_mode',{root:a,permissionMode:'confirm'});
  await assert.rejects(get(active),/已失效|已处理/);
  const stopped=await pending();await send('harness_stop',{id:stopped});await checkStatus(stopped,'rejected');
  const invalidIndex=requests.length, invalid=await prepareTask();
  await respond(invalidIndex,JSON.stringify({target:'other.md',replacement:'must not write'}));await checkStatus(invalid,'failed');
  const expired=await pending(), pe=await get(expired), count=requests.length;
  await close();await launch();await checkStatus(expired,'interrupted');
  await assert.rejects(apply(expired,pe.token),/失效|已处理/);
  assert.equal(await fs.readFile(file,'utf8'),original);assert.equal(await fs.readFile(path.join(b,name),'utf8'),'M1_OTHER_B');
  assert.equal(requests.length,count);
  for(const task of await rows())await send('harness_forget',{id:task.id});
  console.log('M2 native OK: reviewed diff, scoped approval, exact bytes/undo after restart, conflicts, revocation, malformed output, stale approval and no replay.');
};
