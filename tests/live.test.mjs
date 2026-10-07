import assert from 'node:assert/strict';
import { createLiveDesk } from '../live.js';
import { TEAM_IDS, defaultState, matchTeams } from '../model.js';
import { makeClock, startClock } from '../timer-model.js';

// Exercise the desk's public event handlers with real scoring/timer models.
// The DOM fixture only provides the elements used by those handlers.
class Surface {
  constructor(dataset={}) {
    this.dataset=dataset;this.listeners=new Map();this.hidden=false;this.open=false;this.disabled=false;
    this.style={removeProperty(name){delete this[name];}};this.attributes={};
    this.classList={add(){},remove(){},toggle(){}};
  }
  addEventListener(type,fn,options=false) {
    const listeners=this.listeners.get(type)||[];
    listeners.push({fn,capture:options===true||Boolean(options.capture)});this.listeners.set(type,listeners);
  }
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(listener=>listener.fn!==fn));}
  setAttribute(name,value){this.attributes[name]=value;}
  getBoundingClientRect(){return {left:0,top:0,width:100,height:50,right:100,bottom:50};}
  hasPointerCapture(){return false;}
  close(){this.open=false;}
  querySelector(){return null;}
  querySelectorAll(){return [];}
  contains(){return false;}
}

async function fixture(fn) {
  const globals=['document','window','innerWidth','innerHeight','setInterval'];
  const saved=new Map(globals.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const originalNow=Date.now;let now=1000,saves=0,refreshes=0;const messages=[];
  const document=new Surface(),window=new Surface();
  const elements=Object.fromEntries(['#timer-float','#active-timer','#live-dialog','#hide-timer','#timer-dropzone','#live-dropzone','#close-live'].map(selector=>[selector,new Surface()]));
  document.querySelector=selector=>elements[selector];document.querySelectorAll=()=>[];
  Object.assign(globalThis,{document,window,innerWidth:1000,innerHeight:700,setInterval:()=>1});Date.now=()=>now;
  const state=defaultState(),schedule=Array.from({length:16},(_,i)=>({title:'Event '+i,durationMinutes:1}));
  const desk=new Surface(),status=new Surface();
  desk.querySelector=selector=>selector==='[data-live-status]'?status:null;
  const control=(index,dataset={},value='')=>{
    desk.dataset.liveEvent=String(index);
    const node=new Surface(dataset);node.value=value;node.validity={valid:true};
    node.closest=selector=>selector==='[data-live-event]'?desk:
      selector.split(',').some(item=>Object.keys(dataset).some(key=>'[data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())+']'===item))?node:null;
    node.matches=selector=>Object.keys(dataset).some(key=>'[data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())+']'===selector);
    return node;
  };
  const emit=async(type,node)=>{
    const event={type,target:node,detail:0,preventDefault(){},stopImmediatePropagation(){}};
    for(const {fn} of [...(document.listeners.get(type)||[])].sort((a,b)=>Number(b.capture)-Number(a.capture)))await fn(event);
  };
  const live=createLiveDesk({getState:()=>state,schedule,esc:value=>String(value),dot:()=>'',teamLabel:id=>id,
    save:()=>saves++,refresh:()=>refreshes++,toast:message=>messages.push(message),recordWinner:()=>false,
    confirmChange:async()=>true,openPanel(){},saved:()=>true});
  const start=(key,seconds=30,signature='')=>{
    state.timers[key]=makeClock(seconds,signature);startClock(state.timers,key,now);state.activeKey=key;return state.timers[key];
  };
  try{await fn({state,live,control,emit,start,desk,messages,advance:ms=>now+=ms,saves:()=>saves,refreshes:()=>refreshes});}
  finally{Date.now=originalNow;for(const [name,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}
}

const tests=[];
async function test(name,fn){try{await fixture(fn);tests.push({name,pass:true});}catch(error){tests.push({name,pass:false,error:error.stack});}}

await test('A ball count is saved while typing, before blur or expiry can replace the input',async({state,emit,control,start,saves,refreshes})=>{
  start('basket:red:0');
  await emit('input',control(5,{liveScore:''},'7'));
  assert.equal(state.basket.scores[0][0],7);assert.equal(saves(),1);
  assert.equal(refreshes(),0,'Typing must keep the input and caret in place.');
});

await test('Expiry preserves the count typed in the active attempt',async({state,live,emit,control,start,advance})=>{
  start('basket:red:0',1);
  await emit('input',control(5,{liveScore:''},'12'));advance(1001);live.tick();
  assert.equal(state.basket.scores[0][0],12);
  assert.equal(state.timers['basket:red:0'].remaining,0);assert.equal(state.timers['basket:red:0'].deadline,null);
  assert.equal(state.timers['basket:red:0'].started,true,'Expiry still allows the remaining result to be recorded.');
});

await test('Blank and invalid count drafts keep the last valid score',async({state,emit,control,start})=>{
  start('basket:red:0');state.basket.scores[0][0]=4;
  await emit('input',control(5,{liveScore:''},''));assert.equal(state.basket.scores[0][0],4);
  const invalid=control(5,{liveScore:''},'4.5');invalid.validity.valid=false;
  await emit('input',invalid);assert.equal(state.basket.scores[0][0],4);
});

await test('Typing cannot bypass the requirement to start an attempt timer',async({state,emit,control})=>{
  await emit('input',control(5,{liveScore:''},'8'));
  assert.equal(state.basket.scores[0][0],null);
});

await test('Finished attempts keep their locked score when an input event arrives',async({state,emit,control,start})=>{
  start('basket:red:0');state.basket.scores[0][0]=3;state.finished.push('basket:red:0');
  await emit('input',control(5,{liveScore:''},'10'));
  assert.equal(state.basket.scores[0][0],3);
});

await test('Reset timer clears its ongoing indicator and relocks scoring',async({state,emit,control,start})=>{
  start('basket:red:0');await emit('click',control(5,{liveAction:'reset-clock'}));
  assert.equal(state.activeKey,null);assert.equal(state.timers['basket:red:0'].started,false);
  assert.equal(state.timers['basket:red:0'].remaining,30000);
});

await test('A tug rematch clears the previous ongoing indicator until Play is pressed',async({state,emit,control,start})=>{
  state.tug.slots=[...TEAM_IDS];state.tug.locked=true;
  start('tug:prelim',60,matchTeams(state.tug,'prelim').join('|'));
  await emit('click',control(8,{liveAction:'rematch'}));
  assert.equal(state.activeKey,null);assert.equal(state.timers['tug:prelim'].started,false);
  assert.equal(state.timers['tug:prelim'].remaining,30000);
});

await test('Changing the paused limit returns to Ready and preserves the next Play tap',async({state,emit,control,start,refreshes})=>{
  const clock=start('basket:red:0');clock.deadline=null;
  await emit('change',control(5,{liveLimit:''},'45'));
  assert.equal(state.activeKey,null);assert.equal(clock.started,false);assert.equal(clock.duration,45000);
  assert.equal(refreshes(),0,'A blur must not replace the button being pressed.');
  await emit('click',control(5,{liveAction:'toggle'}));
  assert.equal(state.activeKey,'basket:red:0');assert.notEqual(clock.deadline,null);
});

await test('Resetting an inactive clock preserves the other game’s ongoing indicator',async({state,emit,control,start})=>{
  start('relay:0',480);state.timers['basket:red:0']=makeClock(30);
  await emit('click',control(5,{liveAction:'reset-clock'}));
  assert.equal(state.activeKey,'relay:0');assert.notEqual(state.timers['relay:0'].deadline,null);
});

for(const result of tests)console.log(`${result.pass?'PASS':'FAIL'} ${result.name}${result.error?'\n'+result.error:''}`);
if(tests.some(result=>!result.pass))process.exitCode=1;
