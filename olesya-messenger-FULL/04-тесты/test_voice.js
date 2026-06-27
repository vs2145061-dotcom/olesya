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
const md=el=>el&&el.dispatchEvent(new w.Event('mousedown',{bubbles:true}));
const setVal=(el,v)=>{el.value=v;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const vis=id=>{const e=$('#'+id);return !!e&&!e.classList.contains('hidden');};
const shown=id=>{const e=$('#'+id);return !!e&&e.style.display!=='none'&&!e.classList.contains('hidden');};
const R=[];const ok=(n,c)=>{R.push(!!c);console.log((c?'✅':'❌')+' '+n);};
let M;
function voiceCount(){let n=0;const d=M.db();Object.values(d.chats||{}).forEach(c=>(c.messages||[]).forEach(m=>{if(m.type==='voice'&&m.from===M.me.id)n++;}));return n;}

(async()=>{
  await wait(250); M=w.__om;
  // register + open bot chat
  setVal($('#phoneNum'),'9004445566'); click($('#btnSendCode')); await wait(40);
  {const oi=$('#otpInput');oi.focus();setVal(oi,$('#demoCode').textContent);} await wait(50);
  setVal($('#setupName'),'Голос'); click($('#btnFinish')); await wait(80);
  click([...doc.querySelectorAll('.chat-row')][0]); await wait(60);
  ok('conversation open', vis('scrConv'));
  ok('mic button present', !!$('#btnMic'));
  const before=voiceCount();

  // 1) start recording
  md($('#btnMic')); await wait(30);
  ok('recording started', M.recInfo().state==='recording' && $('#recBar').classList.contains('show'));
  await wait(700);

  // 2) incoming call interrupts -> pause, message preserved (not deleted)
  M.bus({type:'call:invite',tab:'other',eid:'civ1',from:'callerX',payload:{to:M.me.id,from:'callerX',name:'Caller',kind:'audio'}});
  await wait(40);
  ok('call → recording PAUSED (not lost)', M.recInfo().state==='paused');
  ok('elapsed preserved (>0.6s)', M.recInfo().accum>0.6);
  ok('recBar hidden during call', !$('#recBar').classList.contains('show'));

  // 3) end the call -> draft bar appears
  M.endCall(); await wait(50);
  ok('back to conversation', vis('scrConv'));
  ok('paused-voice DRAFT bar visible', shown('voiceDraft'));
  ok('draft shows elapsed time', $('#vdTime').textContent!=='0:00');
  ok('still paused after call', M.recInfo().state==='paused');

  // 4) resume recording
  click($('#vdResume')); await wait(40);
  ok('resumed → recording again', M.recInfo().state==='recording' && $('#recBar').classList.contains('show'));
  ok('send button visible in resume mode', $('#recSend').style.display==='grid');
  await wait(500);

  // 5) finish & send -> one combined voice message
  click($('#recSend')); await wait(150);
  ok('voice message SENT', voiceCount()===before+1);
  const d=M.db();let last=null;Object.values(d.chats).forEach(c=>(c.messages||[]).forEach(m=>{if(m.type==='voice'&&m.from===M.me.id)last=m;}));
  ok('combined duration kept (>=1s)', last && last.dur>=1);
  ok('state back to idle', M.recInfo().state==='idle');
  ok('composer restored', shown('composer'));
  ok('draft hidden after send', !shown('voiceDraft'));

  // 6) discard path: record -> call -> end -> discard draft (no message)
  const before2=voiceCount();
  md($('#btnMic')); await wait(700);
  M.bus({type:'call:invite',tab:'other',eid:'civ2',from:'callerX',payload:{to:M.me.id,from:'callerX',name:'Caller',kind:'audio'}});
  await wait(40); M.endCall(); await wait(50);
  ok('draft visible again', shown('voiceDraft'));
  click($('#vdCancel')); await wait(40);
  ok('discard → idle', M.recInfo().state==='idle');
  ok('discard → no message added', voiceCount()===before2);
  ok('discard → composer restored', shown('composer'));

  const pass=R.filter(Boolean).length,tot=R.length;
  console.log('\n'+pass+'/'+tot+' passed');
  setTimeout(()=>process.exit(pass===tot?0:1),40);
})().catch(e=>{console.error('FATAL',e&&e.stack||e);process.exit(2);});
