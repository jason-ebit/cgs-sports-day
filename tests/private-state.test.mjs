import assert from 'node:assert/strict';
import { defaultState, validateState } from '../model.js';
import { publicSnapshot, mergePublicState } from '../sync.js';
import { createPanelNavigation, checklistKey } from '../panel-navigation.js';
import { DEPARTMENTS, COMMITTEE, SUPPLIES } from '../content.js';

let count=0;
const test=(name,fn)=>{fn();count++;console.log('PASS '+name);};
test('Older event backups gain private preference and checklist defaults',()=>{
  const old=defaultState();delete old.preferences;delete old.committeeChecklist;
  const next=validateState(old);
  assert.deepEqual(next.preferences,{department:'director',sound:false});
  assert.deepEqual(next.committeeChecklist,{});
});
test('Every available checklist item can coexist in a validated phone backup',()=>{
  const state=defaultState();
  for(const dept of DEPARTMENTS){
    for(const item of dept.general)state.committeeChecklist[checklistKey(dept.id+':general',item)]=true;
    for(const [event,items] of Object.entries(dept.notes))for(const item of items)state.committeeChecklist[checklistKey(dept.id+':event:'+event,item)]=true;
  }
  for(const [event,items] of Object.entries(COMMITTEE))for(const item of items)state.committeeChecklist[checklistKey('all:event:'+event,item)]=true;
  for(const [group,items] of [['have',SUPPLIES.have],['prepare',SUPPLIES.get]])for(const item of items)state.committeeChecklist[checklistKey('inventory:'+group,item.name)]=true;
  state.preferences={department:'first-aid',sound:true};
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(state))),state);
  assert.ok(Object.keys(state.committeeChecklist).length>250);
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
test('Checklist identities survive note ordering and stay separate by department and event',()=>{
  assert.equal(checklistKey('judges:event:4','Watch the finish'),checklistKey('judges:event:4','Watch the finish'));
  assert.notEqual(checklistKey('judges:event:4','Watch the finish'),checklistKey('judges:event:9','Watch the finish'));
  assert.notEqual(checklistKey('judges:event:4','Watch the finish'),checklistKey('director:event:4','Watch the finish'));
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
