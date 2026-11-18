/* Dalizi Files / connected work. All geometry and demo data are procedural.
 * Source of product claims: docs/USER_GUIDE.md (SSH, AI, skills and memories).
 * Timeline is deterministic: drawing any timestamp never mutates scene state.
 */
const P = { ink:'#171b1a', muted:'#777c73', paper:'#f3f0e8', white:'#fffdf7', line:'#dedfd4', gold:'#d5ad52', green:'#477360', pale:'#e7ede3', dark:'#1c2522' };
const clamp = (v,a=0,b=1) => Math.max(a,Math.min(b,v));
const mix = (a,b,t) => a+(b-a)*t;
const ease = v => { const t=clamp(v); return 1-Math.pow(1-t,3); };
const progress=(t,a,b)=>ease((t-a)/(b-a));
const font = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif';
function rr(c,x,y,w,h,r,fill,stroke,width=1) {
  c.beginPath(); c.roundRect(x,y,w,h,r); if(fill){ c.fillStyle=fill; c.fill(); }
  if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}
}
function txt(c,s,x,y,size=22,color=P.ink,weight=400,align='left') {
  c.font=`${weight} ${size}px ${font}`; c.textBaseline='alphabetic';c.textAlign=align;c.fillStyle=color;c.fillText(s,x,y);
}
function ln(c,x,y,x2,y2,col=P.line,w=1) { c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.strokeStyle=col;c.lineWidth=w;c.stroke(); }
function alpha(c,a,fn) { c.save();c.globalAlpha*=clamp(a);fn();c.restore(); }
function dot(c,x,y,r,col) {c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle=col;c.fill();}
function pill(c,s,x,y,w,fill=P.pale,col=P.green) {rr(c,x,y,w,32,16,fill);txt(c,s,x+w/2,y+22,15,col,600,'center');}
function shadow(c,fn){c.save();c.shadowColor='rgba(23,27,26,.13)';c.shadowBlur=48;c.shadowOffsetY=20;fn();c.restore();}
function badge(c,x,y,s,type='file',accent=P.gold) {
  rr(c,x,y,s,s,Math.max(6,s*.19),accent+'20');c.save();c.translate(x+s*.2,y+s*.2);c.scale(s*.6/32,s*.6/32);
  c.lineWidth=1.8;c.strokeStyle=accent;c.lineJoin='round';c.lineCap='round';
  if(type==='folder'){c.beginPath();c.moveTo(2,8);c.lineTo(11,8);c.lineTo(14,11);c.lineTo(29,11);c.lineTo(29,27);c.lineTo(2,27);c.closePath();c.stroke();}
  else if(type==='spark'){c.beginPath();c.moveTo(16,0);c.quadraticCurveTo(18,14,32,16);c.quadraticCurveTo(18,18,16,32);c.quadraticCurveTo(14,18,0,16);c.quadraticCurveTo(14,14,16,0);c.stroke();}
  else if(type==='terminal'){rr(c,1,5,30,23,3,null,accent,1.8);ln(c,7,12,12,16,accent,1.8);ln(c,12,16,7,20,accent,1.8);ln(c,17,21,25,21,accent,1.8);}
  else {c.beginPath();c.moveTo(6,2);c.lineTo(20,2);c.lineTo(27,9);c.lineTo(27,30);c.lineTo(6,30);c.closePath();c.stroke();ln(c,20,2,20,9,accent,1.8);ln(c,20,9,27,9,accent,1.8);ln(c,11,17,22,17,accent,1.5);ln(c,11,22,22,22,accent,1.5);}
  c.restore();
}
function cursor(c,x,y,click=0) {
  if(click>0&&click<1){c.save();c.globalAlpha*=1-click;c.beginPath();c.arc(x,y,10+40*click,0,Math.PI*2);c.strokeStyle=P.gold;c.lineWidth=3;c.stroke();c.restore();}
  c.save();c.translate(x,y);c.shadowColor='#0004';c.shadowBlur=10;c.shadowOffsetY=3;
  c.beginPath();c.moveTo(0,0);c.lineTo(4,29);c.lineTo(11,22);c.lineTo(17,34);c.lineTo(23,31);c.lineTo(16,19);c.lineTo(27,17);c.closePath();c.fillStyle=P.ink;c.fill();c.strokeStyle=P.white;c.lineWidth=2;c.stroke();c.restore();
}
function rule(c,x,y,w,label) {ln(c,x,y,x+w,y,P.line);txt(c,label,x,y+28,16,P.muted);}
function heading(c,kicker,title,subtitle,t) {
  const p=progress(t,0,.85);alpha(c,p,()=>{c.save();c.translate(0,18*(1-p));txt(c,kicker,120,158,15,P.green,600);txt(c,title,116,224,49,P.ink,600);txt(c,subtitle,120,269,21,P.muted);c.restore();});
}
function shell(c,x,y,w,h,label) {
  shadow(c,()=>rr(c,x,y,w,h,20,P.white));
  rr(c,x,y,w,h,20,null,'#d6d9ce');
  dot(c,x+25,y+25,5,'#d4d3c8');dot(c,x+43,y+25,5,'#d4d3c8');dot(c,x+61,y+25,5,'#d4d3c8');
  txt(c,label,x+86,y+31,16,P.ink,600);txt(c,'DALIZI FILES',x+w-24,y+31,12,P.muted,600,'right');
  ln(c,x,y+50,x+w,y+50);
}
function check(c,x,y,size=12,col=P.green) {c.beginPath();c.moveTo(x-size*.4,y);c.lineTo(x-size*.08,y+size*.3);c.lineTo(x+size*.5,y-size*.4);c.strokeStyle=col;c.lineWidth=2.5;c.lineCap='round';c.stroke();}
function arcGauge(c,x,y,r,value,label,t){c.lineWidth=7;c.strokeStyle='#d8dfd5';c.beginPath();c.arc(x,y,r,-Math.PI*.8,Math.PI*.8);c.stroke();c.strokeStyle=P.green;c.beginPath();c.arc(x,y,r,-Math.PI*.8,-Math.PI*.8+Math.PI*1.6*value*progress(t,.4,1.7));c.stroke();txt(c,Math.round(value*100*progress(t,.4,1.7))+'%',x,y+5,23,P.ink,600,'center');txt(c,label,x,y+r+28,14,P.muted,400,'center');}
function wave(c,x,y,w,h,t,col=P.green,fill=false){
  c.save();c.beginPath();for(let i=0;i<=80;i++){const xx=x+i/80*w;const yy=y+h*.5+Math.sin(i*.26+t)*h*.15+Math.sin(i*.61-t*.7)*h*.16+(Math.sin(i*.12)*.5+.5)*h*.12;i?c.lineTo(xx,yy):c.moveTo(xx,yy);}c.strokeStyle=col;c.lineWidth=2;c.stroke();
  if(fill){c.lineTo(x+w,y+h);c.lineTo(x,y+h);c.closePath();const g=c.createLinearGradient(x,y,x,y+h);g.addColorStop(0,col+'35');g.addColorStop(1,col+'00');c.fillStyle=g;c.fill();}c.restore();
}
function type(c,s,x,y,size,col,t,start,speed=24,weight=400) {const count=Math.max(0,Math.floor((t-start)*speed));txt(c,s.slice(0,count),x,y,size,col,weight);}
function travelling(c,x1,y1,x2,y2,t,col=P.gold){
  const cx=(x1+x2)/2; c.save();c.strokeStyle=col+'55';c.lineWidth=1.4;c.setLineDash([4,7]);c.beginPath();c.moveTo(x1,y1);c.bezierCurveTo(cx,y1,cx,y2,x2,y2);c.stroke();c.setLineDash([]);
  for(let i=0;i<5;i++){const p=(t*.23+i*.2)%1;const q=1-p;const x=q*q*q*x1+3*q*q*p*cx+3*q*p*p*cx+p*p*p*x2;const y=q*q*q*y1+3*q*q*p*y1+3*q*p*p*y2+p*p*p*y2;dot(c,x,y,3.5,col);}c.restore();
}

