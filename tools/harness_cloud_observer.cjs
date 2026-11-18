// Exposes only the loopback test model. Never run a production profile from this driver.
const assert=require('node:assert/strict'), fs=require('node:fs/promises'),path=require('node:path');
const {createHash}=require('node:crypto'),exec=require('node:util').promisify(require('node:child_process').execFile);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
module.exports=async function({exe,tag,core,dir,a,b,addr,getPage,launch,close,requests,responses,until}){
  assert.match(tag,/^rc[1-9][0-9]*$/);
  const pin=require('../docs/verification/harness-m5-'+tag+'-windows11.json'),bytes=await fs.readFile(exe);
  const profile=process.env.DALIZI_TEST_PROFILE;
  assert.match(profile||'',/^com\.dalizi\.harness-release-test-[0-9a-f-]{36}$/);
  assert.ok(bytes.includes(profile));assert.equal(sha(bytes),pin.rehearsalExeSha256[1]);
  assert.notEqual(sha(bytes),pin.candidate.exeSha256);
  core=path.resolve(core);
  assert.deepEqual(await fs.readFile(core),await fs.readFile(path.join(__dirname,'cloud_check_core.ps1')));
  const check=phase=>exec('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(__dirname,'cloud_observer_fixture.ps1'),
    '-Core',core,'-Root',dir,'-Profile',profile,'-Endpoint',addr+'/messages','-Phase',phase],{windowsHide:true});
  const c=(n,v={})=>getPage().evaluate(([n,v])=>invoke(n,v),[n,v]);
  await check('Prepare');
  const {question,words}=JSON.parse(await fs.readFile(path.join(dir,'fixture-case.json'),'utf8'));
  await launch();
  const engine=await c('harness_engine_status');assert.equal(engine.source,'component');
  const enabled=engine.enabled;
  let id;
  try{
    await c('harness_engine_set',{enabled:true});
    const draft=await c('harness_prepare',{root:a,sourceRoot:a,files:['notes.md'],endpoint:addr,apiFormat:'anthropic-messages',model:'deepseek-v4-pro'});
    id=draft.id;await c('harness_submit',{id,question,apiKey:'loopback-test-only'});
    await getPage().evaluate(b=>navigate(b),b);
    await until(()=>requests.length===1);
    const raw=JSON.stringify(requests[0]);assert.ok(raw.includes(words[0])&&!raw.includes(words[1])&&!raw.includes(words[2]));
    const frames=[{type:'message_start',message:{id:'fixture',model:'deepseek-v4-pro',usage:{input_tokens:1,output_tokens:0}}},
      {type:'content_block_start',index:0,content_block:{type:'text',text:words[0]}},{type:'content_block_stop',index:0},
      {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:1}},{type:'message_stop'}];
    responses[0].writeHead(200,{'content-type':'text/event-stream'}).end(frames.map(v=>'event: '+v.type+'\ndata: '+JSON.stringify(v)+'\n\n').join(''));
    await until(async()=>(await c('harness_list',{root:a}))[0]?.status==='succeeded');
    assert.deepEqual(await c('harness_list',{root:b}),[]);
    await close();await check('First');await launch();
    await getPage().evaluate(async a=>{aiProjectRoot='';await navigate(a);openAiAssistant();},a);
    await getPage().click('#harnessTasksButton');
    await getPage().click('#harnessTasksDialog details[data-id="'+id+'"] summary');
    await until(async()=>!(await c('harness_list',{root:a}))[0].unread);
    await close();await check('Restored');assert.equal(requests.length,1);
    console.log('Cloud observer rehearsal OK: one loopback turn, unchanged answer after restart, read transition, no live report.');
  }finally{
    // Even on a failed assertion, release only this generated task in its test profile.
    await close();await launch();
    try{if(id){await c('harness_stop',{id});await until(async()=>!(await c('harness_list',{root:a})).some(r=>r.status==='running'));
      await c('harness_forget',{id});}
      await c('harness_engine_set',{enabled});
    }finally{await close();}
  }
};
