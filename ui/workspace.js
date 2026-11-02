/* Workspace UI: navigation hub, filters, previews and keyboard actions. */
const UI = {
  zh: { home: '工作空间', welcome: '所有文件，井然有序。', intro: '从常用位置开始，继续手上的工作。',
    locations: '常用位置', storage: '存储空间', recent: '最近访问', noRecent: '打开文件夹后，会在这里留下快捷入口。',
    all: '全部', folders: '文件夹', images: '图片', documents: '文档', preview: '预览与详情',
    previewHint: '选择一个文件', previewHelp: '支持图片、文本、PDF 和 Word (.docx)，在本地查看内容和属性。', multi: '已选择 {n} 个项目',
    details: '文件属性', created: '创建时间', accessed: '访问时间', attributes: '属性', extension: '扩展名',
    location: '所在位置', modified: '修改时间', size: '文件大小', unsupported: '此类型暂不支持内容预览，可使用关联程序打开。',
    partial: '仅显示前 64 KB 内容', theme: '切换明暗主题', commands: '快捷操作', commandHint: '搜索操作、文件夹或打开的标签页…',
    commandHelp: '↑ ↓ 选择　 Enter 执行　 Esc 关闭', noCommands: '没有匹配的操作', local: '本地工作空间',
    tagline: '你的文件，自在有序', openFolder: '打开文件夹', filesCount: '{n} 个项目', selectHint: '双击打开 · 空格预览',
    showHidden: '切换隐藏文件', homeAction: '返回工作空间', viewAction: '切换列表 / 网格', folderHint: '文件夹内容可双击查看',
    previewError: '无法预览此文件', light: '浅色', dark: '深色', closePreview: '关闭预览', free: '可用',
  },
  en: { home: 'Workspace', welcome: 'Everything in its place.', intro: 'Your favorite places. Your next great idea.',
    locations: 'Quick access', storage: 'Storage', recent: 'Recently visited', noRecent: 'Folders you visit will appear here.',
    all: 'All', folders: 'Folders', images: 'Images', documents: 'Documents', preview: 'Preview & details',
    previewHint: 'Select a file', previewHelp: 'Preview images, text, PDF and Word (.docx) locally, with file properties.', multi: '{n} items selected',
    details: 'File properties', created: 'Created', accessed: 'Accessed', attributes: 'Attributes', extension: 'Extension',
    location: 'Location', modified: 'Modified', size: 'Size', unsupported: 'Content preview is unavailable. Open with the associated application.',
    partial: 'Showing the first 64 KB', theme: 'Toggle light / dark theme', commands: 'Quick actions', commandHint: 'Find an action, folder or open tab…',
    commandHelp: '↑ ↓ Navigate　 Enter Run　 Esc Close', noCommands: 'No matching actions', local: 'Local workspace',
    tagline: 'A place for everything', openFolder: 'Open folder', filesCount: '{n} items', selectHint: 'Double-click to open · Space to preview',
    showHidden: 'Toggle hidden files', homeAction: 'Go to workspace', viewAction: 'Toggle list / grid', folderHint: 'Open this folder to see its contents',
    previewError: 'Unable to preview this file', light: 'Light', dark: 'Dark', closePreview: 'Close preview', free: 'free',
  },
};
const u = (key) => UI[locale === 'zh' ? 'zh' : 'en'][key] || key;
const FILE_GROUPS = {
  images: new Set('png jpg jpeg gif webp bmp svg ico avif heic'.split(' ')),
  documents: new Set('txt md pdf doc docx xls xlsx csv ppt pptx rtf odt epub'.split(' ')),
};
function matchesFileType(entry, group) {
  if (group === 'all') return true;
  if (group === 'folders') return entry.isDir;
  return !entry.isDir && !!FILE_GROUPS[group]?.has(entry.ext.toLowerCase());
}

let previewOpen = store.get('previewOpen', false);
let previewToken = 0;
let previewIdentity = '';
let previewTimer;
let commandItems = [], commandIndex = 0;
const PANEL_ICON = S('<rect x="3" y="4" width="14" height="12" rx="2"/><path d="M12 4v12"/>');
const SUN_ICON = S('<circle cx="10" cy="10" r="3"/><path d="M10 2v1M10 17v1M2 10h1M17 10h1M4.3 4.3l.7.7M15 15l.7.7M4.3 15.7l.7-.7M15 5l.7-.7"/>');

