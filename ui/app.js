'use strict';
/* Dalizi Files — frontend logic */
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

/* ============================== i18n ============================== */
const L = {
  zh: {
    appName: '呆梨文件', quick: '快速访问', thisPC: '此电脑',
    back: '后退', fwd: '前进', up: '上一级', refresh: '刷新 (F5)',
    search: '搜索当前文件夹', switchLang: 'Switch to English',
    newFolder: '新建', cut: '剪切', copy: '复制', paste: '粘贴', rename: '重命名', del: '删除',
    sort: '排序', view: '查看', more: '更多',
    colName: '名称', colDate: '修改日期', colType: '类型', colSize: '大小',
    sortBy: '排序方式', asc: '升序', desc: '降序', viewMode: '视图', vList: '列表', vGrid: '网格',
    open: '打开', openWith: '打开方式…', openInExplorer: '在资源管理器中打开', copyPath: '复制完整路径',
    pathsCopied: '已复制 {n} 个完整路径（含文件名）', copyPathFailed: '复制路径失败，请重试',
    newFolderHere: '新建文件夹', showHidden: '显示隐藏项', language: '语言',
    newFolderName: '新建文件夹',
    statusItems: '{n} 个项目', statusSel: '已选 {m} 项', statusSelSize: '已选 {m} 项 · {size}',
    filtered: '(已筛选)', noMatch: '无匹配项',
    emptyDir: '此文件夹为空', loading: '正在加载…',
    indexing: '后台索引中…', calculatingSize: '计算中…', sizeUnavailable: '不可用',
    recents: '最近', newTab: '新建标签页', dupTab: '复制此标签页', closeTab: '关闭标签页', closeOtherTabs: '关闭其他标签页',
    pinQuick: '固定到快速访问', unpinQuick: '从快速访问取消固定', removeRecent: '从最近移除',
    openInTerminal: '在终端中打开', newTermTab: '新建终端标签页（PowerShell）', terminal: '终端', procExited: '[进程已退出]',
    loadFail: '无法加载此文件夹', retry: '重试',
    selNone: '请先选择项目',
    quickAccess: '快速访问', drives: '驱动器和位置',
    localDisk: '本地磁盘', freeOf: '{free} 可用，共 {total}',
    typeFolder: '文件夹', typePlainFile: '文件', typeExtFile: '{x} 文件',
    types: {
      txt: '文本文档', log: '文本文档', ini: '配置文件', cfg: '配置文件',
      pdf: 'PDF 文档', epub: '电子书',
      zip: '压缩文件', rar: '压缩文件', '7z': '压缩文件', gz: '压缩文件', tar: '压缩文件',
      png: 'PNG 图像', jpg: 'JPEG 图像', jpeg: 'JPEG 图像', gif: 'GIF 图像',
      webp: 'WebP 图像', svg: 'SVG 图像', ico: '图标文件', bmp: 'BMP 图像',
      mp4: 'MP4 视频', mkv: 'Matroska 视频', avi: 'AVI 视频', mov: 'QuickTime 视频',
      webm: 'WebM 视频', flv: 'Flash 视频',
      mp3: 'MP3 音频', wav: 'WAV 音频', flac: 'FLAC 音频', aac: 'AAC 音频', ogg: 'OGG 音频', m4a: 'M4A 音频',
      doc: 'Word 文档', docx: 'Word 文档', xls: 'Excel 工作表', xlsx: 'Excel 工作表',
      csv: 'CSV 文件', ppt: 'PowerPoint 演示文稿', pptx: 'PowerPoint 演示文稿',
      exe: '应用程序', msi: '应用程序包', bat: '批处理文件', cmd: '批处理文件',
      ps1: 'PowerShell 脚本', sh: 'Shell 脚本', dll: '应用程序扩展', so: '共享库',
      rs: 'Rust 源代码', go: 'Go 源代码', js: 'JavaScript 文件', mjs: 'JavaScript 文件',
      ts: 'TypeScript 文件', jsx: 'React 组件', tsx: 'React 组件', vue: 'Vue 组件',
      py: 'Python 脚本', c: 'C 源代码', cpp: 'C++ 源代码', h: 'C 头文件', hpp: 'C++ 头文件',
      cs: 'C# 源代码', java: 'Java 源代码', kt: 'Kotlin 源代码', swift: 'Swift 源代码',
      html: 'HTML 文档', htm: 'HTML 文档', css: '样式表', scss: 'Sass 样式表',
      json: 'JSON 文件', xml: 'XML 文档', yml: 'YAML 文件', yaml: 'YAML 文件',
      toml: 'TOML 文件', md: 'Markdown 文档', sql: 'SQL 文件', iso: '光盘映像', lnk: '快捷方式',
    },
    quickNames: { desktop: '桌面', documents: '文档', downloads: '下载', pictures: '图片', music: '音乐', videos: '视频' },
    cancelled: '操作已取消', pastedHint: '',
  },
  en: {
    appName: 'Dalizi Files', quick: 'Quick access', thisPC: 'This PC',
    back: 'Back', fwd: 'Forward', up: 'Up', refresh: 'Refresh (F5)',
    search: 'Search current folder', switchLang: '切换到中文',
    newFolder: 'New', cut: 'Cut', copy: 'Copy', paste: 'Paste', rename: 'Rename', del: 'Delete',
    sort: 'Sort', view: 'View', more: 'More',
    colName: 'Name', colDate: 'Date modified', colType: 'Type', colSize: 'Size',
    sortBy: 'Sort by', asc: 'Ascending', desc: 'Descending', viewMode: 'View', vList: 'List', vGrid: 'Grid',
    open: 'Open', openWith: 'Open with…', openInExplorer: 'Open in File Explorer', copyPath: 'Copy full path',
    pathsCopied: 'Copied {n} full path(s), including file names', copyPathFailed: 'Could not copy paths. Please try again',
    newFolderHere: 'New folder', showHidden: 'Show hidden items', language: 'Language',
    newFolderName: 'New folder',
    statusItems: '{n} items', statusSel: '{m} selected', statusSelSize: '{m} selected · {size}',
    filtered: '(filtered)', noMatch: 'No matches',
    emptyDir: 'This folder is empty', loading: 'Loading…',
    indexing: 'Indexing in background…', calculatingSize: 'Calculating…', sizeUnavailable: 'Unavailable',
    recents: 'Recent', newTab: 'New tab', dupTab: 'Duplicate tab', closeTab: 'Close tab', closeOtherTabs: 'Close other tabs',
    pinQuick: 'Pin to Quick access', unpinQuick: 'Unpin from Quick access', removeRecent: 'Remove from Recent',
    openInTerminal: 'Open in Terminal', newTermTab: 'New terminal tab (PowerShell)', terminal: 'Terminal', procExited: '[process exited]',
    loadFail: 'Cannot load this folder', retry: 'Retry',
    selNone: 'Select items first',
    quickAccess: 'Quick access', drives: 'Drives and locations',
    localDisk: 'Local Disk', freeOf: '{free} free of {total}',
    typeFolder: 'Folder', typePlainFile: 'File', typeExtFile: '{x} file',
    types: {
      txt: 'Text Document', log: 'Text Document', ini: 'Config file', cfg: 'Config file',
      pdf: 'PDF Document', epub: 'E-book',
      zip: 'Compressed folder', rar: 'Compressed folder', '7z': 'Compressed folder', gz: 'Compressed folder', tar: 'Compressed folder',
      png: 'PNG Image', jpg: 'JPEG Image', jpeg: 'JPEG Image', gif: 'GIF Image',
      webp: 'WebP Image', svg: 'SVG Image', ico: 'Icon file', bmp: 'BMP Image',
      mp4: 'MP4 Video', mkv: 'Matroska Video', avi: 'AVI Video', mov: 'QuickTime Video',
      webm: 'WebM Video', flv: 'Flash Video',
      mp3: 'MP3 Audio', wav: 'WAV Audio', flac: 'FLAC Audio', aac: 'AAC Audio', ogg: 'OGG Audio', m4a: 'M4A Audio',
      doc: 'Word Document', docx: 'Word Document', xls: 'Excel Worksheet', xlsx: 'Excel Worksheet',
      csv: 'CSV File', ppt: 'PowerPoint Presentation', pptx: 'PowerPoint Presentation',
      exe: 'Application', msi: 'Application package', bat: 'Batch file', cmd: 'Batch file',
      ps1: 'PowerShell Script', sh: 'Shell Script', dll: 'Application extension', so: 'Shared library',
      rs: 'Rust Source Code', go: 'Go Source Code', js: 'JavaScript File', mjs: 'JavaScript File',
      ts: 'TypeScript File', jsx: 'React Component', tsx: 'React Component', vue: 'Vue Component',
      py: 'Python Script', c: 'C Source Code', cpp: 'C++ Source Code', h: 'C Header File', hpp: 'C++ Header File',
      cs: 'C# Source Code', java: 'Java Source Code', kt: 'Kotlin Source Code', swift: 'Swift Source Code',
      html: 'HTML Document', htm: 'HTML Document', css: 'Stylesheet', scss: 'Sass Stylesheet',
      json: 'JSON File', xml: 'XML Document', yml: 'YAML File', yaml: 'YAML File',
      toml: 'TOML File', md: 'Markdown Document', sql: 'SQL File', iso: 'Disc Image', lnk: 'Shortcut',
    },
    quickNames: { desktop: 'Desktop', documents: 'Documents', downloads: 'Downloads', pictures: 'Pictures', music: 'Music', videos: 'Videos' },
    cancelled: 'Operation cancelled', pastedHint: '',
  },
};

