export const W=1920,H=1080;
export const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
export const lerp=(a,b,t)=>a+(b-a)*t;
export const ease=t=>{t=clamp(t);return t*t*t*(t*(t*6-15)+10)};
export const smooth=(a,b,t)=>ease((t-a)/(b-a));
export function alpha(c,a,fn){c.save();c.globalAlpha*=clamp(a);fn();c.restore()}
export function roundRect(c,x,y,w,h,r=12,fill,stroke,lw=1){c.beginPath();c.roundRect(x,y,w,h,Math.min(r,w/2,h/2));if(fill){c.fillStyle=fill;c.fill()}if(stroke){c.strokeStyle=stroke;c.lineWidth=lw;c.stroke()}}
export function text(c,str,x,y,size=24,color='#171b1a',weight=400,align='left'){c.fillStyle=color;c.font=`${weight} ${size}px "Segoe UI", "Microsoft YaHei UI", "Noto Sans CJK SC", sans-serif`;c.textAlign=align;c.textBaseline='alphabetic';c.fillText(String(str),x,y)}
export function line(c,x1,y1,x2,y2,color='#d5d4cc',width=1){c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=width;c.stroke()}
export function shadow(c,fn,blur=40,color='rgba(0,0,0,.12)',offsetY=16){c.save();c.shadowBlur=blur;c.shadowColor=color;c.shadowOffsetY=offsetY;fn();c.restore()}
export function icon(c,type,x,y,s=26,color='#747b72'){
 c.save();c.translate(x,y);c.scale(s/24,s/24);c.strokeStyle=color;c.fillStyle=color;c.lineWidth=1.5;c.lineCap='round';c.lineJoin='round';c.beginPath();
 if(type==='folder'){c.moveTo(2,7);c.lineTo(2,4);c.lineTo(9,4);c.lineTo(12,7);c.lineTo(22,7);c.lineTo(22,20);c.lineTo(2,20);c.closePath();c.globalAlpha*=.14;c.fill();c.globalAlpha/=.14;c.stroke()}
 else if(type==='search'){c.arc(10,10,6,0,Math.PI*2);c.moveTo(15,15);c.lineTo(21,21);c.stroke()}
 else if(type==='terminal'||type==='code'){c.moveTo(4,6);c.lineTo(10,12);c.lineTo(4,18);c.moveTo(13,18);c.lineTo(21,18);c.stroke()}
 else if(type==='spark'){c.moveTo(12,1);c.quadraticCurveTo(13,11,23,12);c.quadraticCurveTo(13,13,12,23);c.quadraticCurveTo(11,13,1,12);c.quadraticCurveTo(11,11,12,1);c.fill()}
 else if(type==='check'){c.moveTo(4,12);c.lineTo(10,18);c.lineTo(21,5);c.stroke()}
 else if(type==='arrow'){c.moveTo(3,12);c.lineTo(21,12);c.moveTo(15,6);c.lineTo(21,12);c.lineTo(15,18);c.stroke()}
 else if(type==='globe'){c.arc(12,12,10,0,Math.PI*2);c.moveTo(2,12);c.lineTo(22,12);c.moveTo(12,2);c.bezierCurveTo(3,9,3,15,12,22);c.bezierCurveTo(21,15,21,9,12,2);c.stroke()}
 else if(type==='split'||type==='grid'){roundRect(c,2,3,20,18,2,null,color,1.5);line(c,12,3,12,21,color,1.5);if(type==='grid')line(c,2,12,22,12,color,1.5)}
 else {c.moveTo(5,2);c.lineTo(14,2);c.lineTo(20,8);c.lineTo(20,22);c.lineTo(5,22);c.closePath();c.stroke();c.beginPath();c.moveTo(14,2);c.lineTo(14,8);c.lineTo(20,8);c.stroke();if(type==='image'){c.beginPath();c.moveTo(7,18);c.lineTo(11,13);c.lineTo(14,16);c.lineTo(17,12);c.stroke()}else {line(c,8,13,16,13,color);line(c,8,17,16,17,color)}}c.restore();
}
export function cursor(c,x,y,click=0){c.save();c.translate(x,y);if(click>0){c.beginPath();c.arc(3,3,12+click*28,0,Math.PI*2);c.strokeStyle=`rgba(191,145,53,${1-click})`;c.lineWidth=3;c.stroke()}c.beginPath();c.moveTo(0,0);c.lineTo(2,31);c.lineTo(10,23);c.lineTo(18,36);c.lineTo(24,32);c.lineTo(16,20);c.lineTo(28,18);c.closePath();c.shadowColor='#0003';c.shadowBlur=8;c.fillStyle='#171b1a';c.fill();c.strokeStyle='#fff';c.lineWidth=2;c.stroke();c.restore()}
export function tag(c,label,x,y,{color='#5a655a',bg='#e7ebe2',size=18}={}){c.save();c.font=`500 ${size}px "Segoe UI","Microsoft YaHei UI",sans-serif`;const w=c.measureText(label).width+28;roundRect(c,x,y-25,w,37,18,bg);text(c,label,x+14,y,size,color,500);c.restore();return w}
export function title(c,kicker,heading,subheading,p=1){alpha(c,p,()=>{c.save();c.translate(0,(1-ease(p))*25);text(c,kicker,116,161,17,'#8e7645',600);text(c,heading,112,230,54,'#171b1a',600);text(c,subheading,116,274,23,'#69716a');c.restore()})}
export function panel(c,x,y,w,h,{title:heading='呆梨文件',tabs=['项目文件','PowerShell','SSH'],active=0,sidebar=false,path='D:  /  Projects  /  Dalizi'}={}){
 shadow(c,()=>roundRect(c,x,y,w,h,18,'#fff','#d8dbd3'));
 roundRect(c,x+1,y+1,w-2,43,17,'#f8f9f6');text(c,'d·',x+22,y+30,25,'#5068d9',700);text(c,heading,x+66,y+29,17,'#525d55',500);text(c,'−    □    ×',x+w-110,y+29,17,'#858e85');
 const tw=Math.min(230,(w-140)/tabs.length);tabs.forEach((tab,i)=>{const label=typeof tab==='string'?tab:(tab.label||tab.title||tab.name||'工作区');roundRect(c,x+16+i*tw,y+49,tw-6,37,8,i===active?'#fff':'#f1f3ee',i===active?'#d5dcd2':null);text(c,label,x+30+i*tw,y+74,17,i===active?'#242c25':'#92998f',i===active?600:400)});
 line(c,x,y+91,x+w,y+91,'#e3e6de');icon(c,'arrow',x+22,y+105,20,'#879080');roundRect(c,x+62,y+99,w-160,28,6,'#f5f7f2');text(c,path,x+77,y+119,15,'#737e6f');icon(c,'search',x+w-65,y+103,22,'#737e6f');line(c,x,y+135,x+w,y+135,'#e3e6de');
 if(sidebar){roundRect(c,x+1,y+136,190,h-137,0,'#f3f5fa');['快速访问','桌面','下载','文档','此电脑','SSH 连接'].forEach((s,i)=>{icon(c,i===5?'terminal':'folder',x+21,y+164+i*48,22,i===2?'#5068d9':'#8e978d');text(c,s,x+54,y+181+i*48,17,'#64705f')})}
}
export const kit={W,H,clamp,lerp,ease,smooth,alpha,roundRect,text,line,icon,panel,cursor,tag,shadow,title};
