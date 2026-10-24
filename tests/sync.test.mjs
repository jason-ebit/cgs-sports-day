import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { defaultState, championship, TEAM_IDS, GAME_IDS } from '../model.js';
import { makeClock, startClock, pauseClock, addTime } from '../timer-model.js';
import { recordSuccess, eliminate, setBasketScore, finishBasketAttempt, resetRound, resetGame, recordWinner } from '../rounds.js';
import { publicSnapshot, mergePublicState, createSyncService } from '../sync.js';

const tests = [], activeServices = new Set();
const clone = value => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return {promise,resolve}; };
async function test(name, fn) {
  try { await fn(); tests.push({name,passed:true}); }
  catch (cause) { tests.push({name,passed:false,cause}); }
  finally { for (const service of activeServices) service.stop(); activeServices.clear(); }
}
function memoryStorage() {
  const data = new Map();
  return {data,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
}

// Independent model of the server's public transaction units. The production
// client merge helper is deliberately not used to decide fixture conflicts.
function serverUnits(snapshot) {
  const s=mergePublicState(snapshot), units={};
  for (const t of s.teams) {units[`team:${t.id}:name`]=t.name;units[`team:${t.id}:seed`]=t.seed;}
  for (const [department,names] of Object.entries(s.committeeMembers)) names.forEach((name,index)=>units[`roster:${department}:${index}`]=name);
  for (const [id,ready] of Object.entries(s.equipmentReady)) units[`equipment:${id}`]=ready;
  for (const [round,people] of Object.entries(s.committeeRotation)) for (const [person,assignment] of Object.entries(people)) units[`rota:${round}:${person}`]=assignment;
  units['borrow:rounds']=s.borrow.rounds;
  for (let round=0;round<7;round++) units[`borrow:${round}`]=s.borrow.scores.map(row=>row[round]);
  for (let round=0;round<3;round++) units[`relay:${round}`]=s.relay.scores.map(row=>row[round]);
  TEAM_IDS.forEach((id,index)=>[0,1].forEach(attempt=>units[`basket:${id}:${attempt}`]={score:s.basket.scores[index][attempt],finished:s.finished.includes(`basket:${id}:${attempt}`)}));
  for (const division of ['women','men']) units[`cavalry:${division}`]=snapshot.cavalry.divisions[division];
  units['cavalry:config']={division:s.cavalry.division,cap:s.cavalry.cap};
  units.tug=s.tug;
  for (const game of GAME_IDS) units[`placements:${game}`]=snapshot.placements[game];
  units.timing={timers:snapshot.timers,activeKey:snapshot.activeKey};
  units['finished-other']=snapshot.finished.filter(key=>!key.startsWith('basket:'));
  return units;
}
function serverBarrier(before, after) {
  const a=mergePublicState(before),b=mergePublicState(after);
  if(a.borrow.rounds!==b.borrow.rounds)return true;
  for(const game of ['borrow','relay']) for(let team=0;team<5;team++) for(let round=0;round<a[game].scores[team].length;round++)
    if(a[game].scores[team][round]!==null&&a[game].scores[team][round]!==b[game].scores[team][round])return true;
  for(let team=0;team<5;team++) for(let attempt=0;attempt<2;attempt++) {
    const key=`basket:${TEAM_IDS[team]}:${attempt}`,old=a.basket.scores[team][attempt],next=b.basket.scores[team][attempt];
    if(old!==null&&next===null||a.finished.includes(key)&&(!b.finished.includes(key)||old!==next))return true;
  }
  for(const division of ['women','men']) {
    const old=a.cavalry.divisions[division],next=b.cavalry.divisions[division];
    if(old.started&&(!next.started||!isDeepStrictEqual(old.active,next.active))||old.eliminated.some((id,index)=>next.eliminated[index]!==id))return true;
  }
  if(a.tug.locked&&(!b.tug.locked||!isDeepStrictEqual(a.tug.slots,b.tug.slots)))return true;
  if(Object.keys(a.tug.winners).some(match=>a.tug.winners[match]&&a.tug.winners[match]!==b.tug.winners[match]))return true;
  if(Object.entries(a.timers).some(([key,clock])=>!b.timers[key]||clock.started&&!b.timers[key].started))return true;
  return a.finished.some(key=>!b.finished.includes(key));
}
function fixture({snapshot=publicSnapshot(defaultState()),automaticRealtime=true}={}) {
  let serverNow=1700000000000,counter=0,revision=0,resetRevision=0,shared=clone(snapshot),jitter=0,upgrade=false;
  const unitVersions=Object.fromEntries(Object.keys(serverUnits(shared)).map(key=>[key,0]));
  const operations=new Map(),sessions=new Map(),calls=[],intervals=new Map(),listeners=new Set(),devices=[];
  const uuid=()=>`00000000-0000-4000-8000-${String(++counter).padStart(12,'0')}`;
  const reply=(status,extra={})=>({status,editing_mode:upgrade?'upgrade-required':'shared-v1',public_state:clone(shared),revision,
    unit_versions:{...unitVersions},reset_revision:resetRevision,server_ms:serverNow+jitter,...extra});
  const response=(payload,status=200)=>({ok:status<400,status,payload:clone(payload),json:async()=>clone(payload)});
  const notify=()=>{for(const listener of listeners)queueMicrotask(listener);};
  function commit(next,{barrier=false}={}) {
    mergePublicState(next);
    const before=serverUnits(shared),after=serverUnits(next),nextRevision=revision+1;
    for(const key of new Set([...Object.keys(before),...Object.keys(after)])) if(!isDeepStrictEqual(before[key],after[key]))unitVersions[key]=nextRevision;
    if(barrier||serverBarrier(shared,next))resetRevision=nextRevision;
    shared=clone(next);revision=nextRevision;
    if(automaticRealtime)notify();
  }
  function issueSession(email='keeper@example.org') {
    const id=uuid(),token=`access-${id}`,refresh=`refresh-${id}`;
    const session={id,email,token,refresh,approved:email==='keeper@example.org',valid:true,refreshValid:true};
    sessions.set(token,session);
    return {access_token:token,refresh_token:refresh,expires_in:3600,user:{id:'approved-scorekeeper',email}};
  }
  const fetch=async(url,options)=>{
    const address=new URL(url),path=address.pathname,body=options.body?JSON.parse(options.body):{};
    calls.push({path,search:address.search,body:clone(body),headers:{...options.headers}});
    assert.equal(options.headers.apikey,'sb_publishable_test');
    if(path==='/auth/v1/token') {
      if(address.searchParams.get('grant_type')==='refresh_token') {
        const old=[...sessions.values()].find(item=>item.refresh===body.refresh_token);
        if(!old?.refreshValid)return response({message:'Invalid Refresh Token'},400);
        old.refreshValid=false;return response(issueSession(old.email));
      }
      return response(issueSession(body.email));
    }
    const token=options.headers.Authorization?.replace('Bearer ',''),session=sessions.get(token);
    if(path==='/auth/v1/logout') {
      if(session)for(const item of sessions.values())if(address.searchParams.get('scope')!=='local'||item.id===session.id){item.refreshValid=false;item.valid=false;}
      return response({});
    }
    if(path.endsWith('/read_sports_day_event'))return response(reply('ready'));
    if(!session?.valid)return response({message:'Sign in first.'},401);
    if(!session.approved)return response({message:'This login is not the scorekeeper.'},403);
    if(path.endsWith('/authorize_sports_day_editor'))return response(reply(upgrade?'upgrade_required':'authorized'));
    if(/\/(claim_sports_day_writer|release_sports_day_writer|apply_sports_day_update)$/.test(path))return response(reply('upgrade_required'));
    if(path.endsWith('/apply_sports_day_patch')) {
      if(upgrade)return response(reply('upgrade_required'));
      const prior=operations.get(body.p_operation_id);
      if(prior) {
        if(prior.device!==body.p_device_id||!isDeepStrictEqual(prior.body,body))return response({message:'An operation ID cannot be reused.'},400);
        return response(reply('duplicate',{applied_revision:prior.revision}));
      }
      if(body.p_expected_revision!==revision)return response(reply('conflict'));
      try{mergePublicState(body.p_snapshot);}catch{return response({message:'Invalid public score update.'},400);}
      commit(body.p_snapshot,{barrier:body.p_barrier===true});
      operations.set(body.p_operation_id,{device:body.p_device_id,body:clone(body),revision});
      return response(reply('applied',{applied_revision:revision}));
    }
    throw Error('Unexpected request '+path);
  };
  const scheduler={setInterval:fn=>{const id=uuid();intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id)};
  function service({storage=memoryStorage(),initialState=defaultState(),localOffset=0,fetch:overrideFetch,onRemote,...options}={}) {
    let visible=clone(initialState),offline=false,dropAck=false,hold=null;
    const statuses=[],delivered=[];
    const transport=async(url,request)=>{
      if(offline)throw Error('Network offline');
      const applying=new URL(url).pathname.endsWith('/apply_sports_day_patch');
      const gate=applying?hold:null;if(gate)hold=null;
      if(gate&&!gate.after){gate.entered.resolve();await gate.released.promise;}
      const result=await (overrideFetch||fetch)(url,request);
      if(gate&&gate.after){gate.entered.resolve();await gate.released.promise;}
      if(applying&&dropAck&&result.payload?.status==='applied'){dropAck=false;throw Error('Response lost after commit');}
      return result;
    };
    const sync=createSyncService({url:'https://test-project.supabase.co',publishableKey:'sb_publishable_test',fetch:transport,
      getStorage:()=>storage,uuid,scheduler,now:()=>serverNow+localOffset,
      subscribe:callback=>{listeners.add(callback);return()=>listeners.delete(callback);},
      onStatus:value=>statuses.push(value),onRemote:(value,meta)=>{visible=mergePublicState(value,visible,{offsetMs:meta.offsetMs});delivered.push({state:clone(value),meta});onRemote?.(value,meta);},...options});
    const device={sync,storage,statuses,delivered,get state(){return visible;},setState:value=>visible=clone(value),
      offline:value=>offline=value,loseAck:()=>dropAck=true,
      holdApply:({after=false}={})=>{const gate={after,entered:deferred(),released:deferred()};hold=gate;return{entered:gate.entered.promise,release:()=>gate.released.resolve()};}};
    devices.push(device);activeServices.add(sync);return device;
  }
  return{service,calls,intervals,listeners,uuid,fetch,notify,now:()=>serverNow,advance:ms=>serverNow+=ms,jitter:value=>jitter=value,
    externalUpdate:(state,options)=>commit(publicSnapshot(state),options),upgrade:value=>upgrade=value,
    denyAccess:()=>{for(const session of sessions.values())session.valid=false;},
    revokeApproval:()=>{for(const session of sessions.values())session.approved=false;},
    get shared(){return shared;},get revision(){return revision;},get resetRevision(){return resetRevision;}};
}
async function editor(f,options={}) {const device=f.service(options);await device.sync.start();await device.sync.login('keeper@example.org','private-password');await device.sync.claimWriter();return device;}
function edit(device,mutate,options) {const next=clone(device.state);mutate(next);device.setState(next);return device.sync.queue(next,options);}
async function settle(...devices) {await Promise.all(devices.map(device=>device.sync.flush()));await Promise.all(devices.map(device=>device.sync.refresh()));}
function startRound(state,key,now=1700000000000) {state.timers[key]=makeClock(60);startClock(state.timers,key,now);state.activeKey=key;}
const applyCalls=f=>f.calls.filter(call=>call.path.endsWith('/apply_sports_day_patch'));
await test('Shared snapshots include committee names but exclude private reminders, leaders, headcounts and rule text', () => {
  const s = defaultState();
  s.committeeMembers.director[0] = 'Shared director';
  s.teams[0].leader = 'Private leader'; s.teams[0].participants = 20;
  s.notes[4] = 'Private event note'; s.committeeNotes['first-aid'] = { general: 'Medical detail' };
  s.cavalry.rule = 'Private arena note'; s.cavalry.divisions.women.counts[0] = 3;
  s.placements.borrow.rule = 'Private placement explanation';
  const snapshot = publicSnapshot(s), text = JSON.stringify(snapshot);
  for(const forbidden of ['Private','Medical'])assert.equal(text.includes(forbidden),false,forbidden);
  const privateKeys=new Set(['leader','participants','counts','committeeNotes','notes','rule']);
  const inspect=value=>{if(!value||typeof value!=='object')return;for(const [key,nested] of Object.entries(value)){assert.equal(privateKeys.has(key),false,key);inspect(nested);}};
  inspect(snapshot);
  assert.equal(snapshot.placements.borrow.approved, true);
  assert.equal(snapshot.committeeMembers.director[0], 'Shared director');
});

await test('Applying shared results keeps this phone’s private notes and headcounts', () => {
  const local = defaultState(); local.teams[0].leader = 'Local leader'; local.teams[1].participants = 15;
  local.notes[4] = 'Local note'; local.committeeNotes.judges = { general: 'Local instruction' };
  local.cavalry.divisions.men.counts[2] = 4; local.cavalry.rule = 'Local arena instruction';
  const remote = defaultState(); remote.teams[0].name = 'Crimson'; remote.borrow.scores[0][0] = 5;
  const next = mergePublicState(publicSnapshot(remote), local);
  assert.equal(next.teams[0].name, 'Crimson'); assert.equal(next.borrow.scores[0][0], 5);
  assert.equal(next.teams[0].leader, 'Local leader'); assert.equal(next.teams[1].participants, 15);
  assert.deepEqual(next.notes, local.notes); assert.deepEqual(next.committeeNotes, local.committeeNotes);
  assert.equal(next.cavalry.divisions.men.counts[2], 4); assert.equal(next.cavalry.rule, local.cavalry.rule);
  assert.equal(local.teams[0].name, 'Red', 'The merge cannot mutate the old state.');
});

await test('Approved tie decisions preserve championship points without exposing explanations', () => {
  const s = defaultState(); s.borrow.scores.forEach(row => row.fill(2));
  s.placements.borrow = { rule: 'Decided by a private committee note', values: [1, 2, 3, 4, 5] };
  const restored = mergePublicState(publicSnapshot(s));
  assert.deepEqual(championship(restored), championship(s));
  assert.equal(restored.placements.borrow.rule, 'Approved result');
  const plain = defaultState(); plain.borrow.scores.forEach(row => row.fill(2));
  assert.equal(mergePublicState(publicSnapshot(plain), s).placements.borrow.rule, '', 'An old local decision cannot override new shared ties.');
});

await test('Timer deadlines use server time and return to each phone’s local clock', () => {
  const s = defaultState(); s.timers['borrow:0'] = makeClock(30); startClock(s.timers, 'borrow:0', 100000); s.activeKey = 'borrow:0';
  const snapshot = publicSnapshot(s, { offsetMs: 9000 });
  assert.equal(snapshot.timers['borrow:0'].deadline, 139000);
  assert.equal(s.timers['borrow:0'].deadline, 130000);
  const viewer = mergePublicState(snapshot, defaultState(), { offsetMs: -2000 });
  assert.equal(viewer.timers['borrow:0'].deadline, 141000);
});

await test('Malformed shared scores, timers and approval flags are rejected before merging', () => {
  const snapshot = publicSnapshot(defaultState());
  for (const mutate of [s => s.relay.scores[0][0] = 6, s => s.placements.tug.approved = 'yes', s => s.timers = [], s => s.teams[0].id = 'unknown']) {
    const invalid = structuredClone(snapshot); mutate(invalid); assert.throws(() => mergePublicState(invalid));
  }
});

await test('Legacy shared snapshots normalize roster defaults and cannot retain a viewer-only roster', () => {
  const legacy=publicSnapshot(defaultState());delete legacy.committeeMembers;
  const local=defaultState();local.committeeMembers.director[0]='Old local name';local.committeeNotes.director={general:'Private reminder'};
  const merged=mergePublicState(legacy,local);
  assert.deepEqual(merged.committeeMembers,defaultState().committeeMembers);
  assert.deepEqual(merged.committeeNotes,local.committeeNotes);
  for(const members of [null,{}, {...defaultState().committeeMembers,director:['One','Two']}, {...defaultState().committeeMembers,unknown:['Name']}]){
    assert.throws(()=>mergePublicState({...legacy,committeeMembers:members}));
  }
});

await test('New wire snapshots keep the exact 21-item map accepted by v47 phones and carry cold packs separately',()=>{
  const oldIds=['gloves','cones','balls','batons','rider-cloth','colour-sticks','borrow-cards','basket','rope','leg-ties','spoons','mat','whistle','icebox','cart','umbrellas','pens-markers','phones-timer','bags','food-water','prizes'];
  const state=defaultState();state.equipmentReady['cold-packs']=true;state.equipmentReady.basket=true;
  const snapshot=publicSnapshot(state);
  // The prior release rebuilds known fields and requires this exact nested map.
  const readV47Equipment=value=>{
    assert.equal(Object.keys(value.equipmentReady).length,oldIds.length);
    assert.equal(Object.keys(value.equipmentReady).some(id=>!oldIds.includes(id)),false);
    for(const id of oldIds)assert.equal(typeof value.equipmentReady[id],'boolean');
    return Object.fromEntries(oldIds.map(id=>[id,value.equipmentReady[id]]));
  };
  assert.equal(readV47Equipment(snapshot).basket,true);assert.equal(snapshot.equipmentColdPacksReady,true);
  assert.equal(Object.hasOwn(snapshot.equipmentReady,'cold-packs'),false);
  assert.deepEqual(mergePublicState(snapshot).equipmentReady,state.equipmentReady);
  const legacy=structuredClone(snapshot);delete legacy.equipmentColdPacksReady;
  assert.equal(mergePublicState(legacy).equipmentReady['cold-packs'],false);
  const transitional=structuredClone(legacy);transitional.equipmentReady['cold-packs']=true;
  assert.deepEqual(mergePublicState(transitional).equipmentReady,state.equipmentReady);
  assert.equal(publicSnapshot(mergePublicState(transitional)).equipmentColdPacksReady,true);
  for(const invalid of [null,1,'true',[],{}]){
    assert.throws(()=>mergePublicState({...snapshot,equipmentColdPacksReady:invalid}));
    assert.throws(()=>mergePublicState({...snapshot,equipmentReady:{...snapshot.equipmentReady,'cold-packs':invalid}}));
  }
});

await test('Missing legacy equipment readiness defaults without importing a viewer’s private setup ticks',()=>{
  const old=publicSnapshot(defaultState());delete old.equipmentReady;
  const local=defaultState();local.equipmentReady.basket=true;local.committeeChecklist['inventory:setup:rope']=true;
  const merged=mergePublicState(old,local);assert.deepEqual(merged.equipmentReady,defaultState().equipmentReady);
  assert.deepEqual(merged.committeeChecklist,local.committeeChecklist);
  for(const ready of [null,{}, {...defaultState().equipmentReady,unknown:true}, {...defaultState().equipmentReady,balls:'yes'}]){
    assert.throws(()=>mergePublicState({...old,equipmentReady:ready}));
  }
});

await test('Anonymous viewers receive public scores but cannot queue writes',async()=>{
  const f=fixture(),viewer=f.service();await viewer.sync.start();
  assert.equal(viewer.sync.role,'viewer');assert.equal(viewer.sync.queue(defaultState()),false);
  assert.equal(applyCalls(f).length,0);assert.equal(viewer.delivered.length,1);
});

await test('The same approved login edits simultaneously on independent devices without a transfer',async()=>{
  const f=fixture(),a=await editor(f),b=await editor(f);
  await Promise.all([a.sync.refresh(),b.sync.refresh()]);
  assert.notEqual(a.storage,b.storage);assert.equal(a.sync.role,'writer');assert.equal(b.sync.role,'writer');
  const authorized=f.calls.filter(call=>call.path.endsWith('/authorize_sports_day_editor'));
  assert.equal(authorized.length,2);assert.notEqual(authorized[0].body.p_device_id,authorized[1].body.p_device_id);
  assert.equal(f.calls.some(call=>/claim_sports_day_writer|release_sports_day_writer/.test(call.path)),false);
});

await test('A valid but unapproved login remains a viewer',async()=>{
  const f=fixture(),device=f.service();await device.sync.start();await device.sync.login('other@example.org','password');
  await assert.rejects(device.sync.claimWriter(),/scorekeeper/i);
  assert.equal(device.sync.role,'viewer');assert.equal(device.sync.queue(defaultState()),false);assert.equal(applyCalls(f).length,0);
});

await test('An old backend cannot authorize new simultaneous writes and stays readable',async()=>{
  const f=fixture();f.upgrade(true);const device=f.service();await device.sync.start();await device.sync.login('keeper@example.org','password');
  await device.sync.claimWriter().catch(()=>{});
  assert.equal(device.sync.role,'viewer');assert.equal(device.sync.queue(defaultState()),false);assert.equal(applyCalls(f).length,0);
  assert.equal(device.state.teams[0].name,'Red');
});

await test('Concurrent distinct roster names merge without losing either phone’s change',async()=>{
  const f=fixture(),a=await editor(f),b=await editor(f);
  edit(a,s=>s.committeeMembers.director[0]='Main judge');edit(b,s=>s.committeeMembers.equipment[0]='Rina');
  await settle(a,b);
  assert.equal(f.shared.committeeMembers.director[0],'Main judge');assert.equal(f.shared.committeeMembers.equipment[0],'Rina');
  for(const d of [a,b]){assert.equal(d.sync.pending,0);assert.equal(d.state.committeeMembers.director[0],'Main judge');assert.equal(d.state.committeeMembers.equipment[0],'Rina');}
});

await test('The appended food and communications slots sync independently across scorekeeper devices',async()=>{
  const f=fixture(),a=await editor(f),b=await editor(f);
  edit(a,s=>s.committeeMembers['food-water'][3]='Olin');edit(b,s=>s.committeeMembers.comms[3]='Jesslyn');
  await settle(a,b);
  for(const d of [a,b]){assert.equal(d.sync.pending,0);assert.equal(d.state.committeeMembers['food-water'][3],'Olin');assert.equal(d.state.committeeMembers.comms[3],'Jesslyn');}
  assert.equal(f.shared.committeeMembers['food-water'][3],'Olin');assert.equal(f.shared.committeeMembers.comms[3],'Jesslyn');
  assert.ok(applyCalls(f).every(call=>call.body.p_snapshot.committeeMembers['food-water'].length===4&&call.body.p_snapshot.committeeMembers.comms.length===4));
});

await test('Appended volunteers keep separate stable rotation IDs when devices edit the same round',async()=>{
  const initial=defaultState();initial.committeeMembers['food-water'][3]='Olin';initial.committeeMembers.comms[3]='Jesslyn';
  const f=fixture({snapshot:publicSnapshot(initial)}),a=await editor(f),b=await editor(f);
  edit(a,s=>s.committeeRotation['borrow:0']={'food-water:3':{status:'playing',coverFor:null}});
  edit(b,s=>s.committeeRotation['borrow:0']={'comms:3':{status:'duty',coverFor:null}});
  await settle(a,b);
  for(const d of [a,b]){assert.equal(d.sync.pending,0);assert.deepEqual(d.state.committeeRotation['borrow:0'],{'food-water:3':{status:'playing',coverFor:null},'comms:3':{status:'duty',coverFor:null}});}
});

await test('Concurrent different equipment checks include cold packs and unchecked values',async()=>{
  const initial=defaultState();initial.equipmentReady.rope=true;
  const f=fixture({snapshot:publicSnapshot(initial)}),a=await editor(f),b=await editor(f);
  edit(a,s=>s.equipmentReady.rope=false);edit(b,s=>s.equipmentReady['cold-packs']=true);
  await settle(a,b);
  assert.equal(f.shared.equipmentReady.rope,false);assert.equal(f.shared.equipmentColdPacksReady,true);
  assert.equal(a.state.equipmentReady['cold-packs'],true);assert.equal(b.state.equipmentReady.rope,false);
});

await test('Concurrent team names and separate rota assignments preserve both public changes',async()=>{
  const f=fixture(),a=await editor(f),b=await editor(f);
  edit(a,s=>{s.teams[0].name='Crimson';s.committeeRotation['borrow:0']={'comms:0':{status:'playing',coverFor:null}};});
  edit(b,s=>{s.teams[1].name='Ocean';s.committeeRotation['borrow:0']={'comms:1':{status:'duty',coverFor:null}};});
  await settle(a,b);
  assert.equal(f.shared.teams[0].name,'Crimson');assert.equal(f.shared.teams[1].name,'Ocean');
  assert.deepEqual(Object.keys(f.shared.committeeRotation['borrow:0']).sort(),['comms:0','comms:1']);
});

await test('Concurrent conflicting edits to the same roster slot stop for review',async()=>{
  const f=fixture(),a=await editor(f),b=await editor(f);
  edit(a,s=>s.committeeMembers.director[0]='Judge A');edit(b,s=>s.committeeMembers.director[0]='Judge B');
  await settle(a,b);
  assert.ok(['Judge A','Judge B'].includes(f.shared.committeeMembers.director[0]));
  const blocked=[a,b].filter(d=>d.sync.status.phase==='conflict');assert.equal(blocked.length,1);assert.ok(blocked[0].sync.pending);
  assert.equal(blocked[0].sync.queue(blocked[0].state),false);
});

await test('Concurrent Borrow and Relay arrivals never merge duplicate first awards',async()=>{
  for(const game of ['borrow','relay']) {
    const initial=defaultState();startRound(initial,`${game}:0`);
    const f=fixture({snapshot:publicSnapshot(initial)}),a=await editor(f),b=await editor(f);
    edit(a,s=>assert.equal(recordSuccess(s,game,0,'red'),true));edit(b,s=>assert.equal(recordSuccess(s,game,0,'blue'),true));
    await settle(a,b);
    const saved=f.shared[game].scores.map(row=>row[0]).filter(value=>value!==null);
    assert.deepEqual(saved,game==='borrow'?[5,4]:[1,2]);assert.equal(a.sync.pending,0);assert.equal(b.sync.pending,0);
  }
});

await test('Two phones recording the same team’s success save one award, not two',async()=>{
  const initial=defaultState();startRound(initial,'borrow:0');
  const f=fixture({snapshot:publicSnapshot(initial)}),a=await editor(f),b=await editor(f);
  edit(a,s=>assert.equal(recordSuccess(s,'borrow',0,'red'),true));edit(b,s=>assert.equal(recordSuccess(s,'borrow',0,'red'),true));await settle(a,b);
  assert.deepEqual(f.shared.borrow.scores.map(row=>row[0]),[5,null,null,null,null]);assert.equal(f.revision,1);
  assert.equal(a.sync.pending,0);assert.equal(b.sync.pending,0);
});

await test('A simultaneous success and fail for the same team require review',async()=>{
  const initial=defaultState();startRound(initial,'borrow:0');
  const f=fixture({snapshot:publicSnapshot(initial)}),a=await editor(f),b=await editor(f);
  edit(a,s=>assert.equal(recordSuccess(s,'borrow',0,'red',true),true));edit(b,s=>assert.equal(recordSuccess(s,'borrow',0,'red',false),true));await settle(a,b);
  assert.equal(f.shared.borrow.scores[0][0],5);assert.equal(b.sync.status.phase,'conflict');assert.ok(b.sync.pending);
});

await test('Concurrent Cavalry eliminations append once in server commit order',async()=>{
  const initial=defaultState();startRound(initial,'cavalry:women');initial.cavalry.divisions.women={active:[...TEAM_IDS],eliminated:[],started:true,counts:Array(5).fill(null)};
  const f=fixture({snapshot:publicSnapshot(initial)}),a=await editor(f),b=await editor(f);
  edit(a,s=>assert.equal(eliminate(s,'women','red'),true));edit(b,s=>assert.equal(eliminate(s,'women','blue'),true));await settle(a,b);
  assert.deepEqual(f.shared.cavalry.divisions.women.eliminated,['red','blue']);
  assert.equal(a.sync.pending,0);assert.equal(b.sync.pending,0);
});

await test('A late Basket count cannot overwrite an attempt another phone has locked',async()=>{
  const initial=defaultState();startRound(initial,'basket:red:0');initial.basket.scores[0][0]=2;
  const f=fixture({snapshot:publicSnapshot(initial)}),a=await editor(f),b=await editor(f),gate=b.holdApply();
  edit(b,s=>assert.equal(setBasketScore(s,'red',0,4),true));await gate.entered;
  edit(a,s=>{assert.equal(setBasketScore(s,'red',0,3),true);assert.equal(finishBasketAttempt(s,'red',0),true);});await a.sync.flush();
  gate.release();await b.sync.flush();
  assert.equal(f.shared.basket.scores[0][0],3);assert.ok(f.shared.finished.includes('basket:red:0'));assert.equal(b.sync.status.phase,'conflict');
});

await test('Concurrent Tug semifinal results cannot replace each other’s tournament snapshot',async()=>{
  const initial=defaultState();initial.tug.slots=[...TEAM_IDS];initial.tug.locked=true;initial.tug.winners.prelim='red';
  for(const key of ['tug:semi1','tug:semi2']){initial.timers[key]=makeClock(60);initial.timers[key].started=true;}
  const f=fixture({snapshot:publicSnapshot(initial)}),a=await editor(f),b=await editor(f);
  edit(a,s=>assert.equal(recordWinner(s,'semi1','yellow'),true));edit(b,s=>assert.equal(recordWinner(s,'semi2','green'),true));await settle(a,b);
  assert.equal(f.shared.tug.winners.semi1,'yellow');assert.equal(f.shared.tug.winners.semi2,'green');assert.equal(f.shared.tug.winners.prelim,'red');
  assert.equal(a.sync.pending,0);assert.equal(b.sync.pending,0);
});

await test('Competing timer starts leave exactly one running shared clock',async()=>{
  const f=fixture(),a=await editor(f),b=await editor(f);
  edit(a,s=>startRound(s,'borrow:0',f.now()));edit(b,s=>startRound(s,'relay:0',f.now()));await settle(a,b);
  const running=Object.entries(f.shared.timers).filter(([,clock])=>clock.deadline!==null);
  assert.equal(running.length,1);assert.equal(f.shared.activeKey,running[0][0]);assert.equal(f.shared.activeKey,'relay:0');
  assert.equal(f.shared.timers['borrow:0'].deadline,null);assert.equal(a.sync.pending,0);assert.equal(b.sync.pending,0);
});

await test('A timer extension on one device survives a simultaneous scoring tap on another',async()=>{
  const initial=defaultState();startRound(initial,'borrow:0');
  const f=fixture({snapshot:publicSnapshot(initial)}),a=await editor(f),b=await editor(f),gate=b.holdApply();
  edit(b,s=>assert.equal(recordSuccess(s,'borrow',0,'red'),true));await gate.entered;
  edit(a,s=>addTime(s.timers['borrow:0'],30,f.now()));await a.sync.flush();gate.release();await b.sync.flush();
  assert.equal(f.shared.borrow.scores[0][0],5);assert.equal(b.sync.pending,0);assert.equal(f.shared.timers['borrow:0'].deadline,f.now()+90000);
});

await test('Distinct simultaneous 30-second extensions accumulate after a revision conflict',async()=>{
  const initial=defaultState();startRound(initial,'borrow:0');
  const f=fixture({snapshot:publicSnapshot(initial),automaticRealtime:false}),a=await editor(f),b=await editor(f),gate=a.holdApply();
  edit(a,s=>addTime(s.timers['borrow:0'],30,f.now()));await gate.entered;
  edit(b,s=>addTime(s.timers['borrow:0'],30,f.now()));await b.sync.flush();gate.release();await a.sync.flush();await settle(a,b);
  assert.equal(f.shared.timers['borrow:0'].deadline,f.now()+120000);assert.equal(a.sync.pending,0);assert.equal(b.sync.pending,0);assert.equal(f.revision,2);
});

await test('An already committed extension is not projected twice while its acknowledgement and a later local extension wait',async()=>{
  for(const loseAck of [false,true]) {
    const initial=defaultState();startRound(initial,'borrow:0');
    const f=fixture({snapshot:publicSnapshot(initial),automaticRealtime:false}),a=await editor(f),gate=a.holdApply({after:true});if(loseAck)a.loseAck();
    edit(a,s=>addTime(s.timers['borrow:0'],30,f.now()));await gate.entered;await a.sync.refresh();
    assert.equal(a.state.timers['borrow:0'].deadline,f.now()+90000,'An uncertain receipt cannot add the same pending extension again.');
    edit(a,s=>addTime(s.timers['borrow:0'],30,f.now()));assert.equal(a.state.timers['borrow:0'].deadline,f.now()+120000);
    gate.release();await a.sync.flush();await a.sync.flush();
    assert.equal(f.shared.timers['borrow:0'].deadline,f.now()+120000);assert.equal(a.sync.pending,0);assert.equal(f.revision,2);
  }
});

await test('Round reset plus identical restart cannot revive an older offline arrival',async()=>{
  const initial=defaultState();startRound(initial,'borrow:0');
  const f=fixture({snapshot:publicSnapshot(initial)}),a=await editor(f),b=await editor(f);b.offline(true);
  edit(b,s=>assert.equal(recordSuccess(s,'borrow',0,'red'),true));await b.sync.flush();
  edit(a,s=>resetRound(s,'borrow:0'),{barrier:true});await a.sync.flush();
  edit(a,s=>Object.assign(s,clone(initial)));await a.sync.flush();assert.deepEqual(f.shared,publicSnapshot(initial));
  b.offline(false);await b.sync.flush();assert.equal(b.sync.status.phase,'conflict');assert.equal(f.shared.borrow.scores[0][0],null);assert.ok(b.sync.pending);
});

await test('Explicit no-op whole-event reset is a barrier against older pending edits',async()=>{
  const f=fixture(),a=await editor(f),b=await editor(f);b.offline(true);edit(b,s=>s.equipmentReady.rope=true);await b.sync.flush();
  assert.equal(a.sync.queue(a.state,{barrier:true}),true);await a.sync.flush();assert.ok(f.resetRevision>0);
  b.offline(false);await b.sync.flush();assert.equal(b.sync.status.phase,'conflict');assert.equal(f.shared.equipmentReady.rope,false);
});

await test('Tug reset invalidates dependent semifinal and final work across devices',async()=>{
  const initial=defaultState();initial.tug.slots=[...TEAM_IDS];initial.tug.locked=true;initial.tug.winners.prelim='red';
  for(const key of ['tug:prelim','tug:semi1']){initial.timers[key]=makeClock(60);initial.timers[key].started=true;}
  const f=fixture({snapshot:publicSnapshot(initial)}),a=await editor(f),b=await editor(f);b.offline(true);
  edit(b,s=>assert.equal(recordWinner(s,'semi1','yellow'),true));await b.sync.flush();
  edit(a,s=>resetRound(s,'tug:prelim'),{barrier:true});await a.sync.flush();b.offline(false);await b.sync.flush();
  assert.equal(f.shared.tug.winners.prelim,null);assert.equal(f.shared.tug.winners.semi1,null);assert.equal(f.shared.timers['tug:semi1'],undefined);assert.equal(b.sync.status.phase,'conflict');
});

await test('A lost acknowledgement remains idempotent after another device commits later work',async()=>{
  const f=fixture({automaticRealtime:false}),a=await editor(f),b=await editor(f);a.loseAck();
  edit(a,s=>s.equipmentReady.rope=true);await a.sync.flush();assert.equal(a.sync.pending,1);assert.equal(f.revision,1);
  await b.sync.refresh();edit(b,s=>s.committeeMembers.equipment[0]='Rina');await b.sync.flush();assert.equal(f.revision,2);
  await a.sync.flush();assert.equal(a.sync.pending,0);assert.equal(f.revision,2);assert.equal(a.sync.status.revision,2);
  assert.equal(a.state.equipmentReady.rope,true);assert.equal(a.state.committeeMembers.equipment[0],'Rina');
  const retries=applyCalls(f).filter(call=>call.body.p_snapshot.equipmentReady.rope&&call.body.p_snapshot.committeeMembers.equipment[0]==='');
  assert.equal(retries.length,2);assert.deepEqual(retries[0].body,retries[1].body);
});

await test('An unattempted tail rebases after an acknowledged retry without erasing another phone’s work',async()=>{
  const f=fixture({automaticRealtime:false}),a=await editor(f),b=await editor(f);a.loseAck();edit(a,s=>s.equipmentReady.rope=true);await a.sync.flush();
  a.offline(true);edit(a,s=>s.committeeMembers.equipment[0]='Rina');await a.sync.flush();assert.equal(a.sync.pending,2);
  await b.sync.refresh();edit(b,s=>s.equipmentReady['cold-packs']=true);await b.sync.flush();
  a.offline(false);await a.sync.flush();await settle(a,b);
  assert.equal(a.sync.pending,0);assert.equal(f.shared.equipmentReady.rope,true);assert.equal(f.shared.equipmentColdPacksReady,true);assert.equal(f.shared.committeeMembers.equipment[0],'Rina');
  assert.equal(a.state.equipmentReady['cold-packs'],true);assert.equal(b.state.committeeMembers.equipment[0],'Rina');
});

await test('A delayed successful response cannot roll back a newer realtime snapshot or its queued tail',async()=>{
  const f=fixture({automaticRealtime:false}),a=await editor(f),b=await editor(f),gate=a.holdApply({after:true});
  edit(a,s=>s.equipmentReady.rope=true);await gate.entered;
  await b.sync.refresh();edit(b,s=>s.committeeMembers.comms[0]='Jenni');await b.sync.flush();await a.sync.refresh();
  edit(a,s=>s.teams[0].name='Crimson');gate.release();await a.sync.flush();await settle(a,b);
  assert.equal(a.sync.pending,0);assert.equal(a.sync.status.phase,'synced');assert.equal(a.state.committeeMembers.comms[0],'Jenni');
  assert.equal(f.shared.committeeMembers.comms[0],'Jenni');assert.equal(f.shared.teams[0].name,'Crimson');assert.equal(f.shared.equipmentReady.rope,true);
});

await test('Pending devices receive unrelated confirmed changes without losing their optimistic edit',async()=>{
  const f=fixture({automaticRealtime:false}),a=await editor(f),b=await editor(f),gate=a.holdApply();
  edit(a,s=>s.equipmentReady.rope=true);await gate.entered;
  edit(b,s=>s.committeeMembers.comms[0]='Jenni');await b.sync.flush();await a.sync.refresh();
  assert.equal(a.state.committeeMembers.comms[0],'Jenni');assert.equal(a.state.equipmentReady.rope,true);assert.ok(a.sync.pending);
  gate.release();await a.sync.flush();assert.equal(f.shared.equipmentReady.rope,true);assert.equal(f.shared.committeeMembers.comms[0],'Jenni');
});

await test('Repeated timeouts after commit retry one immutable operation and award once',async()=>{
  const f=fixture({automaticRealtime:false});let stalls=2;
  const a=await editor(f,{requestTimeoutMs:5,fetch:async(url,options)=>{
    const result=await f.fetch(url,options);
    if(url.includes('/apply_sports_day_patch')&&stalls-->0)return{ok:true,status:200,json:()=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('Body aborted'),{name:'AbortError'})),{once:true}))};
    return result;
  }});
  edit(a,s=>s.equipmentReady.rope=true);await a.sync.flush();assert.equal(a.sync.pending,1);
  await a.sync.flush();assert.equal(a.sync.pending,1);await a.sync.flush();assert.equal(a.sync.pending,0);
  assert.equal(f.revision,1);const requests=applyCalls(f);assert.equal(requests.length,3);assert.deepEqual(requests[0].body,requests[1].body);assert.deepEqual(requests[1].body,requests[2].body);
});

