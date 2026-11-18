'use strict';
/* SFTP transfer receipts for the remote directory shown in the current SSH tab. */

let transferHistoryView = null;
const transferHistoryText = (zh, en) => locale === 'en' ? en : zh;
const transferHistoryStatus = {
  complete:['已完成','Completed'], failed:['失败','Failed'], cancelled:['已取消','Cancelled'],
  running:['进行中','Running'], unconfirmed:['结果待核对','Outcome unconfirmed'],
};

function syncTransferHistoryScope() {
  if (transferHistoryView && !transferHistoryView.ownsWorkspace()) transferHistoryView.dialog.close();
}

function openTransferHistory(remoteTab) {
  const workspace = remoteTab?.sshFiles?.historyWorkspace;
  if (!workspace || remoteTab !== curTab() || remoteTab.sshFiles.busy) return;
  if (transferHistoryView) { transferHistoryView.dialog.focus(); return; }
  const T = transferHistoryText, dialog = document.createElement('dialog');
  dialog.id = 'transferHistoryDialog'; dialog.className = 'file-settings-dialog chat-history-dialog';
  dialog.setAttribute('aria-labelledby', 'transferHistoryTitle');
  dialog.innerHTML = `<header class="file-settings-head"><div><h2 id="transferHistoryTitle">${T('SFTP 传输记录','SFTP transfer history')}</h2><p class="chat-root"></p></div></header>
    <div class="file-settings-body"><p data-related-status role="status"></p><div class="file-history-list"></div>
    <div class="chat-actions"><button data-page-older hidden>${T('更早记录','Older records')}</button><button data-page-newer hidden>${T('较新记录','Newer records')}</button></div>
    <section class="file-history-detail" hidden></section>
    <button data-remove-page hidden></button><div data-page-confirm hidden><p>${T('将从本机历史中移除本页已结束的传输记录。传输的文件会保留。','Remove finished transfers on this page from local history? Transferred files will stay in place.')}</p><button data-confirm-page>${T('确认移除本页记录','Confirm removal for this page')}</button></div></div>
    <footer class="file-settings-footer"><button data-refresh>${T('刷新','Refresh')}</button><button data-close>${T('关闭','Close')}</button></footer>`;
  const login = remoteTab.termId, key = remoteTab.key;
  const ownsWorkspace = () => curTab() === remoteTab && remoteTab.termId === login && remoteTab.key === key &&
    remoteTab.sshAuthenticated && !remoteTab.disposed && !remoteTab.exited && !remoteTab.sshDisconnectRequested &&
    remoteTab.sshFiles?.ready && !remoteTab.sshFiles.busy && remoteTab.sshFiles.historyWorkspace?.identity === workspace.identity;
  const view = { dialog, ownsWorkspace, query: { remoteWorkspace: workspace.identity }, generation: 0, removing: false };
  transferHistoryView = view; document.body.append(dialog);
  const find = (selector) => dialog.querySelector(selector);
  find('.chat-root').textContent = [workspace.path, remoteTab.sshVerifiedPeer?.fingerprint].filter(Boolean).join(' · ');
  let pages = [null], next = null, rows = [], selected = null;
  const current = (generation) => view.generation === generation && transferHistoryView === view && dialog.open && ownsWorkspace();
  const date = (row) => new Date(Number(row.id.split('-')[0])).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en');
  const direction = (s) => s.direction === 'upload' ? T('上传','Upload') : T('下载','Download');
  const status = (value) => transferHistoryStatus[value] ? T(...transferHistoryStatus[value]) : value;
  const peerLabel = (s) => s.peer.user + '@' + s.peer.host + ':' + s.peer.port;
  async function load() {
    const generation = ++view.generation;
    selected = null; next = null; rows = [];
    find('.file-history-detail').hidden = true; find('[data-page-confirm]').hidden = true; find('[data-remove-page]').hidden = true;
    const note = find('[data-related-status]'); note.textContent = T('正在读取…','Loading…');
    find('.file-history-list').innerHTML = '';
    try {
      const result = await invoke('ssh_history_list', { ...view.query, before: pages[pages.length - 1] });
      if (!current(generation)) return;
      rows = result.rows; next = result.next;
      find('[data-page-older]').hidden = !next; find('[data-page-newer]').hidden = pages.length < 2;
      const finished = rows.filter((r) => r.revision && r.outcome && r.status !== 'unconfirmed').length;
      if (finished) { const clear = find('[data-remove-page]'); clear.textContent = T('移除本页已结束记录','Remove finished records on this page') + ' (' + finished + ')'; clear.hidden = false; }
      note.textContent = rows.length ? '' : T('此目录暂无传输记录。','No transfers recorded for this directory.');
      find('.file-history-list').innerHTML = rows.map((row, index) => {
        const s = row.start;
        const title = s ? direction(s) + ' · ' + s.localPath.split(/[\\/]/).pop() : date(row);
        const meta = [date(row), status(row.status), s ? peerLabel(s) : ''].filter(Boolean).join(' · ');
        return `<button type="button" data-related-row="${index}"><span>${esc(title)}</span><small>${esc(meta)}</small></button>`;
      }).join('');
    } catch (e) { if (current(generation)) note.textContent = String(e); }
  }
  function show(row) {
    selected = row; const detail = find('.file-history-detail');
    const label = (name, value) => `<p class="chat-note">${esc(name)}<code>${esc(value)}</code></p>`;
    let body = '';
    if (row.start) {
      const s = row.start;
      body = label(T('操作','Operation'), direction(s) + ' · ' + (s.directory ? T('目录','Folder') : T('文件','File'))) +
        label(T('本地路径','Local path'), s.localPath) + label(T('远程路径','Remote path'), s.remotePath) +
        label(T('连接','Connection'), peerLabel(s) + ' · ' + s.peer.system) + label(T('主机指纹','Host fingerprint'), s.peer.fingerprint);
      if (row.outcome) body += label(T('已传输字节','Transferred bytes'), String(row.outcome.bytes));
      const reasons = { destinationExists:['目标已存在','Destination already exists'], resumeMismatch:['续传校验未通过','Resume verification failed'],
        cancelled:['传输已取消','Transfer cancelled'], cleanupWarning:['临时文件清理需要核对','Check temporary file cleanup'],
        transferFailed:['传输未完成','Transfer did not complete'], verifyDestination:['目标文件的最终状态待核对','Verify the final destination state'] };
      if (reasons[row.outcome?.reason]) body += label(T('结果说明','Result details'), T(...reasons[row.outcome.reason]));
      if (row.status === 'unconfirmed') body += `<p>${T('请核对本地和远程文件，再决定是否重试。','Check both endpoints before deciding whether to retry.')}</p>`;
    }
    if (row.revision) body += `<button data-remove-transfer>${T('移除传输记录','Remove transfer record')}</button>
      <div data-remove-review hidden><p>${T('移除这条本机历史记录？传输的文件会保留。','Remove this local history record? Transferred files will stay in place.')}</p><button data-confirm-transfer>${T('确认移除','Confirm removal')}</button></div>`;
    detail.innerHTML = `<h3>${esc(status(row.status))}</h3><small>${esc(date(row))}</small>` + body;
    detail.hidden = false; detail.scrollIntoView?.({ block: 'nearest' });
  }
  async function remove(records) {
    const generation = view.generation; view.removing = true;
    let removed = 0, error = '';
    try {
      for (const { id, bucket, revision } of records) {
        if (!current(generation)) break;
        try { await invoke('ssh_history_remove', { ...view.query, id, bucket, revision }); removed++; }
        catch (e) { error = String(e); break; }
      }
      if (current(generation)) {
        pages = [null]; await load();
        if (error && ownsWorkspace()) find('[data-related-status]').textContent = T('已移除','Removed') + ' ' + removed + ' / ' + records.length + ' · ' + error;
      }
    } finally { view.removing = false; }
  }
  dialog.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button || view.removing) return;
    if (button.hasAttribute('data-close')) dialog.close();
    else if (button.hasAttribute('data-refresh')) { pages = [null]; await load(); }
    else if (button.dataset.relatedRow != null) { const row = rows[Number(button.dataset.relatedRow)]; if (row) show(row); }
    else if (button.hasAttribute('data-page-older') && next) { pages.push(next); await load(); }
    else if (button.hasAttribute('data-page-newer') && pages.length > 1) { pages.pop(); await load(); }
    else if (button.hasAttribute('data-remove-page')) find('[data-page-confirm]').hidden = false;
    else if (button.hasAttribute('data-confirm-page')) await remove(rows.filter((r) => r.revision && r.outcome && r.status !== 'unconfirmed'));
    else if (button.hasAttribute('data-remove-transfer') && selected?.revision) find('[data-remove-review]').hidden = false;
    else if (button.hasAttribute('data-confirm-transfer') && selected?.revision) await remove([selected]);
  });
  dialog.addEventListener('cancel', (event) => { if (view.removing) event.preventDefault(); });
  dialog.addEventListener('close', () => { if (transferHistoryView === view) transferHistoryView = null; dialog.remove(); });
  dialog.showModal();
  void load();
}