function initWorkspace() {
  if (typeof initPlaces === 'function') initPlaces();
  if (typeof initQuickSearch === 'function') initQuickSearch();
  if (typeof initAiAssistant === 'function') initAiAssistant();
  if (typeof initWorkspaceSettings === 'function') initWorkspaceSettings();
  document.documentElement.dataset.theme = store.get('theme', 'light') === 'dark' ? 'dark' : 'light';
  $('brandHome').addEventListener('click', (ev) => { ev.preventDefault(); navigate(null); });
  $('btnTerminal').addEventListener('click', () => newTermTab());
  $('btnSsh').addEventListener('click', () => openSshConnect());
  $('btnTheme').addEventListener('click', toggleTheme);
  $('btnPreview').addEventListener('click', togglePreview);
  $('typeFilters').addEventListener('click', (ev) => {
    const button = ev.target.closest('[data-filter]');
    if (!button) return;
    state.typeFilter = button.dataset.filter;
    els.scroller.scrollTop = 0;
    renderAll();
  });
  $('previewPanel').addEventListener('click', (ev) => {
    if (ev.target.closest('[data-preview-close]')) togglePreview();
    if (ev.target.closest('[data-preview-open]')) openSelected();
    if (ev.target.closest('[data-preview-copy]') && state.selection.size === 1)
      void copySelectedPaths();
  });
  $('previewPanel').addEventListener('keydown', (ev) => ev.stopPropagation());
  $('commandInput').addEventListener('input', () => { commandIndex = 0; renderCommands(); });
  $('commandDialog').addEventListener('click', (ev) => {
    if (ev.target === $('commandDialog')) { const r = ev.target.getBoundingClientRect(); if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) ev.target.close(); }
    const item = ev.target.closest('[data-command]');
    if (item) runCommand(+item.dataset.command);
  });
  $('commandDialog').addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault(); commandIndex = Math.max(0, Math.min(commandItems.length - 1, commandIndex + (ev.key === 'ArrowDown' ? 1 : -1)));
      paintCommandSelection();
    } else if (ev.key === 'Enter') { ev.preventDefault(); runCommand(commandIndex); }
  });
  new ResizeObserver(() => {
    if (isTermTab(curTab())) fitTerm(curTab());
    else if (typeof isBrowserTab === 'function' && isBrowserTab(curTab()) && typeof syncBrowserBounds === 'function') syncBrowserBounds();
    else if (state.entries && !state.loading) renderList();
  }).observe(els.content);
}

function toggleTheme() {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  store.set('theme', theme);
  renderWorkspace();
}
function setViewMode(mode) {
  state.viewMode = mode;
  store.set('viewMode', mode);
  els.scroller.scrollTop = 0;
  renderAll();
}
function togglePreview() {
  previewOpen = !previewOpen;
  store.set('previewOpen', previewOpen);
  previewIdentity = '';
  renderWorkspace();
  renderList();
}

