const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const {createHarness}=require('./authentic-harness.cjs');
(async()=>{const h=await createHarness(),{page,root}=h,out=path.join(root,'promo-film/output');const results=[];
try{
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.visualStyle),'studio');
 const selected=page.locator('.row').filter({hasText:'Project-notes-1.md'}).first();await selected.click();
 const keep=await page.evaluate(()=>({selection:[...state.selection],tabs:state.tabs.map(t=>t.key),path:state.path}));
 for(const [style,theme] of [['studio','light'],['studio','dark'],['classic','light'],['classic','dark']]){
  await page.locator('#btnSettings').click();await page.locator('#workspaceVisualStyle').selectOption(style);await page.locator('#workspaceTheme').selectOption(theme);await page.locator('#workspaceSettings [data-settings-close]').first().click();
  assert.deepEqual(await page.evaluate(()=>({selection:[...state.selection],tabs:state.tabs.map(t=>t.key),path:state.path})),keep,'appearance must preserve current work');
  const color=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  assert.equal(await page.locator('.row').first().evaluate(e=>Math.round(e.getBoundingClientRect().height)),44);
  await page.screenshot({path:path.join(out,`studio-qa-${style}-${theme}.png`)});results.push({style,theme,color});
 }
 await page.reload();await page.locator('.row').first().waitFor();assert.equal(await page.evaluate(()=>document.documentElement.dataset.visualStyle),'classic');assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');
 await page.locator('#btnSettings').click();await page.locator('#workspaceVisualStyle').selectOption('studio');await page.locator('#workspaceSettings [data-settings-close]').first().click();
 for(const size of [{width:1280,height:800},{width:960,height:560}]){
  await page.setViewportSize(size);await page.waitForTimeout(200);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const send=await page.locator('[data-ai-action="send"]').boundingBox();if(send)assert.ok(send.y>=0&&send.y+send.height<=size.height,'send button must remain in viewport');
  await page.screenshot({path:path.join(out,`studio-qa-${size.width}.png`)});
 }
 assert.deepEqual(h.errors,[]);fs.writeFileSync(path.join(out,'studio-verification.json'),JSON.stringify({pass:true,results,preserves:['selection','tabs','folder','44px row height','style and theme across reload'],sizes:['1600x740','1280x800','960x560']},null,2));console.log('Studio UI verification passed.',results);
}finally{await h.close()}})().catch(e=>{console.error(e);process.exitCode=1});
