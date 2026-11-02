const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
module.exports=async({page,invoke,output,remoteRoot})=>{
  let id=await page.evaluate(()=>curTab().termId);
  const wait=async(token,check= p=>['complete','failed','cancelled'].includes(p?.status))=>{
    for(let n=0;n<1200;n++){const p=await invoke('ssh_transfer_status',{id,transferId:token});if(check(p))return p;await new Promise(r=>setTimeout(r,50));}throw new Error('Native transfer timeout');
  };
  const run=async(files,direction)=>{for(const f of files){const token=await invoke('ssh_file_transfer',{id,direction,localPath:f.localPath,remote:f.remote,entryKind:f.entryKind,requestId:randomUUID()});const result=await wait(token);assert.equal(result.status,'complete',JSON.stringify(result));}};
  const tree=path.join(output,'tree-source');fs.mkdirSync(tree);fs.mkdirSync(path.join(tree,'empty'));fs.mkdirSync(path.join(tree,'深层'));fs.writeFileSync(path.join(tree,'深层','中文.txt'),'recursive fixture 🌳');
  const upload=await invoke('ssh_transfer_prepare',{id,direction:'upload',paths:[tree],remote:'/',directory:null,recursive:true});
  assert.equal(upload.length,4);await run(upload,'upload');assert.ok(fs.statSync(path.join(remoteRoot,'tree-source','empty')).isDirectory());
  const dest=path.join(output,'tree-download');fs.mkdirSync(dest);
  const download=await invoke('ssh_transfer_prepare',{id,direction:'download',paths:['tree-source'],remote:'/',directory:dest,recursive:true});await run(download,'download');
  assert.deepEqual(fs.readFileSync(path.join(dest,'tree-source','深层','中文.txt')),fs.readFileSync(path.join(tree,'深层','中文.txt')));assert.ok(fs.statSync(path.join(dest,'tree-source','empty')).isDirectory());
  // An interrupted upload must preserve data, then resume only on the verified reconnect.
  const large=path.join(output,'resumable-upload.bin');fs.writeFileSync(large,Buffer.alloc(16*1024*1024,0x5a));
  const token=await invoke('ssh_file_transfer',{id,direction:'upload',localPath:large,remote:'/',requestId:randomUUID(),resumable:true});
  await wait(token,p=>p?.bytes>0 && p.status==='running');await page.evaluate(()=>disconnectSshTab(curTab()));
  const stopped=await wait(token,p=>!!p?.resumeId);assert.ok(stopped.resumeId);
  await page.evaluate(()=>reconnectSshTab(curTab()));await page.waitForFunction(()=>curTab().sshAuthenticated&&!curTab().exited);id=await page.evaluate(()=>curTab().termId);
  const resumed=await invoke('ssh_file_transfer',{id,direction:'upload',localPath:large,remote:'/',requestId:randomUUID(),resumeId:stopped.resumeId});const finish=await wait(resumed);
  assert.equal(finish.status,'complete',JSON.stringify(finish));assert.ok(finish.resumedBytes>0,'upload resumed after verified prefix');assert.deepEqual(fs.readFileSync(path.join(remoteRoot,path.basename(large))),fs.readFileSync(large));
  // A damaged local partial must never be appended or published as a successful download.
  const bad=path.join(output,'tampered-download.bin');const badToken=await invoke('ssh_file_transfer',{id,direction:'download',localPath:bad,remote:'/slow.bin',requestId:randomUUID(),resumable:true});
  await wait(badToken,p=>p?.bytes>0 && p.status==='running');await page.evaluate(()=>disconnectSshTab(curTab()));const checkpoint=await wait(badToken,p=>!!p?.resumeId);
  const partial=path.join(output,`.dalizi-${badToken}.part`);const fd=fs.openSync(partial,'r+');fs.writeSync(fd,Buffer.from('bad'),0,3,0);fs.closeSync(fd);
  await page.evaluate(()=>reconnectSshTab(curTab()));await page.waitForFunction(()=>curTab().sshAuthenticated&&!curTab().exited);id=await page.evaluate(()=>curTab().termId);
  const badResume=await invoke('ssh_file_transfer',{id,direction:'download',localPath:bad,remote:'/slow.bin',requestId:randomUUID(),resumeId:checkpoint.resumeId});const failure=await wait(badResume);
  assert.equal(failure.status,'failed');assert.match(failure.error,/mismatch|不一致/);assert.equal(fs.existsSync(bad),false);
  await invoke('ssh_resume_discard',{id,resumeId:failure.resumeId});assert.equal(fs.existsSync(partial),false);
  console.log('Native recursive upload/download, empty folders, verified upload resume and corrupt partial rejection passed.');
};
