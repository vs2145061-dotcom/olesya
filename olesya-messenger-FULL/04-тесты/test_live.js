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
const R=[];const ok=(n,c)=>{R.push(!!c);console.log((c?'✅':'❌')+' '+n);};
let M;

(async()=>{
  await wait(250); M=w.__om;
  ok('live panel present', !!$('#livePanel'));
  ok('speech button present (hidden by default)', !!$('#btnSpeech') && $('#btnSpeech').style.display==='none');

  // register
  setVal($('#phoneNum'),'9008889900'); click($('#btnSendCode')); await wait(40);
  {const oi=$('#otpInput');oi.focus();setVal(oi,$('#demoCode').textContent);} await wait(50);
  setVal($('#setupName'),'Лайв'); click($('#btnFinish')); await wait(80);

  // create a human peer chat via injected incoming message, then open it
  M.bus({type:'msg',tab:'other',eid:'lm1',from:'liveX',payload:{to:M.me.id,from:'liveX',id:'lx1',type:'text',text:'hello',t:Date.now()}});
  await wait(60);
  let opened=false;
  for(const r of [...doc.querySelectorAll('.chat-row')]){click(r);await wait(45);
    if([...doc.querySelectorAll('.row.them .bubble')].some(b=>b.textContent.trim().startsWith('hello'))){opened=true;break;}}
  ok('peer chat open', opened && vis('scrConv'));
  ok('live panel hidden while off', !$('#livePanel').classList.contains('show'));

  // enable interpreter ru→en for this chat
  M.setTrCfg('liveX',{live:true,out:'en'});
  M.refreshLivePanel(); await wait(20);
  ok('live panel shown when enabled', $('#livePanel').classList.contains('show'));
  ok('target language tag = EN', $('#liveTag').textContent==='EN');
  ok('idle placeholder while empty', $('#liveText').classList.contains('idle'));
  ok('speech button stays hidden (no API in jsdom)', $('#btnSpeech').style.display==='none');

  // type Russian → live English translation appears synchronously
  setVal($('#msgInput'),'привет'); await wait(650);
  ok('LIVE translation appears while typing (привет→hello)', $('#liveText').textContent==='hello');

  // typing more updates the live line (dictionary: спасибо→thank you)
  setVal($('#msgInput'),'спасибо'); await wait(650);
  ok('live line updates with input (спасибо→thank you)', /thank you/i.test($('#liveText').textContent));

  // send -> message goes out TRANSLATED with original kept
  setVal($('#msgInput'),'привет');
  await wait(450);
  $('#msgInput').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  await wait(250);
  const mine=[...doc.querySelectorAll('.row.me .bubble')];
  const last=mine[mine.length-1];
  ok('sent message is the translation (hello)', last && /hello/.test(last.textContent));
  ok('original привет kept under the message', last && /привет/.test(last.textContent));
  ok('live line back to idle after send', $('#liveText').classList.contains('idle'));

  // chat settings contain the interpreter toggle as first switch; toggling works both ways
  click($('#btnChatSettings')); await wait(40);
  ok('settings show interpreter section', /Синхронный переводчик/.test($('#subBody').textContent));
  const sw=$('#subBody .switch');
  ok('toggle is ON now', sw && sw.classList.contains('on'));
  click(sw); await wait(30);
  ok('toggle OFF → cfg.live=false', M.trCfgFor('liveX').live===false);
  ok('panel hidden after toggle off', !$('#livePanel').classList.contains('show'));
  click($('#subBody .switch')); await wait(30);
  ok('toggle ON again → cfg.live=true', M.trCfgFor('liveX').live===true);
  ok('panel shown again', $('#livePanel').classList.contains('show'));

  // live requires a target language: out=null hides the panel
  M.setTrCfg('liveX',{live:true,out:null}); M.refreshLivePanel(); await wait(20);
  ok('panel hidden when no target language', !$('#livePanel').classList.contains('show'));

  const pass=R.filter(Boolean).length,tot=R.length;
  console.log('\n'+pass+'/'+tot+' passed');
  setTimeout(()=>process.exit(pass===tot?0:1),40);
})().catch(e=>{console.error('FATAL',e&&e.stack||e);process.exit(2);});
