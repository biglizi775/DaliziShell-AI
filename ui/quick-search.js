/* One workspace search field: local filtering or bounded index queries. */
const QUICK_TEXT = {
  zh: { title: '搜索结果', local: '当前目录', tree: '含子目录', global: '全部位置', localHint: '筛选名称', placeholder: '文件名或 ext:pdf…', all: '全部', file: '文件', dir: '文件夹', rebuild: '重新校验索引', close: '收起结果', name: '名称', location: '所在位置', size: '大小', actions: '操作', empty: '在上方输入关键词', hint: '空格分隔关键词 · ext:rs;js · ↑ ↓ 选择 · Enter 打开', noResults: '没有找到匹配项目', searching: '正在搜索…', indexed: '已索引', indexing: '后台索引中，结果持续补充', ready: '文件名索引就绪', cached: '已恢复缓存', recent: '近期缓存优先复用，后台校验离线期间的变化', matches: '个匹配', limited: '仅显示前 200 项，请增加关键词', reveal: '在资源管理器中定位', copy: '复制路径', copied: '路径已复制', error: '搜索失败', starting: '索引已在后台开始校验', noScope: '请先打开一个本地文件夹', stale: '文件可能已移动或删除，可重新校验索引', range: '搜索范围', terminal: '终端启动目录及子目录' },
  en: { title: 'Search results', local: 'This folder', tree: 'Subfolders', global: 'Everywhere', localHint: 'Filter names', placeholder: 'Name or ext:pdf…', all: 'All', file: 'Files', dir: 'Folders', rebuild: 'Revalidate index', close: 'Hide results', name: 'Name', location: 'Location', size: 'Size', actions: 'Actions', empty: 'Type in the search field above', hint: 'Space-separated words · ext:rs;js · ↑ ↓ Select · Enter Open', noResults: 'No matching items', searching: 'Searching…', indexed: 'Indexed', indexing: 'Indexing; results are partial', ready: 'Filename index ready', cached: 'Cache restored', recent: 'Recent cache is reused while offline changes await validation', matches: 'matches', limited: 'Showing the first 200; add keywords', reveal: 'Show in Explorer', copy: 'Copy path', copied: 'Path copied', error: 'Search failed', starting: 'Background index validation started', noScope: 'Open a local folder first', stale: 'The item may have moved or been deleted. Revalidate the index.', range: 'Search scope', terminal: 'Terminal starting folder and descendants' },
};
const qt = (key) => QUICK_TEXT[locale === 'zh' ? 'zh' : 'en'][key] || key;
const quickState = { token: 0, timer: null, poll: null, mode: 'local', kind: 'all', scope: null, items: [], selected: -1, status: null, pending: false, open: false, owner: null, folder: null, locale: null };
function quickQuery(query, kind) { const value = query.trim(); return value && kind !== 'all' ? `type:${kind} ${value}` : value; }
function quickFolder() { const path = isTermTab(curTab()) ? curTab().cwd : state.path; return path && /^[a-z]:[\\/]/i.test(path) ? path : null; }
function quickMode() {
  if (quickState.mode === 'local' && (isTermTab(curTab()) || !state.path)) return 'global';
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
  popup.addEventListener('click', (event) => {
    if (event.target.closest('[data-quick-close]')) { $('search').focus(); closeQuickSearch(); return; }
    if (event.target.closest('[data-quick-rebuild]')) { rebuildQuickIndex(); return; }
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
  listen('index-updated', () => { if (quickState.open && quickState.timer === null && $('search').value.trim()) scheduleQuickSearch(500); }).catch(() => {});
  syncQuickSearchWorkspace();
}
function syncQuickSearchWorkspace() {
  if (!$('searchMode')) return;
  const owner = curTab(), folder = quickFolder();
  if (owner !== quickState.owner || folder !== quickState.folder) {
    closeQuickSearch(); quickState.owner = owner; quickState.folder = folder;
    $('search').value = ''; state.filter = ''; quickState.kind = 'all';
  }
  const mode = quickMode(), localAvailable = !isTermTab(owner) && state.path !== null;
  const selector = $('searchMode');
  for (const option of selector.options) { option.textContent = qt(option.value); option.disabled = option.value === 'local' ? !localAvailable : option.value === 'tree' ? !folder : false; }
  selector.value = mode; selector.setAttribute('aria-label', qt('range'));
  $('search').placeholder = qt(mode === 'local' ? 'localHint' : 'placeholder');
  $('search').setAttribute('aria-label', qt('range') + ' · ' + qt(mode));
  $('searchClear').style.visibility = $('search').value ? 'visible' : 'hidden';
  if (quickState.locale !== locale) { quickState.locale = locale; if (quickState.open) { buildQuickPopover(); scheduleQuickSearch(0); } }
  positionQuickSearch();
}
function setWorkspaceSearchMode(mode) {
  if (!['local', 'tree', 'global'].includes(mode)) return;
  quickState.mode = mode; store.set('searchMode', mode); closeQuickSearch();
  handleWorkspaceSearchInput(); $('search').focus();
}
function handleWorkspaceSearchInput() {
  const mode = quickMode();
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
  paintQuickFilters(); paintQuickResults(); paintQuickStatus();
}
function paintQuickFilters() { $('quickSearchPopover').querySelectorAll('[data-quick-kind]').forEach((button) => { const active = button.dataset.quickKind === quickState.kind; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }); }
function showQuickSearch() {
  if (quickMode() === 'local') return;
  const popup = $('quickSearchPopover'); if (!popup) return;
  if (!quickState.open) {
    quickState.open = true; buildQuickPopover(); popup.classList.remove('hidden'); $('search').setAttribute('aria-expanded', 'true');
    updateQuickStatus(); quickState.poll = setInterval(updateQuickStatus, 2500);
  }
  positionQuickSearch(); scheduleQuickSearch(150);
}
function closeQuickSearch() {
  quickState.token++; clearTimeout(quickState.timer); clearInterval(quickState.poll);
  quickState.timer = null; quickState.poll = null; quickState.open = false; quickState.pending = false; quickState.items = []; quickState.selected = -1;
  $('quickSearchPopover')?.classList.add('hidden'); $('search')?.setAttribute('aria-expanded', 'false');
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
  const query = quickQuery(e.input.value, quickState.kind), owner = curTab(), scope = quickMode() === 'tree' ? quickFolder() : null;
  if (!query) { quickState.pending = false; quickState.items = []; quickState.selected = -1; paintQuickResults(); return; }
  quickState.pending = true; quickState.scope = scope; e.count.textContent = qt('searching');
  try {
    const result = await invoke('search_files', { query, limit: 200, scope });
    if (token !== quickState.token || !quickState.open || owner !== curTab() || scope !== (quickMode() === 'tree' ? quickFolder() : null)) return;
    if (result.cancelled) { scheduleQuickSearch(250); return; }
    quickState.status = result; quickState.items = result.items || []; quickState.selected = quickState.items.length ? 0 : -1; quickState.pending = false;
    paintQuickResults(result); paintQuickStatus();
  } catch (error) {
    if (token !== quickState.token || !quickState.open || owner !== curTab()) return;
    quickState.pending = false; quickState.items = []; quickState.selected = -1;
    e.results.innerHTML = `<div class="quick-empty">${esc(qt('error'))}<small>${esc(String(error))}</small></div>`; e.count.textContent = '';
  }
}
function scheduleQuickSearch(delay = 150) {
  const token = ++quickState.token; clearTimeout(quickState.timer);
  quickState.pending = true; quickState.items = []; quickState.selected = -1;
  if (quickState.open) { paintQuickResults(); $('quickSearchCount').textContent = $('search').value.trim() ? qt('searching') : ''; }
  quickState.timer = setTimeout(() => { quickState.timer = null; runQuickSearch(token); }, delay);
}
function paintQuickResults(result) {
  const e = quickElements(); if (!e.results) return;
  const query = e.input?.value.trim();
  e.count.textContent = result ? `${Number(result.total || 0).toLocaleString()} ${qt('matches')}${result.truncated ? ' · ' + qt('limited') : ''}` : '';
  e.results.innerHTML = quickState.items.map((entry, index) => `<div class="quick-result${index === quickState.selected ? ' selected' : ''}" role="option" aria-selected="${index === quickState.selected}" tabindex="-1" data-quick-result="${index}"><div class="quick-file">${entry.isDir ? IC.folderS : IC.fileS}<span><strong title="${esc(entry.name)}">${esc(entry.name)}</strong><small>${esc(fmtDate(entry.mtime))}</small></span></div><div class="quick-path" title="${esc(entry.path)}">${esc(parentOf(entry.path) || entry.path)}</div><div class="quick-size">${entry.size == null ? '—' : esc(fmtSize(entry.size))}</div><div class="quick-actions"><button class="ibtn" data-quick-action="reveal" title="${esc(qt('reveal'))}" aria-label="${esc(qt('reveal'))}">${IC.folderS}</button><button class="ibtn" data-quick-action="copy" title="${esc(qt('copy'))}" aria-label="${esc(qt('copy'))}">${IC.copy}</button></div></div>`).join('') || `<div class="quick-empty">${IC.search}<strong>${esc(qt(query ? quickState.pending ? 'searching' : 'noResults' : 'empty'))}</strong><small>${esc(qt('hint'))}</small></div>`;
}
function paintQuickSelection(scroll = false) { $('quickSearchResults').querySelectorAll('[data-quick-result]').forEach((row, index) => { row.classList.toggle('selected', index === quickState.selected); row.setAttribute('aria-selected', String(index === quickState.selected)); if (scroll && index === quickState.selected) row.scrollIntoView({ block: 'nearest' }); }); }
async function activateQuickResult(index, action) {
  const entry = quickState.items[index]; if (!entry || quickState.pending) return;
  try {
    if (action === 'copy') { await navigator.clipboard.writeText(entry.path); toast(qt('copied')); }
    else if (action === 'reveal') await invoke('reveal', { path: entry.path });
    else if (entry.isDir) { closeQuickSearch(); await navigate(entry.path); }
    else await invoke('open_path', { path: entry.path });
  } catch (error) { toast(`${qt('stale')} · ${String(error)}`, true); }
}
async function updateQuickStatus() {
  if (!quickState.open) return;
  const owner = curTab();
  try { const status = await invoke('search_status'); if (quickState.open && owner === curTab()) { quickState.status = status; paintQuickStatus(); } } catch {}
}
function paintQuickStatus() {
  const status = quickState.status; if (!status || !$('quickSearchStatus')) return;
  $('quickSearchStatus').textContent = `${qt('indexed')} ${(status.indexed || 0).toLocaleString()} · ${qt(status.indexing ? 'indexing' : 'ready')}${status.cacheRestored ? ' · ' + qt('cached') : ''}`;
  if (status.indexLimitReached) $('quickSearchStatus').textContent += locale === 'zh' ? ' · 索引达到上限，范围不完整' : ' · Index limit reached; coverage is incomplete';
  $('quickSearchStatus').title = qt('recent');
  const button = $('quickSearchPopover').querySelector('[data-quick-rebuild]'); if (button) button.disabled = !!status.indexing;
}
async function rebuildQuickIndex() {
  const button = $('quickSearchPopover').querySelector('[data-quick-rebuild]'); button.disabled = true;
  try { await invoke('search_rebuild'); toast(qt('starting')); await updateQuickStatus(); if (quickState.open) scheduleQuickSearch(300); }
  catch (error) { toast(String(error), true); button.disabled = false; }
}
