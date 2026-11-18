'use strict';

const sshLocalPageSize = 100;

function setSshPairedLayout(tb, open) {
  const view = tb.sshFiles, panel = tb.sshFilesPanel;
  if (!view || (!open && !view.localPane)) return;
  const local = view.localPane || mountSshLocalPane(tb);
  local.open = open;
  panel.classList.toggle('ssh-paired', open);
  local.panel.hidden = !open;
  local.more.hidden = !open;
  local.more.open = false;
  for (const preview of Object.values(local.previews)) {
    preview.button.hidden = !open;
    if (!open) clearSshPanePreview(preview);
  }
  for (const [control,place] of local.extraControls) {
    if (open) local.more.lastElementChild.append(control);
    else place.after(control);
  }
  if (open && local.path && !local.loading) void loadSshLocalFolder(tb, local.path, true);
  else updateSshTransferControls(tb);
}

function mountSshLocalPane(tb) {
  const view = tb.sshFiles, host = tb.sshFilesPanel;
  const body = document.createElement('div'), remote = document.createElement('div'), panel = document.createElement('section');
  body.className = 'ssh-file-panes'; remote.className = 'ssh-remote-pane'; panel.className = 'ssh-local-pane';
  const transfer = host.querySelector('.ssh-transfer-status');
  for (const node of [...host.children]) if (node !== transfer) remote.append(node);
  body.append(panel,remote); host.insertBefore(body,transfer);
  const T = ms;
  panel.setAttribute('aria-label', T('本地文件','Local files'));
  panel.innerHTML = `<div class="ssh-files-heading"><strong>${T('本地文件','Local files')}</strong><input data-local-filter type="search" aria-label="${T('筛选本地文件','Filter local files')}" placeholder="${T('筛选本地文件','Filter local files')}"></div>
    <form class="ssh-files-toolbar"><button type="button" data-local-up aria-label="${T('本地上一级','Local parent folder')}">↑</button><input data-local-path spellcheck="false" aria-label="${T('本地目录路径','Local folder path')}" placeholder="${T('输入本地目录','Enter a local folder')}"><button>${T('前往','Go')}</button><button type="button" data-local-choose>${T('选择目录…','Choose folder…')}</button></form>
    <div class="ssh-files-actions"><button data-local-refresh>${T('刷新','Refresh')}</button><button data-local-upload>${T('上传选中项 →','Upload selection →')}</button></div>
    <p data-local-status class="ssh-local-status" role="status"></p><div data-local-list aria-label="${T('本地文件','Local files')}" role="listbox" aria-multiselectable="true" tabindex="0"></div>
    <nav data-local-pages hidden><button data-local-prev>${T('上一页','Previous')}</button><span></span><button data-local-next>${T('下一页','Next')}</button></nav>`;
  const find = s => panel.querySelector(s);
  const more=document.createElement('details'); more.className='ssh-paired-more'; more.hidden=true;
  more.innerHTML=`<summary>${T('更多','More')}</summary><div></div>`;
  remote.querySelector('.ssh-files-heading').append(more);
  const extraControls=[...remote.querySelectorAll('[data-tasks], [data-remote-history], [data-remote-ask], [data-root], [data-home], [data-remote-copy], [data-select-files]')].map(control=>{
    const place=document.createComment('remote control'); control.before(place); return [control,place];
  });
  more.addEventListener('click',e=>{if(e.target.closest('button')) more.open=false;});
  more.addEventListener('keydown',e=>{if(e.key==='Escape'){more.open=false; more.firstElementChild.focus();}});
  more.addEventListener('focusout',e=>{if(!more.contains(e.relatedTarget)) more.open=false;});
  const local = view.localPane = {panel, more, extraControls, open:false, path:'', entries:[], visible:[], selection:new Set(), anchor:null, generation:0, page:0, ready:false, loading:false, error:''};
  local.previews = {local:mountSshPanePreview(tb,panel,'local'),remote:mountSshPanePreview(tb,remote,'remote')};
  const folderTab=document.createElement('button'); folderTab.type='button'; folderTab.dataset.localWorkspace='';
  folderTab.textContent=T('文件标签 ↗','Folder tab ↗');
  folderTab.title=T('在独立文件标签打开此目录，可在该目录使用 Agent','Open a local file tab to work with Agent in this folder');
  folderTab.onclick=()=>{if(local.ready && !local.loading) newTab(local.path);};
  find('.ssh-files-actions').append(folderTab);
  find('form').onsubmit = e => {e.preventDefault(); void loadSshLocalFolder(tb,find('[data-local-path]').value);};
  find('[data-local-path]').oninput = () => updateSshTransferControls(tb);
  remote.querySelector('[data-path]').addEventListener('input', () => {if (local.open) updateSshTransferControls(tb);});
  find('[data-local-up]').onclick = () => {const parent=parentOf(local.path); if (parent) void loadSshLocalFolder(tb,parent);};
  find('[data-local-refresh]').onclick = () => loadSshLocalFolder(tb,local.path,true);
  find('[data-local-choose]').onclick = async event => {
    const button = event.currentTarget, generation = local.generation;
    button.disabled = true;
    try {
      const path = await invoke('ssh_pick_download_directory',{directory:local.ready ? local.path : null});
      if (path && tb.sshFiles === view && curTab() === tb && local.open && !tb.exited && !tb.disposed && !tb.sshDisconnectRequested && local.generation === generation) await loadSshLocalFolder(tb,path);
    } catch (error) { if (tb.sshFiles === view && curTab() === tb) toast(String(error),true); }
    finally {button.disabled = false;}
  };
  find('[data-local-filter]').oninput = () => {
    local.selection.clear(); local.anchor = null; local.page = 0;
    renderSshLocalFiles(tb);
  };
  find('[data-local-prev]').onclick = () => {local.page--; renderSshLocalPage(tb);};
  find('[data-local-next]').onclick = () => {local.page++; renderSshLocalPage(tb);};
  find('[data-local-upload]').onclick = () => beginSshBatch(tb,'upload');
  panel.addEventListener('keydown', e => {
    // Remote path shortcuts and terminal input belong to their own panes.
    e.stopPropagation();
    if (e.ctrlKey && e.key.toLowerCase() === 'l') {e.preventDefault(); find('[data-local-path]').focus(); find('[data-local-path]').select();}
    else if (e.key === 'F5' && local.path) {e.preventDefault(); void loadSshLocalFolder(tb,local.path,true);}
    else if (e.ctrlKey && e.key.toLowerCase() === 'a' && e.target.closest('[data-local-list]')) {
      e.preventDefault(); const choices = local.visible.filter(x=>!x.isReparse);
      local.selection = new Set(choices.slice(0,200).map(x=>x.name));
      if (choices.length>200) toast(ms('已选择前 200 个项目。','Selected the first 200 entries.'));
      local.anchor = null; paintSshLocalSelection(tb);
    }
  });
  renderSshLocalFiles(tb);
  return local;
}

