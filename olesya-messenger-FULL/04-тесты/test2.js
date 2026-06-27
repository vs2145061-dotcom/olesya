const {JSDOM}=require('jsdom');
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://example.com/',
  beforeParse(w){
    w.fetch=()=>Promise.reject(new Error('no-net'));     // force translation dictionary fallback
    w.scrollTo=()=>{};
    if(w.HTMLMediaElement) w.HTMLMediaElement.prototype.play=()=>Promise.resolve();
    w.HTMLElement.prototype.animate=()=>({});
    w.confirm=()=>true;
  }});
const w=dom.window, doc=w.document;
const $=s=>doc.querySelector(s);
const click=el=>el&&el.dispatchEvent(new w.Event('click',{bubbles:true}));
const setVal=(el,v)=>{el.value=v;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const vis=id=>{const e=$('#'+id);return !!e&&!e.classList.contains('hidden');};
const R=[]; const ok=(n,c)=>{R.push(!!c);console.log((c?'✅':'❌')+' '+n);};

(async()=>{
  await wait(250);
  const M=w.__om;
  ok('boot → phone screen', vis('scrPhone'));
  ok('__om hooks exposed', M&&typeof M.translate==='function');

  ok('detectLang ru', M.detectLang('привет как дела')==='ru');
  ok('detectLang ar', M.detectLang('مرحبا كيف حالك')==='ar');
  ok('detectLang zh', M.detectLang('你好吗 朋友')==='zh');
  ok('detectLang uz', M.detectLang("salom qalaysiz, juda yaxshi")==='uz');
  ok('detectLang en', M.detectLang('hello how are you today')==='en');

  const t1=await M.translate('привет','en'); ok('translate привет→en = hello', t1&&t1.text==='hello');
  const t2=await M.translate('rahmat','ru'); ok('translate rahmat→ru = спасибо', t2&&t2.text==='спасибо');
  const s1=await M.sha('x'), s2=await M.sha('x'); ok('sha deterministic', s1===s2&&s1.length>3);

  // register (local)
  setVal($('#phoneNum'),'9001234567'); click($('#btnSendCode')); await wait(60);
  ok('otp screen', vis('scrOtp'));
  const code=$('#demoCode').textContent;
  {const oi=$('#otpInput');oi.focus();oi.value=code;oi.dispatchEvent(new w.Event('input',{bubbles:true}));}
  await wait(60);
  ok('setup screen', vis('scrSetup'));
  setVal($('#setupName'),'Тестер'); click($('#btnFinish')); await wait(100);
  ok('entered app (home)', vis('scrHome'));
  ok('me created', M.me&&M.me.name==='Тестер');

  // inject incoming from human peer spamX (creates user+chat)
  M.setTrCfg('spamX',{auto:true,target:'ru'});      // auto-translate incoming → ru
  M.bus({type:'msg',tab:'other',eid:'m-1',from:'spamX',payload:{to:M.me.id,from:'spamX',id:'mX1',type:'text',text:'rahmat',t:Date.now()}});
  await wait(60);
  // open the spamX chat
  let opened=false;
  for(const r of [...doc.querySelectorAll('.chat-row')]){click(r);await wait(50);
    if([...doc.querySelectorAll('.row.them .bubble')].some(b=>/rahmat/.test(b.textContent))){opened=true;break;}}
  ok('incoming message visible', opened);
  await wait(80);
  ok('auto-translate спасибо shown', [...doc.querySelectorAll('.tr-block')].some(x=>/спасибо/.test(x.textContent)));

  // outgoing translation: set out=en for spamX, send привет
  M.setTrCfg('spamX',{auto:true,target:'ru',out:'en'});
  setVal($('#msgInput'),'привет');
  $('#msgInput').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  await wait(160);
  const mine=[...doc.querySelectorAll('.row.me .bubble')];
  const last=mine[mine.length-1];
  ok('outgoing sent as hello', last&&/hello/.test(last.textContent));
  ok('original preserved (ваш текст)', last&&/привет/.test(last.textContent));

  // manual per-message translate via 🌐 in react menu (inject english incoming, click bubble, click globe)
  M.setTrCfg('spamX',{});  // disable auto so manual is the trigger
  M.bus({type:'msg',tab:'other',eid:'m-2',from:'spamX',payload:{to:M.me.id,from:'spamX',id:'mX2',type:'text',text:'hello',t:Date.now()}});
  await wait(60);
  // ensure spamX chat open
  for(const r of [...doc.querySelectorAll('.chat-row')]){click(r);await wait(40);
    if([...doc.querySelectorAll('.row.them .bubble')].some(b=>b.textContent.trim().startsWith('hello'))){break;}}
  const helloBub=[...doc.querySelectorAll('.row.them .bubble')].find(b=>b.textContent.trim().startsWith('hello'));
  click(helloBub); await wait(40);
  const globe=[...doc.querySelectorAll('.react-menu button')].find(b=>b.textContent==='🌐');
  ok('globe button in react menu', !!globe);
  if(globe){click(globe);await wait(120);}
  // my lang is ru (default) → hello→привет
  ok('manual translate привет shown', [...doc.querySelectorAll('.tr-block')].some(x=>/привет/.test(x.textContent)));

  // anti-spam: 5 rapid invites from spamX
  for(let i=0;i<5;i++){
    M.bus({type:'call:invite',tab:'other',eid:'inv-'+i,from:'spamX',payload:{to:M.me.id,from:'spamX',name:'Spam',kind:'audio'}});
    await wait(15);
    M.bus({type:'call:end',tab:'other',eid:'ce-'+i,from:'spamX',payload:{to:M.me.id,from:'spamX'}});
    await wait(15);
  }
  const log=JSON.parse(w.localStorage.getItem('om_log_'+M.me.id)||'[]');
  ok('anti-spam event logged', log.some(x=>/Анти-спам/.test(x.text)));
  ok('spamX auto temp-blocked', !!(M.getSec().tmp&&M.getSec().tmp.spamX>Date.now()));

  // sessions
  ok('session registered', Object.keys(M.sessionsMap()).length>=1 && !!M.sessionsMap()[M.TAB]);

  // 2FA enable (local)
  click($('#btnSettings')); await wait(30);
  click($('#rowTwoFA')); await wait(30);
  const ins=[...doc.querySelectorAll('#subBody input')];
  ok('2FA form rendered', ins.length>=2);
  if(ins.length>=2){ins[0].value='1234';ins[1].value='1234';
    click([...doc.querySelectorAll('#subBody button')].find(b=>/Включить/.test(b.textContent))); await wait(90);}
  ok('2FA enabled', !!(M.me.twoFA&&M.me.twoFA.hash));

  const pass=R.filter(Boolean).length, tot=R.length;
  console.log('\n'+pass+'/'+tot+' passed');
  setTimeout(()=>process.exit(pass===tot?0:1),40);
})().catch(e=>{console.error('FATAL',e&&e.stack||e);process.exit(2);});
