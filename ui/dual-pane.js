'use strict';
// The companion belongs to the file tab. AI always follows the main work pane.
const paneText = (zh, en) => locale === 'zh' ? zh : en;
function companionFor(tb = curTab()) { return tb && !isTermTab(tb) && !isBrowserTab(tb) ? tb.companion : null; }
function initDualPane() {
  const button = document.createElement('button'); button.id = 'btnDualPane'; button.className = 'tbtn';
  $('btnPreview').before(button); button.onclick = () => toggleDualPane();
  const panel = document.createElement('aside'); panel.id = 'companionPane'; panel.hidden = true;
  panel.innerHTML = '<header><strong data-title></strong><button data-close>×</button></header><form><button type="button" data-back>←</button><button type="button" data-up>↑</button><input data-path spellcheck="false"><button type="submit">↵</button><button type="button" data-refresh>⟳</button></form><div class="pane-actions"><button data-to-right></button><button data-to-left></button><button data-work></button></div><input data-filter type="search"><div class="pane-list" tabindex="0" role="listbox" aria-multiselectable="true"><div class="pane-size"></div><div class="pane-rows"></div></div><p data-status role="status"></p><small data-scope></small>';
  $('previewPanel').before(panel);
  panel.querySelector('[data-close]').onclick = () => toggleDualPane(false);
  panel.querySelector('form').onsubmit = (e) => { e.preventDefault(); void loadCompanion(panel.querySelector('[data-path]').value); };
  panel.querySelector('[data-back]').onclick = () => { const p = companionFor(); if (p?.history.length > 1) { p.history.pop(); void loadCompanion(p.history.at(-1), false); } };
  panel.querySelector('[data-up]').onclick = () => { const p = parentOf(companionFor()?.path); if (p) void loadCompanion(p); };
  panel.querySelector('[data-refresh]').onclick = () => void loadCompanion(companionFor()?.path, false, true);
  panel.querySelector('[data-filter]').oninput = (e) => { const p = companionFor(); if (p) { p.filter = e.target.value; p.anchor = -1; panel.querySelector('.pane-list').scrollTop = 0; paintCompanionRows(); } };
  panel.querySelector('[data-work]').onclick = () => void activateCompanion();
  panel.querySelector('[data-to-right]').onclick = () => transferBetweenPanes('right');
  panel.querySelector('[data-to-left]').onclick = () => transferBetweenPanes('left');
  panel.querySelector('.pane-list').onscroll = paintCompanionRows;
  panel.addEventListener('keydown', (e) => {
    // Main-pane shortcuts must never operate on its selection while typing here.
    e.stopPropagation(); if (e.target.matches('input')) return;
    const p = companionFor(); if (!p || p.loading) return;
    if (e.ctrlKey && e.key.toLowerCase() === 'a') { e.preventDefault(); p.selection = new Set(companionEntries(p).map(x => x.name)); paintCompanionRows(); }
    else if (e.key === 'Enter') { e.preventDefault(); const x = p.entries.find(x => p.selection.has(x.name)); if (x) openCompanionEntry(x); }
    else if (e.key === 'F5') { e.preventDefault(); void loadCompanion(p.path, false, true); }
  });
  syncDualPane();
}
function toggleDualPane(force) {
  if (isTermTab(curTab()) || isBrowserTab(curTab()) || (!state.path && force !== false)) return;
  const tb = curTab(); tb.companion ||= { path: state.path, history: [], entries: [], selection: new Set(), generation: 0, filter: '', open: false };
  tb.companion.open = force ?? !tb.companion.open; syncDualPane(); renderWorkspace(); renderList();
  if (tb.companion.open) void loadCompanion(tb.companion.path, false, true);
}
async function loadCompanion(path, push = true, preserve = false, tb = curTab()) {
  const p = companionFor(tb); if (!p || !path) return;
  path = normalizeNavigationPath(path); if (!path) return;
  const token = ++p.generation; p.loading = true; p.error = ''; p.requestPath = path;
  if (tb === curTab()) syncDualPane();
  try {
    const entries = await invoke('list_dir', { path }); if (p.generation !== token) return;
    const same = p.path === path; p.path = path;
    // prepareEntries owns the main directory's size-event lookup; keep this view isolated.
    p.entries = entries.map(entry => ({ ...entry, nameLower: entry.name.toLowerCase() })); p.anchor = -1;
    p.selection = new Set(preserve && same ? [...p.selection].filter(n => p.entries.some(e => e.name === n)) : []);
    if (push || !p.history.length) { if (p.history.at(-1) !== path) p.history.push(path); if (p.history.length > 100) p.history.shift(); }
    if (!same) p.filter = '';
  } catch (error) { if (p.generation === token) p.error = String(error); }
  finally { if (p.generation === token) { p.loading = false; if (tb === curTab()) syncDualPane(); } }
}
function companionEntries(p) {
  const c=p.viewCache;
  if(c && c.entries===p.entries && c.filter===p.filter && c.hidden===state.showHidden && c.locale===locale)return c.rows;
  const query=p.filter.toLowerCase(), collator=new Intl.Collator(locale === 'zh'?'zh-CN':'en',{numeric:true});
  const rows=p.entries.filter(e=>(state.showHidden || !e.hidden) && e.name.toLowerCase().includes(query)).sort((a,b)=>Number(b.isDir)-Number(a.isDir)||collator.compare(a.name,b.name));
  p.viewCache={entries:p.entries,filter:p.filter,hidden:state.showHidden,locale,rows};return rows;
}
function syncDualPane() {
  const panel = $('companionPane'), button = $('btnDualPane'); if (!panel || !button) return;
  const p = companionFor(); button.textContent = paneText('双面板', 'Dual pane'); button.disabled = !state.path || isTermTab(curTab()) || isBrowserTab(curTab());
  const visible=!!p?.open && !!state.path;
  button.setAttribute('aria-pressed', String(visible)); panel.hidden = !visible; document.body.classList.toggle('dual-pane-mode', visible);
  if (!visible) return;
  const T = paneText;
  panel.querySelector('[data-title]').textContent = T('文件对照面板', 'Companion folder');
  panel.querySelector('[data-close]').setAttribute('aria-label', T('关闭对照面板', 'Close companion'));
  const input = panel.querySelector('[data-path]'); if (document.activeElement !== input) input.value = p.loading ? p.requestPath : p.path;
  input.setAttribute('aria-label', T('对照目录路径', 'Companion path'));
  for(const [selector,label] of [['[data-back]',T('返回','Back')],['[data-up]',T('上一级','Parent folder')],['[data-refresh]',T('刷新','Refresh')]]) { const b=panel.querySelector(selector); b.title=label;b.setAttribute('aria-label',label); }
  const filter = panel.querySelector('[data-filter]'); filter.placeholder = T('筛选对照目录…', 'Filter companion folder…'); filter.setAttribute('aria-label', filter.placeholder); if (document.activeElement !== filter) filter.value = p.filter;
  for (const [sel, text, label] of [['[data-to-right]', '→', T('左侧选中项传输到右侧…', 'Transfer left selection to right…')], ['[data-to-left]', '←', T('右侧选中项传输到左侧…', 'Transfer right selection to left…')], ['[data-work]', T('设为工作目录', 'Work folder'), T('交换两侧目录，AI 跟随新的左侧目录', 'Swap folders; AI follows the new left folder')]]) {const b=panel.querySelector(sel);b.textContent=text;b.title=label;b.setAttribute('aria-label',label);}
  panel.querySelector('[data-to-right]').disabled = p.loading || !state.selection.size || !state.path || fileOpBusy;
  panel.querySelector('[data-to-left]').disabled = p.loading || !p.selection.size || !state.path || fileOpBusy;
  panel.querySelector('[data-work]').disabled = p.loading || !!p.error || state.loading;
  panel.querySelector('[data-scope]').textContent = T('AI / 记忆跟随左侧工作目录。', 'AI / memory follow the left work folder.');
  panel.querySelector('[data-status]').textContent = p.loading ? T('读取目录…', 'Loading…') : p.error || `${p.entries.length} ${T('项', 'items')} · ${p.selection.size} ${T('已选', 'selected')}`;
  paintCompanionRows();
}
function paintCompanionRows() {
  const p = companionFor(), panel = $('companionPane'); if (!p?.open || !panel) return;
  const entries = companionEntries(p), list = panel.querySelector('.pane-list'), host = panel.querySelector('.pane-rows'), height = 42;
  panel.querySelector('.pane-size').style.height = entries.length * height + 'px';
  const start = Math.max(0, Math.floor(list.scrollTop/height)-4), end = Math.min(entries.length, start+Math.ceil(list.clientHeight/height)+8);
  const old = new Map([...host.children].map(n => [n.dataset.name,n]));
  for (let i=start;i<end;i++) {
    const e=entries[i]; let row=old.get(e.name); old.delete(e.name);
    if (!row) { row=document.createElement('button'); row.className='pane-file'; row.dataset.name=e.name; row.setAttribute('role','option'); host.append(row); }
    row.style.top=i*height+'px'; row.setAttribute('aria-selected',String(p.selection.has(e.name))); row.title=e.name;
    const label = (e.isDir ? '📁 ' : '▤ ') + e.name; if (row.textContent!==label) row.textContent=label;
    row.onclick=(ev)=>{ if(p.loading)return; if(ev.shiftKey && p.anchor >= 0 && p.anchor < entries.length) { if(!ev.ctrlKey)p.selection.clear(); for(let n=Math.min(i,p.anchor);n<=Math.max(i,p.anchor);n++)p.selection.add(entries[n].name); } else if(ev.ctrlKey) { if(p.selection.has(e.name))p.selection.delete(e.name);else p.selection.add(e.name);p.anchor=i; } else {p.selection=new Set([e.name]);p.anchor=i;} syncDualPane(); };
    row.ondblclick=()=>openCompanionEntry(e);
  }
  for (const n of old.values()) n.remove();
}
function openCompanionEntry(entry) { const p=companionFor(); if (!p || p.loading) return; const path=join(p.path,entry.name); if(entry.isDir)void loadCompanion(path);else invoke('open_path',{path}).catch(e=>toast(String(e),true)); }
async function activateCompanion() {
  const tb=curTab(), p=companionFor(); if(!p || p.loading || p.error || state.loading)return;
  const oldPath=state.path, oldSelection=new Set(state.selection), nextPath=p.path, nextSelection=new Set(p.selection);
  await navigate(nextPath);
  if(curTab()!==tb || state.path!==nextPath || state.error)return;
  state.selection=new Set([...nextSelection].filter(n=>state.entries?.some(e=>e.name===n))); applySelectionDom(); renderBar2(); renderStatus();
  await loadCompanion(oldPath,true,false,tb); if(companionFor(tb)===p && p.path===oldPath){p.selection=oldSelection;if(curTab()===tb)syncDualPane();}
}
function transferBetweenPanes(direction) {
  const p=companionFor(); if(!p || p.loading || !state.path || fileOpBusy)return;
  const from=direction==='right'?state.path:p.path, to=direction==='right'?p.path:state.path;
  const selection=direction==='right'?state.selection:p.selection; if(!selection.size)return;
  openExternalDrop([...selection].map(n=>join(from,n)),{path:to,owner:curTab(),folder:state.path});
  const title=$('externalDropTitle'); if(title)title.textContent=paneText('跨面板文件操作','Transfer between folders')+` · ${selection.size}`;
}
