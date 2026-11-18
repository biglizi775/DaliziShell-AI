/* One workspace search field: local filtering or bounded index queries. */
const QUICK_TEXT = {
  zh: { title: '搜索结果', local: '当前目录', tree: '含子目录', global: '全部位置', localHint: '筛选名称', placeholder: '文件名或 ext:pdf…', all: '全部', file: '文件', dir: '文件夹', rebuild: '重新校验索引', close: '收起结果', name: '名称', location: '所在位置', size: '大小', actions: '操作', empty: '在上方输入关键词', hint: '空格分隔关键词 · ext:rs;js · ↑ ↓ 选择 · Enter 打开', noResults: '没有找到匹配项目', searching: '正在搜索…', indexed: '已索引', indexing: '后台索引中，结果持续补充', ready: '文件名索引就绪', cached: '已恢复缓存', recent: '近期缓存优先复用，后台校验离线期间的变化', matches: '个匹配', reveal: '在资源管理器中定位', copy: '复制路径', copied: '路径已复制', error: '搜索失败', starting: '索引已在后台开始校验', noScope: '请先打开一个本地文件夹', stale: '文件可能已移动或删除，可重新校验索引', range: '搜索范围', terminal: '终端启动目录及子目录' },
  en: { title: 'Search results', local: 'This folder', tree: 'Subfolders', global: 'Everywhere', localHint: 'Filter names', placeholder: 'Name or ext:pdf…', all: 'All', file: 'Files', dir: 'Folders', rebuild: 'Revalidate index', close: 'Hide results', name: 'Name', location: 'Location', size: 'Size', actions: 'Actions', empty: 'Type in the search field above', hint: 'Space-separated words · ext:rs;js · ↑ ↓ Select · Enter Open', noResults: 'No matching items', searching: 'Searching…', indexed: 'Indexed', indexing: 'Indexing; results are partial', ready: 'Filename index ready', cached: 'Cache restored', recent: 'Recent cache is reused while offline changes await validation', matches: 'matches', reveal: 'Show in Explorer', copy: 'Copy path', copied: 'Path copied', error: 'Search failed', starting: 'Background index validation started', noScope: 'Open a local folder first', stale: 'The item may have moved or been deleted. Revalidate the index.', range: 'Search scope', terminal: 'Terminal starting folder and descendants' },
};
const qt = (key) => QUICK_TEXT[locale === 'zh' ? 'zh' : 'en'][key] || key;
QUICK_TEXT.zh.reveal = '在新标签页打开所在文件夹'; QUICK_TEXT.en.reveal = 'Open containing folder in a new tab';
QUICK_TEXT.zh.placeholder = '名称、*.pdf、size:>10mb…'; QUICK_TEXT.en.placeholder = 'Name, *.pdf, size:>10mb…';
QUICK_TEXT.zh.localHint = '名称或搜索语法'; QUICK_TEXT.en.localHint = 'Name or search syntax';
QUICK_TEXT.zh.hint = '空格 与 · | 或 · ! 排除 · * ? 通配符'; QUICK_TEXT.en.hint = 'Space AND · | OR · ! NOT · * ? wildcards';
const quickState = { token: 0, timer: null, poll: null, mode: 'local', kind: 'all', scope: null, items: [], selected: -1, status: null, pending: false, open: false, owner: null, folder: null, locale: null };
function quickFolder() { const path = tabLocalFolder(curTab()); return path && (/^[a-z]:[\\/]/i.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path)) ? path : null; }
function quickRequestKey() { return JSON.stringify([$('search').value.trim(), quickState.kind, quickMode(), quickMode() === 'tree' ? quickFolder() : null]); }
function requestQuickRefresh() {
  if (!quickState.open || !$('search').value.trim()) return;
  if (quickState.result?.snapshotId) {
    // The status poll observes index revisions without replacing a browsed page.
    return;
  }
  if (quickState.pending || quickState.timer !== null) { quickState.refreshQueued = true; return; }
  scheduleQuickSearch(500, true);
}
function quickMode() {
  if (quickState.mode === 'local' && (isTermTab(curTab()) || !tabLocalFolder(curTab()))) return 'global';
  if (quickState.mode === 'tree' && !quickFolder()) return 'global';
  return quickState.mode;
}
function quickElements() { return { dialog: $('quickSearchPopover'), input: $('search'), results: $('quickSearchResults'), status: $('quickSearchStatus'), count: $('quickSearchCount') }; }
function initQuickSearch() {
  if ($('quickSearchPopover')) return;
  const saved = store.get('searchMode', 'local');
  quickState.mode = ['local', 'tree', 'global'].includes(saved) ? saved : 'local';
  const popup = document.createElement('section'); popup.id = 'quickSearchPopover'; popup.className = 'quick-search-popover hidden';
  popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-modal', 'false'); document.body.appendChild(popup);
  $('search').setAttribute('aria-controls', popup.id); $('search').setAttribute('aria-expanded', 'false');
  $('search').setAttribute('autocomplete', 'off'); $('search').setAttribute('maxlength', '512');
  $('searchMode').addEventListener('change', () => setWorkspaceSearchMode($('searchMode').value));
  $('search').addEventListener('focus', () => { if (quickMode() !== 'local') showQuickSearch(); });
  $('search').addEventListener('keydown', handleQuickKeys);
  popup.addEventListener('keydown', (event) => { handleQuickKeys(event); event.stopPropagation(); });
  popup.addEventListener('focusout', event => {
    if (event.target.matches('[data-quick-page-input]') && quickState.result) event.target.value = String(quickState.result.page);
  });
  popup.addEventListener('click', (event) => {
    if (event.target.closest('[data-quick-close]')) { $('search').focus(); closeQuickSearch(); return; }
    if (event.target.closest('[data-quick-locations]')) { openIndexLocations(); return; }
    if (event.target.closest('[data-quick-rebuild]')) { rebuildQuickIndex(); return; }
    if (event.target.closest('[data-quick-new-results]')) { renewQuickResults(); return; }
    const step = event.target.closest('[data-quick-step]');
    if (step) { void goQuickPage(quickState.result.page + Number(step.dataset.quickStep)); return; }
    const kind = event.target.closest('[data-quick-kind]');
    if (kind) { quickState.kind = kind.dataset.quickKind; paintQuickFilters(); scheduleQuickSearch(0); return; }
    const row = event.target.closest('[data-quick-result]'); if (!row) return;
    quickState.selected = Number(row.dataset.quickResult); paintQuickSelection();
    const action = event.target.closest('[data-quick-action]');
    if (action) activateQuickResult(quickState.selected, action.dataset.quickAction);
  });
  popup.addEventListener('dblclick', (event) => { const row = event.target.closest('[data-quick-result]'); if (row && !event.target.closest('button')) activateQuickResult(Number(row.dataset.quickResult), 'open'); });
  document.addEventListener('pointerdown', (event) => { if (quickState.open && !event.target.closest('#quickSearchPopover, #searchWrap')) closeQuickSearch(); });
  document.addEventListener('keydown', (event) => {
    if (event.target.closest?.('#aiPanel') || document.querySelector('dialog[open]')) return;
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopImmediatePropagation(); openQuickSearch(); }
    else if (event.key === 'Escape' && quickState.open) { event.preventDefault(); event.stopImmediatePropagation(); closeQuickSearch(); }
  }, true);
  window.addEventListener('resize', positionQuickSearch);
  new ResizeObserver(positionQuickSearch).observe($('searchWrap'));
  listen('index-updated', requestQuickRefresh).catch(() => {});
  listen('index-locations-changed', () => { if (quickState.open) { renewQuickResults(); updateQuickStatus(); } }).catch(() => {});
  syncQuickSearchWorkspace();
}
function syncQuickSearchWorkspace() {
  if (!$('searchMode')) return;
  const owner = curTab(), folder = quickFolder();
  if (owner !== quickState.owner || folder !== quickState.folder) {
    closeQuickSearch(); quickState.owner = owner; quickState.folder = folder;
    $('search').value = ''; state.filter = ''; quickState.kind = 'all';
    if (typeof resetLocalSearch === 'function') resetLocalSearch();
  }
  const mode = quickMode(), localAvailable = !isTermTab(owner) && !!tabLocalFolder(owner);
  const selector = $('searchMode');
  for (const option of selector.options) { option.textContent = qt(option.value); option.disabled = option.value === 'local' ? !localAvailable : option.value === 'tree' ? !folder : false; }
  selector.value = mode; selector.setAttribute('aria-label', qt('range'));
  $('search').placeholder = qt(mode === 'local' ? 'localHint' : 'placeholder');
  $('search').setAttribute('aria-label', qt('range') + ' · ' + qt(mode));
  $('searchClear').style.visibility = $('search').value ? 'visible' : 'hidden';
  if (quickState.locale !== locale) { quickState.locale = locale; if (quickState.open) buildQuickPopover(); }
  positionQuickSearch();
}
function setWorkspaceSearchMode(mode) {
  if (!['local', 'tree', 'global'].includes(mode)) return;
  quickState.mode = mode; store.set('searchMode', mode); closeQuickSearch();
  handleWorkspaceSearchInput(); $('search').focus();
}
function handleWorkspaceSearchInput() {
  const mode = quickMode();
  if (mode === 'local' && typeof updateLocalSearch === 'function') { closeQuickSearch(); updateLocalSearch($('search').value); return true; }
  if (typeof resetLocalSearch === 'function') resetLocalSearch();
  state.filter = mode === 'local' ? $('search').value : '';
  els.scroller.scrollTop = 0; renderAll();
  if (mode === 'local') closeQuickSearch();
  else { if (!quickState.open) showQuickSearch(); else scheduleQuickSearch(150); }
  return true;
}
function openQuickSearch() { closeMenu(); setWorkspaceSearchMode('global'); $('search').focus(); $('search').select(); }
function buildQuickPopover() {
  const popup = $('quickSearchPopover'), mode = quickMode();
  popup.setAttribute('aria-label', qt('title'));
  popup.innerHTML = `<header class="quick-heading"><div><strong>${esc(qt('title'))}</strong><small>${esc(mode === 'tree' ? isTermTab(curTab()) ? qt('terminal') : qt('tree') : qt('global'))}${mode === 'tree' && quickFolder() ? ' · ' + esc(quickFolder()) : ''}</small></div><button class="ibtn" data-quick-close aria-label="${esc(qt('close'))}">${IC.x}</button></header><div class="quick-filters"><div>${['all', 'file', 'dir'].map((kind) => `<button type="button" data-quick-kind="${kind}" class="filter-chip">${esc(qt(kind))}</button>`).join('')}</div><button class="quick-rebuild" data-quick-rebuild>${IC.refresh}${esc(qt('rebuild'))}</button></div><div class="quick-result-info"><span id="quickSearchCount"></span><span>${esc(qt('hint'))}</span></div><div class="quick-table-head"><span>${esc(qt('name'))}</span><span>${esc(qt('location'))}</span><span>${esc(qt('size'))}</span><span>${esc(qt('actions'))}</span></div><div id="quickSearchResults" class="quick-results" role="listbox" aria-label="${esc(qt('title'))}"></div><footer id="quickSearchStatus" class="quick-status" aria-live="polite"></footer>`;
  const T = (zh, en) => locale === 'zh' ? zh : en;
  popup.querySelector('[data-quick-rebuild]').insertAdjacentHTML('beforebegin', `<button type="button" class="quick-locations" data-quick-locations>${T('索引位置', 'Index locations')}</button>`);
  $('quickSearchCount').setAttribute('role', 'status');
  $('quickSearchStatus').insertAdjacentHTML('beforebegin', `<nav id="quickSearchPager" class="quick-pager" aria-label="${T('搜索结果分页', 'Result pages')}" hidden><button type="button" data-quick-step="-1" aria-label="${T('上一页', 'Previous page')}">‹</button><label>${T('页码', 'Page')} <input type="number" min="1" step="1" inputmode="numeric" required data-quick-page-input title="${T('输入页码并按回车', 'Enter a page number and press Enter')}"></label><span data-quick-pages></span><button type="button" data-quick-step="1" aria-label="${T('下一页', 'Next page')}">›</button><button type="button" data-quick-new-results></button></nav>`);
  paintQuickFilters(); paintQuickResults(quickState.result); paintQuickStatus();
}
function paintQuickFilters() { $('quickSearchPopover').querySelectorAll('[data-quick-kind]').forEach((button) => { const active = button.dataset.quickKind === quickState.kind; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }); }
function showQuickSearch() {
  if (quickMode() === 'local') return;
  const popup = $('quickSearchPopover'); if (!popup) return;
  if (quickState.open) { positionQuickSearch(); return; }
  if (!quickState.open) {
    quickState.open = true; buildQuickPopover(); popup.classList.remove('hidden'); $('search').setAttribute('aria-expanded', 'true');
    updateQuickStatus(); quickState.poll = setInterval(updateQuickStatus, 2500);
  }
  positionQuickSearch(); scheduleQuickSearch(150);
}
function closeQuickSearch() {
  quickState.token++; clearTimeout(quickState.timer); clearInterval(quickState.poll);
  quickState.timer = null; quickState.poll = null; quickState.open = false; quickState.pending = false; quickState.items = []; quickState.selected = -1;
  forgetQuickResults(); quickState.refreshQueued = false;
  $('quickSearchPopover')?.classList.add('hidden'); $('search')?.setAttribute('aria-expanded', 'false');
}
function releaseQuickSnapshot(id) {
  if (id != null) invoke('search_release', { snapshotId: id }).catch(() => {});
}
function forgetQuickResults() {
  releaseQuickSnapshot(quickState.result?.snapshotId);
  quickState.resultKey = null; quickState.result = null;
  quickState.items = []; quickState.selected = -1; quickState.pagePending = null;
}
function renewQuickResults() {
  forgetQuickResults(); scheduleQuickSearch(0);
}
function paintQuickPager() {
  const nav = $('quickSearchPager'); if (!nav) return;
  const result = quickState.result;
  nav.hidden = !result?.snapshotId;
  if (nav.hidden) return;
  const pages = Math.ceil(result.total / result.pageSize), busy = !!quickState.pagePending;
  const input = nav.querySelector('[data-quick-page-input]');
  input.max = String(pages);
  const position = result.snapshotId + '/' + result.page;
  if (input.dataset.position !== position) {
    input.dataset.position = position; input.value = String(result.page);
  }
  input.readOnly = busy;
  nav.querySelector('[data-quick-pages]').textContent = '/ ' + pages.toLocaleString();
  nav.querySelector('[data-quick-step="-1"]').disabled = busy || result.page <= 1;
  nav.querySelector('[data-quick-step="1"]').disabled = busy || result.page >= pages;
  nav.querySelector('[data-quick-new-results]').textContent = quickState.status?.revision > result.snapshotRevision ?
    (locale === 'zh' ? '索引有更新 · 刷新结果' : 'Index changed · Refresh results') :
    (locale === 'zh' ? '刷新结果' : 'Refresh results');
}
async function goQuickPage(page) {
  const current = quickState.result, key = quickRequestKey(), owner = curTab(), folder = quickFolder();
  if (!quickState.open || !current?.snapshotId || quickState.pending || quickState.resultKey !== key) return;
  const pages = Math.ceil(current.total / current.pageSize);
  if (!Number.isSafeInteger(page) || page < 1 || page > pages) {
    const input = $('quickSearchPager')?.querySelector('[data-quick-page-input]');
    if (input && document.activeElement === input) input.reportValidity();
    return;
  }
  if (page === current.page) return;
  const token = ++quickState.token;
  quickState.pending = true; quickState.pagePending = page;
  paintQuickPager();
  $('quickSearchCount').textContent = (locale === 'zh' ? '正在读取第 ' + page + ' 页…' : 'Loading page ' + page + '…');
  const stillCurrent = () => quickState.open && token === quickState.token && owner === curTab() && folder === quickFolder() && key === quickRequestKey();
  try {
    const result = await invoke('search_page', { snapshotId: current.snapshotId, page });
    if (!stillCurrent()) return;
    if (result.snapshotId !== current.snapshotId || result.page !== page) throw new Error(qt('error'));
    quickState.result = result; quickState.items = result.items; quickState.selected = 0; quickState.status = result;
    quickState.pagePending = null; quickState.pending = false;
    paintQuickResults(result); $('quickSearchResults').scrollTop = 0;
    paintQuickStatus();
  } catch (error) {
    if (!stillCurrent()) return;
    quickState.pagePending = null; quickState.pending = false;
    paintQuickPager(); $('quickSearchCount').textContent = qt('error') + ' · ' + String(error);
  }
}
function positionQuickSearch() {
  if (!quickState.open) return;
  const popup = $('quickSearchPopover'), anchor = $('searchWrap').getBoundingClientRect();
  const width = Math.min(740, window.innerWidth - 24, Math.max(540, $('workspace').clientWidth - 24));
  popup.style.width = `${width}px`; popup.style.left = `${Math.max(12, Math.min(window.innerWidth - width - 12, anchor.right - width))}px`;
  popup.style.top = `${anchor.bottom + 7}px`; popup.style.maxHeight = `${Math.max(170, window.innerHeight - anchor.bottom - 21)}px`;
}
function handleQuickKeys(event) {
  if (!quickState.open || event.isComposing) return;
  if (event.target.matches('[data-quick-page-input]')) {
    if (event.key === 'Enter') { event.preventDefault(); void goQuickPage(event.target.valueAsNumber); }
    return;
  }
  if ((event.key === 'PageDown' || event.key === 'PageUp') && quickState.result?.snapshotId) {
    event.preventDefault(); event.stopPropagation(); void goQuickPage(quickState.result.page + (event.key === 'PageDown' ? 1 : -1)); return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); event.stopPropagation();
    if (quickState.items.length) { quickState.selected = Math.max(0, Math.min(quickState.items.length - 1, quickState.selected + (event.key === 'ArrowDown' ? 1 : -1))); paintQuickSelection(true); }
  } else if (event.key === 'Enter' && (event.target === $('search') || event.target.matches('[data-quick-result]'))) {
    event.preventDefault(); event.stopPropagation(); activateQuickResult(Math.max(0, quickState.selected), 'open');
  }
}
async function runQuickSearch(token) {
  const e = quickElements();
  if (!quickState.open || token !== quickState.token) return;
  const query = e.input.value.trim(), owner = curTab(), folder = quickFolder(), scope = quickMode() === 'tree' ? folder : null;
  if (!query) { quickState.pending = false; quickState.items = []; quickState.selected = -1; paintQuickResults(); return; }
  const key = quickRequestKey();
  quickState.pending = true; quickState.scope = scope;
  if (quickState.resultKey !== key) e.count.textContent = qt('searching');
  try {
    const result = await invoke('search_files', { query, kind: quickState.kind === 'all' ? null : quickState.kind, limit: 200, scope, paginate: true });
    if (token !== quickState.token || !quickState.open || owner !== curTab() || folder !== quickFolder() || key !== quickRequestKey()) { releaseQuickSnapshot(result.snapshotId); return; }
    if (result.cancelled) { scheduleQuickSearch(250); return; }
    const selectedPath = quickState.items[quickState.selected]?.path, previousIndex = quickState.selected;
    quickState.status = result; quickState.result = result; quickState.items = result.items || [];
    const selected = quickState.items.findIndex((item) => item.path === selectedPath);
    quickState.selected = selected >= 0 ? selected : quickState.items.length ? Math.max(0, Math.min(previousIndex, quickState.items.length - 1)) : -1;
    quickState.pending = false; quickState.pagePending = null; quickState.resultKey = key;
    paintQuickResults(result); paintQuickStatus();
    if (quickState.refreshQueued) { quickState.refreshQueued = false; requestQuickRefresh(); }
  } catch (error) {
    if (token !== quickState.token || !quickState.open || owner !== curTab() || folder !== quickFolder() || key !== quickRequestKey()) return;
    quickState.pending = false; quickState.items = []; quickState.selected = -1;
    forgetQuickResults(); quickState.refreshQueued = false; paintQuickPager();
    e.results.innerHTML = `<div class="quick-empty">${esc(qt('error'))}<small>${esc(String(error))}</small></div>`; e.count.textContent = '';
  }
}
function scheduleQuickSearch(delay = 150, background = false) {
  if (!quickState.open) return;
  if (quickState.result?.snapshotId && quickState.resultKey === quickRequestKey()) return;
  if (background && (quickState.pending || quickState.timer !== null)) { quickState.refreshQueued = true; return; }
  const token = ++quickState.token; clearTimeout(quickState.timer);
  quickState.pending = true;
  if (quickState.resultKey !== quickRequestKey()) { forgetQuickResults(); quickState.refreshQueued = false; }
  if (!quickState.items.length) paintQuickResults();
  if (!background) $('quickSearchCount').textContent = $('search').value.trim() ? qt('searching') : '';
  quickState.timer = setTimeout(() => { quickState.timer = null; runQuickSearch(token); }, delay);
}
function paintQuickResults(result) {
  const e = quickElements(); if (!e.results) return;
  paintQuickPager();
  const query = e.input?.value.trim();
  const total = Number(result?.total || 0);
  const start = result?.snapshotId ? (result.page - 1) * result.pageSize : 0;
  e.count.textContent = result ? (result.snapshotId ? `${(start + 1).toLocaleString()}–${(start + quickState.items.length).toLocaleString()} / ` : '') + `${total.toLocaleString()} ${qt('matches')}` : '';
  if (!quickState.items.length) {
    const html = `<div class="quick-empty">${IC.search}<strong>${esc(qt(query ? quickState.pending ? 'searching' : 'noResults' : 'empty'))}</strong><small>${esc(qt('hint'))}</small></div>`;
    if (e.results.innerHTML !== html) e.results.innerHTML = html;
    return;
  }
  const scroll = e.results.scrollTop;
  const existing = new Map([...e.results.querySelectorAll('[data-quick-result]')].map((row) => [row.dataset.path, row]));
  e.results.querySelector('.quick-empty')?.remove();
  for (const [index, entry] of quickState.items.entries()) {
    const row = existing.get(entry.path) || document.createElement('div'); existing.delete(entry.path);
    const identity = JSON.stringify([entry, locale]);
    if (row.dataset.identity !== identity) {
      row.innerHTML = `<div class="quick-file">${entry.isDir ? IC.folderS : IC.fileS}<span><strong title="${esc(entry.name)}">${esc(entry.name)}</strong><small>${esc(fmtDate(entry.mtime))}</small></span></div><div class="quick-path" title="${esc(entry.path)}">${esc(parentOf(entry.path) || entry.path)}</div><div class="quick-size">${entry.size == null ? '—' : esc(fmtSize(entry.size))}</div><div class="quick-actions"><button class="ibtn" data-quick-action="reveal" title="${esc(qt('reveal'))}" aria-label="${esc(qt('reveal'))}">${IC.folderS}</button><button class="ibtn" data-quick-action="copy" title="${esc(qt('copy'))}" aria-label="${esc(qt('copy'))}">${IC.copy}</button></div>`;
      row.dataset.identity = identity;
    }
    row.className = 'quick-result' + (index === quickState.selected ? ' selected' : '');
    row.dataset.quickResult = String(index); row.dataset.path = entry.path;
    row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(index === quickState.selected)); row.tabIndex = -1;
    if (e.results.children[index] !== row) e.results.insertBefore(row, e.results.children[index] || null);
  }
  for (const row of existing.values()) row.remove();
  e.results.scrollTop = scroll;
}
function paintQuickSelection(scroll = false) { $('quickSearchResults').querySelectorAll('[data-quick-result]').forEach((row, index) => { row.classList.toggle('selected', index === quickState.selected); row.setAttribute('aria-selected', String(index === quickState.selected)); if (scroll && index === quickState.selected) row.scrollIntoView({ block: 'nearest' }); }); }
async function activateQuickResult(index, action) {
  const entry = quickState.items[index]; if (!entry || quickState.pagePending || quickState.owner !== curTab() || quickState.folder !== quickFolder() || quickState.resultKey !== quickRequestKey()) return;
  try {
    if (action === 'copy') { await navigator.clipboard.writeText(entry.path); toast(qt('copied')); }
    else if (action === 'reveal') { closeQuickSearch(); await openContainingFolder(entry.path); }
    else if (entry.isDir) { closeQuickSearch(); await navigate(entry.path); }
    else await invoke('open_path', { path: entry.path });
  } catch (error) { toast(`${qt('stale')} · ${String(error)}`, true); }
}
async function updateQuickStatus() {
  if (!quickState.open) return;
  const owner = curTab();
  try { const status = await invoke('search_status'); if (quickState.open && owner === curTab()) { quickState.status = status; paintQuickStatus(); paintQuickPager(); } } catch {}
}
function paintQuickStatus() {
  const status = quickState.status; if (!status || !$('quickSearchStatus')) return;
  $('quickSearchStatus').textContent = `${qt('indexed')} ${(status.indexed || 0).toLocaleString()} · ${qt(status.indexing ? 'indexing' : 'ready')}${status.cacheRestored ? ' · ' + qt('cached') : ''}`;
  if (status.indexLimitReached) $('quickSearchStatus').textContent += locale === 'zh' ? ' · 索引达到上限，范围不完整' : ' · Index limit reached; coverage is incomplete';
  if (status.selectedLocations != null) $('quickSearchStatus').textContent += status.selectedLocations === 0
    ? (locale === 'zh' ? ' · 后台索引已暂停' : ' · Background indexing paused')
    : (locale === 'zh' ? ` · 指定位置 ${status.selectedLocations} 个` : ` · ${status.selectedLocations} selected locations`);
  if (status.unwatchedLocations) $('quickSearchStatus').textContent += locale === 'zh' ? ` · ${status.unwatchedLocations} 个位置未监听` : ` · ${status.unwatchedLocations} locations unmonitored`;
  if (status.excludedLocations) $('quickSearchStatus').textContent += locale === 'zh' ? ` · 排除 ${status.excludedLocations} 个目录` : ` · ${status.excludedLocations} excluded folders`;
  $('quickSearchStatus').title = qt('recent');
  const button = $('quickSearchPopover').querySelector('[data-quick-rebuild]'); if (button) button.disabled = !!status.indexing;
}
async function rebuildQuickIndex() {
  const button = $('quickSearchPopover').querySelector('[data-quick-rebuild]'); button.disabled = true;
  try { await invoke('search_rebuild'); toast(qt('starting')); await updateQuickStatus(); if (quickState.open) requestQuickRefresh(); }
  catch (error) { toast(String(error), true); button.disabled = false; }
}
