import assert from 'node:assert/strict';
import { createLiveDesk } from '../live.js';
import { TEAM_IDS, defaultState, matchTeams } from '../model.js';
import { makeClock, startClock } from '../timer-model.js';
import { recordWinner as recordTugResult } from '../rounds.js';

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
  focus(options){this.focusOptions=options;}
  querySelector(){return null;}
  querySelectorAll(){return [];}
  contains(){return false;}
}

async function fixture(fn) {
  const globals=['document','window','innerWidth','innerHeight','setInterval','CSS'];
  const saved=new Map(globals.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const originalNow=Date.now;let now=1000,saves=0,refreshes=0,editable=true,offset=0,confirm=async()=>true,syncStatus={localPreview:true};const messages=[],panels=[],rendered=[],syncLabels=[],boards=[];
  const document=new Surface(),window=new Surface();
  const elements=Object.fromEntries(['#timer-float','#active-timer','#live-dialog','#hide-timer','#timer-dropzone','#live-dropzone','#close-live','#live-title','#live-body'].map(selector=>[selector,new Surface()]));
  const overlay=elements['#live-dialog'],overlayBody=elements['#live-body'];
  overlayBody.id='live-body';
  overlayBody.querySelector=selector=>selector==='[data-live-key]'&&overlayBody.innerHTML?.match(/data-live-key="([^"]+)"/)?new Surface({liveKey:overlayBody.innerHTML.match(/data-live-key="([^"]+)"/)[1]}):null;
  overlay.querySelector=selector=>overlayBody.querySelector(selector);
  overlay.querySelectorAll=selector=>selector==='[id]'||selector==='#live-body'?[overlayBody]:[];
  document.querySelector=selector=>elements[selector];document.querySelectorAll=selector=>selector==='[data-live-key]'?rendered:selector==='[data-live-sync]'?syncLabels:[];
  Object.assign(globalThis,{document,window,innerWidth:1000,innerHeight:700,setInterval:()=>1,CSS:{escape:value=>String(value)}});Date.now=()=>now;
  let state=defaultState();const schedule=Array.from({length:16},(_,i)=>({title:'Event '+i,durationMinutes:1}));
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
    save:()=>saves++,refresh:()=>refreshes++,toast:message=>messages.push(message),showScoreboard:context=>boards.push({...context}),recordWinner:(match,id)=>{const accepted=recordTugResult(state,match,id);if(accepted)saves++;return accepted;},
    confirmChange:message=>confirm(message),openPanel:(...args)=>panels.push(args),saved:()=>true,canEdit:()=>editable,now:()=>now+offset,
    syncStatus:()=>syncStatus,preferences:()=>state.preferences,savePreference:(key,value)=>{state.preferences[key]=value;saves++;}});
  const start=(key,seconds=30,signature='')=>{
    state.timers[key]=makeClock(seconds,signature);startClock(state.timers,key,now);state.activeKey=key;return state.timers[key];
  };
  try{await fn({state,live,control,emit,start,desk,messages,panels,boards,elements,renderClock,renderSync:()=>{const el=new Surface();syncLabels.push(el);return el;},advance:ms=>now+=ms,setEditing:value=>editable=value,setOffset:value=>offset=value,setConfirm:value=>confirm=value,setSyncStatus:value=>syncStatus=value,replaceState:value=>state=value,currentState:()=>state,saves:()=>saves,refreshes:()=>refreshes});}
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
  const markup=live.panel(5);assert.match(markup,/class="ball-count"/);
  assert.doesNotMatch(markup,/data-live-score|data-live-limit|data-live-sound|data-live-action="(?:toggle|add|rematch|reset-clock|reset-round|reset-game|plus-ball|minus-ball|finish)"/);
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
  live.resume(7);assert.match(live.panel(7),/data-live-key="cavalry:women"/,'Reviewing stays on the chosen division.');
  await emit('click',control(7,{liveAction:'follow-live'}));assert.match(live.panel(7),/data-live-key="cavalry:men"/);
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
  assert.match(elements['#live-body'].innerHTML,/<output class="ball-count" aria-label="Successful balls">9<\/output>/);
  assert.deepEqual(state,before);assert.equal(saves(),0);
});

await test('Scorekeeper rendering and browsing do not create clocks or replace a paused clock',async({state,live,emit,control,start,saves})=>{
  const clock=start('cavalry:women',45,'red|blue');clock.deadline=null;
  const before=structuredClone(state);
  for(const index of [0,4,5,7,8,9]){live.panel(index);live.rounds(index);}
  await emit('click',control(4,{liveChoice:'round',value:'2'}));
  await emit('click',control(5,{liveTeam:'blue'}));
  assert.deepEqual(state,before);assert.equal(state.timers['cavalry:women'],clock);assert.equal(saves(),0);
});

