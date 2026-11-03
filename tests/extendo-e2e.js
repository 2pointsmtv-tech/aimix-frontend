// End-to-end check of extendo.html in headless Chromium. Needs: npm i -g playwright (or a local install) + a Chromium it can launch.
// Run: node tests/extendo-e2e.js
const fs=require('fs'),path=require('path'),os=require('os');const PAGE=path.join(__dirname,'..','extendo.html');const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'extendo-'));
const html=fs.readFileSync(PAGE,'utf8');
const m={exports:{}};new Function('module',html.match(/<script id="dsp">([\s\S]*?)<\/script>/)[1])(m);const D=m.exports;
const sr=44100,dur=70,bpm=128.4,beat=60/bpm,phase=0.9,n=Math.floor(dur*sr);const L=new Float32Array(n),R=new Float32Array(n);let s=7;const rnd=()=>{s=(s*16807)%2147483647;return s/2147483647*2-1;};
for(let i=0;i<n;i++){const t=i/sr;if(t<phase-beat)continue;const pad=0.1*Math.sin(2*Math.PI*110*t)+0.06*Math.sin(2*Math.PI*165*t);L[i]+=pad;R[i]+=pad*0.8;}
for(let k=-1,t=phase-beat;t<dur-4;t+=beat,k++){const s0=Math.floor(t*sr),db=k%4===0,sn=k>=0&&(k%4===1||k%4===3);
  if(k>=0)for(let i=0;i<sr*0.3&&s0+i<n;i++){const e=Math.exp(-i/(sr*0.08)),v=(db?0.9:0.6)*e*Math.sin(2*Math.PI*(50+100*Math.exp(-i/(sr*0.02)))*i/sr);L[s0+i]+=v;R[s0+i]+=v;}
  if(sn)for(let i=0;i<sr*0.15&&s0+i<n;i++){const v=0.4*Math.exp(-i/(sr*0.04))*rnd();L[s0+i]+=v;R[s0+i]+=v*0.9;}
  for(const h of [0,0.5]){const h0=Math.floor((t+h*beat)*sr);for(let i=0;i<sr*0.03&&h0+i<n;i++){const v=0.15*Math.exp(-i/(sr*0.008))*rnd();L[h0+i]+=v*0.8;R[h0+i]+=v;}}}