const store = {
  get(k, d) { try { const v = localStorage.getItem('df.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('df.' + k, JSON.stringify(v)); if (typeof portableSettingsChanged === 'function') portableSettingsChanged(k); } catch {} },
};

let locale = store.get('locale', (navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en');
let dfmt = null;
const t = (k) => (L[locale] && L[locale][k] !== undefined ? L[locale][k] : k);
const tf = (k, vals) => {
  let s = String(t(k));
  for (const [key, v] of Object.entries(vals || {})) s = s.replace('{' + key + '}', v);
  return s;
};
function setLocale(l) {
  locale = l;
  store.set('locale', l);
  dfmt = null;
  document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en-US';
  renderAll();
}

/* ============================== icons ============================== */
const S = (inner, extra) =>
  `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${extra || ''}>${inner}</svg>`;

const IC = {
  back: S('<path d="M12.5 4.5 7 10l5.5 5.5"/>'),
  fwd: S('<path d="M7.5 4.5 13 10l-5.5 5.5"/>'),
  up: S('<path d="M10 15.5V5"/><path d="M5.5 9 10 4.5 14.5 9"/>'),
  refresh: S('<path d="M15.5 10a5.5 5.5 0 1 1-1.6-3.9"/><path d="M15.5 3.5v3h-3"/>'),
  search: S('<circle cx="9" cy="9" r="5"/><path d="m13.5 13.5 3 3"/>'),
  x: S('<path d="M5 5l10 10M15 5 5 15"/>'),
  cut: S('<circle cx="6" cy="6" r="2"/><circle cx="6" cy="14" r="2"/><path d="M7.7 7.3 16 16M16 4 7.7 12.7"/>'),
  copy: S('<rect x="7" y="7" width="9" height="9" rx="1.5"/><path d="M13 4H5.5A1.5 1.5 0 0 0 4 5.5V13"/>'),
  paste: S('<rect x="5" y="4.5" width="10" height="11.5" rx="1.5"/><path d="M8.5 4.5V3h3v1.5"/><path d="M8 10h4M8 12.5h2.5"/>'),
  pencil: S('<path d="m13.5 3.5 3 3L7.5 15.5l-4 .9.9-4z"/>'),
  trash: S('<path d="M4 6h12M8 6V4.5h4V6M6.2 6l.6 10h6.4l.6-10M8.5 9v4M11.5 9v4"/>'),
  sort: S('<path d="M4 5.5h9M4 10h6M4 14.5h3"/><path d="m13 12 2.5 2.5L18 12"/>'),
  list: S('<path d="M4 5h2M4 10h2M4 15h2M8.5 5H16M8.5 10H16M8.5 15H16"/>'),
  grid: S('<rect x="4" y="4" width="5" height="5" rx="1"/><rect x="11" y="4" width="5" height="5" rx="1"/><rect x="4" y="11" width="5" height="5" rx="1"/><rect x="11" y="11" width="5" height="5" rx="1"/>'),
  more: S('<circle cx="5" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.2" fill="currentColor" stroke="none"/>'),
  chevR: S('<path d="m8 4.5 5.5 5.5L8 15.5"/>'),
  plus: S('<path d="M10 5v10M5 10h10"/>'),
  openIc: S('<path d="M11.5 4.5H16V9"/><path d="M16 4.5 9.5 11"/><path d="M15 12v3a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 4 15V6a1.5 1.5 0 0 1 1.5-1.5"/>'),
  monitor: S('<rect x="3" y="4" width="14" height="9.5" rx="1.5"/><path d="M8 16.5h4M10 13.5v3"/>'),
  globe: S('<circle cx="10" cy="10" r="6.5"/><path d="M3.5 10h13M10 3.5c-3.5 3.5-3.5 9.5 0 13 3.5-3.5 3.5-9.5 0-13z"/>'),
  disc: S('<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="1.6"/>'),
  usb: S('<rect x="7" y="3" width="6" height="14" rx="1.5"/><path d="M10 6.5v3"/><path d="M8.7 12h2.6"/>'),
  downTray: S('<path d="M10 4v7.5"/><path d="m6.5 8.5 3.5 3 3.5-3"/><path d="M4.5 15h11"/>'),
  photoIc: S('<rect x="3.5" y="4.5" width="13" height="11" rx="1.5"/><circle cx="7.6" cy="8" r="1.1"/><path d="m5.5 13 3-3 2 2 2-2 2 2"/>'),
  musicIc: S('<path d="M8.6 12.8V6.5l5-1v6"/><circle cx="7.5" cy="13" r="1.5"/><circle cx="12.5" cy="11.5" r="1.5"/>'),
  filmIc: S('<rect x="3.5" y="5" width="13" height="10" rx="1.5"/><path d="M7 5v10M13 5v10"/>'),
  tconsole: S('<rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><path d="m6 7.5 2.5 2.2L6 12.2"/><path d="M10.5 12.5H14"/>'),
  folderS: S('<path d="M2.5 5.7c0-.7.6-1.2 1.2-1.2h3.6l1.6 1.8h7.4c.7 0 1.2.6 1.2 1.2v7.6c0 .7-.6 1.2-1.2 1.2H3.7c-.7 0-1.2-.6-1.2-1.2z"/>', 'stroke="#ffd479"'),
  fileS: S('<path d="M5.5 3h6L15.5 7v8.5a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5v-12z"/><path d="M11.5 3v4h4"/>'),
  home: S('<path d="m10 4 6 5v7a1 1 0 0 1-1 1h-3.5v-5h-3v5H5a1 1 0 0 1-1-1V9z"/>'),
};

const folderSvg = (big) =>
  `<svg viewBox="0 0 20 20" ${big ? 'width="48" height="48"' : ''}><path d="M1.8 5.4c0-.7.6-1.3 1.3-1.3h4.2l1.8 2h8.8c.7 0 1.3.6 1.3 1.3v8.2c0 .7-.6 1.3-1.3 1.3H3.1c-.7 0-1.3-.6-1.3-1.3V5.4z" fill="#e8a33d"/><path d="M1.8 8.2h16.6v7.4c0 .7-.6 1.3-1.3 1.3H3.1c-.7 0-1.3-.6-1.3-1.3V8.2z" fill="#f7c264"/></svg>`;

const page = (color, label, glyph) =>
  `<svg viewBox="0 0 20 20"><path d="M5.2 2.6h6L15.6 7v9.4c0 .7-.6 1.3-1.3 1.3H6.5c-.7 0-1.3-.6-1.3-1.3V3.9c0-.7.6-1.3 1.3-1.3z" fill="${color}"/><path d="M11 2.7v4.1h4.3l-4.3-4.1z" fill="rgba(0,0,0,0.22)"/>${glyph || ''}</svg>`;

const glyphTxt = (txt) =>
  `<text x="10.4" y="14.6" font-size="6.2" font-weight="700" fill="#fff" text-anchor="middle" font-family="Segoe UI, sans-serif">${txt}</text>`;
const glyphImg = '<circle cx="8" cy="9" r="1.4" fill="#fff"/><path d="M6.5 14.5l3-3.5 2 2.2 1.6-1.7 2.3 3z" fill="#fff"/>';
const glyphPlay = '<path d="M8.2 7.2v6l5-3z" fill="#fff"/>';
const glyphNote = '<path d="M8.6 13V6.4l5-1v5.9" stroke="#fff" stroke-width="1.2" fill="none"/><circle cx="7.6" cy="13" r="1.5" fill="#fff"/><circle cx="12.6" cy="11.3" r="1.5" fill="#fff"/>';
const glyphCode = '<path d="M8 8.5 6 10.5l2 2M12 8.5l2 2-2 2" stroke="#fff" stroke-width="1.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
const glyphZip = '<path d="M9.5 3.5v2M9.5 7v2M9.5 10.5v2" stroke="#fff" stroke-width="1.2"/><circle cx="9.5" cy="14" r="1.4" fill="#fff"/>';

const EXT_ICON = {
  pdf: ['#e5484d', glyphTxt('PDF')],
  doc: '#3b6fd4', docx: '#3b6fd4',
  xls: '#2da44e', xlsx: '#2da44e', csv: '#2da44e',
  ppt: '#e07b39', pptx: '#e07b39',
  zip: ['#e8a33d', glyphZip], rar: ['#e8a33d', glyphZip], '7z': ['#e8a33d', glyphZip],
  gz: ['#e8a33d', glyphZip], tar: ['#e8a33d', glyphZip],
  exe: ['#8b93a1', glyphTxt('EX')], msi: ['#8b93a1', glyphTxt('EX')],
  bat: '#8b93a1', cmd: '#8b93a1', ps1: '#8b93a1', sh: '#8b93a1',
  dll: '#8b93a1',
};
const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const VID_EXT = new Set(['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv']);
const AUD_EXT = new Set(['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a']);
const CODE_EXT = new Set(['rs', 'go', 'js', 'mjs', 'ts', 'jsx', 'tsx', 'vue', 'py', 'c', 'cpp', 'h', 'hpp', 'cs', 'java', 'kt', 'swift', 'html', 'htm', 'css', 'scss', 'json', 'xml', 'yml', 'yaml', 'toml', 'md', 'sql', 'txt', 'log', 'ini', 'cfg']);

function fileIcon(e, big) {
  if (e.isDir) return folderSvg(big);
  const ext = e.ext;
  let cfg = EXT_ICON[ext];
  if (cfg) return page(Array.isArray(cfg) ? cfg[0] : cfg, ext, Array.isArray(cfg) ? cfg[1] : glyphTxt(ext.slice(0, 3).toUpperCase()));
  if (IMG_EXT.has(ext)) return page('#3aa66d', ext, glyphImg);
  if (VID_EXT.has(ext)) return page('#8d6ce0', ext, glyphPlay);
  if (AUD_EXT.has(ext)) return page('#2ba7a0', ext, glyphNote);
  if (CODE_EXT.has(ext)) return page('#4d7dc4', ext, glyphCode);
  return page('#9aa4b2', ext, '');
}

function driveIcon(dtype) {
  if (dtype === 'network') return IC.globe;
  if (dtype === 'removable') return IC.usb;
  if (dtype === 'cdrom') return IC.disc;
  return IC.monitor;
}

/* ============================== state ============================== */
const state = {
  path: null,            // null = This PC root page
  entries: null,         // null when on root/error page
  view: [],
  filter: '',
  sortKey: store.get('sortKey', 'name'),
  sortDir: store.get('sortDir', 1),
  selection: new Set(),
  anchorIdx: -1,
  clipboard: null,       // {mode:'copy'|'cut', paths:[]}
  viewMode: store.get('viewMode', 'details') === 'grid' ? 'grid' : 'details',
  typeFilter: 'all',
  showHidden: store.get('showHidden', false),
  tabs: [{ path: null, history: [], hIdx: -1 }],   // browser-style tabs (files or embedded terminal)
  tab: 0,
  pinned: store.get('pinned', []),                  // user-pinned quick access folders
  recents: store.get('recents', []),                // recently visited folders
  folderHistory: store.get('folderHistory', []),   // persisted folder access history
  loading: false,
  error: null,
  renaming: null,
  roots: null,
  navToken: 0,
  dirSizes: new Map(),   // path -> byte size (folder sizes, session cache)
  gen: 0,                // listing generation; gates dir-size events
  gridCols: 8,
};

const ROWH = { details: 44, grid: 136 };

const curTab = () => state.tabs[state.tab];

const $ = (id) => document.getElementById(id);
const els = {};
for (const id of ['tabbar', 'bar1', 'bar2', 'btnBack', 'btnFwd', 'btnUp', 'btnRefresh', 'crumbs', 'searchWrap', 'search',
  'searchIcon', 'searchClear', 'btnLang', 'btnNew', 'btnCut', 'btnCopy', 'btnPaste', 'btnRename', 'btnDelete',
  'btnSort', 'btnView', 'btnMore', 'side', 'content', 'dhead', 'scroller', 'sizer', 'rows', 'rootPage',
  'statePage', 'termHost', 'browserHost', 'browserToolbar', 'browserBack', 'browserForward', 'browserReload', 'browserHome', 'browserAddressForm', 'browserAddress', 'browserHistory', 'browserExtensions', 'loadBar', 'status', 'menuLayer', 'toasts']) els[id] = $(id);

/* ============================== utils ============================== */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const join = (p, n) => (/[\\/]$/.test(p) ? p + n : p + '\\' + n);
const basename = (p) => (p ? p.split('\\').pop() || p : '');

function fmtSize(b) {
  if (b < 1024) return b + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { b /= 1024; i++; } while (b >= 1024 && i < 3);
  return (b >= 100 ? b.toFixed(0) : b >= 10 ? b.toFixed(1) : b.toFixed(2)) + ' ' + u[i];
}
function fmtDate(ms) {
  if (!ms) return '';
  if (!dfmt) dfmt = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US',
    { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return dfmt.format(new Date(ms));
}
function typeLabel(e) {
  if (e.isDir) return t('typeFolder');
  if (!e.ext) return t('typePlainFile');
  const m = L[locale].types[e.ext];
  return m || tf('typeExtFile', { x: e.ext.toUpperCase() });
}
function parentOf(p) {
  if (p == null) return null;
  if (/^[a-zA-Z]:\\?$/.test(p)) return null;
  const q = p.replace(/[\\/]+$/, '');
  const i = q.lastIndexOf('\\');
  if (i < 0) return null;
  if (i === 2 && q[1] === ':') return q.slice(0, 3);
  const cut = q.slice(0, i);
  return cut.length >= 2 ? cut : null;
}
function toast(msg, isErr) {
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  els.toasts.appendChild(el);
  setTimeout(() => el.classList.add('out'), isErr ? 5000 : 2600);
  setTimeout(() => el.remove(), isErr ? 5500 : 3100);
}

/* ============================== navigation ============================== */
async function navigate(path, opts = {}) {
  path = normalizeNavigationPath(path);
  if (isTermTab(curTab()) || curTab()?.kind === 'browser') { newTab(path); return; }
  const { push = true } = opts;
  const token = ++state.navToken;
  const owner = curTab();
  const current = () => state.navToken === token && curTab() === owner;
  state.gen++;
  invoke('dir_sizes', { gen: state.gen, paths: [] }).catch(() => {});
  state.path = path;
  state.error = null;
  state.filter = '';
  state.typeFilter = 'all';
  els.search.value = '';
  state.selection = new Set();
  state.anchorIdx = -1;
  state.anchorName = null;
  state.focusName = null;
  state.revealName = null;
  state.renaming = null;
  state.loading = true;
  renderAll();

  try {
    if (path === null) {
      await invoke('watch', { path: '' });
      if (!current()) return;
      const roots = await invoke('roots');
      if (!current()) return;
      state.roots = roots;
      state.entries = null;
    } else {
      await invoke('watch', { path });
      if (!current()) return;
      const raw = await invoke('list_dir', { path });
      if (!current()) return;
      state.entries = prepareEntries(raw, path);
      if (!state.roots) state.roots = await invoke('roots').catch(() => null);
    }
  } catch (e) {
    if (!current()) return;
    state.error = String(e);
    state.entries = null;
    state.loading = false;
    renderAll();
    return;
  }
  if (!current()) return;
  state.loading = false;
  const tb = curTab();
  if (push) {
    tb.history = tb.history.slice(0, tb.hIdx + 1);
    tb.history.push(path);
    tb.hIdx = tb.history.length - 1;
  }
  tb.path = path;
  if (push && path !== null) addRecent(path);
  store.set('lastPath', path);
  renderAll();
  els.scroller.scrollTop = 0;
  requestDirSizes();
}

function normalizeNavigationPath(path) {
  // Only ordinary absolute drive paths have these lexical rules. UNC/device
  // paths keep their existing semantics; the backend still checks real paths.
  if (typeof path !== 'string' || !/^[a-zA-Z]:[\\/]/.test(path)) return path;
  const parts = [];
  for (const part of path.slice(3).split(/[\\/]+/)) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return path.slice(0, 2) + '\\' + parts.join('\\');
}

async function refresh(keep = true, hard = false) {
  if (state.loading || isTermTab(curTab()) || curTab()?.kind === 'browser') return;
  const token = ++state.navToken;
  const owner = curTab();
  const path = state.path;
  const current = () => state.navToken === token && curTab() === owner;
  if (state.path === null) {
    try {
      const roots = await invoke('roots');
      if (!current()) return;
      state.roots = roots;
    } catch {}
    if (!current()) return;
    renderAll();
    return;
  }
  if (hard) {
    state.gen++;
    invoke('dir_sizes', { gen: state.gen, paths: [] }).catch(() => {});
  }
  try {
    const raw = await invoke('list_dir', { path });
    if (!current()) return;
    if (state.renaming) {
      fsRefreshPending = { owner, path };
      scheduleFilesystemRefresh();
      return;
    }
    const before = state.entries;
    const entries = prepareEntries(raw, path);
    const names = new Set(raw.map((e) => e.name));
    // The user may select, scroll or start editing while enumeration is pending.
    // Reconcile the current state, never restore an IPC-start snapshot.
    const selection = new Set([...(keep ? state.selection : [])].filter((n) => names.has(n)));
    const changed = state.error || !sameDirectoryEntries(before, entries) || selection.size !== state.selection.size;
    state.selection = selection;
    state.entries = entries;
    state.error = null;
    if (changed) renderDirectoryRefresh();
    else {
      // Keep visible rows attached to the objects that receive size events.
      const byName = new Map(entries.map((entry) => [entry.name, entry]));
      state.view = (state.view || []).map((entry) => byName.get(entry.name));
    }
    requestDirSizes(hard);
  } catch (e) {
    if (!current()) return;
    toast(String(e), true);
  }
}

function sameDirectoryEntries(before, after) {
  if (!before || before.length !== after.length) return false;
  const previous = new Map(before.map((entry) => [entry.name, entry]));
  const fields = ['name', 'isDir', 'size', 'mtime', 'ctime', 'atime', 'attributes', 'readOnly', 'hidden', 'ext', 'dirSize', 'isReparse', 'dirSizeUnavailable'];
  return after.every((entry) => {
    const old = previous.get(entry.name);
    return old && fields.every((field) => old[field] === entry[field]);
  });
}

function renderDirectoryRefresh() {
  rebuildView();
  renderBar2();
  renderContent();
  renderStatus();
  renderPreview();
  $('pageSubtitle').textContent = `${u('filesCount').replace('{n}', state.view.length.toLocaleString())}  ·  ${u('selectHint')}`;
  if (typeof renderAiSelection === 'function') renderAiSelection();
}

function sizePathKey(path) { return path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase(); }
function cacheDirectorySize(path, size) {
  const key = sizePathKey(path);
  state.dirSizes.delete(key);
  state.dirSizes.set(key, size);
  while (state.dirSizes.size > 4096) state.dirSizes.delete(state.dirSizes.keys().next().value);
}
function canMeasureDirectory(entry, path = state.path) {
  return entry.isDir && !entry.isReparse && path != null && !path.startsWith('\\\\');
}
function prepareEntries(raw, path) {
  const byPath = new Map();
  const entries = raw.map((entry) => {
    const e = { ...entry, nameLower: entry.name.toLowerCase() };
    if (canMeasureDirectory(e, path)) {
      const full = join(path, e.name), key = sizePathKey(full);
      const cached = state.dirSizes.get(key) ?? state.dirSizes.get(full);
      e.dirSize = entry.dirSize ?? cached ?? null;
      if (e.dirSize != null) cacheDirectorySize(full, e.dirSize);
      byPath.set(key, e);
    }
    return e;
  });
  state.sizeEntries = byPath;
  return entries;
}

// Update one row or many without searching the complete directory for each result.
let pendingDirSizes = new Map();
let sizeFrame = null;
let sizeSortTimer = null;
let indexRefreshTimer = null;
let indexLookupRunning = false;
let indexLookupAgain = false;

function folderSizeLabel(entry) {
  if (entry.dirSize != null) return fmtSize(entry.dirSize);
  if (entry.dirSizeUnavailable) return t('sizeUnavailable');
  return canMeasureDirectory(entry) ? t('calculatingSize') : '—';
}
function queueDirSize(gen, path, size) {
  if (gen !== state.gen || (size !== null && (!Number.isFinite(size) || size < 0)) || isTermTab(curTab())) return;
  pendingDirSizes.set(sizePathKey(path), { gen, path, size });
  if (sizeFrame === null) sizeFrame = requestAnimationFrame(flushDirSizes);
}
function flushDirSizes() {
  sizeFrame = null;
  const pending = pendingDirSizes;
  pendingDirSizes = new Map();
  let changed = false;
  for (const [key, item] of pending) {
    if (item.gen !== state.gen || isTermTab(curTab())) continue;
    const entry = state.sizeEntries?.get(key);
    if (!entry) continue;
    if (item.size === null) {
      if (!entry.dirSizeUnavailable) { entry.dirSizeUnavailable = true; changed = true; }
      continue;
    }
    cacheDirectorySize(item.path, item.size);
    if (entry.dirSizeUnavailable) { entry.dirSizeUnavailable = false; changed = true; }
    if (entry.dirSize !== item.size) { entry.dirSize = item.size; changed = true; }
  }
  if (!changed) return;
  // Only the virtualized, visible DOM is visited, once for this batch.
  els.rows.querySelectorAll('[data-i]').forEach((row) => {
    const entry = state.view[+row.dataset.i];
    if (!entry?.isDir) return;
    const cell = row.querySelector('.csize');
    if (cell) cell.textContent = folderSizeLabel(entry);
  });
  if (typeof refreshEntryPropertySize === 'function') refreshEntryPropertySize();
  renderStatus();
  if (state.selection.size) renderPreview();
  if (state.sortKey === 'size') scheduleSizeSort();
}
function scheduleSizeSort() {
  clearTimeout(sizeSortTimer);
  const token = state.navToken;
  sizeSortTimer = setTimeout(() => {
    if (token !== state.navToken || isTermTab(curTab()) || state.sortKey !== 'size') return;
    if (state.renaming) { scheduleSizeSort(); return; }
    const scrollTop = els.scroller.scrollTop;
    rebuildView(); renderList();
    els.scroller.scrollTop = scrollTop;
  }, 250);
}

async function requestDirSizes(force = false) {
  if (state.path === null || !state.entries || isTermTab(curTab())) return;
  const paths = state.entries.filter((e) => canMeasureDirectory(e) && (force || (e.dirSize == null && !e.dirSizeUnavailable))).map((e) => {
    if (force) e.dirSizeUnavailable = false;
    return join(state.path, e.name);
  });
  if (paths.length) await invoke('dir_sizes', { gen: state.gen, paths, force }).catch(() => {});
}

function scheduleIndexLookup() {
  if (indexRefreshTimer !== null) return;
  indexRefreshTimer = setTimeout(() => { indexRefreshTimer = null; refreshIndexedSizes(); }, 200);
}
async function refreshIndexedSizes() {
  if (indexLookupRunning) { indexLookupAgain = true; return; }
  if (state.path === null || !state.entries || state.loading || isTermTab(curTab())) return;
  const token = state.navToken, gen = state.gen, owner = curTab();
  const paths = state.entries.filter((e) => canMeasureDirectory(e)).map((e) => join(state.path, e.name));
  if (!paths.length) return;
  indexLookupRunning = true;
  try {
    const sizes = await invoke('sizes_lookup', { paths });
    if (token !== state.navToken || gen !== state.gen || owner !== curTab()) return;
    sizes.forEach((size, i) => { if (size != null) queueDirSize(gen, paths[i], size); });
  } catch {} finally {
    indexLookupRunning = false;
    if (indexLookupAgain) { indexLookupAgain = false; scheduleIndexLookup(); }
  }
}

function goBack() { const tb = curTab(); if (isBrowserTab(tb)) { browserAction('back'); return; } if (tb.hIdx > 0) { tb.hIdx--; navigate(tb.history[tb.hIdx], { push: false }); } }
function goFwd() { const tb = curTab(); if (isBrowserTab(tb)) { browserAction('forward'); return; } if (tb.hIdx < tb.history.length - 1) { tb.hIdx++; navigate(tb.history[tb.hIdx], { push: false }); } }
function goUp() { const p = parentOf(state.path); if (p !== null || state.path !== null) navigate(p, { push: true }); }

function addRecent(p) {
  state.recents = state.recents.filter((x) => x !== p);
  state.recents.unshift(p);
  if (state.recents.length > 8) state.recents.length = 8;
  store.set('recents', state.recents);
  state.folderHistory = state.folderHistory.filter((x) => x.path !== p);
  state.folderHistory.unshift({ path: p, visitedAt: Date.now() });
  if (state.folderHistory.length > 100) state.folderHistory.length = 100;
  store.set('folderHistory', state.folderHistory);
  renderSidebar();
}

// ---- tabs ----
// A tab is either {kind:'files', path, history, hIdx} or
// {kind:'term', termId, cwd, term, fit, el, exited} (embedded PowerShell).
const isTermTab = (tb) => tb && tb.kind === 'term';
const isBrowserTab = (tb) => tb && tb.kind === 'browser';

function switchTab(i) {
  if (i === state.tab || i < 0 || i >= state.tabs.length) return;
  state.navToken++;
  state.tab = i;
  renderTabs();
  if (isTermTab(curTab())) {
    invoke('dir_sizes', { gen: state.gen, paths: [] }).catch(() => {});
    renderAll();
    if (curTab().term) curTab().term.focus();
  } else if (isBrowserTab(curTab())) {
    renderAll();
    if (typeof syncBrowserBounds === 'function') syncBrowserBounds();
  } else navigate(curTab().path, { push: false });
}
function newTab(path) {
  state.tabs.push({ path: null, history: [], hIdx: -1 });
  state.tab = state.tabs.length - 1;
  renderTabs();
  return navigate(path !== undefined ? path : state.path, { push: true });
}
async function openContainingFolder(path) {
  const folder = parentOf(path) || path, name = basename(path);
  const loading = newTab(folder), owner = curTab();
  await loading;
  if (curTab() !== owner || state.path !== folder || state.error) return;
  const entry = (state.entries || []).find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (!entry) { toast(locale === 'zh' ? '文件可能已移动或删除，已打开所在文件夹。' : 'The item may have moved; its containing folder is open.', true); return; }
  if (!matchesFileType(entry, state.typeFilter || 'all')) state.typeFilter = 'all';
  state.revealName = entry.name; state.selection = new Set([entry.name]); state.focusName = entry.name; state.anchorName = entry.name;
  renderAll();
  const index = state.view.findIndex((item) => item.name === entry.name);
  els.scroller.scrollTop = Math.max(0, (state.viewMode === 'grid' ? Math.floor(index / state.gridCols) : index) * ROWH[state.viewMode] - els.scroller.clientHeight / 2);
  renderRows();
}
function closeTab(i) {
  if (state.tabs.length <= 1 || i < 0 || i >= state.tabs.length) return;
  const active = curTab();
  const killed = state.tabs[i];
  if (typeof aiTabArchiveNeedsFlush === 'function' && aiTabArchiveNeedsFlush(killed)) return flushAiTabArchives(killed).then((ok) => { if (ok) { const index = state.tabs.indexOf(killed); if (index >= 0) return closeTab(index); } });
  if (killed?.connection === 'ssh' && typeof disconnectSshTab === 'function' && (!killed.exited || killed.startPromise)) return closeSshTabSafely(killed);
  if (typeof rememberClosedTab === 'function') rememberClosedTab(killed);
  if (typeof disposeAiTab === 'function') disposeAiTab(killed);
  if (isTermTab(killed)) killTerm(killed);
  if (killed?.kind === 'browser' && typeof closeBrowserTab === 'function') closeBrowserTab(killed);
  state.tabs.splice(i, 1);
  if (state.tab >= state.tabs.length) state.tab = state.tabs.length - 1;
  else if (i < state.tab) state.tab--;
  renderTabs();
  if (killed !== active) return;
  state.navToken++;
  if (isTermTab(curTab()) || isBrowserTab(curTab())) renderAll();
  else navigate(curTab().path, { push: false });
}
function closeOtherTabs(i) {
  const keep = state.tabs[i];
  if (!keep) return;
  const others = state.tabs.filter((tb) => tb !== keep);
  if (others.some((tb) => (tb.connection === 'ssh' && typeof disconnectSshTab === 'function' && (!tb.exited || tb.startPromise)) || (typeof aiTabArchiveNeedsFlush === 'function' && aiTabArchiveNeedsFlush(tb)))) {
    switchTab(i);
    return (async () => {
      for (const tb of others) {
        if (!state.tabs.includes(keep)) return;
        const index = state.tabs.indexOf(tb);
        if (index >= 0) await closeTab(index);
      }
    })();
  }
  state.navToken++;
  for (const tb of state.tabs) if (tb !== state.tabs[i]) {
    if (typeof rememberClosedTab === 'function') rememberClosedTab(tb);
    if (typeof disposeAiTab === 'function') disposeAiTab(tb);
    if (isTermTab(tb)) killTerm(tb);
    if (tb?.kind === 'browser' && typeof closeBrowserTab === 'function') closeBrowserTab(tb);
  }
  state.tabs = [state.tabs[i]];
  state.tab = 0;
  renderTabs();
  if (isTermTab(curTab()) || isBrowserTab(curTab())) renderAll();
  else navigate(curTab().path, { push: false });
}

function closeSshTabSafely(tb) {
  if (tb.sshClosePromise) return tb.sshClosePromise;
  const pending = (async () => {
    if (!await disconnectSshTab(tb)) return false;
    const index = state.tabs.indexOf(tb);
    if (index >= 0) closeTab(index);
    return true;
  })().finally(() => { tb.sshClosePromise = null; });
  tb.sshClosePromise = pending;
  return pending;
}

// ---- embedded terminal (ConPTY backend + xterm.js) ----
async function newTermTab(cwd, sshConfig) {
  state.navToken++;
  invoke('dir_sizes', { gen: state.gen, paths: [] }).catch(() => {});
  const base = isTermTab(curTab()) ? curTab().cwd : state.path;
  const tb = { kind: 'term', key: crypto.randomUUID(), termId: null, cwd: sshConfig ? null : cwd !== undefined ? cwd : base,
    connection: sshConfig ? 'ssh' : 'local', sshConfig: sshConfig ? { host: sshConfig.host, port: sshConfig.port, user: sshConfig.user, identityFile: sshConfig.identityFile || '', infoMode: sshConfig.infoMode || 'posix', label: sshConfig.label || '' } : null,
    term: null, fit: null, el: null, exited: false, starting: true, disposed: false,
    input: '', writing: false, resizing: false };
  if (sshConfig?.managed) { tb.sshConfig.managed = true; tb.sshAuth = sshConfig.auth; }
  state.tabs.push(tb);
  state.tab = state.tabs.length - 1;
  try { attachTerm(tb); }
  catch (error) { failTermSession(tb, error); return tb; }
  renderAll();
  if (curTab() === tb) tb.term.focus();
  await startTermSession(tb);
  return tb;
}

function currentTermSession(tb, key) { return !tb.disposed && tb.key === key; }

function failTermSession(tb, error) {
  tb.starting = false; tb.exited = tb.termId == null; tb.sshError = String(error); tb.input = '';
  if (tb.term) tb.term.write('\r\n' + String(error).replace(/[\x00-\x1f\x7f]/g, ' ') + '\r\n');
  renderTabs();
  if (typeof syncSshInfo === 'function') syncSshInfo(tb);
  toast(String(error), true);
}

function stopTermProcess(tb, key, id) {
  if (tb.killRequest?.key === key && tb.killRequest.id === id) return tb.killRequest.promise;
  const request = { key, id, promise: null };
  request.promise = invoke('term_kill', { id }).catch((error) => {
    if (tb.killRequest === request) tb.killRequest = null;
    throw error;
  });
  if (tb.key === key) tb.killRequest = request;
  return request.promise;
}

function startTermSession(tb, terminalReady = Promise.resolve()) {
  const key = tb.key, remote = tb.connection === 'ssh';
  const pending = (async () => {
    try {
      await terminalReady;
      await terminalEventsReady;
      if (remote && typeof ensureSshEvents === 'function') await ensureSshEvents();
      if (!currentTermSession(tb, key)) return tb;
      if (tb.sshDisconnectRequested) { tb.exited = true; return tb; }
      const value = tb.sshConfig;
      const config = remote ? { host: value.host, port: value.port, user: value.user, identityFile: value.identityFile || null, infoMode: value.infoMode || 'posix' } : null;
      const managed = remote && value.managed;
      if (managed && typeof ensureManagedSshEvents === 'function') await ensureManagedSshEvents();
      let id;
      try {
        id = await invoke(managed ? 'ssh_managed_start' : remote ? 'ssh_start' : 'term_start', { key, ...(remote ? { config } : { cwd: tb.cwd }), ...(managed ? { auth: tb.sshAuth || { useSaved: true, remember: true } } : {}), cols: tb.term.cols, rows: tb.term.rows });
      } finally { if (managed) tb.sshAuth = null; }
      if (!currentTermSession(tb, key)) { await stopTermProcess(tb, key, id); return tb; }
      if (tb.exited && !tb.sshDisconnectRequested) return tb;
      tb.termId = id;
      if (tb.sshDisconnectRequested) {
        await stopTermProcess(tb, key, id);
        if (currentTermSession(tb, key)) { tb.exited = true; tb.termId = null; }
        return tb;
      }
      tb.starting = false;
      if (tb.interruptPending && typeof interruptSshTab === 'function') await interruptSshTab(tb);
      if (!currentTermSession(tb, key)) return tb;
      flushTermInput(tb); fitTerm(tb);
    } catch (error) {
      if (!currentTermSession(tb, key)) return tb;
      // A process known through early output may still be alive. Keep recovery
      // controls available instead of claiming that an I/O failure ended it.
      failTermSession(tb, error);
    } finally {
      if (currentTermSession(tb, key)) {
        tb.starting = false; tb.startPromise = null;
        if (typeof syncSshInfo === 'function') syncSshInfo(tb);
        renderTabs();
        if (curTab() === tb) { renderStatus(); renderCrumbs(); }
      }
    }
    return tb;
  })();
  tb.startPromise = pending;
  return pending;
}

function restartSshTermSession(tb) {
  if (tb.disposed || tb.connection !== 'ssh' || !tb.exited || tb.startPromise) return Promise.resolve(false);
  tb.key = crypto.randomUUID(); tb.termId = null;
  tb.starting = true; tb.exited = false; tb.exitCode = null;
  tb.input = ''; tb.writing = false; tb.writeErr = false; tb.resizing = false;
  tb.nextSize = null; tb.lastSize = null; tb.killRequest = null;
  tb.sshDisconnectRequested = false; tb.sshError = ''; tb.sshInfo = null;
  tb.sshAuthenticated = false; tb.sshResources = null;
  if (typeof resetSshFiles === 'function') resetSshFiles(tb);
  tb.interruptPending = false; tb.interruptPromise = null; tb.sshActionMessage = '';
  if (!tb.term) {
    try { attachTerm(tb); }
    catch (error) { failTermSession(tb, error); return Promise.resolve(false); }
  }
  // DECSTR resets keyboard/paste/focus modes without clearing scrollback.
  // Mouse tracking belongs to a separate xterm service and needs explicit reset.
  // 1047l returns to the normal buffer without restoring an old saved cursor.
  // It also handles alternate-buffer escapes still queued in prior output.
  // Append below the existing viewport so no previous lines are overwritten.
  const prefix = '\x1b[?1047l\x1b[!p\x1b[?2004;1;66;9;1000;1002;1003;1004;1006;1015;1016l\x1b>\x1b[?25h\x1b[0m' + `\x1b[${Math.max(1, tb.term.rows || 1)};1H`;
  const key = tb.key;
  const terminalReady = new Promise((resolve) => {
    tb.resetTermReady = resolve;
    tb.term.write(prefix + '\r\n──────── ' + (typeof sshText === 'function' ? sshText('reloginSeparator') : 'New SSH login') + ' ────────\r\n', () => {
      if (tb.key === key) tb.resetTermReady = null;
      resolve();
    });
  });
  renderTabs();
  if (typeof syncSshInfo === 'function') syncSshInfo(tb);
  if (curTab() === tb) tb.term.focus();
  return startTermSession(tb, terminalReady);
}

function attachTerm(tb) {
  if (tb.el) { tb.el.remove(); tb.sshBar = null; }
  const host = document.createElement('div');
  host.className = 'term';
  host.style.display = curTab() === tb ? '' : 'none';
  els.termHost.appendChild(host);
  const remote = tb.connection === 'ssh';
  let viewport = host;
  if (remote) { host.className += ' ssh-term'; viewport = document.createElement('div'); viewport.className = 'term-terminal-viewport'; host.appendChild(viewport); }
  tb.el = host; tb.termViewport = viewport;
  if (remote && typeof mountSshInfo === 'function') mountSshInfo(tb);
  const term = new window.Terminal({
    fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
    fontSize: 13,
    cursorBlink: true,
    scrollback: 5000,
    theme: { background: '#0c0c0c', foreground: '#cccccc', cursor: '#cccccc', selectionBackground: '#264f78' },
  });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(viewport);
  term.onData((d) => {
    if (tb.disposed || tb.exited || tb.sshDisconnectRequested) return;
    tb.input += d;
    flushTermInput(tb);
  });
  term.attachCustomKeyEventHandler((ev) => {
    if (remote && ev.ctrlKey && !ev.altKey && !ev.metaKey && ev.key.toLowerCase() === 'c') {
      ev.preventDefault(); ev.stopPropagation();
      if (ev.type === 'keydown' && !ev.repeat) {
        if (ev.shiftKey) { if (typeof copySshTerminalSelection === 'function') copySshTerminalSelection(tb); }
        else if (typeof interruptSshTab === 'function') interruptSshTab(tb);
      }
      return false;
    }
    // Let the application handle tab shortcuts without sending them to PowerShell.
    return !(ev.ctrlKey && (ev.key === 'Tab' || /^[1-9]$/.test(ev.key) || ['t', 'w', 'k'].includes(ev.key.toLowerCase())));
  });
  tb.term = term;
  tb.fit = fit;
  tb.el = host;
  tb.termViewport = viewport;
  fitTerm(tb);
}

async function flushTermInput(tb) {
  if (tb.writing || tb.termId == null || tb.disposed || tb.exited || tb.sshDisconnectRequested) return;
  const key = tb.key, id = tb.termId;
  tb.writing = true;
  try {
    while (tb.input && currentTermSession(tb, key) && tb.termId === id && !tb.exited && !tb.sshDisconnectRequested) {
      // Bound IPC writes; one in flight per terminal preserves keystroke order.
      let end = Math.min(tb.input.length, 8192);
      if (end < tb.input.length && /[\uD800-\uDBFF]/.test(tb.input[end - 1])) end--;
      const data = tb.input.slice(0, end);
      tb.input = tb.input.slice(end);
      await invoke('term_write', { id, data });
    }
  } catch (e) {
    if (!currentTermSession(tb, key)) return;
    tb.input = '';
    if (!tb.exited && !tb.writeErr) {
      tb.writeErr = true;
      if (tb.connection === 'ssh') { tb.sshError = String(e); if (typeof syncSshInfo === 'function') syncSshInfo(tb); }
      toast(t('terminal') + ': ' + String(e), true);
    }
  } finally { if (currentTermSession(tb, key)) tb.writing = false; }
}

function fitTerm(tb) {
  if (!tb || tb.disposed || tb.exited || !tb.term || !tb.fit || !tb.el || tb.el.offsetParent === null) return;
  if (tb.fitFrame) return;
  tb.fitFrame = requestAnimationFrame(() => {
    tb.fitFrame = null;
    if (tb.disposed || tb.exited || !tb.el || tb.el.offsetParent === null) return;
  try {
    tb.fit.fit();
    tb.nextSize = { cols: tb.term.cols, rows: tb.term.rows };
    flushTermResize(tb);
  } catch {}
  });
}

async function flushTermResize(tb) {
  if (tb.resizing || tb.termId == null || tb.disposed || tb.exited || tb.sshDisconnectRequested) return;
  const key = tb.key, id = tb.termId;
  tb.resizing = true;
  try {
    while (tb.nextSize && currentTermSession(tb, key) && tb.termId === id && !tb.exited && !tb.sshDisconnectRequested) {
      const size = tb.nextSize;
      tb.nextSize = null;
      if (tb.lastSize?.cols === size.cols && tb.lastSize?.rows === size.rows) continue;
      await invoke('term_resize', { id, ...size });
      if (currentTermSession(tb, key)) tb.lastSize = size;
    }
  } catch {} finally { if (currentTermSession(tb, key)) tb.resizing = false; }
}

function killTerm(tb) {
  if (tb.connection === 'ssh' && !tb.disposed && typeof disconnectSshTab === 'function' && (!tb.exited || tb.startPromise)) {
    return disconnectSshTab(tb).then((stopped) => { if (stopped) disposeTerm(tb); return stopped; });
  }
  disposeTerm(tb);
}

function disposeTerm(tb) {
  if (typeof disconnectSshQueue === 'function' && tb.connection === 'ssh') disconnectSshQueue(tb);
  tb.disposed = true;
  tb.input = '';
  if (tb.resetTermReady) { tb.resetTermReady(); tb.resetTermReady = null; }
  if (tb.fitFrame) cancelAnimationFrame(tb.fitFrame);
  if (tb.termId != null) stopTermProcess(tb, tb.key, tb.termId).catch(() => {});
  tb.termId = null;
  if (tb.term) { try { tb.term.dispose(); } catch {} tb.term = null; }
  if (tb.el) { tb.el.remove(); tb.el = null; }
}

function renderTabs() {
  els.tabbar.innerHTML =
    state.tabs
      .map((tb, i) => {
        const term = isTermTab(tb);
        const browser = isBrowserTab(tb);
        const remote = term && tb.connection === 'ssh';
        const name = browser ? browserTitle(tb) : remote && typeof sshTabTitle === 'function' ? sshTabTitle(tb) : term
          ? 'PowerShell · ' + (basename(tb.cwd || '') || tb.cwd || '~') + (tb.exited ? ' ⏹' : tb.starting ? ' …' : '')
          : tb.path === null ? t('thisPC') : basename(tb.path) || tb.path;
        const icon = browser ? IC.globe : term ? IC.tconsole : tb.path === null ? IC.monitor : IC.folderS;
        const tip = browser ? tb.url : remote ? `SSH · ${tb.sshConfig?.user || ''}@${tb.sshConfig?.host || ''}:${tb.sshConfig?.port || 22}` : term ? `${t('terminal')} · ${tb.cwd || ''}` : tb.path || t('thisPC');
        return `<div class="tab${i === state.tab ? ' on' : ''}${term || browser ? ' isterm' : ''}" data-t="${i}" tabindex="0" title="${esc(tip || '')}">
          <span class="tic">${icon}</span><span class="tnm">${esc(name)}</span>
          <button class="tclose" data-tc="${i}" ${state.tabs.length <= 1 ? 'disabled' : ''}>${IC.x}</button>
        </div>`;
      })
      .join('') +
    `<button id="tabNew" class="tabnew" title="${esc(t('newTab'))}">${IC.plus}</button>` +
    `<button id="tabNewTerm" class="tabnew" title="${esc(t('newTermTab'))}">${IC.tconsole}</button>` +
    `<button id="tabNewSsh" class="tabnew" title="${locale === 'zh' ? '新建 SSH 连接' : 'New SSH connection'}" aria-label="${locale === 'zh' ? '新建 SSH 连接' : 'New SSH connection'}">${IC.ssh || IC.tconsole}<small>SSH</small></button>` +
    `<button id="tabNewBrowser" class="tabnew" title="${locale === 'zh' ? '新建浏览器标签页' : 'New browser tab'}" aria-label="${locale === 'zh' ? '新建浏览器标签页' : 'New browser tab'}">${IC.globe}<small>Web</small></button>`;
  if (typeof persistBrowserSession === 'function') persistBrowserSession();
  if (typeof updateReopenTabButton === 'function') {
    els.tabbar.insertAdjacentHTML('beforeend', `<button id="tabReopen" class="tabnew" title="${locale === 'zh' ? '恢复刚关闭的标签' : 'Reopen closed tab'}" aria-label="${locale === 'zh' ? '恢复刚关闭的标签' : 'Reopen closed tab'}">↶</button>`);
    updateReopenTabButton();
  }
}

/* ============================== view building ============================== */
let collator = null;
function rebuildView() {
  if (!state.entries) { state.view = []; return; }
  collator = collator && collLocale === locale ? collator : new Intl.Collator(locale === 'zh' ? 'zh-CN' : 'en', { numeric: true, sensitivity: 'base' });
  collLocale = locale;
  let arr = state.entries;
  if (!state.showHidden) arr = arr.filter((e) => !e.hidden || e.name === state.revealName);
  if (state.filter) {
    if (typeof matchLocalSearch === 'function') arr = arr.filter((e) => matchLocalSearch(e));
    else { const q = state.filter.toLowerCase(); arr = arr.filter((e) => e.nameLower.includes(q)); }
  }
  if (state.typeFilter && state.typeFilter !== 'all') arr = arr.filter((e) => matchesFileType(e, state.typeFilter));
  const K = state.sortKey, D = state.sortDir, cl = collator;
  arr = [...arr].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    let r = 0;
    if (K === 'name') r = cl.compare(a.name, b.name);
    else if (K === 'date') r = (a.mtime - b.mtime) || cl.compare(a.name, b.name);
    else if (K === 'created' || K === 'accessed') {
      const field = K === 'created' ? 'ctime' : 'atime';
      r = ((a[field] || 0) - (b[field] || 0)) || cl.compare(a.name, b.name);
    }
    else if (K === 'type') r = cl.compare(typeLabel(a), typeLabel(b)) || cl.compare(a.name, b.name);
    else if (K === 'extension') r = cl.compare(a.ext || '', b.ext || '') || cl.compare(a.name, b.name);
    else if (K === 'attributes') r = cl.compare(typeof fileAttributeLabel === 'function' ? fileAttributeLabel(a) : '', typeof fileAttributeLabel === 'function' ? fileAttributeLabel(b) : '') || cl.compare(a.name, b.name);
    else if (K === 'path') r = cl.compare(a.name, b.name);
    else r = ((a.dirSize ?? a.size) - (b.dirSize ?? b.size)) || cl.compare(a.name, b.name);
    return D * r;
  });
  state.view = arr;
  const visibleNames = new Set(arr.map((e) => e.name));
  state.selection = new Set([...state.selection].filter((name) => visibleNames.has(name)));
  const anchorName = state.anchorName;
  state.anchorIdx = anchorName ? arr.findIndex((e) => e.name === anchorName) : -1;
}
let collLocale = null;

/* ============================== rendering ============================== */
function renderAll() {
  document.body.classList.toggle('terminal-mode', !!isTermTab(curTab()));
  document.body.classList.toggle('browser-mode', !!isBrowserTab(curTab()));
  rebuildView();
  renderTabs();
  renderBar1();
  renderBar2();
  renderSidebar();
  renderWorkspace();
  renderContent();
  renderStatus();
  updateTitle();
}

function setBtn(el, icon, label, tip, dis) {
  el.innerHTML = icon + (label ? `<span class="lbl">${esc(label)}</span>` : '');
  el.title = tip || '';
  el.setAttribute('aria-label', tip || label || '');
  el.disabled = !!dis;
}

function renderBar1() {
  const term = isTermTab(curTab());
  const browser = isBrowserTab(curTab());
  els.bar2.classList.toggle('hidden', term || browser);
  els.searchWrap.classList.toggle('hidden', browser);
  const tb = curTab();
  setBtn(els.btnBack, IC.back, '', t('back'), term || browser || tb.hIdx <= 0);
  setBtn(els.btnFwd, IC.fwd, '', t('fwd'), term || browser || tb.hIdx >= tb.history.length - 1);
  setBtn(els.btnUp, IC.up, '', t('up'), term || browser || state.path === null);
  setBtn(els.btnRefresh, IC.refresh, '', t('refresh'), browser);
  els.search.placeholder = t('search');
  els.searchIcon.innerHTML = IC.search;
  els.searchClear.innerHTML = IC.x;
  els.searchClear.style.visibility = els.search.value ? 'visible' : 'hidden';
  els.btnLang.textContent = locale === 'zh' ? 'EN' : '中';
  els.btnLang.title = t('switchLang');
  renderCrumbs();
}

let crumbEditing = false;
function renderCrumbs() {
  const c = els.crumbs;
  c.title = isBrowserTab(curTab()) ? (curTab().url || 'Browser') : isTermTab(curTab())
    ? t('terminal')
    : (state.path || t('thisPC'));
  // Keep the path tail visible: scroll to the right end after rendering.
  requestAnimationFrame(() => { c.scrollLeft = c.scrollWidth; });
  if (crumbEditing) return;
  if (isTermTab(curTab())) {
    const cwd = curTab().cwd || '';
    if (curTab().connection === 'ssh') { c.innerHTML = `<span class="chead">${IC.tconsole}</span><span class="cseg cur">${esc(typeof sshTabTitle === 'function' ? sshTabTitle(curTab()) : 'SSH')}</span>`; return; }
    c.innerHTML = `<span class="chead">${IC.tconsole}</span><span class="cseg cur">${esc(t('terminal'))}${cwd ? ' — ' + esc(cwd) : ''}</span>`;
    return;
  }
  if (isBrowserTab(curTab())) {
    c.innerHTML = `<span class="chead">${IC.globe}</span><span class="cseg cur">${esc(curTab().title || curTab().url || 'Browser')}</span>`;
    return;
  }
  if (state.path === null) {
    c.innerHTML = `<span class="chead">${IC.home}</span><span class="cseg cur">${esc(t('thisPC'))}</span>`;
    return;
  }
  const parts = [];
  const m = state.path.match(/^([a-zA-Z]:)([\\](.*))?$/);
  let html = `<span class="chead">${IC.folderS}</span>`;
  if (m) {
    const drive = m[1] + '\\';
    html += `<span class="cseg" data-p="${esc(drive)}">${esc(m[1])}</span>`;
    let acc = drive;
    if (m[3]) {
      for (const seg of m[3].split('\\')) {
        if (!seg) continue;
        acc = join(acc, seg);
        parts.push([acc, seg]);
      }
    }
  } else {
    // UNC path
    const segs = state.path.split('\\').filter(Boolean);
    let acc = '';
    segs.forEach((seg, i) => {
      acc = i === 0 ? '\\\\' + seg : join(acc, seg);
      html += `<span class="cseg" data-p="${esc(acc)}">${esc(seg)}</span>`;
    });
  }
  parts.forEach(([p, name], idx) => {
    html += `<span class="cchev">${IC.chevR}</span><span class="cseg${idx === parts.length - 1 ? ' cur' : ''}" data-p="${esc(p)}">${esc(name)}</span>`;
  });
  if (!parts.length) html = html.replace('cseg" data', 'cseg cur" data');
  c.innerHTML = html;
}

function enterPathEdit() {
  crumbEditing = true;
  const c = els.crumbs;
  c.innerHTML = `<input class="pathedit" spellcheck="false">`;
  const inp = c.querySelector('input');
  inp.value = state.path || '';
  inp.focus();
  inp.select();
  let finished = false;
  const done = (commit) => {
    if (finished) return;
    finished = true;
    crumbEditing = false;
    const v = inp.value.trim().replace(/^"|"$/g, '');
    renderCrumbs();
    if (!commit || !v) return;
    let p = v;
    if (/^[a-zA-Z]:$/.test(p)) p += '\\';
    if (/^[a-zA-Z]:[\\/]/.test(p) || /^\\\\/.test(p)) navigate(p);
    else if (state.path !== null) navigate(join(state.path, p));
  };
  inp.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') { ev.preventDefault(); done(true); }
    if (ev.key === 'Escape') { ev.preventDefault(); done(false); }
  });
  inp.addEventListener('blur', () => done(false));
}

function renderBar2() {
  if (typeof syncDualPane === 'function') syncDualPane();
  if (isBrowserTab(curTab())) return;
  els.btnNew.innerHTML = `<span class="icw">${IC.folderS}</span><span class="lbl">${esc(t('newFolder'))}</span>`;
  els.btnNew.title = t('newFolderHere');
  els.btnNew.disabled = state.path === null;
  const hasSel = state.selection.size > 0 && state.path !== null;
  setBtn(els.btnCut, IC.cut, '', t('cut') + ' · Ctrl+X', !hasSel);
  setBtn(els.btnCopy, IC.copy, '', t('copy') + ' · Ctrl+C', !hasSel);
  setBtn(els.btnPaste, IC.paste, '', t('paste') + ' · Ctrl+V', !state.clipboard || state.path === null);
  setBtn(els.btnRename, IC.pencil, '', t('rename') + ' · F2', state.selection.size !== 1);
  setBtn(els.btnDelete, IC.trash, '', t('del') + ' · Delete', !hasSel);
  els.btnSort.innerHTML = IC.sort + `<span class="lbl">${esc(t('sort'))}</span>`;
  els.btnView.innerHTML = (state.viewMode === 'details' ? IC.list : IC.grid) + `<span class="lbl">${esc(t('view'))}</span>`;
  els.btnMore.innerHTML = IC.more;
  els.btnMore.title = t('more');
  els.btnMore.setAttribute('aria-label', t('more'));
}

function renderSidebar() { renderNavigation(); }

function renderContent() {
  if (isBrowserTab(curTab())) {
    els.loadBar.classList.add('hidden');
    els.dhead.classList.add('hidden');
    els.scroller.classList.add('hidden');
    els.rootPage.classList.add('hidden');
    els.statePage.classList.add('hidden');
    els.termHost.classList.add('hidden');
    els.browserHost.classList.remove('hidden');
    if (typeof syncBrowserBounds === 'function') syncBrowserBounds();
    return;
  }
  els.browserHost.classList.add('hidden');
  if (isTermTab(curTab())) {
    els.loadBar.classList.add('hidden');
    els.dhead.classList.add('hidden');
    els.scroller.classList.add('hidden');
    els.rootPage.classList.add('hidden');
    els.statePage.classList.add('hidden');
    els.termHost.classList.remove('hidden');
    const tb = curTab();
    els.termHost.querySelectorAll('.term').forEach((el) => { el.style.display = 'none'; });
    if (tb.el) tb.el.style.display = '';
    requestAnimationFrame(() => fitTerm(tb));
    return;
  }
  els.termHost.classList.add('hidden');
  els.loadBar.classList.toggle('hidden', !state.loading);
  const showList = !state.loading && !state.error && state.entries !== null;
  els.dhead.classList.toggle('hidden', !(showList && state.viewMode === 'details'));
  els.scroller.classList.toggle('hidden', !showList);
  els.rootPage.classList.toggle('hidden', !(state.entries === null && !state.error && !state.loading && state.path === null));
  els.statePage.classList.toggle('hidden', !state.error && !(showList && state.view.length === 0));

  if (state.error) {
    els.statePage.innerHTML = `<div class="big">${IC.fileS}</div><div>${esc(t('loadFail'))}</div><div style="font-size:12px;color:var(--txt3);max-width:520px;word-break:break-all">${esc(state.error)}</div><button class="btnretry" id="btnRetry">${esc(t('retry'))}</button>`;
    els.statePage.classList.remove('hidden');
    $('btnRetry').addEventListener('click', () => navigate(state.path));
    return;
  }
  if (state.entries === null) { renderRootPage(); return; }
  if (showList && state.view.length === 0) {
    const msg = state.filter || state.typeFilter !== 'all' ? t('noMatch') : t('emptyDir');
    els.statePage.innerHTML = `<div class="big">${IC.folderS}</div><div>${esc(msg)}</div>`;
    els.statePage.classList.remove('hidden');
  } else {
    els.statePage.classList.add('hidden');
  }
  if (showList) renderList();
}

function renderRootPage() { renderHome(); }

function renderList() {
  if (typeof syncColumnLayout === 'function') syncColumnLayout();
  if (state.viewMode === 'grid') {
    const w = els.scroller.clientWidth || 800;
    state.gridCols = Math.max(1, Math.floor((w - 20) / 132));
    const rowsN = Math.ceil(state.view.length / state.gridCols);
    els.sizer.style.height = rowsN * ROWH.grid + 'px';
  } else {
    els.sizer.style.height = state.view.length * ROWH.details + 'px';
    const cols = [
      ['name', t('colName')], ['date', t('colDate')], ['type', t('colType')], ['size', t('colSize')],
    ];
    if (typeof columnInteractionActive !== 'function' || !columnInteractionActive()) {
      const header = typeof renderColumnHeaders === 'function' ? renderColumnHeaders(cols) : cols.map(([k, label]) => {
      const on = state.sortKey === k;
      const arr = on ? `<span class="arr">${state.sortDir === 1 ? '▲' : '▼'}</span>` : '';
      return `<div class="h ${k}${on ? ' on' : ''}" data-k="${k}">${esc(label)}${arr}</div>`;
      }).join('');
      if (els.dhead.renderedHtml !== header) { els.dhead.innerHTML = header; els.dhead.renderedHtml = header; }
    }
    if (typeof syncColumnScroll === 'function') syncColumnScroll();
  }
  renderRows();
}

function cutNames() {
  if (!state.clipboard || state.clipboard.mode !== 'cut' || !state.path) return new Set();
  return new Set(state.clipboard.paths.filter((p) => parentOf(p) === state.path).map((p) => basename(p)));
}

function renderRows() {
  const mode = state.viewMode;
  const H = ROWH[mode];
  const n = state.view.length;
  const st = els.scroller.scrollTop;
  const vh = els.scroller.clientHeight || 600;
  const cut = cutNames();
  const cols = mode === 'details' ? 1 : state.gridCols;
  const overscan = mode === 'details' ? 4 : 2;
  const first = Math.max(0, Math.floor(st / H) - overscan) * cols;
  const last = Math.min(n - 1, (Math.ceil((st + vh) / H) + overscan + 1) * cols - 1);
  const indices = new Set();
  for (let i = first; i <= last; i++) indices.add(i);
  // Pin the editor even when scrolling moves its row outside the virtual range.
  const editing = state.renaming ? state.view.findIndex((e) => e.name === state.renaming) : -1;
  if (editing >= 0) indices.add(editing);
  const oldRows = new Map([...els.rows.children].map((row) => [row.entryKey, row]));
  const retained = new Set();
  let cursor = els.rows.firstElementChild;
  for (const i of [...indices].sort((a, b) => a - b)) {
    const e = state.view[i], key = JSON.stringify([state.path, mode, e.name]);
    let row = oldRows.get(key);
    if (!row) { row = document.createElement('div'); row.entryKey = key; row.setAttribute('role', 'option'); }
    retained.add(row);
    const className = `${mode === 'details' ? 'row' : 'gcell'}${state.selection.has(e.name) ? ' sel' : ''}${cut.has(e.name) ? ' cut' : ''}`;
    if (row.className !== className) row.className = className;
    row.setAttribute('aria-selected', String(state.selection.has(e.name)));
    row.dataset.i = String(i);
    row.style.top = `${Math.floor(i / cols) * H + (mode === 'grid' ? 4 : 0)}px`;
    row.style.left = mode === 'grid' ? `${i % cols * 132 + 8}px` : '';
    const html = mode === 'details' ? (typeof renderColumnCells === 'function' ? renderColumnCells(e) : `
        <div class="c cname">${fileIcon(e)}<span class="nm" title="${esc(e.name)}">${esc(e.name)}</span></div>
        <div class="c cdate">${e.mtime ? esc(fmtDate(e.mtime)) : ''}</div>
        <div class="c ctype">${esc(typeLabel(e))}</div>
        <div class="c csize">${e.isDir ? esc(folderSizeLabel(e)) : esc(fmtSize(e.size))}</div>
        `) : `<div class="gicon">${fileIcon(e, true)}</div><div class="glabel" title="${esc(e.name)}">${esc(e.name)}</div>`;
    const input = row.querySelector('input.rn');
    if (!(input && i === editing) && (row.contentHtml !== html || input)) {
      row.innerHTML = html; row.contentHtml = html;
    }
    if (row !== cursor) els.rows.insertBefore(row, cursor);
    cursor = row.nextElementSibling;
  }
  for (const row of oldRows.values()) if (!retained.has(row)) row.remove();
  if (state.renaming) mountRename();
}

let indexBusy = false;

function renderStatus() {
  if (isBrowserTab(curTab())) {
    els.status.innerHTML = `<span>${esc(curTab().url || 'Browser')}</span>`;
    return;
  }
  if (isTermTab(curTab())) {
    const label = curTab().connection === 'ssh' && typeof sshTabTitle === 'function' ? sshTabTitle(curTab()) : t('terminal') + ' · ' + (curTab().cwd || '');
    els.status.innerHTML = `<span>${esc(label)}</span>` +
      (indexBusy ? `<span class="spacer"></span><span class="idxbusy">${esc(t('indexing'))}</span>` : '');
    return;
  }
  let txt = '';
  if (state.entries) {
    txt = tf('statusItems', { n: state.view.length.toLocaleString() });
    if (state.filter) txt += ' ' + t('filtered');
    if (state.selection.size > 0) {
      let bytes = 0, known = false;
      for (const e of state.entries) if (state.selection.has(e.name)) {
        if (e.isDir) { if (e.dirSize != null) { bytes += e.dirSize; known = true; } }
        else { bytes += e.size; known = true; }
      }
      txt += ' · ' + (known
        ? tf('statusSelSize', { m: state.selection.size, size: fmtSize(bytes) })
        : tf('statusSel', { m: state.selection.size }));
    }
  } else if (state.roots) {
    txt = tf('statusItems', { n: state.roots.drives.length });
  }
  els.status.innerHTML =
    `<span>${esc(txt)}</span><span class="spacer"></span>` +
    (state.filterError ? `<span class="search-error">${esc(state.filterError)}</span>` : '') +
    (indexBusy ? `<span class="idxbusy">${esc(t('indexing'))}</span>` : '');
}

function updateTitle() {
  if (isBrowserTab(curTab())) { document.title = (curTab().title || curTab().url || 'Browser') + ' — ' + t('appName'); return; }
  if (isTermTab(curTab())) { document.title = 'PowerShell — ' + t('appName'); return; }
  document.title = (state.path ? basename(state.path) || state.path : t('thisPC')) + ' — ' + t('appName');
}

/* ============================== selection & open ============================== */
// Toggle selection/cut classes on rendered rows in place. Never rebuild the
// rows here: replacing the DOM between the two clicks of a double-click kills
// the browser's dblclick detection.
function applySelectionDom() {
  const cut = cutNames();
  els.rows.querySelectorAll('[data-i]').forEach((el) => {
    const e = state.view[+el.dataset.i];
    if (!e) return;
    el.classList.toggle('sel', state.selection.has(e.name));
    el.setAttribute('aria-selected', String(state.selection.has(e.name)));
    el.classList.toggle('cut', cut.has(e.name));
  });
  renderPreview();
  if (typeof renderAiSelection === 'function') renderAiSelection();
}

function selectAt(i, ev) {
  if (i < 0 || i >= state.view.length) return;
  const name = state.view[i].name;
  state.focusName = name;
  if (ev.shiftKey && state.anchorIdx >= 0) {
    const [a, b] = [Math.min(state.anchorIdx, i), Math.max(state.anchorIdx, i)];
    state.selection = new Set(state.view.slice(a, b + 1).map((x) => x.name));
  } else if (ev.ctrlKey) {
    if (state.selection.has(name)) state.selection.delete(name); else state.selection.add(name);
    state.anchorIdx = i;
    state.anchorName = name;
  } else {
    state.selection = new Set([name]);
    state.anchorIdx = i;
    state.anchorName = name;
  }
  applySelectionDom(); renderStatus(); renderBar2();
}
function clearSelection() {
  if (!state.selection.size) return;
  state.selection = new Set();
  state.anchorIdx = -1;
  state.anchorName = null;
  state.focusName = null;
  applySelectionDom(); renderStatus(); renderBar2();
}

function openEntry(e) {
  if (e.isDir) navigate(join(state.path, e.name));
  else invoke('open_path', { path: join(state.path, e.name) }).catch((err) => toast(String(err), true));
}
function openSelected() {
  if (!state.selection.size || state.path === null) return;
  for (const n of state.selection) {
    const e = state.entries.find((x) => x.name === n);
    if (e) openEntry(e);
    if (state.selection.size > 5) break;
  }
}

/* ============================== clipboard / file ops ============================== */
async function copyFullPaths(paths) {
  if (!paths.length) { toast(t('selNone')); return; }
  try {
    // Plain absolute paths: keep spaces and Unicode; one Windows line per item.
    await navigator.clipboard.writeText(paths.join('\r\n'));
    toast(tf('pathsCopied', { n: paths.length }));
  } catch (error) { toast(t('copyPathFailed') + ' · ' + String(error), true); }
}
function copySelectedPaths() {
  const paths = state.path == null ? [] : [...state.selection].map(name => join(state.path, name));
  return copyFullPaths(paths);
}
function copySel() {
  if (!state.selection.size) { toast(t('selNone')); return; }
  state.clipboard = { mode: 'copy', paths: [...state.selection].map((n) => join(state.path, n)) };
  renderBar2(); applySelectionDom();
}
function cutSel() {
  if (!state.selection.size) { toast(t('selNone')); return; }
  state.clipboard = { mode: 'cut', paths: [...state.selection].map((n) => join(state.path, n)) };
  renderBar2(); applySelectionDom();
}
let fileOpBusy = false;
async function pasteClip() {
  const cb = state.clipboard;
  if (!cb || state.path === null || fileOpBusy) return;
  const path = state.path, owner = curTab();
  fileOpBusy = true;
  try {
    const completed = await invoke('file_op', { kind: cb.mode === 'cut' ? 'move' : 'copy', sources: cb.paths, dest: path });
    if (completed && cb.mode === 'cut' && state.clipboard === cb) state.clipboard = null;
  } catch (e) {
    if (!/800704C7/.test(String(e))) toast(String(e), true);
  } finally {
    fileOpBusy = false;
    if (curTab() === owner && state.path === path) await refresh(true);
    renderBar2();
  }
}
async function deleteSel() {
  if (!state.selection.size || state.path === null || fileOpBusy) return;
  const path = state.path, owner = curTab();
  const paths = [...state.selection].map((n) => join(state.path, n));
  fileOpBusy = true;
  try {
    await invoke('file_op', { kind: 'delete', sources: paths, dest: null });
  } catch (e) {
    toast(String(e), true);
  } finally {
    fileOpBusy = false;
    if (curTab() === owner && state.path === path) await refresh(true);
  }
}

/* ============================== rename / new folder ============================== */
function startRename(name) {
  state.renaming = name;
  const i = state.view.findIndex((e) => e.name === name);
  if (i >= 0) {
    const H = ROWH[state.viewMode];
    const target = state.viewMode === 'grid' ? Math.floor(i / state.gridCols) * H : i * H;
    els.scroller.scrollTop = Math.max(0, target - els.scroller.clientHeight / 2);
  }
  renderRows();
}
function mountRename() {
  const name = state.renaming;
  const owner = curTab(), path = state.path;
  const i = state.view.findIndex((e) => e.name === name);
  if (i < 0) { state.renaming = null; return; }
  const mode = state.viewMode;
  const rowEl = els.rows.querySelector(`[data-i="${i}"]`);
  if (!rowEl) return;
  if (rowEl.querySelector('input.rn')) return;
  const holder = rowEl.querySelector(mode === 'details' ? '.nm' : '.glabel');
  if (!holder) return;
  const inp = document.createElement('input');
  inp.className = 'rn';
  inp.value = name;
  holder.replaceWith(inp);
  inp.focus();
  const dot = !state.view[i].isDir ? name.lastIndexOf('.') : -1;
  if (dot > 0) inp.setSelectionRange(0, dot); else inp.select();
  let done = false;
  const commit = (ok) => {
    if (done) return;
    done = true;
    // Navigation may remove this input and fire blur. Never apply its draft to
    // a different folder/tab, or let a delayed completion replace that tab.
    if (state.renaming !== name || curTab() !== owner || state.path !== path) return;
    const nv = inp.value.trim();
    state.renaming = null;
    if (!ok || !nv || nv === name) { renderRows(); return; }
    invoke('rename_path', { old: join(path, name), new: join(path, nv) })
      .then(() => { if (curTab() === owner && state.path === path) { state.selection = new Set([nv]); return refresh(true); } })
      .catch((e) => { toast(String(e), true); if (curTab() === owner && state.path === path) renderRows(); });
  };
  inp.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') commit(true);
    if (ev.key === 'Escape') commit(false);
  });
  inp.addEventListener('blur', () => commit(true));
  inp.addEventListener('input', () => {
    inp.value = inp.value.replace(/[\\/:*?"<>|]/g, '');
  });
}

async function newFolder() {
  if (state.path === null) return;
  const names = new Set(state.entries.map((e) => e.name.toLowerCase()));
  const base = t('newFolderName');
  let name = base, i = 2;
  while (names.has(name.toLowerCase())) name = `${base} (${i++})`;
  try {
    await invoke('create_dir', { path: join(state.path, name) });
    state.filter = '';
    els.search.value = '';
    await refresh(false);
    startRename(name);
  } catch (e) {
    toast(String(e), true);
  }
}

/* ============================== menus ============================== */
let menuOpen = false;
function closeMenu() {
  menuOpen = false;
  els.menuLayer.classList.add('hidden');
  els.menuLayer.innerHTML = '';
}
function showMenu(x, y, items) {
  const html = ['<div class="menu">'];
  for (const it of items) {
    if (it.sep) { html.push('<div class="msep"></div>'); continue; }
    if (it.head) { html.push(`<div class="mhead">${esc(it.head)}</div>`); continue; }
    const dis = it.dis ? ' dis' : '';
    html.push(`<div class="mi${dis}" data-mid="${it.id}">
      <span class="ic">${it.ic || ''}</span>
      ${it.check !== undefined ? `<span class="ck">${it.check ? '✓' : ''}</span>` : ''}
      <span>${esc(it.label)}</span>
      ${it.sc ? `<span class="sc">${esc(it.sc)}</span>` : ''}
    </div>`);
  }
  html.push('</div>');
  els.menuLayer.innerHTML = html.join('');
  els.menuLayer.classList.remove('hidden');
  const menu = els.menuLayer.querySelector('.menu');
  menu.style.left = Math.min(x, window.innerWidth - menu.offsetWidth - 8) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - menu.offsetHeight - 8) + 'px';
  menuOpen = true;
  els.menuLayer.querySelectorAll('.mi').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.mid;
      const it = items.find((z) => z.id === id);
      closeMenu();
      if (it && it.fn) it.fn();
    });
  });
}
function anchorMenu(btn, items) {
  const r = btn.getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, items);
}

