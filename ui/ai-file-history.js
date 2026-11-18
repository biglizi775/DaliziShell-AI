'use strict';

let fileHistoryView = null;
const fileHistoryLabels = {
  completed:['已完成','Completed'], interrupted:['中断，需核对','Interrupted · review'], damaged:['记录损坏','Damaged record'],
  unavailable:['暂时无法读取','Unavailable'], failed:['失败','Failed'], cancelled:['已停止','Stopped'], expired:['已过期','Expired'],
  running:['执行中','Running'], success:['已完成','Completed'], notStarted:['无开始记录','No recorded start'],
  unconfirmed:['结果待核对','Outcome unconfirmed'], skipped:['已跳过','Skipped'],
  mkdir:['创建目录','Create folder'], copy:['复制','Copy'], rename:['重命名','Rename'], move:['移动','Move'],
  edit_text:['修改文档','Edit document'], create_text:['新建文档','Create document'],
  save_reply:['保存回复','Save reply'], undo_edit:['撤销修改','Undo edit'],
};
function fileHistoryLabel(key) {
  const label = fileHistoryLabels[key]; return label ? chatText(...label) : key;
}
function syncFileHistoryScope() {
  if (fileHistoryView && !fileHistoryView.ownsWorkspace()) fileHistoryView.dialog.close();
}
function reportDocumentReceipt(session, receipt, successText) {
  const outcome = receipt.error || successText;
  const warning = receipt.journalWarning ? chatText('操作结果未完整写入记录，请核对文件。','The journal could not store the complete outcome. Check the file.') + ' ' + receipt.journalWarning : '';
  const text = [outcome,warning].filter(Boolean).join('\n');
  addAiMessage(session,'notice',text,{journalId:receipt.journalId,error:!!(receipt.error || warning)});
  return text;
}
function openFileHistory(recordId, remoteTab = null) {
  const session = aiCurrentSession();
  const binding = remoteTab?.sshFiles?.taskBinding;
  const remoteWorkspace=remoteTab?.sshFiles?.historyWorkspace || binding?.workspace;
  if (remoteTab ? !remoteWorkspace || remoteTab !== curTab() || remoteTab.sshFiles.busy : !session) return;
  if (fileHistoryView) { fileHistoryView.dialog.focus(); return; }
  const T = chatText, dialog = document.createElement('dialog');
  dialog.id = 'fileHistoryDialog'; dialog.className = 'file-settings-dialog chat-history-dialog';
  dialog.setAttribute('aria-labelledby', 'fileHistoryTitle');
  dialog.innerHTML = `<header class="file-settings-head"><div><h2 id="fileHistoryTitle">${T('工作区历史','Workspace history')}</h2><p class="chat-root"></p></div></header>
    <div class="file-settings-body"><nav class="history-sources" aria-label="${T('记录来源','Record source')}">
    ${remoteTab ? '' : `<button data-source="files">${T('文件操作','File operations')}</button>`}${(!remoteTab || binding) ? `<button data-source="harness">${T('Harness 任务','Harness tasks')}</button>` : ''}<button data-source="sftp">${T('SFTP 传输','SFTP transfers')}</button></nav>
    <section data-local-records><p class="chat-note">${T('本目录最多保存 128 条记录，包括文件计划、保存回复与撤销修改。中断的步骤请核对实际文件。','This folder holds up to 128 records for file plans, saved replies and undone edits. Check the files for interrupted steps.')}</p>
    <p data-history-status role="status"></p><div class="file-history-list"></div>
    <div class="chat-actions"><button class="ai-link" data-older hidden>${T('更早记录','Older records')}</button><button class="ai-link" data-newer hidden>${T('较新记录','Newer records')}</button></div>
    <section class="file-history-detail" hidden></section></section><section data-related-records hidden></section></div>
    <footer class="file-settings-footer"><button data-refresh>${T('刷新','Refresh')}</button><button data-close>${T('关闭','Close')}</button></footer>`;
  const login = remoteTab?.termId, key = remoteTab?.key;
  const ownsWorkspace = () => remoteTab ? curTab() === remoteTab && remoteTab.termId === login && remoteTab.key === key &&
    remoteTab.sshAuthenticated && !remoteTab.disposed && !remoteTab.exited && !remoteTab.sshDisconnectRequested &&
    remoteTab.sshFiles?.ready && !remoteTab.sshFiles.busy && (remoteTab.sshFiles.historyWorkspace || remoteTab.sshFiles.taskBinding?.workspace)?.identity === remoteWorkspace.identity
    : aiCurrentSession() === session;
  if (!ownsWorkspace()) return;
  const view = {session, remoteTab, query:remoteTab ? {remoteWorkspace:remoteWorkspace.identity} : {root:session.root},
    root:remoteTab ? remoteWorkspace.path : session.root, ownsWorkspace, source:null, dialog, pages:[null], next:null, generation:0, selection:0, record:null, removing:false};
  fileHistoryView = view; document.body.append(dialog);
  const find = selector => dialog.querySelector(selector), status = find('[data-history-status]'), detail = find('.file-history-detail');
  find('.chat-root').textContent = [view.root, remoteTab?.sshVerifiedPeer?.fingerprint || binding?.fingerprint].filter(Boolean).join(' · ');
  const owns = () => fileHistoryView === view && view.source === 'files' && ownsWorkspace() && dialog.open;
  const related = workspaceHistorySources(view,find('[data-related-records]'));
  function select(source, id) {
    view.generation++; clearDetail(); view.source=source;
    find('[data-local-records]').hidden=source!=='files';
    find('[data-related-records]').hidden=source==='files';
    for(const button of dialog.querySelectorAll('[data-source]')) button.setAttribute('aria-pressed',String(button.dataset.source===source));
    related.reset();
    if(source==='files') {view.pages=[null]; void load(id);}
    else void related.load();
  }
  const clearDetail = () => { view.selection++; view.record = null; detail.hidden = true; detail.replaceChildren(); };
  const date = id => new Date(Number(id.split('-')[0])).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en');
  async function show(id) {
    clearDetail(); const selection = view.selection;
    try {
      const record = await invoke('ai_file_history_read', {root:view.root, id});
      if (!owns() || view.selection !== selection) return;
      view.record = record;
      const row = record.row, role = typeof currentAgentProfile === 'function' && currentAgentProfile(view.root)?.roles?.find(r => r.id === row.role);
      const permission = row.mode ? T(row.approved ? '经用户确认' : '目录自动执行', row.approved ? 'User confirmed' : 'Folder auto mode') : '';
      const meta = [date(id), role ? (locale === 'zh' ? role.nameZh : role.nameEn) : row.role, permission].filter(Boolean).join(' · ');
      detail.innerHTML = `<h3>${esc(fileHistoryLabel(row.status))}</h3><p class="chat-note">${esc(meta)}</p>
        ${row.partialTail ? `<p class="chat-note">${T('末条记录尚不完整，以下只显示已写完的事件。','The last entry is incomplete. Only fully written events are shown.')}</p>` : ''}
        <ol>${record.steps.map(s => `<li><strong>${esc(fileHistoryLabel(s.kind))} · ${esc(fileHistoryLabel(s.status))}</strong><code>${esc([s.source,s.target].filter(Boolean).join(' → '))}</code>${s.ms != null ? `<small>${esc(String(s.ms))} ms</small>` : ''}${s.detail ? `<p>${esc(s.detail)}</p>` : ''}</li>`).join('')}</ol>
        ${row.revision ? `<button class="ai-link" data-remove>${T('移除这条记录','Remove record')}</button><div data-confirm hidden><p>${T('移除后仍保留实际文件。','The files from this operation will remain in place.')}</p><button data-confirm-remove>${T('确认移除记录','Confirm removal')}</button></div>` : ''}`;
      detail.hidden = false;
      detail.scrollIntoView({block:'nearest'});
    } catch (error) {if (owns() && view.selection === selection) status.textContent = String(error);}
  }
  async function load(id) {
    const generation = ++view.generation;
    clearDetail(); find('.file-history-list').replaceChildren(); view.next=null;
    find('[data-older]').hidden = true; find('[data-newer]').hidden = view.pages.length === 1;
    status.textContent = T('正在读取…','Loading…');
    try {
      const page = await invoke('ai_file_history_list', {root:view.root, before:view.pages[view.pages.length - 1]});
      if (!owns() || view.generation !== generation) return;
      status.textContent = page.total ? T('本目录记录','Records in this folder') + ' · ' + page.total + '/128' : T('这个目录还没有文件操作记录。','No file operations recorded in this folder.');
      view.next = page.next; find('[data-older]').hidden = !page.next;
      find('.file-history-list').innerHTML = page.rows.map(row => {
        const direct = ['save_reply','undo_edit'].includes(row.firstKind) ? fileHistoryLabel(row.firstKind) + ' · ' : '';
        return `<button type="button" data-file-id="${esc(row.id)}"><span>${esc(row.firstTarget || date(row.id))}</span><small>${esc(date(row.id))} · ${esc(direct + fileHistoryLabel(row.status))} · ${row.succeeded}/${row.count}</small></button>`;
      }).join('');
      if (id) await show(id);
    } catch (error) {if (owns() && view.generation === generation) status.textContent = String(error);}
  }
  dialog.onclick = async event => {
    const button = event.target.closest('button');
    if (!ownsWorkspace()) {dialog.close();return;}
    if (!button || view.removing || fileHistoryView!==view || !dialog.open) return;
    if (button.hasAttribute('data-close')) dialog.close();
    else if (button.dataset.source) {if (button.dataset.source!==view.source) select(button.dataset.source);}
    else if (view.source!=='files') {
      if (button.hasAttribute('data-refresh')) await related.load();
      else await related.click(button);
    }
    else if (button.hasAttribute('data-refresh')) await load(view.record?.row.id);
    else if (button.dataset.fileId) await show(button.dataset.fileId);
    else if (button.hasAttribute('data-older') && view.next) {view.pages.push(view.next); await load();}
    else if (button.hasAttribute('data-newer') && view.pages.length > 1) {view.pages.pop(); await load();}
    else if (button.hasAttribute('data-remove')) find('[data-confirm]').hidden = false;
    else if (button.hasAttribute('data-confirm-remove') && view.record) {
      view.removing = true;
      try {
        const {id,revision} = view.record.row;
        await invoke('ai_file_history_remove', {root:view.root, id, revision});
        if (owns()) {view.pages = [null]; await load();}
      } catch (error) {if (owns()) status.textContent = String(error);}
      finally {view.removing = false;}
    }
  };
  dialog.addEventListener('close', () => { if (fileHistoryView === view) fileHistoryView = null; dialog.remove(); }, {once:true});
  dialog.showModal(); select(remoteTab ? 'sftp' : 'files', recordId);
}
