const {JSDOM}=require('jsdom');
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://example.com/',
  beforeParse(w){w.fetch=()=>Promise.reject(new Error('no-net'));w.scrollTo=()=>{};
    if(w.HTMLMediaElement)w.HTMLMediaElement.prototype.play=()=>Promise.resolve();
    w.HTMLElement.prototype.animate=()=>({});w.confirm=()=>true;}});
const w=dom.window, doc=w.document;
const $=s=>doc.querySelector(s);
const $$=s=>[...doc.querySelectorAll(s)];
const click=el=>el&&el.dispatchEvent(new w.Event('click',{bubbles:true}));
const ctx=el=>el&&el.dispatchEvent(new w.Event('contextmenu',{bubbles:true,cancelable:true}));
const setVal=(el,v)=>{el.value=v;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
const enter=el=>el.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const vis=id=>{const e=$('#'+id);return !!e&&!e.classList.contains('hidden');};
const R=[];const ok=(n,c)=>{R.push(!!c);console.log((c?'✅':'❌')+' '+n);};
let M;
const menuBtn=t=>$$('.react-menu button').find(b=>b.title===t)||null;
const savedKey=()=>[M.me.id,M.me.id].sort().join('__');
const savedMsgs=()=>((M.db().chats[savedKey()]||{}).messages)||[];
const openSaved=()=>click($('#favEntry'));
const openBotChat=()=>{const r=$$('.chat-row').find(r=>!/Избранное/.test(r.textContent));click(r);};

(async()=>{
  await wait(250); M=w.__om;
  ok('Saved entry present in chat list', !!$('#favEntry'));
  ok('forward sheet present', !!$('#fwdSheet'));

  // register
  setVal($('#phoneNum'),'9001112233'); click($('#btnSendCode')); await wait(40);
  {const oi=$('#otpInput');oi.focus();setVal(oi,$('#demoCode').textContent);} await wait(50);
  setVal($('#setupName'),'Сейв'); click($('#btnFinish')); await wait(80);

  // 1) Saved messages chat
  openSaved(); await wait(60);
  ok('Saved chat opens', vis('scrConv') && $('#convName').textContent==='Избранное');
  ok('status describes saved messages', /сохранённые/.test($('#convStatus').textContent));
  ok('call buttons hidden in Saved', $('#btnAudioCall').style.display==='none' && $('#btnVideoCall').style.display==='none');
  setVal($('#msgInput'),'моя заметка'); enter($('#msgInput')); await wait(150);
  ok('note written to Saved', $$('.row.me .bubble').some(b=>/моя заметка/.test(b.textContent)));
  ok('Saved row appears in chat list', $$('.chat-row').some(r=>/Избранное/.test(r.textContent)));

  // 2) save someone else's TEXT to favourites via context menu
  openBotChat(); await wait(60);
  setVal($('#msgInput'),'привет'); enter($('#msgInput')); await wait(2400);
  const them=$$('.row.them .bubble');
  ok('bot message exists', them.length>0);
  ctx(them[them.length-1]); await wait(30);
  ok('context-menu opens on a text bubble', !!$('.react-menu'));
  ok('menu has Forward / Save / Copy', !!menuBtn('Переслать') && !!menuBtn('В Избранное') && !!menuBtn('Копировать текст'));
  const sBefore=savedMsgs().length;
  click(menuBtn('В Избранное')); await wait(150);
  ok('menu closed after action', !$('.react-menu'));
  const sm=savedMsgs();
  ok('bot text saved to favourites', sm.length===sBefore+1 && !!sm[sm.length-1].text);
  ok('forward label (origin author) attached', !!(sm[sm.length-1].fwd&&sm[sm.length-1].fwd.n));
  openSaved(); await wait(60);
  ok('«Переслано от» rendered in Saved', $$('#msgs .fwd').some(f=>/Переслано от/.test(f.textContent)));

  // 3) FORWARD own text from Saved to the bot chat
  const noteB=$$('.row.me .bubble').find(b=>/моя заметка/.test(b.textContent));
  ctx(noteB); await wait(30);
  click(menuBtn('Переслать')); await wait(40);
  ok('forward sheet shown', $('#fwdSheet').classList.contains('show'));
  const rows=$$('#fwdList .fwd-row');
  ok('targets listed (Saved + bot)', rows.length>=2 && /Избранное/.test(rows[0].textContent));
  const botRow=rows.find(r=>!/Избранное/.test(r.textContent));
  click(botRow); await wait(150);
  ok('sheet closed after pick', !$('#fwdSheet').classList.contains('show'));
  openBotChat(); await wait(80);
  const fwdNote=$$('.row.me .bubble').find(b=>/моя заметка/.test(b.textContent));
  ok('text forwarded into bot chat', !!fwdNote);
  ok('forwarded label shows MY name', !!fwdNote && /Переслано от Сейв/.test(fwdNote.textContent));

  // 4) VIDEO-NOTE: open recorder, press ● to record, then save the circle to favourites
  click($('#btnVnote')); await wait(300); click($('#vnRecord')); await wait(750); click($('#vnSend')); await wait(250);
  const vb=$('.bubble.vnote-b');
  ok('video-note bubble exists', !!vb);
  ctx(vb); await wait(30);
  ok('context-menu works on video-note', !!$('.react-menu') && !!menuBtn('В Избранное'));
  ok('no download for demo circle (src=null)', !menuBtn('Скачать кружок'));
  const vBefore=savedMsgs().filter(m=>m.type==='videonote').length;
  click(menuBtn('В Избранное')); await wait(150);
  ok('video-note saved to favourites', savedMsgs().filter(m=>m.type==='videonote').length===vBefore+1);
  openSaved(); await wait(80);
  const savedVn=$$('#msgs .bubble.vnote-b');
  ok('circle rendered in Saved with fwd label', savedVn.length>=1 && savedVn.some(b=>b.querySelector('.fwd')));

  // 5) VOICE: record via API, save to favourites
  openBotChat(); await wait(60);
  M.startRec(); await wait(700); M.stopRec(true); await wait(250);
  const lastMine=$$('.row.me .bubble').pop();
  ctx(lastMine); await wait(30);
  const vcBefore=savedMsgs().filter(m=>m.type==='voice').length;
  click(menuBtn('В Избранное')); await wait(150);
  ok('voice message saved to favourites', savedMsgs().filter(m=>m.type==='voice').length===vcBefore+1);

  // 6) COPY action does not crash (no clipboard in jsdom → fallback path)
  openSaved(); await wait(60);
  const nb=$$('.row.me .bubble').find(b=>/моя заметка/.test(b.textContent));
  ctx(nb); await wait(30);
  click(menuBtn('Копировать текст')); await wait(50);
  ok('copy action handled gracefully', !$('.react-menu'));

  const pass=R.filter(Boolean).length,tot=R.length;
  console.log('\n'+pass+'/'+tot+' passed');
  setTimeout(()=>process.exit(pass===tot?0:1),40);
})().catch(e=>{console.error('FATAL',e&&e.stack||e);process.exit(2);});
