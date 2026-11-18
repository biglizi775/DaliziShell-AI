const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),vm=require('node:vm');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),ui=path.join(root,'ui'),source=fs.readFileSync(path.join(root,'tools/ui_smoke.cjs'),'utf8');
const helpers=vm.runInNewContext(source.slice(source.indexOf('function makeBuiltinSkills()'),source.indexOf('const server ='))+';({makeBuiltinSkills,makePreviewPdf})',{fs,path,__dirname:path.join(root,'tools'),Buffer,assert:require('node:assert/strict')});
const start=source.indexOf('await page.addInitScript(')+'await page.addInitScript('.length;
const end=source.indexOf('}, { pdf: makePreviewPdf()',start)+1;
const init=vm.runInNewContext('('+source.slice(start,end)+')');
exports.createHarness=async function(){
 const server=http.createServer((req,res)=>{const p=path.resolve(ui,'.'+(req.url==='/'?'/index.html':decodeURIComponent(req.url.split('?')[0])));if(!p.startsWith(ui+path.sep)){res.writeHead(403).end();return}fs.readFile(p,(e,d)=>{if(e){res.writeHead(404).end();return}res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.wasm':'application/wasm'})[path.extname(p)]||'application/octet-stream');res.end(d)})});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server']});const page=await browser.newPage({viewport:{width:1600,height:740},deviceScaleFactor:2,locale:'zh-CN'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(init,{pdf:helpers.makePreviewPdf(),startupOnly:false,sshRecovery:false,builtinMode:false,builtinSkills:helpers.makeBuiltinSkills(),copyPaths:false});
 await page.addInitScript(()=>{localStorage.setItem('df.lang',JSON.stringify('zh'));window.__DEMO_ONLY__=true});
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('.row').first().waitFor();await page.evaluate(()=>document.fonts.ready);
 const capture=async(name)=>{await page.mouse.move(1599,739);await page.waitForTimeout(250);await page.screenshot({path:path.join(root,'promo-film/dist/actual-ui',name+'.png'),animations:'disabled'});};
 const close=async()=>{await browser.close();await new Promise(r=>server.close(r));if(errors.length)console.log('Page errors:',errors)};
 return {page,browser,server,capture,close,root,errors};
};
if(require.main===module)(async()=>{const h=await exports.createHarness();await h.capture('files');console.log(await h.page.locator('body').innerText());await h.close()})().catch(e=>{console.error(e);process.exit(1)});

