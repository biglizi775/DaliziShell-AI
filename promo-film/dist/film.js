import {kit, W,H,clamp,lerp,ease,smooth,alpha,roundRect,text,line,icon,shadow} from './kit.js';
import {drawActual} from './scenes-actual.js';
export const DURATION=96;
export const chapters=[['序章','从纷杂，到有序'],['同一窗口','把工作带到一起'],['双面板','流动，自有章法'],['搜索与预览','找到，然后读懂'],['远程工作区','距离，不再是间隔'],['AI 协作','围绕你的目录思考'],['技能与记忆','让每次开始，都有来处'],['尾声','让工作回到一个地方']].map(([name,description],i)=>({name,description,start:i*12}));
const colors=['#d3ad54','#73968d','#8e9dba','#b59479','#8ca182'];
let backdrop;
function background(c,t){if(!backdrop){backdrop=document.createElement('canvas');backdrop.width=W;backdrop.height=H;const b=backdrop.getContext('2d');b.fillStyle='#f3f0e8';b.fillRect(0,0,W,H);const g=b.createRadialGradient(1350,330,30,1350,330,1200);g.addColorStop(0,'#ffffff');g.addColorStop(1,'#f3f0e800');b.fillStyle=g;b.fillRect(0,0,W,H)}c.drawImage(backdrop,0,0);for(let i=0;i<58;i++){const x=(i*173.91+Math.sin(t*.15+i)*16)%W,y=(i*257.19)%H;c.fillStyle='#a6a18b18';c.fillRect(x,y,2,2)}}
function brand(c,x,y,size=64){roundRect(c,x,y,size,size,size*.25,'#171b1a');text(c,'d',x+size*.18,y+size*.77,size*.76,'#f3f0e8',600);c.beginPath();c.arc(x+size*.76,y+size*.7,size*.055,0,Math.PI*2);c.fillStyle='#d5ad52';c.fill()}
function intro(c,t){
 const gather=smooth(3.0,7.4,t),birth=smooth(6.8,9.4,t);
 alpha(c,1-smooth(6.6,8.5,t),()=>{text(c,'文件散落。窗口切换。思路被打断。',960,205,34,'#697168',400,'center')});
 const kinds=['folder','file','terminal','globe','sheet','pdf','spark'];
 for(let i=0;i<15;i++){const angle=i*2.39996;const radius=340+(i%3)*120;const x0=960+Math.cos(angle)*radius*1.45,y0=590+Math.sin(angle)*radius*.68;const x=lerp(x0,960,gather),y=lerp(y0,550,gather);const size=lerp(90,45,gather);alpha(c,(1-birth)*smooth(i*.06,i*.06+1.2,t),()=>{c.save();c.translate(x,y);c.rotate(lerp(Math.sin(i)*.16,0,gather));shadow(c,()=>roundRect(c,-size*.75,-size*.53,size*1.5,size*1.06,12,'#fff','#deded3'),20,'#171b1a10',9);icon(c,kinds[i%7],-16,-20,32,colors[i%5]);text(c,['项目','notes.md','PowerShell','网页','数据','报告.pdf','Agent'][i%7],0,36,13,'#777e70',400,'center');c.restore()})}
 alpha(c,smooth(3.8,5.5,t)*(1-birth),()=>{for(let i=0;i<3;i++){c.beginPath();c.ellipse(960,550,260*(1-gather)+100+i*36,80*(1-gather)+60+i*20,-.2,0,Math.PI*2);c.strokeStyle=`rgba(174,148,86,${.3-i*.07})`;c.lineWidth=1;c.stroke()}});
 alpha(c,birth,()=>{c.save();c.translate(0,30*(1-birth));brand(c,910,338,100);text(c,'呆梨文件',960,564,100,'#171b1a',650,'center');text(c,'D A L I Z I   F I L E S',960,620,21,'#8c7952',500,'center');text(c,'让工作回到一个地方。',960,714,38,'#596457',400,'center');text(c,'文件资源管理器  ×  智能体工作台',960,774,21,'#8c9485',400,'center');c.restore()});
 alpha(c,(1-birth)*smooth(.5,2,t),()=>{text(c,'如果，它们都在同一个地方？',960,932,27,'#7a806f',400,'center')});
}
function outro(c,t){const phase=smooth(.2,3,t);const types=['folder','terminal','globe','search','spark','split'];const names=['文件','终端','网页','预览','AI','双面板'];
 for(let i=0;i<6;i++){const a=i*Math.PI/3-.8+t*.035,rx=lerp(670,340,phase),ry=lerp(310,150,phase);let x=960+Math.cos(a)*rx,y=490+Math.sin(a)*ry;alpha(c,(1-smooth(4,6,t))*.75,()=>{line(c,960,490,x,y,'#ccd0c4');shadow(c,()=>roundRect(c,x-45,y-45,90,90,24,'#fff'),20,'#00000008',5);icon(c,types[i],x-17,y-22,34,colors[i%5]);text(c,names[i],x,y+31,14,'#828c7a',400,'center')})}
 const reveal=smooth(2.0,5,t);alpha(c,reveal,()=>{brand(c,916,273,88);text(c,'少一点切换。',960,477,66,'#171b1a',600,'center');text(c,'多一点心流。',960,570,82,'#171b1a',650,'center');line(c,845,611,1075,611,'#d5ad52',3);text(c,'呆梨文件  /  Dalizi Files',960,686,33,'#576250',500,'center');text(c,'你的文件，自在有序。',960,738,23,'#87907d',400,'center');alpha(c,smooth(5.3,6.5,t),()=>{roundRect(c,722,794,476,56,28,'#171b1a');text(c,'WINDOWS 10 / 11    ·    v0.5.1',960,830,18,'#f1eadb',500,'center');text(c,'github.com/biglizi775/DaliziShell-AI',960,902,18,'#737d68',400,'center')})});
}
function scene(c,index,t){background(c,t);c.save();const local=t-index*12;const enter=smooth(0,.9,local);c.translate(0,(1-enter)*22);if(index===0)intro(c,t);else if(index<7)drawActual(c,t,kit);else outro(c,local);c.restore()}
export function renderFrame(c,time,{overlay=true}={}){
 const t=clamp(time,0,DURATION-.001),idx=Math.min(7,Math.floor(t/12));c.save();c.setTransform(c.canvas.width/W,0,0,c.canvas.height/H,0,0);c.globalAlpha=1;c.shadowBlur=0;scene(c,idx,t);
 // A directional shutter masks scene cuts while an illuminated edge sweeps the canvas.
 if(idx>0&&t-idx*12<.65){const p=(t-idx*12)/.65,w=W*(1-ease(p));c.fillStyle='#171b1a';c.fillRect(W-w,0,w,H);c.fillStyle='#d5ad52';c.fillRect(W-w-3,0,3,H)}
 if(overlay){text(c,'DALIZI / STUDIO EDITION',112,70,14,'#8e9586',600);text(c,'01:36   /   ALL CODE',1808,70,14,'#8e9586',500,'right');line(c,112,92,1808,92,'#d7dacd');text(c,String(idx+1).padStart(2,'0')+' / 08',112,1015,16,'#86907d',500);text(c,chapters[idx].name,220,1015,16,'#6c7863',500);text(c,'Studio 主题 · 真实应用界面 / 示例数据',1808,1015,14,'#8e9586',400,'right');for(let i=0;i<8;i++){roundRect(c,112+i*214,1040,198,2,1,'#d9dccf');roundRect(c,112+i*214,1040,198*clamp((t-i*12)/12),2,1,'#d5ad52')}}
 c.restore();
}