function ssh(c,t) {
  heading(c,'05 / CONNECTED WORKSPACE','远程，也像在手边。','登录即进入工作区。主机概况、交互终端与远程目录，在同一窗口展开。',t);
  const enter=progress(t,0,1.1);c.save();c.translate(960,600+30*(1-enter));c.scale(.975+.025*enter,.975+.025*enter);c.translate(-960,-600);c.globalAlpha*=enter;
  shell(c,120,323,1680,574,'SSH  ·  studio-server');
  rr(c,120,373,280,524,[0,0,0,20],'#eef0e7');
  badge(c,145,398,42,'terminal',P.green);txt(c,'studio-server',202,419,21,P.ink,600);txt(c,'Ubuntu · 演示数据',146,469,15,P.muted);dot(c,152,496,4,P.green);txt(c,'已连接 / 内置 SSH',166,501,15,P.green);
  arcGauge(c,200,582,39,.28+.018*Math.sin(t), 'CPU',t);arcGauge(c,321,582,39,.46,'内存',t);
  txt(c,'网络活动',146,688,15,P.muted);wave(c,147,709,225,60,t,P.green,true);
  ln(c,145,795,374,795);txt(c,'连接复用 · SFTP',146,825,15,P.ink,500);txt(c,'主机资源 / 终端 / 文件',146,854,14,P.muted);
  // Workspace toolbar and dark terminal; the UI follows the real default layout.
  pill(c,'分屏',424,387,70,P.dark,P.white);pill(c,'文件',503,387,70,'#f1f1ea',P.muted);pill(c,'终端',582,387,70,'#f1f1ea',P.muted);
  txt(c,'Ctrl+C     重新登录     断开',1776,409,15,P.muted,400,'right');
  rr(c,420,435,1360,197,9,P.dark);
  txt(c,'studio@server:~',444,463,14,'#98b3a2',500);dot(c,1755,458,3,P.gold);
  type(c,'$ ls /srv/projects',444,503,20,'#f4f1e6',t,.8,24,500);
  alpha(c,progress(t,1.7,2.1),()=>txt(c,'assets/      releases/      reports/      README.md',444,537,18,'#b9c9bb'));
  type(c,'$ du -sh /srv/projects/reports',444,574,20,'#f4f1e6',t,2.4,28,500);
  alpha(c,progress(t,3.4,3.7),()=>txt(c,'24M   /srv/projects/reports',444,607,18,'#d5ad52'));
  ln(c,420,646,1780,646,'#d8dacf',2);rr(c,1062,641,74,6,3,'#afb7a8');
  txt(c,'远程文件',439,680,18,P.ink,600);rr(c,556,658,732,34,6,'#f1f2eb');txt(c,'/srv/projects/reports',573,682,15,P.muted);
  pill(c,'上传',1310,658,82,'#e9ede1',P.green);pill(c,'下载所选',1404,658,120,t>4?P.gold:'#eceee7',P.ink);txt(c,'刷新',1732,680,15,P.muted);
  txt(c,'名称',477,717,13,P.muted);txt(c,'大小',1360,717,13,P.muted);txt(c,'修改日期',1565,717,13,P.muted);
  const rows=[['项目报告.pdf','2.4 MB','2026/11/03'],['素材清单.csv','86 KB','2026/11/03'],['归档记录.md','4 KB','2026/11/02']];
  rows.forEach((r,i)=>{const yy=730+i*43;const selected=t>3.7&&i<2;rr(c,432,yy,1336,40,5,selected?'#e8eee2':i%2?'#f8f7f0':null);rr(c,445,yy+13,14,14,3,selected?P.green:null,selected?P.green:'#bdc4b7');if(selected)check(c,452,yy+20,8,P.white);badge(c,475,yy+7,26,'file',i===0?'#b07a53':P.green);txt(c,r[0],514,yy+27,17,P.ink);txt(c,r[1],1360,yy+27,15,P.muted);txt(c,r[2],1565,yy+27,15,P.muted);});
  c.restore();
  // Foreground task panel is a film close-up of the central SFTP queue.
  const q=progress(t,5.1,5.8);alpha(c,q,()=>{
    const x=1040,y=705+45*(1-q);shadow(c,()=>rr(c,x,y,685,177,15,P.white));rr(c,x,y,685,177,15,null,'#cdd7c6');
    txt(c,'传输任务',x+25,y+32,19,P.ink,600);pill(c,'2 个文件 · 演示',x+480,y+13,182);
    const p=clamp((t-5.8)/3.4);txt(c,p>=1?'下载完成':'正在下载至本地目录',x+25,y+72,17,P.ink);txt(c,Math.round(p*100)+'%',x+650,y+72,20,P.green,600,'right');
    rr(c,x+25,y+89,635,6,3,'#e8ede1');if(p>0)rr(c,x+25,y+89,635*p,6,3,P.green);
    txt(c,p>=1?'项目报告.pdf  ·  素材清单.csv':'项目报告.pdf',x+25,y+133,16,P.muted);txt(c,p>=1?'已完成':'暂停 / 取消',x+650,y+151,14,P.green,500,'right');if(p>=1)check(c,x+455,y+67,16,P.green);
  });
  if(t>3&&t<5.8){const move=progress(t,3.9,4.5);cursor(c,mix(463,1470,move),mix(760,679,move),clamp((t-4.6)/.65));}
  alpha(c,progress(t,8.8,9.7),()=>{txt(c,'看状态。用终端。传文件。',120,954,26,P.ink,500);txt(c,'少一次来回，多一分专注。',1800,954,20,P.muted,400,'right');});
}