function itemMenu(i, x, y) {
  const e = state.view[i];
  if (!state.selection.has(e.name)) { state.selection = new Set([e.name]); state.anchorIdx = i; applySelectionDom(); renderStatus(); renderBar2(); }
  const p = join(state.path, e.name);
  const many = state.selection.size > 1;
  const items = [
    { id: 'open', label: t('open'), ic: IC.openIc, fn: openSelected },
  ];
  if (!e.isDir && !many) items.push({ id: 'ow', label: t('openWith'), fn: () => invoke('open_with', { path: p }).catch((err) => toast(String(err), true)) });
  items.push(
    { id: 'exp', label: t('openInExplorer'), fn: () => invoke('reveal', { path: p }).catch((err) => toast(String(err), true)) },
    { sep: true },
    { id: 'cut', label: t('cut'), sc: 'Ctrl+X', ic: IC.cut, fn: cutSel },
    { id: 'copy', label: t('copy'), sc: 'Ctrl+C', ic: IC.copy, fn: copySel },
    { id: 'cp', label: t('copyPath'), sc: 'Ctrl+Shift+C', ic: IC.copy, fn: () => copyFullPaths([...state.selection].map(name => join(state.path, name))) },
    { id: 'archive', label: locale === 'zh' ? '压缩…' : 'Compress…', ic: IC.folderS, dis: fileOpBusy, fn: () => { if (!fileOpBusy) openArchiveDialog(); } },
    { sep: true },
    { id: 'rn', label: t('rename'), sc: 'F2', ic: IC.pencil, dis: state.selection.size !== 1, fn: () => startRename([...state.selection][0]) },
    { id: 'del', label: t('del'), sc: 'Del', ic: IC.trash, fn: deleteSel },
    { sep: true },
  );
  if (e.isDir && !many) {
    items.push(
      { id: 'term', label: t('openInTerminal'), ic: IC.tconsole, fn: () => newTermTab(p) },
      {
        id: 'pin', label: t('pinQuick'), ic: IC.folderS,
        fn: () => {
          if (!state.pinned.includes(p)) { state.pinned.push(p); store.set('pinned', state.pinned); renderSidebar(); toast(t('pinQuick') + ' ✓'); }
        },
      },
      { sep: true },
    );
  }
  if (typeof showEntryProperties === 'function' && !many) items.push({ id: 'properties', label: columnText('属性', 'Properties'), fn: () => showEntryProperties(e) });
  if (typeof openColumnPicker === 'function') items.push({ sep: true }, { id: 'choose-columns', label: columnText('选择显示列…', 'Choose columns…'), fn: openColumnPicker });
  showMenu(x, y, items);
}

