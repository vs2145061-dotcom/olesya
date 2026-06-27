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

(async()=>{
  await wait(250);
  ok('OTP is a single visible input', !!$('#otpInput') && $('#otpInput').classList.contains('otp-bigfield'));
  ok('Confirm button present', !!$('#btnVerifyOtp'));
  ok('Fill-code button present', !!$('#btnFillOtp'));
  ok('no leftover boxes', doc.querySelectorAll('.otp-box').length===0);

  // --- A) type full code -> auto verify ---
  setVal($('#phoneNum'),'9001230001'); click($('#btnSendCode')); await wait(40);
  ok('on OTP screen', vis('scrOtp'));
  let real=$('#demoCode').textContent;
  setVal($('#otpInput'), real); await wait(40);
  ok('A: typed full code → setup', vis('scrSetup'));
  setVal($('#setupName'),'Аня'); click($('#btnFinish')); await wait(70);
  ok('A: registered', vis('scrHome'));

  // --- B) wrong then Confirm button ---
  click($('#btnSettings')); await wait(15); click($('#btnLogout')); await wait(30);
  setVal($('#phoneNum'),'9001230002'); click($('#btnSendCode')); await wait(30);
  real=$('#demoCode').textContent;
  const wrong = real==='123456'?'654321':'123456';
  $('#otpInput').value=wrong; click($('#btnVerifyOtp')); await wait(30);
  ok('B: wrong code via button rejected (stay OTP)', vis('scrOtp'));
  ok('B: input cleared after wrong', $('#otpInput').value==='');
  $('#otpInput').value=real; click($('#btnVerifyOtp')); await wait(40);
  ok('B: correct via Confirm button → setup', vis('scrSetup'));

  // --- C) "подставить" fill button ---
  // go back to a fresh OTP
  click(doc.querySelector('[data-back="scrPhone"]')); await wait(20);
  setVal($('#phoneNum'),'9001230003'); click($('#btnSendCode')); await wait(30);
  real=$('#demoCode').textContent;
  click($('#btnFillOtp')); await wait(40);
  ok('C: fill button filled exact code', $('#otpInput').value===real || vis('scrSetup'));
  ok('C: fill → auto-verified to setup', vis('scrSetup'));

  // --- D) formatting tolerance (spaces) ---
  click(doc.querySelector('[data-back="scrPhone"]')); await wait(20);
  setVal($('#phoneNum'),'9001230004'); click($('#btnSendCode')); await wait(30);
  real=$('#demoCode').textContent;
  // simulate keyboard inserting spaces/dashes
  setVal($('#otpInput'), real[0]+' '+real[1]+real[2]+'-'+real.slice(3)); await wait(40);
  ok('D: code with spaces/dashes still accepted', vis('scrSetup'));

  // --- E) resend invalidates old ---
  click($('#btnSettings')); await wait(15); click($('#btnLogout')); await wait(30);
  setVal($('#phoneNum'),'9001230005'); click($('#btnSendCode')); await wait(30);
  const old=$('#demoCode').textContent;
  click($('#btnResend')); await wait(30);
  const fresh=$('#demoCode').textContent;
  $('#otpInput').value=old; click($('#btnVerifyOtp')); await wait(30);
  ok('E: old code after resend rejected', vis('scrOtp')||old===fresh);
  setVal($('#otpInput'), fresh); await wait(40);
  ok('E: new code accepted', vis('scrSetup')||vis('scrChats')||vis('scrHome'));

  const pass=R.filter(Boolean).length,tot=R.length;
  console.log('\n'+pass+'/'+tot+' passed');
  setTimeout(()=>process.exit(pass===tot?0:1),40);
})().catch(e=>{console.error('FATAL',e&&e.stack||e);process.exit(2);});
