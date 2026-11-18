/**
 * Dalizi Files motion study — local workspace chapters.
 * Every shape is procedural Canvas 2D. All files and document contents are demos.
 * Feature sources: ui/index.html, ui/dual-pane.js, docs/USER_GUIDE.md.
 */
const C = { ink: '#171b1a', muted: '#798079', gold: '#d5ad52', green: '#477360', paper: '#fffefa', pale: '#f3f0e8', border: '#dedfd7', selected: '#edf1e9', blue: '#637e95' };
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const ease = x => { x = clamp(x); return 1 - Math.pow(1 - x, 3); };
const smooth = (a, b, x) => { x = clamp((x - a) / (b - a)); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
const pulse = (t, at, duration = .7) => Math.sin(clamp((t - at) / duration) * Math.PI);

function withAlpha(ctx, a, fn) { if (a <= 0) return; ctx.save(); ctx.globalAlpha *= clamp(a); fn(); ctx.restore(); }
function clip(ctx, x, y, w, h, r, fn) { ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip(); fn(); ctx.restore(); }
function rr(ctx, x, y, w, h, r, fill, stroke, lw = 1) {
  ctx.beginPath(); ctx.roundRect(x, y, Math.max(0, w), Math.max(0, h), r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function txt(ctx, text, x, y, size = 24, color = C.ink, weight = 400, align = 'left') {
  ctx.font = `${weight} ${size}px "Segoe UI", "Microsoft YaHei UI", sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = color; ctx.fillText(text, x, y);
}
function line(ctx, x1, y1, x2, y2, color = C.border, width = 1) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineWidth = width; ctx.strokeStyle = color; ctx.stroke();
}
function label(ctx, text, x, y, color = C.green, bg = C.selected, size = 18) {
  ctx.font = `500 ${size}px "Segoe UI", "Microsoft YaHei UI", sans-serif`;
  const w = ctx.measureText(text).width + 30;
  rr(ctx, x, y, w, 36, 18, bg); txt(ctx, text, x + 15, y + 24, size, color, 500); return w;
}
function shadow(ctx, fn, blur = 44, y = 18) { ctx.save(); ctx.shadowColor = 'rgba(27,35,28,.11)'; ctx.shadowBlur = blur; ctx.shadowOffsetY = y; fn(); ctx.restore(); }
function icon(ctx, type, x, y, s = 28, color = C.gold) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s / 32, s / 32); ctx.lineWidth = 1.8; ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath();
  if (type === 'folder') { ctx.moveTo(3, 8); ctx.lineTo(13, 8); ctx.lineTo(17, 12); ctx.lineTo(29, 12); ctx.lineTo(29, 27); ctx.lineTo(3, 27); ctx.closePath(); ctx.globalAlpha *= .22; ctx.fill(); ctx.globalAlpha /= .22; ctx.stroke(); }
  else if (type === 'terminal') { ctx.moveTo(6, 9); ctx.lineTo(13, 16); ctx.lineTo(6, 23); ctx.moveTo(17, 24); ctx.lineTo(27, 24); ctx.stroke(); }
  else if (type === 'globe') { ctx.arc(16, 16, 12, 0, Math.PI * 2); ctx.moveTo(4, 16); ctx.lineTo(28, 16); ctx.moveTo(16, 4); ctx.bezierCurveTo(26, 12, 26, 20, 16, 28); ctx.bezierCurveTo(6, 20, 6, 12, 16, 4); ctx.stroke(); }
  else if (type === 'search') { ctx.arc(13, 13, 9, 0, Math.PI * 2); ctx.moveTo(20, 20); ctx.lineTo(29, 29); ctx.stroke(); }
  else if (type === 'check') { ctx.moveTo(6, 16); ctx.lineTo(13, 23); ctx.lineTo(27, 8); ctx.stroke(); }
  else if (type === 'arrow') { ctx.moveTo(4, 16); ctx.lineTo(28, 16); ctx.moveTo(20, 8); ctx.lineTo(28, 16); ctx.lineTo(20, 24); ctx.stroke(); }
  else if (type === 'split') { ctx.roundRect(3, 5, 26, 22, 3); ctx.moveTo(16, 5); ctx.lineTo(16, 27); ctx.stroke(); }
  else { ctx.moveTo(7, 3); ctx.lineTo(20, 3); ctx.lineTo(27, 10); ctx.lineTo(27, 29); ctx.lineTo(7, 29); ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(20, 3); ctx.lineTo(20, 10); ctx.lineTo(27, 10); ctx.stroke(); if (type === 'sheet') { for (let n = 0; n < 3; n++) line(ctx, 11, 16 + n * 4, 23, 16 + n * 4, color, 1.2); line(ctx, 17, 14, 17, 25, color, 1.2); } else { line(ctx, 11, 16, 22, 16, color, 1.3); line(ctx, 11, 21, 22, 21, color, 1.3); } }
  ctx.restore();
}
function pointer(ctx, x, y, click = 0) {
  if (click > 0) { ctx.save(); ctx.strokeStyle = `rgba(213,173,82,${.6 * (1 - click)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 8 + 35 * click, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
  ctx.save(); ctx.translate(x, y); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(4, 28); ctx.lineTo(11, 21); ctx.lineTo(18, 34); ctx.lineTo(24, 31); ctx.lineTo(17, 18); ctx.lineTo(27, 16); ctx.closePath(); ctx.fillStyle = C.ink; ctx.fill(); ctx.strokeStyle = 'white'; ctx.lineWidth = 2.2; ctx.stroke(); ctx.restore();
}
function topTitle(ctx, kicker, heading, sub, t) {
  const p = ease(t / 1.1); withAlpha(ctx, p, () => { ctx.save(); ctx.translate(0, 22 * (1 - p)); txt(ctx, kicker, 120, 160, 19, C.green, 600); txt(ctx, heading, 120, 225, 54, C.ink, 600); txt(ctx, sub, 122, 272, 24, C.muted); ctx.restore(); });
}
function foot(ctx, text, t) { withAlpha(ctx, smooth(.8, 1.5, t), () => { line(ctx, 120, 929, 1800, 929); txt(ctx, text, 120, 964, 19, C.muted); txt(ctx, '界面重绘 · 演示数据', 1800, 964, 17, C.muted, 400, 'right'); }); }

function windowBase(ctx, x, y, w, h, title = 'Dalizi Files') {
  shadow(ctx, () => rr(ctx, x, y, w, h, 20, C.paper, C.border));
  rr(ctx, x, y, w, 50, [20, 20, 0, 0], '#f5f5ef');
  [C.gold, '#bcc7b8', '#d5d8cf'].forEach((c, i) => { ctx.beginPath(); ctx.arc(x + 25 + i * 19, y + 25, 5, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); });
  txt(ctx, title, x + 91, y + 32, 18, C.muted, 500); txt(ctx, '—    □    ×', x + w - 26, y + 32, 17, C.muted, 400, 'right');
  line(ctx, x, y + 50, x + w, y + 50);
}
function row(ctx, x, y, w, name, type, detail, selected = false, opacity = 1) {
  withAlpha(ctx, opacity, () => { if (selected) rr(ctx, x, y - 34, w, 49, 9, C.selected); icon(ctx, type, x + 16, y - 26, 27, type === 'folder' ? C.gold : type === 'sheet' ? C.green : C.blue); txt(ctx, name, x + 58, y - 3, 21, C.ink, selected ? 600 : 400); if (detail) txt(ctx, detail, x + w - 20, y - 3, 18, C.muted, 400, 'right'); });
}

function fileView(ctx, x, y, w, h, t) {
  txt(ctx, '设计项目', x + 28, y + 49, 31, C.ink, 600);
  txt(ctx, '文件、资料与下一步，都在手边。', x + 28, y + 81, 19, C.muted);
  label(ctx, '列表', x + w - 178, y + 28, C.green); label(ctx, '网格', x + w - 96, y + 28, C.muted, '#f2f3ed');
  line(ctx, x + 28, y + 105, x + w - 28, y + 105);
  const names = [['项目文档', 'folder', '文件夹'], ['设计素材', 'folder', '文件夹'], ['产品说明.pdf', 'pdf', '2.4 MB'], ['需求清单.xlsx', 'sheet', '186 KB'], ['README.md', 'file', '4 KB']];
  txt(ctx, '名称', x + 42, y + 135, 16, C.muted); txt(ctx, '大小 / 类型', x + w - 46, y + 135, 16, C.muted, 400, 'right');
  names.forEach((r, i) => row(ctx, x + 28, y + 178 + 49 * i, w - 56, ...r, i === 2, smooth(i * .08, .4 + i * .08, t)));
}
function terminalView(ctx, x, y, w, h, t) {
  rr(ctx, x + 16, y + 16, w - 32, h - 28, 13, '#1e2824');
  txt(ctx, 'PowerShell  /  当前文件夹', x + 43, y + 52, 18, '#b8c7b8', 500);
  line(ctx, x + 42, y + 70, x + w - 42, y + 70, '#37463e');
  const lines = [ ['PS D:\\设计项目>', '#e0c17c'], ['  Get-ChildItem', '#e5ede3'], ['  项目文档          设计素材', '#c3d9c4'], ['  产品说明.pdf      需求清单.xlsx', '#c3d9c4'], ['', '#c3d9c4'], ['PS D:\\设计项目> ', '#e0c17c'] ];
  lines.forEach((r, i) => { const amount = clamp((t - .2 - i * .2) * 2); txt(ctx, r[0].slice(0, Math.ceil(r[0].length * amount)), x + 43, y + 110 + i * 43, 23, r[1], 400); });
  if (Math.floor(t * 2) % 2 === 0) rr(ctx, x + 295, y + 307, 12, 26, 0, '#e0c17c');
}
function webView(ctx, x, y, w, h, t) {
  rr(ctx, x + 22, y + 20, w - 44, 42, 9, '#f0f2ea'); icon(ctx, 'globe', x + 35, y + 29, 24, C.green); txt(ctx, '项目文档 / 使用指南', x + 72, y + 49, 19, C.muted);
  txt(ctx, '保持思路在线。', x + 48, y + 123, 38, C.ink, 600); txt(ctx, '查资料，回到文件，继续工作。', x + 48, y + 164, 23, C.muted);
  const labels = ['快速开始', '文件工作区', '常用快捷键'];
  labels.forEach((labelText, i) => { const p = smooth(.1 + .1 * i, .6 + .1 * i, t); withAlpha(ctx, p, () => { const yy = y + 202 + 52 * i + (1 - p) * 12; txt(ctx, `0${i + 1}`, x + 49, yy + 24, 18, C.gold, 600); txt(ctx, labelText, x + 105, yy + 24, 22, C.ink, 500); line(ctx, x + 46, yy + 43, x + w - 45, yy + 43); icon(ctx, 'arrow', x + w - 75, yy + 4, 25, C.green); }); });
}

function workspace(ctx, t) {
  topTitle(ctx, '01  /  ONE WORKSPACE', '打开的，是文件。连接的，是工作。', '文件夹、PowerShell、网页，沿着同一条标签栏展开。', t);
  const enter = ease(t / 1.25), camera = .965 + .035 * enter + .012 * Math.sin(clamp(t / 12) * Math.PI);
  ctx.save(); ctx.translate(960, 620 + 65 * (1 - enter)); ctx.scale(camera, camera); ctx.rotate(-.012 * (1 - enter)); ctx.translate(-960, -620); ctx.globalAlpha *= enter;
  const x = 205, y = 325, w = 1510, h = 570, sx = x + 225;
  windowBase(ctx, x, y, w, h);
  clip(ctx, x + 1, y + 51, w - 2, h - 52, [0, 0, 19, 19], () => {
    rr(ctx, x, y + 50, 225, h - 50, 0, '#f3f4ed');
    rr(ctx, x + 24, y + 81, 44, 44, 13, C.ink); txt(ctx, 'd·', x + 32, y + 113, 32, C.gold, 650); txt(ctx, 'Dalizi Files', x + 81, y + 105, 21, C.ink, 650); txt(ctx, '你的文件，自在有序', x + 81, y + 128, 12, C.muted);
    txt(ctx, '快速访问', x + 28, y + 181, 15, C.muted, 600);
    ['设计项目', '桌面', '下载', '文档'].forEach((s, i) => { if (i === 0) rr(ctx, x + 13, y + 201 + i * 53, 199, 45, 8, '#e3e8dc'); icon(ctx, 'folder', x + 27, y + 210 + i * 53, 25); txt(ctx, s, x + 69, y + 232 + i * 53, 20, i ? C.muted : C.green, i ? 400 : 600); });
    txt(ctx, 'v0.5.1', x + 28, y + h - 25, 15, C.muted); txt(ctx, '设置', x + 185, y + h - 25, 15, C.muted, 400, 'right');
    line(ctx, sx, y + 50, sx, y + h);
    const active = t < 3.2 ? 0 : t < 5.8 ? 1 : t < 8.6 ? 2 : 0;
    const tabs = [['设计项目', 'folder'], ['PowerShell', 'terminal'], ['项目文档', 'globe']];
    tabs.forEach((item, i) => { const p = ease((t - i * .18) / .9); const tx = sx + 14 + i * 245; withAlpha(ctx, p, () => { rr(ctx, tx, y + 61 + (1 - p) * -28, 235, 44, 9, i === active ? C.paper : '#eff0e9'); icon(ctx, item[1], tx + 14, y + 70 + (1 - p) * -28, 24, i === active ? C.green : C.muted); txt(ctx, item[0], tx + 50, y + 90 + (1 - p) * -28, 19, i === active ? C.ink : C.muted, 500); txt(ctx, '×', tx + 216, y + 90, 18, C.muted, 400, 'right'); }); });
    rr(ctx, sx + 16 + active * 245, y + 107, 231, 3, 1.5, C.gold);
    txt(ctx, '+', sx + 773, y + 92, 27, C.muted); txt(ctx, 'SSH', x + w - 38, y + 90, 17, C.green, 600, 'right');
    rr(ctx, sx + 18, y + 125, w - 261, 42, 8, '#f6f6f0', C.border); txt(ctx, active === 2 ? '项目文档' : 'D:  ›  设计项目', sx + 36, y + 153, 19, C.muted); icon(ctx, 'search', x + w - 61, y + 134, 22, C.muted);
    const vx = sx + 3, vy = y + 180, vw = w - 228, vh = h - 193;
    let mix = 0, oldMode = active;
    const previous = [[3.2, 0], [5.8, 1], [8.6, 2]].find(([at]) => t >= at && t < at + .45);
    if (previous) { mix = 1 - smooth(previous[0], previous[0] + .45, t); oldMode = previous[1]; }
    const drawMode = (mode, a) => withAlpha(ctx, a, () => {
      ctx.save(); ctx.translate(0, (1 - a) * 15);
      if (mode === 0) fileView(ctx, vx, vy, vw, vh, t);
      else if (mode === 1) terminalView(ctx, vx, vy, vw, vh, t - 3.2);
      else webView(ctx, vx, vy, vw, vh, t - 5.8);
      ctx.restore();
    });
    if (mix) drawMode(oldMode, mix); drawMode(active, 1 - mix);
    const tabX = sx + 120 + active * 245;
    if (t > 2.7) pointer(ctx, tabX + 34 * Math.sin(t * .35), y + 92, pulse(t, active === 1 ? 3.2 : active === 2 ? 5.8 : 8.6));
  });
  ctx.restore();
  withAlpha(ctx, smooth(9.2, 10, t), () => {
    shadow(ctx, () => rr(ctx, 1245, 838, 492, 65, 16, C.ink), 25, 10);
    icon(ctx, 'check', 1267, 853, 30, C.gold); txt(ctx, '少一些窗口切换，多一些连续思考。', 1310, 878, 21, C.paper, 500);
  });
  foot(ctx, '独立标签与历史  ·  拖动排序  ·  收藏常用目录与网页', t);
}

function dualPane(ctx, t) {
  topTitle(ctx, '02  /  SIDE BY SIDE', '两个目录，一次顺手的整理。', '独立浏览，跨面板复制与移动。让来回切换，变成左右对照。', t);
  const p = ease(t / 1.1), x1 = 135 - (1 - p) * 70, x2 = 1025 + (1 - p) * 70, y = 335, w = 760, h = 555;
  const names = [['产品说明.pdf', 'pdf', '2.4 MB'], ['需求清单.xlsx', 'sheet', '186 KB'], ['README.md', 'file', '4 KB']];
  withAlpha(ctx, p, () => {
    [x1, x2].forEach((x, i) => {
      windowBase(ctx, x, y, w, h, i ? '文件对照面板' : '工作目录');
      icon(ctx, 'folder', x + 30, y + 77, 34); txt(ctx, i ? 'D:  ›  交付资料' : 'D:  ›  设计项目', x + 80, y + 105, 24, C.ink, 600);
      line(ctx, x + 25, y + 131, x + w - 25, y + 131);
      txt(ctx, '名称', x + 38, y + 165, 17, C.muted); txt(ctx, '大小', x + w - 38, y + 165, 17, C.muted, 400, 'right');
      row(ctx, x + 20, y + 216, w - 40, i ? '历史交付' : '设计素材', 'folder', '文件夹');
      if (!i) names.forEach((r, index) => row(ctx, x + 20, y + 271 + index * 57, w - 40, ...r, t > 1.8 + index * .28));
      else names.forEach((r, index) => { const arrive = smooth(5.6 + index * .65, 6.1 + index * .65, t); row(ctx, x + 20 + (1 - arrive) * 20, y + 271 + index * 57, w - 40, ...r, t < 9.5, arrive); });
      line(ctx, x + 25, y + h - 70, x + w - 25, y + h - 70);
      txt(ctx, i ? t > 7.5 ? '4 项  ·  复制完成' : '目标目录' : t > 2.7 ? '4 项  ·  已选择 3 项' : '4 项', x + 29, y + h - 30, 18, C.muted);
      if (!i) label(ctx, '左侧工作目录', x + w - 172, y + h - 56, C.green, C.selected, 16);
    });
    // A fine route line becomes a ribbon, carrying a staggered file cascade.
    const route = smooth(2.2, 3.5, t);
    withAlpha(ctx, route * .55, () => { ctx.save(); ctx.strokeStyle = C.gold; ctx.lineWidth = 1.5; ctx.setLineDash([4, 8]); ctx.beginPath(); ctx.moveTo(860, 652); ctx.bezierCurveTo(942, 560, 973, 560, 1058, 652); ctx.stroke(); ctx.restore(); });
    shadow(ctx, () => rr(ctx, 916, 505, 88, 88, 27, t > 7.6 ? C.green : C.ink), 28, 8);
    icon(ctx, t > 7.6 ? 'check' : 'arrow', 940, 528, 40, t > 7.6 ? C.paper : C.gold);
    txt(ctx, t > 7.6 ? '已完成' : '复制到右侧', 960, 628, 18, C.green, 600, 'center');
    if (t > 3.6 && t < 8) {
      names.forEach((item, i) => {
        const a = clamp((t - 3.8 - i * .65) / 2.0); if (a <= 0 || a >= 1) return;
        const f = a * a * (3 - 2 * a), xx = lerp(716, 1156, f), yy = lerp(606 + i * 57, 606 + i * 57, f) - Math.sin(f * Math.PI) * (188 + i * 18);
        // Procedural motion echoes, no bitmap motion-blur assets.
        for (let trail = 4; trail >= 1; trail--) { const af = clamp(f - trail * .035), tx = lerp(716, 1156, af), ty = 606 + i * 57 - Math.sin(af * Math.PI) * (188 + i * 18); withAlpha(ctx, .04 + (4 - trail) * .025, () => rr(ctx, tx - 44, ty - 40, 88, 80, 17, C.gold)); }
        ctx.save(); ctx.translate(xx, yy); ctx.rotate(Math.sin(a * Math.PI * 2) * .12); shadow(ctx, () => rr(ctx, -52, -46, 104, 92, 20, C.paper, C.gold, 1.5), 22, 9); icon(ctx, item[1], -23, -29, 46, i === 1 ? C.green : C.gold); txt(ctx, ['PDF', 'XLSX', 'MD'][i], 0, 31, 14, C.muted, 600, 'center'); ctx.restore();
      });
    }
    // Follow the actual operation: select, transfer, confirm copy.
    if (t > 1.5 && t < 4.3) {
      const toButton = smooth(2.7, 3.4, t); pointer(ctx, lerp(630, 961, toButton), lerp(610, 548, toButton), pulse(t, 3.35));
    }
    if (t > 3.0 && t < 4.6) {
      const a = smooth(3.0, 3.25, t) * (1 - smooth(4.2, 4.6, t));
      withAlpha(ctx, a, () => { shadow(ctx, () => rr(ctx, 777, 696, 366, 112, 17, C.paper, C.border), 30, 10); txt(ctx, '跨面板文件操作 · 3 项', 800, 731, 19, C.ink, 600); rr(ctx, 800, 750, 150, 39, 8, C.green); txt(ctx, '复制', 875, 776, 18, C.paper, 600, 'center'); rr(ctx, 964, 750, 150, 39, 8, '#eeefe8'); txt(ctx, '移动', 1039, 776, 18, C.muted, 500, 'center'); pointer(ctx, 908, 773, pulse(t, 3.85)); });
    }
    const finished = smooth(7.4, 8.2, t);
    withAlpha(ctx, finished, () => { shadow(ctx, () => rr(ctx, 696, 822, 528, 71, 18, C.green), 30, 10); icon(ctx, 'check', 723, 844, 30, C.paper); txt(ctx, '3 个文件，已复制到「交付资料」', 767, 866, 23, C.paper, 600); });
  });
  foot(ctx, '左右目录独立导航  ·  复制 / 移动明确选择  ·  支持外部文件拖入', t);
}

function pdfPreview(ctx, x, y, w, h, t) {
  rr(ctx, x, y, w, h, 14, '#eaece4');
  const pageW = 320, px = x + 38, py = y + 22;
  shadow(ctx, () => rr(ctx, px, py, pageW, h - 44, 2, '#fffefa'), 18, 5);
  txt(ctx, 'PROJECT / 2026', px + 27, py + 33, 10, C.green, 600);
  txt(ctx, '产品说明', px + 27, py + 77, 31, C.ink, 600);
  line(ctx, px + 27, py + 98, px + pageW - 27, py + 98, C.gold, 2);
  txt(ctx, '让资料有序，让交付从容。', px + 27, py + 125, 14, C.muted);
  for (let i = 0; i < 7; i++) rr(ctx, px + 27, py + 148 + i * 14, [250, 260, 234, 258, 188, 253, 211][i], 3, 1, '#d4d7cd');
  rr(ctx, px + 27, py + 264, 267, 47, 4, '#e9eee3'); txt(ctx, '01  设计目标  /  工作流程', px + 40, py + 292, 13, C.green, 500);
  txt(ctx, '01', px + pageW - 28, py + h - 49, 10, C.muted, 400, 'right');
  const rx = px + pageW + 43;
  txt(ctx, 'PDF 阅读', rx, y + 61, 27, C.ink, 600);
  txt(ctx, '翻页 · 缩放 · 加宽阅读', rx, y + 101, 19, C.muted);
  label(ctx, '1 / 8 页', rx, y + 135, C.green, '#f8faf3', 18);
  rr(ctx, rx, y + 202, 258, 48, 9, '#f8faf3'); txt(ctx, '−', rx + 24, y + 234, 23, C.muted); txt(ctx, '适合宽度', rx + 129, y + 234, 19, C.ink, 500, 'center'); txt(ctx, '+', rx + 230, y + 234, 23, C.muted);
  txt(ctx, '本地预览', rx, y + 304, 18, C.green, 500);
  txt(ctx, '内容，就在文件旁边。', rx, y + 335, 20, C.muted);
  withAlpha(ctx, pulse(t, 1.1, 2) * .45, () => { ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(px - 5, py - 5, pageW + 10, h - 34, 7); ctx.stroke(); });
}
function sheetPreview(ctx, x, y, w, h, t) {
  rr(ctx, x, y, w, h, 14, '#f6f7f0');
  txt(ctx, '需求清单.xlsx', x + 25, y + 36, 23, C.ink, 600); txt(ctx, '单元格值预览', x + w - 22, y + 36, 16, C.muted, 400, 'right');
  const tx = x + 23, ty = y + 58, tw = w - 46, cols = [46, 292, 218, tw - 556];
  rr(ctx, tx, ty, tw, 42, 0, '#e4eadc');
  const headers = ['', 'A', 'B', 'C']; let off = 0;
  headers.forEach((s, i) => { txt(ctx, s, tx + off + cols[i] / 2, ty + 28, 17, C.green, 600, 'center'); off += cols[i]; });
  const rows = [['1', '交付项目', '负责人', '状态'], ['2', '产品说明', '设计团队', '已完成'], ['3', '需求清单', '产品团队', '已确认'], ['4', '项目归档', '项目团队', '进行中']];
  rows.forEach((r, j) => { const yy = ty + 42 + j * 47; rr(ctx, tx, yy, tw, 47, 0, j === 0 ? '#eef1e8' : j % 2 ? '#fffefa' : '#f6f7f0'); let xx = tx; r.forEach((v, i) => { txt(ctx, v, xx + (i ? 15 : cols[i] / 2), yy + 31, i ? 19 : 16, i === 0 ? C.muted : j === 0 ? C.ink : i === 3 ? C.green : C.ink, j === 0 ? 600 : 400, i ? 'left' : 'center'); xx += cols[i]; }); line(ctx, tx, yy + 47, tx + tw, yy + 47, C.border); });
  let cx = tx; cols.forEach(v => { line(ctx, cx, ty, cx, ty + 230, C.border); cx += v; });
  rr(ctx, tx + 46, ty + 89, cols[1], 47, 0, null, C.green, 2);
  label(ctx, '交付清单', tx, y + h - 58, C.green, '#e0e8d8', 17); label(ctx, '素材索引', tx + 124, y + h - 58, C.muted, '#eef0e7', 17);
  txt(ctx, '第 1 页', x + w - 24, y + h - 33, 16, C.muted, 400, 'right');
}

function searchPreview(ctx, t) {
  topTitle(ctx, '03  /  FIND. OPEN. UNDERSTAND.', '从找到，到读懂。', '用搜索收拢线索，让预览把内容带到眼前。', t);
  const p = ease(t / 1.05); withAlpha(ctx, p, () => {
    const y = 325 + 30 * (1 - p), isSheet = t >= 8.2;
    shadow(ctx, () => rr(ctx, 150, y, 1620, 91, 18, C.paper, C.border), 30, 10);
    icon(ctx, 'search', 181, y + 29, 32, C.green);
    rr(ctx, 237, y + 22, 170, 47, 9, C.selected); txt(ctx, '含子目录  ⌄', 322, y + 53, 21, C.green, 500, 'center');
    const query = isSheet ? 'ext:xlsx;csv' : '*.pdf !草稿'; const n = Math.floor(query.length * clamp((t - .65) / 2));
    txt(ctx, query.slice(0, isSheet ? query.length : n), 434, y + 56, 29, C.ink, 500);
    if (t < 3 && Math.floor(t * 3) % 2 === 0) { ctx.font = '500 29px "Segoe UI", "Microsoft YaHei UI", sans-serif'; const tw = ctx.measureText(query.slice(0, n)).width; line(ctx, 438 + tw, y + 31, 438 + tw, y + 61, C.gold, 2); }
    label(ctx, '常用搜索语法', 1511, y + 28, C.muted, '#f3f4ee', 17);
    // Result pane stays fixed while its content is refined, matching app behavior.
    windowBase(ctx, 150, 442, 690, 445, '搜索结果');
    txt(ctx, isSheet ? '工作表与数据' : 'PDF 文档', 178, 535, 26, C.ink, 600);
    txt(ctx, isSheet ? '2 个示例结果' : '3 个示例结果', 810, 535, 17, C.muted, 400, 'right');
    const results = isSheet ? [['需求清单.xlsx', 'sheet', '186 KB'], ['素材索引.csv', 'sheet', '38 KB']] : [['产品说明.pdf', 'pdf', '2.4 MB'], ['设计规范.pdf', 'pdf', '1.8 MB'], ['交付检查.pdf', 'pdf', '640 KB']];
    results.forEach((r, i) => {
      const a = smooth(2.4 + i * .18, 3 + i * .18, t);
      row(ctx, 171, 595 + i * 75, 647, ...r, i === 0 && t > 4, a);
      withAlpha(ctx, a, () => txt(ctx, `D:\\设计项目\\${i === 0 ? '文档' : '资料'}`, 229, 620 + i * 75, 15, C.muted));
    });
    txt(ctx, '定位文件夹  ↗', 178, 856, 18, C.green, 500); txt(ctx, '复制完整路径', 806, 856, 17, C.muted, 400, 'right');
    const reveal = smooth(3.8, 4.7, t);
    withAlpha(ctx, reveal, () => { ctx.save(); ctx.translate(55 * (1 - reveal), 0); windowBase(ctx, 876, 442, 894, 445, '文件预览');
      label(ctx, 'PDF', 1395, 450, !isSheet ? C.green : C.muted, !isSheet ? C.selected : '#f3f4ed', 16);
      label(ctx, 'Word', 1472, 450, C.muted, '#f3f4ed', 16);
      label(ctx, '表格', 1560, 450, isSheet ? C.green : C.muted, isSheet ? C.selected : '#f3f4ed', 16);
      clip(ctx, 894, 505, 858, 365, 12, () => {
        const blend = smooth(8.2, 8.7, t);
        if (blend < 1) withAlpha(ctx, 1 - blend, () => pdfPreview(ctx, 894, 505, 858, 365, t - 4));
        if (blend > 0) withAlpha(ctx, blend, () => sheetPreview(ctx, 894, 505, 858, 365, t - 8.2));
      }); ctx.restore();
    });
    if (t > 3.1 && t < 5.1) { const q = smooth(3.1, 3.9, t); pointer(ctx, lerp(700, 463, q), lerp(390, 592, q), pulse(t, 4)); }
    if (t > 7.5 && t < 9.1) { const q = smooth(7.5, 8.1, t); pointer(ctx, lerp(1498, 1590, q), lerp(676, 469, q), pulse(t, 8.15)); }
    withAlpha(ctx, 1 - reveal, () => { txt(ctx, '选中文件，即刻预览', 1325, 656, 26, C.muted, 500, 'center'); ctx.save(); ctx.strokeStyle = C.border; ctx.lineWidth = 1.2; ctx.setLineDash([5, 8]); ctx.beginPath(); ctx.roundRect(876, 442, 894, 445, 20); ctx.stroke(); ctx.restore(); });
  });
  foot(ctx, '当前目录 / 含子目录 / 全部位置  ·  文件名索引搜索  ·  PDF、Word 正文、Excel / CSV 预览', t);
}

export const localChapters = [
  { start: 12, end: 24, name: '同一工作区', summary: '文件、终端与网页标签' },
  { start: 24, end: 36, name: '双面板整理', summary: '独立目录与跨面板复制' },
  { start: 36, end: 48, name: '搜索与预览', summary: '常用查询语法与本地阅读' }
];

export function drawLocal(ctx, time, kit) {
  // Independent scene functions make arbitrary seeking and offline frame export deterministic.
  void kit;
  if (time < 12 || time >= 48) return;
  ctx.save();
  if (time < 24) workspace(ctx, time - 12);
  else if (time < 36) dualPane(ctx, time - 24);
  else searchPreview(ctx, time - 36);
  ctx.restore();
}
