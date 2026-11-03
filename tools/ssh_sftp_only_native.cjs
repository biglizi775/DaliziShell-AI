// Real protocol behavior: denied PTY/shell, delayed shell and flow control before ACK.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({page, invoke, config, fixture, nextMessage, waitTransfer, output, remoteRoot}) => {
  for (const policy of ['deny-pty','deny-shell','window-adjust','slow-shell']) {
    fixture.stdin.write(`terminal-policy ${policy}\n`); assert.equal((await nextMessage()).terminalPolicy, policy);
    await page.evaluate(async ({config,policy})=>newSshTab({...config,managed:true,label:policy},{useSaved:true}),{config,policy});
    await page.waitForFunction(()=>curTab().sshFiles?.ready);
    await page.waitForFunction(()=>['ready','unavailable'].includes(curTab().sshTerminalState));
    const id=await page.evaluate(()=>curTab().termId), active=page.locator('.term.ssh-terminal-host:visible');
    assert.equal(await page.evaluate(()=>sshStatus(curTab())), 'connected');
    assert.equal(await active.locator('.ssh-files').isVisible(),true);
    const supportsTerminal = ['window-adjust','slow-shell'].includes(policy);
    assert.equal(await active.locator('.term-terminal-viewport').isVisible(),supportsTerminal);
    assert.equal(await active.locator('[data-upload]').isEnabled(),true);
    if(supportsTerminal) {
      assert.equal(await page.evaluate(()=>curTab().sshTerminalState),'ready',`${policy} must not prevent terminal startup`);
      await invoke('term_write',{id,data:'exit\r'});
      await page.waitForFunction(()=>curTab().sshTerminalState==='closed');
      assert.equal(await page.evaluate(()=>curTab().exited),false,'shell exit does not close SSH/SFTP');
    } else {
      assert.equal(await page.evaluate(()=>curTab().sshTerminalState),'unavailable');
      assert.equal(await active.locator('[data-terminal-note]').isVisible(),true);
      await assert.rejects(invoke('term_write',{id,data:'test'}),/Terminal not available/);
    }
    const local=path.join(output,`${policy}-upload.txt`), download=path.join(output,`${policy}-download.txt`);
    const contents=Buffer.from(`SFTP works without a shell: ${policy}\n中文\n`); fs.writeFileSync(local,contents);
    const upload=await invoke('ssh_file_transfer',{id,direction:'upload',localPath:local,remote:'/'});
    assert.equal((await waitTransfer(upload)).status,'complete');
    assert.deepEqual(fs.readFileSync(path.join(remoteRoot,path.basename(local))),contents);
    const token=await invoke('ssh_file_transfer',{id,direction:'download',localPath:download,remote:'/'+path.basename(local)});
    assert.equal((await waitTransfer(token)).status,'complete'); assert.deepEqual(fs.readFileSync(download),contents);
    assert.ok((await invoke('ssh_files_list',{id,path:'/'})).entries.length>0);
    await page.screenshot({path:path.join(output,`sftp-${policy}.png`),animations:'disabled'});
    await page.evaluate(()=>disconnectSshTab(curTab()));
    await page.waitForFunction(id=>fixtureEvents.some(e=>e.name==='term-closed'&&e.id===id),id);
    await assert.rejects(invoke('ssh_files_list',{id,path:'/'}),/closed|会话/);
  }
  fixture.stdin.write('terminal-policy normal\n'); await nextMessage();
  console.log('SFTP isolation: PTY/shell refusal, delayed shell, flow-control ACK, shell exit, automatic directories, real upload/download and disconnect cleanup passed.');
};
