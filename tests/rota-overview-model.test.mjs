import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultState } from '../model.js';
import { planCommitteeRotation } from '../rota-planner.js';
import { buildDutyOverview } from '../rota-overview-model.js';

const schedule = JSON.parse(readFileSync(new URL('../schedule.json', import.meta.url), 'utf8'));
const test = (name, run) => { run(); console.log(`PASS ${name}`); };
const assignment = (status, coverFor = null) => ({ status, coverFor });
const finalCrew = () => {
  const state = defaultState();
  Object.assign(state.committeeMembers, { director: ['Jason'], judges: [''], 'first-aid': ['Lanny', ''], equipment: ['Rina', 'Timothy', 'Trishya', 'Darren'], warmup: ['Leti'], 'food-water': ['Cindy', 'Vin', 'Maria'], comms: ['Jenni', 'Mario', 'Grace'] });
  state.committeeRotation = planCommitteeRotation(state, { capacity: true, grouped: true }).rotation;
  return state;
};
const shift = (overview, id) => overview.games.flatMap(game => game.shifts).find(item => item.roundKeys.includes(id));
const station = (item, department) => item.stations.find(entry => entry.department === department);

test('Final saved crew has every actual round, named station staff, seven playing turns and fixed Jason/Lanny posts', () => {
  const state = finalCrew(), before = structuredClone(state), overview = buildDutyOverview(state, { schedule });
  assert.equal(overview.people.length, 13);
  assert.deepEqual(overview.fixedPosts.map(post => post.staff.map(person => person.name)), [['Jason'], ['Lanny']]);
  assert.deepEqual(overview.games.map(game => game.id), ['borrow', 'basket', 'cavalry', 'tug', 'relay']);
  assert.deepEqual(overview.games.map(game => game.shifts.length), [3, 5, 2, 4, 3]);
  assert.equal(overview.games.flatMap(game => game.shifts.flatMap(item => item.roundKeys)).length, 25);
  for (const item of overview.games.flatMap(game => game.shifts)) {
    assert.equal(item.freeToPlay.length, 7, item.id);
    assert.equal(item.unassigned.length, 0);
    assert.equal(item.invalidAssignments.length, 0);
    assert.equal(item.warnings.length, 0);
    assert.ok(station(item, 'equipment').staff.length >= 2);
    assert.ok(station(item, 'food-water').staff.length >= 1);
    assert.ok(station(item, 'comms').staff.length >= 1);
    assert.equal(station(item, 'judges').staff.length, 0);
  }
  assert.deepEqual(state, before);
});

test('A cross-committee cover works at the target station once and a station can cover several playing colleagues', () => {
  const state = finalCrew(), round = state.committeeRotation['borrow:0'];
  round['equipment:0'] = assignment('playing');
  round['equipment:1'] = assignment('playing');
  round['equipment:2'] = assignment('duty');
  round['equipment:3'] = assignment('playing');
  round['warmup:0'] = assignment('cover', 'equipment:0');
  const item = shift(buildDutyOverview(state), 'borrow:0');
  assert.deepEqual(station(item, 'equipment').staff.map(person => person.name), ['Trishya', 'Leti']);
  assert.equal(station(item, 'equipment').shortfall, 0);
  assert.ok(!station(item, 'warmup'));
  assert.equal(item.stations.reduce((count, entry) => count + entry.staff.filter(person => person.name === 'Leti').length, 0), 1);
  assert.ok(!item.warnings.some(warning => /Rina|Timothy|Darren/.test(warning)));
});

