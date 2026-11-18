// Build-time fixture only. Record package directories, never file contents or task data.
const fs=require('node:fs'),path=require('node:path'),mod=require('node:module');
const {pathToFileURL,fileURLToPath}=require('node:url');
module.exports=function observe(prefix,entry,out){
  const seen=new Map();
  function record(v){
    if(v instanceof URL)v=fileURLToPath(v);if(typeof v!=='string')return;
    if(v.startsWith('file:'))v=fileURLToPath(v);
    if(!path.isAbsolute(v))return;
    const rel=path.relative(prefix,v).split(path.sep).join('/');
    if(!rel.startsWith('node_modules/'))return;
    const match=rel.match(/^(.*\bnode_modules\/(?:@[^/]+\/)?[^/]+)(?:\/|$)/);
    if(match){const pkg=match[1],name=rel.slice(pkg.length+1);if(name){if(!seen.has(pkg))seen.set(pkg,new Set());seen.get(pkg).add(name);}}
  }
  mod.registerHooks({load(url,ctx,next){const r=next(url,ctx);if(url.startsWith('file:'))record(url);return r;}});
  for(const api of [fs,fs.promises]){
    for(const key of ['readFile','readFileSync'])if(typeof api[key]==='function'){
      const orig=api[key];api[key]=function(v,...args){record(v);return orig.call(this,v,...args);};
    }
  }
  const load=process.dlopen;process.dlopen=function(module,name,...args){record(name);return load.call(this,module,name,...args);};
  mod.syncBuiltinESMExports();
  process.on('exit',()=>fs.writeFileSync(out,JSON.stringify(Object.fromEntries([...seen.keys()].sort().map(k=>[k,[...seen.get(k)].sort()])),null,2)+'\n',{flag:'wx'}));
  process.argv[1]=entry;import(pathToFileURL(entry).href).then(cli=>cli.runCli()).catch(e=>{console.error(e.message);process.exitCode=1;});
};