await test('Modern offline queues survive reload, accept new edits and sync after reconnecting',async()=>{
  const f=fixture({automaticRealtime:false}),a=await editor(f);a.offline(true);
  edit(a,s=>s.equipmentReady.rope=true);await a.sync.flush();edit(a,s=>s.committeeMembers.equipment[0]='Rina');await a.sync.flush();a.sync.stop();
  const reloaded=f.service({storage:a.storage,initialState:a.state});reloaded.offline(true);await reloaded.sync.start();
  assert.ok(reloaded.sync.pending);assert.equal(reloaded.sync.role,'writer');assert.equal(edit(reloaded,s=>s.equipmentReady['cold-packs']=true),true);
  reloaded.offline(false);await reloaded.sync.claimWriter();await reloaded.sync.flush();
  assert.equal(reloaded.sync.pending,0);assert.equal(f.shared.equipmentReady.rope,true);assert.equal(f.shared.equipmentColdPacksReady,true);assert.equal(f.shared.committeeMembers.equipment[0],'Rina');
});

await test('An offline unrelated edit rebases onto the latest state without dropping confirmed changes',async()=>{
  const f=fixture({automaticRealtime:false}),a=await editor(f),b=await editor(f);a.offline(true);
  edit(a,s=>s.equipmentReady.rope=true);await a.sync.flush();edit(b,s=>s.equipmentReady['cold-packs']=true);await b.sync.flush();
  a.offline(false);await a.sync.flush();assert.equal(a.sync.pending,0);assert.equal(f.shared.equipmentReady.rope,true);assert.equal(f.shared.equipmentColdPacksReady,true);
});

