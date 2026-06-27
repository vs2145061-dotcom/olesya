const {JSDOM}=require('jsdom');
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const FAKE={data:[
  {title:'cat',images:{fixed_width_small:{url:'https://media.giphy.com/a-s.gif'},downsized_medium:{url:'https://media.giphy.com/a.gif'}}},
  {title:'dog',images:{fixed_width_small:{url:'https://media.giphy.com/b-s.gif'},downsized_medium:{url:'https://media.giphy.com/b.gif'}}},
  {title:'fox',images:{fixed_width_small:{url:'https://media.giphy.com/c-s.gif'},downsized_medium:{url:'https://media.giphy.com/c.gif'}}}
]};
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://example.com/',
  beforeParse(w){
    w.fetch=(url)=>{ if(String(url).indexOf('api.giphy.com')>=0)
        return Promise.resolve({ok:true,json:()=>Promise.resolve(FAKE)});
      return Promise.reject(new Error('no-net')); };
    w.scrollTo=()=>{}; if(w.HTMLMediaElement)w.HTMLMediaElement.prototype.play=()=>Promise.resolve();
    w.HTMLElement.prototype.animate=()=>({}); w.confirm=()=>true;}});
const w=dom.window, doc=w.document;
const $=s=>doc.querySelector(s);
const click=el=>el&&el.dispatchEvent(new w.Event('click',{bubbles:true}));
const setVal=(el,v)=>{el.value=v;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const vis=id=>{const e=$('#'+id);return !!e&&!e.classList.contains('hidden');};
const R=[];const ok=(n,c)=>{R.push(!!c);console.log((c?'✅':'❌')+' '+n);};

(async()=>{
  await wait(250);
  const M=w.__om;
  ok('GIF button present', !!$('#btnGif'));
  ok('GIF panel present', !!$('#gifPanel'));
  ok('default demo GIPHY key', M.gifKey()==='dc6zaTOxFJmzC');

  // register
  setVal($('#phoneNum'),'9001112233'); click($('#btnSendCode')); await wait(40);
  const code=$('#demoCode').textContent;
  {const oi=$('#otpInput');oi.focus();setVal(oi,code);} await wait(50);
  setVal($('#setupName'),'Гифер'); click($('#btnFinish')); await wait(80);
  ok('registered → home', vis('scrHome'));

  // open bot chat
  const rows=[...doc.querySelectorAll('.chat-row')]; click(rows[0]); await wait(60);
  ok('conversation open', vis('scrConv'));

  // open GIF panel -> trending search runs
  click($('#btnGif')); await wait(120);
  ok('GIF panel shown', $('#gifPanel').classList.contains('show'));
  ok('GIF results loaded (trending)', doc.querySelectorAll('#gifGrid img').length===3);

  // search by query
  setVal($('#gifQuery'),'cat'); await wait(450);
  ok('GIF search-by-query populated', doc.querySelectorAll('#gifGrid img').length===3);

  // pick a GIF -> sent as message
  click(doc.querySelector('#gifGrid img')); await wait(80);
  const gifBub=[...doc.querySelectorAll('.row.me .bubble img.gif')];
  ok('GIF sent → bubble with gif image', gifBub.length===1);
  ok('GIF url points to internet', gifBub[0] && /giphy\.com/.test(gifBub[0].src));
  ok('GIF tag shown', !!doc.querySelector('.row.me .bubble .gif-tag'));
  ok('panel closed after send', !$('#gifPanel').classList.contains('show'));

  // emoji toggle closes gif panel and vice versa
  click($('#btnGif')); await wait(40); click($('#btnEmoji')); await wait(20);
  ok('emoji closes gif panel', !$('#gifPanel').classList.contains('show'));

  // settings: custom key save + reset
  M.setGifKey('MYKEY123'); ok('custom key stored', w.localStorage.getItem('om_gifkey')==='MYKEY123' && M.gifKey()==='MYKEY123');
  M.setGifKey(''); ok('reset to demo key', !w.localStorage.getItem('om_gifkey') && M.gifKey()==='dc6zaTOxFJmzC');

  const pass=R.filter(Boolean).length,tot=R.length;
  console.log('\n'+pass+'/'+tot+' passed');
  setTimeout(()=>process.exit(pass===tot?0:1),40);
})().catch(e=>{console.error('FATAL',e&&e.stack||e);process.exit(2);});
