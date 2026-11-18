// Actual OpenSSH daemon + internal-sftp inside the generated Linux guest.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises'),crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
module.exports=async({exe,getPage,manifest,a,addr,requests,responses,until,launch,close})=>{
  const folder=path.dirname(await fs.realpath(exe));
  assert.equal(await fs.realpath(manifest),path.join(folder,'fixture.json'));
  assert.equal(path.dirname(folder),await fs.realpath(path.resolve(__dirname,'../src-tauri/target/openssh-guests')));
  const [g,other]=JSON.parse(await fs.readFile(manifest,'utf8'));
  assert.notEqual(g.host,other.host);assert.notEqual(g.fingerprint,other.fingerprint);assert.equal(g.port,other.port);
  const config=peer=>({host:peer.host,port:peer.port,user:'alpine',identityFile:peer.identityFile,infoMode:'posix'});
  const cmd=(n,o={})=>getPage().evaluate(([n,o])=>invoke(n,o),[n,o]);
  const payload={endpoint:addr,model:'deepseek-v4-pro',apiFormat:'anthropic-messages'};
  const submit=id=>cmd('harness_submit',{id,question:'Explain the selected note',apiKey:'guest-model-key'});
  let session,second,task;
  try {
    const status=await cmd('harness_engine_status');assert.equal(status.source,'component');assert.equal(status.enabled,true);
    for(const [peer,label] of [[g,'a'],[other,'b']]){
      assert.equal(peer.label,label);assert.match(peer.nonce,/^[0-9a-f]{24}$/);
      assert.equal(peer.identityFile,path.join(folder,'peer-'+label,'client-key'));
      const probe=await cmd('ssh_probe_host',{config:config(peer)});
      assert.equal(probe.previous,null,'Refusing to change an existing host trust entry');
      assert.equal(probe.fingerprint,peer.fingerprint,'Host key must match this guest console');
      await fs.writeFile(path.join(folder,'peer-'+label,'trust-owned'),peer.nonce,{flag:'wx'});
      await cmd('ssh_trust_host',{token:probe.token});
    }
    const page=getPage();
    const open=async peer=>{await page.evaluate(async({config,addr})=>{
      setLocale('zh');aiSettings={endpoint:addr,model:'deepseek-v4-pro',apiFormat:'anthropic-messages'};aiSessionKey='guest-model-key';
      await newSshTab({...config,managed:true,label:'OpenSSH QA'}, {secret:'',remember:false});
    },{config:config(peer),addr});
    await page.waitForFunction(()=>curTab()?.sshFiles?.taskBinding);
    return page.evaluate(()=>curTab().termId);};
    session=await open(g);
    const list=async rel=>{
      await page.evaluate(async rel=>loadSshFiles(curTab(),'/home/alpine/'+rel),rel);
      const v=await page.evaluate(()=>({path:curTab().sshFiles.path,binding:curTab().sshFiles.taskBinding,entries:curTab().sshFiles.entries}));
      assert.equal(v.path,'/home/alpine/'+rel);assert.ok(v.binding);return v;
    };
    const preview=(v,files,id=session)=>cmd('harness_prepare_remote',{sessionId:id,token:v.binding.token,files,...payload});
    const upper=await list('Paper'),d=await preview(upper,['notes.md']);
    assert.equal(d.snapshot.files[0].text,'UPPER');
    const lower=await list('paper');assert.notEqual(upper.binding.workspace.identity,lower.binding.workspace.identity);
    await assert.rejects(submit(d.id),/变化/);
    assert.equal((await preview(lower,['notes.md'])).snapshot.files[0].text,'LOWER');
    const shared=await list('shared');await assert.rejects(preview(shared,['notes.md']),/私有/);
    const selected=await list('private');
    assert.ok(selected.entries.some(e=>e.name==='alias.md' && e.isLink===true));
    await assert.rejects(preview(selected,['alias.md']),/列表/);assert.equal(requests.length,0);
    const panel=page.locator('.term.ssh-terminal-host:visible .ssh-files');
    await panel.locator('.ssh-file-row').filter({hasText:'notes.md'}).click();
    await panel.locator('[data-remote-ask]').click();
    const dialog=page.locator('#harnessTasksDialog');
    assert.ok((await dialog.locator('[data-target]').textContent()).includes('/home/alpine/private'));
    await dialog.locator('[data-prepare]').click();
    await page.waitForFunction(()=>document.querySelector('#harnessTasksDialog [data-files]')?.textContent.includes('DALIZI_OPENSSH_SELECTED'));
    await dialog.locator('textarea').fill('Explain the selected note');await dialog.locator('[type=submit]').click();
    await until(()=>requests.length===1);
    const body=JSON.stringify(requests[0]);assert.deepEqual(requests[0].tools??[],[]);
    assert.ok(body.includes('DALIZI_OPENSSH_SELECTED'));for(const omitted of ['DALIZI_OPENSSH_OTHER','DALIZI_OPENSSH_PEER_B',g.host,g.fingerprint,g.identityFile,other.host,other.fingerprint])assert.ok(!body.includes(omitted));
    await dialog.locator('[data-close]').click();
    second=await open(other);
    await page.waitForFunction(()=>['closed','unavailable'].includes(curTab()?.sshTerminalState));
    const otherView=await list('private');
    assert.equal(otherView.path,selected.path);assert.notEqual(otherView.binding.workspace.identity,selected.binding.workspace.identity);
    await assert.rejects(preview(selected,['notes.md'],second),/变化/);
    await cmd('term_kill',{id:session});session=null;
    const frames=[{type:'message_start',message:{id:'guest',model:'deepseek-v4-pro',usage:{input_tokens:1,output_tokens:0}}},
      {type:'content_block_start',index:0,content_block:{type:'text',text:'OPENSSH_ANSWER'}},{type:'content_block_stop',index:0},
      {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:1}},{type:'message_stop'}];
    responses[0].writeHead(200,{'content-type':'text/event-stream'}).end(frames.map(v=>'event: '+v.type+'\ndata: '+JSON.stringify(v)+'\n\n').join(''));
    const rows=b=>cmd('harness_list',{remoteWorkspace:b.workspace.identity});
    task=await until(async()=>(await rows(selected.binding)).find(t=>t.status==='succeeded'));
    assert.equal(task.result,'OPENSSH_ANSWER');assert.equal(task.snapshotOffline,true);
    assert.equal(task.remoteSource.hashes['notes.md'],sha('DALIZI_OPENSSH_SELECTED'));
    assert.deepEqual(await rows(upper.binding),[]);assert.deepEqual(await rows(lower.binding),[]);assert.deepEqual(await cmd('harness_list',{root:a}),[]);
    assert.deepEqual(await rows(otherView.binding),[]);
    const peerDraft=await preview(otherView,['notes.md'],second);assert.equal(peerDraft.snapshot.files[0].text,'DALIZI_OPENSSH_PEER_B');
    await cmd('term_kill',{id:second});second=null;
    await close();await launch();
    const restored=await rows(selected.binding);assert.equal(restored.length,1);
    assert.equal(restored[0].id,task.id);assert.equal(restored[0].result,'OPENSSH_ANSWER');
    assert.equal(restored[0].snapshotOffline,true);
    assert.equal(restored[0].remoteSource.hashes['notes.md'],sha('DALIZI_OPENSSH_SELECTED'));
    assert.deepEqual(await rows(otherView.binding),[]);assert.deepEqual(await cmd('harness_list',{root:a}),[]);
    assert.equal(requests.length,1);
    await cmd('harness_forget',{id:task.id});task=null;
    await fs.writeFile(path.join(folder,'desktop-acceptance.json'),JSON.stringify({exeSha256:sha(await fs.readFile(exe)),component:status.component,
      peerVerifiedFromGuestConsole:true,caseDistinctDirectories:true,staleDraftRejected:true,sharedDirectoryRejected:true,
      linkRejected:true,selectedTextOnly:true,modelRequests:requests.length,modelTools:0,answerPreservedAfterDisconnectAndRestart:true,
      independentHostKeys:true,sameUserPortAndRemotePath:true,crossPeerTokenRejected:true,sftpAfterShellClosed:true,secondHostHistoryEmpty:true},null,2)+'\n',{flag:'wx'});
    console.log('Two OpenSSH guests: same user, port and path, independent keys, SFTP-only login, zero model tools, isolated history after disconnect and restart.');
  } finally {
    if(session)await cmd('term_kill',{id:session}).catch(()=>{});
    if(second)await cmd('term_kill',{id:second}).catch(()=>{});
    if(task)await cmd('harness_forget',{id:task.id}).catch(()=>{});
    await cmd('harness_engine_set',{enabled:false}).catch(()=>{});
  }
};
