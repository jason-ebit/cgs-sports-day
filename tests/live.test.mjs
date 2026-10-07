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
  showModal(){this.open=true;}
  focus(){}
  querySelector(){return null;}
  querySelectorAll(){return [];}
  contains(){return false;}
}

async function fixture(fn) {
  const globals=['document','window','innerWidth','innerHeight','setInterval'];
  const saved=new Map(globals.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const originalNow=Date.now;let now=1000,saves=0,refreshes=0,editable=true,offset=0,confirm=async()=>true;const messages=[],panels=[],rendered=[];
  const document=new Surface(),window=new Surface();
  const elements=Object.fromEntries(['#timer-float','#active-timer','#live-dialog','#hide-timer','#timer-dropzone','#live-dropzone','#close-live','#live-title','#live-body'].map(selector=>[selector,new Surface()]));
  document.querySelector=selector=>elements[selector];document.querySelectorAll=selector=>selector==='[data-live-key]'?rendered:[];
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
  const renderClock=(index,key)=>{
    const desk=new Surface({liveEvent:String(index),liveKey:key}),digits=new Surface(),status=new Surface(),stage=new Surface();
    desk.querySelector=selector=>({'[data-clock-digits]':digits,'[data-clock-status]':status,'.live-stage':stage}[selector]||null);
    rendered.push(desk);return {digits,status};
  };
  const live=createLiveDesk({getState:()=>state,schedule,esc:value=>String(value),dot:()=>'',teamLabel:id=>id,
    save:()=>saves++,refresh:()=>refreshes++,toast:message=>messages.push(message),recordWinner:()=>false,
    confirmChange:message=>confirm(message),openPanel:(...args)=>panels.push(args),saved:()=>true,canEdit:()=>editable,now:()=>now+offset});
  const start=(key,seconds=30,signature='')=>{
    state.timers[key]=makeClock(seconds,signature);startClock(state.timers,key,now);state.activeKey=key;return state.timers[key];
  };
  try{await fn({state,live,control,emit,start,desk,messages,panels,elements,renderClock,advance:ms=>now+=ms,setEditing:value=>editable=value,setOffset:value=>offset=value,setConfirm:value=>confirm=value,saves:()=>saves,refreshes:()=>refreshes});}
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

await test('Spectator rendering creates no saved timers or game state',async({state,live,setEditing,saves})=>{
  setEditing(false);const before=structuredClone(state);
  for(const index of [0,4,5,7,8,9]){live.panel(index);live.rounds(index);}
  live.tick();assert.deepEqual(state,before);assert.equal(saves(),0);
});

await test('Spectator rendering does not replace a remote clock with a different signature',async({state,live,setEditing,saves})=>{
  state.timers['cavalry:women']=makeClock(45,'red|blue');
  setEditing(false);const before=structuredClone(state);live.panel(7);
  assert.deepEqual(state,before);assert.equal(saves(),0);
});

await test('A spectator follows shared clock expiry without pausing or saving it',async({state,live,start,advance,setEditing,renderClock,elements,saves,messages})=>{
  start('basket:red:0',1);setEditing(false);const before=structuredClone(state);
  const {digits,status}=renderClock(5,'basket:red:0');advance(1001);live.tick();
  assert.equal(digits.textContent,'00:00');assert.equal(status.textContent,'Time up');
  assert.match(elements['#active-timer'].textContent,/time up$/);
  assert.deepEqual(state,before);assert.equal(saves(),0);assert.deepEqual(messages,[]);
});

await test('Spectator controls block timer actions and every game’s scoring actions',async({state,live,start,setEditing,control,emit,saves})=>{
  state.tug.slots=[...TEAM_IDS];state.tug.locked=true;
  state.cavalry.divisions.women.active=['red','blue'];state.cavalry.divisions.women.started=true;
  for(const key of ['basket:red:0','borrow:0','relay:0','cavalry:women','tug:prelim']){
    const signature=key==='cavalry:women'?'red|blue':key==='tug:prelim'?matchTeams(state.tug,'prelim').join('|'):'';
    start(key,30,signature);
  }
  setEditing(false);const before=structuredClone(state);
  for(const action of ['toggle','add','rematch','reset-clock','reset-round','reset-game','plus-ball','minus-ball','finish']){
    await emit('click',control(5,{liveAction:action}));
  }
  for(const [index,dataset] of [[4,{liveArrival:'red'}],[4,{liveFail:'blue'}],[9,{liveArrival:'red'}],[7,{liveEliminate:'red'}],[8,{liveWinner:'green'}]]){
    await emit('click',control(index,dataset));
  }
  await emit('input',control(5,{liveScore:''},'12'));
  await emit('change',control(5,{liveScore:''},'12'));
  await emit('change',control(5,{liveLimit:''},'50'));
  assert.deepEqual(state,before);assert.equal(saves(),0);
  assert.match(live.panel(5),/data-live-score disabled/);
});

await test('Spectators can browse rounds, attempts, teams and cavalry divisions without saving',async({state,live,start,setEditing,control,emit,saves})=>{
  start('cavalry:men',300,'');setEditing(false);const before=structuredClone(state);
  await emit('click',control(4,{liveChoice:'round',value:'2'}));
  assert.match(live.panel(4),/data-live-key="borrow:2"/);
  await emit('click',control(5,{liveChoice:'attempt',value:'1'}));
  await emit('click',control(5,{liveTeam:'blue'}));
  assert.match(live.panel(5),/data-live-key="basket:blue:1"/);
  await emit('click',control(7,{liveChoice:'division',value:'men'}));
  assert.match(live.panel(7),/data-live-key="cavalry:men"/);
  await emit('click',control(7,{liveTeam:'green'}));
  await emit('click',control(7,{liveAction:'next'}));
  assert.match(live.panel(7),/data-live-key="cavalry:women"/);
  live.resume(7);assert.match(live.panel(7),/data-live-key="cavalry:men"/);
  assert.deepEqual(state,before);assert.equal(saves(),0);
});

await test('Spectators keep sheet, overview and big-screen navigation',async({state,live,setEditing,control,emit,panels,elements,saves})=>{
  setEditing(false);const before=structuredClone(state);
  await emit('click',control(5,{liveAction:'sheet'}));
  await emit('click',control(5,{liveAction:'overview'}));
  await emit('click',control(5,{liveAction:'expand'}));
  assert.deepEqual(panels,[['event:5','scores'],['results']]);assert.equal(elements['#live-dialog'].open,true);
  assert.match(elements['#live-body'].innerHTML,/Viewing live scores/);
  assert.deepEqual(state,before);assert.equal(saves(),0);
});

await test('Shared clock offset controls displayed time and authored deadlines',async({state,live,setOffset,setEditing,control,emit,renderClock})=>{
  setOffset(12000);
  await emit('click',control(5,{liveAction:'toggle'}));
  assert.equal(state.timers['basket:red:0'].deadline,43000);
  const {digits}=renderClock(5,'basket:red:0');live.tick();assert.equal(digits.textContent,'00:30');
  setEditing(false);setOffset(14000);live.tick();assert.equal(digits.textContent,'00:28');
});

await test('A scorekeeper who loses editing permission immediately stops authoring timer expiry',async({state,live,start,advance,setEditing,saves})=>{
  start('basket:red:0',1);setEditing(false);advance(1001);live.tick();
  assert.equal(state.timers['basket:red:0'].deadline,2000);assert.equal(saves(),0);
  setEditing(true);live.tick();assert.equal(state.timers['basket:red:0'].deadline,null);assert.equal(saves(),1);
});

await test('A scorekeeper cannot confirm a reset after editing permission is lost',async({state,start,setConfirm,setEditing,emit,control,saves})=>{
  start('basket:red:0');const before=structuredClone(state);
  setConfirm(async()=>{setEditing(false);return true;});
  await emit('click',control(5,{liveAction:'reset-round'}));
  assert.deepEqual(state,before);assert.equal(saves(),0);
});

await test('A spectator’s open big screen refreshes to shared results without saving',async({state,live,setEditing,elements,saves})=>{
  setEditing(false);live.open(5);
  state.basket.scores[0][0]=9;const before=structuredClone(state);live.refresh();
  assert.match(elements['#live-body'].innerHTML,/value="9" data-live-score disabled/);
  assert.deepEqual(state,before);assert.equal(saves(),0);
});

for(const result of tests)console.log(`${result.pass?'PASS':'FAIL'} ${result.name}${result.error?'\n'+result.error:''}`);
if(tests.some(result=>!result.pass))process.exitCode=1;
