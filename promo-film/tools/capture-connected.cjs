/* Capture the actual product DOM and styles. Only Tauri fixture data is mocked.
 * No substitute controls, injected layout, CSS changes, or external services.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./authentic-harness.cjs');

(async () => {
  const h = await createHarness();
  const { page, capture, close, root } = h;
  const manifest = { source: 'ui/index.html and original ui CSS/JS, Tauri test fixtures', viewport: {width:1600,height:740}, shots: [] };
  const timing={
    'ssh-workspace':[4,0,'resources'], 'ssh-selected':[4,2.5,'download'], 'ssh-review':[4,4.4,'start'], 'ssh-transfer':[4,6.7,'pause'], 'ssh-complete':[4,9.3],
    'ai-prompt':[5,0,'send'], 'ai-plan':[5,2.4], 'ai-confirm':[5,5.4,'execute'], 'ai-complete':[5,8.4],
    'skills':[6,0,'memories'], 'memory-editor':[6,3,'save'], 'memories':[6,6], 'history':[6,9,'continue']
  };
  const captions={
    'ssh-workspace':'登录后，主机概况、终端与远程目录同时展开。',
    'ssh-selected':'多选远程文件，直接发起下载。',
    'ssh-review':'核对主机、文件清单与目标目录。',
    'ssh-transfer':'在传输任务面板查看进度，暂停或取消。',
    'ssh-complete':'下载完成，任务结果清晰可见。',
    'ai-prompt':'选中文件，向当前目录的 Agent 提出整理需求。',
    'ai-plan':'先给出计划，等待你核对。',
    'ai-confirm':'核对源路径和目标路径，再确认执行。',
    'ai-complete':'操作完成，结果留在同一个对话里。',
    'skills':'选择内置技能，让协作遵循熟悉的方法。',
    'memory-editor':'核对内容，将偏好显式保存到当前目录。',
    'memories':'项目有自己的记忆，也能随目录一起移动。',
    'history':'保存对话文字，在新标签继续之前的思路。'
  };
  fs.mkdirSync(path.join(root,'promo-film/dist/actual-ui'), {recursive:true});
  async function snap(name, description, targets={}) {
    const bounds={};
    for(const [label,selector] of Object.entries(targets)) {
      const element=page.locator(selector).first();
      if(await element.isVisible()) { const b=await element.boundingBox(); if(b&&b.y>=0&&b.y+b.height<=740) bounds[label]=b; }
    }
    await capture(name);
    const [chapter,at,action]=timing[name];
    const target=bounds.dialog || bounds.panel || bounds.resources;
    const shot={file:`${name}.png`,chapter,at,caption:captions[name]||description,description,bounds};
    if(target) shot.focus={x:target.x,y:target.y,w:target.width,h:target.height};
    if(action&&bounds[action]) shot.cursor={x:bounds[action].x+bounds[action].width*.5,y:bounds[action].y+bounds[action].height*.5};
    manifest.shots.push(shot);
    console.log(name);
  }
  try {
    await page.waitForFunction(()=>workspaceSessionReady&&!state.loading);
    await page.evaluate(async()=>{
      closeAiAssistant();
      window.connectedFileTab=curTab();
      window.connectedSshTab=await newSshTab({host:'192.0.2.24',user:'studio',port:22,infoMode:'posix',managed:true,name:'演示服务器'});
      window.mockTransferOwner=connectedSshTab;
    });
    await page.waitForFunction(()=>curTab().sshFiles?.ready&&curTab().sshTerminalState==='ready');
    await page.evaluate(()=>{
      const tab=connectedSshTab;
      emitMockEvent('ssh-managed-stats',{id:tab.termId,key:tab.key,info:{hostname:'studio-server',serverIp:'192.0.2.24',os:'Ubuntu 24.04 LTS',kernel:'6.8.0',arch:'x86_64',user:'studio',uptime:'up 12 days',memoryTotalKiB:'8388608',memoryAvailableKiB:'5662310',diskTotalKiB:'104857600',diskAvailableKiB:'73400320',diskUsedKiB:'31457280',loadAverage:'0.08  0.12  0.09'}});
      emitMockEvent('term-out',{id:tab.termId,key:tab.key,data:'\x1b[32mstudio@studio-server\x1b[0m:~$ ls /data\r\n子目录  中文.txt  two.txt  three.txt\r\n\x1b[32mstudio@studio-server\x1b[0m:~$ pwd\r\n/home/studio\r\n\x1b[32mstudio@studio-server\x1b[0m:~$ '});
    });
    await snap('ssh-workspace','登录后的实际 SSH 布局：概况、终端与 SFTP 同窗；演示主机与数据。',{
      terminal:'.term.ssh-terminal-host:visible .term-terminal-viewport',files:'.term.ssh-terminal-host:visible .ssh-files-list',resources:'.term.ssh-terminal-host:visible .ssh-info-card',splitter:'.term.ssh-terminal-host:visible .ssh-workspace-divider'
    });
    const active=page.locator('.term.ssh-terminal-host:visible');
    await active.locator('.ssh-file-row').filter({hasText:'中文.txt'}).click();
    await active.locator('.ssh-file-row').filter({hasText:'two.txt'}).click({modifiers:['Control']});
    await snap('ssh-selected','真实远程列表的多选状态。',{download:'.term.ssh-terminal-host:visible [data-download]',selection:'.term.ssh-terminal-host:visible .ssh-file-row[aria-selected=true]'});
    await active.locator('[data-download]').click();
    await page.locator('#sshBatchReview[open]').waitFor();
    await snap('ssh-review','下载前核对主机、文件清单与目标目录。',{start:'#sshBatchStart',dialog:'#sshBatchReview'});
    await page.locator('#sshBatchStart').click();
    await page.locator('#sshTaskCenter[open]').waitFor();
    await page.waitForFunction(()=>sshTaskBatches.at(-1)?.items.find(sshItemActive)?.transferId);
    await page.evaluate(()=>{
      const item=sshTaskBatches.at(-1).items.find(sshItemActive);
      const data=mockTransfers[item.transferId];data.bytes=62;emitMockEvent('ssh-transfer',structuredClone(data));
    });
    await snap('ssh-transfer','软件原生 SFTP 传输任务中心；模拟传输进度。',{dialog:'#sshTaskCenter',pause:'[data-task-pause]',cancel:'[data-task-cancel]'});
    for(let i=0;i<2;i++) {
      await page.waitForFunction(()=>sshTaskBatches.at(-1)?.items.find(sshItemActive)?.transferId);
      await page.evaluate(()=>{const item=sshTaskBatches.at(-1).items.find(sshItemActive),data=mockTransfers[item.transferId];data.bytes=data.total;data.status='complete';emitMockEvent('ssh-transfer',structuredClone(data));});
      await page.waitForTimeout(140);
    }
    await page.waitForFunction(()=>sshBatchDone(sshTaskBatches.at(-1)));
    await snap('ssh-complete','真实传输任务中心显示全部下载完成。',{dialog:'#sshTaskCenter'});
    await page.locator('[data-tasks-close]').last().click();
    await page.evaluate(()=>{switchTab(state.tabs.indexOf(connectedFileTab));openAiAssistant();});
    await page.waitForFunction(()=>!state.loading&&!!aiCurrentSession());
    const resize=await page.locator('[data-ai-resize]').boundingBox();
    await page.mouse.move(resize.x+resize.width/2,resize.y+resize.height/2);
    await page.mouse.down();await page.mouse.move(resize.x-180,resize.y+resize.height/2,{steps:12});await page.mouse.up();
    // Configure a dummy model through the application's own settings UI.
    await page.locator('.ai-chat-header [data-ai-action="settings"]').click();
    await page.locator('#aiEndpoint').fill('https://example.invalid/v1');
    await page.locator('#aiModel').fill('demo-model');
    await page.locator('#aiKey').fill('demo-fixture-key');
    await page.locator('[data-ai-action="save-settings"]').click();
    await page.waitForTimeout(2200);
    await page.locator('.row').filter({hasText:'Project-notes-1.md'}).first().click();
    await page.locator('#aiPrompt').fill('新建归档文件夹并移动选中的项目笔记');
    await snap('ai-prompt','真实 Agent 侧栏和当前目录/选中文件上下文。',{send:'[data-ai-action="send"]',prompt:'#aiPrompt',panel:'#aiPanel',folder:'#aiFolderPath'});
    await page.locator('[data-ai-action="send"]').click();
    await page.locator('[data-ai-plan-details]').waitFor();
    await page.locator('.ai-message.assistant').last().evaluate(el=>{el.scrollIntoView({block:'start'});});
    await snap('ai-plan','Agent 根据当前目录给出整理计划，操作默认等待确认。',{panel:'#aiPanel',messages:'#aiMessages'});
    await page.locator('[data-ai-plan-details] summary').click();
    await page.locator('[data-ai-confirm]').check();
    await snap('ai-confirm','核对源路径和目标路径，然后确认执行。',{execute:'[data-ai-action="execute"]',confirm:'[data-ai-confirm]',plan:'[data-ai-plan-details]',panel:'#aiPanel'});
    await page.locator('[data-ai-action="execute"]').click();
    await page.waitForFunction(()=>document.querySelector('#aiMessages').textContent.includes('操作已完成'));
    await snap('ai-complete','同一 Agent 侧栏呈现模拟文件操作的完成反馈。',{panel:'#aiPanel',messages:'#aiMessages'});
    await page.locator('[data-agent-open="skills"]').click();
    await page.locator('[data-agent-skill="builtin.file-organize"]').check();
    await page.waitForFunction(()=>!agentProfileBusy);
    await page.locator('#agentProfileBody').evaluate(el=>{el.scrollTop=320;});
    await snap('skills','软件原生技能管理对话框，内置文件整理技能已启用。',{dialog:'#agentProfileDialog',skill:'[data-agent-skill="builtin.file-organize"]',memories:'[data-agent-tab="memories"]'});
    await page.locator('[data-agent-tab="memories"]').click();
    await page.locator('[data-agent-action="add-memory"]').click();
    await page.locator('#agentMemoryContent').fill('归档目录使用日期命名，保留原始文件名。');
    await snap('memory-editor','显式保存目录记忆的实际窗口，展示 .dalizi/agent-memory.json 路径。',{dialog:'#agentMemoryDialog',save:'#agentMemorySave',file:'#agentMemoryFile'});
    await page.locator('#agentMemorySave').click();
    await page.locator('#agentMemoryDialog').waitFor({state:'detached'});
    await page.locator('.agent-memory-card').first().scrollIntoViewIfNeeded();
    await snap('memories','实际目录记忆列表与统计，偏好已保存在模拟存储中。',{dialog:'#agentProfileDialog',memory:'.agent-memory-card'});
    await page.keyboard.press('Escape');
    await page.evaluate(()=>openAiChatHistory());
    await page.locator('#chatArchiveTitle').fill('项目笔记归档方案');
    await page.locator('#chatSave').click();
    await page.locator('#chatSavedList button').first().waitFor();
    await page.locator('#chatSavedList button').first().click();
    await page.locator('#chatContinue').waitFor();
    await page.locator('#chatContinue').scrollIntoViewIfNeeded();
    await snap('history','真实对话历史窗口：保存对话文字并可在新标签继续。',{dialog:'#chatHistoryDialog',save:'#chatSave',continue:'#chatContinue'});
    fs.writeFileSync(path.join(root,'promo-film/dist/actual-ui/connected-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    if(h.errors.length) throw new Error(h.errors.join('\n'));
    console.log(`Captured ${manifest.shots.length} authentic connected UI frames.`);
  } finally { await close(); }
})().catch(error=>{console.error(error);process.exit(1)});