function renderWorkspace() {
  const tb = curTab(), term = !!isTermTab(tb), browser = typeof isBrowserTab === 'function' && isBrowserTab(tb), ssh = typeof isSshTab === 'function' && isSshTab(tb);
  document.body.classList.toggle('home-mode', !term && !browser && state.path === null);
  $('pageTitle').textContent = browser ? (tb.title || '浏览器') : term ? ssh ? sshTabTitle(tb) : 'PowerShell' : state.path === null ? u('home') : basename(state.path);
  $('pageSubtitle').textContent = browser ? (locale === 'zh' ? 'Chromium 浏览器标签页' : 'Chromium browser tab') : term ? ssh ? (locale === 'zh' ? 'SSH · 远程终端' : 'SSH · Remote terminal') : tb.cwd || 'PowerShell' : state.path === null ? 'DALIZI / YOUR LOCAL SPACE' : `${u('filesCount').replace('{n}', state.view.length.toLocaleString())}  ·  ${u('selectHint')}`;
  setBtn($('btnTerminal'), IC.tconsole, 'PowerShell', t('newTermTab') + ' · Ctrl+Shift+T');
  setBtn($('btnSsh'), IC.globe, 'SSH', locale === 'zh' ? '新建 SSH 连接' : 'New SSH connection');
  $('btnSsh').parentElement.setAttribute('aria-label', locale === 'zh' ? '新建终端' : 'New terminal');
  setBtn($('btnPreview'), PANEL_ICON, '', u('preview') + ' · Space');
  $('btnPreview').classList.toggle('active', previewOpen);
  $('btnPreview').setAttribute('aria-pressed', String(previewOpen));
  setBtn($('btnTheme'), SUN_ICON, '', u('theme'));
  $('brandCaption').textContent = u('tagline');
  $('settingsLabel').textContent = locale === 'zh' ? '设置' : 'Settings';
  $('btnSettings').title = $('settingsLabel').textContent;
  $('btnSettings').setAttribute('aria-label', $('settingsLabel').textContent);
  $('btnAiAssistant').textContent = locale === 'zh' ? 'AI 对话' : 'AI chat';
  $('typeFilters').innerHTML = state.path === null ? '' : ['all', 'folders', 'images', 'documents'].map((key) =>
    `<button class="filter-chip${state.typeFilter === key ? ' active' : ''}" data-filter="${key}" aria-pressed="${state.typeFilter === key}">${esc(u(key))}</button>`).join('');
  $('bar2').classList.toggle('home-toolbar', state.path === null && !browser);
  $('pageHeader').classList.toggle('hidden', browser);
  $('browserToolbar').classList.toggle('hidden', !browser);
  $('previewPanel').classList.toggle('hidden', !previewOpen || term || browser || state.path === null);
  document.body.classList.toggle('preview-open', previewOpen && !term && !browser && state.path !== null);
  renderPreview();
  if (typeof renderFavoritesBar === 'function') renderFavoritesBar();
  if (typeof syncQuickSearchWorkspace === 'function') syncQuickSearchWorkspace();
  if (typeof syncWorkspaceSettings === 'function') syncWorkspaceSettings();
  if (typeof syncAiWorkspace === 'function') syncAiWorkspace();
  if (typeof syncSshWorkspace === 'function') syncSshWorkspace();
  if (typeof syncBrowserWorkspace === 'function') syncBrowserWorkspace();
}

function renderHome() {
  const roots = state.roots;
  if (!roots) { els.rootPage.innerHTML = `<div class="preview-empty">${esc(t('loading'))}</div>`; return; }
  const icons = { desktop: IC.monitor, documents: IC.fileS, downloads: IC.downTray, pictures: IC.photoIc, music: IC.musicIc, videos: IC.filmIc };
  const quick = roots.quick.map((q) => `<button class="quick-card ${q.key}" data-nav="${esc(q.path)}" title="${esc(q.path)}"><span class="quick-icon">${icons[q.key] || IC.folderS}</span><span><strong>${esc(L[locale].quickNames[q.key])}</strong><small>${esc(u('openFolder'))}</small></span></button>`).join('');
  const drives = roots.drives.map((d) => {
    const used = d.total ? Math.max(0, Math.min(100, (1 - d.free / d.total) * 100)) : 0;
    return `<button class="drive-card" data-nav="${esc(d.path)}"><div class="drive-heading"><span>${driveIcon(d.dtype)}</span><strong>${esc(d.label || t('localDisk'))}<small>${esc(d.path)}</small></strong><span class="drive-percent">${Math.round(used)}%</span></div><div class="dbar${used > 90 ? ' full' : ''}"><i style="width:${used}%"></i></div><div class="drive-meta"><span>${esc(fmtSize(d.free))} ${esc(u('free'))}</span><span>${esc(fmtSize(d.total))}</span></div></button>`;
  }).join('');
  const recent = state.recents.slice(0, 6).map((p) => `<button class="recent-item" data-nav="${esc(p)}"><span class="recent-icon">${IC.folderS}</span><span class="recent-info"><strong>${esc(basename(p))}</strong><small>${esc(p)}</small></span><span class="recent-arrow">${IC.fwd}</span></button>`).join('');
  els.rootPage.innerHTML = `<div class="home-hero"><span class="eyebrow">MAKE ROOM FOR WHAT MATTERS</span><h2>${esc(u('welcome'))}</h2><p>${esc(u('intro'))}</p></div>
    <section class="rsec"><div class="section-heading"><h3>${esc(u('locations'))}</h3><span>01 / QUICK ACCESS</span></div><div class="quick-grid">${quick}</div></section>
    <section class="rsec"><div class="section-heading"><h3>${esc(u('storage'))}</h3><span>${roots.drives.length} ${locale === 'zh' ? '个驱动器' : 'DRIVES'}</span></div><div class="drive-grid">${drives}</div></section>
    <section class="rsec"><div class="section-heading"><h3>${esc(u('recent'))}</h3><span>CONTINUE WHERE YOU LEFT OFF</span></div><div class="recent-list">${recent || `<p class="empty-note">${esc(u('noRecent'))}</p>`}</div></section>`;
}