for(let i=0;i<n;i++){const t=i/sr,g=t>dur-4?Math.max(0,1-(t-(dur-4))/3):1;L[i]=Math.max(-1,Math.min(1,L[i]*g));R[i]=Math.max(-1,Math.min(1,R[i]*g));}
const PNG=Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,10,73,68,65,84,120,156,99,0,1,0,0,5,0,1,13,10,45,180,0,0,0,0,73,69,78,68,174,66,96,130]);
fs.writeFileSync(path.join(TMP,'song.wav'),Buffer.from(D.encodeWav([L,R],sr,{title:'Test Song',artist:'2 Points',album:'Demos',genre:'House',cover:{mime:'image/png',data:PNG}})));
const {chromium}=require('playwright');
(async()=>{
  const browser=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push('pageerror: '+e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push('console: '+m.text());});
  await page.goto('file://'+PAGE);
  await page.setInputFiles('#fileInput',path.join(TMP,'song.wav'));
  await page.waitForFunction(()=>window.song&&window.song.bpm,null,{timeout:60000});
  const g=await page.evaluate(()=>({bpm:song.bpm,conf:song.confidence,firstBeat:song.firstBeat,db:song.downbeat,firstDB:song.firstDB,lastDB:song.lastDB,bars:song.bars,sStart:song.sStart,sEnd:song.sEnd,loud:song.loud,status:document.getElementById('dropStatus').textContent,conflbl:document.getElementById('bpmConf').textContent,info:document.getElementById('gridInfo').textContent}));
  console.log('grid:',JSON.stringify(g));
  let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++;};const opt_changed=sh=>['house','trap'].every(k=>(sh.before[k]||0)!==(sh.after[k]||0));
  ok(Math.abs(g.bpm-128.4)<0.03,'page detected 128.4 BPM ('+g.bpm.toFixed(3)+')');
  ok(Math.abs(g.firstDB-0.9)<0.006,'first downbeat at 0.9 s ('+g.firstDB.toFixed(4)+')');
  const tg=await page.evaluate(()=>({title:song.title,artist:song.artist,art:!!document.querySelector('#art img'),row:!!document.querySelector('#libBody .ti img'),deck:document.getElementById('dTitle').textContent}));
  ok(tg.title==='Test Song'&&tg.artist==='2 Points'&&tg.art&&tg.row&&tg.deck==='Test Song','tags read from the file: title, artist and cover shown on the deck and in the library');
  ok(Math.abs(g.sStart-(0.9-60/128.4))<0.02,'audible start = 1-beat pickup');
  // every style previews without throwing
  const prev=await page.evaluate(async()=>{const out={};for(const id of STYLE_ORDER){for(let g=0;g<STYLES[id].grooves.length;g++){const b=await renderStyle(id,song.bpm,2,44100,g);out[id+'/'+STYLES[id].grooves[g].name]=+rmsOf(b).toFixed(3);}}return out;});
  console.log('groove rms:',JSON.stringify(prev));ok(Object.keys(prev).length===32&&Object.values(prev).every(v=>v>0.02&&v<0.5),'all 32 grooves (8 styles × 4) render with sane RMS');
  // build: 16-bar house→trap cycling intro, 8-bar outro with 2-bar blend, crash+fill
  await page.evaluate(()=>{opt.intro=16;opt.outro=8;opt.styles=['house','trap'];opt.cycle=8;opt.blendIn=0;opt.blendOut=2;opt.crash=true;opt.level=0;opt.fx={len:2,riser:true,rev:true,sweep:true,build:true,atDrop:true,atOutro:true,atEnd:true};fxUI();opt.bed={inOn:true,outOn:true,len:4,level:-3};});
  // account gate: signed out → build opens the sign-in modal; a signed-in user with no free mixes left → unlock modal; following both unlocks and builds
  await page.click('#buildBtn');
  const g1=await page.evaluate(()=>({modal:document.getElementById('authModal').classList.contains('show'),pending:auth.pending,result:!!result}));
  ok(g1.modal&&g1.pending==='build'&&!g1.result,'signed-out build opens the sign-in modal');
  await page.evaluate(()=>{closeModal('authModal');auth.pending=null;auth.user={id:'test',email:'dj@example.com',user_metadata:{extendo_builds:3}};renderAuth();});
  await page.click('#buildBtn');
  const g2=await page.evaluate(()=>({unlock:document.getElementById('unlockModal').classList.contains('show'),btn:document.getElementById('unlockBtn').disabled,pill:document.getElementById('authArea').textContent}));
  ok(g2.unlock&&g2.btn&&/0 free/.test(g2.pill),'3 used free mixes → unlock modal, unlock button disabled until both follows are clicked');
  await page.evaluate(()=>{followClick('spotify');followClick('insta');});
  ok(await page.evaluate(()=>!document.getElementById('unlockBtn').disabled),'both follows clicked → unlock enabled');
  const t0=Date.now();await page.evaluate(()=>confirmUnlock());await page.waitForFunction(()=>window.result&&window.result.tl,null,{timeout:120000});console.log('build took',Date.now()-t0,'ms');
  ok(await page.evaluate(()=>!document.getElementById('unlockModal').classList.contains('show')&&song.counted&&/unlimited/i.test(document.getElementById('authArea').textContent)),'unlock closed the modal, built the pending mix, pill shows UNLIMITED');
  // shuffle grooves → different groove for the selected styles and an automatic rebuild
  const sh=await page.evaluate(async()=>{const before={...opt.groove},id=result.id;shuffleGrooves(false);await new Promise(r=>setTimeout(r,50));while(busy)await new Promise(r=>setTimeout(r,50));return {before,after:{...opt.groove},rebuilt:result.id!==id,meta:document.getElementById('resultMeta').textContent};});
  ok(opt_changed(sh)&&sh.rebuilt,'shuffle picked new grooves ('+JSON.stringify(sh.after)+') and rebuilt: '+sh.meta);
  await page.evaluate(()=>{opt.groove={};});await page.click('#buildBtn');await page.waitForFunction(()=>!window.busy,null,{timeout:120000});
  const r=await page.evaluate(()=>{
    const tl=result.tl,sr=song.sr,o=result.chs[0],s=song.buf.getChannelData(0);
    const rms=(a,b)=>{let x=0,n=0;for(let i=Math.max(0,Math.floor(a*sr));i<Math.min(o.length,Math.floor(b*sr));i++){x+=o[i]*o[i];n++;}return Math.sqrt(x/n);};
    // sample-exact placement check: output at drop must equal song at firstDB (no drums there once blendIn=0 → only crash tail overlaps; compare 2 s after drop where intro drums are silent)
    const chk=(tSong,len)=>{let e=0;const b=Math.round(tSong*sr),a=b+result.shift;for(let i=0;i<len;i++)e=Math.max(e,Math.abs(o[a+i]-s[b+i]));return e;};
    return {tl:tl,len:o.length/sr,introRms:rms(0,tl.dropT-1),midSongRms:rms(tl.dropT+5,tl.dropT+15),outroRms:rms(tl.lastDBT+0.5,tl.outroEnd-0.5),tailRms:rms(tl.outroEnd+0.5,tl.total),
      placementErr:chk(tl.firstDB+8,sr*2),bedRegions:tl.bedRegions,bedRms:result.bedRms,fxRegions:tl.fxRegions,riserRms:rms(tl.dropT-0.6,tl.dropT-0.05),preRiserRms:rms(tl.dropT-2*tl.bar-1.5,tl.dropT-2*tl.bar-0.5),view:view,extTab:!document.getElementById('tabExt').disabled,dropIdxErr:Math.round(tl.firstDB*sr)+result.shift-tl.dropT*sr,peak:(()=>{let p=0;for(let i=0;i<o.length;i++){const a=Math.abs(o[i]);if(a>p)p=a;}return p;})(),
      cues:document.getElementById('cues').textContent,meta:document.getElementById('resultMeta').textContent,dl:document.getElementById('dlNote').textContent};
  });
  console.log('result:',JSON.stringify({len:r.len,introRms:r.introRms,midSongRms:r.midSongRms,outroRms:r.outroRms,tailRms:r.tailRms,placementErr:r.placementErr,peak:r.peak,dropT:r.tl.dropT,lastDBT:r.tl.lastDBT,outroEnd:r.tl.outroEnd,total:r.tl.total,cues:r.cues,meta:r.meta,dl:r.dl}));
  const bar=240/g.bpm;
  ok(Math.abs(r.tl.dropT-16*bar)<1e-6,'song drops exactly 16 bars in');
  ok(r.introRms>0.05&&Math.abs(Math.log(r.introRms/r.midSongRms))<Math.log(2.2),'intro drums present and loudness-matched to the song (intro '+r.introRms.toFixed(3)+' vs song '+r.midSongRms.toFixed(3)+')');
  ok(r.outroRms>0.05,'outro drums present');
  ok(r.placementErr<0.06&&Math.abs(r.dropIdxErr)<=1,'song placed sample-exactly (max diff '+r.placementErr.toFixed(3)+', drop index error '+r.dropIdxErr.toFixed(2)+' samples)');
  ok(r.peak<=1.0,'no overs');
  ok(Math.abs(r.len-r.tl.total)<0.01,'output length = plan');
  ok(r.fxRegions.length===3&&Math.abs(r.fxRegions[0].b-r.tl.dropT)<1e-9&&Math.abs(r.fxRegions[0].b-r.fxRegions[0].a-2*bar)<1e-9,'3 FX regions, 2 bars each, first ends at the drop');
  ok(r.view==='ext'&&r.extTab,'deck switched to EXTENDED view');
  ok(r.bedRegions.length===2&&Math.abs(r.bedRegions[0].a-r.tl.lastDBT)<1e-9&&Math.abs(r.bedRegions[1].b-r.tl.dropT)<1e-9&&r.bedRms>0.01,'melody bed placed under the outro and intro (rms '+r.bedRms.toFixed(3)+')');
  const blank=await page.evaluate(()=>{const chk=id=>{const cv=document.getElementById(id),g=cv.getContext('2d'),d=g.getImageData(0,0,cv.width,cv.height).data;let lit=0;for(let i=0;i<d.length;i+=4)if(d[i]+d[i+1]+d[i+2]>120)lit++;return lit/(d.length/4);};return {ov:chk('ov'),dt:chk('dt')};});
  console.log('canvas lit fraction:',JSON.stringify(blank));ok(blank.ov>0.05&&blank.dt>0.03,'overview + detail waveforms drawn');
  const mini=await page.evaluate(()=>{const cv=document.querySelector('#libBody canvas'),g=cv.getContext('2d'),d=g.getImageData(0,0,cv.width,cv.height).data;let green=0,other=0;for(let i=0;i<d.length;i+=4){const r=d[i],gg=d[i+1],b=d[i+2];if(r+gg+b<60)continue;if(gg>r*1.6&&gg>b*1.6)green++;else other++;}return {green,other};});
  ok(mini.green>200&&mini.other>200,'library preview shows the extended mix: green added parts + coloured song ('+mini.green+' / '+mini.other+' px)');
  // download → a blob of the right size
  const [dl]=await Promise.all([page.waitForEvent('download'),page.click('#dlBtn')]);const fname=dl.suggestedFilename();const p=await dl.path();const size=require('fs').statSync(p).size;
  console.log('download:',fname,size,'bytes');ok(fname==='2 Points - Test Song (Extended Mix).wav','download filename = Artist - Title (Extended Mix).wav');ok(size>44+Math.round(r.len*44100)*4,'wav holds the audio plus tag chunks');
  const dt0=D.parseTags(new Uint8Array(require('fs').readFileSync(p)),'d.wav');
  ok(dt0.title==='Test Song (Extended Mix)'&&dt0.artist==='2 Points'&&dt0.album==='Demos'&&dt0.genre==='House'&&dt0.cover&&dt0.cover.data.length===PNG.length&&dt0.cover.data.every((v,i)=>v===PNG[i]),'downloaded WAV carries the original tags + cover, title suffixed (Extended Mix)');
  // grid-check click track + nudge controls don't throw
  await page.evaluate(()=>{setView('src');togglePlay();nudgeBeat(1);nudgeMs(10);setDownbeatHere();togglePlay();tapTempo();setBpm(128.4);jumpCue(0);setZoom(4);});
  // grid edit: drag the zoomed waveform by 1/16 of the window (=1 beat at zoom 4) and check the anchor moved by a bar; then click a beat to make it beat 1
  const ge=await page.evaluate(()=>{window.scrollTo(0,0);player.stop();seekTo(10);toggleGridEdit();const r=document.getElementById('dtWrap').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,a0:anchorT(),beat:song.beat,bar:song.bar,db0:song.firstDB,bpm:song.bpm};});
  await page.mouse.move(ge.x,ge.y);await page.mouse.down();await page.mouse.move(ge.x+ge.w/16,ge.y,{steps:8});await page.mouse.up();
  const ge2=await page.evaluate(()=>({a:anchorT(),db:song.firstDB,gridEdit:gridEdit}));
  let shift=((ge2.a-ge.a0)%ge.bar+ge.bar)%ge.bar;ok(ge2.gridEdit&&Math.abs(shift-ge.beat)<0.02,'grid edit drag slid the grid by one beat (shift '+(shift).toFixed(3)+' s, beat '+ge.beat.toFixed(3)+')');
  await page.mouse.click(ge.x+ge.w/8,ge.y); // 1/8 of window = half a bar right of the playhead → that beat becomes beat 1
  const ge3=await page.evaluate(()=>{const t=player.pos()+song.bar/2,beat=song.beat,near=song.firstBeat+Math.round((t-song.firstBeat)/beat)*beat;return {near,a:anchorT(),beat};});
  const dm=((ge3.a-ge3.near)%(4*ge3.beat)+4*ge3.beat)%(4*ge3.beat);ok(dm<1e-6||4*ge3.beat-dm<1e-6,'clicking a beat in grid edit makes it beat 1');
  const b1=await page.evaluate(()=>{toggleGridEdit();setBpm(128.4);setBar1(song.firstDB+2*song.bar+0.1);const o=song.firstDB;nudgeBpm(0.1);return {over:o,after:song.firstDB,bpm:song.bpm,info:document.getElementById('gridInfo').textContent};});
  ok(Math.abs(b1.over-(ge.db0+2*ge.bar))<1e-6&&/set by you/.test(b1.info),'set bar 1 at a later bar line (snapped)');
  ok(Math.abs(b1.after-b1.over)<0.002&&Math.abs(b1.bpm-128.5)<1e-9,'BPM nudge pivots around bar 1');
  await page.evaluate(()=>{setBar1(null);setBpm(128.4);toggleGridEdit();});
  // scrubbing: drag across the overview while playing → playhead follows, audio paused during the drag, resumes after
  const ov=await page.evaluate(()=>{window.scrollTo(0,0);playAt(5);const r=document.getElementById('ovWrap').getBoundingClientRect();return {l:r.left,t:r.top+r.height/2,w:r.width,dur:song.buf.duration};});
  await page.mouse.move(ov.l+ov.w*0.2,ov.t);await page.mouse.down();await page.mouse.move(ov.l+ov.w*0.5,ov.t,{steps:10});
  const mid=await page.evaluate(()=>({playing:player.playing,pos:player.pos()}));
  await page.mouse.up();const after=await page.evaluate(()=>({playing:player.playing,pos:player.pos()}));
  ok(!mid.playing&&Math.abs(mid.pos-ov.dur*0.5)<0.5&&after.playing&&Math.abs(after.pos-ov.dur*0.5)<1,'overview scrub: paused while dragging, playhead at 50% ('+mid.pos.toFixed(2)+'s), resumed after');
  // zoomed view: drag left by a quarter of the window = +1 bar at zoom 4
  const dt=await page.evaluate(()=>{if(gridEdit)toggleGridEdit();player.stop();seekTo(20);setZoom(4);const r=document.getElementById('dtWrap').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,bar:song.bar};});
  await page.mouse.move(dt.x,dt.y);await page.mouse.down();await page.mouse.move(dt.x-dt.w/4,dt.y,{steps:8});await page.mouse.up();
  const p2=await page.evaluate(()=>player.pos());ok(Math.abs(p2-(20+dt.bar))<0.05,'zoomed-view drag slid the track by one bar ('+(p2-20).toFixed(3)+' s)');
  // Space toggles play even right after clicking a button
  await page.click('#tabSrc');await page.keyboard.press('Space');const sp=await page.evaluate(()=>player.playing);await page.keyboard.press('Space');const sp2=await page.evaluate(()=>player.playing);
  ok(sp&&!sp2,'Space starts and stops playback after a button click');
  // sampler: Outro here → box at the playhead's bar, looping; ×2 doubles; drag moves it by whole bars; the build uses it
  const sm=await page.evaluate(()=>{seekTo(song.firstDB+8*song.bar+0.3);createSample('out');const sp=song.samp.out;return {start:sp.start,bars:sp.bars,len:opt.bed.len,loop:player.loop,playing:player.playing,box:document.getElementById('sampBox').classList.contains('show'),title:document.getElementById('sampTitle').textContent,exp:song.firstDB+8*song.bar};});
  ok(sm.box&&Math.abs(sm.start-sm.exp)<1e-6&&sm.bars===sm.len&&sm.playing&&sm.loop&&Math.abs(sm.loop.b-sm.loop.a-sm.len*dt.bar)<1e-6&&/BAR 9/.test(sm.title),'Outro here: sample box at bar 9, '+sm.len+' bars, looping ('+sm.title+')');
  await page.evaluate(()=>window.scrollTo(0,0));await page.click('#sampBox button[title="Double"]');   // real clicks on the toolbar (it sits inside the scrubbable waveform)
  const sm2=await page.evaluate(()=>({bars:song.samp.out.bars,loopLen:player.loop.b-player.loop.a}));ok(sm2.bars===sm.len*2&&Math.abs(sm2.loopLen-sm.len*2*dt.bar)<1e-6,'×2 doubles the sample to '+sm2.bars+' bars and the loop follows');
  await page.click('#sampBars button:nth-child(3)');const sm3=await page.evaluate(()=>song.samp.out.bars);ok(sm3===4,'clicking the 4-bar button on the toolbar sets 4 bars');
  await page.evaluate(()=>{player.stop();seekTo(song.samp.out.start+song.bar);setZoom(8);});
  const bx=await page.evaluate(()=>{const r=document.getElementById('dtWrap').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,s0:song.samp.out.start};});
  await page.mouse.move(bx.x,bx.y);await page.mouse.down();await page.mouse.move(bx.x+bx.w/4,bx.y,{steps:8});await page.mouse.up();
  const bx2=await page.evaluate(()=>song.samp.out.start);ok(Math.abs(bx2-(bx.s0+2*dt.bar))<1e-6,'dragging the box moved it by 2 bars (zoom 8, quarter width)');
  await page.evaluate(()=>{opt.bed.inOn=false;});await page.click('#buildBtn');await page.waitForFunction(()=>!window.busy,null,{timeout:120000});
  const br=await page.evaluate(()=>({n:result.tl.bedRegions.length,bars:result.tl.bedRegions[0].bars,phrase:result.tl.bedRegions[0].phrase,s:song.samp.out.start}));
  ok(br.n===1&&br.bars===4&&Math.abs(br.phrase-br.s)<1e-9,'build used the sampled phrase (4 bars from the box)');
  await page.evaluate(()=>{setView('src');removeSample(null);opt.bed.inOn=true;});
  // Pro gate: free uses exhausted + not Pro → the sampler opens the upgrade modal; Pro → no modal, PRO badge, no groove tags
  const pg=await page.evaluate(()=>{auth.pro=null;auth.user.user_metadata.extendo_pro_used=5;song.proTried=false;renderAuth();opt.groove.house=3;renderStyles();const tags=document.querySelectorAll('#styleGrid .protag').length;createSample('out');return {modal:document.getElementById('proModal').classList.contains('show'),box:!!(song.samp&&song.samp.out),tags,menu:document.getElementById('umenuPro').textContent};});
  ok(pg.modal&&!pg.box&&pg.tags>0&&/0 free/.test(pg.menu),'no Pro + 0 free uses: sampler opens the upgrade modal, Pro groove tagged ('+pg.tags+' tags, menu: '+pg.menu+')');
  const pr=await page.evaluate(()=>{closeModal('proModal');auth.pro={pro:true,kind:'lifetime'};renderAuth();renderStyles();createSample('out');const r={modal:document.getElementById('proModal').classList.contains('show'),box:!!(song.samp&&song.samp.out),tags:document.querySelectorAll('#styleGrid .protag').length,pill:document.getElementById('authArea').textContent};removeSample(null);player.stop();return r;});
  ok(!pr.modal&&pr.box&&pr.tags===0&&/PRO/.test(pr.pill),'Pro: sampler works, no PRO tags, pill shows PRO');
  await page.evaluate(()=>buildAll());const ba=await page.evaluate(()=>document.getElementById('dlAllBtn').style.display!=='none');ok(ba,'Build all (Pro) with every track built shows Download all');
  await page.evaluate(()=>{auth.pro=null;auth.user.user_metadata.extendo_pro_used=0;renderAuth();renderStyles();});
  await page.evaluate(()=>{if(!gridEdit)toggleGridEdit();});
  await page.setViewportSize({width:1300,height:900});await page.evaluate(()=>{seekTo(song.firstDB+2*song.bar);window.scrollTo(0,0);});await page.screenshot({path:path.join(TMP,'shot_gridedit.png')});
  await page.evaluate(()=>{toggleGridEdit();setView('ext');jumpCue(1);player.stop();seekTo(result.tl.dropT-result.tl.bar);});
  await page.setViewportSize({width:1300,height:900});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(TMP,'shot_deck.png')});
  await page.setViewportSize({width:390,height:800});await page.screenshot({path:path.join(TMP,'shot_mobile.png'),fullPage:true});
  await page.setViewportSize({width:1200,height:900});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(TMP,'shot_desktop.png'),fullPage:true});
  ok(errors.length===0,'no page errors'+(errors.length?': '+errors.join(' | '):''));
  await browser.close();console.log('screenshots in',TMP);console.log(fails?`\n${fails} FAILED`:'\nE2E ALL PASS');process.exit(fails?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
