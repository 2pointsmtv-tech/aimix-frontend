// Tempo + downbeat benchmark on synthetic house / boom-bap / trap tracks (chords, bass, breakdowns, pickups, pad intros).
// Run: node tests/extendo-downbeat-bench.js [other.html]  — prints N/36; use it when tuning detectTempo/detectDownbeat.
// Downbeat benchmark on realistic-ish synthetic tracks. Usage: node db_eval.js [path/to/extendo.html]
const fs=require('fs');const html=fs.readFileSync(process.argv[2]||require('path').join(__dirname,'..','extendo.html'),'utf8');
const m={exports:{}};new Function('module',html.match(/<script id="dsp">([\s\S]*?)<\/script>/)[1])(m);const D=m.exports;
function rng(seed){let s=seed;return()=>{s=(s*16807)%2147483647;return s/2147483647;};}
// genres: house (kick every beat, clap 2&4, bass root on 1 + offbeats, chords change every 1-2 bars), boombap, trap(half-time), 
function synth(o){const sr=44100,bpm=o.bpm,beat=60/bpm,bar=4*beat,r=rng(o.seed),dur=o.bars*bar+o.phase+2,n=Math.floor(dur*sr),x=new Float32Array(n);
  const noise=()=>r()*2-1;
  const addKick=(t,v)=>{const s0=Math.floor(t*sr);for(let i=0;i<sr*0.25&&s0+i<n;i++){const e=Math.exp(-i/(sr*0.07));x[s0+i]+=v*e*Math.sin(2*Math.PI*(45+110*Math.exp(-i/(sr*0.015)))*i/sr);}};
  const addSnare=(t,v)=>{const s0=Math.floor(t*sr);for(let i=0;i<sr*0.18&&s0+i<n;i++)x[s0+i]+=v*Math.exp(-i/(sr*0.05))*(noise()*0.7+0.3*Math.sin(2*Math.PI*200*i/sr));};
  const addHat=(t,v,len)=>{const s0=Math.floor(t*sr);for(let i=0;i<sr*len&&s0+i<n;i++)x[s0+i]+=v*Math.exp(-i/(sr*len*0.3))*noise();};
  const addTone=(t,len,f,v,shape)=>{const s0=Math.floor(t*sr),L=Math.floor(len*sr);for(let i=0;i<L&&s0+i<n;i++){const env=Math.min(1,i/(sr*0.01))*Math.min(1,(L-i)/(sr*0.02));let s=Math.sin(2*Math.PI*f*i/sr);if(shape==='saw')s=2*((f*i/sr)%1)-1;x[s0+i]+=v*env*s;}};
  const roots=[55,61.7,65.4,73.4,82.4,49];let chordRoot=roots[0];
  for(let b=0;b<o.bars;b++){const t0=o.phase+b*bar;
    const section=Math.floor(b/8);const breakdown=o.breakdown&&section===2; // bars 16-23 drums out
    if(b%(o.chordEvery||2)===0)chordRoot=roots[Math.floor(r()*roots.length)];
    // chords (pad) change on bar lines
    if(o.pad)addTone(t0,bar*(o.chordEvery||2),chordRoot*2,0.08*(breakdown?1.4:1),'saw'),addTone(t0,bar*(o.chordEvery||2),chordRoot*3,0.05,'sine');
    // bass: root on beat 1, extra notes offbeat
    if(!breakdown){addTone(t0,beat*0.9,chordRoot,0.25,'saw');if(o.bassOff){addTone(t0+beat*1.5,beat*0.4,chordRoot,0.2,'saw');addTone(t0+beat*2.5,beat*0.4,chordRoot*1.5,0.2,'saw');addTone(t0+beat*3.5,beat*0.4,chordRoot,0.2,'saw');}}
    if(breakdown)continue;
    for(let q=0;q<4;q++){const t=t0+q*beat;
      if(o.genre==='house'){addKick(t,0.8);if(q===1||q===3)addSnare(t,0.5);addHat(t+beat/2,0.25,0.12);addHat(t,0.12,0.04);}
      else if(o.genre==='boombap'){if(q===0)addKick(t,0.9);if(q===1)addKick(t+beat*0.75,0.7);if(q===2)addKick(t+beat*0.5,0.8);if(q===1||q===3)addSnare(t,0.6);addHat(t,0.2,0.05);addHat(t+beat/2,0.15,0.05);}
      else if(o.genre==='trap'){if(q===0)addKick(t,0.9);if(q===1)addKick(t+beat*0.75,0.8);if(q===2)addSnare(t,0.7);for(let h=0;h<2;h++)addHat(t+h*beat/2,0.18,0.05);if(q===3)for(let h=0;h<4;h++)addHat(t+h*beat/4,0.15,0.04);}
    }
    if(b%8===7&&o.fills)for(let i=0;i<8;i++)addSnare(t0+bar*0.5+i*beat/4,0.3+0.5*i/8);
  }
  // optional ambient pad intro before the drums (bars -8..-1), starting on a bar line
  if(o.padIntro){const t0=o.phase-8*bar;for(let b=0;b<8;b++)addTone(t0+b*bar,bar,roots[0]*2,0.1,'saw');}
  // pickup: a hat/vocal-ish burst 1 beat before the first downbeat
  if(o.pickup)addHat(o.phase-beat,0.3,0.2),addTone(o.phase-beat,beat,330,0.15,'sine');
  // gentle lowpass to tame noise, then clip
  let lp=0;const k=1-Math.exp(-2*Math.PI*9000/sr);for(let i=0;i<n;i++){lp+=k*(x[i]-lp);x[i]=Math.max(-1,Math.min(1,lp*1.2));}
  return {x,sr,trueDB:o.phase,bar,beat};}
const cases=[];let id=0;
for(const genre of ['house','boombap','trap'])for(const bpm of [124,97,142])for(let seed=1;seed<=4;seed++){
  const r=rng(seed*7+bpm);cases.push({genre,bpm:genre==='boombap'?bpm-30:bpm,seed,phase:0.3+r()*1.5,bars:48,pad:r()>0.3,chordEvery:r()>0.5?2:1,bassOff:r()>0.4,breakdown:r()>0.5,fills:r()>0.5,pickup:r()>0.7,padIntro:r()>0.7});}
let okN=0,tot=0,fails=[];const t0=Date.now();
for(const c of cases){const s=synth(c);const a=D.analyze(s.x,s.sr);tot++;
  const beat=60/a.bpm,bar=4*beat,db=a.firstBeat+a.downbeat*beat;let err=((db-s.trueDB)%bar+bar)%bar;if(err>bar/2)err-=bar;
  const bpmOk=Math.abs(a.bpm-c.bpm)<0.05,dbOk=Math.abs(err)<0.03;if(bpmOk&&dbOk)okN++;else fails.push(`${c.genre} ${c.bpm} seed${c.seed} pad=${c.pad} chordEvery=${c.chordEvery} bassOff=${c.bassOff} brk=${c.breakdown} pickup=${c.pickup} padIntro=${c.padIntro} → bpm ${a.bpm.toFixed(2)} dbErr ${(err*1000).toFixed(0)}ms (${(err/beat).toFixed(2)} beats)`);}
console.log(`downbeat+bpm correct: ${okN}/${tot}  (${Date.now()-t0} ms)`);fails.forEach(f=>console.log('  FAIL '+f));
