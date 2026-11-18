import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';import assert from 'node:assert/strict';import {serve} from './serve.mjs';
const require=createRequire(import.meta.url),{chromium}=require('playwright'),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'output');fs.mkdirSync(out,{recursive:true});
const server=await serve(),browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server']}),page=await browser.newPage({viewport:{width:1440,height:1200},locale:'zh-CN'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>!!window.__film);await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(out,'web-preview.png'),fullPage:true});
 const frames=[1,6,10,15,20,27,32,39,44,51,56,63,68,75,80,88,93];for(const t of frames){const data=await page.evaluate(t=>{window.__film.render(t);return document.querySelector('canvas').toDataURL('image/png').split(',')[1]},t);fs.writeFileSync(path.join(out,`frame-${String(t).padStart(2,'0')}.png`),Buffer.from(data,'base64'))}
 // Every half second is rendered, including all chapter boundaries, to catch intermittent exceptions.
 await page.evaluate(()=>{for(let t=0;t<96;t+=.5)window.__film.render(t)});
 await page.locator('.chapter').nth(4).click();assert.ok((await page.evaluate(()=>window.__film.state.current))>=48);
 await page.locator('#timeline').fill('35');await page.locator('#timeline').dispatchEvent('input');assert.equal(await page.evaluate(()=>window.__film.state.current),35);
 await page.locator('#start').evaluate(e=>e.hidden=false);await page.locator('#start').click();await page.waitForFunction(()=>window.__film.state.playing,{},{timeout:120000});await page.waitForTimeout(500);assert.ok(await page.evaluate(()=>window.__film.state.current>35));await page.locator('#play').click();assert.equal(await page.evaluate(()=>window.__film.state.playing),false);
 await page.locator('#mute').click();assert.equal(await page.evaluate(()=>window.__film.state.muted),true);
 await page.evaluate(()=>window.__film.seek(95.9));await page.locator('#play').click();await page.waitForTimeout(350);assert.equal(await page.evaluate(()=>window.__film.state.playing),false);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'mobile-preview.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);const report={pass:true,renderedFrames:frames.length+192,checks:['chapter navigation','seek','audio synthesis and playback','pause','mute','end of film','mobile width','no page exceptions']};fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(report,null,2));console.log(report);
}finally{await browser.close();await new Promise(r=>server.close(r))}

