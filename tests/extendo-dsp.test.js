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
{const {x,sr}=synth({bpm:120,phase:0.25});const env=D.envelope(x,sr);const r=D.rephase(env,sr,120,x);const beat=0.5,bar=2,db=r.firstBeat+r.downbeat*beat;let err=((db-0.25)%bar+bar)%bar;if(err>bar/2)err-=bar;ok(Math.abs(err)<0.008,'rephase downbeat within 8 ms ('+(err*1000).toFixed(1)+'ms)');}
// plan with intro=0 → song starts at 0, pre-roll preserved
{const p=D.plan({sStart:0.1,sEnd:200,bpm:128,firstBeat:0.3,downbeat:0},{intro:0,outro:16,blendIn:0,blendOut:4});ok(p.songStartT===0&&p.songOffset===0.1&&Math.abs(p.dropT-0.2)<1e-9,'intro=0 keeps song at t=0 with its lead-in');ok(p.outro.start===p.lastDBT-4*p.bar&&p.outro.bars===20,'blendOut shifts outro drums earlier');}
// pickup: song starts 1 beat before its first downbeat
{const p=D.plan({sStart:0.0,sEnd:200,bpm:120,firstBeat:0.5,downbeat:0},{intro:8,outro:0,blendIn:0,blendOut:0});ok(Math.abs(p.firstDB-0.5)<1e-9&&Math.abs(p.songStartT-(16-0.5))<1e-9,'1-beat pickup overlaps the intro');}
// bar-1 override snaps to the grid and moves the drop
{const p=D.plan({sStart:0.0,sEnd:200,bpm:120,firstBeat:0.5,downbeat:0,firstDBOverride:4.6},{intro:8,outro:0,blendIn:0,blendOut:0});ok(Math.abs(p.firstDB-4.5)<1e-9&&Math.abs(p.songStartT-(16-4.5))<1e-9,'firstDBOverride snaps 4.6 → bar line 4.5 and song starts earlier under the intro');}
// WAV encoder
{const L=new Float32Array([0,0.5,-0.5,1,-1,2]),R=new Float32Array([0,0.25,-0.25,0,0,0]);const ab=D.encodeWav([L,R],44100);const v=new DataView(ab);
  ok(ab.byteLength===44+6*2*2&&String.fromCharCode(v.getUint8(0),v.getUint8(1),v.getUint8(2),v.getUint8(3))==='RIFF'&&v.getUint32(24,true)===44100&&v.getUint16(22,true)===2,'wav header');
  ok(v.getInt16(44,true)===0&&v.getInt16(46,true)===0&&v.getInt16(48,true)===16383&&v.getInt16(56,true)===32767&&v.getInt16(60,true)===-32768&&v.getInt16(64,true)===32767,'wav samples + clipping');}
// key detection: A minor progression (Am F C G) → 8A ; D major chord loop → 10B
{const sr=44100,dur=30,n=sr*dur,x=new Float32Array(n);const chords={Am:[57,60,64],F:[53,57,60],C:[48,52,55],G:[55,59,62]};const seq=['Am','F','C','G'];
  for(let i=0;i<n;i++){const ch=chords[seq[Math.floor(i/sr/2)%4]];let v=0;for(const m of ch){const f=440*Math.pow(2,(m-69)/12);v+=0.2*Math.sin(2*Math.PI*f*i/sr)+0.05*Math.sin(2*Math.PI*2*f*i/sr);}x[i]=v;}
  const k=D.detectKey(x,sr);ok(k&&k.camelot==='8A','key: Am-F-C-G reads 8A / A minor ('+(k&&k.name)+' '+(k&&k.camelot)+')');
  const y=new Float32Array(n);for(let i=0;i<n;i++){let v=0;for(const m of [50,54,57,62]){const f=440*Math.pow(2,(m-69)/12);v+=0.2*Math.sin(2*Math.PI*f*i/sr);}y[i]=v;}
  const k2=D.detectKey(y,sr);ok(k2&&k2.camelot==='10B','key: D major triad reads 10B ('+(k2&&k2.name)+' '+(k2&&k2.camelot)+')');}
