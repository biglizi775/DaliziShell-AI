// Run the clean-guest helper through an actual dsh turn while the fixture's installation is read-only.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises');
const {spawn,execFile}=require('node:child_process'),{once}=require('node:events');
const run=require('node:util').promisify(execFile);
module.exports=async({exe,profile,file,c,opts,submit,rows,until})=>{
  const dir=path.dirname(exe),id=profile.slice('com.dalizi.harness-release-test-'.length);
  const owned=path.resolve(__dirname,'../src-tauri/target/m5-acceptance',id,'工 台');
  assert.match(id,/^[a-f0-9-]{36}$/);assert.equal(await fs.realpath(dir),await fs.realpath(owned));
  assert.equal(path.basename(exe),'harness-release-fixture.exe');
  const env={...process.env,DALIZI_FIXTURE_DIR:dir};
  const ps=async code=>(await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    "$ErrorActionPreference='Stop'; $d=$env:DALIZI_FIXTURE_DIR; "+code],{env,windowsHide:true})).stdout.trim();
  const original=await ps('(Get-Acl -LiteralPath $d).GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::Access)');
  env.DALIZI_FIXTURE_ACL=original;
  let server;
  try {
    await ps("$acl=Get-Acl -LiteralPath $d; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,'Write,Delete,DeleteSubdirectoriesAndFiles','ContainerInherit,ObjectInherit','None','Deny'); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $d -AclObject $acl");
    await assert.rejects(fs.writeFile(path.join(dir,'readonly-probe.txt'),'probe',{flag:'wx'}),e=>['EPERM','EACCES'].includes(e.code));
    await fs.writeFile(file,'DALIZI_M5_SELECTED');await fs.writeFile(path.join(opts.root,'other.md'),'DALIZI_M5_OTHER');
    server=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(__dirname,'windows_acceptance_model.ps1')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    const finished=once(server,'exit');let stdout='';server.stdout.on('data',b=>{stdout+=b});server.stderr.resume();
    const endpoint=await until(()=>{if(server.exitCode!==null)throw Error('clean guest fixture exited before listening');return stdout.match(/Endpoint: (http:\/\/127\.0\.0\.1:\d+\/v1)/)?.[1]});
    await c('harness_engine_set',{enabled:true});
    const ask=async()=>{const d=await c('harness_prepare',{...opts,endpoint});await submit(d.id);return d.id;};
    const ok=await ask();await until(async()=>(await rows()).find(t=>t.id===ok)?.result==='DALIZI_M5_ANSWER');
    assert.equal((await finished)[0],0);assert.match(stdout,/no other marker, no tools/);
    const failed=await ask(),start=Date.now();
    // Allow an OS connection delay and the host's hard deadline. The R2 profile never retries.
    for(;;){
      const row=(await rows()).find(t=>t.id===failed);
      if(row?.status==='failed'){assert.match(row.result,/文件任务未完成/);assert.ok(!row.result.includes('DALIZI_M5_ANSWER'));break;}
      if(row?.status!=='running'||Date.now()-start>205000)throw Error('Unavailable loopback model did not fail as expected: '+row?.status);
      await new Promise(r=>setTimeout(r,350));
    }
    return {readOnlyInstall:true,guestModelAnswered:true,closedEndpointFailedMs:Date.now()-start};
  } finally {
    if(server&&server.exitCode===null)server.kill();
    await ps('$acl=Get-Acl -LiteralPath $d; $acl.SetSecurityDescriptorSddlForm($env:DALIZI_FIXTURE_ACL,[System.Security.AccessControl.AccessControlSections]::Access); Set-Acl -LiteralPath $d -AclObject $acl');
    // Windows marks a re-applied DACL as auto-inherited (AI). Preserve and compare
    // all access entries in order and the other flags, including protection (P).
    const semantic=s=>s.replace(/^D:([A-Z]*)(?=\()/,(_,flags)=>'D:'+flags.replace('AI',''));
    const restored=await ps('(Get-Acl -LiteralPath $d).GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::Access)');
    assert.equal(semantic(restored),semantic(original));
    const probe=path.join(dir,'restored-write-probe.txt');
    await fs.writeFile(probe,'restored',{flag:'wx'});await fs.unlink(probe);
  }
};