function ai(c,t) {
  heading(c,'06 / CONTEXTUAL ASSISTANT','让 AI 跟着目录思考。','从选中文件到整理计划，在当前工作范围内协作；每一步，由你确认。',t);
  const p=progress(t,0,.9);c.save();c.globalAlpha*=p;c.translate(0,28*(1-p));
  shell(c,120,323,1680,574,'项目交付  ·  Agent 助手');
  // Actual file context remains visible beside the conversation.
  rr(c,140,392,710,485,12,'#f0f1e9');txt(c,'当前文件夹',166,423,14,P.muted,500);txt(c,'D:\\项目\\秋季发布',166,457,25,P.ink,600);pill(c,'本地目录',716,403,109);
  ln(c,164,482,826,482);txt(c,'名称',217,512,15,P.muted);txt(c,'类型',687,512,15,P.muted);
  const names=[['报告-终版.pdf','PDF 文档','file'],['数据摘要.csv','CSV 表格','file'],['交付','文件夹','folder'],['素材','文件夹','folder']];
  names.forEach((r,i)=>{const y=532+i*65;const selected=i===0;rr(c,163,y-5,663,55,7,selected?'#e0e7d5':null);badge(c,179,y+3,38,r[2],r[2]==='folder'?P.gold:P.green);txt(c,r[0],232,y+29,21,P.ink,selected?500:400);txt(c,r[1],686,y+29,15,P.muted);if(selected){rr(c,793,y+14,16,16,3,P.green);check(c,801,y+22,9,P.white);}});
  txt(c,'发送目录 / 选中项的元数据',166,840,15,P.muted);pill(c,'已选 1 项',700,819,120,'#e0e7d5',P.green);
  // Connection is a conceptual illustration of scoped metadata, not file upload.
  alpha(c,progress(t,.6,1.2)*(1-progress(t,4.5,5.2)),()=>{
    travelling(c,811,559,937,559,t,P.gold);pill(c,'目录上下文',791,690,166,P.dark,P.white);
  });
  rr(c,884,392,896,485,12,'#fafaf4',P.line);
  badge(c,907,407,36,'spark',P.green);txt(c,'Agent 助手',957,431,21,P.ink,600);pill(c,'逐次确认',1632,408,128);ln(c,907,457,1756,457);
  const userP=progress(t,.9,1.5);alpha(c,userP,()=>{rr(c,1097,481+10*(1-userP),659,56,12,'#e9ecdf');txt(c,'把选中的报告复制到「交付」文件夹。',1120,516+10*(1-userP),20,P.ink);});
  const replyP=progress(t,2,2.6);alpha(c,replyP,()=>{
    badge(c,910,558,32,'spark',P.green);txt(c,'建议执行以下文件操作',957,581,20,P.ink,500);
    rr(c,954,606,802,166,10,P.white,'#d9dfcf');txt(c,'操作计划',975,634,14,P.muted,500);pill(c,'复制文件',1599,618,137,'#ede9db',P.ink);
    txt(c,'报告-终版.pdf',977,675,23,P.ink,600);ln(c,1199,668,1263,668,P.gold,2);ln(c,1255,661,1263,668,P.gold,2);ln(c,1255,675,1263,668,P.gold,2);badge(c,1287,650,34,'folder',P.gold);txt(c,'交付 /',1335,674,23,P.ink,600);
    txt(c,'当前目录内复制，保留原文件。',977,712,17,P.muted);
    txt(c,t<6?'待确认':t<7.8?'正在复制…':'已完成 · 1 个文件',977,750,16,t<6?P.muted:P.green,500);
  });
  const buttonP=progress(t,3,3.6);alpha(c,buttonP,()=>{rr(c,1572,792,184,56,9,t<6?P.ink:P.green);if(t<6)txt(c,'确认执行',1664,827,19,P.white,500,'center');else{check(c,1602,819,12,P.white);txt(c,'已确认',1674,827,19,P.white,500,'center');}txt(c,'权限跟随当前标签',914,829,14,P.muted);});
  if(t>4&&t<6.8){const cp=progress(t,4.1,5.6);cursor(c,mix(1247,1684,cp),mix(835,815,cp),clamp((t-5.95)/.65));}
  // A copy separates from the original, then lands in the target directory.
  if(t>6&&t<8.1){const cp=progress(t,6.1,7.7);const xx=mix(300,358,cp)+Math.sin(cp*Math.PI)*260;const yy=mix(554,685,cp)-Math.sin(cp*Math.PI)*95;alpha(c,Math.min(1,(t-6)*3,(8.1-t)*4),()=>{c.save();c.translate(xx,yy);c.rotate(Math.sin(cp*Math.PI)*.12);shadow(c,()=>rr(c,-99,-25,240,54,9,P.white));badge(c,-88,-17,34,'file',P.green);txt(c,'报告-终版.pdf',-43,6,17,P.ink);c.restore();});}
  alpha(c,progress(t,7.6,8.2),()=>{rr(c,508,665,301,37,7,'#dae6d4');check(c,527,684,13,P.green);txt(c,'新增 报告-终版.pdf',548,690,16,P.green,500);});
  c.restore();
  alpha(c,progress(t,8.4,9.1),()=>{txt(c,'上下文就在眼前，操作仍由你掌握。',120,954,26,P.ink,500);txt(c,'界面演示 · 需配置模型服务',1800,954,17,P.muted,400,'right');});
}

