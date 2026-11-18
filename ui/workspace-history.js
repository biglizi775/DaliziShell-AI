'use strict';

function workspaceHistorySources(view, panel) {
  const T=chatText, find=selector=>panel.querySelector(selector);
  let pages, next, rows, selected;
  function reset() {
    pages=[null]; next=null; rows=[]; selected=null;
    panel.replaceChildren();
  }
  const current=(generation)=>view.generation===generation && fileHistoryView===view && view.dialog.open && view.ownsWorkspace();
  const date=ms=>new Date(ms).toLocaleString(locale==='zh'?'zh-CN':'en');
  const when=row=>view.source==='harness' ? row.created : Number(row.id.split('-')[0]);
  const direction=s=>s.direction==='upload'?T('上传','Upload'):T('下载','Download');
  function status(s) {
    const labels={succeeded:['已完成','Completed'],complete:['已完成','Completed'],awaiting_review:['待审阅','Awaiting review'],
      applying:['正在写入','Applying'],applied:['已写入','Applied'],rejected:['已放弃','Dismissed'],not_applied:['未写入','Not applied'],
      undoing:['正在撤销','Undoing'],undone:['已撤销','Undone'],cancelled:['已取消','Cancelled']};
    return labels[s]?T(...labels[s]):fileHistoryLabel(s);
  }
  async function load() {
    const generation=++view.generation, harness=view.source==='harness';
    selected=null; next=null; rows=[];
    panel.innerHTML=`<p data-related-status role="status"></p><div class="file-history-list"></div>
      <div class="chat-actions"><button data-page-older hidden>${T('更早记录','Older records')}</button><button data-page-newer hidden>${T('较新记录','Newer records')}</button></div>
      <section class="file-history-detail" hidden></section>
      <button data-remove-page hidden></button><div data-page-confirm hidden><p>${T('将从本机历史中移除本页已结束的传输记录。传输的文件会保留。','Remove finished transfers on this page from local history? Transferred files will stay in place.')}</p><button data-confirm-page>${T('确认移除本页记录','Confirm removal for this page')}</button></div>`;
    const note=find('[data-related-status]'); note.textContent=T('正在读取…','Loading…');
    try {
      const result=await invoke(harness?'harness_list':'ssh_history_list',harness?view.query:{...view.query,before:pages[pages.length - 1]});
      if(!current(generation))return;
      rows=harness?result:result.rows; next=harness?null:result.next;
      find('[data-page-older]').hidden=!next; find('[data-page-newer]').hidden=pages.length<2;
      const finished=harness?0:rows.filter(r=>r.revision && r.outcome && r.status!=='unconfirmed').length;
      if(finished){const clear=find('[data-remove-page]');clear.textContent=T('移除本页已结束记录','Remove finished records on this page')+' ('+finished+')';clear.hidden=false;}
      note.textContent=rows.length?'':T('此目录暂无相关记录。','No matching records in this workspace.');
      find('.file-history-list').innerHTML=rows.map((row,index)=>{
        const s=row.start;
        const title=harness ? row.question : s ? direction(s)+' · '+s.localPath.split(/[\\/]/).pop() : date(when(row));
        const peer=s ? s.peer.user+'@'+s.peer.host+':'+s.peer.port : '';
        const meta=[date(when(row)),status(row.status),peer].filter(Boolean).join(' · ');
        return `<button type="button" data-related-row="${index}"><span>${esc(title)}</span><small>${esc(meta)}</small></button>`;
      }).join('');
    } catch(e){if(current(generation))note.textContent=String(e);}
  }
  function show(row) {
    selected=row; const detail=find('.file-history-detail');
    const label=(name,value)=>`<p class="chat-note">${esc(name)}<code>${esc(value)}</code></p>`;
    let body='';
    if(view.source==='harness'){
      body=label(T('任务','Task'),row.question)+label(T('工作区','Workspace'),row.workspace.path)+
        label(T('文件','Files'),row.webSource?.url || row.files.join('、'))+
        `<button data-open-harness>${T('打开这条任务','Open this task')}</button>`;
    } else if(row.start) {
      const s=row.start;
      body=label(T('操作','Operation'),direction(s)+' · '+(s.directory?T('目录','Folder'):T('文件','File')))+
        label(T('本地路径','Local path'),s.localPath)+label(T('远程路径','Remote path'),s.remotePath)+
        label(T('连接','Connection'),s.peer.user+'@'+s.peer.host+':'+s.peer.port+' · '+s.peer.system)+label(T('主机指纹','Host fingerprint'),s.peer.fingerprint);
      if(row.outcome)body+=label(T('已传输字节','Transferred bytes'),String(row.outcome.bytes));
      const reasons={destinationExists:['目标已存在','Destination already exists'],resumeMismatch:['续传校验未通过','Resume verification failed'],
        cancelled:['传输已取消','Transfer cancelled'],cleanupWarning:['临时文件清理需要核对','Check temporary file cleanup'],
        transferFailed:['传输未完成','Transfer did not complete'],verifyDestination:['目标文件的最终状态待核对','Verify the final destination state']};
      if(reasons[row.outcome?.reason])body+=label(T('结果说明','Result details'),T(...reasons[row.outcome.reason]));
      if(row.status==='unconfirmed')body+=`<p>${T('请核对本地和远程文件，再决定是否重试。','Check both endpoints before deciding whether to retry.')}</p>`;
    }
    if(view.source==='sftp' && row.revision)body+=`<button data-remove-transfer>${T('移除传输记录','Remove transfer record')}</button>
      <div data-remove-review hidden><p>${T('移除这条本机历史记录？传输的文件会保留。','Remove this local history record? Transferred files will stay in place.')}</p><button data-confirm-transfer>${T('确认移除','Confirm removal')}</button></div>`;
    detail.innerHTML=`<h3>${esc(status(row.status))}</h3><small>${esc(date(when(row)))}</small>`+body;
    detail.hidden=false; detail.scrollIntoView({block:'nearest'});
  }
  async function click(button){
    if(button.dataset.relatedRow!=null){const row=rows[Number(button.dataset.relatedRow)];if(row)show(row);}
    else if(button.hasAttribute('data-page-older')&&next){pages.push(next);await load();}
    else if(button.hasAttribute('data-page-newer')&&pages.length>1){pages.pop();await load();}
    else if(button.hasAttribute('data-open-harness')&&selected&&view.source==='harness'){
      const id=selected.id; view.dialog.close(); openHarnessTasks(view.remoteTab,id);
    } else if(button.hasAttribute('data-remove-page')&&view.source==='sftp')find('[data-page-confirm]').hidden=false;
    else if(button.hasAttribute('data-confirm-page')&&view.source==='sftp') {
      const generation=view.generation, finished=rows.filter(r=>r.revision && r.outcome && r.status!=='unconfirmed');
      view.removing=true;
      let removed=0, error='';
      try {
        for(const {id,bucket,revision} of finished){
          if(!current(generation))break;
          try{await invoke('ssh_history_remove',{...view.query,id,bucket,revision});removed++;}
          catch(e){error=String(e);break;}
        }
        if(current(generation)){pages=[null];await load();if(error && view.ownsWorkspace())find('[data-related-status]').textContent=T('已移除','Removed')+' '+removed+' / '+finished.length+' · '+error;}
      } finally {view.removing=false;}
    } else if(button.hasAttribute('data-remove-transfer')&&selected?.revision)find('[data-remove-review]').hidden=false;
    else if(button.hasAttribute('data-confirm-transfer')&&selected?.revision&&view.source==='sftp'){
      const {id,bucket,revision}=selected, generation=view.generation; view.removing=true;
      try {
        await invoke('ssh_history_remove',{...view.query,id,bucket,revision});
        if(current(generation)){pages=[null];await load();}
      } catch(e){if(current(generation))find('[data-related-status]').textContent=String(e);}
      finally{view.removing=false;}
    }
  }
  return {reset,load,click};
}
