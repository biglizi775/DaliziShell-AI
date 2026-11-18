// Called only inside the two test desktops by verify_windows_guest.ps1.
async function runGuestStage(stage, {project, second, endpoint}) {
  const check = (condition, name) => { if (!condition) throw Error(name); };
  const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const call = (name, args = {}) => invoke(name, args);
  const history = id => call('agent_chat_read',{root:project,id});
  const save = (snapshot, expectedRevision=0) => call('agent_chat_save',{root:project,snapshot,expectedRevision});
  const message = (id,text) => ({id,role:'assistant',text,omitHistory:false});
  const chat = (id,text) => ({id,title:id,messages:[message('one',text)],summary:'',summarizedIds:[],compactedMessages:0});
  const receipt = {kind:'inspect',path:'notes.md',status:'success',elapsedMs:1,detail:'GUEST_STEP'};
  const rows = root => call('harness_list',{root});
  const seen = [], metrics = {};
  const pass = name => seen.push(name);
  await navigate(project);
  check(state.entries.some(e=>e.name==='notes.md'),'files unavailable');pass('browse without model credentials');
  if(stage==='firstStart') {
    const s=await call('harness_engine_status');
    check(!s.enabled && s.source==='component','expected an intact, disabled component on first start');
    check((await rows(project)).length===0,'unexpected existing task');
    pass('complete candidate started without credentials; engine off by default');
  } else if(stage==='oldCreate') {
    await save(chat('old-chat','OLD_BODY'));
    await call('agent_memory_save',{memory:{root:project,scope:'folder',content:'GUEST_MEMORY',enabled:true}});
    await call('portable_settings_save',{enabled:true,settings:{locale:'en',theme:'dark',viewMode:'grid'}});
    pass('old desktop saved chat, memory and portable preferences');
  } else if(stage==='newMissing') {
    const s=await call('harness_engine_status');check(!s.enabled && s.source==='unavailable','unexpected engine state');
    let rejected=false;try{await call('harness_engine_set',{enabled:true});}catch(e){rejected=String(e).includes('未找到');}
    check(rejected,'missing component accepted');pass('missing component rejected while files work');
    check((await history('old-chat')).snapshot.messages[0].text==='OLD_BODY','old body unavailable');pass('old chat opened after project copy');
  } else if(stage==='newDamaged') {
    let error='';try{await call('harness_engine_set',{enabled:true});}catch(e){error=String(e);}
    const state=await call('harness_engine_status');
    check(error.includes('组件清单或文件无效') && state.source==='unavailable' && !state.enabled,'truncated archive must be reported as invalid and stay disabled');
    pass('damaged sidecar rejected without preventing file browsing');
  } else if(stage==='newFull') {
    const s=await call('harness_engine_status');check(s.source==='component'&&!s.enabled,'component should start off');
    check((await call('portable_settings_load')).settings.viewMode==='grid','portable preferences unavailable');
    check((await call('agent_profile',{root:project})).memories.some(m=>m.content==='GUEST_MEMORY'),'folder memory unavailable');
    const rich=chat('new-chat','NEW_BODY');rich.messages[0].steps=[receipt];await save(rich);
    await call('harness_engine_set',{enabled:true});
    const opt={root:project,sourceRoot:project,files:['notes.md'],endpoint,model:'deepseek-v4-pro'};
    let routeError='';try{await call('harness_prepare',{...opt,apiFormat:'openai-completions'});}catch(e){routeError=String(e);}
    check(routeError.includes('Messages'),'wrong API format not rejected as expected');pass('unsupported API format rejected before submission');
    const draft=await call('harness_prepare',{...opt,apiFormat:'anthropic-messages'});
    const other=await call('harness_prepare',{...opt,root:second,sourceRoot:second,apiFormat:'anthropic-messages'});
    check(other.snapshot.files[0].text==='DALIZI_M5_OTHER','wrong snapshot in B preview');
    await call('harness_discard_preview',{id:other.id});
    const start=performance.now();
    const submission={id:draft.id,question:'Explain this note',apiKey:'local-test-key'};
    const [first,retry]=await Promise.all([call('harness_submit',submission),call('harness_submit',submission)]);
    check(first.id===draft.id && retry.id===first.id,'duplicate submission returned a different task');
    await navigate(second);
    const end=Date.now()+75000;let task;
    while(Date.now()<end){task=(await rows(project)).find(t=>t.id===draft.id);
      if(task?.status==='succeeded')break;
      check(!['failed','cancelled','interrupted'].includes(task?.status),'local model task failed');
      await new Promise(r=>setTimeout(r,100));}
    check(task?.result==='DALIZI_M5_ANSWER','loopback reply unavailable');check((await rows(second)).length===0,'answer leaked into B');
    let conflict=false;
    try{await call('harness_submit',{...submission,question:'Different question'});}catch(e){conflict=String(e).includes('重新预览');}
    check(conflict && (await rows(project)).length===1,'changed question reused an earlier receipt');
    pass('duplicate sends share one task; a different question cannot reuse its receipt');
    pass('A answered after B previewed and closed its same-name file');
    check(await call('harness_unread_count',{root:project})===1 && await call('harness_unread_count',{root:second})===0,'wrong unread owner');
    openHarnessTasks();
    const dialog=document.querySelector('#harnessTasksDialog');
    const all=dialog.querySelector('[data-all]');
    check(!all.checked,'history opened outside the current directory');
    all.click();
    const row=()=>Array.from(dialog.querySelectorAll('[data-history] details')).find(item=>item.dataset.id===task.id);
    const deadline=Date.now()+10000;
    while(!row() && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,50));
    check(row() && !row().open && row().querySelector('summary .harness-history-owner')?.textContent===task.workspace.path,
      'collapsed all-directories history must identify the owner of the answer');
    all.click();
    check(!dialog.querySelector('[data-history] details, [data-history-action]'),'prior directory still has actionable history');
    const loaded=dialog.querySelector('[data-history-message]');
    const listDeadline=Date.now()+10000;
    while(!loaded.hidden && Date.now()<listDeadline) await new Promise(resolve=>setTimeout(resolve,50));
    check(loaded.hidden && !dialog.querySelector('[data-history] details') &&
      dialog.querySelector('[data-history]').textContent===projectText('暂无任务记录','No tasks yet'),'B did not settle on its own empty list');
    dialog.querySelector('[data-close]').click();
    check(await call('harness_unread_count',{root:project})===1,'a collapsed row consumed the unread result');
    pass('collapsed all-directories row names A; returning to B immediately removes A actions and preserves its unread answer');
    check(await call('harness_mark_read',{id:task.id,workspace:task.workspace,resultRevision:task.resultRevision}),'failed to acknowledge result');
    pass('A unread result is scoped to A and can be acknowledged independently');
    metrics.firstReplyMs=Math.round(performance.now()-start);
    const diag=await call('harness_diag_preview');
    check(JSON.parse(diag.text).events.some(e=>e.stage==='task' && e.outcome==='answered'),'answer missing from diagnostic');
    for(const value of [project,endpoint,'notes.md','local-test-key','DALIZI_M5_SELECTED','DALIZI_M5_ANSWER']){
      check(!diag.text.toLowerCase().includes(value.toLowerCase()),'diagnostic disclosed fixture data');}
    pass('diagnostic preview omits question inputs, endpoint, key and answer');
    await call('harness_engine_set',{enabled:false});pass('selected file answered in A while viewing B; engine disabled');
    pass('new desktop read old preferences and memory and saved new chat with receipt');
  } else if(stage==='unavailable' || stage==='interrupt') {
    await call('harness_engine_set',{enabled:true});
    const d=await call('harness_prepare',{root:project,sourceRoot:project,files:['notes.md'],endpoint,model:'deepseek-v4-pro',apiFormat:'anthropic-messages'});
    const start=performance.now();
    await call('harness_submit',{id:d.id,question:'Synthetic second request',apiKey:'local-test-key'});
    if(stage==='unavailable'){
      const end=Date.now()+200000;let t;
      while(Date.now()<end){t=(await rows(project)).find(v=>v.id===d.id);if(t?.status==='failed')break;
        check(t?.status==='running','unexpected closed-endpoint task state');await new Promise(r=>setTimeout(r,250));}
      check(t?.status==='failed' && !t.result.includes('DALIZI_M5_ANSWER'),'closed endpoint did not fail');
      metrics.closedEndpointFailureMs=Math.round(performance.now()-start);
      pass('closed model endpoint produces a failed task');
    }else{
      await navigate(second);check((await rows(second)).length===0,'running request appeared in B');
      pass('submitted in A and switched to B while request was pending');
    }
    await call('harness_engine_set',{enabled:false});
  } else if(stage==='oldRollback') {
    const list=await call('agent_chat_list',{root:project});
    check(equal(list.map(c=>c.id).sort(),['new-chat','old-chat']),'old desktop could not list both chats');
    const current=(await history('new-chat')).snapshot;
    check(current.messages[0].text==='NEW_BODY' && current.messages[0].steps===undefined,'new body not backward compatible');
    const old=await history('old-chat');old.snapshot.messages.push(message('two','OLD_EDIT'));await save(old.snapshot,old.revision);
    pass('old desktop read both transcripts and saved an edit');
  } else if(stage==='newRestore') {
    check((await history('old-chat')).snapshot.messages[1].text==='OLD_EDIT','rollback edit missing');
    const steps=(await history('new-chat')).snapshot.messages[0].steps;
    check(steps?.length===1 && Object.entries(receipt).every(([k,v])=>steps[0][k]===v),'receipt missing');
    const stored=await rows(project);
    const answered=stored.find(t=>t.status==='succeeded');
    check(answered && (await call('harness_submit',{id:answered.id,question:answered.question,apiKey:''})).result==='DALIZI_M5_ANSWER','could not retrieve original receipt after restart');
    let conflict=false;
    try{await call('harness_submit',{id:answered.id,question:'A new question after restart',apiKey:''});}catch(e){conflict=String(e).includes('重新预览');}
    check(conflict,'changed question accepted after restart');
    pass('after restart only the original question retrieves its saved result with the engine disabled');
    check(await call('harness_unread_count',{root:project})===2 && await call('harness_unread_count',{root:second})===0,'read state changed across restart');
    pass('read answer stays read; failure and interrupted result stay unread after restart');
    check(equal(stored.map(t=>t.status).sort(),['failed','interrupted','succeeded']) && stored.find(t=>t.status==='succeeded').result==='DALIZI_M5_ANSWER','unexpected restored task statuses');
    check((await rows(second)).length===0 && !(await call('harness_engine_status')).enabled,'B history or disabled state changed');
    pass('rollback edit, receipt, A task and disabled engine survived restart');
  } else throw Error('unknown test stage');
  return {checks:seen,metrics};
}