function blankMenu(x, y) {
  const items = [
    { id: 'paste', label: t('paste'), ic: IC.paste, sc: 'Ctrl+V', dis: !state.clipboard, fn: pasteClip },
    { id: 'newf', label: t('newFolderHere'), ic: IC.folderS, fn: newFolder },
    { id: 'term', label: t('openInTerminal'), ic: IC.tconsole, fn: () => newTermTab(state.path) },
    { sep: true },
    { id: 'rf', label: t('refresh'), sc: 'F5', ic: IC.refresh, fn: () => refresh(true, true) },
    { id: 'hid', label: t('showHidden'), check: state.showHidden, fn: () => { state.showHidden = !state.showHidden; store.set('showHidden', state.showHidden); renderAll(); } },
  ];
  if (typeof openColumnPicker === 'function') items.push({ sep: true }, { id: 'choose-columns', label: columnText('选择显示列…', 'Choose columns…'), fn: openColumnPicker });
  showMenu(x, y, items);
}

function sortMenu() {
  const cols = typeof visibleColumns === 'function' ? visibleColumns().map((key) => [key, columnLabel(key)]) : [['name', t('colName')], ['date', t('colDate')], ['type', t('colType')], ['size', t('colSize')]];
  anchorMenu(els.btnSort, [
    { head: t('sortBy') },
    ...cols.map(([k, l]) => ({ id: 'k' + k, label: l, check: state.sortKey === k, fn: () => { state.sortKey = k; store.set('sortKey', k); renderAll(); } })),
    { sep: true },
    { id: 'asc', label: t('asc'), check: state.sortDir === 1, fn: () => { state.sortDir = 1; store.set('sortDir', 1); renderAll(); } },
    { id: 'desc', label: t('desc'), check: state.sortDir === -1, fn: () => { state.sortDir = -1; store.set('sortDir', -1); renderAll(); } },
  ]);
}
function viewMenu() {
  anchorMenu(els.btnView, [
    { head: t('viewMode') },
    { id: 'vl', label: t('vList'), check: state.viewMode === 'details', fn: () => setViewMode('details') },
    { id: 'vg', label: t('vGrid'), check: state.viewMode === 'grid', fn: () => setViewMode('grid') },
    ...(typeof openColumnPicker === 'function' ? [{ sep: true }, { id: 'choose-columns', label: columnText('选择显示列…', 'Choose columns…'), fn: openColumnPicker }] : []),
  ]);
}
function moreMenu() {
  anchorMenu(els.btnMore, [
    { id: 'archive', label: locale === 'zh' ? '压缩所选项目…' : 'Compress selected items…', dis: !state.path || !state.selection.size || fileOpBusy, fn: () => { if (!fileOpBusy) openArchiveDialog(); } },
    { id: 'cp', label: t('copyPath'), sc: 'Ctrl+Shift+C', ic: IC.copy, dis: state.path == null || !state.selection.size, fn: copySelectedPaths },
    { sep: true },
    { id: 'rf', label: t('refresh'), sc: 'F5', ic: IC.refresh, fn: () => refresh(true, true) },
    { id: 'hid', label: t('showHidden'), check: state.showHidden, fn: () => { state.showHidden = !state.showHidden; store.set('showHidden', state.showHidden); renderAll(); } },
    { sep: true },
    { head: t('language') },
    { id: 'lzh', label: '中文（简体）', check: locale === 'zh', fn: () => setLocale('zh') },
    { id: 'len', label: 'English', check: locale === 'en', fn: () => setLocale('en') },
  ]);
}

