'use strict';

// This drawer has its own task history. A completed task is never appended to the active chat.
function initHarnessTasks() {
  const t = projectText;
  const trigger = document.createElement('button');
  trigger.type = 'button'; trigger.className = 'ai-secondary'; trigger.id = 'harnessTasksButton';
  trigger.textContent = t('文件任务','File tasks'); trigger.setAttribute('aria-haspopup','dialog');
  $('aiProjectsButton').after(trigger);
  trigger.onclick = () => openHarnessTasks();
  initHarnessUnread();
}

function harnessSelection() {
  const session = aiCurrentSession(), tab = curTab();
  if (!session || !aiTabIsActive(session) || !state.path || aiKey(state.path) !== aiKey(session.root)
      || !tab || tab.kind === 'browser' || isTermTab(tab) || state.loading) return null;
  const files = [...state.selection];
  if (!files.length || files.length > 3 || files.some(name => !/\.(txt|md)$/i.test(name))) return null;
  const entries = new Map((state.entries || []).map(e => [e.name,e]));
  if (files.some(name => !entries.has(name) || entries.get(name).isDir || entries.get(name).isReparse)) return null;
  return { root:session.root, sourceRoot:state.path, files };
}

function harnessRemoteSelection(tb) {
  const view=tb?.sshFiles, binding=view?.taskBinding;
  if(!tb || curTab()!==tb || tb.disposed || tb.exited || tb.sshDisconnectRequested || !tb.sshAuthenticated ||
      !view?.ready || view.busy || !binding || !tb.sshConfig?.managed)return null;
  const entries=[...view.selection].map(i=>view.entries[i]);
  if(!entries.length || entries.length>3 || entries.some(e=>!e||e.isDir||e.isLink||!/\.(txt|md)$/i.test(e.name)))return null;
  return {sessionId:tb.termId,token:binding.token,files:entries.map(e=>e.name)};
}
function discardHarnessPreview(draft) {
  return draft ? invoke('harness_discard_preview',{id:draft.id}) : Promise.resolve();
}
function openHarnessTasks(remoteTab=null, focusId=null) {
  if ($('harnessTasksDialog')) return;
  const t = projectText;
  const dialog = document.createElement('dialog');
  dialog.id='harnessTasksDialog'; dialog.className='document-review harness-tasks';
  dialog.setAttribute('aria-labelledby','harnessTitle');
  dialog.innerHTML = `<header><h2 id="harnessTitle">${t('文件任务','File tasks')}</h2><button class="ai-secondary" data-close>${t('关闭','Close')}</button></header>
    <div class="harness-scroll"><section><strong data-target></strong><p data-instruction></p>
    <label>${t('任务类型','Task type')} <select data-kind><option value="question">${t('只读问答','Ask a question')}</option>
    <option value="edit">${t('提出修改，审阅后写入','Propose an edit for review')}</option></select></label><small data-edit-hint></small>
    <button class="ai-secondary" data-prepare>${t('预览所选文件','Preview selected files')}</button>
    <form data-preview hidden><p data-route></p><div data-files></div><label>${t('关于这些文件，你想了解什么？','What would you like to know about these files?')}<textarea name="question" required maxlength="4000" rows="3"></textarea></label>
    <button class="ai-primary" type="submit">${t('将以上快照发送给模型','Send these snapshots to the model')}</button></form></section>
    <section><h3>${t('任务记录','Task history')}</h3><label><input type="checkbox" data-all> ${t('查看所有目录','Show all directories')}</label>
    <button type="button" class="ai-secondary" data-cleanup hidden>${t('清理此目录的任务记录…','Clear this folder’s task history…')}</button>
    <p data-history-message aria-live="polite" hidden></p>
    <button type="button" class="ai-secondary" data-history-retry hidden>${t('重新读取任务记录','Retry loading history')}</button>
    <div data-history></div></section></div><footer><span role="status" aria-live="polite"></span></footer>`;
  document.body.append(dialog);
  const el = selector => dialog.querySelector(selector);
  const status = message => { el('[role=status]').textContent=message; };
  const remote=remoteTab?.sshFiles?.taskBinding;
  if(remoteTab && (!remote || remoteTab!==curTab())){dialog.remove();return;}
  const boundRoot = remote?null:aiBrowsingFolder();
  const currentSelection=()=>remote?harnessRemoteSelection(remoteTab):harnessSelection();
  const selection = currentSelection();
  const form=el('form'), prepare=el('[data-prepare]'), submit=form.querySelector('button');
  const kind=el('[data-kind]');
  kind.options[1].disabled=!!remote || selection?.files.length!==1 || !harnessCanReview(boundRoot);
  if(kind.options[1].disabled) el('[data-edit-hint]').textContent=t('修改提案须选一个文件，并使用「确认后执行」。','Select one file and use Ask before changes to propose an edit.');
  el('[data-target]').textContent=boundRoot || t('未选择本地目录','No local directory selected');
  if(!remote && selection && companionFor()?.open)
    el('[data-target]').textContent=t('取自左侧工作面板：','From the left working pane: ')+selection.sourceRoot;
  el('[data-instruction]').textContent = selection ? t('仅发送下列文件的预览和本次问题，不附带聊天或目录记忆。','Only the reviewed files and this question will be sent.')+' '+selection.files.join('、') : t('请在任务目录的文件列表选中 1–3 个 TXT 或 Markdown 文件后重新打开。','Select 1–3 TXT or Markdown files in the target folder, then reopen File tasks.');
  prepare.disabled=!selection;
  if(isBrowserTab(curTab())) el('[data-instruction]').textContent=t('请选中网页正文，右键选择「引用到项目」，再选择保存问答的本地目录。若没有菜单，请检查浏览器设置中的右键菜单选项。','Select text on the page, right-click Quote to project, then choose a local folder. If no menu appears, check the browser context menu setting.');
  if(remote){
    kind.parentElement.hidden=true;el('[data-edit-hint]').textContent='';
    el('[data-target]').textContent=remote.workspace.path+' · '+t('连接模式：','Connection mode: ')+remote.system+' · '+remote.fingerprint;
    el('[data-instruction]').textContent=selection?t('将发送本次选区的文件名、正文、远程目录、采集时间和问题。','The file names and contents, remote directory, capture time and question will be sent.')+' '+selection.files.join('、'):t('在 SFTP 列表选中 1–3 个普通 TXT 或 Markdown 文件后重新打开。','Select 1–3 ordinary TXT or Markdown files in the SFTP list and reopen.');
  }else if(curTab()?.connection==='ssh'){
    el('[data-instruction]').textContent=curTab().sshConfig?.managed?t('在 SFTP 文件面板选择文件，点击「在此远程目录提问」。','Select files in the SFTP panel and choose Ask in this remote folder.'):t('兼容终端不能读取结构化文件。请使用内置 SSH 的 SFTP 面板；不会读取终端输出。','The compatibility terminal has no structured file access. Use the built-in SSH file panel; terminal output is not read.');
  }
  let draft=null, timer, epoch=0, signature=null, key='', submitting=false, preparing=false, cleaning=false;
  const cleanup=el('[data-cleanup]');
  function cleanupScope() {
    if(el('[data-all]').checked)return null;
    const tab=curTab();
    if(remote)return tab===remoteTab && tab.sshFiles?.ready && !tab.sshFiles.busy &&
      tab.sshAuthenticated && !tab.disposed && !tab.exited && !tab.sshDisconnectRequested &&
      tab.sshFiles.taskBinding?.workspace.identity===remote.workspace.identity ? {remoteWorkspace:remote.workspace}:null;
    return tab && !isBrowserTab(tab) && !isTermTab(tab) && !state.loading && !state.error &&
      boundRoot && state.path && aiKey(state.path)===aiKey(boundRoot) && aiKey(aiBrowsingFolder())===aiKey(boundRoot)
      ? {root:boundRoot}:null;
  }
  function syncCleanup() {
    cleanup.hidden=!cleanupScope();
    cleanup.disabled=cleaning || preparing || submitting;
  }
  cleanup.onclick=async()=>{
    const scope=cleanupScope();
    if(!scope || cleanup.disabled)return;
    cleaning=true;syncCleanup();
    try {
      const plan=await invoke('harness_plan_cleanup',scope);
      if(!dialog.open || !cleanupScope())return;
      if(!plan.records && !plan.previews && !plan.legacyRows){
        status(plan.retained?t('只有进行中或待处理的任务，没有可清理的记录。','Only active or pending tasks remain.'):
          t('此目录没有可清理的任务记录或预览。','This folder has no task history or previews to clear.'));return;
      }
      const explanation=[plan.owner.workspace.path,remote?.fingerprint,
        t(`将清理 ${plan.records} 条已结束任务、${plan.previews} 份未提交的快照预览、${plan.legacyRows} 条旧索引记录，以及相应的本机运行时临时数据。`,
          `Remove ${plan.records} finished tasks, ${plan.previews} unsent snapshot previews, ${plan.legacyRows} older index entries and their local runtime data.`),
        plan.retained?t(`${plan.retained} 条进行中或待处理的记录将保留。`,`${plan.retained} active or pending entries will remain.`):'',
        plan.undoEntries?t(`${plan.undoEntries} 条已写入任务将失去任务中的撤销入口。`,`${plan.undoEntries} applied edits will lose their task undo button.`):'',
        t('不会改动项目文件、聊天、记忆、文件备份或服务器内容。记录清理后不能恢复。','Project files, chats, memory, backups and server contents are kept. History removal cannot be undone.')
      ].filter(Boolean).join('\n');
      if(!await confirmHarnessAction(dialog,t('清理此目录的本机任务数据？','Clear local task data for this folder?'),explanation,t('确认清理','Clear history')))return;
      if(!dialog.open || !cleanupScope())throw Error(t('当前目录已变化，请重新核对。','The active folder changed. Review again.'));
      await invoke('harness_clear_workspace',{...scope,expected:plan});
      if(draft){draft=null;key='';form.hidden=true;el('[data-files]').replaceChildren();}
      status(t('已清理此目录的任务记录和预览。','Cleared the reviewed history and previews for this folder.'));
      await refresh();
    } catch(e){if(dialog.open){status(String(e));await refresh();}}
    finally{cleaning=false;syncCleanup();}
  };
  function releasePreview() {
    const previous=draft;draft=null;key='';
    return discardHarnessPreview(previous);
  }
  const labels={running:t('进行中','Running'),succeeded:t('已完成','Completed'),cancelled:t('已停止','Stopped'),failed:t('失败','Failed'),interrupted:t('结果待核对','Interrupted'),
    awaiting_review:t('待审阅，尚未写入','Awaiting review'),applying:t('正在写入','Applying'),applied:t('已写入','Applied'),rejected:t('提案已失效','Dismissed'),not_applied:t('写入未完成','Not applied'),undoing:t('正在撤销','Undoing'),undone:t('已撤销','Undone')};
  const visibleResults=new Set(), observed=new Map(), reading=new Set();
  const list=el('[data-history]'), historyMessage=el('[data-history-message]'), retry=el('[data-history-retry]');
  const shownTasks=new Map();
  let historyScope=null, historyGeneration=0;
  function readVisible() {
    if(!dialog.open || document.hidden || !document.hasFocus() || document.activeElement?.closest('dialog')!==dialog)return;
    for(const pre of visibleResults){
      const row=observed.get(pre);
      if(!row?.unread || !pre.closest('details')?.open || reading.has(pre))continue;
      reading.add(pre);
      invoke('harness_mark_read',{id:row.id,workspace:row.workspace,resultRevision:row.resultRevision})
        .then(()=>{if(dialog.open)void refresh();}).catch(e=>{if(dialog.open && observed.has(pre))status(String(e));})
        .finally(()=>reading.delete(pre));
    }
  }
  const observer=new IntersectionObserver(entries=>{
    for(const e of entries){if(observed.has(e.target) && e.isIntersecting && e.intersectionRect.height>0)visibleResults.add(e.target);else visibleResults.delete(e.target);}
    readVisible();
  },{root:el('.harness-scroll')});
  dialog.addEventListener('focusin',readVisible);window.addEventListener('focus',readVisible);
  document.addEventListener('visibilitychange',readVisible);
  function flag(row,details) {
    const summary=details.querySelector('summary');
    let badge=summary.querySelector('.harness-unread-count');
    if(row.unread && !badge){badge=document.createElement('span');badge.className='harness-unread-count';badge.textContent=t('未读','Unread');summary.prepend(badge);}
    if(!row.unread)badge?.remove();
    const pre=details.querySelector('pre');
    if(row.unread){if(!observed.has(pre))observer.observe(pre);observed.set(pre,row);}
    else if(observed.delete(pre)){observer.unobserve(pre);visibleResults.delete(pre);}
  }
  function clearRows() {
    observer.disconnect(); visibleResults.clear(); observed.clear(); list.replaceChildren();
  }
  function invalidateHistory() {
    historyGeneration++; signature=null; shownTasks.clear(); clearRows();
  }
  function draw(rows, all) {
    const generation=historyGeneration;
    const open=new Set([...list.querySelectorAll('details[open]')].map(d=>d.dataset.id));
    const active=document.activeElement, focused=list.contains(active)?active.closest('details')?.dataset.id:null;
    const selector=active?.matches('summary')?'summary':active?.hasAttribute('data-review-action')?'[data-review-action]':'[data-history-action]';
    clearRows();
    if (!rows.length) {list.textContent=t('暂无任务记录','No tasks yet');return;}
    for (const row of rows) {
      const stillInView=()=>dialog.open && generation===historyGeneration && shownTasks.get(row.id)===row.status;
      const details=document.createElement('details'); details.dataset.id=row.id; details.open=open.has(row.id) || focusId===row.id;
      const summary=document.createElement('summary'); summary.textContent=`${labels[row.status]||row.status} · ${row.webSource?.url || row.files.join('、')} · ${row.question}`;
      if (all) {
        const location=document.createElement('small');
        location.className='harness-history-owner'; location.textContent=row.workspace.path;
        summary.append(location);
      }
      const owner=document.createElement('p'); owner.textContent=`${row.workspace.path} · ${row.model} · ${new Date(row.created).toLocaleString()}`;
      const text=document.createElement('pre'); text.textContent=row.result;
      if(row.remoteSource){owner.textContent+=' · '+t('连接模式：','Connection mode: ')+row.remoteSource.peer.system+' · '+row.remoteSource.peer.fingerprint+' · '+t('采集于 ','Captured ')+new Date(row.remoteSource.capturedAt).toLocaleString()+(row.snapshotOffline?' · '+t('来自断线前的快照','Snapshot from a previous connection'):'');}
      const action=document.createElement('button'); action.className='ai-secondary'; action.type='button';action.dataset.historyAction='';
      const running=row.status==='running', pending=row.status==='awaiting_review', busy=['applying','undoing'].includes(row.status);
      action.disabled=busy;
      action.textContent=pending?t('放弃提案','Discard proposal'):running?t('停止任务','Stop task'):t('移除记录','Remove record');
      action.onclick=async()=>{
        if (!stillInView()) return;
        if (!running && !pending && !await confirmHarnessAction(dialog,t('移除任务记录？','Remove this task from history?'),row.workspace.path+' · '+row.question,t('移除记录','Remove record'))) return;
        if (!stillInView()) {
          if (dialog.open) status(t('任务列表已变化，请重新选择记录。','Task history changed. Select the record again.'));
          return;
        }
        action.disabled=true;
        try { await invoke(running || pending?'harness_stop':'harness_forget',{id:row.id}); await refresh(); }
        catch(e){status(String(e));} finally {action.disabled=false;}
      };
      details.append(summary,owner,text);
      if (pending || row.status==='applied') {
        const write=document.createElement('button');write.type='button';write.className='ai-secondary';
        write.dataset.reviewAction=pending?'review':'undo';
        write.textContent=pending?t('审阅差异','Review changes'):t('撤销此次写入','Undo this edit');
        write.disabled=!harnessCanReview(row.workspace.path);
        if(write.disabled)write.title=t('回到此文件目录，使用「确认后执行」。','Open this directory in Ask before changes mode.');
        write.onclick=async()=>{
          if (!stillInView()) return;
          write.disabled=true;
          try {
            if (pending) await openHarnessReview(row,dialog,refresh,stillInView);
            else if(await confirmHarnessAction(dialog,t('恢复此次修改前的原文？','Restore the original text?'),row.workspace.path+' · '+row.files.join('、'),t('确认撤销','Undo edit'))) {
              const access=await harnessEditAccess(row.workspace.path);
              if (stillInView()) await invoke('harness_undo_review',{id:row.id,...access});
            }
          } catch(e){status(String(e));} finally {await refresh();write.disabled=!harnessCanReview(row.workspace.path);}
        };
        details.append(write);
      }
      details.append(action); list.append(details);flag(row,details);
      if(focusId===row.id){focusId=null;summary.focus({preventScroll:true});details.scrollIntoView({block:'nearest'});}
      if(focused===row.id)(details.querySelector(selector+':not(:disabled)')||summary).focus({preventScroll:true});
    }
  }
  async function refresh() {
    if (!dialog.open) return;
    clearTimeout(timer);
    syncCleanup();
    const version=++epoch, all=el('[data-all]').checked;
    if (all!==historyScope) {
      historyScope=all;
      invalidateHistory();
    }
    if (signature===null) {
      historyMessage.textContent=t('正在读取任务记录…','Loading task history…');
      historyMessage.hidden=false; retry.hidden=true;
    }
    try {
      const rows=all || boundRoot || remote ? await invoke('harness_list',{root:all?null:boundRoot,remoteWorkspace:!all&&remote?remote.workspace.identity:null}) : [];
      if (!dialog.open || version!==epoch)return;
      if (!Array.isArray(rows)) throw Error(t('任务记录不可用','Task history unavailable'));
      if(focusId && !rows.some(r=>r.id===focusId)){focusId=null;status(t('这条任务已移除，请核对当前目录记录。','This task was removed. Review the current workspace history.'));}
      shownTasks.clear();
      for (const row of rows) shownTasks.set(row.id,row.status);
      const stamp=JSON.stringify(rows.map(r=>[r.id,r.status,r.resultRevision,r.result,r.snapshotOffline]));
      if (stamp!==signature) {draw(rows,all);signature=stamp;}
      else{const items=el('[data-history]').querySelectorAll('details');rows.forEach((r,i)=>flag(r,items[i]));}
      historyMessage.hidden=true; historyMessage.textContent=''; retry.hidden=true;
      if (rows.some(r=>['running','applying','undoing','awaiting_review'].includes(r.status) || r.snapshotOffline===false)) timer=setTimeout(refresh,1500);
    } catch(e){
      if (!dialog.open || version!==epoch) return;
      invalidateHistory();
      historyMessage.textContent=t('无法读取任务记录。','Could not load task history. ')+String(e);
      historyMessage.hidden=false; retry.hidden=false;
    }
  }
  retry.onclick=refresh;
  prepare.onclick=async()=>{
    if(cleaning || preparing || submitting)return;
    preparing=true;syncCleanup();form.hidden=true;prepare.disabled=true;kind.disabled=true;status('');
    try {
      await releasePreview();if(!dialog.open)return;
      if(!selection || JSON.stringify(currentSelection())!==JSON.stringify(selection)) throw Error(t('文件选择或连接已变化，请重新打开。','Selection or connection changed. Reopen File tasks.'));
      const settings={endpoint:aiSettings.endpoint,apiFormat:aiFormatOf(aiSettings),model:aiSettings.model};
      key=aiSessionKey || '';
      const permission=kind.value==='edit'?await harnessEditAccess(selection.root):{};
      const value=remote?await invoke('harness_prepare_remote',{...selection,...settings}):await invoke('harness_prepare',{...selection,...settings,...permission,kind:kind.value});
      if (!dialog.open){await discardHarnessPreview(value);return;}
      draft=value; el('[data-route]').textContent=t('将发送到：','Destination: ')+value.endpoint+' · '+value.model;
      if(remote)el('[data-route]').textContent+=' · '+t('快照时间：','Captured: ')+new Date(value.remoteSource.capturedAt).toLocaleString();
      const files=el('[data-files]'); files.replaceChildren();
      for(const file of value.snapshot.files){
        const d=document.createElement('details'),s=document.createElement('summary'),p=document.createElement('pre');
        d.open=true;s.textContent=file.name;p.textContent=file.text;d.append(s,p);files.append(d);
      }
      form.hidden=false;form.elements.question.focus();
    } catch(e){if(dialog.open)status(String(e));} finally{preparing=false;syncCleanup();prepare.disabled=!selection;kind.disabled=false;}
  };
  form.onsubmit=async event=>{
    event.preventDefault();
    const question=form.elements.question.value.trim();
    if (!draft || submitting || cleaning || preparing || !question)return;
    if (remote?JSON.stringify(currentSelection())!==JSON.stringify(selection):aiKey(aiBrowsingFolder())!==aiKey(boundRoot)){status(t('当前任务目录或连接已变化，请重新打开。','Target or connection changed. Reopen File tasks.'));return;}
    submitting=true;syncCleanup();form.elements.question.readOnly=true;submit.disabled=true;prepare.disabled=true;kind.disabled=true;
    const sending=draft;
    try {
      if (sending.kind==='edit') await harnessEditAccess(boundRoot);
      if (!dialog.open)return;
      await invoke('harness_submit',{id:sending.id,question,apiKey:key});
      draft=null;key=''; if(!dialog.open)return;
      form.hidden=true;form.elements.question.value='';el('[data-files]').replaceChildren();
      status(t('已提交。可以关闭窗口或切换标签，结果保存在此目录的任务记录。','Submitted. You can switch tabs; the result stays in this folder’s task history.'));
      await refresh();
    } catch(e){if(dialog.open)status(String(e));}
    finally {
      submitting=false;syncCleanup();form.elements.question.readOnly=false;submit.disabled=false;prepare.disabled=!selection;kind.disabled=false;
      if(!dialog.open)void discardHarnessPreview(sending).catch(e=>toast(String(e),true));
    }
  };
  kind.onchange=()=>{form.hidden=true;el('[data-files]').replaceChildren();void releasePreview().catch(e=>status(String(e)));};
  el('[data-all]').onchange=refresh; el('[data-close]').onclick=()=>dialog.close();
  dialog.addEventListener('harness-history-changed',refresh);
  dialog.onclose=()=>{++epoch;clearTimeout(timer);observer.disconnect();window.removeEventListener('focus',readVisible);document.removeEventListener('visibilitychange',readVisible);if(!submitting)void releasePreview().catch(e=>toast(String(e),true));key='';draft=null;dialog.remove();};
  dialog.showModal();void refresh();
}