await test('A spectator follows the next shared round while an open big screen preserves manual review',async({state,live,start,setEditing,emit,control,elements,saves})=>{
  setEditing(false);start('borrow:1',90);live.open(4);
  assert.match(elements['#live-body'].innerHTML,/data-live-key="borrow:1"/);
  start('borrow:2',120);live.refresh();assert.match(elements['#live-body'].innerHTML,/data-live-key="borrow:2"/);
  await emit('click',control(4,{liveChoice:'round',value:'0'}));
  start('borrow:3',120);live.refresh();
  assert.match(elements['#live-body'].innerHTML,/data-live-key="borrow:0"/);
  assert.match(elements['#live-body'].innerHTML,/Reviewing rounds/);
  await emit('click',control(4,{liveAction:'follow-live'}));
  assert.match(elements['#live-body'].innerHTML,/data-live-key="borrow:3"/);
  assert.equal(saves(),0);
});

await test('Following Basket tracks both the shared team and attempt, including a paused timer',async({live,start,setEditing,emit,control})=>{
  setEditing(false);const clock=start('basket:blue:1');clock.deadline=null;
  assert.match(live.panel(5),/data-live-key="basket:blue:1"/);
  await emit('click',control(5,{liveTeam:'red'}));
  assert.match(live.panel(5),/data-live-key="basket:red:1"/);
  live.resume(5);assert.match(live.panel(5),/data-live-key="basket:red:1"/);
  await emit('click',control(5,{liveAction:'follow-live'}));
  assert.match(live.panel(5),/data-live-key="basket:blue:1"/);
  assert.match(live.panel(5),/>Paused<\/span>/);
});

await test('Writer selection and navigation snapshots retain the exact team and attempt',async({state,live,start,emit,control,saves})=>{
  await emit('click',control(5,{liveTeam:'blue'}));
  await emit('click',control(5,{liveChoice:'attempt',value:'1'}));
  const selection=live.captureSelection(5);
  await emit('click',control(5,{liveTeam:'red'}));start('basket:yellow:0');
  live.restoreSelection(5,selection);live.resume(5);
  assert.match(live.panel(5),/data-live-key="basket:blue:1"/);
  assert.equal(state.activeKey,'basket:yellow:0');assert.equal(saves(),0);
});

await test('Next from a completed last Borrow round names and returns to earlier unfinished work',async({state,live,emit,control,saves})=>{
  state.borrow.scores.forEach(row=>{for(let round=1;round<state.borrow.rounds;round++)row[round]=2;});
  await emit('click',control(4,{liveChoice:'round',value:String(state.borrow.rounds-1)}));
  assert.match(live.panel(4),/>Next: Round 1 →<\/button>/);
  await emit('click',control(4,{liveAction:'next'}));
  assert.match(live.panel(4),/data-live-key="borrow:0"/);
  assert.equal(saves(),0);assert.deepEqual(state.timers,{});
});

await test('The seventh Borrow race uses one shared card, a 90-second start gate and the same finish-order points',async({state,live,emit,control,boards})=>{
  assert.equal(state.borrow.rounds,7);
  await emit('click',control(4,{liveChoice:'round',value:'6'}));
  const ready=live.panel(4);
  assert.match(ready,/Round 7 · Same-card race/);
  assert.match(ready,/All five teams get the same card\. Start together\./);
  assert.match(ready,/>01:30<\/output>/);
  await emit('click',control(4,{liveArrival:'red'}));
  assert.deepEqual(state.borrow.scores.map(row=>row[6]),[null,null,null,null,null]);
  await emit('click',control(4,{liveAction:'toggle'}));
  assert.equal(state.timers['borrow:6'].duration,90000);
  assert.equal(state.timers['borrow:6'].started,true);
  for(const id of TEAM_IDS)await emit('click',control(4,{liveArrival:id}));
  assert.deepEqual(state.borrow.scores.map(row=>row[6]),[5,4,3,2,2]);
  assert.equal(boards.length,1);assert.equal(boards[0].key,'borrow:6');
});

await test('Failure in the seventh Borrow race stays zero and does not consume a successful finish award',async({state,emit,control,start})=>{
  await emit('click',control(4,{liveChoice:'round',value:'6'}));
  start('borrow:6',90);
  await emit('click',control(4,{liveFail:'white'}));
  for(const id of TEAM_IDS.slice(0,4))await emit('click',control(4,{liveArrival:id}));
  assert.deepEqual(state.borrow.scores.map(row=>row[6]),[5,4,3,2,0]);
});

