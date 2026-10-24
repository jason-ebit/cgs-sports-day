import assert from 'node:assert/strict';
import {defaultState} from '../model.js';
import {planCommitteeRotation} from '../rota-planner.js';
import {rotationInterval} from '../rota-intervals.js';

const state=defaultState();
// The original 25-round crew remains a valid saved six-round plan.
state.borrow.rounds=6;
Object.assign(state.committeeMembers,{director:['Jason'],judges:[''],'first-aid':['Lanny',''],equipment:['Rina','Timothy','Trishya','Darren'],warmup:['Leti'],'food-water':['Cindy','Vin','Maria',''],comms:['Jenni','Mario','Grace','']});
const before=structuredClone(state), plan=planCommitteeRotation(state,{capacity:true,grouped:true});
assert.deepEqual(state,before);assert.equal(plan.summary.people.length,13);assert.equal(plan.summary.playingLimit,7);assert.equal(plan.summary.plannedRounds,25);
const groups=new Map();
for(const [key,round]of Object.entries(plan.rotation)){
 assert.deepEqual(round['director:0'],{status:'duty',coverFor:null});assert.deepEqual(round['first-aid:0'],{status:'duty',coverFor:null});assert.ok(!round['judges:0']);assert.ok(!round['first-aid:1']);
 assert.equal(Object.values(round).filter(a=>a.status==='playing').length,7,key);
 const staffed={};
 for(const [id,a]of Object.entries(round))if(a.status!=='playing'){const dept=(a.status==='cover'?a.coverFor:id).split(':')[0];staffed[dept]=(staffed[dept]||0)+1;if(a.status==='cover'){assert.equal(round[a.coverFor].status,'playing');assert.equal(id.split(':')[0],a.coverFor.split(':')[0]);}}
 assert.ok(staffed.equipment>=2,key);assert.ok(staffed['food-water']>=1,key);assert.ok(staffed.comms>=1,key);
 const group=rotationInterval(state,key).groupKey;if(groups.has(group))assert.deepEqual(round,groups.get(group));else groups.set(group,round);
}
for(const p of plan.summary.people.filter(p=>!['director','first-aid'].includes(p.department)))assert.ok(p.playingTurns>0,p.name);
console.log('PASS Final crew gives all 11 support volunteers playing turns, with seven available and all essential posts covered');
console.log('PASS Paired rounds and attempts retain their crew, blank posts are excluded, and input state is unchanged');
state.committeeRotation['borrow:0']={'equipment:0':{status:'playing',coverFor:null}};
state.timers['relay:0']={duration:480000,remaining:480000,deadline:null,signature:'',started:true};
state.committeeRotation['relay:0']={'comms:0':{status:'duty',coverFor:null}};
const preserved=planCommitteeRotation(state,{capacity:true,grouped:true});
assert.deepEqual(preserved.rotation['borrow:0'],state.committeeRotation['borrow:0']);assert.deepEqual(preserved.rotation['relay:0'],state.committeeRotation['relay:0']);assert.ok(preserved.summary.skippedKeys.includes('relay:0'));
console.log('PASS Manual and started plans remain intact');
