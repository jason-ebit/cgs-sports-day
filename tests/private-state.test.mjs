import assert from 'node:assert/strict';
import { defaultState, validateState } from '../model.js';
import { publicSnapshot, mergePublicState } from '../sync.js';
import { createPanelNavigation, checklistKey } from '../panel-navigation.js';

let count=0;
const test=(name,fn)=>{fn();count++;console.log('PASS '+name);};
test('Older event backups gain private preference and checklist defaults',()=>{
  const old=defaultState();delete old.preferences;delete old.committeeChecklist;
  const next=validateState(old);
  assert.deepEqual(next.preferences,{department:'director',sound:false});
  assert.deepEqual(next.committeeChecklist,{});
});
test('Legacy checklist backups survive without depending on current committee copy',()=>{
  const state=defaultState();
  // Saved keys are opaque task hashes. A large old backup remains readable even
  // after its task text and checkbox controls have been removed from the UI.
  const scopes=['director:general','judges:event:4','first-aid:general','equipment:event:8','food-water:general','comms:event:15','team-leaders:event:9','all:event:3','inventory:have','inventory:prepare'];
  state.committeeChecklist=Object.fromEntries(Array.from({length:300},(_,index)=>[
    `${scopes[index%scopes.length]}:${(100000+index).toString(36)}`,index%3!==0
  ]));
  state.preferences={department:'first-aid',sound:true};
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(state))),state);
  const remote=defaultState();remote.borrow.scores[0][0]=5;
  const merged=mergePublicState(publicSnapshot(remote),state);
  assert.deepEqual(merged.committeeChecklist,state.committeeChecklist);
  assert.equal(Object.keys(merged.committeeChecklist).length,300);
  assert.equal(merged.borrow.scores[0][0],5);
});
test('Invalid readiness values and preference choices reject the whole backup',()=>{
  for(const mutate of [s=>s.committeeChecklist={'unknown:abc':true},s=>s.committeeChecklist={'judges:general:abc':'yes'},s=>s.preferences.sound=1,s=>s.preferences.department='unknown',s=>s.committeeChecklist=Array(3)]){
    const state=defaultState();mutate(state);assert.throws(()=>validateState(state));
  }
});
test('Private checks, department and sound never enter the shared snapshot',()=>{
  const state=defaultState();state.committeeChecklist[checklistKey('first-aid:general','Medical briefing')]=true;state.preferences={department:'first-aid',sound:true};
  const snapshot=publicSnapshot(state);
  assert.equal('committeeChecklist' in snapshot,false);assert.equal('preferences' in snapshot,false);
  const restored=mergePublicState(snapshot);
  assert.deepEqual(restored.committeeChecklist,{});assert.deepEqual(restored.preferences,defaultState().preferences);
});
test('Remote results preserve the viewer’s own readiness and preferences',()=>{
  const local=defaultState();local.committeeChecklist[checklistKey('equipment:general','Pack ropes')]=true;local.preferences={department:'equipment',sound:true};
  const remote=defaultState();remote.borrow.scores[0][0]=5;
  const next=mergePublicState(publicSnapshot(remote),local);
  assert.deepEqual(next.committeeChecklist,local.committeeChecklist);assert.deepEqual(next.preferences,local.preferences);
  assert.equal(next.borrow.scores[0][0],5);
});
test('Warm-up selection and reminders survive backups and remote updates while staying private',()=>{
  const local=defaultState();
  local.preferences={department:'warmup',sound:true};
  local.committeeNotes.warmup={general:'Lead the warm-up and check the space.',3:'Keep this reminder on my phone.'};
  local.committeeChecklist['warmup:general:abc123']=true;
  const restored=validateState(JSON.parse(JSON.stringify(local)));
  assert.deepEqual(restored,local);

  const snapshot=publicSnapshot(restored);
  for(const key of ['committeeNotes','committeeChecklist','preferences'])assert.equal(key in snapshot,false);
  const freshViewer=mergePublicState(snapshot);
  assert.deepEqual(freshViewer.committeeNotes,{});
  assert.deepEqual(freshViewer.committeeChecklist,{});
  assert.deepEqual(freshViewer.preferences,defaultState().preferences);

  const remote=defaultState();remote.borrow.scores[0][0]=5;
  const merged=mergePublicState(publicSnapshot(remote),restored);
  assert.deepEqual(merged.preferences,local.preferences);
  assert.deepEqual(merged.committeeNotes,local.committeeNotes);
  assert.deepEqual(merged.committeeChecklist,local.committeeChecklist);
  assert.equal(merged.borrow.scores[0][0],5);
});
test('Shared committee names replace the local roster without exposing or changing private notes',()=>{
  const local=defaultState();local.committeeMembers.director[0]='Local old name';
  local.committeeNotes.warmup={general:'Private warm-up reminder'};local.preferences.department='warmup';
  local.committeeChecklist['equipment:general:legacy']=true;local.teams[0].leader='Private team leader';
  const remote=defaultState();remote.committeeMembers.director[0]='Shared director';remote.committeeMembers.comms=['Cindy','New announcer'];
  const snapshot=publicSnapshot(remote),merged=mergePublicState(snapshot,local);
  assert.deepEqual(snapshot.committeeMembers,remote.committeeMembers);
  assert.deepEqual(merged.committeeMembers,remote.committeeMembers);
  assert.deepEqual(merged.committeeNotes,local.committeeNotes);assert.deepEqual(merged.committeeChecklist,local.committeeChecklist);
  assert.deepEqual(merged.preferences,local.preferences);assert.equal(merged.teams[0].leader,local.teams[0].leader);
  assert.equal(JSON.stringify(publicSnapshot(local)).includes('Private'),false);
  merged.committeeMembers.director[0]='Changed viewer copy';assert.equal(snapshot.committeeMembers.director[0],'Shared director');
});
test('Checklist identities survive note ordering and stay separate by department and event',()=>{
  assert.equal(checklistKey('judges:event:4','Watch the finish'),checklistKey('judges:event:4','Watch the finish'));
  assert.notEqual(checklistKey('judges:event:4','Watch the finish'),checklistKey('judges:event:9','Watch the finish'));
  assert.notEqual(checklistKey('judges:event:4','Watch the finish'),checklistKey('director:event:4','Watch the finish'));
});
test('Shared equipment checks replace viewer checks while legacy private ticks and notes remain private',()=>{
  const local=defaultState();local.equipmentReady.balls=true;
  local.committeeChecklist['inventory:setup:basket']=true;local.committeeChecklist['first-aid:general:abc']=true;
  local.committeeNotes.equipment={general:'Private setup reminder'};local.preferences.department='equipment';
  const remote=defaultState();remote.equipmentReady.basket=true;remote.equipmentReady.rope=true;remote.equipmentReady['cold-packs']=true;
  const snapshot=publicSnapshot(remote),merged=mergePublicState(snapshot,local);
  assert.equal(snapshot.equipmentColdPacksReady,true);assert.equal(Object.keys(snapshot.equipmentReady).length,21);assert.deepEqual(merged.equipmentReady,remote.equipmentReady);
  assert.deepEqual(merged.committeeChecklist,local.committeeChecklist);assert.deepEqual(merged.committeeNotes,local.committeeNotes);
  assert.deepEqual(merged.preferences,local.preferences);assert.equal('committeeChecklist' in snapshot,false);
  assert.equal('committeeNotes' in snapshot,false);assert.equal(JSON.stringify(publicSnapshot(local)).includes('inventory:'),false);
  merged.equipmentReady.rope=false;assert.equal(snapshot.equipmentReady.rope,true);
  const old=structuredClone(snapshot);delete old.equipmentReady;delete old.equipmentColdPacksReady;
  assert.deepEqual(mergePublicState(old,local).equipmentReady,defaultState().equipmentReady);
  assert.deepEqual(mergePublicState(old,local).committeeChecklist,local.committeeChecklist);
  const old21=structuredClone(snapshot);delete old21.equipmentColdPacksReady;
  const restored=mergePublicState(old21,local);
  assert.equal(restored.equipmentReady['cold-packs'],false);assert.equal(restored.equipmentReady.rope,true);
  assert.equal(Object.hasOwn(old21.equipmentReady,'cold-packs'),false);
  assert.deepEqual(restored.committeeChecklist,local.committeeChecklist);assert.deepEqual(restored.committeeNotes,local.committeeNotes);
});
test('Shared rota uses stable slot IDs while private notes and reminders stay on the viewer device',()=>{
  const local=defaultState();local.committeeRotation={'borrow:0':{'comms:0':{status:'playing',coverFor:null}}};
  local.committeeNotes['first-aid']={general:'Private reminder'};local.committeeChecklist['inventory:setup:basket']=true;
  local.notes[4]='Local note';local.teams[0].leader='Private leader';local.preferences.department='comms';
  const remote=defaultState();remote.committeeMembers.comms[0]='Renamed member';
  remote.committeeRotation={'borrow:0':{'comms:0':{status:'duty',coverFor:null},'warmup:0':{status:'cover',coverFor:'first-aid:1'}}};
  const snapshot=publicSnapshot(remote),merged=mergePublicState(snapshot,local);
  assert.deepEqual(snapshot.committeeRotation,remote.committeeRotation);assert.deepEqual(merged.committeeRotation,remote.committeeRotation);
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(merged))),merged);
  for(const key of ['committeeNotes','committeeChecklist','notes','preferences'])assert.deepEqual(merged[key],local[key]);
  assert.equal(merged.teams[0].leader,local.teams[0].leader);assert.equal(JSON.stringify(snapshot).includes('Private'),false);
  merged.committeeRotation['borrow:0']['comms:0'].status='playing';assert.equal(snapshot.committeeRotation['borrow:0']['comms:0'].status,'duty');
  const legacy=structuredClone(snapshot);delete legacy.committeeRotation;assert.deepEqual(mergePublicState(legacy,local).committeeRotation,{});
});
test('Back unwinds exact panel frames in reverse order without adding tab changes',()=>{
  const nav=createPanelNavigation(),restore=()=>{};
  const committee={key:'committee',tab:'notes',department:'first-aid',restore},event={key:'event:4',tab:'committee',department:'first-aid',restore};
  nav.enter(committee,'event:4');nav.enter(event,'event:4');nav.enter(event,'results');
  assert.equal(nav.previous,event);assert.equal(nav.back(),event);assert.equal(nav.back(),committee);assert.equal(nav.back(),null);
});
test('Closing navigation clears stale frames and bounds repeated routes',()=>{
  const nav=createPanelNavigation(2);
  for(const key of ['committee','event:4','results'])nav.enter({key},key+'-next');
  assert.equal(nav.back().key,'results');assert.equal(nav.back().key,'event:4');assert.equal(nav.back(),null);
  nav.enter({key:'teams'},'event:8');nav.clear();assert.equal(nav.previous,null);
});
console.log(`${count} private state and navigation tests passed.`);