await test('A conflict remains blocked through sign-in and reload until confirmed state is loaded',async()=>{
  const f=fixture({automaticRealtime:false}),a=await editor(f),b=await editor(f);a.offline(true);
  edit(a,s=>s.committeeMembers.director[0]='Offline judge');await a.sync.flush();edit(b,s=>s.committeeMembers.director[0]='Confirmed judge');await b.sync.flush();
  a.offline(false);await a.sync.flush();assert.equal(a.sync.status.phase,'conflict');const attempts=applyCalls(f).length;
  await a.sync.login('keeper@example.org','password');await a.sync.claimWriter();await a.sync.flush();assert.equal(a.sync.status.phase,'conflict');
  a.sync.stop();const reloaded=f.service({storage:a.storage,initialState:a.state});await reloaded.sync.start();
  assert.equal(reloaded.sync.status.phase,'conflict');assert.ok(reloaded.sync.pending);assert.equal(applyCalls(f).length,attempts);
  await reloaded.sync.acceptRemote();assert.equal(reloaded.sync.pending,0);assert.equal(reloaded.state.committeeMembers.director[0],'Confirmed judge');
});

await test('Version-one snapshot outboxes are quarantined rather than submitted under the new protocol',async()=>{
  const f=fixture({automaticRealtime:false}),a=await editor(f),key=[...a.storage.data.keys()][0],record=JSON.parse(a.storage.getItem(key));
  const pending=defaultState();pending.borrow.scores[0][0]=5;
  const legacy={writerId:f.uuid(),session:record.session,wantsWriter:true,revision:0,leaseRevision:1,offsetMs:0,outbox:[{baseRevision:0,leaseRevision:1,operationId:f.uuid(),snapshot:publicSnapshot(pending),attempted:true}]};
  a.sync.stop();a.storage.setItem(key,JSON.stringify(legacy));const reloaded=f.service({storage:a.storage,initialState:pending});await reloaded.sync.start();
  assert.equal(reloaded.sync.status.phase,'conflict');assert.equal(reloaded.sync.pending,1);assert.equal(reloaded.sync.status.legacyPending,true);assert.equal(applyCalls(f).length,0);
  assert.equal(reloaded.sync.queue(pending),false);await reloaded.sync.acceptRemote();assert.equal(reloaded.sync.pending,0);assert.equal(reloaded.state.borrow.scores[0][0],null);
});

