'use strict';

function relativeReviewPath(session, path) {
  if (!session || !aiKey(path).startsWith(aiKey(session.root) + '\\')) return '';
  return path.slice(session.root.replace(/[\\/]+$/, '').length + 1);
}

function startDocumentEdit(path) {
  openAiAssistant();
  const session = aiCurrentSession(), relative = relativeReviewPath(session, path);
  if (!relative) return toast(projectText('文件位于其他项目。请先在「切换项目」中选择跟随当前标签目录。', 'Choose Follow current tab in Projects to edit this file.'), true);
  if (session.running || session.requestId || session.restoring) return toast(projectText('请先完成或停止当前任务。','Finish or stop the current task first.'),true);
  if (session.permissionMode === 'read-only') return toast(projectText('当前为只读。请先切换到「确认后执行」。','Switch from read-only to Ask before changes first.'),true);
  discardSessionPlans(session);
  session.projectTools = true; session.includeSelection = true; session.editReference = relative;
  if (!$('aiPrompt').value.trim()) {
    session.draft = projectText('请修改「' + relative + '」：','Please revise ' + relative + ': ');
    $('aiPrompt').value = session.draft;
  }
  syncAiWorkspace(); $('aiPrompt').focus();
}

// Common lines keep their numbers in both columns. Bound LCS work on long files.
function reviewLines(original, proposed) {
  const lines = text => text.replace(/^\uFEFF/, '').replace(/\r\n/g,'\n').split('\n');
  const a = lines(original), b = lines(proposed);
  let start = 0, end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (end < Math.min(a.length,b.length)-start && a[a.length-1-end] === b[b.length-1-end]) end++;
  const n = a.length-start-end, m = b.length-start-end;
  if (n*m > 450000 || Math.max(a.length,b.length)>1500) return null;
  const cols = m+1, lengths = new Uint16Array((n+1)*cols);
  for (let i=n-1;i>=0;i--) for(let j=m-1;j>=0;j--) {
    lengths[i*cols+j] = a[start+i] === b[start+j] ? 1+lengths[(i+1)*cols+j+1] : Math.max(lengths[(i+1)*cols+j],lengths[i*cols+j+1]);
  }
  const rows = []; let removed = [], added = [], i = start, j = start;
  const flush = () => {
    for(let k=0;k<Math.max(removed.length,added.length);k++) rows.push([removed[k],added[k],true]);
    removed=[]; added=[];
  };
  for(let k=0;k<start;k++) rows.push([[k+1,a[k]],[k+1,b[k]],false]);
  while(i<a.length-end || j<b.length-end) {
    if(i<a.length-end && j<b.length-end && a[i]===b[j]) {
      flush(); rows.push([[i+1,a[i]],[j+1,b[j]],false]); i++; j++;
    } else if(j===b.length-end || (i<a.length-end && lengths[(i-start+1)*cols+j-start]>=lengths[(i-start)*cols+j-start+1])) {
      removed.push([i+1,a[i++]]);
    } else { added.push([j+1,b[j++]]); }
  }
  flush();
  for(let k=0;k<end;k++) rows.push([[i+1+k,a[i+k]],[j+1+k,b[j+k]],false]);
  return rows;
}

function changedText(text, other) {
  if (other == null) return esc(text);
  const a = Array.from(text), b = Array.from(other);
  let left = 0, right = 0;
  while (left < Math.min(a.length,b.length) && a[left] === b[left]) left++;
  while (right < Math.min(a.length,b.length)-left && a[a.length-right-1] === b[b.length-right-1]) right++;
  const middle = a.slice(left,a.length-right).join('');
  return esc(a.slice(0,left).join('')) + (middle ? '<mark>'+esc(middle)+'</mark>' : '') + esc(a.slice(a.length-right).join(''));
}

