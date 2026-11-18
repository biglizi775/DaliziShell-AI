import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';import {spawn,execFileSync} from 'node:child_process';import {once} from 'node:events';import {serve} from './serve.mjs';
const require=createRequire(import.meta.url),{chromium}=require('playwright'),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'output');fs.mkdirSync(out,{recursive:true});
const fps=Number(process.env.FPS||60),width=Number(process.env.WIDTH||1920),height=Math.round(width*9/16),duration=96;
if(![24,25,30,50,60].includes(fps)||width%2||height%2)throw new Error('Use a supported FPS and even dimensions');
const ffmpeg=process.env.FFMPEG||execFileSync('python',['-c','import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'],{encoding:'utf8'}).trim();
const server=await serve(),browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server','--autoplay-policy=no-user-gesture-required']}),page=await browser.newPage({viewport:{width:1920,height:1200}});
let encoder;const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>!!window.__film);await page.evaluate(async({width,height})=>{await document.fonts.ready;const c=document.querySelector('canvas');c.width=width;c.height=height},{width,height});
 console.log('Synthesizing procedural stereo score…');
 const audio=await page.evaluate(async()=>{const {createScore,encodeWav}=await import('./audio.js');const blob=encodeWav(await createScore());return await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(blob)})});
 const wav=path.join(out,'dalizi-original-score.wav');fs.writeFileSync(wav,Buffer.from(audio,'base64'));
 const output=path.join(out,`dalizi-files-real-ui-${height}p${fps}.mp4`);
 encoder=spawn(ffmpeg,['-hide_banner','-loglevel','warning','-y','-f','image2pipe','-vcodec','mjpeg','-framerate',String(fps),'-i','pipe:0','-i',wav,'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','medium','-crf','17','-pix_fmt','yuv420p','-c:a','aac','-b:a','256k','-ar','48000','-t',String(duration),'-movflags','+faststart','-metadata','title=Dalizi Files - A little more flow',output],{stdio:['pipe','ignore','pipe']});
 let stderr='';encoder.stderr.on('data',b=>stderr+=b.toString());encoder.stdin.on('error',()=>{});const done=new Promise((resolve,reject)=>{encoder.on('error',reject);encoder.on('exit',code=>code===0?resolve():reject(new Error('FFmpeg '+code+': '+stderr)))});done.catch(()=>{});
 const total=fps*duration,start=Date.now();
 for(let i=0;i<total;i+=8){const frames=await page.evaluate(({start,count,fps})=>Array.from({length:count},(_,j)=>window.__film.renderData((start+j)/fps,'image/jpeg',.97)),{start:i,count:Math.min(8,total-i),fps});for(const frame of frames){if(encoder.exitCode!==null)throw new Error(stderr);if(!encoder.stdin.write(Buffer.from(frame,'base64')))await once(encoder.stdin,'drain')}if(i%(fps*4)===0)console.log(`Frames ${i}/${total} · ${Math.round(i/total*100)}% · ${Math.round((Date.now()-start)/1000)}s`)}encoder.stdin.end();await done;if(errors.length)throw new Error(errors.join('\n'));
 const metadata={width,height,fps,duration,frames:total,video:output,score:wav,source:'Original project HTML/CSS/JS rendered with demo data + Canvas 2D + procedural PCM',bytes:fs.statSync(output).size};fs.writeFileSync(path.join(out,'render-report.json'),JSON.stringify(metadata,null,2));console.log(JSON.stringify(metadata));
}finally{if(encoder&&encoder.exitCode===null)encoder.kill();await browser.close();await new Promise(r=>server.close(r))}