await test('Private notes and server key ordering never create shared writes',async()=>{
  const reverse=value=>Array.isArray(value)?value.map(reverse):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,nested])=>[key,reverse(nested)])):value;
  const initial=defaultState();startRound(initial,'borrow:0');const snapshot=reverse(publicSnapshot(initial));delete snapshot.committeeRotation;
  const f=fixture({snapshot}),a=await editor(f),before=applyCalls(f).length;
  edit(a,s=>{s.notes[4]='Private note';s.teams[0].leader='Private leader';s.committeeChecklist['inventory:setup:rope']=true;});await a.sync.flush();
  assert.equal(applyCalls(f).length,before);assert.equal(a.state.notes[4],'Private note');assert.equal(a.state.teams[0].leader,'Private leader');
  f.jitter(250);await a.sync.refresh();edit(a,s=>s.committeeNotes['first-aid']={general:'Private health note'});await a.sync.flush();assert.equal(applyCalls(f).length,before);
});

await test('Server acknowledgements preserve each device’s private notes and team leaders',async()=>{
  const f=fixture(),a=await editor(f),b=await editor(f);
  a.state.notes[4]='A private note';a.state.teams[0].leader='A leader';b.state.notes[4]='B private note';b.state.teams[0].leader='B leader';
  edit(a,s=>s.equipmentReady.rope=true);edit(b,s=>s.equipmentReady['cold-packs']=true);await settle(a,b);
  assert.equal(a.state.notes[4],'A private note');assert.equal(b.state.notes[4],'B private note');assert.equal(a.state.teams[0].leader,'A leader');assert.equal(b.state.teams[0].leader,'B leader');
  for(const privateText of ['A private note','B private note','A leader','B leader'])assert.equal(JSON.stringify(f.shared).includes(privateText),false);
});

