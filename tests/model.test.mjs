import * as m from '../model.js';
import {makeClock,startClock} from '../timer-model.js';
import {EVENT_GAMES,GAME_EVENTS} from '../content.js';

const tests=[];
function test(name, run){try{run();tests.push({name,pass:true});}catch(e){tests.push({name,pass:false,error:e.message});}}
function equal(a,b){if(JSON.stringify(a)!==JSON.stringify(b))throw Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);}
function throws(fn){let caught=false;try{fn();}catch{caught=true;}if(!caught)throw Error('Expected rejection');}
function clone(v){return JSON.parse(JSON.stringify(v));}
function started(s,key){s.timers[key]=makeClock(60);startClock(s.timers,key,100);}
function finishBasket(s){s.finished=m.TEAM_IDS.flatMap(id=>[0,1].map(round=>`basket:${id}:${round}`));}
test('Fresh event contains no results or awarded points',()=>{const s=m.defaultState();equal(m.championship(s).completed,0);equal(m.totals(s,'basket'),Array(5).fill(null));});
test('Five seeds place 4 and 5 in preliminary; top three get byes',()=>{equal(m.seededSlots(m.defaultState().teams),['green','white','red','blue','yellow']);});
test('Duplicate or missing seeds are rejected',()=>{const s=m.defaultState();s.teams[0].seed=2;throws(()=>m.seededSlots(s.teams));s.teams[0].seed=null;throws(()=>m.seededSlots(s.teams));});
test('Every random draw contains each team once',()=>{for(let i=0;i<1000;i++)equal(m.validSlots(m.shuffled(m.TEAM_IDS)),true);});
test('Manual duplicate assignment swaps slots without duplicating teams',()=>{const s=m.defaultState();s.tug.slots=[...m.TEAM_IDS];m.assignSlot(s.tug,0,'blue');equal(s.tug.slots,['blue','red','yellow','green','white']);});
test('Manual assignment handles empty slots',()=>{const t=m.defaultState().tug;m.assignSlot(t,0,'red');m.assignSlot(t,1,'red');equal(t.slots,[null,'red',null,null,null]);});
test('Unlocked and unresolved matches reject winners',()=>{const t=m.defaultState().tug;t.slots=[...m.TEAM_IDS];throws(()=>m.setWinner(t,'prelim','red'));t.locked=true;throws(()=>m.setWinner(t,'final','red'));throws(()=>m.assignSlot(t,1,'red'));});
test('Final is reached only through real opponents',()=>{const t=m.defaultState().tug;t.slots=[...m.TEAM_IDS];t.locked=true;m.setWinner(t,'prelim','red');equal(m.matchTeams(t,'semi1'),['yellow','red']);m.setWinner(t,'semi1','red');m.setWinner(t,'semi2','white');equal(m.matchTeams(t,'final'),['red','white']);m.setWinner(t,'final','white');equal(t.winners.final,'white');throws(()=>m.setWinner(t,'final','blue'));});
test('Upstream correction clears only dependent matches',()=>{const t=m.defaultState().tug;t.slots=[...m.TEAM_IDS];t.locked=true;m.setWinner(t,'prelim','red');m.setWinner(t,'semi1','red');m.setWinner(t,'semi2','white');m.setWinner(t,'final','white');m.setWinner(t,'prelim','blue');equal(t.winners,{prelim:'blue',semi1:null,semi2:'white',final:null});});
test('Ball Basket uses best count, retains zero, waits for both attempts',()=>{const s=m.defaultState();s.basket.scores=[[0,0],[10,7],[4,20],[null,9],[1,2]];equal(m.totals(s,'basket'),[0,10,20,null,2]);});
test('Relay converts round placements to points before totaling',()=>{const s=m.defaultState();s.relay.scores[0]=[1,3,5];equal(m.totals(s,'relay')[0],9);});
test('Seventh borrow round is included only when configured',()=>{const s=m.defaultState();s.borrow.scores[0]=[5,5,5,5,5,5,2];equal(m.totals(s,'borrow')[0],30);s.borrow.rounds=7;equal(m.totals(s,'borrow')[0],32);});
test('Tied totals share competition places; incomplete totals stay unranked',()=>{equal(m.placementsFromTotals([5,4,3,2,2]),[1,2,3,4,4]);equal(m.placementsFromTotals([5,5,3,2,1]),[1,1,3,4,5]);equal(m.placementsFromTotals([5,4,3,2,null]),null);equal(m.placementsFromTotals([10,50,30,40,20]),[5,1,3,2,4]);});
test('Championship waits for finished attempts, then converts counts to points',()=>{const s=m.defaultState();s.basket.scores=[[100,99],[80,70],[60,50],[40,30],[20,10]];equal(m.championship(s).completed,0);finishBasket(s);const c=m.championship(s);equal(c.completed,1);equal(c.rows.map(r=>r.total),[5,4,3,2,1]);equal(c.complete,false);});
test('Manual placements cannot finish an unplayed game',()=>{const s=m.defaultState();s.placements.tug={values:[1,2,3,4,5],rule:'Playoffs completed'};equal(m.championship(s).completed,0);equal(m.gamePlaces(s,'tug'),null);});
test('Default and completed bracket backups round trip',()=>{const s=m.defaultState();equal(m.validateState(clone(s)),s);s.tug.slots=[...m.TEAM_IDS];s.tug.locked=true;for(const [match,id] of [['prelim','red'],['semi1','red'],['semi2','white'],['final','white']]){started(s,'tug:'+match);m.setWinner(s.tug,match,id);}equal(m.validateState(clone(s)),s);});
test('Import rejects duplicate slots, impossible winners and negative scores',()=>{let s=m.defaultState();s.tug.slots=['red','red',null,null,null];throws(()=>m.validateState(s));s=m.defaultState();s.tug.winners.final='red';throws(()=>m.validateState(s));s=m.defaultState();s.basket.scores[0][0]=-1;throws(()=>m.validateState(s));});
test('Import rejects duplicate relay places and inactive cavalry eliminations',()=>{let s=m.defaultState();s.relay.scores[0][0]=1;s.relay.scores[1][0]=1;throws(()=>m.validateState(s));s=m.defaultState();s.cavalry.divisions.women.eliminated=['red'];throws(()=>m.validateState(s));});
test('Cavalry team selection no longer requires eligibility counts',()=>{const s=m.defaultState();s.cavalry.divisions.men.active=['red'];equal(m.validateState(s).cavalry.divisions.men.active,['red']);});
test('Malformed backups cannot introduce arbitrary keys',()=>{const s=m.defaultState();s.untrusted='ignore me';equal(m.validateState(s).untrusted,undefined);throws(()=>m.validateState({version:2}));});
test('Malformed backup sections return the useful validation message without changing input',()=>{for(const path of [['teams',0],['tug'],['tug','winners'],['borrow'],['basket'],['relay'],['cavalry'],['cavalry','divisions'],['cavalry','divisions','women'],['placements'],['placements','tug']]){for(const value of [null,[],42]){const s=m.defaultState();let section=s;for(const key of path.slice(0,-1))section=section[key];section[path.at(-1)]=value;const before=clone(s);let error;try{m.validateState(s);}catch(caught){error=caught;}equal(error?.message,'This is not a valid Sports Day backup. No data was changed.');equal(s,before);}}const s=m.defaultState();s.teams[0].name=42;let error;try{m.validateState(s);}catch(caught){error=caught;}equal(error?.message,'This is not a valid Sports Day backup. No data was changed.');});
test('Saved tie-break decisions preserve raw scores and untied order',()=>{const s=m.defaultState();s.basket.scores=[[10,10],[10,10],[8,8],[6,6],[4,4]];finishBasket(s);s.placements.basket={rule:'Blue won the playoff',values:[2,1,3,4,5]};equal(m.approvedPlaces(s,'basket'),[2,1,3,4,5]);equal(m.gamePlaces(s,'basket'),[2,1,3,4,5]);equal(m.totals(s,'basket'),[10,10,8,6,4]);equal(m.championship(s).completed,1);s.placements.basket.values=[3,1,2,4,5];equal(m.approvedPlaces(s,'basket'),null);equal(m.gamePlaces(s,'basket'),[1,1,3,4,5]);});
test('Automatic tied points enter overview without a manual approval',()=>{const s=m.defaultState();s.basket.scores=[[10,10],[10,10],[8,8],[6,6],[4,4]];finishBasket(s);equal(m.championship(s).rows.map(row=>[row.id,row.total]),[['red',5],['blue',5],['yellow',3],['green',2],['white',1]]);});
test('Tug automatically ranks champion, runner-up, shared semifinalists and preliminary loser',()=>{const s=m.defaultState();s.tug.slots=[...m.TEAM_IDS];s.tug.locked=true;for(const [match,id] of [['prelim','red'],['semi1','red'],['semi2','white']])m.setWinner(s.tug,match,id);equal(m.gameDone(s,'tug'),false);equal(m.championship(s).completed,0);m.setWinner(s.tug,'final','white');equal(m.gamePlaces(s,'tug'),[2,5,3,3,1]);equal(m.championship(s).rows.map(row=>row.total),[5,4,3,3,1]);});
test('Saved tug playoff places only resolve semifinalists and cannot contradict bracket results',()=>{const s=m.defaultState();s.tug.slots=[...m.TEAM_IDS];s.tug.locked=true;for(const [match,id] of [['prelim','red'],['semi1','red'],['semi2','white'],['final','white']])m.setWinner(s.tug,match,id);s.placements.tug={rule:'Yellow won third-place playoff',values:[2,5,3,4,1]};equal(m.gamePlaces(s,'tug'),[2,5,3,4,1]);for(const values of [[1,5,3,4,2],[2,3,5,4,1],[3,5,2,4,1]]){s.placements.tug.values=values;equal(m.approvedPlaces(s,'tug'),null);equal(m.gamePlaces(s,'tug'),[2,5,3,3,1]);}});
test('Borrow completion follows the configured six or seven rounds',()=>{const s=m.defaultState();s.borrow.scores=m.TEAM_IDS.map(()=>[5,5,5,5,5,5,null]);equal(m.gameDone(s,'borrow'),true);equal(m.championship(s).completed,1);s.borrow.rounds=7;equal(m.gameDone(s,'borrow'),false);equal(m.championship(s).completed,0);s.borrow.scores.forEach(row=>row[6]=0);equal(m.gameDone(s,'borrow'),true);});
test('Legacy recorded results remain saved without inventing timer starts',()=>{const s=m.defaultState();s.borrow.scores[0][0]=5;s.basket.scores=m.TEAM_IDS.map((_,i)=>[10-i,9-i]);delete s.finished;const restored=m.validateState(s);equal(restored.timers['borrow:0'],undefined);equal(restored.borrow.scores[0][0],5);equal(restored.finished.length,10);equal(m.championship(restored).completed,1);});
test('Explicit timer reset markers remain authoritative when restoring scored rounds',()=>{const s=m.defaultState();s.borrow.scores[0][0]=5;s.timers['borrow:0']=makeClock(90);const restored=m.validateState(s);equal(restored.timers['borrow:0'].started,false);equal(restored.borrow.scores[0][0],5);});
test('Older backups without tie-break fields remain readable',()=>{const s=m.defaultState();delete s.placements.borrow;delete s.placements.basket;delete s.placements.relay;equal(m.validateState(s).placements.borrow.values,Array(5).fill(null));});
test('Department reminders stay separate through backup and restore',()=>{const s=m.defaultState();s.notes[4]='Shared';s.committeeNotes={director:{4:'Start the clock',general:'Bring whistle'},judges:{4:'Check finishes'}};const restored=m.validateState(clone(s));equal(restored.committeeNotes,s.committeeNotes);equal(restored.notes[4],'Shared');});
test('Older backups without department reminders remain readable',()=>{const s=m.defaultState();delete s.committeeNotes;equal(m.validateState(s).committeeNotes,{});});
test('Prayer reminders restore without moving existing game or saved note indices',()=>{equal(EVENT_GAMES,{4:'borrow',5:'basket',7:'cavalry',8:'tug',9:'relay'});equal(GAME_EVENTS,{borrow:4,basket:5,cavalry:7,tug:8,relay:9});const s=m.defaultState();s.notes=Object.fromEntries(Array.from({length:15},(_,i)=>[i,'Saved event '+i]));s.notes[15]='Prayer leader ready';s.committeeNotes={comms:{2:'Safety announcement',4:'Call the next runner',15:'Gather teams for prayer'}};const restored=m.validateState(clone(s));equal(restored.notes,s.notes);equal(restored.committeeNotes,s.committeeNotes);});
test('Department backups reject unknown teams and oversized or invalid notes',()=>{const s=m.defaultState();s.committeeNotes={unknown:{4:'Test'}};throws(()=>m.validateState(s));s.committeeNotes={director:{16:'Invalid event'}};throws(()=>m.validateState(s));s.committeeNotes={director:{general:'x'.repeat(2001)}};throws(()=>m.validateState(s));s.committeeNotes={};s.notes={16:'Invalid event'};throws(()=>m.validateState(s));});
test('Committee rosters have stable slots, named communications defaults and independent copies',()=>{
  equal(m.COMMITTEE_SLOTS,{director:1,judges:1,'first-aid':2,equipment:4,'food-water':3,comms:3,'team-leaders':5,warmup:1});
  const members=m.defaultCommitteeMembers(),next=m.defaultCommitteeMembers();
  equal(Object.keys(members),m.DEPARTMENT_IDS);equal(members.comms,['Cindy','Mario','']);
  for(const [id,count] of Object.entries(m.COMMITTEE_SLOTS))equal(members[id].length,count);
  members.comms[0]='Changed';equal(next.comms,['Cindy','Mario','']);equal(m.defaultState().committeeMembers,next);
});
test('Old v1 backups gain roster defaults while edited names and blank optional slots round trip',()=>{
  const old=m.defaultState();delete old.committeeMembers;old.notes[4]='Private note';
  equal(m.validateState(old).committeeMembers,m.defaultCommitteeMembers());equal(m.validateState(old).notes,old.notes);
  const current=m.defaultState();current.committeeMembers.director[0]='A'.repeat(60);current.committeeMembers['first-aid']=['지수','Min'];
  current.committeeMembers['food-water']=['','',''];current.committeeMembers.comms=['','Mario',''];
  equal(m.validateState(clone(current)),current);
});
test('Exact former roster shape gains blank appended slots without changing names or saved rotations',()=>{
  const old=m.defaultState();old.committeeMembers.equipment=['Rina','Timothy','Trishya'];old.committeeMembers.comms=['Jenni','Mario'];
  old.committeeMembers.director=['Jason'];old.committeeRotation={'borrow:0':{'equipment:2':{status:'duty',coverFor:null},'comms:1':{status:'playing',coverFor:null}}};
  const before=clone(old),restored=m.validateState(old);
  equal(restored.committeeMembers.equipment,['Rina','Timothy','Trishya','']);equal(restored.committeeMembers.comms,['Jenni','Mario','']);
  equal(restored.committeeMembers.director,['Jason']);equal(restored.committeeRotation,old.committeeRotation);equal(old,before);
  equal(m.validateState(clone(restored)),restored);
});
test('Expanded roster names and new stable person IDs round trip without renumbering',()=>{
  const state=m.defaultState();state.committeeMembers.equipment=['Rina','Timothy','Trishya','Darren'];state.committeeMembers.comms=['Jenni','Mario','Grace'];
  state.committeeRotation={'relay:0':{'equipment:3':{status:'cover',coverFor:'comms:2'},'comms:2':{status:'playing',coverFor:null}}};
  equal(m.validateState(clone(state)),state);
});
test('Roster expansion rejects partial shapes, unsupported lengths and malformed historical names',()=>{
  const shapes=[{equipment:['','',''],comms:['','','']},{equipment:['','','',''],comms:['','']},{equipment:['',''],comms:['','']},
    {equipment:['','','','',''],comms:['','','']},{equipment:['','',''],comms:['']},{equipment:['','',''],comms:['','',null]},
    {equipment:['','',''],comms:['',null]},{equipment:['','',''],comms:['','x'.repeat(61)]},{equipment:Array(3),comms:['','']}];
  for(const shape of shapes){const state=m.defaultState();Object.assign(state.committeeMembers,shape);const before=clone(state);throws(()=>m.validateState(state));equal(state,before);}
});
test('Committee roster imports reject unknown departments, incomplete slots and invalid names without mutation',()=>{
  const malformed=[null,[],{}, {...m.defaultCommitteeMembers(),unknown:['Name']}, {...m.defaultCommitteeMembers(),director:[]},
    {...m.defaultCommitteeMembers(),'food-water':['One','Two']}, {...m.defaultCommitteeMembers(),comms:'Cindy'},
    {...m.defaultCommitteeMembers(),director:[null]}, {...m.defaultCommitteeMembers(),director:[42]},
    {...m.defaultCommitteeMembers(),director:['x'.repeat(61)]}];
  for(const members of malformed){const state=m.defaultState();state.committeeMembers=members;const before=clone(state);throws(()=>m.validateState(state));equal(state,before);}
  const sparse=m.defaultState();sparse.committeeMembers.director=Array(1);throws(()=>m.validateState(sparse));
});
test('Equipment readiness has 22 stable IDs, fresh false defaults and independent copies',()=>{
  equal(m.EQUIPMENT_IDS,['gloves','cones','balls','batons','rider-cloth','colour-sticks','borrow-cards','basket','rope','leg-ties','spoons','mat','whistle','icebox','cart','umbrellas','pens-markers','phones-timer','bags','food-water','prizes','cold-packs']);
  const ready=m.defaultEquipmentReady(),next=m.defaultEquipmentReady();
  equal(Object.keys(ready),m.EQUIPMENT_IDS);equal(Object.values(ready),Array(22).fill(false));
  ready.basket=true;equal(next.basket,false);equal(m.defaultState().equipmentReady,next);
});
test('Exact older 21-item equipment maps gain only an unchecked cold-packs item without changing the source',()=>{
  const old=m.defaultState();delete old.equipmentReady['cold-packs'];old.equipmentReady.basket=true;
  const before=clone(old),restored=m.validateState(old);
  equal(Object.keys(restored.equipmentReady),m.EQUIPMENT_IDS);equal(restored.equipmentReady['cold-packs'],false);
  equal(restored.equipmentReady.basket,true);equal(old,before);
  restored.equipmentReady['cold-packs']=true;equal(m.validateState(clone(restored)),restored);
  delete old.equipmentReady.rope;throws(()=>m.validateState(old));
});
test('Older backups keep private equipment ticks without silently copying them to shared readiness',()=>{
  const old=m.defaultState();delete old.equipmentReady;old.committeeChecklist['inventory:setup:basket']=true;
  const restored=m.validateState(old);equal(restored.equipmentReady,m.defaultEquipmentReady());equal(restored.committeeChecklist,old.committeeChecklist);
  restored.equipmentReady.basket=true;restored.equipmentReady['leg-ties']=true;
  equal(m.validateState(clone(restored)),restored);
});
test('Equipment readiness rejects missing, unknown or non-boolean entries without changing the backup',()=>{
  const missing=m.defaultEquipmentReady();delete missing.gloves;
  for(const ready of [null,[],{},missing,{...m.defaultEquipmentReady(),unknown:true},{...m.defaultEquipmentReady(),balls:1},{...m.defaultEquipmentReady(),balls:'true'},{...m.defaultEquipmentReady(),balls:null}]){
    const state=m.defaultState();state.equipmentReady=ready;const before=clone(state);throws(()=>m.validateState(state));equal(state,before);
  }
});
test('Committee rotation has 26 fixed rounds and 20 people, with independent empty defaults for older backups',()=>{
  equal(m.ROTATION_ROUND_KEYS,['borrow:0','borrow:1','borrow:2','borrow:3','borrow:4','borrow:5','borrow:6','basket:red:0','basket:red:1','basket:blue:0','basket:blue:1','basket:yellow:0','basket:yellow:1','basket:green:0','basket:green:1','basket:white:0','basket:white:1','cavalry:women','cavalry:men','tug:prelim','tug:semi1','tug:semi2','tug:final','relay:0','relay:1','relay:2']);
  equal(m.ROTATION_ROUND_KEYS.length,26);equal(new Set(m.ROTATION_ROUND_KEYS).size,26);
  equal(m.COMMITTEE_PERSON_IDS,Object.entries(m.COMMITTEE_SLOTS).flatMap(([department,count])=>Array.from({length:count},(_,slot)=>`${department}:${slot}`)));
  equal(m.COMMITTEE_PERSON_IDS.length,20);equal(new Set(m.COMMITTEE_PERSON_IDS).size,20);
  const old=m.defaultState();delete old.committeeRotation;equal(m.validateState(old).committeeRotation,{});
  const fresh=m.defaultState(),other=m.defaultState();fresh.committeeRotation['borrow:0']={};equal(other.committeeRotation,{});
});
test('Rota assignments round trip through backups, keep fixed slot identities and canonicalize JSONB ordering',()=>{
  const state=m.defaultState();state.committeeRotation={
    'relay:2':{'warmup:0':{coverFor:'first-aid:0',status:'cover'},'equipment:0':{coverFor:null,status:'playing'}},
    'borrow:0':{'comms:1':{coverFor:null,status:'duty'},'comms:0':{coverFor:null,status:'cover'}},
  };
  const before=clone(state),restored=m.validateState(state);
  equal(Object.keys(restored.committeeRotation),['borrow:0','relay:2']);
  equal(Object.keys(restored.committeeRotation['borrow:0']),['comms:0','comms:1']);
  equal(restored.committeeRotation['relay:2']['warmup:0'],{status:'cover',coverFor:'first-aid:0'});
  state.committeeMembers['first-aid'][0]='Renamed';equal(m.validateState(state).committeeRotation,restored.committeeRotation);
  restored.committeeRotation['relay:2']['warmup:0'].coverFor=null;equal(before.committeeRotation['relay:2']['warmup:0'].coverFor,'first-aid:0');
  const full=Object.fromEntries(m.ROTATION_ROUND_KEYS.map(round=>[
    round,Object.fromEntries(m.COMMITTEE_PERSON_IDS.map(person=>[person,{status:'duty',coverFor:null}]))
  ]));
  equal(m.validateCommitteeRotation(full),full);
});
test('Basket rota keeps separate playing and duty plans for each team and attempt',()=>{
  const state=m.defaultState();state.committeeRotation={
    'basket:red:0':{'comms:0':{status:'playing',coverFor:null}},
    'basket:red:1':{'comms:0':{status:'duty',coverFor:null}},
    'basket:blue:0':{'comms:0':{status:'cover',coverFor:'equipment:0'}},
  };
  equal(m.validateState(clone(state)).committeeRotation,state.committeeRotation);
  for(const round of ['basket:0','basket:1','basket:purple:0','basket:red:2','basket:red:00'])throws(()=>m.validateCommitteeRotation({[round]:{}}));
});
test('Rota imports reject free text, unknown rounds or people, extra fields and invalid cover links without mutation',()=>{
  const assignment={status:'duty',coverFor:null},malformed=[null,[],42,'anything',
    {'borrow:7':{}},{'borrow:00':{}},{'cavalry:0':{}},{'basket:red:0':null},{'basket:red:0':[]},
    {'basket:red:0':{'comms:3':assignment}},{'basket:red:0':{'equipment:00':assignment}},
    {'basket:red:0':{'comms:0':null}},{'basket:red:0':{'comms:0':[]}},{'basket:red:0':{'comms:0':{status:'rest',coverFor:null}}},
    {'basket:red:0':{'comms:0':{status:'duty'}}},{'basket:red:0':{'comms:0':{status:'duty',coverFor:null,note:'Private health note'}}},
    {'basket:red:0':{'comms:0':{status:'duty',coverFor:'comms:1'}}},{'basket:red:0':{'comms:0':{status:'playing',coverFor:'comms:1'}}},
    {'basket:red:0':{'comms:0':{status:'cover',coverFor:'comms:0'}}},{'basket:red:0':{'comms:0':{status:'cover',coverFor:'unknown:0'}}},
    {'basket:red:0':{'comms:0':{status:'cover',coverFor:0}}},JSON.parse('{"__proto__":{}}'),
    JSON.parse('{"basket:red:0":{"__proto__":{"status":"duty","coverFor":null}}}')];
  for(const rotation of malformed){const state=m.defaultState();state.committeeRotation=rotation;const before=clone(state);throws(()=>m.validateState(state));equal(state,before);}
  const undefinedCover=m.defaultState();undefinedCover.committeeRotation={'basket:red:0':{'comms:0':{status:'cover',coverFor:undefined}}};throws(()=>m.validateState(undefinedCover));
});
export const results=tests;
export const passed=tests.every(t=>t.pass);
if(typeof process!=='undefined'&&process.argv?.[1]?.endsWith('model.test.mjs')){for(const t of tests)console.log(`${t.pass?'PASS':'FAIL'} ${t.name}${t.error?' — '+t.error:''}`);if(!passed)process.exitCode=1;}
