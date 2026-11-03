const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async (page, { folder = 'C:\\Projects', output, native = false, resize } = {}) => {
  await page.waitForFunction(() => workspaceSessionReady && !state.loading);
  await page.evaluate(async ({ folder, native }) => {
    closeAiAssistant();
    state.tabs = Array.from({length:60}, (_, i) => ({ path: native ? folder : `${folder}\\文件夹_${String(i).padStart(2,'0')}`, history:[], hIdx:-1 }));
    state.tab = 59; await navigate(curTab().path, {push:false});
  }, {folder, native});
  const visibleActive = () => page.waitForFunction(() => {
    const v=$('tabViewport'), r=v.getBoundingClientRect(), t=v.querySelector('.tab.on')?.getBoundingClientRect();
    return t && t.left >= r.left-1 && t.right <= r.right+1;
  });
  await visibleActive();
  assert.ok(await page.locator('#tabViewport').evaluate(v => v.scrollLeft > 0 && v.scrollWidth > v.clientWidth));
  const original = await page.locator('#tabViewport').evaluate(v=>v.scrollLeft);
  const box=await page.locator('#tabViewport').boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+18); await page.mouse.wheel(0,-550);
  await page.waitForFunction(before=>$('tabViewport').scrollLeft < before-100,original);
  const manual=await page.locator('#tabViewport').evaluate(v=>v.scrollLeft);
  await page.evaluate(()=>{renderTabs();renderTabs();});
  await page.waitForTimeout(50); assert.equal(await page.locator('#tabViewport').evaluate(v=>v.scrollLeft),manual,'refresh preserves manual browsing');
  await page.mouse.wheel(-250,0); await page.waitForFunction(before=>$('tabViewport').scrollLeft < before-100,manual);
  // The explicit scrollbar stays draggable even when Windows hides native scrollbars.
  await page.locator('#tabViewport').evaluate(v=>{v.scrollLeft=0;syncTabScrollbar();});
  const scroll=await page.locator('#tabScrollTrack').boundingBox(), thumb=await page.locator('#tabScrollThumb').boundingBox();
  assert.ok(scroll.height>=6,'scrollbar has visible height');
  await page.mouse.move(thumb.x+thumb.width/2,thumb.y+thumb.height/2);
  await page.mouse.down(); await page.mouse.move(scroll.x+Math.min(180,scroll.width/2),scroll.y+scroll.height/2,{steps:12}); await page.mouse.up();
  await page.waitForFunction(()=>$('tabViewport').scrollLeft>100);
  assert.equal(await page.evaluate(()=>state.tab),59,'scrolling does not change active folder');
  await page.locator('#tabScrollTrack').focus(); await page.keyboard.press('Home');
  await page.waitForFunction(()=>$('tabViewport').scrollLeft===0);
  await page.keyboard.press('End');
  await page.waitForFunction(()=>Math.abs($('tabViewport').scrollLeft-($('tabViewport').scrollWidth-$('tabViewport').clientWidth))<2);
  assert.equal(await page.evaluate(()=>state.tab),59,'scrollbar keys do not navigate files or switch tabs');
  // Scroll to the beginning, then open a folder from the permanently visible + button.
  await page.locator('#tabViewport').evaluate(v=>{v.scrollLeft=0;});
  await page.locator('#tabNew').click(); await page.waitForFunction(()=>state.tabs.length===61&&!state.loading); await visibleActive();
  await page.evaluate(()=>switchTab(0)); await page.waitForFunction(()=>!state.loading); await visibleActive();
  await page.keyboard.press('Control+Shift+Tab'); await page.waitForFunction(()=>state.tab===60&&!state.loading); await visibleActive();
  // Holding a tab near an edge keeps scrolling even when the pointer stops.
  await page.evaluate(()=>{window.overflowActive=curTab();window.overflowFirst=state.tabs[0];$('tabViewport').scrollLeft=0;});
  const first=await page.locator('#tabViewport .tab').first().boundingBox(), rail=await page.locator('#tabViewport').boundingBox();
  await page.mouse.move(first.x+30,first.y+15);await page.mouse.down();await page.mouse.move(rail.x+rail.width-8,first.y+15,{steps:10});
  const beforeHold=await page.locator('#tabViewport').evaluate(v=>v.scrollLeft);
  await page.waitForFunction(before=>$('tabViewport').scrollLeft>before+100,beforeHold);
  await page.mouse.up();assert.equal(await page.evaluate(()=>curTab()===overflowActive),true);
  assert.ok(await page.evaluate(()=>state.tabs.indexOf(overflowFirst))>0,'edge dragging actually changes tab order');
  await page.waitForFunction(()=>tabDragFrame===null&&!tabDrag);
  if (resize) await resize(960,560); else await page.setViewportSize({width:960,height:560});
  await page.evaluate(()=>{openAiAssistant();applyWorkspaceTheme('dark');});await visibleActive();
  assert.equal(await page.locator('#tabActions').evaluate(n=>{const r=n.getBoundingClientRect(),bar=$('tabbar').getBoundingClientRect();return r.left>=bar.left&&r.right<=bar.right+1;}),true);
  await page.screenshot({path:path.join(output,'tabs-overflow-dark.png'),animations:'disabled'});
  await page.evaluate(async folder=>{closeAiAssistant();state.tabs=[{path:folder,history:[],hIdx:-1}];state.tab=0;await navigate(folder,{push:false});},folder);
  assert.equal(await page.locator('#tabViewport').evaluate(v=>v.scrollLeft),0);
};
