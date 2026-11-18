// Windows M0 diagnostic: one synthetic prompt, real pinned runtime, no provider credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createServer } = require('node:http');
const { execFile } = require('node:child_process');
const exec = require('node:util').promisify(execFile);

async function main() {
  const [probePath, runtimePrefix] = process.argv.slice(2);
  if (!probePath || !runtimePrefix) throw Error('Usage: node tools/harness_m0.cjs <m0 executable> <npm install prefix>');
  const pkg = path.resolve(runtimePrefix, 'node_modules/@deepseek-ai/dsh');
  const manifest = JSON.parse(await fs.readFile(path.join(pkg, 'package.json'), 'utf8'));
  assert.equal(manifest.version, '0.2.2-rc.3');
  const overlay = path.resolve(__dirname, '../resources/harness/snapshot-only.yml');
  const root = await fs.mkdtemp(path.join(tmpdir(), 'dalizi-m0-'));
  const requests = [];
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || !request.url.endsWith('/messages')) throw Error('unexpected model route');
      let raw = '';
      for await (const part of request) {
        raw += part;
        if (raw.length > 512 * 1024) throw Error('unexpectedly large model request');
      }
      requests.push(JSON.parse(raw));
      const frames = [
        { type:'message_start', message:{id:'mock-1', model:'deepseek-v4-pro', usage:{input_tokens:3, output_tokens:0}} },
        { type:'content_block_start', index:0, content_block:{type:'text', text:'M0_REPLY_A'} },
        { type:'content_block_stop', index:0 },
        { type:'message_delta', delta:{stop_reason:'end_turn'}, usage:{output_tokens:1} },
        { type:'message_stop' },
      ];
      response.writeHead(200, {'content-type':'text/event-stream'});
      response.end(frames.map(f => 'event: '+f.type+'\ndata: '+JSON.stringify(f)+'\n\n').join(''));
    } catch (error) { response.writeHead(400); response.end(error.message); }
  });
  try {
    for (const dir of ['workspace', 'launch', 'agents', 'temp', 'local', 'roaming', 'home'])
      await fs.mkdir(path.join(root, dir));
    await fs.writeFile(path.join(root,'workspace','AGENTS.md'), 'DALIZI_UNSELECTED_INSTRUCTIONS');
    await fs.writeFile(path.join(root,'workspace','other.md'), 'DALIZI_UNSELECTED_FILE');
    await new Promise((resolve, reject) => server.once('error', reject).listen(0,'127.0.0.1',resolve));
    let entry=path.join(pkg,manifest.bin.dsh);
    const inventory=process.argv[4];
    if(inventory){
      const wrapper=path.join(root,'observe.cjs');
      await fs.writeFile(wrapper, 'require('+JSON.stringify(require.resolve('./harness_runtime_trace.cjs'))+')('+[
        path.resolve(runtimePrefix),entry,path.resolve(inventory)].map(x=>JSON.stringify(x)).join(',')+');');
      entry=wrapper;
    }
    const {stdout} = await exec(path.resolve(probePath), [process.execPath, entry, overlay, root, String(server.address().port)], {windowsHide:true, timeout:65000});
    assert.equal(stdout.trim(), 'M0_REPLY_A');
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].tools ?? [], []);
    const body = JSON.stringify(requests[0]);
    assert.match(body,/DALIZI_SELECTED_A/);
    assert.doesNotMatch(body,/DALIZI_UNSELECTED_/);
    assert.equal(await fs.readFile(path.join(root,'workspace','other.md'),'utf8'), 'DALIZI_UNSELECTED_FILE');
    console.log('M0 OK: pinned dsh, loopback model, one request, zero tools, isolated snapshot, committed reply, clean exit.');
  } finally {
    if (server.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (path.dirname(root) !== tmpdir() || !path.basename(root).startsWith('dalizi-m0-')) throw Error('invalid temporary path');
    await fs.rm(root, {recursive:true, force:true, maxRetries:3});
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
