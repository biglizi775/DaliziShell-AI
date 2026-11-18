// Captures the application's real HTML/CSS/JS. Only backend data is simulated.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHarness } = require('./authentic-harness.cjs');

function demoPdf() {
  const content = (page) => `0.97 0.98 0.99 rg 0 0 540 620 re f\n0.31 0.41 0.85 rg 40 548 46 4 re f\n0.12 0.16 0.24 rg BT /F1 10 Tf 40 572 Td (DALIZI FILES / PROJECT NOTES) Tj ET\nBT /F1 29 Tf 40 495 Td (${page === 1 ? 'A workspace for your ideas.' : 'Keep everything in view.'}) Tj ET\n0.42 0.47 0.55 rg BT /F1 12 Tf 40 462 Td (Files. Documents. Terminals. All in one place.) Tj ET\n0.9 0.93 0.99 rg 40 235 460 180 re f\n0.31 0.41 0.85 rg 69 267 85 92 re f\n0.51 0.61 0.91 rg 177 267 85 121 re f\n0.65 0.73 0.94 rg 285 267 85 69 re f\n0.75 0.8 0.96 rg 393 267 76 108 re f\n0.12 0.16 0.24 rg BT /F1 16 Tf 40 188 Td (Project overview) Tj ET\n0.42 0.47 0.55 rg BT /F1 11 Tf 40 159 Td (Review the documents. Organize your delivery.) Tj ET\nBT /F1 11 Tf 40 136 Td (This document is generated entirely with code.) Tj ET\n0.75 0.79 0.85 RG 40 83 m 500 83 l S\nBT /F1 10 Tf 40 57 Td (DEMONSTRATION DOCUMENT) Tj ET\nBT /F1 10 Tf 480 57 Td (0${page}) Tj ET\n`;
  const a = content(1), b = content(2), objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 540 620] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>', `<< /Length ${a.length} >>\nstream\n${a}endstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 540 620] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>', `<< /Length ${b.length} >>\nstream\n${b}endstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let data = '%PDF-1.7\n'; const offsets = [0]; objects.forEach((object, i) => { offsets.push(data.length); data += `${i + 1} 0 obj\n${object}\nendobj\n`; }); const xref = data.length;
  data += `xref\n0 8\n0000000000 65535 f \n${offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(data).toString('base64');
}

