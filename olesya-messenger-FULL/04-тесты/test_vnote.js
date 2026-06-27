const {JSDOM}=require('jsdom');
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://example.com/',
  beforeParse(w){w.fetch=()=>Promise.reject(new Error('no-net'));w.scrollTo=()=>{};
    if(w.HTMLMediaElement)w.HTMLMediaElement.prototype.play=()=>Promise.resolve();
    w.HTMLElement.prototype.animate=()=>({});w.confirm=()=>true;}});
const w=dom.window, doc=w.document;
const $=s=>doc.querySelector(s);
const click=el=>el&&el.dispatchEvent(new w.Event('click',{bubbles:true}));
const setVal=(el,v)=>{el.value=v;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const vis=id=>{const e=$('#'+id);return !!e&&!e.classList.contains('hidden');};
const shown=id=>{const e=$('#'+id);return !!e&&e.style.display!=='none'&&!e.classList.contains('hidden');};
const R=[];const ok=(n,c)=>{R.push(!!c);console.log((c?'✅':'❌')+' '+n);};
let M;
function vnCount(){let n=0;const d=M.db();Object.values(d.chats||{}).forEach(c=>(c.messages||[]).forEach(m=>{if(m.type==='videonote'&&m.from===M.me.id)n++;}));return n;}
function lastVn(){let last=null;const d=M.db();Object.values(d.chats||{}).forEach(c=>(c.messages||[]).forEach(m=>{if(m.type==='videonote'&&m.from===M.me.id)last=m;}));return last;}

(async()=>{
  await wait(250); M=w.__om;
  ok('vnote button present', !!$('#btnVnote'));
  ok('vnote overlay present', !!$('#vnoteOverlay'));

  // register + open bot chat
  setVal($('#phoneNum'),'9006667788'); click($('#btnSendCode')); await wait(40);
  {const oi=$('#otpInput');oi.focus();setVal(oi,$('#demoCode').textContent);} await wait(50);
  setVal($('#setupName'),'Кружок'); click($('#btnFinish')); await wait(80);
  click([...doc.querySelectorAll('.chat-row')][0]); await wait(60);
  ok('conversation open', vis('scrConv'));

  // 1) open recorder (ready mode, NO auto-record) then press the ● regulator
  click($('#btnVnote')); await wait(300);
  ok('overlay opens in ready mode (no auto-record)', $('#vnoteOverlay').classList.contains('show') && M.recInfo().state==='idle');
  ok('record regulator ● visible', $('#vnRecord').style.display!=='none');
  ok('timer shows limit', /0:30/.test($('#vnoteTime').textContent));
  click($('#vnRecord')); await wait(40);
  ok('recording starts only after ● pressed', M.recInfo().state==='recording' && M.recInfo().kind==='video');
  ok('overlay shown', $('#vnoteOverlay').classList.contains('show'));
  await wait(700);

  // 2) incoming call interrupts -> paused, video preserved
  M.bus({type:'call:invite',tab:'other',eid:'vc1',from:'callerY',payload:{to:M.me.id,from:'callerY',name:'Caller',kind:'audio'}});
  await wait(40);
  ok('call → video PAUSED (not lost)', M.recInfo().state==='paused' && M.recInfo().kind==='video');
  ok('elapsed preserved (>0.6s)', M.recInfo().accum>0.6);
  ok('overlay hidden during call', !$('#vnoteOverlay').classList.contains('show'));

  // 3) end call -> draft bar labelled as video note
  M.endCall(); await wait(50);
  ok('draft bar visible', shown('voiceDraft'));
  ok('draft labelled as video note', /Видео-кружок/.test($('#vdLabel').textContent) && $('#vdIcon').textContent==='🎥');

  // 4) resume -> overlay back, still video
  click($('#vdResume')); await wait(40);
  ok('resumed video recording', M.recInfo().state==='recording' && M.recInfo().kind==='video');
  ok('overlay shown again', $('#vnoteOverlay').classList.contains('show'));
  await wait(500);

  // 5) send from overlay -> one combined videonote message
  const before=vnCount();
  click($('#vnSend')); await wait(180);
  ok('videonote message sent', vnCount()===before+1);
  const m=lastVn();
  ok('combined duration kept (>=1s)', m && m.dur>=1);
  ok('state idle, overlay closed', M.recInfo().state==='idle' && !$('#vnoteOverlay').classList.contains('show'));
  ok('composer restored', shown('composer'));

  // 6) render: round bubble with stub (no camera in jsdom) + duration badge
  const vn=[...doc.querySelectorAll('.row.me .vnote-msg')];
  ok('round video-note element rendered', vn.length===1);
  ok('transparent bubble class applied', !!doc.querySelector('.row.me .bubble.vnote-b'));
  ok('duration badge rendered', !!doc.querySelector('.row.me .vnote-msg .vn-dur'));
  ok('no-camera stub rendered (jsdom)', !!doc.querySelector('.row.me .vnote-msg .vn-stub'));

  // 7) bot reacts to the circle
  await wait(2600);
  ok('bot replied about the circle', [...doc.querySelectorAll('.row.them .bubble')].some(b=>/кружок/i.test(b.textContent)));
  ok('chat list preview shows 🎥 or bot text', [...doc.querySelectorAll('.chat-row')].some(r=>/🎥|кружок/i.test(r.textContent)));

  // 8) cancel path: open -> record (●) -> cancel -> nothing sent
  const b2=vnCount();
  click($('#btnVnote')); await wait(300);
  click($('#vnRecord')); await wait(60);
  ok('cancel: recording started after ●', M.recInfo().state==='recording');
  click($('#vnCancel')); await wait(40);
  ok('cancel → idle', M.recInfo().state==='idle');
  ok('cancel → no message added', vnCount()===b2);

  // 9) draft protection: paused draft blocks a new recording for same peer
  click($('#btnVnote')); await wait(300); click($('#vnRecord')); await wait(350);
  M.bus({type:'call:invite',tab:'other',eid:'vc2',from:'callerY',payload:{to:M.me.id,from:'callerY',name:'Caller',kind:'audio'}});
  await wait(40); M.endCall(); await wait(50);
  click($('#btnVnote')); await wait(300);
  ok('new recording blocked while draft exists', M.recInfo().state==='paused');
  click($('#vdCancel')); await wait(40);
  ok('draft discarded → idle', M.recInfo().state==='idle');

  // 10) double-tap the circle button cycles the shape (circle→heart→sun) without recording
  const sh0=M.vnoteShape;
  click($('#btnVnote')); click($('#btnVnote')); await wait(90);
  ok('double-tap switches shape, no recording', M.vnoteShape!==sh0 && M.recInfo().state==='idle');
  const sh1=M.vnoteShape;
  click($('#btnVnote')); click($('#btnVnote')); await wait(90);
  ok('double-tap cycles shape again', M.vnoteShape!==sh1 && M.recInfo().state==='idle');

  const pass=R.filter(Boolean).length,tot=R.length;
  console.log('\n'+pass+'/'+tot+' passed');
  setTimeout(()=>process.exit(pass===tot?0:1),40);
})().catch(e=>{console.error('FATAL',e&&e.stack||e);process.exit(2);});