function renderNavigation() {
  const active = isTermTab(curTab()) ? undefined : state.path;
  const nav = (path, name, icon, extra = '') => `<button class="sitem${active === path ? ' on' : ''}" data-nav="${esc(path === null ? '__root__' : path)}" title="${esc(path || name)}">${icon}<span class="snm">${esc(name)}</span>${extra}</button>`;
  let html = nav(null, u('home'), IC.home);
  html += `<div class="slabel">${esc(u('locations'))}</div>`;
  const icons = { desktop: IC.monitor, documents: IC.fileS, downloads: IC.downTray, pictures: IC.photoIc, music: IC.musicIc, videos: IC.filmIc };
  for (const q of state.roots?.quick || []) html += nav(q.path, L[locale].quickNames[q.key], icons[q.key] || IC.folderS);
  if (state.pinned.length) {
    html += `<div class="slabel">${esc(t('pinQuick'))}</div>`;
    for (const path of state.pinned) html += nav(path, basename(path), IC.folderS);
  }
  html += `<div class="slabel">${esc(u('storage'))}</div>`;
  for (const drive of state.roots?.drives || []) html += nav(drive.path, `${drive.label || t('localDisk')} (${drive.path.slice(0, 2)})`, driveIcon(drive.dtype));
  if (state.recents.length) {
    html += `<div class="slabel">${esc(u('recent'))}</div>`;
    for (const path of state.recents.slice(0, 4)) html += nav(path, basename(path), IC.folderS);
  }
  els.side.innerHTML = html;
}

