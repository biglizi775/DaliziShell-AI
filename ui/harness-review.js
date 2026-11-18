'use strict';

const harnessRevocations = new Map();
const harnessEditModes = new Map();
function setHarnessEditMode(root,permissionMode) {
  const key = aiKey(root), previous=harnessRevocations.get(key);
  harnessEditModes.set(key,permissionMode);
  // Preserve UI event order even if the old permission-change IPC has not finished.
  const pending=Promise.resolve(previous).catch(()=>{}).then(()=>invoke('harness_set_edit_mode',{root,permissionMode}));
  harnessRevocations.set(key,pending);
  pending.then(()=>{ if(harnessRevocations.get(key)===pending) harnessRevocations.delete(key); },
    error=>toast(String(error),true));
  return pending;
}
async function harnessEditAccess(root) {
  const key=aiKey(root);
  try { await harnessRevocations.get(key); }
  catch { await setHarnessEditMode(root,harnessEditModes.get(key)); }
  if (!harnessCanReview(root)) throw Error(projectText('请回到此本地目录，并选择「确认后执行」。','Return to this local directory and choose Ask before changes.'));
  return {root,permissionMode:'confirm'};
}
function harnessCanReview(root) {
  const session=aiCurrentSession(), tab=curTab();
  return !!(root && (harnessEditModes.get(aiKey(root)) || 'confirm')==='confirm' && session?.permissionMode==='confirm' && aiTabIsActive(session) && tab && tab.kind!=='browser' && !isTermTab(tab)
    && !state.loading && aiKey(state.path)===aiKey(root) && aiKey(session.root)===aiKey(root));
}

function confirmHarnessAction(parent,title,description,action) {
  if (!parent.open || $('harnessConfirmDialog')) return Promise.resolve(false);
  const dialog=document.createElement('dialog');dialog.className='document-review harness-confirm';dialog.id='harnessConfirmDialog';
  dialog.setAttribute('aria-labelledby','harnessConfirmTitle');
  dialog.innerHTML='<header><h2 id="harnessConfirmTitle"></h2></header><p class="review-summary"></p><footer><button class="ai-secondary" data-cancel></button><button class="ai-primary" data-confirm></button></footer>';
  dialog.querySelector('h2').textContent=title;dialog.querySelector('p').textContent=description;
  const cancel=dialog.querySelector('[data-cancel]'),confirm=dialog.querySelector('[data-confirm]');
  cancel.textContent=projectText('取消','Cancel');confirm.textContent=action;
  return new Promise(resolve=>{
    dialog.onclose=()=>{const ok=parent.open && dialog.returnValue==='confirm';dialog.remove();resolve(ok);};
    cancel.onclick=()=>dialog.close();confirm.onclick=()=>dialog.close('confirm');
    document.body.append(dialog);dialog.showModal();cancel.focus();
  });
}

async function openHarnessReview(row, parent, refresh, stillInView) {
  const t=projectText, id=row.id, root=row.workspace.path;
  const p=await invoke('harness_get_review',{id,...await harnessEditAccess(root)});
  if (!parent.open || !stillInView() || !harnessCanReview(root) || $('harnessReviewDialog')) return;
  const dialog=document.createElement('dialog'); dialog.className='document-review'; dialog.id='harnessReviewDialog';
  dialog.setAttribute('aria-labelledby','harnessReviewName');
  dialog.innerHTML=`<header><div><small>${t('文件任务 · 待确认','File task · Pending review')}</small><h2 id="harnessReviewName">${esc(p.target)}</h2></div></header>
    <div class="review-location"><strong>${t('目标目录','Target folder')}</strong><span>${esc(root)}</span></div>
    ${documentDiffHtml(p.original,p.replacement,t)}
    <footer><small role="status"></small><button class="ai-secondary" data-close>${t('返回任务','Back to tasks')}</button>
    <button class="ai-primary" data-apply>${t('确认写入此文件','Apply to this file')}</button></footer>`;
  const apply=dialog.querySelector('[data-apply]'), close=dialog.querySelector('[data-close]');
  close.onclick=()=>dialog.close();
  apply.onclick=async()=>{
    if (apply.disabled) return;
    apply.disabled=true;
    try {
      const access=await harnessEditAccess(root);
      if (!stillInView()) throw Error(t('任务列表已变化，请返回并重新审阅。','Task history changed. Return to the list and review again.'));
      await invoke('harness_apply_review',{id,token:p.token,...access});
      dialog.close();
    } catch(e) {
      dialog.querySelector('[role=status]').textContent=String(e);
    } finally { await refresh(); }
  };
  dialog.onclose=()=>dialog.remove();
  document.body.append(dialog);dialog.showModal();close.focus();
}