await test('Concurrent final Relay arrivals recompute fourth and fifth and pause the completed round',async()=>{
  const initial=defaultState();startRound(initial,'relay:0');initial.relay.scores[0][0]=1;initial.relay.scores[1][0]=2;initial.relay.scores[2][0]=3;
  const f=fixture({snapshot:publicSnapshot(initial)}),a=await editor(f),b=await editor(f);
  edit(a,s=>assert.equal(recordSuccess(s,'relay',0,'green'),true));edit(b,s=>assert.equal(recordSuccess(s,'relay',0,'white'),true));await settle(a,b);
  assert.deepEqual(f.shared.relay.scores.map(row=>row[0]),[1,2,3,4,5]);assert.equal(f.shared.timers['relay:0'].deadline,null);assert.equal(f.shared.activeKey,null);
  assert.equal(a.sync.pending,0);assert.equal(b.sync.pending,0);
});

await test('Competing final Cavalry outs cannot eliminate the last remaining horse',async()=>{
  const initial=defaultState();startRound(initial,'cavalry:women');initial.cavalry.divisions.women={active:['red','blue'],eliminated:[],started:true,counts:Array(5).fill(null)};
  const f=fixture({snapshot:publicSnapshot(initial)}),a=await editor(f),b=await editor(f);
  edit(a,s=>assert.equal(eliminate(s,'women','red'),true));edit(b,s=>assert.equal(eliminate(s,'women','blue'),true));await settle(a,b);
  assert.deepEqual(f.shared.cavalry.divisions.women.eliminated,['red']);assert.equal(f.shared.timers['cavalry:women'].deadline,null);
  assert.equal(b.sync.status.phase,'conflict');assert.ok(b.sync.pending);
});