test('Manual divergent Borrow rounds and Basket tries stay separate with explicit labels and parent timing only', () => {
  const state = finalCrew();
  state.committeeRotation['borrow:1']['equipment:0'] = assignment('duty');
  state.committeeRotation['basket:red:1']['comms:0'] = assignment('duty');
  const overview = buildDutyOverview(state, { schedule });
  const first = shift(overview, 'borrow:0'), second = shift(overview, 'borrow:1');
  assert.notEqual(first, second);
  assert.deepEqual(first.roundKeys, ['borrow:0']); assert.deepEqual(second.roundKeys, ['borrow:1']);
  assert.equal(first.label, 'Round 1'); assert.equal(second.label, 'Round 2');
  assert.equal(first.plannedStart, null); assert.equal(second.plannedEnd, null);
  assert.equal(first.blockStart, '12:44'); assert.equal(second.blockEnd, '12:49');
  assert.equal(first.timingReason, 'split-assignments'); assert.equal(first.handoverSeconds, 60);
  assert.notEqual(shift(overview, 'basket:red:0'), shift(overview, 'basket:red:1'));
  assert.match(shift(overview, 'basket:red:0').label, /Try 1$/);
  assert.match(shift(overview, 'basket:red:1').label, /Try 2$/);
});

test('Assignments compare independent of JSON key order and optional round 7 is never hidden', () => {
  const state = finalCrew();
  state.committeeRotation['borrow:1'] = Object.fromEntries(Object.entries(state.committeeRotation['borrow:0']).reverse());
  assert.deepEqual(shift(buildDutyOverview(state), 'borrow:0').roundKeys, ['borrow:0', 'borrow:1']);
  state.borrow.rounds = 7;
  const overview = buildDutyOverview(state, { schedule });
  const optional = shift(overview, 'borrow:6');
  assert.equal(optional.label, 'Round 7 · optional'); assert.equal(optional.unassigned.length, 13);
  assert.equal(optional.freeToPlay.length, 0); assert.equal(overview.fixedPosts.length, 0);
  assert.equal(overview.games.flatMap(game => game.shifts.flatMap(item => item.roundKeys)).length, 26);
});

test('Missing plans stay unassigned; renames follow stable slots and TBA assignments cannot staff a post', () => {
  const state = finalCrew();
  state.committeeMembers.equipment[0] = 'New Rina';
  const renamed = buildDutyOverview(state);
  assert.ok(renamed.people.some(person => person.id === 'equipment:0' && person.name === 'New Rina'));
  delete state.committeeRotation['borrow:0'];
  state.committeeRotation['borrow:1']['first-aid:1'] = assignment('duty');
  const overview = buildDutyOverview(state), missing = shift(overview, 'borrow:0'), saved = shift(overview, 'borrow:1');
  assert.equal(missing.unassigned.length, 13); assert.equal(missing.freeToPlay.length, 0);
  assert.equal(overview.fixedPosts.length, 0);
  assert.ok(saved.warnings.some(warning => /TBA.*Add a name/.test(warning)));
  assert.deepEqual(station(saved, 'first-aid').staff.map(person => person.name), ['Lanny']);
  const empty = finalCrew(); empty.committeeRotation = {};
  assert.match(buildDutyOverview(empty).warnings.join(' '), /No duty plan is saved/);
});

test('Invalid targets, self covers, duplicate covers/names, and unconfirmed protected covers cannot claim valid staffing', () => {
  const state = finalCrew(), round = state.committeeRotation['borrow:0'];
  round['director:0'] = assignment('playing');
  state.committeeMembers.judges[0] = 'Assistant'; round['judges:0'] = assignment('cover', 'director:0');
  round['first-aid:0'] = assignment('playing'); round['warmup:0'] = assignment('cover', 'first-aid:0');
  round['equipment:0'] = assignment('cover', 'equipment:0');
  round['equipment:1'] = assignment('playing'); round['equipment:2'] = assignment('cover', 'equipment:1'); round['equipment:3'] = assignment('cover', 'equipment:1');
  round['food-water:0'] = assignment('cover', 'first-aid:1');
  const item = shift(buildDutyOverview(state), 'borrow:0');
  assert.equal(station(item, 'director').staff.length, 0); assert.equal(station(item, 'director').pendingStaff[0].name, 'Assistant');
  assert.equal(station(item, 'first-aid').staff.length, 0); assert.equal(station(item, 'first-aid').pendingStaff[0].needsConfirmation, true);
  assert.deepEqual(item.blockedFromPlay.map(person => person.name), ['Jason', 'Lanny']);
  assert.ok(item.invalidAssignments.some(entry => /cannot cover their own/.test(entry.reason)));
  assert.ok(item.invalidAssignments.some(entry => /More than one cover/.test(entry.reason)));
  assert.ok(item.invalidAssignments.some(entry => /Choose a named/.test(entry.reason)));
  assert.ok(item.invalidAssignments.some(entry => /Assistant judge only observes/.test(entry.reason)));
  state.committeeMembers.equipment[1] = '  rina  ';
  const repeated = buildDutyOverview(state);
  assert.match(repeated.warnings.join(' '), /Repeated names/);
  assert.ok(!shift(repeated, 'borrow:0').stations.some(entry => entry.staff.some(person => ['equipment:0', 'equipment:1'].includes(person.id))));
});