(async () => {
  const h = await createHarness(), {page,capture,close,root} = h;
  const out = path.join(root, 'promo-film/dist/actual-ui'); fs.mkdirSync(out, {recursive:true});
  const manifest = {source:'ui/index.html and unchanged production CSS/JavaScript',backend:'deterministic demo-only Tauri IPC fixture',width:1600,height:740,frames:[]};
  const row = name => page.locator('.row').filter({has:page.locator(`.nm[title="${name}"]`)});
  async function shot(name,description,selectors={}) {
    await page.waitForTimeout(150);
    const targets={};
    for (const [key,selector] of Object.entries(selectors)) { const b=await page.locator(selector).first().boundingBox(); if(b)targets[key]={...b,cx:b.x+b.width/2,cy:b.y+b.height/2}; }
    await capture(name); manifest.frames.push({name,file:`actual-ui/${name}.png`,description,targets}); console.log('Captured',name);
  }
  try {
    await page.addInitScript(({pdf}) => {
      const base=window.__TAURI__.core.invoke;
      localStorage.setItem('df.lastPath',JSON.stringify('D:\\设计项目'));
      localStorage.setItem('df.aiPanelOpen','false');
      const entry=(name,size=4096,isDir=false)=>({name,size,isDir,ext:isDir?'':name.split('.').at(-1),mtime:1793664000000,ctime:1793577600000,atime:1793664000000,hidden:false,dirSize:isDir?5242880:undefined});
      window.demoLocalEntries=[entry('设计素材',0,true),entry('项目文档',0,true),entry('交付归档',0,true),entry('产品说明.pdf',2516582),entry('设计规范.pdf',1887437),entry('需求清单.xlsx',190464),entry('项目计划.docx',124928),entry('素材索引.csv',38912),entry('README.md',4096),entry('CHANGELOG.md',8192),entry('release-notes.md',6144)];
      window.demoTargetEntries=[entry('历史交付',0,true)];
      const folders={'D:\\设计项目':window.demoLocalEntries,'D:\\交付资料':window.demoTargetEntries,'D:\\项目文档':window.demoLocalEntries.filter(e=>!e.isDir)};
      window.__TAURI__.core.invoke=async(cmd,args={})=>{
        if(cmd==='roots')return {home:'D:\\设计项目',quick:[{key:'documents',path:'D:\\设计项目'},{key:'downloads',path:'D:\\交付资料'}],drives:[{path:'D:\\',label:'工作资料',dtype:'fixed',free:260000000000,total:512000000000}]};
        if(cmd==='list_dir')return structuredClone(folders[args.path]||window.demoLocalEntries);
        if(cmd==='search_status')return {indexed:42,indexing:false,cacheRestored:true};
        if(cmd==='search_files'){const matches=window.demoLocalEntries.filter(e=>e.ext==='pdf');return {indexed:42,indexing:false,cacheRestored:true,total:matches.length,truncated:false,items:matches.map(e=>({...e,path:'D:\\设计项目\\'+e.name}))};}
        if(cmd==='external_drop_transfer'){
          args.sources.forEach(source=>{const item=window.demoLocalEntries.find(e=>source.endsWith('\\'+e.name));if(item&&!window.demoTargetEntries.some(e=>e.name===item.name))window.demoTargetEntries.push(structuredClone(item));});
          return {completed:true,processed:args.sources.length,skipped:0};
        }
        if(cmd==='preview_file'){
          if(args.path.endsWith('.pdf'))return {kind:'pdf',content:pdf,truncated:false};
          if(args.path.endsWith('.docx'))return {kind:'document',content:'项目交付计划\n\n一、项目目标\n把分散的资料整理为清晰、可查找的交付内容。\n\n二、工作安排\n1. 核对产品说明与设计规范。\n2. 整理项目文档与设计素材。\n3. 更新需求清单，准备最终交付。\n\n三、协作方式\n在同一工作区浏览文件、预览文档，并使用当前目录继续工作。\n\n备注：本文件为宣传片演示数据。',truncated:false};
          if(args.path.endsWith('.xlsx')||args.path.endsWith('.csv'))return {kind:'spreadsheet',content:JSON.stringify({sheets:[{name:'交付清单',rows:[['交付项目','负责人','状态','版本'],['产品说明','产品组','已完成','v0.5.1'],['设计规范','设计组','已确认','v1.2'],['项目计划','项目组','已完成','v1.0'],['需求清单','产品组','已更新','v2.0'],['素材归档','设计组','进行中','v1.0'],['发布说明','开发组','待复核','v0.5.1']]},{name:'素材索引',rows:[['资源名称','分类','位置'],['界面设计','设计素材','设计素材/界面'],['产品说明','项目文档','项目文档/说明'],['交付清单','交付归档','交付归档/清单']]}],truncated:false}),truncated:false};
          return {kind:'text',content:'# 设计项目\n\n## 目录说明\n- 设计素材：视觉资源与界面设计\n- 项目文档：产品说明与规范\n- 交付归档：已经确认的交付内容\n\n演示数据 · Dalizi Files',truncated:false};
        }
        return base(cmd,args);
      };
    },{pdf:demoPdf()});
    await page.reload(); await page.locator('.row').first().waitFor();
    await page.evaluate(()=>navigate('D:\\设计项目')); await page.waitForFunction(()=>state.path==='D:\\设计项目'&&!state.loading);
    if(await page.locator('[data-ai-action="close"]').isVisible())await page.locator('[data-ai-action="close"]').click();
    if(await page.locator('#previewPanel').isVisible())await page.locator('#btnPreview').click();
    await page.evaluate(async()=>{await newTab('D:\\交付资料');await newTab('D:\\项目文档');switchTab(0);}); await page.waitForFunction(()=>state.path==='D:\\设计项目'&&!state.loading);
    await shot('local-workspace','真实文件工作区：三个目录标签与原始列表列宽',{tabs:'#tabbar',files:'#content',terminalButton:'#btnTerminal',previewButton:'#btnPreview',dualButton:'#btnDualPane',search:'#searchWrap'});
    await row('产品说明.pdf').click();
    await shot('local-selected','选中产品说明，保留真实行选中样式',{selected:'.row.sel',files:'#content',terminalButton:'#btnTerminal'});
    await page.locator('#btnTerminal').click(); await page.locator('#termHost .xterm').waitFor();
    await page.evaluate(()=>new Promise(resolve=>curTab().term.write('Windows PowerShell\r\n\r\nPS D:\\设计项目> Get-ChildItem\r\n\r\n    Directory: D:\\设计项目\r\n\r\nMode      LastWriteTime        Length Name\r\n----      -------------        ------ ----\r\nd-----    2026/11/3 09:20              设计素材\r\nd-----    2026/11/3 09:20              项目文档\r\n-a----    2026/11/3 09:20      2516582 产品说明.pdf\r\n-a----    2026/11/3 09:20       190464 需求清单.xlsx\r\n-a----    2026/11/3 09:20         4096 README.md\r\n\r\nPS D:\\设计项目> ',resolve)));
    await shot('local-terminal','真实 PowerShell 标签与 xterm.js 渲染',{tabs:'#tabbar',terminal:'#termHost',activeTab:'.tab.on'});
    await page.evaluate(()=>switchTab(0));await page.waitForFunction(()=>!state.loading&&state.path==='D:\\设计项目');
    await page.locator('#btnDualPane').click();await page.waitForFunction(()=>companionFor()?.open&&!companionFor().loading);
    await page.locator('#companionPane [data-path]').fill('D:\\交付资料');await page.locator('#companionPane form').evaluate(f=>f.requestSubmit());await page.waitForFunction(()=>companionFor()?.path==='D:\\交付资料'&&!companionFor().loading);
    await page.evaluate(()=>{state.selection.clear();applySelectionDom();renderBar2();syncDualPane()});
    await shot('local-dual','同一窗口中的真实左右目录面板',{left:'#content',right:'#companionPane',copy:'#companionPane [data-to-right]'});
    await row('产品说明.pdf').click();await row('需求清单.xlsx').click({modifiers:['Control']});await row('README.md').click({modifiers:['Control']});
    await shot('local-dual-selected','真实三文件多选和跨面板传输按钮',{left:'#content',right:'#companionPane',copy:'#companionPane [data-to-right]'});
    await page.locator('#companionPane [data-to-right]').click();await page.locator('#externalDropDialog').waitFor();
    await shot('local-copy-dialog','原始跨面板文件操作确认对话框',{dialog:'#externalDropDialog',copy:'[data-drop-kind="copy"]',move:'[data-drop-kind="move"]'});
    await page.locator('[data-drop-kind="copy"]').click();await page.waitForFunction(()=>!document.querySelector('#externalDropDialog')&&companionFor()?.entries.length===4&&!companionFor().loading);
    await shot('local-copy-complete','后端模拟复制结果，经真实列表渲染更新目标目录',{left:'#content',right:'#companionPane'});
    await page.locator('#companionPane [data-close]').click();
    await page.locator('#searchMode').selectOption('tree');await page.locator('#search').fill('*.pdf !草稿');await page.locator('[data-quick-result]').first().waitFor();
    await shot('local-search','真实统一搜索框、范围选择与结果浮层',{search:'#searchWrap',results:'#quickSearchPopover',firstResult:'[data-quick-result="0"]',reveal:'[data-quick-result="0"] [data-quick-action="reveal"]'});
    await page.keyboard.press('Escape');await page.locator('#searchMode').selectOption('local');await page.locator('#search').fill('');
    if(!await page.locator('#previewPanel').isVisible())await page.locator('#btnPreview').click();
    await row('产品说明.pdf').click();await page.locator('canvas[data-page="1"]').waitFor({timeout:20000});
    await shot('local-pdf','真实 PDF.js 预览与翻页/缩放控件，文档由代码生成',{files:'#content',preview:'#previewPanel',next:'[data-pdf-next]',wide:'.document-wide'});
    await page.locator('[data-pdf-next]').click();await page.locator('canvas[data-page="2"]').waitFor();
    await shot('local-pdf-page2','真实 PDF 翻到第二页',{preview:'#previewPanel',previous:'[data-pdf-prev]'});
    await row('项目计划.docx').click();await page.locator('.document-body').waitFor();
    await shot('local-word','真实 Word 正文预览',{preview:'#previewPanel',files:'#content'});
    await row('需求清单.xlsx').click();await page.locator('.sheet-grid').waitFor();
    await shot('local-sheet','真实 Excel 工作表值预览',{preview:'#previewPanel',sheet:'[data-sheet-select]',table:'.sheet-grid'});
    await page.locator('[data-sheet-select]').selectOption('1');
    await shot('local-sheet-index','真实工作表切换至素材索引',{preview:'#previewPanel',sheet:'[data-sheet-select]',table:'.sheet-grid'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(h.errors,[]);
    const schedule=[['local-workspace',1,0,'tabs'],['local-selected',1,3,'terminalButton'],['local-terminal',1,5.5,'terminal'],['local-workspace',1,9.5,'tabs'],['local-dual',2,0,'copy'],['local-dual-selected',2,2.4,'copy'],['local-copy-dialog',2,5.2,'copy'],['local-copy-complete',2,8.5,'right'],['local-search',3,0,'firstResult'],['local-pdf',3,3,'next'],['local-pdf-page2',3,4.8,'preview'],['local-word',3,6.2,'preview'],['local-sheet',3,8.1,'sheet'],['local-sheet-index',3,10.2,'sheet']];
    manifest.shots=schedule.map(([name,chapter,at,target])=>{const frame=manifest.frames.find(f=>f.name===name),box=frame.targets[target];return {file:name+'.png',chapter,at,caption:frame.description,...(box?{cursor:{x:box.cx,y:box.cy}}:{}),targets:frame.targets};});
    fs.writeFileSync(path.join(out,'local-manifest.json'),JSON.stringify(manifest,null,2));console.log('Saved',manifest.frames.length,'authentic UI frames.');
  } finally {await close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