await test('An ordered arrival tail recomputes points after a lost acknowledgement and another phone’s finish',async()=>{
  const initial=defaultState();startRound(initial,'borrow:0');
  const f=fixture({snapshot:publicSnapshot(initial),automaticRealtime:false}),a=await editor(f),b=await editor(f);
  a.loseAck();edit(a,s=>assert.equal(recordSuccess(s,'borrow',0,'red'),true));await a.sync.flush();
  a.offline(true);edit(a,s=>assert.equal(recordSuccess(s,'borrow',0,'blue'),true));await a.sync.flush();
  await b.sync.refresh();edit(b,s=>assert.equal(recordSuccess(s,'borrow',0,'yellow'),true));await b.sync.flush();
  a.offline(false);await a.sync.flush();await settle(a,b);
  assert.deepEqual(f.shared.borrow.scores.map(row=>row[0]),[5,3,4,null,null]);assert.equal(a.sync.pending,0);assert.equal(f.revision,3);
});

await test('Clock-skewed devices agree on one server-time timer deadline',async()=>{
  const f=fixture(),a=await editor(f,{localOffset:90000}),b=await editor(f,{localOffset:-45000});
  edit(a,s=>startRound(s,'relay:0',f.now()+90000));await a.sync.flush();await b.sync.refresh();
  assert.equal(f.shared.timers['relay:0'].deadline,f.now()+60000);assert.equal(a.sync.offsetMs,-90000);assert.equal(b.sync.offsetMs,45000);
  assert.equal(a.state.timers['relay:0'].deadline-(f.now()+90000),60000);assert.equal(b.state.timers['relay:0'].deadline-(f.now()-45000),60000);
});