await test('Next from the last Relay round wraps instead of staying on completed work',async({state,live,emit,control})=>{
  state.relay.scores.forEach((row,i)=>{row[1]=i+1;row[2]=i+1;});
  await emit('click',control(9,{liveChoice:'round',value:'2'}));
  assert.match(live.panel(9),/>Next: Round 1 →<\/button>/);
  await emit('click',control(9,{liveAction:'next'}));assert.match(live.panel(9),/data-live-key="relay:0"/);
});

await test('Undo a Borrow fail restores the team without changing the running timer or success ranking',async({state,live,start,emit,control,saves})=>{
  const clock=start('borrow:0',90),deadline=clock.deadline;
  await emit('click',control(4,{liveFail:'red'}));assert.equal(state.borrow.scores[0][0],0);
  assert.match(live.panel(4),/data-live-action="undo-result"/);
  await emit('click',control(4,{liveAction:'undo-result'}));
  assert.equal(state.borrow.scores[0][0],null);assert.equal(clock.deadline,deadline);assert.equal(clock.started,true);
  await emit('click',control(4,{liveArrival:'red'}));assert.equal(state.borrow.scores[0][0],5);
  assert.equal(saves(),3);
});

await test('Undo a Relay finish lets the corrected next finisher receive the vacant place',async({state,start,emit,control})=>{
  start('relay:0',480);
  await emit('click',control(9,{liveArrival:'red'}));
  await emit('click',control(9,{liveArrival:'blue'}));
  await emit('click',control(9,{liveAction:'undo-result'}));
  await emit('click',control(9,{liveArrival:'green'}));
  assert.deepEqual(state.relay.scores.map(row=>row[0]),[1,null,null,2,null]);
});

await test('Undo a Cavalry elimination restores the horse while the arena and timer stay open',async({state,live,start,emit,control})=>{
  const arena=state.cavalry.divisions.women;arena.active=['red','blue','green'];arena.started=true;
  const clock=start('cavalry:women',300,'red|blue|green'),deadline=clock.deadline;
  await emit('click',control(7,{liveEliminate:'red'}));assert.deepEqual(arena.eliminated,['red']);
  assert.match(live.panel(7),/data-live-action="undo-result"/);
  await emit('click',control(7,{liveAction:'undo-result'}));
  assert.deepEqual(arena.eliminated,[]);assert.deepEqual(arena.active,['red','blue','green']);
  assert.equal(arena.started,true);assert.equal(clock.deadline,deadline);
});

await test('Undo never unlocks a completed round or applies to Tug',async({state,live,start,emit,control,saves})=>{
  start('borrow:0',90);
  for(const id of TEAM_IDS)await emit('click',control(4,{liveArrival:id}));
  const before=structuredClone(state),saved=saves();
  assert.doesNotMatch(live.panel(4),/data-live-action="undo-result"/);
  await emit('click',control(4,{liveAction:'undo-result'}));
  await emit('click',control(8,{liveAction:'undo-result'}));
  assert.deepEqual(state,before);assert.equal(saves(),saved);
});

await test('A new shared result makes the previous local Undo unavailable',async({state,live,start,emit,control,replaceState,currentState,saves})=>{
  start('borrow:0',90);await emit('click',control(4,{liveArrival:'red'}));
  const remote=structuredClone(state);remote.borrow.scores[1][0]=4;replaceState(remote);live.refresh();
  const saved=saves();assert.doesNotMatch(live.panel(4),/data-live-action="undo-result"/);
  await emit('click',control(4,{liveAction:'undo-result'}));
  assert.deepEqual(currentState().borrow.scores.map(row=>row[0]),[5,4,null,null,null]);assert.equal(saves(),saved);
});

await test('Changing a timer limit clears the Undo journal even after Play restarts scoring',async({state,live,start,emit,control})=>{
  const clock=start('borrow:0',90);
  await emit('click',control(4,{liveArrival:'red'}));clock.deadline=null;
  await emit('change',control(4,{liveLimit:''},'60'));
  await emit('click',control(4,{liveAction:'toggle'}));
  assert.doesNotMatch(live.panel(4),/data-live-action="undo-result"/);
  await emit('click',control(4,{liveAction:'undo-result'}));assert.equal(state.borrow.scores[0][0],5);
});

