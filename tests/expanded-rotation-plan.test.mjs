import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultState } from '../model.js';
import { planCommitteeRotation, rotationRoundLocked } from '../rota-planner.js';
import { buildDutyOverview } from '../rota-overview-model.js';
import { rotationInterval } from '../rota-intervals.js';

const schedule = JSON.parse(readFileSync(new URL('../schedule.json', import.meta.url), 'utf8'));
const options = { replace: true, capacity: true, grouped: true };
const test = (name, run) => { run(); console.log(`PASS ${name}`); };
const assignment = (status, coverFor = null) => ({ status, coverFor });
const departmentOf = id => id.slice(0, id.lastIndexOf(':'));
function expandedCrew() {
  const state = defaultState();
  // Preserve the published 25-round crew as a historical fixture.
  state.borrow.rounds = 6;
  Object.assign(state.committeeMembers, {
    director: ['Jason'], judges: [''], 'first-aid': ['Lanny', ''],
    equipment: ['Rina', 'Timothy', 'Trishya', 'Darren'], warmup: ['Leti'],
    'food-water': ['Cindy', 'Vin', 'Maria', 'Olin'],
    comms: ['Jenni', 'Mario', 'Grace', 'Jesslyn'],
  });
  return state;
}

test('Olin and Jesslyn enter all 25 rounds with nine support volunteers available and essential stations covered', () => {
  const state = expandedCrew(), before = structuredClone(state);
  const plan = planCommitteeRotation(state, options);
  assert.deepEqual(state, before, 'Planning never changes saved data');
  assert.equal(plan.summary.people.length, 15);
  assert.equal(plan.summary.playingLimit, 9);
  assert.equal(plan.summary.plannedRounds, 25);
  assert.equal(plan.summary.skippedRounds, 0);
  assert.equal(plan.summary.preservedRounds, 0);
  assert.ok(!Object.hasOwn(plan.rotation, 'borrow:6'));
  for (const [key, round] of Object.entries(plan.rotation)) {
    assert.equal(Object.keys(round).length, 15, key);
    assert.ok(round['food-water:3'], `Olin is assigned in ${key}`);
    assert.ok(round['comms:3'], `Jesslyn is assigned in ${key}`);
    assert.deepEqual(round['director:0'], assignment('duty'));
    assert.deepEqual(round['first-aid:0'], assignment('duty'));
    assert.deepEqual(round['warmup:0'], assignment('playing'));
    assert.ok(!round['judges:0']);
    assert.ok(!round['first-aid:1']);
    assert.equal(Object.values(round).filter(value => value.status === 'playing').length, 9, key);
    const duty = {};
    for (const [person, entry] of Object.entries(round)) {
      if (entry.status === 'playing') continue;
      const department = departmentOf(person);
      duty[department] = (duty[department] || 0) + 1;
      if (entry.status === 'cover') {
        assert.equal(departmentOf(entry.coverFor), department, 'Support stays in its own committee');
        assert.equal(round[entry.coverFor].status, 'playing', 'The named person being covered can play');
      }
    }
    assert.equal(duty.equipment, 2, key);
    assert.equal(duty['food-water'], 1, key);
    assert.equal(duty.comms, 1, key);
  }
});

test('Rebalanced duty is fair within each staffed committee and gives every support volunteer a turn in each game', () => {
  const plan = planCommitteeRotation(expandedCrew(), options);
  for (const department of ['equipment', 'food-water', 'comms']) {
    const people = plan.summary.people.filter(person => person.department === department);
    assert.equal(people.length, 4);
    const dutyTurns = people.map(person => person.dutyTurns + person.coverTurns);
    assert.ok(Math.max(...dutyTurns) - Math.min(...dutyTurns) <= 1, `${department} duty differs by at most one round`);
    for (const person of people) {
      for (const game of ['borrow', 'basket', 'cavalry', 'tug', 'relay']) {
        assert.ok(person.byGame[game] > 0, `${person.name} has a playing turn in ${game}`);
      }
    }
  }
});

test('Paired rounds retain their crews and the public duty plan includes both new names without warnings', () => {
  const state = expandedCrew(), plan = planCommitteeRotation(state, options), crews = new Map();
  state.committeeRotation = plan.rotation;
  for (const [key, round] of Object.entries(plan.rotation)) {
    const group = rotationInterval(state, key).groupKey;
    if (crews.has(group)) assert.deepEqual(round, crews.get(group));
    else crews.set(group, round);
  }
  const overview = buildDutyOverview(state, { schedule });
  assert.deepEqual(overview.fixedPosts.map(post => post.staff.map(person => person.name)), [['Jason'], ['Lanny']]);
  assert.deepEqual(overview.games.map(game => game.shifts.length), [3, 5, 2, 4, 3]);
  for (const shift of overview.games.flatMap(game => game.shifts)) {
    assert.equal(shift.freeToPlay.length, 9, shift.id);
    assert.equal(shift.unassigned.length, 0, shift.id);
    assert.equal(shift.warnings.length, 0, shift.id);
    const assigned = [...shift.freeToPlay, ...shift.stations.flatMap(station => station.staff)];
    for (const name of ['Olin', 'Jesslyn']) assert.ok(assigned.some(person => person.name === name), `${name} is visible in ${shift.id}`);
  }
  assert.deepEqual(overview.warmup.staff.map(person => person.name), ['Leti']);
});

test('An explicit rebalance replaces future manual drafts while normal autofill keeps them', () => {
  const state = expandedCrew();
  state.committeeRotation['borrow:2'] = { 'director:0': assignment('duty') };
  const manual = structuredClone(state.committeeRotation['borrow:2']);
  const retained = planCommitteeRotation(state, { capacity: true, grouped: true });
  assert.deepEqual(retained.rotation['borrow:2'], manual);
  assert.ok(retained.summary.preservedKeys.includes('borrow:2'));
  const rebalanced = planCommitteeRotation(state, options);
  assert.notDeepEqual(rebalanced.rotation['borrow:2'], manual);
  assert.equal(Object.keys(rebalanced.rotation['borrow:2']).length, 15);
  assert.deepEqual(state.committeeRotation['borrow:2'], manual);
});

test('Even explicit rebalance keeps started, finished and partially scored rounds untouched', () => {
  const state = expandedCrew();
  state.committeeRotation = planCommitteeRotation(state, options).rotation;
  state.timers['borrow:0'] = { duration: 90000, remaining: 90000, deadline: null, signature: '', started: true };
  state.basket.scores[0][0] = 1;
  state.cavalry.divisions.women.started = true;
  state.finished.push('tug:prelim');
  state.relay.scores[0][0] = 1;
  const locked = ['borrow:0', 'basket:red:0', 'cavalry:women', 'tug:prelim', 'relay:0'];
  const before = structuredClone(state), plan = planCommitteeRotation(state, options);
  assert.deepEqual(state, before, 'The live scores, timers and old assignments stay unchanged');
  for (const key of locked) {
    assert.ok(rotationRoundLocked(state, key), key);
    assert.ok(plan.summary.skippedKeys.includes(key), key);
    assert.deepEqual(plan.rotation[key], before.committeeRotation[key], key);
  }
  assert.equal(plan.summary.skippedRounds, locked.length);
  assert.equal(plan.summary.plannedRounds, 25 - locked.length);
});