// HPSS: sustained chord + periodic noise bursts → harmonic output keeps the chord, drops most of the bursts
{const sr=44100,n=sr*4,x=new Float32Array(n),tone=new Float32Array(n),burst=new Float32Array(n);let sd=5;const rnd=()=>{sd=(sd*16807)%2147483647;return sd/2147483647*2-1;};
  for(let i=0;i<n;i++){let v=0;for(const f of [220,277.2,329.6])v+=0.2*Math.sin(2*Math.PI*f*i/sr);tone[i]=v;}
  for(let t=0;t<4;t+=0.25){const s0=Math.floor(t*sr);for(let i=0;i<sr*0.05;i++)burst[s0+i]+=0.6*Math.exp(-i/(sr*0.01))*rnd();}
  for(let i=0;i<n;i++)x[i]=tone[i]+burst[i];
  const t0=Date.now();const h=D.hpss(x);const ms=Date.now()-t0;
  const e=(a,b)=>{let s=0;for(let i=0;i<a.length;i++){const d=a[i]-(b?b[i]:0);s+=d*d;}return s;};
  // how much of the tone survives (compare to tone) and how much burst energy remains (project onto burst-only windows)
  let toneKeep=1-e(h,tone)/e(tone), burstLeft=0, burstTot=0;for(let t=0;t<4;t+=0.25){const s0=Math.floor(t*sr);for(let i=0;i<sr*0.05;i++){burstLeft+=(h[s0+i]-tone[s0+i])**2;burstTot+=burst[s0+i]**2;}}
  console.log(`hpss: tone kept ${(toneKeep*100).toFixed(0)}%, burst energy left ${(burstLeft/burstTot*100).toFixed(0)}%, ${ms} ms for 4 s`);
  ok(toneKeep>0.85,'hpss keeps the sustained chord');ok(burstLeft/burstTot<0.25,'hpss removes most of the drum-like bursts');}