function previewMetadata(entry, path) {
  const size = entry.isDir ? folderSizeLabel(entry) : fmtSize(entry.size);
  const fields = [
    [u('size'), size], [u('modified'), fmtDate(entry.mtime)],
    [u('created'), entry.ctime ? fmtDate(entry.ctime) : '—'], [u('accessed'), entry.atime ? fmtDate(entry.atime) : '—'],
    [u('attributes'), typeof fileAttributeLabel === 'function' ? fileAttributeLabel(entry) : '—'],
    ...(!entry.isDir ? [[u('extension'), entry.ext ? '.' + entry.ext : '—']] : []), [u('location'), path],
  ];
  return { size, html: fields.map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('') };
}
function renderPreview() {
  const panel = $('previewPanel');
  const active = previewOpen && !isTermTab(curTab()) && curTab()?.kind !== 'browser' && state.path !== null && !state.loading && !state.error;
  const selected = active ? (state.entries || []).filter((e) => state.selection.has(e.name)) : [];
  // Directory refreshes and access-time/size-cache updates must not restart the
  // reader. Only selection or the selected file's content identity owns it.
  const identity = JSON.stringify([active, locale, state.path, selected.map((e) => [e.name, e.isDir, e.size, e.mtime, e.ctime])]);
  if (identity === previewIdentity) {
    if (selected.length === 1) {
      const metadata = previewMetadata(selected[0], join(state.path, selected[0].name));
      const details = panel.querySelector('.preview-meta'), size = panel.querySelector('.preview-details summary span');
      if (details && details.innerHTML !== metadata.html) details.innerHTML = metadata.html;
      if (size) size.textContent = metadata.size;
    }
    return;
  }
  previewIdentity = identity;
  const token = ++previewToken;
  clearTimeout(previewTimer);
  disposeDocumentPreview();
  panel.classList.remove('preview-wide');
  panel.scrollTop = 0;
  if (!active) { panel.replaceChildren(); return; }
  const head = `<div class="preview-heading"><strong>${esc(u('preview'))}</strong><button class="ibtn" data-preview-close aria-label="${esc(u('closePreview'))}">${IC.x}</button></div>`;
  if (selected.length !== 1) {
    panel.innerHTML = head + `<div class="preview-empty">${PANEL_ICON}<h3>${esc(selected.length ? u('multi').replace('{n}', selected.length) : u('previewHint'))}</h3><p>${esc(u('previewHelp'))}</p></div>`;
    return;
  }
  const e = selected[0], path = join(state.path, e.name);
  const metadata = previewMetadata(e, path);
  panel.innerHTML = head + `<div class="preview-summary"><div class="preview-file-icon">${fileIcon(e, true)}</div><div><h3 class="preview-name">${esc(e.name)}</h3><p class="preview-kind">${esc(typeLabel(e))}</p></div></div><div class="preview-actions"><button class="tbtn" data-preview-open>${IC.openIc}${esc(t('open'))}</button><button class="ibtn" data-preview-copy title="${esc(t('copyPath'))}" aria-label="${esc(t('copyPath'))}">${IC.copy}</button></div><div id="previewContent" class="preview-content"><p class="preview-note">${esc(e.isDir ? u('folderHint') : t('loading'))}</p></div><details class="preview-details"${e.isDir ? ' open' : ''}><summary>${esc(u('details'))}<span>${esc(metadata.size)}</span></summary><dl class="preview-meta">${metadata.html}</dl></details>`;
  if (e.isDir) return;
  previewTimer = setTimeout(async () => {
    try {
      const result = await invoke('preview_file', { path });
      if (token !== previewToken) return;
      const content = $('previewContent');
      if (!content) return;
      content.replaceChildren();
      if (result.kind === 'pdf' || result.kind === 'document' || result.kind === 'spreadsheet') {
        await renderDocumentPreview(result, content, e.name, () => token === previewToken);
      } else if (result.kind === 'text') {
        const pre = document.createElement('pre'); pre.className = 'preview-code'; pre.textContent = result.content; content.appendChild(pre);
        if (result.truncated) { const note = document.createElement('p'); note.className = 'preview-note'; note.textContent = u('partial'); content.appendChild(note); }
      } else if (result.kind === 'image' && /^data:image\/(png|jpeg|gif|webp);base64,/.test(result.content)) {
        const img = document.createElement('img'); img.className = 'preview-image'; img.alt = e.name; img.src = result.content; content.appendChild(img);
      } else { const reason = documentPreviewReason(result.reason); content.textContent = reason ? documentText(reason) : u('unsupported'); content.classList.add('preview-note'); }
    } catch (err) {
      if (token === previewToken && $('previewContent')) $('previewContent').textContent = u('previewError') + ' · ' + String(err);
    }
  }, 120);
}

function handleFileKeys(ev) {
  if (isTermTab(curTab()) || !state.entries || state.loading || state.renaming || ev.altKey || ev.ctrlKey || ev.metaKey) return false;
  if (ev.target?.closest?.('button, a, input, textarea, select, [contenteditable]')) return false;
  const key = ev.key;
  if (key === ' ') { ev.preventDefault(); togglePreview(); return true; }
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageDown', 'PageUp'].includes(key) || !state.view.length) return false;
  ev.preventDefault();
  const cols = state.viewMode === 'grid' ? state.gridCols : 1;
  const current = state.view.findIndex((e) => e.name === state.focusName);
  const index = current < 0 ? 0 : current;
  const page = Math.max(1, Math.floor(els.scroller.clientHeight / ROWH[state.viewMode])) * cols;
  let next = index;
  if (key === 'Home') next = 0;
  else if (key === 'End') next = state.view.length - 1;
  else if (current < 0) next = 0;
  else next += ({ ArrowDown: cols, ArrowUp: -cols, ArrowLeft: -1, ArrowRight: 1, PageDown: page, PageUp: -page })[key];
  next = Math.max(0, Math.min(state.view.length - 1, next));
  selectAt(next, { shiftKey: ev.shiftKey, ctrlKey: false });
  state.focusName = state.view[next].name;
  const top = Math.floor(next / cols) * ROWH[state.viewMode];
  if (top < els.scroller.scrollTop) els.scroller.scrollTop = top;
  else if (top + ROWH[state.viewMode] > els.scroller.scrollTop + els.scroller.clientHeight) els.scroller.scrollTop = top + ROWH[state.viewMode] - els.scroller.clientHeight;
  renderRows();
  return true;
}