function documentDiffHtml(original, proposed, t) {
  const rows = reviewLines(original, proposed);
  const renderCell = (line, type, peer) => line ? `<div class="diff-cell ${type}"><small>${line[0]}</small><b aria-hidden="true">${type==='removed'?'−':type==='added'?'+':''}</b><span>${type ? changedText(line[1],peer?.[1]) : esc(line[1])}</span></div>` : '<div class="diff-cell gap"></div>';
  return `<div class="diff-head"><strong>${t('原文','Original')} <small>− ${t('删除','Removed')}</small></strong><strong>${t('建议稿','Proposed')} <small>+ ${t('新增','Added')}</small></strong></div>
    <div class="diff-scroll" tabindex="0" aria-label="${t('逐行对照','Line comparison')}">${rows ? rows.map(([l,r,change])=>`<div class="diff-row">${renderCell(l,change?'removed':'',r)}${renderCell(r,change?'added':'',l)}</div>`).join('') : `<div class="diff-row"><pre>${esc(original)}</pre><pre>${esc(proposed)}</pre></div>`}</div>`;
}

function openDocumentReview(messageId) {
  const session = aiCurrentSession(), message = session?.messages.find(m => m.id === messageId);
  const action = message?.plan?.actions[0], t = projectText;
  if (action?.kind !== 'edit_text' || !['pending','done'].includes(message.planState)) return;
  const applied = message.planState === 'done';
  const dialog = document.createElement('dialog'); dialog.className = 'document-review';
  dialog.setAttribute('aria-labelledby','documentReviewName');
  dialog.innerHTML = `<header><div><small>${t('文档审阅 · 待确认','Document review · Pending')}</small><h2 id="documentReviewName">${esc(basename(action.target))}</h2></div><button type="button" class="ibtn" data-close aria-label="${t('关闭','Close')}">×</button></header>
    <div class="review-location"><strong>${t('目标文件','Target file')}</strong><span>${esc(action.target)}</span></div>
    <p class="review-summary">${esc(message.text)}</p>
    ${documentDiffHtml(action.original, action.content, t)}
    <footer><small>${t('保存后可撤销本次修改','You can undo this edit after saving')}</small><button class="ai-secondary" data-close>${t('返回对话','Back to chat')}</button><button class="ai-primary" data-apply>${t('确认写入','Apply changes')}</button></footer>`;
  if (applied) {
    dialog.querySelector('header small').textContent = t('已执行的修改','Applied edit');
    dialog.querySelector('footer small').textContent = t('显示执行时的两个版本','Versions at the time of the edit');
    dialog.querySelector('[data-apply]').remove();
  }
  dialog.querySelectorAll('[data-close]').forEach(el=>el.onclick=()=>dialog.close());
  if (!applied) dialog.querySelector('[data-apply]').onclick=()=>{
    if (aiCurrentSession() !== session || message.planState !== 'pending' || !aiPlanModeMatches(session, message.plan, true)) { dialog.close(); return; }
    dialog.close(); void executeAiPlan(messageId,false,true);
  };
  dialog.onclose=()=>dialog.remove(); document.body.append(dialog); dialog.showModal(); dialog.querySelector('[data-close]').focus();
}

async function undoProjectDocument(path, expectedVersion = null) {
  const session = aiCurrentSession(), target = relativeReviewPath(session,path);
  if (!target || session.permissionMode === 'read-only') {
    toast(projectText('请在此文件所属项目的可写模式中撤销。','Open this project with write permission to undo.'),true); return false;
  }
  if (aiAnyExecution()) {
    toast(projectText('请等待当前文件操作完成。','Wait for the current file operation to finish.'),true); return false;
  }
  session.running = true; updateAiComposer();
  try {
    const receipt = await invoke('ai_undo_document',{root:session.root,target,expectedVersion,permissionMode:session.permissionMode,withReceipt:true});
    const note = reportDocumentReceipt(session,receipt,projectText('已撤销修改　','Edit undone　')+target);
    if (aiCurrentSession() === session) toast(note,!!(receipt.error || receipt.journalWarning));
    return !receipt.error;
  } catch(error) { toast(String(error),true); return false; }
  finally { session.running=false; session.revision++; renderAiConversation(); updateAiComposer(); }
}

async function undoDocumentResult(messageId) {
  const session=aiCurrentSession(), message=session?.messages.find(m=>m.id===messageId);
  const action=message?.results?.find(r=>r.kind==='edit_text' && r.status==='success');
  if (action && await undoProjectDocument(action.target,action.editVersion)) {
    message.undone=true; session.revision++; renderAiConversation();
  }
}
