// Two independently keyed SFTP servers. The production desktop, dsh and UI run normally.
const assert=require('node:assert/strict'), fs=require('node:fs/promises'), path=require('node:path');
const {spawn}=require('node:child_process'), {once}=require('node:events'),{createInterface}=require('node:readline');
async function server(dir){
  const venv=path.resolve(__dirname,'../src-tauri/target/m4-venv/Scripts/python.exe');
  const python=process.env.DALIZI_PYTHON || (await fs.stat(venv).catch(()=>null)?venv:'python');
  const child=spawn(python,['-u',path.join(__dirname,'ssh_managed_fixture.py'),dir,'--task-files'],{windowsHide:true,stdio:['pipe','pipe','inherit']});
  const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();const done=once(child,'exit');
  async function next(){let timer;try{const row=await Promise.race([lines.next(),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('SFTP fixture reply timed out')),15000))]);if(row.done)throw Error('SFTP fixture exited');return JSON.parse(row.value);}finally{clearTimeout(timer);}}
  const tell=v=>child.stdin.write(v+'\n');
  async function stop(){if(child.exitCode===null && !child.signalCode)child.stdin.end('stop\n');let timer;try{await Promise.race([done,new Promise(ok=>timer=setTimeout(ok,5500))]);}finally{clearTimeout(timer);}if(child.exitCode===null && !child.signalCode){child.kill();await done;}}
  try{return {data:await next(),next,tell,stop};}catch(e){await stop();throw e;}
}
module.exports=async({getPage,dir,a,addr,requests,responses,until,launch,close})=>{
  let page=getPage();const servers=[];const sessions=new Set();
  const ipc=(c,o)=>page.evaluate(([c,o])=>invoke(c,o),[c,o]);
  const cfg=f=>({host:'127.0.0.1',port:f.data.port,user:'fixture',infoMode:'posix',identityFile:null});
  const prepare=(s,files,extra)=>ipc('harness_prepare_remote',{sessionId:s.id,token:s.binding.token,files,endpoint:addr,model:'deepseek-v4-pro',apiFormat:'anthropic-messages',...extra});
  const submit=id=>ipc('harness_submit',{id,question:'Explain the chosen file',apiKey:'local-test-only'});
  const rows=s=>ipc('harness_list',{remoteWorkspace:s.binding.workspace.identity});
  async function connect(f,ui=false){
    const config=cfg(f);let id,binding;
    if(ui){
      await page.evaluate(async({config,secret,addr})=>{
        setLocale('zh');aiSettings={endpoint:addr,model:'deepseek-v4-pro',apiFormat:'anthropic-messages'};aiSessionKey='local-test-only';
        await newSshTab({...config,managed:true,label:'M4 fixture',identityFile:''},{secret,remember:false});
      },{config,secret:f.data.password,addr});
      await page.waitForFunction(()=>curTab()?.sshFiles?.taskBinding);
      [id,binding]=await page.evaluate(()=>[curTab().termId,curTab().sshFiles.taskBinding]);
    }else{
      id=await ipc('ssh_managed_start',{key:'M4-'+require('node:crypto').randomUUID(),config,auth:{secret:f.data.password},cols:80,rows:24});
      ({taskBinding:binding}=await ipc('ssh_files_list',{id,path:'.',bindTasks:true}));
    }
    sessions.add(id);return {id,binding};
  }
  const startCount=requests.length;
  try{
    for(const tag of ['A','B']){
      const f=await server(path.join(dir,'ssh-'+tag));servers.push(f);
      const p=await ipc('ssh_probe_host',{config:cfg(f)});assert.equal(p.previous,null);assert.equal(p.fingerprint,f.data.fingerprint);
      f.tell('allow-cleanup');await ipc('ssh_trust_host',{token:p.token});
      for(const [name,text] of Object.entries({'same.md':'M4_SELECTED_'+tag,'other.md':'M4_UNSELECTED','nofstat.md':'NO_FSTAT','slow.md':'M4_SLOW', 'link.md':'LINK','changed.md':'ORIGINAL'}))await fs.writeFile(path.join(f.data.root,name),text);
      await fs.mkdir(path.join(f.data.root,'shared'));await fs.writeFile(path.join(f.data.root,'shared','same.md'),'SHARED');
    }
    const [A,B]=servers;const sa=await connect(A,true),sb=await connect(B);
    assert.notEqual(sa.binding.workspace.identity,sb.binding.workspace.identity);
    await assert.rejects(prepare(sb,['same.md'],{token:sa.binding.token}),/变化/);
    await assert.rejects(prepare(sa,['link.md']),/列表/);
    await assert.rejects(prepare(sa,['nofstat.md']),/核实/);
    await fs.writeFile(path.join(A.data.root,'changed.md'),'CHANGED_AFTER_LISTING');
    await assert.rejects(prepare(sa,['changed.md']),/核实/);
    const privateDraft=await prepare(sb,['same.md']);
    assert.equal(privateDraft.snapshot.files[0].text,'M4_SELECTED_B');
    assert.ok(privateDraft.remoteSource.capturedAt>0);
    const shared=await ipc('ssh_files_list',{id:sb.id,path:'/shared',bindTasks:true});
    await assert.rejects(submit(privateDraft.id),/变化/);
    await assert.rejects(prepare({id:sb.id,binding:shared.taskBinding},['same.md']),/私有/);
    await assert.rejects(prepare(sb,['../same.md']),/变化|列表/);
    // Real user-visible selection, preview and submission from A's own panel.
    const panel=page.locator('.term.ssh-terminal-host:visible .ssh-files');
    await panel.locator('.ssh-file-row').filter({hasText:'same.md'}).click();await panel.locator('[data-remote-ask]').click();
    const dialog=page.locator('#harnessTasksDialog');assert.match(await dialog.locator('[data-target]').textContent(),new RegExp(':'+A.data.port+'/'));
    await dialog.locator('[data-prepare]').click();
    await page.waitForFunction(()=>{const d=document.querySelector('#harnessTasksDialog');return d?.querySelector('[data-files]').textContent || d?.querySelector('[role=status]').textContent;});
    assert.match(await dialog.locator('[data-files]').textContent(),/M4_SELECTED_A/,'remote preview: '+await dialog.locator('[role=status]').textContent());
    const localName='local-only.md';
    await fs.writeFile(path.join(a,localName),'M4_LOCAL_ONLY');
    const localDraft=await ipc('harness_prepare',{root:a,sourceRoot:a,files:[localName],endpoint:addr,model:'deepseek-v4-pro',apiFormat:'anthropic-messages'});
    await ipc('harness_discard_preview',{id:localDraft.id});
    await fs.writeFile(path.join(A.data.root,'same.md'),'M4_CHANGED_AFTER_PREVIEW');
    await dialog.locator('textarea').fill('Explain chosen remote file');await dialog.locator('[type=submit]').click();
    await until(()=>requests.length===startCount+1);
    const raw=JSON.stringify(requests[startCount]);assert.deepEqual(requests[startCount].tools??[],[]);assert.match(raw,/M4_SELECTED_A/);assert.match(raw,/selectedRemoteSnapshots/);
    for(const omitted of ['M4_SELECTED_B','M4_UNSELECTED','M4_LOCAL_ONLY','M4_CHANGED_AFTER_PREVIEW','NO_FSTAT',A.data.password,A.data.fingerprint,sa.binding.token])assert.ok(!raw.includes(omitted));
    await ipc('term_kill',{id:sa.id});
    const frames=[{type:'message_start',message:{id:'m4',model:'deepseek-v4-pro',usage:{input_tokens:1,output_tokens:0}}},{type:'content_block_start',index:0,content_block:{type:'text',text:'ANSWER_FROM_A'}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:1}},{type:'message_stop'}];
    responses[startCount].writeHead(200,{'content-type':'text/event-stream'}).end(frames.map(f=>'event: '+f.type+'\ndata: '+JSON.stringify(f)+'\n\n').join(''));
    await until(async()=>(await rows(sa))[0]?.status==='succeeded');const [task]=await rows(sa);assert.equal(task.result,'ANSWER_FROM_A');assert.equal(task.snapshotOffline,true);
    assert.deepEqual(await rows(sb),[]);assert.deepEqual(await ipc('harness_list',{root:a}),[]);
    await page.waitForFunction(()=>document.querySelector('#harnessTasksDialog [data-history]')?.textContent.includes('来自断线前的快照'));
    await dialog.locator('[data-all]').check();
    const historyOwner=dialog.locator('[data-history] details[data-id="'+task.id+'"] summary .harness-history-owner');
    assert.equal(await historyOwner.textContent(),sa.binding.workspace.path);
    assert.ok((await historyOwner.textContent()).includes(':'+A.data.port+'/'));
    await dialog.locator('[data-close]').click();
    const count=s=>ipc('harness_unread_count',{remoteWorkspace:s.binding.workspace.identity});
    assert.equal(await count(sa),1);assert.equal(await count(sb),0);
    const fresh=await connect(A,true);assert.equal(fresh.binding.workspace.identity,sa.binding.workspace.identity);
    await page.waitForFunction(()=>curTab().sshFilesPanel.querySelector('[data-remote-ask] .harness-unread-count')?.textContent==='1 条未读');
    await panel.locator('[data-remote-ask]').click();await dialog.locator('[data-history] summary').click();
    await until(async()=>await count(fresh)===0);
    await dialog.locator('[data-cleanup]').click();const remoteConfirm=page.locator('#harnessConfirmDialog');
    assert.ok((await remoteConfirm.locator('p').textContent()).includes(A.data.fingerprint));
    await remoteConfirm.locator('[data-cancel]').click();
    await dialog.locator('[data-close]').click();
    await assert.rejects(prepare(fresh,['same.md'],{token:sa.binding.token}),/变化/);
    const stale=await prepare(fresh,['same.md']);await ipc('term_kill',{id:fresh.id});
    await assert.rejects(submit(stale.id),/已结束|变化/);
    const incoming=await connect(B);const stopped=assert.rejects(prepare(incoming,['slow.md']),/变化|核实|已结束/);
    assert.equal((await B.next()).reading,'slow.md');await ipc('term_kill',{id:incoming.id});B.tell('release-read');await stopped;
    // Replacing a host key on the same endpoint requires re-trust and a different scope.
    const oldKey=await connect(A),oldKeyDraft=await prepare(oldKey,['same.md']);
    A.tell('rotate');const rotated=await A.next(),probe=await ipc('ssh_probe_host',{config:cfg(A)});
    assert.equal(probe.fingerprint,rotated.fingerprint);assert.equal(probe.trusted,false);
    await assert.rejects(connect(A),/握手|handshake/);
    await ipc('ssh_trust_host',{token:probe.token});const replacement=await connect(A);
    await assert.rejects(submit(oldKeyDraft.id),/信任|指纹/);
    assert.notEqual(replacement.binding.workspace.identity,sa.binding.workspace.identity);assert.deepEqual(await rows(replacement),[]);
    assert.equal(requests.length,startCount+1);await close();await launch();page=getPage();
    const [restored]=await rows(sa);assert.equal(restored.result,'ANSWER_FROM_A');assert.equal(restored.snapshotOffline,true);
    assert.equal(restored.remoteSource.hashes['same.md'],require('node:crypto').createHash('sha256').update('M4_SELECTED_A').digest('hex'));
    const oldOwner={remoteWorkspace:sa.binding.workspace},otherOwner={remoteWorkspace:sb.binding.workspace};
    const expected=await ipc('harness_plan_cleanup',oldOwner);assert.equal(expected.records,1);
    await assert.rejects(ipc('harness_clear_workspace',{...otherOwner,expected}),/清单已变化/);
    await assert.rejects(ipc('harness_clear_workspace',{remoteWorkspace:replacement.binding.workspace,expected}),/清单已变化/);
    assert.equal((await rows(sa))[0].id,restored.id);
    await ipc('harness_clear_workspace',{...oldOwner,expected});assert.deepEqual(await rows(sa),[]);
    assert.equal(await fs.readFile(path.join(A.data.root,'same.md'),'utf8'),'M4_CHANGED_AFTER_PREVIEW');
    assert.equal(await fs.readFile(path.join(B.data.root,'same.md'),'utf8'),'M4_SELECTED_B');
    console.log('M4 native OK: two SFTP hosts, scoped listing and capture, rejected changing/shared files, disconnect during capture and after submission, reconnect, key rotation, one model request, restart and isolated history.');
  }finally{
    for(const id of sessions)await ipc('term_kill',{id}).catch(()=>{});
    for(const f of servers)await f.stop();
  }
};
module.exports.startSshFixture = server;
