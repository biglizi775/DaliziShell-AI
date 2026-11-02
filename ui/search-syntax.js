'use strict';
/* The Rust parser owns grammar/precedence/date ranges for all three search scopes. */
const localSearch = { token: 0, timer: null, match: null, needsPath: false };
function compileSearchExpression(node) {
  if (!node) return () => true;
  const value = node.value;
  if (node.op === 'and' || node.op === 'or') { const terms = value.map(compileSearchExpression); return node.op === 'and' ? (e) => terms.every((f) => f(e)) : (e) => terms.some((f) => f(e)); }
  if (node.op === 'not') { const term = compileSearchExpression(value); return (e) => !term(e); }
  if (node.op === 'name' || node.op === 'path') {
    const text = value.text; let test;
    if (/[*?]/u.test(text)) {
      let pattern = '^'; const chars = [...text];
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        if (ch === '*' && chars[i + 1] === '*') { pattern += '.*'; i++; }
        else if (ch === '*') pattern += '[^\\\\]*';
        else if (ch === '?') pattern += '[^\\\\]';
        else pattern += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      const regex = new RegExp(pattern + '$', 'u'); test = (s) => regex.test(s);
    } else test = (s) => s.includes(text);
    return (e) => test(node.op === 'name' ? e.name : e.path);
  }
  if (node.op === 'parent') return (e) => e.parent.replace(/\\+$/, '') === value;
  if (node.op === 'kind') return (e) => e.isDir === value;
  if (node.op === 'extension') return (e) => !e.isDir && e.name.includes('.') && value.includes(e.name.slice(e.name.lastIndexOf('.') + 1));
  if (node.op === 'size' || node.op === 'modified') return (e) => {
    const number = node.op === 'size' ? e.size : e.mtime || null;
    return number != null && (value.min == null || (value.minInclusive ? number >= value.min : number > value.min)) && (value.max == null || (value.maxInclusive ? number <= value.max : number < value.max));
  };
  throw new Error('Unsupported search expression');
}
function resetLocalSearch() {
  localSearch.token++; clearTimeout(localSearch.timer); localSearch.timer = null; localSearch.match = null; localSearch.needsPath = false; state.filterError = '';
  $('search')?.removeAttribute('aria-invalid'); $('search')?.removeAttribute('aria-busy');
}
function matchLocalSearch(entry) {
  if (!localSearch.match) return true;
  const parent = localSearch.needsPath ? (state.path || '').replace(/\//g, '\\').toLowerCase() : '';
  return localSearch.match({ name: entry.nameLower || entry.name.toLowerCase(), isDir: entry.isDir, size: entry.isDir ? entry.dirSize : entry.size, mtime: entry.mtime,
    parent, path: localSearch.needsPath ? parent.replace(/\\+$/, '') + '\\' + entry.name.toLowerCase() : '' });
}
function updateLocalSearch(query) {
  const token = ++localSearch.token; clearTimeout(localSearch.timer); state.filter = query; state.filterError = '';
  const input = $('search'); input.removeAttribute('aria-invalid'); input.removeAttribute('aria-busy');
  if (new TextEncoder().encode(query).length <= 1024 && query.trim().split(/\s+/u).length <= 128 && (!query.trim() || !/["*?!|<>:\/\\]/u.test(query))) {
    const terms = query.toLowerCase().trim().split(/\s+/u).filter(Boolean);
    localSearch.match = terms.length ? (entry) => terms.every((term) => entry.name.includes(term)) : null;
    localSearch.needsPath = false; els.scroller.scrollTop = 0; renderAll(); return;
  }
  const owner = curTab(), folder = state.path;
  input.setAttribute('aria-busy', 'true');
  state.filterError = locale === 'zh' ? '正在解析筛选条件…' : 'Parsing search…'; renderStatus();
  localSearch.timer = setTimeout(async () => {
    try {
      const plan = await invoke('search_parse', { query });
      if (token !== localSearch.token || owner !== curTab() || folder !== state.path || quickMode() !== 'local') return;
      localSearch.match = compileSearchExpression(plan.root); localSearch.needsPath = plan.needs_path;
      state.filterError = ''; input.removeAttribute('aria-busy'); els.scroller.scrollTop = 0; renderAll();
    } catch (error) {
      if (token !== localSearch.token || owner !== curTab() || folder !== state.path) return;
      localSearch.match = () => false; state.filterError = String(error); input.removeAttribute('aria-busy'); input.setAttribute('aria-invalid', 'true'); renderAll();
    }
  }, 120);
}
function initSearchSyntax() {
  const button = document.createElement('button'); button.id = 'searchSyntaxHelp'; button.type = 'button'; button.textContent = '?';
  button.setAttribute('aria-label', '搜索语法 / Search syntax'); button.title = '搜索语法 / Search syntax';
  $('searchWrap').appendChild(button); button.addEventListener('click', openSearchSyntaxHelp);
}
function openSearchSyntaxHelp() {
  if ($('searchSyntaxDialog')?.open) return;
  closeQuickSearch(); const T = (zh, en) => locale === 'zh' ? zh : en;
  const examples = [
    ['预算 报告', T('名称同时包含两个关键词', 'Name contains both words')], ['"年度 报告"', T('名称包含完整词组', 'Name contains the phrase')],
    ['*.pdf|*.docx !草稿', T('PDF 或 Word，并排除“草稿”', 'PDF or Word, excluding 草稿')], ['报告?.pdf', T('? 匹配一个字符，* 匹配任意数量字符', '? matches one character; * matches any number')],
    ['ext:xlsx;csv size:>10mb', T('大于 10 MB 的指定格式文件', 'Selected extensions larger than 10 MB')], ['file: size:1mb..50mb', T('大小范围，包含两端；1 KB = 1024 字节', 'Inclusive size range; 1 KB = 1024 bytes')],
    ['folder: 项目', T('仅搜索文件夹', 'Folders only')], ['path:"D:\\工作资料\\" !备份', T('完整路径条件与排除项', 'Full-path condition with an exclusion')],
    ['parent:"D:\\工作资料"', T('只匹配此目录直接包含的项目', 'Direct children of this directory only')], ['dm:today', T('今天修改，使用本机时区', 'Modified today, using local time')],
    ['dm:7days', T('最近七个自然日，包含今天', 'Last seven calendar days, including today')], ['dm:2026-01-01..2026-12-31', T('指定修改日期范围', 'Modified-date range')],
    ['<报告 ext:pdf>|预算', T('< > 分组；默认 ! 优先于 |，| 优先于空格', '< > grouping; precedence: !, then |, then space')],
  ];
  const dialog = document.createElement('dialog'); dialog.id = 'searchSyntaxDialog'; dialog.className = 'file-settings-dialog'; dialog.setAttribute('aria-labelledby', 'searchSyntaxTitle');
  dialog.innerHTML = `<header class="file-settings-head"><h2 id="searchSyntaxTitle">${T('搜索语法', 'Search syntax')}</h2><button type="button" data-syntax-close aria-label="${T('关闭', 'Close')}">×</button></header><div class="file-settings-body"><p>${T('当前目录、含子目录和全部位置支持相同的常用语法。', 'All three scopes support the same common syntax.')}</p><table class="search-syntax-table">${examples.map(([q, description]) => `<tr><td><code>${esc(q)}</code></td><td>${esc(description)}</td></tr>`).join('')}</table><p>${T('实现 Everything 常用语法子集；暂不支持 regex:、content:、拼音、重复文件和元数据扩展函数。未知函数会显示提示。目录大小只使用已有缓存，尚未计算的大小不参与大小条件匹配。含子目录/全部位置的结果受索引覆盖范围影响。', 'A common Everything syntax subset. regex:, content:, pinyin, duplicates and additional metadata functions are not supported. Unknown functions report errors. Folder sizes use cached values; unknown sizes cannot match size conditions. Indexed scopes depend on index coverage.')}</p></div><footer class="file-settings-footer"><button type="button" data-syntax-close>${T('知道了', 'Done')}</button></footer>`;
  document.body.appendChild(dialog); dialog.querySelectorAll('[data-syntax-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
}
