'use strict';

function quoteDestinations() {
  const roots=[aiProjectRoot,...aiProjectList().map(p=>p.root),
    ...state.tabs.filter(tb=>!isBrowserTab(tb)&&!isTermTab(tb)).map(tb=>tb.path)];
  const map=new Map();for(const root of roots)if(typeof root==='string' && /^[a-z]:[\\/]/i.test(root))map.set(aiKey(root),root);
  return [...map.values()];
}

async function openWebQuote(id) {
  const t=projectText;
  if ($('webQuoteDialog')) {
    await invoke('harness_quote_discard',{id});
    throw Error(t('先完成或关闭已有的网页引用预览。','Finish or close the existing quote first.'));
  }
  const dialog=document.createElement('dialog');dialog.id='webQuoteDialog';dialog.className='document-review harness-tasks';
  dialog.setAttribute('aria-labelledby','webQuoteTitle');
  dialog.innerHTML=`<header><h2 id="webQuoteTitle">${t('引用网页选区到项目','Quote web selection to a project')}</h2><button class="ai-secondary" data-close>${t('关闭','Close')}</button></header>
    <div class="harness-scroll"><p data-source></p><small data-time></small><pre data-quote></pre>
    <label>${t('保存问答的项目','Project for this question and answer')} <select data-project><option value="">${t('请选择本地目录','Choose a local folder')}</option></select></label>
    <button class="ai-secondary" data-pick>${t('选择其他目录…','Choose another folder…')}</button>
    <button class="ai-secondary" data-preview>${t('核对目标和模型','Review destination and model')}</button>
    <form hidden><p data-target></p><p data-route></p><label>${t('关于这段引用，你想了解什么？','What would you like to know about this quote?')}
    <textarea name="question" required maxlength="4000" rows="3"></textarea></label>
    <button class="ai-primary">${t('发送选区和问题','Send quote and question')}</button></form></div>
    <footer role="status" aria-live="polite"></footer>`;
  document.body.append(dialog);
  const el=s=>dialog.querySelector(s), form=el('form'), select=el('select'), preview=el('[data-preview]'), pick=el('[data-pick]');
  const status=msg=>{el('footer').textContent=msg;};
  let draft=null,key='',busy=false,sent=false,loaded=false;
  const add=root=>{if(![...select.options].some(o=>o.value===root))select.add(new Option(root,root));};
  for(const root of quoteDestinations())add(root);
  function controls(){select.disabled=pick.disabled=!loaded||busy||sent; preview.disabled=!loaded||busy||sent||!select.value;form.querySelector('button').disabled=!draft||busy||sent;form.elements.question.readOnly=busy||sent;}
  select.onchange=()=>{const previous=draft;draft=null;key='';form.hidden=true;status('');controls();void discardHarnessPreview(previous).catch(e=>status(String(e)));};
  dialog.onclose=()=>{key='';draft=null;dialog.remove();void syncBrowserBounds();if(!sent)invoke('harness_quote_discard',{id}).catch(e=>toast(String(e),true));};
  el('[data-close]').onclick=()=>dialog.close();dialog.oncancel=e=>{if(busy)e.preventDefault();};
  pick.onclick=async()=>{busy=true;controls();try{const root=await invoke('agent_pick_project');if(root&&dialog.open){add(root);select.value=root;select.onchange();}}
    catch(e){status(String(e));}finally{busy=false;controls();}};
  preview.onclick=async()=>{
    const previous=draft;draft=null;key='';form.hidden=true;busy=true;controls();status('');
    try{
      await discardHarnessPreview(previous);if(!dialog.open)return;
      const settings={endpoint:aiSettings.endpoint,model:aiSettings.model,apiFormat:aiFormatOf(aiSettings)};
      key=aiSessionKey||'';
      const value=await invoke('harness_prepare_web',{id,root:select.value,...settings});
      if(!dialog.open)return;
      draft=value;
      el('[data-source]').textContent=value.web.source.url;el('[data-quote]').textContent=value.web.text;
      el('[data-target]').textContent=t('任务归属：','Task folder: ')+value.snapshot.workspace.path;
      el('[data-route]').textContent=t('发送到：','Send to: ')+value.endpoint+' · '+value.model;
      form.hidden=false;form.elements.question.focus();
    }catch(e){status(String(e));}finally{busy=false;controls();}
  };
  form.onsubmit=async event=>{
    event.preventDefault();const question=form.elements.question.value.trim();
    if(!draft||!question||busy||sent)return;
    busy=true;controls();el('[data-close]').disabled=true;
    try{
      await invoke('harness_submit',{id:draft.id,question,apiKey:key});sent=true;form.hidden=true;
      status(t('已提交。请在此目录的「文件任务 → 任务记录」查看回答：','Submitted. Open File tasks in this folder to find the answer: ')+draft.snapshot.workspace.path);
      key='';draft=null;
    }catch(e){status(String(e));}finally{busy=false;controls();el('[data-close]').disabled=false;}
  };
  dialog.showModal();controls();void syncBrowserBounds();
  try {const q=await invoke('harness_quote_preview',{id});if(dialog.open){el('[data-source]').textContent=q.source.url;el('[data-time]').textContent=t('采集时间：','Captured: ')+new Date(q.source.capturedAt).toLocaleString();el('[data-quote]').textContent=q.text;loaded=true;controls();}}
  catch(e){status(String(e));controls();}
}

listen('browser-quote',({payload:id})=>{void openWebQuote(id).catch(e=>toast(String(e),true));},{target:'main'}).catch(e=>toast(String(e),true));
listen('browser-quote-error',({payload})=>toast(String(payload),true),{target:'main'}).catch(()=>{});
