// Real HTTP faults for the packaged runtime. The fixture never forwards a request.
const assert=require('node:assert/strict'), http=require('node:http');
const fs=require('node:fs/promises'), path=require('node:path');
module.exports=async function providerFailures({c,opts,submit,rows,until,getPage,close,launch}) {
  const results=[], ids=[];
  const b=path.join(path.dirname(opts.root),'B');
  await fs.writeFile(path.join(opts.root,'notes.md'),'FAULT_SELECTED');
  const token='PRIVATE_PROVIDER_BODY';
  let current, issue;
  const server=http.createServer(async(req,res)=>{
    try{
      assert.ok(current);assert.equal(req.method,'POST');assert.equal(req.url,'/v1/messages');
      let raw='';for await(const piece of req){raw+=piece;assert.ok(raw.length<=512*1024);}
      assert.match(raw,/FAULT_SELECTED/);assert.deepEqual(JSON.parse(raw).tools??[],[]);
      const record=current;record.requests++;
      await record.release;
      if(record.status==='disconnect'){res.destroy();return;}
      res.writeHead(record.status,{'content-type':'application/json'}).end(JSON.stringify({
        type:'error',error:{type:'api_error',message:token+' LOCAL_M5_KEY FAULT_SELECTED'}}));
    }catch(e){issue=e;res.destroy();}
  });
  await new Promise((ok,no)=>server.once('error',no).listen(0,'127.0.0.1',ok));
  const endpoint='http://127.0.0.1:'+server.address().port+'/v1';
  try {
    await c('harness_engine_set',{enabled:true});
    for(const [status,code,word] of [[401,'auth','密钥'],[402,'quota','余额'],[429,'rate-limit','限流'],[503,'service','暂时不可用'],['disconnect','connection','连接']]){
      await getPage().evaluate(a=>navigate(a),opts.root);
      assert.equal(await getPage().evaluate(()=>state.path),opts.root);
      let release;current={status,requests:0,release:new Promise(r=>{release=r})};
      const d=await c('harness_prepare',{...opts,endpoint});ids.push(d.id);
      await submit(d.id);
      try {
        await until(()=>{if(issue)throw issue;return current.requests===1;});
        await getPage().evaluate(b=>navigate(b),b);
        assert.deepEqual(await c('harness_list',{root:b}),[]);
      }finally{release();}
      const row=await until(async()=>{if(issue)throw issue;return (await rows()).find(r=>r.id===d.id&&r.status==='failed');});
      assert.ok(row.result.includes(word),code+': '+row.result);
      assert.equal(current.requests,1,'runtime repeated a submitted snapshot');
      const diag=JSON.parse((await c('harness_diag_preview')).text);
      assert.ok(diag.events.some(e=>e.stage==='model'&&e.outcome===code),code);
      for(const marker of [token,'LOCAL_M5_KEY','FAULT_SELECTED',endpoint]) {
        assert.ok(!row.result.includes(marker));assert.ok(!JSON.stringify(diag).includes(marker));
      }
      results.push({http:status,category:code,requests:current.requests});
    }
    await c('harness_engine_set',{enabled:false});await close();await launch();
    const restored=await rows();assert.ok(ids.every(id=>restored.some(r=>r.id===id&&r.status==='failed')));
    assert.deepEqual(await c('harness_list',{root:b}),[]);
    return results;
  } finally {server.closeAllConnections();await new Promise(ok=>server.close(ok));}
};
