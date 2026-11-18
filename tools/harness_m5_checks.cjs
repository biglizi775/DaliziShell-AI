// Acceptance of the actual release build. All task files, model replies and application
// profiles are fixtures; only the test driver uses a system toolchain or external Node.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const exec=require('node:util').promisify(require('node:child_process').execFile);
const {once}=require('node:events');
module.exports=async({getPage,getApp,exe,image,a,addr,requests,responses,until,launch,close,startupMs})=>{
  const base=path.dirname(exe),profile=process.env.DALIZI_TEST_PROFILE;
  assert.match(profile||'',/^com\.dalizi\.harness-release-test-[a-f0-9-]{36}$/);
  const c=(name,args={})=>getPage().evaluate(([n,o])=>invoke(n,o),[name,args]);
  const opts={root:a,sourceRoot:a,files:['notes.md'],endpoint:addr,apiFormat:'anthropic-messages',model:'deepseek-v4-pro'};
  const file=path.join(a,'notes.md');await fs.writeFile(file,'PRIVATE_M5_SELECTED');
  const status=()=>c('harness_engine_status'),draft=()=>c('harness_prepare',opts),submit=id=>c('harness_submit',{id,question:'PRIVATE_M5_QUESTION',apiKey:'LOCAL_M5_KEY'});
  const rows=()=>c('harness_list',{root:a});
  let s=await status();assert.equal(s.enabled,false);assert.equal(s.source,'unavailable');
  await getPage().evaluate(a=>navigate(a),a);
  assert.ok(await getPage().evaluate(()=>state.entries.some(e=>e.name==='notes.md')));
  await assert.rejects(draft(),/未启用/);
  await assert.rejects(c('harness_engine_set',{enabled:true}),/未找到/);
  const components=path.join(base,'components');await fs.mkdir(components);
  const out=path.join(components,s.component+'.zip');await fs.copyFile(image,out);
  async function damage(){
    // Corrupt only archived fixture content, keeping its signed-by-digest inventory intact.
    const script="import struct,sys,zipfile\np=sys.argv[1]\nwith zipfile.ZipFile(p) as z: off=z.getinfo('node.exe').header_offset\nwith open(p,'r+b') as f:\n f.seek(off+26);n,e=struct.unpack('<HH',f.read(4));pos=off+30+n+e+180;f.seek(pos);v=f.read(1);f.seek(pos);f.write(bytes([v[0]^1]))";
    await exec('python',['-c',script,out],{windowsHide:true});
  }
  await damage();await assert.rejects(c('harness_engine_set',{enabled:true}),/校验/);
  assert.equal((await status()).enabled,false);await fs.copyFile(image,out);
  const page=getPage();await page.evaluate(()=>{setLocale('zh');openWorkspaceSettings();});
  await page.click('#workspaceSettings [data-settings-tool=engine]');
  await page.click('#harnessEngineDialog [data-toggle]');
  await page.waitForFunction(()=>document.querySelector('#harnessEngineDialog [data-state]')?.textContent.includes('已启用'));
  await page.click('#harnessEngineDialog [data-close]');
  const stale=[await draft(),await draft()];await c('harness_engine_set',{enabled:false});await c('harness_engine_set',{enabled:true});
  for(const d of stale)await assert.rejects(submit(d.id),/失效/);
  const bad=await draft();await damage();await submit(bad.id);
  await until(async()=>(await rows()).find(r=>r.id===bad.id)?.status==='failed');assert.equal(requests.length,0);
  await fs.copyFile(image,out);
  const active=await draft();const start=Date.now();await submit(active.id);await until(()=>requests.length===1);const firstRequestMs=Date.now()-start;
  assert.deepEqual(requests[0].tools??[],[]);assert.match(JSON.stringify(requests[0]),/PRIVATE_M5_SELECTED/);
  const measured=await childUsage(getApp().pid);
  await c('harness_engine_set',{enabled:false});await assert.rejects(draft(),/未启用/);
  const frames=[{type:'message_start',message:{id:'m5',model:'deepseek-v4-pro',usage:{input_tokens:1,output_tokens:0}}},{type:'content_block_start',index:0,content_block:{type:'text',text:'PRIVATE_M5_REPLY'}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:1}},{type:'message_stop'}];
  const fixtureHoldMs=Date.now()-start-firstRequestMs;
  responses[0].writeHead(200,{'content-type':'text/event-stream'}).end(frames.map(v=>'event: '+v.type+'\ndata: '+JSON.stringify(v)+'\n\n').join(''));
  await until(async()=>(await rows()).find(r=>r.id===active.id)?.result==='PRIVATE_M5_REPLY');
  const firstReplyMs=Date.now()-start;await until(()=>!alive(measured.nodePid));
  const diag=await c('harness_diag_preview');const report=JSON.parse(diag.text);
  assert.ok(report.events.some(e=>e.stage==='prepare-runtime'&&e.outcome==='failed'));
  assert.ok(report.events.some(e=>e.stage==='task'&&e.outcome==='answered'));
  for(const secret of ['PRIVATE_M5','LOCAL_M5',a,addr,'notes.md'])assert.ok(!diag.text.includes(secret));
  await assert.rejects(c('harness_diag_save',{id:'unrelated-preview'}),/过期/);
  await close();await launch();assert.equal((await status()).enabled,false);
  assert.equal((await rows()).find(r=>r.id===active.id).result,'PRIVATE_M5_REPLY');
  await c('harness_engine_set',{enabled:true});const pending=await draft();
  await submit(pending.id);await until(()=>requests.length===2);const running=await childUsage(getApp().pid);
  const app=getApp();const done=once(app,'exit');
  await ps('if(!(Get-Process -Id '+app.pid+').CloseMainWindow()){exit 1}');
  await until(()=>app.exitCode!==null);const [exitCode]=await done;assert.equal(exitCode,0);
  await until(()=>!alive(running.nodePid));await until(()=>responses[1].destroyed);
  await close();await launch();const interrupted=(await rows()).find(r=>r.id===pending.id);
  assert.equal(interrupted.status,'interrupted');assert.equal(requests.length,2);await c('harness_engine_set',{enabled:false});
  const environment=await require('./harness_m5_environment.cjs')({exe,profile,file,c,opts,submit,rows,until});
  const providerFailures=await require('./harness_provider_failures.cjs')({c,opts,submit,rows,until,getPage,close,launch});
  assert.equal(requests.length,2);await c('harness_engine_set',{enabled:false});
  const remaining=await rows(),expected=await c('harness_plan_cleanup',{root:a});
  assert.ok(expected.records>0);assert.equal(expected.records,remaining.length);assert.equal(expected.retained,0);
  await c('harness_clear_workspace',{root:a,expected});assert.deepEqual(await rows(),[]);
  await close();await launch();assert.deepEqual(await rows(),[]);
  const metrics={component:s.component,packedBytes:(await fs.stat(out)).size,startupMs,firstRequestMs,firstReplyWallMs:firstReplyMs,fixtureHoldMs,hostPeakBytes:measured.hostPeakBytes,nodePeakBytes:measured.nodePeakBytes,nodeAliveAfterExit:0,environment,providerFailures,workspaceCleanup:{records:expected.records,emptyAfterRestart:true},events:report.events};
  await fs.writeFile(path.join(base,'acceptance.json'),JSON.stringify(metrics,null,2)+'\n',{flag:'wx'});
  console.log('M5 release OK: no developer runtime, default off, missing and damaged sidecars, opt-in, isolated loopback answer, read-only diagnostics, persisted disable, normal exit reaps Node; '+JSON.stringify(metrics));
};
function alive(pid){try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}}
function ps(cmd){return exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',cmd],{windowsHide:true,timeout:12000});}
async function childUsage(pid){
  assert.ok(Number.isSafeInteger(pid)&&pid>0);
  const {stdout}=await ps("$n=@(Get-CimInstance Win32_Process -Filter \"ParentProcessId="+pid+" AND Name='node.exe'\"); if($n.Count -ne 1){exit 1}; @{nodePid=$n[0].ProcessId;nodePeakBytes=(Get-Process -Id $n[0].ProcessId).PeakWorkingSet64;hostPeakBytes=(Get-Process -Id "+pid+").PeakWorkingSet64}|ConvertTo-Json -Compress");
  return JSON.parse(stdout.trim());
}
