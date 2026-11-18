// A real test-only desktop drives WebView2's native context menu. Both web pages and the
// Messages endpoint are served by this isolated loopback server; no clipboard or cloud key.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
async function main(){
  const root=path.resolve(__dirname,'..'), requests=[],errors=[];
  const nonce=require('node:crypto').randomUUID(),profile='com.dalizi.web-quote-test-'+nonce;
  const profileParents=await Promise.all([process.env.LOCALAPPDATA,process.env.APPDATA].map(p=>fs.promises.realpath(p)));
  for(const parent of profileParents)assert.ok(!fs.existsSync(path.join(parent,profile)),'fixture must own a new profile');
  const server=http.createServer(async(req,res)=>{
    try{
      const pathname=new URL(req.url,'http://127.0.0.1').pathname;
      if(req.method==='GET' && ['/x','/y'].includes(pathname)){
        res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
        res.end('<title>page-'+pathname.slice(1)+'</title><p><span id="quote">'+(pathname==='/x'?'SELECTED_FROM_X':'WRONG_PAGE_Y')+'</span></p><p>UNSELECTED_WEB_TEXT</p><input value="PRIVATE_FORM_VALUE">');return;
      }
      if(req.method!=='POST'||pathname!=='/v1/messages'){res.writeHead(404).end();return;}
      let body='';for await(const chunk of req){body+=chunk;assert.ok(body.length<500000);}
      requests.push(JSON.parse(body));
      const frames=[{type:'message_start',message:{id:'x',model:'deepseek-v4-pro',usage:{input_tokens:3,output_tokens:0}}},
        {type:'content_block_start',index:0,content_block:{type:'text',text:'ANSWER_FOR_X'}},{type:'content_block_stop',index:0},
        {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:1}},{type:'message_stop'}];
      res.writeHead(200,{'content-type':'text/event-stream'}).end(frames.map(f=>'event: '+f.type+'\ndata: '+JSON.stringify(f)+'\n\n').join(''));
    }catch(e){errors.push(String(e));res.writeHead(500).end();}
  });
  await new Promise((ok,no)=>server.once('error',no).listen(0,'127.0.0.1',ok));
  try{
    const cargo=process.env.USERPROFILE && path.join(process.env.USERPROFILE,'.cargo','bin','cargo.exe');
    const origin='http://127.0.0.1:'+server.address().port;
    const args=[...(process.argv[2]&&process.argv[2]!=='default'?['+'+process.argv[2]]:[]),'test','--locked','--manifest-path','src-tauri/Cargo.toml',
      '--target-dir',process.argv[3]||'src-tauri/target/harness-web','--bin','dalizi-files','harness_web_tests::native_web_quote','--','--exact','--ignored','--nocapture','--test-threads=1'];
    const env={...process.env,DALIZI_QUOTE_FIXTURE_ORIGIN:origin,DALIZI_QUOTE_FIXTURE_ID:nonce};delete env.WEBVIEW2_USER_DATA_FOLDER;delete env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS;
    const child=spawn(cargo&&fs.existsSync(cargo)?cargo:'cargo',args,{env,cwd:root,windowsHide:true,stdio:'inherit'});
    const code=await new Promise((ok,no)=>child.once('error',no).once('exit',ok));assert.equal(code,0,'native WebView2 test');
    assert.deepEqual(errors,[]);assert.equal(requests.length,1);
    assert.deepEqual(requests[0].tools??[],[]);
    const sent=JSON.stringify(requests[0]);assert.match(sent,/SELECTED_FROM_X/);assert.ok(sent.includes(origin+'/x'));
    assert.doesNotMatch(sent,/QUERY_SECRET|FRAGMENT_SECRET|WRONG_PAGE_Y|UNSELECTED_WEB_TEXT|PRIVATE_FORM_VALUE|PRIVATE_LOCAL_FILE/);
    console.log('M3 native OK: selected noneditable text, redacted URL, navigation and close, explicit project, protected IPC, one isolated model request.');
  }finally{
    server.closeAllConnections();await new Promise(ok=>server.close(ok));
    for(const parent of profileParents){
      const p=path.join(parent,profile);if(!fs.existsSync(p))continue;
      const actual=await fs.promises.realpath(p);
      assert.equal(path.dirname(actual).toLowerCase(),parent.toLowerCase());assert.equal(path.basename(actual),profile);
      assert.ok(!(await fs.promises.lstat(p)).isSymbolicLink());
      await fs.promises.rm(actual,{recursive:true,force:true,maxRetries:12,retryDelay:200});
    }
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
