'use strict';

function sshRecoveryConnection(peer) {
  const matches = tb => {
    const verified = tb?.sshVerifiedPeer;
    return tb?.sshAuthenticated && !tb.exited && !tb.disposed && !tb.sshDisconnectRequested &&
      verified?.id === tb.termId && verified.key === tb.key &&
      ['host','port','user','fingerprint','system'].every(key => verified.peer?.[key] === peer[key]);
  };
  return matches(curTab()) ? curTab() : state.tabs.find(matches);
}

function openSshBatchRecovery() {
  const T = sshTaskText;
  const dialog = document.createElement('dialog');
  dialog.id = 'sshBatchRecovery';
  dialog.className = 'file-settings-dialog ssh-batch-review';
  dialog.setAttribute('aria-labelledby', 'sshRecoveryTitle');
  dialog.innerHTML = `<header class="file-settings-head"><h2 id="sshRecoveryTitle">${T('恢复未开始项', 'Recover pending entries')}</h2><button data-close aria-label="${T('关闭','Close')}">×</button></header>
    <div class="file-settings-body"><p>${T('先核对本机保存的批次。登录原主机后，可将未开始的项目加入队列。', 'Review batches saved on this device. Sign in to the original host to queue pending entries.')}</p>
    <div data-list></div><div data-detail></div><p data-status role="status"></p></div>
    <footer class="file-settings-footer"><button data-refresh>${T('刷新','Refresh')}</button><button data-more hidden>${T('更多批次','More batches')}</button><span class="file-settings-spacer"></span><button data-close>${T('关闭','Close')}</button></footer>`;
  const el = selector => dialog.querySelector(selector);
  const status = el('[data-status]'), list = el('[data-list]'), detail = el('[data-detail]');
  function button(label, click) {
    const b = document.createElement('button');
    b.textContent = label; b.onclick = click; return b;
  }
  let before = null, epoch = 0;
  async function select(row) {
    const turn = ++epoch;
    detail.replaceChildren(); status.textContent = '';
    const forget = button(T('移除恢复记录…', 'Remove recovery record…'), () => {
      const confirm = button(T('确认移除记录', 'Confirm removal'), async () => {
        confirm.disabled = true;
        try { await invoke('ssh_batch_forget',{batchId:row.id,revision:row.revision}); await refresh(); }
        catch (error) { status.textContent = String(error); confirm.disabled = false; }
      });
      forget.replaceWith(confirm);
    });
    if (!row.peer) {
      if (row.revision) detail.append(forget);
      else status.textContent = T('无法读取此记录。请检查应用数据目录的访问权限。', 'The record is unreadable. Check access to the application data folder.');
      return;
    }
    try {
      const reviewed = await invoke('ssh_batch_review', {batchId:row.id, revision:row.revision});
      if (turn !== epoch || !dialog.open) return;
      const target = document.createElement('p');
      target.className = 'ssh-task-path';
      target.textContent = row.destination + ' · ' + row.peer.fingerprint;
      const files = document.createElement('ul'); files.className = 'ssh-batch-files';
      for (const file of reviewed.files) {
        const li = document.createElement('li'), name = document.createElement('strong'), path = document.createElement('small');
        name.textContent = file.name; path.textContent = file.localPath + ' ⇄ ' + file.remote;
        li.append(name, path); files.append(li);
      }
      const review = button(T('核对并加入队列…', 'Review and queue…'), () => {
        const tb = sshRecoveryConnection(row.peer);
        if (!tb) {status.textContent = T('请使用原账户登录并核对主机指纹，再打开此批次。', 'Sign in with the original account and verified host key, then reopen this batch.'); return;}
        dialog.close();
        showSshBatchReview(tb, reviewed.files, row.direction, row.destination, null, row);
      });
      detail.append(target, files, review, forget);
    } catch (error) { if (turn === epoch) status.textContent = String(error); }
  }
  async function refresh(more = false) {
    const turn = ++epoch;
    detail.replaceChildren(); status.textContent = '';
    if (!more) {list.replaceChildren(); before = null;}
    el('[data-more]').disabled = true;
    try {
      const page = await invoke('ssh_batch_list', {before});
      if (turn !== epoch || !dialog.open) return;
      for (const row of page.rows) {
        const label = row.peer ? `${row.peer.user}@${row.peer.host}:${row.peer.port} · ${T(row.direction === 'upload' ? '上传' : '下载', row.direction === 'upload' ? 'Upload' : 'Download')} · ${row.pending} ${T('项未开始','pending')} · ${row.started} ${T('项已启动','started')} · ${row.destination}` :
          T('记录不完整，需核对工作区历史', 'Incomplete record. Check workspace history');
        const b = button(label, () => select(row)); b.dataset.recoveryId = row.id; list.append(b);
      }
      before = page.next; el('[data-more]').hidden = !before;
      if (!list.children.length) status.textContent = T('当前没有可恢复的批次。', 'No recoverable batches on this page.');
    } catch (error) { if (turn === epoch) status.textContent = String(error); }
    finally { el('[data-more]').disabled = false; }
  }
  el('[data-refresh]').onclick = () => refresh();
  el('[data-more]').onclick = () => refresh(true);
  dialog.querySelectorAll('[data-close]').forEach(b => b.onclick = () => dialog.close());
  dialog.addEventListener('close', () => {epoch++; dialog.remove();}, {once:true});
  document.body.append(dialog); dialog.showModal(); void refresh();
}