await test('Stopping editing on one device leaves the other approved device editable',async()=>{
  const f=fixture(),a=await editor(f),b=await editor(f);await a.sync.releaseWriter();await b.sync.refresh();
  assert.equal(a.sync.role,'viewer');assert.equal(b.sync.role,'writer');edit(b,s=>s.equipmentReady.rope=true);await b.sync.flush();assert.equal(f.shared.equipmentReady.rope,true);
  assert.equal(f.calls.some(call=>call.path.endsWith('/release_sports_day_writer')),false);
});

await test('Stopping editing disables new local changes immediately while an in-flight request settles',async()=>{
  const f=fixture(),a=await editor(f),gate=a.holdApply();edit(a,s=>s.equipmentReady.rope=true);await gate.entered;
  const stopped=a.sync.releaseWriter();assert.equal(a.sync.role,'viewer');assert.equal(a.sync.queue(a.state),false);
  gate.release();await stopped;assert.equal(a.sync.role,'viewer');
});

await test('Sign-out is local and does not revoke the other device’s refresh session',async()=>{
  const f=fixture(),a=await editor(f),b=await editor(f);await a.sync.logout();
  assert.equal(a.sync.session,null);assert.equal(a.sync.role,'viewer');const logout=f.calls.find(call=>call.path==='/auth/v1/logout');assert.equal(logout.search,'?scope=local');
  f.advance(3600000);await b.sync.claimWriter();assert.equal(b.sync.role,'writer');edit(b,s=>s.equipmentReady.rope=true);await b.sync.flush();assert.equal(f.shared.equipmentReady.rope,true);
});

