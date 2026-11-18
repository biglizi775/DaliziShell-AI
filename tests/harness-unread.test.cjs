const {test}=require('node:test');
const assert=require('node:assert/strict'), vm=require('node:vm'), fs=require('node:fs'), path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../ui/harness-unread.js'),'utf8');

test('a delayed A result cannot paint B, a browser, or a pinned project displayed next to a different folder',async()=>{
  const calls=[], state={path:'C:/A'}, tab={kind:'files'};
  let fixed=null, pill=null;
  const button={querySelector:()=>pill,append:n=>{pill=n;}};
  const ctx={state,curTab:()=>tab,isTermTab:t=>t.kind==='term',isBrowserTab:t=>t.kind==='browser',
    locale:'zh',aiPanelOpen:true,aiBrowsingFolder:()=>fixed||state.path,aiKey:s=>s.toLowerCase(),
    $:()=>button,projectText:s=>s,document:{createElement:()=>({remove(){pill=null;}})},
    invoke:(_cmd,query)=>new Promise(done=>calls.push({query,done}))};
  vm.runInNewContext(source,ctx);
  const sync=()=>vm.runInNewContext('syncHarnessUnread()',ctx);
  sync();state.path='C:/B';sync();assert.deepEqual(calls.map(c=>c.query.root),['C:/A','C:/B']);
  calls[1].done(0);calls[0].done(3);await new Promise(setImmediate);assert.equal(pill,null);
  state.path='C:/A';sync();calls[2].done(1);await new Promise(setImmediate);assert.equal(pill.textContent,'1 条未读');
  fixed=state.path;state.path='C:/B';sync();assert.equal(pill,null);assert.equal(calls.length,3);
  tab.kind='browser';sync();assert.equal(pill,null);assert.equal(calls.length,3);
});
