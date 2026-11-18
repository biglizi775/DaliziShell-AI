/** Original deterministic code-only score. 80 BPM, D major / B minor, 96 seconds. */
const NOTES = [[50,57,61,64,69],[47,54,57,61,66],[43,50,54,57,62],[45,52,57,59,64]];
const hz=n=>440*Math.pow(2,(n-69)/12);
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const TABLE=32768,MASK=TABLE-1;

/** Pure PCM DSP returning a normal Web Audio buffer. No samples or network. */
export async function createScore({duration=96,sampleRate=48000}={}) {
  if(!Number.isFinite(duration)||duration<=0||duration>600) throw new RangeError('Invalid score duration.');
  if(![22050,24000,32000,44100,48000,88200,96000].includes(sampleRate)) throw new RangeError('Unsupported sample rate.');
  const size=Math.ceil(duration*sampleRate);
  const Offline=globalThis.OfflineAudioContext||globalThis.webkitOfflineAudioContext;
  if(!Offline) throw new Error('This browser does not support audio synthesis.');
  // Allocate with Web Audio, then compute PCM directly instead of a huge node graph.
  const context=new Offline(2,size,sampleRate);
  const buffer=context.createBuffer(2,size,sampleRate);
  const left=buffer.getChannelData(0),right=buffer.getChannelData(1);
  const roomSend=new Float32Array(size),echoSend=new Float32Array(size);
  const sine=new Float32Array(TABLE),soft=new Float32Array(TABLE);
  for(let i=0;i<TABLE;i++){const p=i/TABLE*Math.PI*2;sine[i]=Math.sin(p);soft[i]=Math.sin(p)+Math.sin(p*3)*.105+Math.sin(p*5)*.025;}
  let seed=0xDA1121;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
  const noise=new Float32Array(sampleRate*4);
  for(let i=0;i<noise.length;i++)noise[i]=random()*2-1;
  const step=f=>f*TABLE/sampleRate;
  const beat=.75,bar=3;

  function pad(notes,time,length,intensity){
    const start=Math.round(time*sampleRate),count=Math.min(size-start,Math.round((length+1.2)*sampleRate));
    if(count<=0)return;
    const attack=.9*sampleRate,release=1.5*sampleRate;
    for(let voice=1;voice<notes.length;voice++){
      const f=hz(notes[voice]),da=step(f*.9981),db=step(f*1.0019),pan=[-.65,.55,-.25,.3][voice-1];
      const gl=Math.sqrt((1-pan)*.5)*.024*intensity,gr=Math.sqrt((1+pan)*.5)*.024*intensity;
      let a=voice*471,b=voice*2197;
      for(let i=0;i<count;i++){
        const env=Math.min(1,i/attack,(count-i)/release),v=(soft[a&MASK]+soft[b&MASK])*env,j=start+i;
        left[j]+=v*gl;right[j]+=v*gr;roomSend[j]+=v*.013*intensity;a+=da;b+=db;
      }
    }
  }
  function mallet(note,time,level=.08,pan=0,length=1.7){
    if(time<0||time>=duration-.2)return;
    const start=Math.round(time*sampleRate),count=Math.min(size-start,Math.round(length*sampleRate));
    const d=step(hz(note)),dm=d*2,gl=Math.sqrt((1-pan)*.5),gr=Math.sqrt((1+pan)*.5);
    const decay=Math.exp(-7/(length*sampleRate)),fmDecay=Math.exp(-1/(sampleRate*.048)),attack=sampleRate*.006;
    let phase=0,mod=0,env=level,depth=TABLE*.1;
    for(let i=0;i<count;i++){
      const v=sine[(phase+sine[mod&MASK]*depth)&MASK]*env*Math.min(1,i/attack),j=start+i;
      left[j]+=v*gl;right[j]+=v*gr;roomSend[j]+=v*.52;echoSend[j]+=v*.36;
      phase+=d;mod+=dm;env*=decay;depth*=fmDecay;
    }
  }
  function bass(note,time,length,level=.14){
    if(time>=duration-3)return;
    const start=Math.round(time*sampleRate),count=Math.min(size-start,Math.round(length*sampleRate));
    const delta=step(hz(note-12)),attack=sampleRate*.025,release=sampleRate*.18;
    let phase=0;
    for(let i=0;i<count;i++){
      const v=(sine[phase&MASK]+sine[(phase*2)&MASK]*.12)*level*Math.min(1,i/attack,(count-i)/release)*.7;
      left[start+i]+=v;right[start+i]+=v;phase+=delta;
    }
  }
  function kick(time,level=.28){
    if(time>=duration-4)return;
    const start=Math.round(time*sampleRate),count=Math.min(size-start,Math.round(.52*sampleRate));
    const pd=Math.exp(-1/(sampleRate*.028)),ad=Math.exp(-1/(sampleRate*.115));
    let phase=0,pitch=70,env=level;
    for(let i=0;i<count;i++){
      const v=sine[phase&MASK]*env*Math.min(1,i/(sampleRate*.003));left[start+i]+=v;right[start+i]+=v;
      phase+=step(45+pitch);pitch*=pd;env*=ad;
    }
  }
  function texture(time,length,level,freq,pan=0,type='highpass'){
    if(time>=duration-3)return;
    const start=Math.round(time*sampleRate),count=Math.min(size-start,Math.round(length*sampleRate));
    const offset=Math.floor(random()*(noise.length-count)),gl=Math.sqrt((1-pan)*.5),gr=Math.sqrt((1+pan)*.5);
    const a=1-Math.exp(-2*Math.PI*freq/sampleRate),b=1-Math.exp(-2*Math.PI*freq*.45/sampleRate),decay=Math.exp(-6/count);
    let low=0,lower=0,env=level;
    for(let i=0;i<count;i++){
      const n=noise[offset+i];low+=a*(n-low);lower+=b*(n-lower);
      const v=(type==='highpass'?n-low:low-lower)*env*Math.min(1,i/(sampleRate*.003));
      left[start+i]+=v*gl;right[start+i]+=v*gr;roomSend[start+i]+=v*.12;env*=decay;
    }
  }
  function transition(time,note,intensity=1){
    const start=Math.max(0,Math.round((time-1.35)*sampleRate)),end=Math.min(size,Math.round((time+.85)*sampleRate)),center=time*sampleRate;
    let low=0,lower=0;
    for(let j=start;j<end;j++){
      const t=(j-center)/sampleRate,env=t<0?Math.pow((t+1.35)/1.35,2.2):Math.exp(-t*8),n=noise[(j-start)%noise.length];
      low+=.22*(n-low);lower+=.035*(n-lower);
      const v=(low-lower)*.10*intensity*env;left[j]+=v*.6;right[j]+=v*.7;roomSend[j]+=v*.9;
    }
    mallet(note+24,time+.04,.07*intensity,-.28,2.3);mallet(note+31,time+.22,.035*intensity,.4,2.4);
  }

  const energy=[.50,.78,.94,.74,1,.88,.64,.72],figure=[1,3,2,4,1,2,3,4];
  for(let b=0;b<Math.ceil(duration/bar);b++){
    const time=b*bar,chapter=Math.min(7,Math.floor(time/12)),chord=time>=90?NOTES[0]:NOTES[b%4],intensity=energy[chapter];
    pad(chord,time,bar,intensity);
    if(b>=2&&time<duration-4){bass(chord[0],time,beat*1.7,.13*intensity);if(chapter!==6)bass(chord[0],time+beat*2.5,beat*1.25,.095*intensity);}
    const sparse=chapter===0||chapter===6||time>=duration-6;
    for(const pulse of sparse?[0,3,6]:[0,1,2,3,4,5,6,7]){
      const note=chord[figure[(pulse+(b%2?2:0))%8]]+12,accent=pulse===0||pulse===4?1:.62;
      mallet(note,time+pulse*beat*.5+(pulse%2?.018:0),.058*intensity*accent,Math.sin(pulse*1.7+b)*.42,1.55);
    }
    if(chapter>0&&time<duration-6){
      kick(time,.20*intensity);if(chapter!==6)kick(time+beat*2,.16*intensity);
      for(let p=0;p<8;p++){if(chapter===6&&p%2)continue;texture(time+p*beat*.5+.016,.085,(p%2?.025:.016)*intensity,6800,p%2?.5:-.4);}
      texture(time+beat,.22,.075*intensity,1750,-.13,'bandpass');texture(time+beat*3,.19,.065*intensity,2100,.15,'bandpass');
    }
    if(b%8===7)await new Promise(resolve=>setTimeout(resolve,0));
  }
  const phrases=[
    {t:12,n:[78,76,73,69],r:[0,1.5,3.5,5.5]},
    {t:24,n:[73,76,78,81,78],r:[0,1.5,3,4.5,7]},
    {t:36,n:[78,81,76,73],r:[0,2,4,6.5]},
    {t:48,n:[73,76,78,81,85,81],r:[0,1,2.5,4,6,8]},
    {t:60,n:[78,76,73,71,69],r:[0,2,3.5,5,7.5]},
    {t:72,n:[73,69,66],r:[0,3,7]},
    {t:84,n:[78,81,85,81,78],r:[0,1.5,3,5,7]}
  ];
  for(const p of phrases)p.n.forEach((note,i)=>mallet(note,p.t+p.r[i]*beat,.075,i%2?.17:-.17,2.4));
  for(let t=12;t<=84&&t<duration;t+=12)transition(t,50,t===84?1.25:1);
  for(const[t,n]of[[18.8,81],[28.5,78],[32.1,81],[40.6,85],[44.2,81],[54.6,78],[57.5,81],[66.4,85],[69.6,81],[77.2,78],[80.3,81]])mallet(n,t,.030,.3,.7);
  if(duration>=90){mallet(86,90,.05,.2,4);mallet(81,90.15,.04,-.2,4);}

  // A Schroeder-style damped room and alternating stereo echoes, fully procedural.
  const combs=[.0297,.0371,.0411,.0437].map(t=>new Float32Array(Math.round(t*sampleRate)));
  const indices=[0,0,0,0],damp=[0,0,0,0];
  const echo=new Float32Array(Math.round(beat*.75*sampleRate)),echoOther=new Float32Array(Math.round(beat*1.25*sampleRate));
  let ei=0,ej=0,peak=0;
  for(let i=0;i<size;i++){
    const input=roomSend[i],v0=combs[0][indices[0]],v1=combs[1][indices[1]],v2=combs[2][indices[2]],v3=combs[3][indices[3]];
    damp[0]+=.36*(v0-damp[0]);damp[1]+=.36*(v1-damp[1]);damp[2]+=.36*(v2-damp[2]);damp[3]+=.36*(v3-damp[3]);
    for(let c=0;c<4;c++){combs[c][indices[c]]=input+damp[c]*.81;if(++indices[c]===combs[c].length)indices[c]=0;}
    const delayed=echo[ei],other=echoOther[ej];echo[ei]=echoSend[i]+other*.26;echoOther[ej]=echoSend[i]*.5+delayed*.3;
    if(++ei===echo.length)ei=0;if(++ej===echoOther.length)ej=0;
    const envelope=Math.max(0,Math.min(1,i/(sampleRate*1.8))*Math.min(1,(size-1-i)/(sampleRate*Math.min(4,duration*.3))));
    left[i]=Math.tanh((left[i]+(v0+v2)*.20+delayed*.55+other*.15)*1.45)*envelope;
    right[i]=Math.tanh((right[i]+(v1+v3)*.20+delayed*.15+other*.55)*1.45)*envelope;
    peak=Math.max(peak,Math.abs(left[i]),Math.abs(right[i]));
  }
  const scale=peak>0?.89/peak:1;
  for(let i=0;i<size;i++){left[i]*=scale;right[i]*=scale;}
  return buffer;
}

/** Interleaved signed 16-bit PCM WAV for playback or video muxing. */
export function encodeWav(buffer){
  const channels=buffer.numberOfChannels,samples=buffer.length,dataSize=samples*channels*2;
  const bytes=new ArrayBuffer(44+dataSize),view=new DataView(bytes);
  const ascii=(at,value)=>[...value].forEach((c,i)=>view.setUint8(at+i,c.charCodeAt(0)));
  ascii(0,'RIFF');view.setUint32(4,36+dataSize,true);ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);
  view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,buffer.sampleRate,true);view.setUint32(28,buffer.sampleRate*channels*2,true);
  view.setUint16(32,channels*2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,dataSize,true);
  const planes=Array.from({length:channels},(_,c)=>buffer.getChannelData(c));let offset=44;
  for(let i=0;i<samples;i++)for(let ch=0;ch<channels;ch++){
    const v=clamp(planes[ch][i],-1,1);view.setInt16(offset,Math.round(v<0?v*32768:v*32767),true);offset+=2;
  }
  return new Blob([bytes],{type:'audio/wav'});
}