async function loadSshLocalFolder(tb,value,preserve=false) {
  const view=tb.sshFiles, local=view?.localPane;
  if (!local?.open || tb.disposed || tb.exited || tb.sshDisconnectRequested || !value) return;
  const path=normalizeNavigationPath(value.replaceAll('/','\\'));
  const same=path===local.path, generation=++local.generation;
  const keep=preserve && same ? new Set(local.selection) : new Set();
  local.path=path; local.ready=false; local.loading=true; local.error=''; local.selection.clear(); local.anchor=null;
  if (!same) {local.entries=[]; local.page=0; local.panel.querySelector('[data-local-filter]').value='';}
  local.panel.querySelector('[data-local-path]').value=path;
  local.panel.querySelector('[data-local-path]').title=path;
  renderSshLocalFiles(tb);
  try {
    if (!/^(?:[a-z]:\\|\\\\(?![.?]\\)[^\\]+\\[^\\]+)/i.test(path)) throw new Error(ms('请输入绝对目录路径。','Enter an absolute folder path.'));
    const entries = await invoke('list_dir',{path});
    if (tb.sshFiles!==view || local.generation!==generation || tb.disposed || tb.exited || tb.sshDisconnectRequested) return;
    const order=new Intl.Collator(locale,{numeric:true,sensitivity:'base'});
    local.entries=entries.slice().sort((a,b)=>Number(b.isDir)-Number(a.isDir) || order.compare(a.name,b.name));
    local.selection=new Set(local.entries.filter(e=>keep.has(e.name) && !e.isReparse).map(e=>e.name));
    local.ready=true;
  } catch (error) {
    if (tb.sshFiles!==view || local.generation!==generation) return;
    local.entries=[]; local.error=String(error);
  } finally {
    if (tb.sshFiles===view && local.generation===generation) {local.loading=false; renderSshLocalFiles(tb);}
  }
}

