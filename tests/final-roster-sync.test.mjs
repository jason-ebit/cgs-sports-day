import assert from 'node:assert/strict';
import { defaultState } from '../model.js';
import { publicSnapshot, mergePublicState, createSyncService } from '../sync.js';

const clone=value=>structuredClone(value),now=1700000000000;
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const storageKey='cg-sports-day-sync:https://test-project.supabase.co:cgs-oct25';
function legacySnapshot(){
  const snapshot=publicSnapshot(defaultState());
  snapshot.committeeMembers.equipment=['Rina','Timothy','Trishya'];
  snapshot.committeeMembers.comms=['Jenni','Mario'];
  return snapshot;
}
function expandedSnapshot(){
  const snapshot=publicSnapshot(mergePublicState(legacySnapshot()));
  snapshot.committeeMembers.equipment[3]='Darren';snapshot.committeeMembers.comms[2]='Grace';
  snapshot.equipmentReady.cones=true;
  return snapshot;
}
function pending({attempted=false,base=legacySnapshot(),snapshot,number=2}={}){
  const desired=snapshot??clone(base);if(!snapshot)desired.equipmentReady.rope=true;
  const item={operationId:uid(number),baseRevision:7,baseSnapshot:clone(base),snapshot:clone(desired),barrier:false,attempted,request:null};
  if(attempted)item.request={p_event_id:'cgs-oct25',p_device_id:uid(1),p_expected_revision:7,p_operation_id:item.operationId,p_snapshot:clone(desired),p_barrier:false};
  return item;
}
function fixture({items=[],knownReceipt=false,rejectOld=true,initialRecord}={}){
  let revision=9,server=expandedSnapshot(),nextId=100,dropReceipt=false;
  if(knownReceipt)server.equipmentReady.rope=true;
  const original={format:2,writerId:uid(1),session:{access_token:'saved-access',refresh_token:'saved-refresh',expires_at:now/1000+3600,user:{email:'keeper@example.org'}},
    wantsWriter:true,editingMode:'shared-v1',revision:7,unitVersions:{},resetRevision:0,confirmed:legacySnapshot(),presented:clone(items.at(-1)?.snapshot??legacySnapshot()),outbox:clone(items),legacyOutbox:[],conflict:false,conflictMessage:'',offsetMs:0,...initialRecord};
  const data=new Map([[storageKey,JSON.stringify(original)]]),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
  const calls=[],writes=[],services=[];
  const response=body=>({ok:true,status:200,json:async()=>clone(body)});
  const reply=(status,extra={})=>({status,editing_mode:'shared-v1',public_state:clone(server),revision,unit_versions:{'roster:equipment:3':9,'roster:comms:2':9,'equipment:cones':9},reset_revision:0,server_ms:now,...extra});
  async function fetch(url,options){
    const path=new URL(url).pathname,body=JSON.parse(options.body??'{}');calls.push({path,body:clone(body)});
    if(path.endsWith('/read_sports_day_event'))return response(reply('ready'));
    if(path.endsWith('/authorize_sports_day_editor'))return response(reply('authorized'));
    assert.ok(path.endsWith('/apply_sports_day_patch'),path);
    if(knownReceipt&&body.p_operation_id===uid(2)){
      assert.deepEqual(body,items[0].request,'Known old requests must retry without changing their exact payload.');
      if(dropReceipt){dropReceipt=false;throw Error('Receipt lost again.');}
      return response(reply('duplicate',{applied_revision:8}));
    }
    const old=body.p_snapshot.committeeMembers.equipment.length===3&&body.p_snapshot.committeeMembers.comms.length===2;
    if(old&&rejectOld)return response(reply('upgrade_required'));
    assert.equal(body.p_snapshot.committeeMembers.equipment.length,4);assert.equal(body.p_snapshot.committeeMembers.comms.length,3);
    if(body.p_expected_revision!==revision)return response(reply('conflict'));
    mergePublicState(body.p_snapshot);server=clone(body.p_snapshot);revision++;writes.push(clone(body));
    return response(reply('applied',{applied_revision:revision}));
  }
  function device(){
    let visible=defaultState();visible.notes[4]='Private reminder';visible.teams[0].leader='Private leader';
    const sync=createSyncService({url:'https://test-project.supabase.co',publishableKey:'test-key',getStorage:()=>storage,fetch,
      now:()=>now,uuid:()=>uid(++nextId),scheduler:{setInterval:()=>1,clearInterval:()=>{}},
      onRemote:(snapshot,meta)=>visible=mergePublicState(snapshot,visible,meta)});
    services.push(sync);return{sync,get state(){return visible;}};
  }
  return{device,calls,writes,storage,original,loseReceipt:()=>dropReceipt=true,get server(){return server;},saved:()=>JSON.parse(storage.getItem(storageKey)),stop:()=>services.forEach(service=>service.stop())};
}
let passed=0,failed=0;
async function test(name,run){try{await run();passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+'\n'+error.stack);}}