test('Handover names actual incoming/outgoing station staff and retains people who stay', () => {
  const state = finalCrew();
  const first = state.committeeRotation['tug:prelim'], next = structuredClone(first);
  first['equipment:0'] = assignment('duty'); first['equipment:1'] = assignment('duty'); first['equipment:2'] = assignment('playing'); first['equipment:3'] = assignment('playing');
  next['equipment:0'] = assignment('playing'); next['equipment:1'] = assignment('duty'); next['equipment:2'] = assignment('duty'); next['equipment:3'] = assignment('playing');
  state.committeeRotation['tug:semi1'] = next;
  const item = shift(buildDutyOverview(state), 'tug:prelim');
  const handover = item.handover.departments.find(entry => entry.department === 'equipment');
  assert.equal(item.handover.nextShiftId, 'tug:semi1');
  assert.deepEqual(handover.incoming.map(person => person.name), ['Trishya']);
  assert.deepEqual(handover.outgoing.map(person => person.name), ['Rina']);
  assert.deepEqual(handover.staying.map(person => person.name), ['Timothy']);
  const nextGame = shift(buildDutyOverview(state), 'basket:white:1');
  assert.equal(nextGame.handoverSeconds, 0);
  assert.equal(nextGame.handover.crossGame, true);
  assert.equal(nextGame.handover.nextGameId, 'cavalry');
  assert.equal(nextGame.handover.nextGameLabel, 'Cavalry Game');
  assert.deepEqual(shift(buildDutyOverview(state), 'relay:2').handover, null);
});

test('Overlong or missing timings stay honest and overview contains no local notes, leaders, health or score payloads', () => {
  const state = finalCrew();
  state.timers['relay:0'] = { duration: 3600000, started: true, remaining: 9999, deadline: 123456 };
  state.notes = 'PRIVATE HEALTH DETAIL'; state.teams[0].leader = 'PRIVATE LEADER';
  const before = structuredClone(state), overview = buildDutyOverview(state, { schedule });
  const item = shift(overview, 'relay:0');
  assert.equal(item.start, null); assert.equal(item.end, null); assert.equal(item.timingReason, 'limits-too-long');
  assert.match(item.warnings.join(' '), /Timer limits do not fit/);
  assert.equal(shift(buildDutyOverview(state), 'tug:final').timingReason, 'no-schedule');
  const serialized = JSON.stringify(overview);
  assert.doesNotMatch(serialized, /PRIVATE HEALTH DETAIL|PRIVATE LEADER|"deadline"|"remaining"|"scores"|"committeeRotation"/);
  assert.deepEqual(state, before);
});


test('Warm-up lead is shown before games using the real schedule, and roster renames update the display',()=>{
 const state=finalCrew(),overview=buildDutyOverview(state,{schedule});
 assert.deepEqual(overview.warmup.staff.map(person=>person.name),['Leti']);
 assert.equal(overview.warmup.start,'12:38');assert.equal(overview.warmup.end,'12:43');
 state.committeeMembers.warmup[0]='New warm-up lead';
 assert.equal(buildDutyOverview(state,{schedule}).warmup.staff[0].name,'New warm-up lead');
});