function openCommands() {
  closeMenu();
  if (typeof closeQuickSearch === 'function') closeQuickSearch();
  const dialog = $('commandDialog');
  $('commandInput').placeholder = u('commandHint');
  $('commandFooter').textContent = u('commandHelp');
  $('commandInput').value = ''; commandIndex = 0;
  renderCommands();
  if (!dialog.open) dialog.showModal();
  $('commandInput').focus();
}
function renderCommands() {
  const actions = [
    { title: locale === 'zh' ? '设置' : 'Settings', sub: locale === 'zh' ? '外观、预览与智能体' : 'Appearance, preview and agent tools', icon: SUN_ICON, run: () => openWorkspaceSettings() },
    { title: locale === 'zh' ? '快速搜索' : 'Quick search', sub: locale === 'zh' ? '全局文件名索引' : 'Global filename index', key: 'Ctrl Shift F', icon: IC.search, run: () => openQuickSearch() },
    { title: locale === 'zh' ? 'AI 文件助手' : 'AI file assistant', sub: locale === 'zh' ? '自定义接口 · 查看并确认操作计划' : 'Custom endpoint · Review a file operation plan', icon: IC.fileS, run: () => openAiAssistant() },
    { title: u('homeAction'), sub: 'Navigation', icon: IC.home, run: () => navigate(null) },
    { title: t('newTermTab'), sub: 'PowerShell', key: 'Ctrl Shift T', icon: IC.tconsole, run: () => newTermTab() },
    { title: locale === 'zh' ? '新建 SSH 连接' : 'New SSH connection', sub: locale === 'zh' ? '连接远程主机 · 管理已保存的连接' : 'Connect to a remote host · Manage saved connections', icon: IC.globe, run: () => openSshConnect() },
    { title: t('newTab'), sub: 'Navigation', key: 'Ctrl T', icon: IC.plus, run: () => newTab() },
    { title: u('theme'), sub: u(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'), icon: SUN_ICON, run: toggleTheme },
  ];
  if (!isTermTab(curTab()) && state.path !== null) actions.push(
    { title: u('preview'), sub: 'View', key: 'Space', icon: PANEL_ICON, run: togglePreview },
    { title: u('viewAction'), sub: 'View', icon: IC.grid, run: () => setViewMode(state.viewMode === 'grid' ? 'details' : 'grid') },
    { title: t('newFolderHere'), sub: 'Files', icon: IC.folderS, run: newFolder },
    { title: u('showHidden'), sub: 'View', icon: IC.fileS, run: () => { state.showHidden = !state.showHidden; store.set('showHidden', state.showHidden); renderAll(); } },
  );
  state.tabs.forEach((tb, i) => {
    const ssh = typeof isSshTab === 'function' && isSshTab(tb);
    actions.push({ title: ssh ? sshTabTitle(tb) : isTermTab(tb) ? 'PowerShell' : basename(tb.path) || u('home'), sub: `${i + 1} · ${ssh ? 'SSH' : isTermTab(tb) ? tb.cwd || '' : tb.path || ''}`, icon: ssh ? IC.globe : isTermTab(tb) ? IC.tconsole : IC.folderS, run: () => switchTab(i) });
  });
  [...new Set([...state.pinned, ...state.recents, ...(state.roots?.quick || []).map((q) => q.path)])].forEach((p) => actions.push({ title: basename(p), sub: p, icon: IC.folderS, run: () => navigate(p) }));
  const q = $('commandInput').value.trim().toLowerCase();
  commandItems = actions.filter((a) => `${a.title} ${a.sub}`.toLowerCase().includes(q));
  $('commandResults').innerHTML = commandItems.map((a, i) => `<button class="command-item" data-command="${i}"><span>${a.icon}</span><span class="command-copy"><strong>${esc(a.title)}</strong><small>${esc(a.sub)}</small></span>${a.key ? `<kbd>${esc(a.key)}</kbd>` : ''}</button>`).join('') || `<div class="preview-empty">${esc(u('noCommands'))}</div>`;
  paintCommandSelection();
}
function paintCommandSelection() {
  $('commandResults').querySelectorAll('[data-command]').forEach((el, i) => { el.classList.toggle('active', i === commandIndex); if (i === commandIndex) el.scrollIntoView({ block: 'nearest' }); });
}
function runCommand(index) {
  const item = commandItems[index];
  if (!item) return;
  $('commandDialog').close();
  item.run();
}