/* ============================== events ============================== */
let rafPending = false;
els.scroller.addEventListener('scroll', () => {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; if (!els.scroller.classList.contains('hidden')) renderRows(); });
});

els.scroller.addEventListener('click', (ev) => {
  if (!ev.target.closest('input')) els.scroller.focus({ preventScroll: true });
  const rowEl = ev.target.closest('[data-i]');
  if (!rowEl) { clearSelection(); return; }
  selectAt(+rowEl.dataset.i, ev);
});
els.scroller.addEventListener('dblclick', (ev) => {
  const rowEl = ev.target.closest('[data-i]');
  if (!rowEl) return;
  openEntry(state.view[+rowEl.dataset.i]);
});
els.scroller.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  const rowEl = ev.target.closest('[data-i]');
  if (rowEl) itemMenu(+rowEl.dataset.i, ev.clientX, ev.clientY);
  else blankMenu(ev.clientX, ev.clientY);
});

els.dhead.addEventListener('click', (ev) => {
  if (typeof consumeColumnClick === 'function' && consumeColumnClick(ev)) return;
  const h = ev.target.closest('.h');
  if (!h) return;
  const k = h.dataset.k;
  if (state.sortKey === k) state.sortDir = -state.sortDir;
  else { state.sortKey = k; state.sortDir = 1; }
  store.set('sortKey', state.sortKey); store.set('sortDir', state.sortDir);
  renderAll();
});