await test('Play has one action slot and the underlying desk hides it while Big screen is open',async({live,elements})=>{
  assert.equal((live.panel(5).match(/data-live-action="toggle"/g)||[]).length,1);
  assert.match(live.panel(5),/class="live-action-dock(?: [^"]*)?"/);
  live.open(5);
  assert.equal((elements['#live-body'].innerHTML.match(/data-live-action="toggle"/g)||[]).length,1);
  assert.doesNotMatch(live.panel(5),/data-live-action="toggle"/);
  elements['#live-dialog'].close();assert.match(live.panel(5),/data-live-action="toggle"/);
});

await test('Big screen starts at the timer after reopening or changing rounds while live refreshes retain its scroll',async({live,elements,emit,control})=>{
  const overlay=elements['#live-dialog'],body=elements['#live-body'];
  let scroll=420;
  // Browsers may ignore scroll writes until a closed dialog has been shown.
  Object.defineProperty(body,'scrollTop',{get:()=>scroll,set:value=>{if(overlay.open)scroll=value;}});
  live.open(9);assert.equal(body.scrollTop,0);
  body.scrollTop=310;live.refresh();assert.equal(body.scrollTop,310);
  await emit('click',control(9,{liveChoice:'round',value:'1'}));assert.equal(body.scrollTop,0);
  body.scrollTop=280;overlay.close();live.open(9);assert.equal(body.scrollTop,0);
  assert.deepEqual(elements['#close-live'].focusOptions,{preventScroll:true});
});

await test('The desk sync indicator updates through pending, offline and conflict without rebuilding inputs',async({live,renderSync,setSyncStatus,refreshes,saves})=>{
  const indicator=renderSync();
  setSyncStatus({connected:true,role:'writer',phase:'synced',pending:0});live.updateStatus();
  assert.equal(indicator.textContent,'Live · results synced');
  setSyncStatus({connected:false,phase:'pending',pending:2});live.updateStatus();
  assert.equal(indicator.textContent,'Offline · results waiting to sync');
  setSyncStatus({connected:true,phase:'conflict',pending:2});live.updateStatus();
  assert.equal(indicator.textContent,'Scores need attention · open sync');assert.match(indicator.className,/needs-attention/);
  assert.equal(refreshes(),0);assert.equal(saves(),0);
});

await test('Confirmed resets apply to the latest state object and preserve unrelated shared results',async({state,start,emit,control,setConfirm,replaceState,currentState})=>{
  start('basket:red:0');state.basket.scores[0][0]=3;
  const before=structuredClone(state),remote=structuredClone(state);remote.basket.scores[1][0]=11;
  setConfirm(async()=>{replaceState(remote);return true;});
  await emit('click',control(5,{liveAction:'reset-round'}));
  assert.equal(currentState().basket.scores[0][0],null);assert.equal(currentState().basket.scores[1][0],11);
  assert.equal(currentState().timers['basket:red:0'],undefined);assert.deepEqual(state,before);
});

await test('End sound is a private preference and imported preference changes are reflected on refresh',async({state,live,emit,control,saves})=>{
  const checkbox=control(5,{liveSound:''});checkbox.checked=true;
  await emit('change',checkbox);
  assert.equal(state.preferences.sound,true);assert.equal(saves(),1);
  assert.match(live.panel(5),/data-live-sound checked/);
  state.preferences.sound=false;live.refresh();assert.doesNotMatch(live.panel(5),/data-live-sound checked/);
});

await test('Valid score typing updates the committed baseline for later draft preservation',async({state,live,start,emit,control})=>{
  start('basket:red:0');const input=control(5,{liveScore:'',committedValue:'0'},'7');
  await emit('input',input);assert.equal(input.dataset.committedValue,'7');assert.equal(state.basket.scores[0][0],7);
  assert.match(live.panel(5),/value="7" data-committed-value="7" data-live-score/);
  input.value='';await emit('change',input);assert.equal(input.value,7);assert.equal(input.dataset.committedValue,'7');
});

await test('An expired clock can receive more time and resume without losing the scoring gate',async({state,live,start,advance,emit,control})=>{
  const clock=start('borrow:0',1);advance(1001);live.tick();
  assert.equal(clock.started,true);assert.match(live.panel(4),/data-live-action="toggle" disabled/);
  await emit('click',control(4,{liveAction:'add'}));
  assert.equal(clock.remaining,30000);await emit('click',control(4,{liveAction:'toggle'}));
  await emit('click',control(4,{liveArrival:'red'}));assert.equal(state.borrow.scores[0][0],5);
});

await test('Completed games offer Main Scores while spectator pages omit all edit menus',async({state,live,setEditing})=>{
  state.relay.scores.forEach((row,i)=>row.fill(i+1));setEditing(false);
  const markup=live.panel(9);assert.match(markup,/data-live-action="overview">Main Scores/);
  assert.doesNotMatch(markup,/clock-options|reset-menu|data-live-arrival|data-live-action="toggle"/);
});