await test('An idle format-two historical roster normalizes without a storage error or a write',async()=>{
  const f=fixture();try{const d=f.device();await d.sync.start();assert.equal(d.sync.status.storageError,false);assert.equal(d.sync.role,'writer');
    assert.deepEqual(d.state.committeeMembers.equipment,['Rina','Timothy','Trishya','Darren']);assert.deepEqual(d.state.committeeMembers.comms,['Jenni','Mario','Grace']);
    assert.equal(f.writes.length,0);assert.equal(d.state.notes[4],'Private reminder');assert.equal(d.state.teams[0].leader,'Private leader');
  }finally{f.stop();}
});
await test('Unattempted historical intent becomes a full new roster without erasing appended server names',async()=>{
  const f=fixture({items:[pending()]});try{const d=f.device();await d.sync.start();await d.sync.flush();assert.equal(d.sync.status.storageError,false);assert.equal(d.sync.pending,0);
    assert.equal(f.writes.length,1);assert.equal(f.server.equipmentReady.rope,true);assert.equal(f.server.equipmentReady.cones,true);
    assert.equal(f.server.committeeMembers.equipment[3],'Darren');assert.equal(f.server.committeeMembers.comms[2],'Grace');
  }finally{f.stop();}
});
await test('An attempted historical request keeps its exact payload until an existing receipt is confirmed',async()=>{
  const item=pending({attempted:true}),f=fixture({items:[item],knownReceipt:true});try{const d=f.device();await d.sync.start();await d.sync.flush();
    assert.equal(d.sync.status.storageError,false);assert.equal(d.sync.pending,0);assert.equal(f.writes.length,0);
    assert.deepEqual(f.calls.find(call=>call.path.endsWith('/apply_sports_day_patch')).body,item.request);
    assert.equal(d.state.committeeMembers.equipment[3],'Darren');assert.equal(d.state.committeeMembers.comms[2],'Grace');
  }finally{f.stop();}
});
await test('A normalized attempted queue can reload again without rewriting its original old request',async()=>{
  const item=pending({attempted:true}),f=fixture({items:[item],knownReceipt:true});try{f.loseReceipt();const first=f.device();await first.sync.start();assert.equal(first.sync.pending,1);
    const saved=f.saved();assert.equal(saved.outbox[0].snapshot.committeeMembers.equipment.length,4);assert.deepEqual(saved.outbox[0].request,item.request);
    first.sync.stop();const second=f.device();await second.sync.start();assert.equal(second.sync.status.storageError,false);assert.equal(second.sync.pending,0);
    const retries=f.calls.filter(call=>call.path.endsWith('/apply_sports_day_patch'));assert.equal(retries.length,2);assert.deepEqual(retries[0].body,retries[1].body);
  }finally{f.stop();}
});
await test('A new unattempted tail follows an old receipt and preserves all newly added roster names',async()=>{
  const head=pending({attempted:true}),tailState=clone(head.snapshot);tailState.equipmentReady['leg-ties']=true;
  const tail=pending({base:head.snapshot,snapshot:tailState,number:3}),f=fixture({items:[head,tail],knownReceipt:true});try{const d=f.device();await d.sync.start();await d.sync.flush();
    assert.equal(d.sync.status.storageError,false);assert.equal(d.sync.pending,0);assert.equal(f.writes.length,1);
    assert.equal(f.server.equipmentReady.rope,true);assert.equal(f.server.equipmentReady['leg-ties'],true);assert.equal(f.server.equipmentReady.cones,true);
    assert.equal(f.server.committeeMembers.equipment[3],'Darren');assert.equal(f.server.committeeMembers.comms[2],'Grace');
  }finally{f.stop();}
});
await test('An unseen old attempt remains recoverable for review instead of resubmitting a changed request',async()=>{
  const item=pending({attempted:true}),f=fixture({items:[item]});try{const d=f.device();await d.sync.start();
    assert.equal(d.sync.status.storageError,false);assert.equal(d.sync.status.phase,'conflict');assert.equal(d.sync.pending,1);assert.equal(f.writes.length,0);
    assert.deepEqual(f.saved().outbox[0].request,item.request);assert.equal(d.sync.queue(d.state),false);const before=f.calls.length;await d.sync.flush();assert.equal(f.calls.length,before);
    await d.sync.acceptRemote();assert.equal(d.sync.pending,0);assert.equal(d.state.equipmentReady.rope,false);assert.equal(d.state.committeeMembers.equipment[3],'Darren');
  }finally{f.stop();}
});
await test('Roster-only normalization still protects malformed and unsupported persisted payloads',async()=>{
  for(const change of [item=>item.snapshot.untrusted='ignore me',item=>item.baseSnapshot.committeeMembers.comms.push('Half migration'),item=>item.request.p_snapshot.untrusted='ignore me']){
    const item=pending({attempted:true});change(item);const f=fixture({items:[item]});try{const original=f.storage.getItem(storageKey),d=f.device();await d.sync.start();
      assert.equal(d.sync.status.storageError,true);assert.equal(f.storage.getItem(storageKey),original);assert.equal(f.writes.length,0);
    }finally{f.stop();}
  }
});
await test('The new client explicitly authorizes roster protocol two',async()=>{
  const f=fixture();try{const d=f.device();await d.sync.start();const authorize=f.calls.find(call=>call.path.endsWith('/authorize_sports_day_editor'));
    assert.equal(authorize.body.p_roster_version,2);
  }finally{f.stop();}
});
console.log(`${passed}/${passed+failed} final roster sync tests passed.`);if(failed)process.exitCode=1;