els.crumbs.addEventListener('click', (ev) => {
  if (crumbEditing) return;
  const seg = ev.target.closest('.cseg');
  if (seg && seg.dataset.p) navigate(seg.dataset.p);
  else enterPathEdit();
});

els.rootPage.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-nav]');
  if (!el) return;
  navigate(el.dataset.nav === '__root__' ? null : el.dataset.nav);
});
els.rootPage.addEventListener('dblclick', (ev) => { ev.preventDefault(); });
els.side.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-nav]');
  if (!el) return;
  navigate(el.dataset.nav === '__root__' ? null : el.dataset.nav);
});
els.side.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  const el = ev.target.closest('[data-nav]');
  if (!el || el.dataset.nav === '__root__') return;
  const p = el.dataset.nav;
  const pinnedNow = state.pinned.includes(p);
  const items = [
    { id: 'open', label: t('open'), ic: IC.openIc, fn: () => navigate(p) },
    { id: 'term', label: t('openInTerminal'), ic: IC.tconsole, fn: () => newTermTab(p) },
    { sep: true },
  ];
  if (pinnedNow) {
    items.push({ id: 'unpin', label: t('unpinQuick'), fn: () => { state.pinned = state.pinned.filter((x) => x !== p); store.set('pinned', state.pinned); renderSidebar(); } });
  } else {
    items.push({ id: 'pin', label: t('pinQuick'), fn: () => { if (!state.pinned.includes(p)) { state.pinned.push(p); store.set('pinned', state.pinned); renderSidebar(); } } });
  }
  if (state.recents.includes(p)) {
    items.push({ id: 'rmr', label: t('removeRecent'), fn: () => { state.recents = state.recents.filter((x) => x !== p); store.set('recents', state.recents); renderSidebar(); } });
  }
  showMenu(ev.clientX, ev.clientY, items);
});