await test('The audience scoreboard opens for viewers without leaving the match or changing state',async({state,live,setEditing,emit,control,boards,elements,saves})=>{
  setEditing(false);live.open(4);const before=structuredClone(state);
  await emit('click',control(4,{liveAction:'scoreboard'}));
  assert.equal(boards.length,1);assert.equal(boards[0].key,'borrow:0');
  assert.equal(elements['#live-dialog'].open,true);assert.deepEqual(state,before);assert.equal(saves(),0);
  assert.match(live.panel(4),/data-live-action="scoreboard"/);
  assert.doesNotMatch(live.panel(0),/data-live-action="scoreboard"/);
});

await test('Borrow and Relay present a board only after the final team result and allow deliberate resets',async({state,emit,control,start,boards})=>{
  for(const [game,index] of [['borrow',4],['relay',9]]){
    start(game+':0');const before=boards.length;
    for(const id of TEAM_IDS.slice(0,4))await emit('click',control(index,{liveArrival:id}));
    assert.equal(boards.length,before);
    await emit('click',control(index,{liveArrival:TEAM_IDS[4]}));
    assert.equal(boards.length,before+1);assert.equal(boards.at(-1).key,game+':0');
    assert.equal(state.activeKey,null);assert.equal(state.timers[game+':0'].deadline,null);
    await emit('click',control(index,{liveArrival:TEAM_IDS[4]}));
    assert.equal(boards.length,before+1,'An already locked result does not reopen the board.');
    await emit('click',control(index,{liveAction:'reset-round'}));start(game+':0');
    for(const id of TEAM_IDS)await emit('click',control(index,{liveArrival:id}));
    assert.equal(boards.length,before+2,'Finishing a deliberately reset round presents its new results.');
  }
});

await test('A saved Borrow failure can complete the round and open its standings',async({state,emit,control,start,boards})=>{
  start('borrow:0');
  for(const id of TEAM_IDS.slice(0,4))await emit('click',control(4,{liveArrival:id}));
  await emit('click',control(4,{liveFail:'white'}));
  assert.equal(state.borrow.scores[4][0],0);assert.equal(boards.length,1);
});

await test('Basket counter changes do not present results until Finish locks the attempt',async({state,emit,control,start,boards,desk})=>{
  start('basket:red:0');await emit('click',control(5,{liveAction:'plus-ball'}));
  assert.equal(boards.length,0);
  desk.querySelector=selector=>selector==='[data-live-score]'?{value:'12',validity:{valid:true}}:null;
  await emit('click',control(5,{liveAction:'finish'}));
  assert.equal(state.basket.scores[0][0],12);assert.ok(state.finished.includes('basket:red:0'));
  assert.equal(boards.length,1);assert.equal(boards[0].key,'basket:red:0');
});

await test('Cavalry shows standings once the last horse is known',async({state,emit,control,start,boards})=>{
  const division=state.cavalry.divisions.women;division.active=[...TEAM_IDS];division.started=true;
  start('cavalry:women',300,TEAM_IDS.join('|'));
  for(const id of TEAM_IDS.slice(0,3))await emit('click',control(7,{liveEliminate:id}));
  assert.equal(boards.length,0);
  await emit('click',control(7,{liveEliminate:'green'}));
  assert.equal(boards.length,1);assert.equal(boards[0].key,'cavalry:women');
});

await test('A confirmed Tug winner opens a board and preserves the big match popup',async({state,live,emit,control,start,boards,elements})=>{
  state.tug.slots=[...TEAM_IDS];state.tug.locked=true;
  start('tug:prelim',60,matchTeams(state.tug,'prelim').join('|'));live.open(8);
  await emit('click',control(8,{liveWinner:'red'}));
  assert.equal(state.tug.winners.prelim,'red');assert.equal(boards.length,1);
  assert.equal(boards[0].key,'tug:prelim');assert.equal(elements['#live-dialog'].open,true);
});

await test('Timer expiry and spectator refresh never force open an audience board',async({state,live,emit,control,start,advance,boards,setEditing})=>{
  await emit('click',control(4,{liveArrival:'red'}));assert.equal(boards.length,0);
  start('borrow:0',1);advance(1001);live.tick();assert.equal(boards.length,0);
  setEditing(false);state.borrow.scores.forEach((row,i)=>row[0]=5-i);live.refresh();
  assert.equal(boards.length,0);
});

for(const result of tests)console.log(`${result.pass?'PASS':'FAIL'} ${result.name}${result.error?'\n'+result.error:''}`);
if(tests.some(result=>!result.pass))process.exitCode=1;
