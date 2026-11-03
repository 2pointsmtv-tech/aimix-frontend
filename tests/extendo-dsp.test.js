// Unit tests for the pure DSP block of extendo.html (tempo, phase, downbeat, timeline plan, WAV encoder). Run: node tests/extendo-dsp.test.js
const fs=require('fs');
const html=fs.readFileSync(require('path').join(__dirname,'..','extendo.html'),'utf8');
const src=html.match(/<script id="dsp">([\s\S]*?)<\/script>/)[1];
const m={exports:{}};new Function('module',src)(m);const D=m.exports;

function synth({bpm,phase,dur=90,sr=44100,pickup=false,seed=1}){
  const n=Math.floor(dur*sr),x=new Float32Array(n),beat=60/bpm;let s=seed;const rnd=()=>{s=(s*16807)%2147483647;return s/2147483647*2-1;};
  // pad tone throughout (so the track isn't silent between hits)
  for(let i=0;i<n;i++)x[i]=0.08*Math.sin(2*Math.PI*220*i/sr)+0.05*Math.sin(2*Math.PI*330.5*i/sr);
  // kicks on every beat, snare on 2 & 4, hats on 8ths, accent on downbeat
  for(let k=0,t=phase;t<dur;t+=beat,k++){const s0=Math.floor(t*sr),db=k%4===0,sn=k%4===1||k%4===3;
    for(let i=0;i<sr*0.3&&s0+i<n;i++){const e=Math.exp(-i/(sr*0.08));x[s0+i]+=(db?0.9:0.6)*e*Math.sin(2*Math.PI*(50+100*Math.exp(-i/(sr*0.02)))*i/sr);}
    if(sn)for(let i=0;i<sr*0.15&&s0+i<n;i++)x[s0+i]+=0.4*Math.exp(-i/(sr*0.04))*rnd();
    for(const h of [0,0.5]){const h0=Math.floor((t+h*beat)*sr);for(let i=0;i<sr*0.03&&h0+i<n;i++)x[h0+i]+=0.15*Math.exp(-i/(sr*0.008))*rnd();}
  }
  for(let i=0;i<n;i++)x[i]=Math.max(-1,Math.min(1,x[i]));
  return {x,sr};
}
let fails=0;const ok=(c,msg)=>{console.log((c?'PASS ':'FAIL ')+msg);if(!c)fails++;};
for(const tc of [{bpm:126.3,phase:0.37},{bpm:92.5,phase:1.2},{bpm:140,phase:0.05},{bpm:174,phase:0.8}]){
  const {x,sr}=synth(tc);const t0=Date.now();const a=D.analyze(x,sr);const ms=Date.now()-t0;
  const beat=60/a.bpm,bar=4*beat;const db=a.firstBeat+a.downbeat*beat;
  // phase error modulo bar (detected downbeat vs true downbeat at tc.phase)
  let err=((db-tc.phase)%bar+bar)%bar;if(err>bar/2)err-=bar;
  console.log(`bpm=${tc.bpm} → ${a.bpm.toFixed(3)} conf=${a.confidence.toFixed(2)} firstBeat=${a.firstBeat.toFixed(4)} db=${a.downbeat} dbErr=${(err*1000).toFixed(1)}ms time=${ms}ms cands=${a.candidates.map(c=>c.bpm.toFixed(1)).join(',')}`);
  ok(Math.abs(a.bpm-tc.bpm)<0.03,'  bpm within 0.03');
  ok(Math.abs(err)<0.008,'  downbeat within 8 ms');
  const p=D.plan({sStart:a.bounds.start,sEnd:a.bounds.end,bpm:a.bpm,firstBeat:a.firstBeat,downbeat:a.downbeat},{intro:16,outro:8,blendIn:0,blendOut:0});
  ok(Math.abs(p.dropT-16*bar)<1e-9&&Math.abs(p.firstDB+p.off-p.dropT)<1e-9,'  song first downbeat lands on end of intro');
  ok(p.lastDB<=a.bounds.end+0.2&&p.lastDB>a.bounds.end-bar,'  last bar line near audible end');
  ok(p.total>=p.outroEnd&&p.songStartT>=0,'  timeline sane');
}
// rephase at a user BPM
{const {x,sr}=synth({bpm:120,phase:0.25});const env=D.envelope(x,sr);const r=D.rephase(env,sr,120);const beat=0.5,bar=2,db=r.firstBeat+r.downbeat*beat;let err=((db-0.25)%bar+bar)%bar;if(err>bar/2)err-=bar;ok(Math.abs(err)<0.008,'rephase downbeat within 8 ms ('+(err*1000).toFixed(1)+'ms)');}
// plan with intro=0 → song starts at 0, pre-roll preserved
{const p=D.plan({sStart:0.1,sEnd:200,bpm:128,firstBeat:0.3,downbeat:0},{intro:0,outro:16,blendIn:0,blendOut:4});ok(p.songStartT===0&&p.songOffset===0.1&&Math.abs(p.dropT-0.2)<1e-9,'intro=0 keeps song at t=0 with its lead-in');ok(p.outro.start===p.lastDBT-4*p.bar&&p.outro.bars===20,'blendOut shifts outro drums earlier');}
// pickup: song starts 1 beat before its first downbeat
{const p=D.plan({sStart:0.0,sEnd:200,bpm:120,firstBeat:0.5,downbeat:0},{intro:8,outro:0,blendIn:0,blendOut:0});ok(Math.abs(p.firstDB-0.5)<1e-9&&Math.abs(p.songStartT-(16-0.5))<1e-9,'1-beat pickup overlaps the intro');}
// WAV encoder
{const L=new Float32Array([0,0.5,-0.5,1,-1,2]),R=new Float32Array([0,0.25,-0.25,0,0,0]);const ab=D.encodeWav([L,R],44100);const v=new DataView(ab);
  ok(ab.byteLength===44+6*2*2&&String.fromCharCode(v.getUint8(0),v.getUint8(1),v.getUint8(2),v.getUint8(3))==='RIFF'&&v.getUint32(24,true)===44100&&v.getUint16(22,true)===2,'wav header');
  ok(v.getInt16(44,true)===0&&v.getInt16(46,true)===0&&v.getInt16(48,true)===16383&&v.getInt16(56,true)===32767&&v.getInt16(60,true)===-32768&&v.getInt16(64,true)===32767,'wav samples + clipping');}
console.log(fails?`\n${fails} FAILED`:'\nALL PASS');process.exit(fails?1:0);