els.btnBack.addEventListener('click', goBack);
els.btnFwd.addEventListener('click', goFwd);

els.tabbar.addEventListener('click', (ev) => {
  if (ev.target.closest('#tabReopen')) { if (typeof reopenClosedTab === 'function') void reopenClosedTab(); return; }
  const closeBtn = ev.target.closest('.tclose');
  if (closeBtn) { closeTab(+closeBtn.dataset.tc); return; }
  if (ev.target.closest('#tabNew')) { newTab(); return; }
  if (ev.target.closest('#tabNewTerm')) { newTermTab(); return; }
  if (ev.target.closest('#tabNewSsh')) { if (typeof openSshConnect === 'function') openSshConnect(); return; }
  if (ev.target.closest('#tabNewBrowser')) { if (typeof newBrowserTab === 'function') newBrowserTab(); return; }
  const tabEl = ev.target.closest('.tab');
  if (tabEl) switchTab(+tabEl.dataset.t);
});
els.tabbar.addEventListener('auxclick', (ev) => {
  if (ev.button !== 1) return;
  const tabEl = ev.target.closest('.tab');
  if (tabEl) closeTab(+tabEl.dataset.t);
});
els.tabbar.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  const tabEl = ev.target.closest('.tab');
  if (!tabEl) { if (typeof tabManagementMenu === 'function') showMenu(ev.clientX, ev.clientY, tabManagementMenu(null).slice(-1)); return; }
  const i = +tabEl.dataset.t;
  const tb = state.tabs[i];
  showMenu(ev.clientX, ev.clientY, [
    { id: 'newb', label: t('newTab'), ic: IC.plus, sc: 'Ctrl+T', fn: () => newTab(tb.path) },
    { id: 'dup', label: t('dupTab'), fn: () => isBrowserTab(tb) && typeof newBrowserTab === 'function' ? newBrowserTab(tb.url) : tb.connection === 'ssh' && typeof newSshTab === 'function' ? newSshTab({ ...tb.sshConfig }) : isTermTab(tb) ? newTermTab(tb.cwd) : newTab(tb.path) },
    { id: 'term', label: t('newTermTab'), ic: IC.tconsole, fn: () => newTermTab(isTermTab(tb) ? tb.cwd : tb.path) },
    { sep: true },
    { id: 'clo', label: t('closeTab'), ic: IC.x, sc: 'Ctrl+W', dis: state.tabs.length <= 1, fn: () => closeTab(i) },
    { id: 'cloo', label: t('closeOtherTabs'), dis: state.tabs.length <= 1, fn: () => closeOtherTabs(i) },
    ...(typeof tabManagementMenu === 'function' ? [{ sep: true }, ...tabManagementMenu(tb)] : []),
  ]);
});
els.btnUp.addEventListener('click', goUp);
els.btnRefresh.addEventListener('click', () => refresh(true, true));
els.btnLang.addEventListener('click', () => setLocale(locale === 'zh' ? 'en' : 'zh'));
els.btnNew.addEventListener('click', newFolder);
els.btnCut.addEventListener('click', cutSel);
els.btnCopy.addEventListener('click', copySel);
els.btnPaste.addEventListener('click', pasteClip);
els.btnRename.addEventListener('click', () => { if (state.selection.size === 1) startRename([...state.selection][0]); });
els.btnDelete.addEventListener('click', deleteSel);
els.btnSort.addEventListener('click', sortMenu);
els.btnView.addEventListener('click', viewMenu);
els.btnMore.addEventListener('click', moreMenu);