function renderSshLocalFiles(tb) {
  const local=tb.sshFiles.localPane;
  const term=local.panel.querySelector('[data-local-filter]').value.toLocaleLowerCase();
  local.visible=term ? local.entries.filter(e=>e.name.toLocaleLowerCase().includes(term)) : local.entries;
  renderSshLocalPage(tb);
}

function renderSshLocalPage(tb) {
  const local=tb.sshFiles.localPane, list=local.panel.querySelector('[data-local-list]');
  const pages=Math.max(1,Math.ceil(local.visible.length/sshLocalPageSize));
  local.page=Math.max(0,Math.min(local.page,pages-1));
  const start=local.page*sshLocalPageSize;
  const rows=document.createDocumentFragment();
  for (const entry of local.visible.slice(start,start+sshLocalPageSize)) {
    const row=document.createElement('button'); row.type='button'; row.dataset.localName=entry.name; row.setAttribute('role','option');
    const icon=document.createElement('span'), name=document.createElement('span'), size=document.createElement('small');
    icon.textContent=entry.isReparse?'↗':entry.isDir?'📁':'▤'; name.textContent=entry.name; size.textContent=entry.isDir?'':sshSize(entry.size);
    row.title=entry.isReparse ? ms('链接或目录联接','Link or junction')+' · '+entry.name : entry.name;
    row.disabled=entry.isReparse || !local.ready;
    row.append(icon,name,size); rows.append(row);
    row.onclick=e=>{
      const keys=e.shiftKey ? local.visible.filter(x=>!x.isReparse).map(x=>x.name) : [entry.name];
      local.anchor=selectSshRange(local.selection,keys,entry.name,local.anchor,e); paintSshLocalSelection(tb);
    };
    const enter=()=>{if (entry.isDir && local.ready) void loadSshLocalFolder(tb,join(local.path,entry.name));};
    row.ondblclick=enter;
    row.onkeydown=e=>{if(e.key==='Enter' && entry.isDir){e.preventDefault();enter();}};
  }
  list.replaceChildren(rows); list.scrollTop=0;
  const nav=local.panel.querySelector('[data-local-pages]'); nav.hidden=pages===1;
  nav.querySelector('span').textContent=`${local.page+1} / ${pages}`; nav.querySelector('[data-local-prev]').disabled=!local.page; nav.querySelector('[data-local-next]').disabled=local.page+1===pages;
  paintSshLocalSelection(tb);
}

function paintSshLocalSelection(tb) {
  const local=tb.sshFiles.localPane, panel=local.panel, T=ms;
  for (const row of panel.querySelectorAll('[data-local-name]')) row.setAttribute('aria-selected',String(local.selection.has(row.dataset.localName)));
  const status=panel.querySelector('[data-local-status]');
  status.textContent=local.loading ? T('读取目录…','Loading folder…') : local.error || (local.path ? local.visible.length+' '+T('项','items')+' · '+local.selection.size+' '+T('已选','selected') : T('选择本地目录后即可传输。','Choose a local folder to transfer files.'));
  status.classList.toggle('is-error',!!local.error);
  const parent=parentOf(local.path);
  panel.querySelector('[data-local-up]').disabled=!parent || /^\\\\[^\\]+$/.test(parent) || local.loading;
  panel.querySelector('[data-local-refresh]').disabled=!local.path || local.loading;
  updateSshTransferControls(tb);
}

function sshPairedPathsReady(tb) {
  const view=tb.sshFiles, local=view.localPane;
  return local.ready && !local.loading && local.panel.querySelector('[data-local-path]').value===local.path &&
    tb.sshFilesPanel.querySelector('[data-path]').value===view.path;
}

