import {clamp,ease,smooth,lerp,alpha,roundRect,text,line,cursor,shadow} from './kit.js';
const images=new Map();let shots=[];
export async function prepareActualUI(){
 const manifests=await Promise.all(['local-manifest.json','connected-manifest.json'].map(async name=>{const r=await fetch(new URL('./actual-ui/'+name,import.meta.url));if(!r.ok)throw new Error('无法加载界面分镜：'+name);return r.json()}));
 shots=manifests.flatMap(m=>m.shots).sort((a,b)=>a.chapter-b.chapter||a.at-b.at);
 await Promise.all([...new Set(shots.map(s=>s.file))].map(async file=>{const im=new Image();im.src=new URL('./actual-ui/'+file,import.meta.url).href;await im.decode();images.set(file,im)}));
}
const titles={
 1:['01 / ONE WORKSPACE','新的质感，熟悉的工作。','文件、PowerShell 与 Agent，在真实工作空间里协同。'],
 2:['02 / SIDE BY SIDE','左右对照，整理更从容。','独立目录、原生工具栏、多选与复制，保留每一步操作。'],
 3:['03 / FIND AND READ','从找到，到读懂。','在原有搜索框中筛选，打开真正的文档预览面板。'],
 4:['04 / CONNECTED WORKSPACE','远程，也在同一个窗口。','主机概况、交互终端与远程目录，保持软件的实际布局。'],
 5:['05 / CONTEXTUAL ASSISTANT','让 AI 跟着目录思考。','围绕当前目录，提出计划、核对路径、确认执行。'],
 6:['06 / WORK THAT REMEMBERS','工作有方法，项目有记忆。','在原有设置中管理技能、显式保存目录记忆与会话。']
};
function point(s){const p=s.cursor;if(p)return p;const f=s.focus;return f?{x:f.x+f.w/2,y:f.y+f.h/2}:{x:1050,y:300}}
function camera(s,amount){const f=s.focus;if(!f)return {z:1,x:0,y:0};const z=lerp(1,1.22,amount);return {z,x:clamp(800-(f.x+f.w/2)*z,1600-1600*z,0),y:clamp(370-(f.y+f.h/2)*z,740-740*z,0)}}
export function drawActual(c,time){
 const chapter=Math.floor(time/12),t=time%12,seq=shots.filter(s=>s.chapter===chapter);if(!seq.length)return;
 let index=0;for(let i=0;i<seq.length;i++)if(t>=seq[i].at)index=i;
 const shot=seq[index],previous=seq[Math.max(0,index-1)],next=seq[Math.min(seq.length-1,index+1)],transition=smooth(shot.at,shot.at+.36,t);
 const [kicker,heading,sub]=titles[chapter];alpha(c,smooth(.1,.7,t),()=>{text(c,kicker,160,139,15,'#8e7645',600);text(c,heading,156,186,40,'#171b1a',600);text(c,shot.caption||sub,160,218,18,'#69716a')});
 const x=160,y=240,w=1600,h=740;
 shadow(c,()=>roundRect(c,x,y,w,h,10,'white','#dce1ed'),32,'#20283e18',12);
 c.save();c.beginPath();c.roundRect(x,y,w,h,10);c.clip();c.translate(x,y);
 const amount=smooth(1.8,3.4,t)*(1-smooth(10.5,11.9,t)),before=camera(previous,amount),after=camera(shot,amount),p=smooth(shot.at,shot.at+.8,t);
 const cam={z:lerp(before.z,after.z,p),x:lerp(before.x,after.x,p),y:lerp(before.y,after.y,p)};
 c.translate(cam.x,cam.y);c.scale(cam.z,cam.z);
 c.drawImage(images.get(shot.file),0,0,1600,740);
 if(index>0&&transition<1)alpha(c,1-transition,()=>c.drawImage(images.get(previous.file),0,0,1600,740));
 const a=point(shot),b=point(next),travel=next!==shot?smooth(next.at-.65,next.at-.02,t):0;
 const cx=lerp(a.x,b.x,travel),cy=lerp(a.y,b.y,travel);const click=(t-shot.at)/.55;
 alpha(c,smooth(.65,1.1,t),()=>cursor(c,cx,cy,click>0&&click<1?click:0));
 c.restore();
 // Editorial captions live outside the application surface; the UI itself is untouched.
 
}