// tags: ID3v2.3 with APIC round-trips through the tagged WAV; WAV/M4A/FLAC readers
{const png=Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3,4,5,6,7,8,9]);
  const L=new Float32Array(2000),R=new Float32Array(2000);for(let i=0;i<2000;i++){L[i]=Math.sin(i/9)*0.5;R[i]=-L[i];}
  const ab=D.encodeWav([L,R],44100,{title:'Night Drive (Extended Mix)',artist:'2 Points',album:'Singles',bpm:124,key:'8A',cover:{mime:'image/png',data:png}});
  const t=D.parseTags(new Uint8Array(ab),'x.wav');
  ok(t.title==='Night Drive (Extended Mix)'&&t.artist==='2 Points'&&t.album==='Singles'&&t.bpm==='124'&&t.key==='8A','tagged WAV: title/artist/album/BPM/key read back ('+JSON.stringify({t:t.title,a:t.artist,b:t.bpm,k:t.key})+')');
  ok(t.cover&&t.cover.mime==='image/png'&&t.cover.data.length===png.length&&t.cover.data.every((v,i)=>v===png[i]),'tagged WAV: cover art bytes round-trip');
  // the PCM payload is untouched and the file still parses as a WAV with an even-aligned data chunk
  const v=new DataView(ab);ok(v.getUint32(4,true)===ab.byteLength-8&&v.getUint32(40,true)===2000*4&&v.getInt16(44,true)===0,'tagged WAV: RIFF size and data chunk intact');
  // minimal M4A: ftyp + moov/udta/meta/ilst with ©nam and covr
  const atom=(type,payload)=>{const b=new Uint8Array(8+payload.length);const n=b.length;b[0]=n>>>24;b[1]=(n>>16)&255;b[2]=(n>>8)&255;b[3]=n&255;for(let i=0;i<4;i++)b[4+i]=type.charCodeAt(i)&255;b.set(payload,8);return b;};
  const cat=(...a)=>{const n=a.reduce((s,x)=>s+x.length,0),o=new Uint8Array(n);let p=0;for(const x of a){o.set(x,p);p+=x.length;}return o;};
  const data=(kind,bytes)=>atom('data',cat(Uint8Array.from([0,0,0,kind,0,0,0,0]),bytes));
  const nam=atom('©nam',data(1,new TextEncoder().encode('Night Drive')));const art=atom('©ART',data(1,new TextEncoder().encode('2 Points')));const covr=atom('covr',data(14,png));
  const m4a=cat(atom('ftyp',new TextEncoder().encode('M4A mp42')),atom('moov',atom('udta',atom('meta',cat(Uint8Array.from([0,0,0,0]),atom('ilst',cat(nam,art,covr)))))));
  const tm=D.parseTags(m4a,'x.m4a');ok(tm.title==='Night Drive'&&tm.artist==='2 Points'&&tm.cover&&tm.cover.mime==='image/png'&&tm.cover.data.length===png.length,'M4A: title/artist/cover from the ilst atoms');
  // minimal FLAC: fLaC + VORBIS_COMMENT + PICTURE
  const le=(n)=>Uint8Array.from([n&255,(n>>8)&255,(n>>16)&255,(n>>>24)&255]),be=(n)=>Uint8Array.from([n>>>24,(n>>16)&255,(n>>8)&255,n&255]);
  const vc=(()=>{const vendor=new TextEncoder().encode('ref');const items=['TITLE=Night Drive','ARTIST=2 Points'].map(x=>new TextEncoder().encode(x));return cat(le(vendor.length),vendor,le(items.length),...items.flatMap(i=>[le(i.length),i]));})();
  const mime=new TextEncoder().encode('image/png');const pic=cat(be(3),be(mime.length),mime,be(0),be(0),be(0),be(0),be(0),be(png.length),png);
  const blk=(type,last,body)=>cat(Uint8Array.from([(last?0x80:0)|type,(body.length>>16)&255,(body.length>>8)&255,body.length&255]),body);
  const flac=cat(new TextEncoder().encode('fLaC'),blk(4,false,vc),blk(6,true,pic));
  const tf=D.parseTags(flac,'x.flac');ok(tf.title==='Night Drive'&&tf.artist==='2 Points'&&tf.cover&&tf.cover.data.length===png.length,'FLAC: title/artist/cover from the metadata blocks');
  // AIFF: big-endian PCM, 80-bit sample rate, same ID3 tag in an 'ID3 ' chunk, readable back through parseTags
  {const L=new Float32Array([0,0.5,-0.5,1,-1,2]),R=new Float32Array([0,0.25,-0.25,0,0,0]);const ab=D.encodeAiff([L,R],44100,{title:'Night Drive (Extended Mix)',artist:'2 Points',cover:{mime:'image/png',data:png}});const u=new Uint8Array(ab),v=new DataView(ab);
    const s=(a,b)=>String.fromCharCode(...u.subarray(a,b));
    ok(s(0,4)==='FORM'&&v.getUint32(4)===ab.byteLength-8&&s(8,12)==='AIFF'&&s(12,16)==='COMM'&&v.getUint32(16)===18,'AIFF: FORM/AIFF header with an 18-byte COMM chunk');
    ok(v.getUint16(20)===2&&v.getUint32(22)===6&&v.getUint16(26)===16,'AIFF: COMM = 2 channels, 6 frames, 16-bit');
    ok(Array.from(u.subarray(28,38)).map(x=>x.toString(16).padStart(2,'0')).join('')==='400eac44000000000000','AIFF: 44100 Hz as 80-bit extended = 400E AC44 0000 0000 0000');
    ok(s(38,42)==='SSND'&&v.getUint32(42)===8+24&&v.getUint32(46)===0&&v.getUint32(50)===0,'AIFF: SSND chunk with zero offset/block size');
    ok(v.getInt16(54)===0&&v.getInt16(56)===0&&v.getInt16(58)===16383&&v.getInt16(60)===8191&&v.getInt16(66)===32767&&v.getInt16(70)===-32768&&v.getInt16(74)===32767,'AIFF: samples are big-endian and clipped');
    const tp=54+24;ok(s(tp,tp+4)==='ID3 '&&s(tp+8,tp+11)==='ID3','AIFF: ID3 tag sits in an uppercase ID3 chunk after the audio');
    const t=D.parseTags(u,'x.aiff');ok(t.title==='Night Drive (Extended Mix)'&&t.artist==='2 Points'&&t.bits===16&&t.cover&&t.cover.data.length===png.length,'AIFF: parseTags reads the tag, cover and bit depth back');
    const ab24=D.encodeAiff([L,R],48000,null,24);const v24=new DataView(ab24);ok(ab24.byteLength===54+36&&v24.getUint16(26)===24&&v24.getUint16(28)===0x400e&&v24.getUint32(30)===0xbb800000&&v24.getUint8(54+18)===0x7f&&v24.getUint8(54+19)===0xff&&v24.getUint8(54+20)===0xff&&v24.getUint8(54+24)===0x80&&v24.getUint8(54+25)===0&&v24.getUint8(54+26)===0,'AIFF: 24-bit at 48 kHz, no tag, +1.0 = 7FFFFF');}
  // raw MP3-style ID3v2.3 header (what encodeWav's id3Bytes produces) parses standalone too
  const wavU8=new Uint8Array(ab);let idx=-1;for(let i=44;i<wavU8.length-5;i++)if(wavU8[i]===0x49&&wavU8[i+1]===0x44&&wavU8[i+2]===0x33&&wavU8[i+3]===3&&wavU8[i+4]===0){idx=i;break;}   // the tag header 'ID3' v2.3, not the 'ID3 ' chunk id
  const id3=wavU8.slice(idx);const tmp3=D.parseTags(id3,'x.mp3');ok(tmp3.title==='Night Drive (Extended Mix)'&&tmp3.cover&&tmp3.cover.data.length===png.length,'MP3: ID3v2 tag at file start');
  // an ID3 source: every frame copied verbatim (TXXX / TCON / TYER survive), only the title changes, no branded frames added
  const srcTags=D.parseTags(id3,'x.mp3');srcTags.frames.push({id:'TXXX',data:Uint8Array.from([0].concat(Array.from(new TextEncoder().encode('LABEL\0Night Records'))))},{id:'TCON',data:Uint8Array.from([0].concat(Array.from(new TextEncoder().encode('House'))))});
  const meta2=Object.assign({},srcTags,{title:'Night Drive (Extended Mix)'});const ab2=D.encodeWav([L,R],44100,meta2,24);const t2=D.parseTags(new Uint8Array(ab2),'y.wav');
  const ids=t2.frames.map(f=>f.id);ok(t2.title==='Night Drive (Extended Mix)'&&t2.genre==='House'&&ids.includes('TXXX')&&ids.includes('APIC')&&!ids.includes('TENC')&&ids.filter(x=>x==='TIT2').length===1,'ID3 source: frames copied verbatim, title rewritten once, no branding ('+ids.join(',')+')');
  const v2=new DataView(ab2);ok(v2.getUint16(34,true)===24&&v2.getUint32(40,true)===2000*6&&t2.bits===24,'24-bit WAV when asked (bits read back as 24)');}