function updateSshPairedControls(tb,busy,count) {
  const local=tb.sshFiles.localPane, panel=tb.sshFilesPanel;
  const disabled=busy || !sshPairedPathsReady(tb);
  const upload=local.panel.querySelector('[data-local-upload]');
  upload.disabled=disabled || !local.selection.size;
  const download=panel.querySelector('[data-download]');
  download.disabled=disabled || !count;
  download.textContent=ms('← 下载到本地','← Download here')+(count ? ` (${count})` : '');
  local.panel.querySelector('[data-local-workspace]').disabled=!local.ready || local.loading || local.panel.querySelector('[data-local-path]').value!==local.path;
  for (const side of ['local','remote']) syncSshPanePreview(tb,side);
}

function mountSshPanePreview(tb,container,side) {
  const button=document.createElement('button'); button.type='button'; button.disabled=true; button.dataset.panePreview=side;
  button.textContent=ms('预览文本','Preview text');
  container.querySelector('.ssh-files-actions').append(button);
  const box=document.createElement('section'); box.className='ssh-pane-preview'; box.hidden=true; box.dataset.previewSide=side;
  const title=document.createElement('strong'),close=document.createElement('button'),body=document.createElement('pre');
  close.type='button';close.textContent='×';close.setAttribute('aria-label',ms('关闭此侧预览','Close this preview'));
  body.setAttribute('role','status');box.append(title,close,body);container.append(box);
  const preview={button,box,title,body,scope:null,request:0,reading:false};
  close.onclick=()=>{clearSshPanePreview(preview);button.focus();};
  button.onclick=async()=>{
    const scope=preview.scope,view=tb.sshFiles;
    if(!scope || button.disabled)return;
    const request=++preview.request;
    preview.reading=true;button.disabled=true;
    box.hidden=false;title.textContent=scope.name;body.textContent=ms('读取中…','Reading…');
    const current=()=>request===preview.request && tb.sshFiles===view && view.localPane.open && !tb.disposed && !tb.exited && !tb.sshDisconnectRequested;
    try{
      const result=await invoke('ssh_pane_preview',{id:tb.termId,side,directory:scope.path,name:scope.name});
      if(!current())return;
      body.textContent=result.kind==='text' ? result.content || ms('空文件','Empty file') : ms('无法作为文本预览。','Text preview unavailable.');
      if(result.truncated) title.textContent+=' · '+ms('前 64 KiB','First 64 KiB');
    }catch(error){if(current())body.textContent=String(error);}
    finally {if(current()){preview.reading=false;syncSshPanePreview(tb,side);}}
  };
  return preview;
}
function clearSshPanePreview(preview) {
  preview.request++;preview.reading=false;preview.button.disabled=!preview.scope;
  preview.box.hidden=true;preview.body.textContent='';preview.title.textContent='';
}
function syncSshPanePreview(tb,side) {
  const view=tb.sshFiles, local=view.localPane, preview=local.previews[side];
  const pane=side==='local'?local:view;
  const selected=pane.selection?.size===1 ? pane.selection.values().next().value : null;
  const entry=side==='local' ? (selected!=null && local.entries.find(e=>e.name===selected)) : view.entries[selected];
  const input=side==='local'?local.panel.querySelector('[data-local-path]'):tb.sshFilesPanel.querySelector('[data-path]');
  const ready=tb.sshAuthenticated && !tb.disposed && !tb.exited && !tb.sshDisconnectRequested && pane.ready && input.value===pane.path && entry && !entry.isDir && !entry.isLink && !entry.isReparse;
  const old=preview.scope;
  if(old && (!ready || old.name!==entry.name || old.path!==pane.path || old.generation!==pane.generation || old.id!==tb.termId || old.key!==tb.key)) {
    clearSshPanePreview(preview); preview.scope=null;
  }
  if(ready && !preview.scope) preview.scope={name:entry.name,path:pane.path,generation:pane.generation,id:tb.termId,key:tb.key};
  preview.button.disabled=!ready || preview.reading;
}
