// Native smoke for the separately identified debug fixture, never a production profile.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {chromium} = require('playwright');
const delay = ms => new Promise(r=>setTimeout(r,ms));
const listen = server => new Promise((ok,no)=>server.once('error',no).listen(0,'127.0.0.1',ok));
async function until(operation) {
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){const value=await operation(); if(value)return value;await delay(100);}
  throw Error('timed out waiting for native fixture');
}
async function main() {
  const exe=process.argv[2];
  const m5=process.argv.includes('--m5');
  const openssh=process.argv.includes('--openssh');
  if(!exe || path.basename(exe)!==(openssh?'openssh-fixture.exe':m5?'harness-release-fixture.exe':'harness-m1-fixture.exe'))throw Error('Pass a separately identified test executable');
  if(openssh && !(await fs.readFile(exe)).includes('com.dalizi.openssh-qa'))throw Error('Expected a test-only OpenSSH desktop profile');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dalizi-m1-'));
  const a=path.join(dir,'A'), b=path.join(dir,'B');
  const requests=[], responses=[], errors=[];
  const server=http.createServer(async(req,res)=>{
    try {
      assert.equal(req.url,'/v1/messages');let body='';for await(const part of req){body+=part;assert.ok(body.length<512*1024);}
      requests.push(JSON.parse(body));responses.push(res);
    }catch(e){errors.push(String(e));res.writeHead(400).end();}
  });
  let app,browser,page;
  async function launch(){
    const probe=http.createServer();await listen(probe); const port=probe.address().port;await new Promise(ok=>probe.close(ok));
    const env={...process.env};
    if(m5||openssh){env.PATH=path.join(process.env.SystemRoot,'System32');delete env.NODE_PATH;delete env.NODE_OPTIONS;}
    app=spawn(path.resolve(exe),[],{cwd:dir,windowsHide:true,stdio:'ignore',env:{...env,WEBVIEW2_USER_DATA_FOLDER:path.join(dir,'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port}`}});
    const endpoint=await until(async()=>{if(app.exitCode!=null)throw Error('fixture exited '+app.exitCode);try{return await (await fetch('http://127.0.0.1:'+port+'/json/version')).json();}catch{return null;}});
    browser=await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
    page=await until(()=>browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('tauri.localhost')));
    page.on('pageerror',e=>errors.push(String(e)));
    await page.waitForFunction(()=>typeof workspaceSessionReady!=='undefined' && workspaceSessionReady && !state.loading);
    if(!process.argv.includes('--m5'))await page.evaluate(()=>invoke('harness_engine_set',{enabled:true}));
  }
  async function close(){
    if(browser){await browser.close().catch(()=>{});browser=null;}
    if(app && app.exitCode===null && !app.signalCode){const done=once(app,'exit');app.kill();await done;}
    app=null;
  }
  const list=(root)=>page.evaluate(root=>invoke('harness_list',{root}),root);
  try {
    await listen(server); const addr='http://127.0.0.1:'+server.address().port+'/v1';
    const observer=process.argv.indexOf('--cloud-observer');
    if(observer>=0){
      assert.ok(m5&&!openssh);
      await require('./harness_cloud_observer.cjs')({exe,tag:process.argv[observer+1],core:process.argv[observer+2],dir,a,b,addr,
        getPage:()=>page,launch,close,requests,responses,until});
      assert.deepEqual(errors,[]);return;
    }
    for(const folder of [a,b])await fs.mkdir(folder);
    const workspaceChecks = {'--file-tab-scope':'./file_tab_scope_checks.cjs', '--terminal-restore':'./terminal_restore_checks.cjs', '--pinned-auto':'./pinned_auto_checks.cjs', '--pinned-selection':'./pinned_selection_checks.cjs', '--model-switch':'./ai_model_switch_checks.cjs', '--session-cache':'./ai_session_cache_checks.cjs', '--archive-recovery':'./ai_archive_recovery_checks.cjs', '--desktop-exit':'./desktop_exit_checks.cjs', '--history-scope':'./harness_history_scope_checks.cjs'};
    workspaceChecks['--agent-roles'] = './agent_role_checks.cjs';
    workspaceChecks['--skill-copies'] = './skill_copy_checks.cjs';
    workspaceChecks['--file-history'] = './file_history_checks.cjs';
    const workspaceCheck = Object.keys(workspaceChecks).find(flag=>process.argv.includes(flag));
    if(workspaceCheck){
      assert.ok(!m5 && !openssh && (await fs.readFile(exe)).includes('com.dalizi.files.harness-m1-test'));
      await launch();
      const check=require(workspaceChecks[workspaceCheck]);
      await check({page,a,b,dir,addr,requests,responses,until,app,getPage:()=>page,launch,close});
      assert.deepEqual(errors,[]);return;
    }
    const name='需求.md';
    if(openssh){await launch();
      await require('./harness_openssh_checks.cjs')({exe,getPage:()=>page,manifest:process.argv[4],a,addr,requests,responses,until,launch,close});
      assert.deepEqual(errors,[]);return;}
    if(m5){const started=Date.now();await launch();
      await require('./harness_m5_checks.cjs')({getPage:()=>page,getApp:()=>app,exe:path.resolve(exe),image:process.argv[4],a,addr,requests,responses,until,launch,close,startupMs:Date.now()-started});
      assert.deepEqual(errors,[]);return;}
    const remoteChecks=()=>require('./harness_m4_checks.cjs')({getPage:()=>page,dir,a,addr,requests,responses,until,launch,close});
    if(process.argv.includes('--m4')){await launch();await remoteChecks();assert.deepEqual(errors,[]);return;}
    await fs.writeFile(path.join(a,name),'M1_SELECTED_A');await fs.writeFile(path.join(b,name),'M1_OTHER_B');
    await fs.writeFile(path.join(a,'AGENTS.md'),'M1_UNSELECTED_INSTRUCTION');
    await launch();
    await page.evaluate(async({a,addr,name})=>{
      setLocale('zh');aiProjectRoot='';await navigate(a);await newTab(a);openAiAssistant();
      aiSettings={endpoint:addr,model:'deepseek-v4-pro',apiFormat:'anthropic-messages'};aiSessionKey='local-test-key';
      state.selection=new Set([name]);renderAll();
    },{a,addr,name});
    const prepareOptions={root:a,sourceRoot:a,files:[name],endpoint:addr,apiFormat:'anthropic-messages',model:'deepseek-v4-pro'};
    const prepare=options=>page.evaluate(options=>invoke('harness_prepare',options),options);
    await assert.rejects(prepare({...prepareOptions,apiFormat:'openai-completions'}),/Messages/);
    // A source mismatch must win even over a nonexistent target file: no target file is opened.
    await assert.rejects(prepare({...prepareOptions,sourceRoot:b,files:['not-opened.md']}),/不属于/);
    await page.click('#harnessTasksButton');await page.click('#harnessTasksDialog [data-prepare]');
    await page.waitForFunction(()=>document.querySelector('#harnessTasksDialog [data-files]')?.textContent.includes('M1_SELECTED_A'));
    // B's independent preview finishes while A's reviewed form remains open.
    const other=await prepare({...prepareOptions,root:b,sourceRoot:b});
    assert.equal(other.snapshot.files[0].text,'M1_OTHER_B');
    await fs.writeFile(path.join(a,name),'M1_CHANGED_AFTER_PREVIEW');
    await page.fill('#harnessTasksDialog textarea','解释这份快照');
    assert.ok(await page.locator('#harnessTasksDialog form').evaluate(f=>{
      f.requestSubmit();const locked=f.elements.question.readOnly;f.requestSubmit();return locked;
    }),'The reviewed question stays fixed until the desktop acknowledges submission');
    await page.waitForFunction(()=>document.querySelector('#harnessTasksDialog [data-history] details') ||
      document.querySelector('#harnessTasksDialog [role=status]')?.textContent);
    assert.equal(await page.locator('#harnessTasksDialog form').isHidden(),true,
      'A submission after B preview: '+await page.locator('#harnessTasksDialog [role=status]').textContent());
    await page.waitForFunction(()=>document.querySelector('#harnessTasksDialog [data-history] details'));
    const [first]=await list(a);assert.equal(first.status,'running');
    const replay=(id,question)=>page.evaluate(v=>invoke('harness_submit',{...v,apiKey:''}),{id,question});
    await assert.rejects(replay(first.id,'运行中换一个问题'),/重新预览/);
    await page.click('#harnessTasksDialog [data-close]');await page.evaluate(()=>closeTab(state.tab));
    await page.waitForFunction(a=>!state.loading && state.path===a,a);
    await page.evaluate(async b=>{toggleDualPane(true);await loadCompanion(b);},b);
    await page.locator('#companionPane .pane-file').filter({hasText:name}).click();
    assert.equal(await page.evaluate(()=>harnessSelection()),null,'Selecting a companion file cannot attach it to A');
    await page.click('#companionPane [data-work]');
    await page.waitForFunction(({a,b,name})=>!state.loading && state.path===b &&
      companionFor()?.path===a && harnessSelection()?.files.includes(name),{a,b,name});
    await page.click('#harnessTasksButton');
    assert.equal(await page.locator('#harnessTasksDialog [data-target]').textContent(),'取自左侧工作面板：'+b);
    assert.equal(await page.locator('#harnessTasksDialog [data-history] details').count(),0);
    await page.click('#harnessTasksDialog [data-close]');
    await page.click('#tabReopen');await page.waitForFunction(a=>!state.loading && state.path===a,a);
    await page.click('#harnessTasksButton');
    await page.waitForFunction(id=>[...document.querySelectorAll('#harnessTasksDialog [data-history] details')].some(d=>d.dataset.id===id),first.id);
    assert.equal(await page.locator('#harnessTasksDialog [data-history] details').count(),1);
    await page.click('#harnessTasksDialog [data-close]');await page.evaluate(()=>closeTab(state.tab));
    await page.waitForFunction(b=>!state.loading && state.path===b,b);
    await page.fill('#aiPrompt','B_DRAFT_STAYS_HERE');
    assert.deepEqual(await list(b),[]);
    await until(()=>requests.length===1);
    assert.deepEqual(requests[0].tools??[],[]);const raw=JSON.stringify(requests[0]);
    assert.match(raw,/M1_SELECTED_A/);assert.doesNotMatch(raw,/M1_OTHER_B|M1_CHANGED_AFTER_PREVIEW|M1_UNSELECTED_INSTRUCTION/);
    // A disconnected SSH tab exercises the UI's actual target resolution without a remote host.
    const previousTab=await page.evaluate(()=>{
      const old=state.tab;
      state.tabs.push({kind:'term',connection:'ssh',key:'m1-disconnected',cwd:'',exited:true});
      state.tab=state.tabs.length-1;openHarnessTasks();return old;
    });
    assert.equal(await page.locator('#harnessTasksDialog [data-prepare]').isDisabled(),true);
    const frames=[
      {type:'message_start',message:{id:'fixture',model:'deepseek-v4-pro',usage:{input_tokens:3,output_tokens:0}}},
      {type:'content_block_start',index:0,content_block:{type:'text',text:'ANSWER_BOUND_TO_A'}},
      {type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:1}},{type:'message_stop'}
    ];
    responses[0].writeHead(200,{'content-type':'text/event-stream'}).end(frames.map(f=>'event: '+f.type+'\ndata: '+JSON.stringify(f)+'\n\n').join(''));
    await until(async()=>(await list(a))[0]?.status==='succeeded');assert.deepEqual(await list(b),[]);
    assert.equal((await replay(first.id,first.question)).result,'ANSWER_BOUND_TO_A');
    await assert.rejects(replay(first.id,'另一个问题'),/重新预览/,'A changed question cannot reuse an earlier submission receipt');
    const emptyQuestion=id=>page.evaluate(id=>invoke('harness_submit',{id,question:'',apiKey:'local-test-key'}),id);
    await assert.rejects(emptyQuestion(other.id),/请输入/); // B was not consumed by A.
    await page.evaluate(id=>invoke('harness_discard_preview',{id}),other.id);
    await assert.rejects(emptyQuestion(other.id),/预览已失效/);
    assert.equal(await page.locator('#harnessTasksDialog [data-history] details').count(),0);
    await page.click('#harnessTasksDialog [data-close]');
    await page.evaluate(old=>{state.tabs.pop();state.tab=old;},previousTab);
    assert.equal(await page.inputValue('#aiPrompt'),'B_DRAFT_STAYS_HERE');
    assert.equal(await page.locator('#harnessTasksButton .harness-unread-count').count(),0);
    const count=root=>page.evaluate(root=>invoke('harness_unread_count',{root}),root);
    assert.equal(await count(a),1);assert.equal(await count(b),0);
    const [unseen]=await list(a);assert.equal(unseen.unread,true);
    const mark=(workspace,rev)=>page.evaluate(({id,workspace,rev})=>invoke('harness_mark_read',{id,workspace,resultRevision:rev}),{id:first.id,workspace,rev});
    assert.equal(await mark(other.snapshot.workspace,unseen.resultRevision),false);
    assert.equal(await mark(unseen.workspace,unseen.resultRevision-1),false);
    assert.equal(await fs.readFile(path.join(a,name),'utf8'),'M1_CHANGED_AFTER_PREVIEW');
    assert.equal(await fs.readFile(path.join(b,name),'utf8'),'M1_OTHER_B');
    await page.evaluate(a=>navigate(a),a);
    await page.waitForFunction(()=>document.querySelector('#harnessTasksButton .harness-unread-count')?.textContent==='1 条未读');
    await page.evaluate(()=>closeAiAssistant());
    await page.waitForFunction(()=>document.querySelector('#btnAiAssistant .harness-unread-count')?.textContent==='1 条未读');
    await page.evaluate(()=>openAiAssistant());
    await page.click('#harnessTasksButton');
    await page.waitForFunction(()=>document.querySelector('#harnessTasksDialog summary .harness-unread-count'));
    assert.equal(await count(a),1,'Listing tasks must not acknowledge them');
    await page.click('#harnessTasksDialog [data-history] summary');
    assert.equal(await page.locator('#harnessTasksDialog [data-history] pre').textContent(),'ANSWER_BOUND_TO_A');
    await until(async()=>await count(a)===0);
    await page.waitForFunction(()=>!document.querySelector('#harnessTasksButton .harness-unread-count'));
    await page.click('#harnessTasksDialog [data-close]');
    const second=await page.evaluate(async({a,addr,name})=>{
      const d=await invoke('harness_prepare',{root:a,sourceRoot:a,files:[name],endpoint:addr,apiFormat:'anthropic-messages',model:'deepseek-v4-pro'});
      const submit={id:d.id,question:'stop fixture',apiKey:'local-test-key'};
      const task=await invoke('harness_submit',submit);const duplicate=await invoke('harness_submit',submit);
      if(task.id!==duplicate.id)throw Error('duplicate submission');
      return task.id;
    },{a,addr,name});
    await until(()=>requests.length===2);
    const cleanupPlan=(root)=>page.evaluate(root=>invoke('harness_plan_cleanup',{root}),root);
    const beforeStop=await cleanupPlan(a);assert.equal(beforeStop.records,1);assert.equal(beforeStop.retained,1);
    await page.evaluate(b=>navigate(b),b);
    await page.evaluate(id=>invoke('harness_stop',{id}),second);
    await until(async()=>(await list(a)).find(t=>t.id===second)?.status==='cancelled');
    await assert.rejects(page.evaluate(({a,expected})=>invoke('harness_clear_workspace',{root:a,expected}),{a,expected:beforeStop}),/清单已变化/);
    assert.equal(await page.inputValue('#aiPrompt'),'B_DRAFT_STAYS_HERE');
    assert.equal(await page.locator('#harnessTasksButton .harness-unread-count').count(),0);
    const crash=await prepare(prepareOptions);
    await page.evaluate(id=>invoke('harness_submit',{id,question:'crash fixture',apiKey:'local-test-key'}),crash.id);
    await until(()=>requests.length===3);
    const scratch=path.join(process.env.LOCALAPPDATA,'com.dalizi.files.harness-m1-test','HarnessTasks','turn-'+crash.id);
    assert.ok((await fs.stat(scratch)).isDirectory());
    await close();
    await until(()=>responses[2].destroyed);
    await launch();
    const restored=await list(a);assert.equal(restored.find(t=>t.id===first.id)?.result,'ANSWER_BOUND_TO_A');
    assert.equal((await replay(first.id,first.question)).id,first.id);
    await assert.rejects(replay(first.id,'重启后的新问题'),/重新预览/);
    assert.equal(restored.find(t=>t.id===second)?.status,'cancelled');
    assert.equal(restored.find(t=>t.id===crash.id)?.status,'interrupted');
    assert.equal(restored.find(t=>t.id===first.id).unread,false);
    assert.equal(await count(a),2,'Stopped and recovered tasks must remain unread across restart');
    await assert.rejects(fs.stat(scratch),{code:'ENOENT'});
    const reviewedA=await prepare(prepareOptions),keepB=await prepare({...prepareOptions,root:b,sourceRoot:b});
    await assert.rejects(page.evaluate(()=>invoke('harness_plan_cleanup',{})),/一个目录/);
    const oldPlan=await cleanupPlan(a);assert.equal(oldPlan.records,3);assert.equal(oldPlan.previews,1);
    await assert.rejects(page.evaluate(({b,expected})=>invoke('harness_clear_workspace',{root:b,expected}),{b,expected:oldPlan}),/清单已变化/);
    await page.evaluate(async a=>{aiProjectRoot='';await navigate(a);openAiAssistant();},a);
    await page.click('#harnessTasksButton');
    const dlg=page.locator('#harnessTasksDialog'),confirm=page.locator('#harnessConfirmDialog');
    await dlg.locator('[data-all]').check();assert.ok(await dlg.locator('[data-cleanup]').isHidden());
    await dlg.locator('[data-all]').uncheck();
    await dlg.locator('[data-cleanup]').click();await confirm.locator('[data-cancel]').click();
    assert.equal((await list(a)).length,3);
    await dlg.locator('[data-cleanup]').click();await confirm.waitFor();
    const newA=await prepare(prepareOptions);await confirm.locator('[data-confirm]').click();
    await page.waitForFunction(()=>document.querySelector('#harnessTasksDialog [role=status]').textContent.includes('清单已变化'));
    assert.equal((await list(a)).length,3);assert.equal((await cleanupPlan(a)).previews,2);
    await dlg.locator('[data-cleanup]').click();
    assert.match(await confirm.locator('p').textContent(),/3 条已结束任务、2 份未提交/);
    await confirm.locator('[data-confirm]').click();await until(async()=>!(await list(a)).length);
    await assert.rejects(emptyQuestion(reviewedA.id),/预览已失效/);await assert.rejects(emptyQuestion(newA.id),/预览已失效/);
    await assert.rejects(emptyQuestion(keepB.id),/请输入/);await page.evaluate(id=>invoke('harness_discard_preview',{id}),keepB.id);
    await dlg.locator('[data-close]').click();
    await close();await launch();assert.equal(await count(a),0);
    assert.equal(await fs.readFile(path.join(a,name),'utf8'),'M1_CHANGED_AFTER_PREVIEW');
    assert.equal(await fs.readFile(path.join(b,name),'utf8'),'M1_OTHER_B');
    assert.deepEqual(await list(a),[]);assert.equal(requests.length,3);assert.deepEqual(errors,[]);
    console.log('M1 native OK: reviewed bytes, A/B and SSH isolation, zero tools, deduplication, stop, crash recovery without replay, scratch cleanup and delete.');
    await require('./harness_m2_checks.cjs')({getPage:()=>page,launch,close,requests,responses,until,a,b,addr,name});
    await remoteChecks();
    assert.deepEqual(errors,[]);
  } finally {
    server.closeAllConnections(); if(server.listening)await new Promise(ok=>server.close(ok));
    await close();
    if(path.dirname(dir)!==os.tmpdir() || !path.basename(dir).startsWith('dalizi-m1-'))throw Error('unexpected temp path');
    await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:300});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
