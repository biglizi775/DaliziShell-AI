'use strict';
async function openHarnessEngine(){
  if($('harnessEngineDialog'))return;
  const t=projectText,d=document.createElement('dialog');d.id='harnessEngineDialog';d.className='document-review harness-tasks';
  d.setAttribute('aria-labelledby','harnessEngineTitle');
  d.innerHTML=`<header><h2 id="harnessEngineTitle">${t('Agent 引擎','Agent engine')}</h2><button type="button" class="ai-secondary" data-close>${t('关闭','Close')}</button></header>
    <div class="harness-scroll"><p>${t('Harness 用于单独的文件、网页引用和远程快照任务。原有聊天继续使用原引擎。','Harness runs separate file, web quote and remote snapshot tasks. Existing chats keep their original engine.')}</p>
    <strong data-state></strong><p data-message></p><small data-id></small>
    <p>${t('停用后不再接收新任务，已发送的问答可完成。未批准的修改提案和待发送的预览会失效。','Disabling blocks new tasks. Submitted questions can finish; pending previews and unapproved edits expire.')}</p>
    <button type="button" class="ai-primary" data-toggle disabled></button> <button type="button" class="ai-secondary" data-check>${t('检查组件','Check component')}</button>
    <button type="button" class="ai-secondary" data-diag>${t('预览诊断报告','Preview diagnostics')}</button>
    <section data-report hidden><p>${t('以下为将导出的完整内容。','This is the complete report that will be exported.')}</p><pre></pre>
    <button type="button" class="ai-secondary" data-save>${t('将此报告另存为…','Save this report as…')}</button></section></div><footer role="status" aria-live="polite"></footer>`;
  document.body.append(d);const el=s=>d.querySelector(s);let current=null,preview=null,busy=false;
  function controls(){
    for(const b of d.querySelectorAll('button:not([data-close])'))b.disabled=busy;
    const unsupported=current?.source==='unsupported-architecture';
    el('[data-toggle]').disabled=busy||!current||unsupported;
    el('[data-check]').disabled=busy||unsupported;
  }
  function draw(v){current=v;el('[data-state]').textContent=v.source==='unsupported-architecture'
    ?t('当前架构无可用 Harness 组件','Harness is unavailable for this architecture')
    :v.enabled?t('Harness 已启用','Harness enabled'):t('Harness 已停用','Harness disabled');
    el('[data-message]').textContent=v.message;el('[data-id]').textContent=v.component;
    el('[data-toggle]').textContent=v.enabled?t('停用 Harness','Disable Harness'):t('检查并启用 Harness','Check and enable Harness');controls();}
  async function run(fn){if(busy)return;busy=true;controls();el('footer').textContent='';try{await fn();}
    catch(e){el('footer').textContent=String(e);}finally{busy=false;controls();}}
  const hideReport=()=>{preview=null;el('[data-report]').hidden=true;el('pre').textContent='';};
  el('[data-toggle]').onclick=()=>run(async()=>{hideReport();draw(await invoke('harness_engine_set',{enabled:!current.enabled}));});
  el('[data-check]').onclick=()=>run(async()=>{hideReport();draw(await invoke('harness_engine_check'));el('footer').textContent=t('检查通过。','Check passed.');});
  el('[data-diag]').onclick=()=>run(async()=>{preview=await invoke('harness_diag_preview');el('pre').textContent=preview.text;el('[data-report]').hidden=false;});
  el('[data-save]').onclick=()=>run(async()=>{if(!preview)return;const id=preview.id;const saved=await invoke('harness_diag_save',{id});hideReport();el('footer').textContent=saved?t('报告已保存。','Report saved.'):t('已取消保存。','Save cancelled.');});
  el('[data-close]').onclick=()=>d.close();d.onclose=()=>{d.remove();void syncBrowserBounds();};d.showModal();void syncBrowserBounds();
  await run(async()=>draw(await invoke('harness_engine_status')));
}