function memory(c,t) {
  heading(c,'07 / WORK THAT REMEMBERS','项目有记忆，工作有延续。','选择工作流，保存目录偏好；下一次打开项目，接着之前的思路往下走。',t);
  const p=progress(t,0,.9);
  // Fine orbital marks make the data relationships readable without turning them into a network graphic.
  alpha(c,p*.35,()=>{c.save();c.strokeStyle='#9b9e88';c.lineWidth=1;c.setLineDash([3,8]);c.beginPath();c.ellipse(970,623,414,234,-.04,0,Math.PI*2);c.stroke();c.restore();});
  alpha(c,progress(t,.2,1.1),()=>{
    const y=355+22*(1-progress(t,.2,1.1));shadow(c,()=>rr(c,120,y,425,491,17,P.white));
    txt(c,'01',147,y+39,13,P.muted,500);txt(c,'给协作一个方法',147,y+82,26,P.ink,600);txt(c,'技能说明 · 工作流建议',147,y+115,16,P.muted);
    const skills=[['文件整理','根据目录提出整理计划','folder'],['任务拆解','拆分步骤、依赖与验收','spark'],['文档编写','在对话中生成文档草稿','file']];
    skills.forEach((s,i)=>{const sy=y+149+i*91;rr(c,141,sy,383,75,9,i===0?'#e8eddf':'#f5f5ee');badge(c,157,sy+17,39,s[2],i===0?P.green:P.gold);txt(c,s[0],212,sy+30,20,P.ink,500);txt(c,s[1],212,sy+56,14,P.muted);if(i===0)check(c,501,sy+31,13,P.green);});
    txt(c,'9 项内置技能  /  可导入 SKILL.md',147,y+456,15,P.muted);
  });
  const core=progress(t,.5,1.5);alpha(c,core,()=>{
    const xx=628,yy=390+20*(1-core);shadow(c,()=>rr(c,xx,yy,653,439,20,P.dark));
    badge(c,xx+30,yy+29,52,'folder',P.gold);txt(c,'秋季发布',xx+99,yy+61,29,P.white,600);txt(c,'D:\\项目\\秋季发布',xx+30,yy+115,18,'#adbaac');
    ln(c,xx+30,yy+143,xx+622,yy+143,'#475249');
    const glow=progress(t,3.2,4.3);alpha(c,glow,()=>rr(c,xx+27,yy+164,599,49,8,'#d5ad521c'));
    badge(c,xx+39,yy+169,34,'folder',P.gold);txt(c,'.dalizi',xx+88,yy+195,24,P.gold,600);
    ln(c,xx+56,yy+214,xx+56,yy+323,'#566150');ln(c,xx+56,yy+248,xx+86,yy+248,'#566150');ln(c,xx+56,yy+311,xx+86,yy+311,'#566150');
    alpha(c,progress(t,3.4,4.2),()=>{badge(c,xx+92,yy+226,36,'file','#9bb78f');txt(c,'agent-memory.json',xx+146,yy+250,22,P.white,500);txt(c,'显式保存的目录偏好',xx+146,yy+276,14,'#a1b29f');});
    alpha(c,progress(t,5.6,6.4),()=>{badge(c,xx+92,yy+291,36,'file','#c5b678');txt(c,'chat-history.json',xx+146,yy+315,22,P.white,500);txt(c,'保存的对话文字与摘要',xx+146,yy+341,14,'#a1b29f');});
    txt(c,'记忆随项目目录保存',xx+31,yy+403,16,'#b5c2b1');dot(c,xx+618,yy+398,4,P.gold);
  });
  alpha(c,progress(t,1.2,2),()=>travelling(c,546,552,627,552,t,P.gold));
  // Saved memory: approval is visible before the file lights up.
  const mp=progress(t,1.3,2.1);alpha(c,mp,()=>{
    const x=1360,y=355+26*(1-mp);shadow(c,()=>rr(c,x,y,440,223,16,P.white));txt(c,'02  目录记忆',x+24,y+35,14,P.muted,500);txt(c,'交付资料保留原始文件名。',x+24,y+85,21,P.ink,500);txt(c,'核对后，保存到当前项目。',x+24,y+119,16,P.muted);
    rr(c,x+24,y+148,392,49,8,t<3.5?P.ink:P.green);if(t<3.5)txt(c,'编辑并保存',x+220,y+180,19,P.white,500,'center');else{check(c,x+151,y+172,13,P.white);txt(c,'已保存',x+237,y+180,19,P.white,500,'center');}
  });
  if(t>2.3&&t<4.2){const cp=progress(t,2.3,3.35);cursor(c,mix(1700,1590,cp),mix(603,532,cp),clamp((t-3.45)/.65));}
  alpha(c,progress(t,3.6,4.3),()=>travelling(c,1360,480,1281,586,t,P.green));
  const hp=progress(t,5.3,6.2);alpha(c,hp,()=>{
    const x=1360,y=609+26*(1-hp);shadow(c,()=>rr(c,x,y,440,237,16,P.white));txt(c,'03  对话历史',x+24,y+36,14,P.muted,500);txt(c,'秋季发布 · 资料整理',x+24,y+78,23,P.ink,600);txt(c,'计划、文字与摘要，继续可见。',x+24,y+111,16,P.muted);
    rr(c,x+24,y+137,392,47,8,t<8?P.pale:P.green);txt(c,t<8?'在新标签继续':'已载入新的对话标签',x+220,y+168,18,t<8?P.green:P.white,500,'center');
    txt(c,'恢复后权限：逐次确认',x+24,y+215,14,P.muted);
  });
  alpha(c,progress(t,6.1,6.8),()=>travelling(c,1281,703,1360,710,t,P.gold));
  if(t>7&&t<8.8){const cp=progress(t,7,7.9);cursor(c,mix(1750,1610,cp),mix(865,771,cp),clamp((t-8)/.6));}
  const bottom=progress(t,9,9.8);alpha(c,bottom,()=>{rule(c,120,910,1680,'技能提供方法 · 记忆保留偏好 · 历史延续思路');txt(c,'让熟悉的工作方式，留在熟悉的项目里。',1800,950,22,P.ink,500,'right');});
}

export const connectedChapters = [
  {start:48,end:60,title:'远程，也像在手边',detail:'SSH · 主机概况 · 终端 · SFTP'},
  {start:60,end:72,title:'让 AI 跟着目录思考',detail:'目录上下文 · 整理计划 · 逐次确认'},
  {start:72,end:84,title:'工作有延续',detail:'技能 · 目录记忆 · 对话历史'}
];

export function drawConnected(ctx,time,kit) {
  if(time<48 || time>=84)return;
  ctx.save();
  if(time<60)ssh(ctx,time-48);else if(time<72)ai(ctx,time-60);else memory(ctx,time-72);
  ctx.restore();
}