els.search.addEventListener('input', () => {
  if (typeof handleWorkspaceSearchInput === 'function') { handleWorkspaceSearchInput(); return; }
  state.filter = els.search.value;
  els.scroller.scrollTop = 0;
  renderAll();
  els.searchClear.style.visibility = state.filter ? 'visible' : 'hidden';
  if (state.viewMode === 'grid') renderRows();
});
els.searchClear.addEventListener('click', () => {
  els.search.value = '';
  if (typeof handleWorkspaceSearchInput === 'function') { handleWorkspaceSearchInput(); els.search.focus(); return; }
  state.filter = '';
  els.scroller.scrollTop = 0;
  renderAll();
  els.searchClear.style.visibility = 'hidden';
});

els.menuLayer.addEventListener('pointerdown', (ev) => { if (ev.target === els.menuLayer) closeMenu(); });
els.menuLayer.addEventListener('contextmenu', (ev) => ev.preventDefault());

document.addEventListener('keydown', (ev) => {
  if (ev.target.closest?.('#aiPanel')) return;
  if (document.querySelector('dialog[open]')) return;
  if (ev.ctrlKey && ev.key.toLowerCase() === 'k') { ev.preventDefault(); openCommands(); return; }
  if (menuOpen) { if (ev.key === 'Escape') closeMenu(); return; }
  const tag = (ev.target.tagName || '').toUpperCase();
  if (state.renaming) return;
  if (ev.ctrlKey && ev.shiftKey && ev.key.toLowerCase() === 't') { ev.preventDefault(); newTermTab(); return; }
  // In a terminal tab, keystrokes belong to xterm; only intercept tab management.
  if (isTermTab(curTab())) {
    const k0 = ev.key;
    if (ev.ctrlKey && k0 === 'Tab') { ev.preventDefault(); switchTab((state.tab + (ev.shiftKey ? -1 : 1) + state.tabs.length) % state.tabs.length); }
    else if (ev.ctrlKey && (k0 === 'w' || k0 === 'W')) { ev.preventDefault(); closeTab(state.tab); }
    else if (ev.ctrlKey && (k0 === 't' || k0 === 'T')) { ev.preventDefault(); newTab(); }
    else if (ev.ctrlKey && /^[1-9]$/.test(k0)) { const n = +k0; if (n <= state.tabs.length) switchTab(n - 1); }
    return;
  }
  if (isBrowserTab(curTab())) {
    const k0 = ev.key;
    if (ev.ctrlKey && k0 === 'Tab') { ev.preventDefault(); switchTab((state.tab + (ev.shiftKey ? -1 : 1) + state.tabs.length) % state.tabs.length); }
    else if (ev.ctrlKey && (k0 === 'w' || k0 === 'W')) { ev.preventDefault(); closeTab(state.tab); }
    else if (ev.ctrlKey && (k0 === 't' || k0 === 'T')) { ev.preventDefault(); newBrowserTab(); }
    else if (ev.ctrlKey && /^[1-9]$/.test(k0)) { const n = +k0; if (n <= state.tabs.length) switchTab(n - 1); }
    else if (ev.altKey && k0 === 'ArrowLeft') { ev.preventDefault(); browserAction('back'); }
    else if (ev.altKey && k0 === 'ArrowRight') { ev.preventDefault(); browserAction('forward'); }
    return;
  }
  if (tag === 'INPUT' || tag === 'TEXTAREA' || ev.target.isContentEditable) {
    if (ev.key === 'Escape') ev.target.blur();
    if (ev.key === 'F5') { ev.preventDefault(); refresh(true, true); }
    return;
  }
  if (handleFileKeys(ev)) return;
  const k = ev.key;
  if (k === 'F5') { ev.preventDefault(); refresh(true, true); }
  else if (k === 'F2') { if (state.selection.size === 1) startRename([...state.selection][0]); }
  else if (k === 'Delete') deleteSel();
  else if (k === 'Backspace') goUp();
  else if (k === 'Enter') openSelected();
  else if (k === 'Escape') clearSelection();
  else if (ev.ctrlKey && (k === 'a' || k === 'A')) { ev.preventDefault(); if (state.entries) { state.selection = new Set(state.view.map((x) => x.name)); applySelectionDom(); renderStatus(); renderBar2(); } }
  else if (ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey && (k === 'c' || k === 'C')) { ev.preventDefault(); void copySelectedPaths(); }
  else if (ev.ctrlKey && (k === 'c' || k === 'C')) copySel();
  else if (ev.ctrlKey && (k === 'x' || k === 'X')) cutSel();
  else if (ev.ctrlKey && (k === 'v' || k === 'V')) pasteClip();
  else if (ev.ctrlKey && (k === 'f' || k === 'F')) { ev.preventDefault(); els.search.focus(); }
  else if (ev.ctrlKey && (k === 't' || k === 'T')) { ev.preventDefault(); newTab(); }
  else if (ev.ctrlKey && (k === 'w' || k === 'W')) { ev.preventDefault(); closeTab(state.tab); }
  else if (ev.ctrlKey && k === 'Tab') { ev.preventDefault(); switchTab((state.tab + (ev.shiftKey ? -1 : 1) + state.tabs.length) % state.tabs.length); }
  else if (ev.ctrlKey && /^[1-9]$/.test(k)) { const n = +k; if (n <= state.tabs.length) switchTab(n - 1); }
  else if (ev.altKey && k === 'ArrowLeft') { ev.preventDefault(); goBack(); }
  else if (ev.altKey && k === 'ArrowRight') { ev.preventDefault(); goFwd(); }
  else if (ev.altKey && k === 'ArrowUp') { ev.preventDefault(); goUp(); }
  else if (ev.altKey && (k === 'd' || k === 'D')) { ev.preventDefault(); enterPathEdit(); }
});

window.addEventListener('contextmenu', (ev) => ev.preventDefault());

els.termHost.addEventListener('mousedown', () => {
  const tb = curTab();
  if (isTermTab(tb) && tb.term) tb.term.focus();
});

let layoutFrame = null;
function scheduleContentLayout() {
  if (layoutFrame !== null) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = null;
    if (isTermTab(curTab())) fitTerm(curTab());
    else if (isBrowserTab(curTab())) syncBrowserBounds();
    else if (!els.scroller.classList.contains('hidden')) renderList();
  });
}
window.addEventListener('resize', scheduleContentLayout);

let fsRefreshPending = null, fsRefreshTimer = null, fsRefreshRunning = false;
function scheduleFilesystemRefresh() {
  if (fsRefreshTimer !== null || fsRefreshRunning || !fsRefreshPending) return;
  fsRefreshTimer = setTimeout(async () => {
    fsRefreshTimer = null;
    const pending = fsRefreshPending;
    if (!pending) return;
    if (curTab() !== pending.owner || state.path !== pending.path || isTermTab(curTab()) || isBrowserTab(curTab())) {
      fsRefreshPending = null; return;
    }
    // Retain the event while the user edits or uses a menu; do not lose updates.
    if (state.loading || state.renaming || menuOpen || (typeof columnInteractionActive === 'function' && columnInteractionActive())) {
      scheduleFilesystemRefresh(); return;
    }
    fsRefreshPending = null; fsRefreshRunning = true;
    try { await refresh(true); }
    finally { fsRefreshRunning = false; scheduleFilesystemRefresh(); }
  }, 400);
}
listen('fs-changed', (ev) => {
  if (isTermTab(curTab()) || isBrowserTab(curTab())) return;
  if (ev.payload === state.path) {
    fsRefreshPending = { owner: curTab(), path: state.path };
    scheduleFilesystemRefresh();
  }
});

// folder sizes stream in from the backend; patch rows without disturbing a rename
listen('dir-size', (ev) => {
  const { gen, path: p, size } = ev.payload || {};
  if (!state.entries || typeof p !== 'string') return;
  queueDirSize(gen, p, size);
});

listen('index-updated', scheduleIndexLookup);

listen('index-busy', (ev) => {
  const b = !!ev.payload;
  if (b !== indexBusy) {
    indexBusy = b;
    renderStatus();
  }
});

function onTermOutput(ev) {
  const { id, key, data } = ev.payload || {};
  const tb = state.tabs.find((x) => isTermTab(x) && x.key === key && !x.disposed);
  if (!tb || tb.exited || (tb.termId != null && tb.termId !== id)) return;
  tb.termId = id;
  if (tb.term) tb.term.write(data);
  if (tb.interruptPending && typeof interruptSshTab === 'function') interruptSshTab(tb);
  flushTermInput(tb);
}

function onTermClosed(ev) {
  const tb = state.tabs.find((x) => isTermTab(x) && x.key === (ev.payload || {}).key && !x.disposed);
  if (tb && !tb.exited && (tb.termId == null || tb.termId === ev.payload?.id)) {
    tb.starting = false;
    tb.exited = true;
    tb.exitCode = ev.payload?.exitCode ?? null;
    if (typeof disconnectSshQueue === 'function' && tb.connection === 'ssh') disconnectSshQueue(tb);
    tb.termId = null; tb.interruptPending = false;
    tb.input = '';
    if (tb.term) tb.term.write('\r\n\x1b[90m' + t('procExited') + '\x1b[0m\r\n');
    renderTabs();
    if (typeof syncSshInfo === 'function') syncSshInfo(tb);
    if (curTab() === tb) { renderStatus(); renderCrumbs(); }
  }
}

const terminalEventsReady = Promise.all([listen('term-out', onTermOutput), listen('term-closed', onTermClosed)]);
// Failure is surfaced in the terminal tab when starting; avoid an unhandled rejection at boot.
terminalEventsReady.catch(() => {});

/* ============================== init ============================== */
window.addEventListener('DOMContentLoaded', async function init() {
  if (typeof initPortableSettings === 'function') await initPortableSettings();
  initWorkspace();
  if (typeof initTabManagement === 'function') initTabManagement();
  if (typeof initColumns === 'function') initColumns();
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en-US';
  state.tabs = [{ path: null, history: [], hIdx: -1 }];
  state.tab = 0;
  const initialTab = curTab(), initialToken = state.navToken;
  try { state.roots = await invoke('roots'); } catch {}
  if (typeof restoreWorkspaceOnStartup === 'function') {
    await restoreWorkspaceOnStartup({ initialTab, initialToken });
    return;
  }
  const last = store.get('lastPath', null);
  let preserveActive = curTab() !== initialTab || state.navToken !== initialToken;
  if (!preserveActive) {
    const loading = navigate(last, { push: true }).catch(() => {});
    const navigationToken = state.navToken;
    await loading;
    preserveActive = curTab() !== initialTab || state.navToken !== navigationToken;
  }
  if (typeof restoreBrowserSession === 'function') await restoreBrowserSession({ preserveActive });
});