// rekordbox compatibility: tag written under both 'ID3 ' and 'id3 ' chunk ids; APIC normalised even from a v2.4 source with a data-length flag
{const png=Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,9,9,9,9]);const L=new Float32Array(500),R=new Float32Array(500);
  // a v2.4-style source frame set: UTF-8 title, APIC with encoding 3 + data-length-indicator flag (4 extra bytes), plus a compressed frame that must be dropped
  const apic24=Uint8Array.from([0,0,0,0, 3].concat(Array.from(new TextEncoder().encode('image/png')),[0,0,0],Array.from(png)));
  const frames=[{id:'TPE1',data:Uint8Array.from([3].concat(Array.from(new TextEncoder().encode('Bessey')))),ver:4,flags:0},{id:'APIC',data:apic24,ver:4,flags:0x01},{id:'TXXX',data:Uint8Array.from([0,65,0,66]),ver:4,flags:0x08}];
  const ab=D.encodeWav([L,R],44100,{title:'All That (Extended Mix)',frames,cover:{mime:'image/png',data:png}});const u=new Uint8Array(ab);
  const find=(id)=>{for(let i=44;i<u.length-4;i++)if(u[i]===id.charCodeAt(0)&&u[i+1]===id.charCodeAt(1)&&u[i+2]===id.charCodeAt(2)&&u[i+3]===32)return i;return -1;};
  ok(find('ID3')>0&&find('id3')>0,'WAV carries the tag under both ID3 (uppercase) and id3 (lowercase) chunks');
  const t=D.parseTags(u,'x.wav');const ap=t.frames.find(f=>f.id==='APIC');
  ok(t.title==='All That (Extended Mix)'&&t.artist==='Bessey'&&t.cover&&t.cover.data.length===png.length&&t.cover.data.every((v,i)=>v===png[i]),'tags + cover read back from the dual-chunk WAV');
  ok(ap&&ap.data[0]===0&&ap.data[ap.data.length-png.length-1]===0&&!t.frames.some(f=>f.id==='TXXX'),'APIC rewritten as encoding 0 / front cover; compressed source frame dropped');}
console.log(fails?`\n${fails} FAILED`:'\nALL PASS');process.exit(fails?1:0);