await test('Credentials stay private and offline sign-out keeps durable pending results',async()=>{
  const f=fixture(),a=await editor(f);assert.equal(a.sync.status.email,'keeper@example.org');assert.equal('access_token' in a.sync.status,false);assert.equal('access_token' in a.sync.session,false);
  assert.equal([...a.storage.data.values()].some(value=>value.includes('private-password')),false);
  a.offline(true);edit(a,s=>s.equipmentReady.rope=true);await a.sync.flush();await a.sync.logout();
  assert.equal(a.sync.pending,1);assert.equal(a.sync.session,null);const record=JSON.parse([...a.storage.data.values()][0]);assert.equal(record.session,null);
});

await test('An invalidated login clears its credentials without discarding pending edits',async()=>{
  const f=fixture(),a=await editor(f);f.denyAccess();edit(a,s=>s.equipmentReady.rope=true);await a.sync.flush();
  assert.equal(a.sync.status.phase,'signed-out');assert.equal(a.sync.status.signedIn,false);assert.equal(a.sync.role,'viewer');assert.equal(a.sync.pending,1);
});

await test('Revoked editor approval disables editing but retains the login and pending recovery copy',async()=>{
  const f=fixture(),a=await editor(f);f.revokeApproval();edit(a,s=>s.equipmentReady.rope=true);await a.sync.flush();
  assert.equal(a.sync.role,'viewer');assert.equal(a.sync.status.signedIn,true);assert.equal(a.sync.pending,1);
  assert.equal(f.shared.equipmentReady.rope,false);assert.equal(a.sync.queue(a.state),false);
});

await test('A stalled sign-out request is bounded after the local login has already cleared',async()=>{
  const f=fixture();let device,clearedBeforeRequest=false,hadSignal=false,aborted=false;
  device=await editor(f,{requestTimeoutMs:5,fetch:async(url,options)=>{
    if(new URL(url).pathname!=='/auth/v1/logout')return f.fetch(url,options);
    clearedBeforeRequest=device.sync.session===null&&device.sync.role==='viewer'&&device.statuses.at(-1).signedIn===false;
    hadSignal=Boolean(options.signal);
    if(!options.signal)throw Error('Missing timeout signal');
    return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(Object.assign(Error('Logout aborted'),{name:'AbortError'}));},{once:true}));
  }});
  await device.sync.logout();assert.equal(clearedBeforeRequest,true);assert.equal(hadSignal,true);assert.equal(aborted,true);assert.equal(device.sync.session,null);
});

await test('Realtime invalidation updates viewers and stop removes subscriptions and fallback timers',async()=>{
  const f=fixture({automaticRealtime:false}),viewer=f.service();await viewer.sync.start();
  const changed=defaultState();changed.committeeMembers.equipment[0]='Rina';f.externalUpdate(changed);f.notify();await viewer.sync.refresh();
  assert.equal(viewer.state.committeeMembers.equipment[0],'Rina');assert.equal(f.listeners.size,1);viewer.sync.stop();assert.equal(f.listeners.size,0);assert.equal(f.intervals.size,0);
});

await test('A stalled request times out without preventing cached viewer use',async()=>{
  const f=fixture(),viewer=f.service({requestTimeoutMs:5,fetch:(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('Request aborted')),{once:true}))});
  await viewer.sync.start();assert.equal(viewer.sync.status.phase,'offline');assert.equal(viewer.sync.role,'viewer');assert.equal(viewer.state.teams[0].name,'Red');
});

await test('A stalled JSON response body also times out as a network failure',async()=>{
  const f=fixture(),viewer=f.service({requestTimeoutMs:5,fetch:async(url,options)=>({ok:true,status:200,json:()=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('Body aborted'),{name:'AbortError'})),{once:true}))})});
  await viewer.sync.start();assert.equal(viewer.sync.status.phase,'offline');assert.equal(viewer.sync.status.connected,false);assert.equal(viewer.sync.status.error,'Waiting for a connection.');
});

await test('Storage failure is reported while the pending operation remains recoverable in memory',async()=>{
  const f=fixture(),a=await editor(f);a.storage.setItem=()=>{throw Error('Storage full');};a.offline(true);edit(a,s=>s.equipmentReady.rope=true);await a.sync.flush();
  assert.equal(a.sync.status.storageError,true);assert.equal(a.sync.pending,1);
});

await test('Unreadable pending sync storage is protected from silent replacement',async()=>{
  const f=fixture(),storage=memoryStorage(),key='cg-sports-day-sync:https://test-project.supabase.co:cgs-oct25';storage.setItem(key,'{unfinished');
  const a=f.service({storage});await a.sync.start();await a.sync.login('keeper@example.org','password');await a.sync.claimWriter().catch(()=>{});
  assert.equal(storage.getItem(key),'{unfinished');assert.equal(a.sync.status.storageError,true);
});

for(const result of tests)console.log(`${result.passed?'PASS':'FAIL'} ${result.name}${result.cause?'\n'+result.cause.stack:''}`);
if(tests.some(result=>!result.passed))process.exitCode=1;
console.log(`${tests.filter(result=>result.passed).length}/${tests.length} sync tests passed.`);
