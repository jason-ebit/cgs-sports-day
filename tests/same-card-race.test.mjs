import assert from 'node:assert/strict';
import { defaultState, TEAM_IDS, gameDone, totals, championship, validateState } from '../model.js';
import { recordSuccess, roundDone, resetRound } from '../rounds.js';
import { makeClock, startClock } from '../timer-model.js';
import { nextTarget, activeRoundKey } from '../flow-model.js';
import { buildGameScoreboard, buildGameScoreboardTimer } from '../scoreboard-model.js';
import { planCommitteeRotation } from '../rota-planner.js';

let passed = 0;
const test = (name, run) => { run(); passed++; console.log(`PASS ${name}`); };
function play(state, round) {
  const key = `borrow:${round}`;
  state.timers[key] = makeClock(round < 2 || round === 6 ? 90 : 120);
  assert.equal(startClock(state.timers, key, 1000), true);
  state.activeKey = key;
}
function finish(state, round, order = TEAM_IDS) {
  play(state, round);
  for (const id of order) assert.equal(recordSuccess(state, 'borrow', round, id), true);
}
function expandedCrew() {
  const state = defaultState();
  Object.assign(state.committeeMembers, {
    director: ['Jason'], judges: [''], 'first-aid': ['Lanny', ''],
    equipment: ['Rina', 'Timothy', 'Trishya', 'Darren'], warmup: ['Leti'],
    'food-water': ['Cindy', 'Vin', 'Maria', 'Olin'],
    comms: ['Jenni', 'Mario', 'Grace', 'Jesslyn'],
  });
  return state;
}

test('Six completed rounds lead to the shared-card race, with no premature overall points', () => {
  const state = defaultState();
  assert.equal(state.borrow.rounds, 7);
  for (let round = 0; round < 6; round++) finish(state, round);
  assert.equal(gameDone(state, 'borrow'), false);
  assert.equal(championship(state).completed, 0);
  assert.ok(championship(state).rows.every(row => row.points[0] === null));
  assert.deepEqual(totals(state, 'borrow'), Array(5).fill(null));
  assert.deepEqual(nextTarget(state, 'borrow:5'), { key: 'borrow:6', label: 'Round 7' });
  assert.equal(buildGameScoreboard(state, { key: 'borrow:5' }).status, 'round-complete');

  // A prepared R7 clock or the running R6 clock cannot authorise race results.
  state.timers['borrow:6'] = makeClock(90);
  const before = structuredClone(state);
  for (const success of [true, false]) assert.equal(recordSuccess(state, 'borrow', 6, 'white', success), false);
  assert.deepEqual(state, before);
  assert.equal(buildGameScoreboardTimer(state, { key: 'borrow:6' }, 1000).text, '01:30');

  play(state, 6);
  assert.equal(activeRoundKey(state), 'borrow:6');
  for (const id of ['white', 'green', 'yellow', 'blue']) assert.equal(recordSuccess(state, 'borrow', 6, id), true);
  assert.equal(gameDone(state, 'borrow'), false);
  assert.equal(championship(state).completed, 0);
  assert.equal(recordSuccess(state, 'borrow', 6, 'red'), true);
  assert.deepEqual(state.borrow.scores.map(row => row[6]), [2, 2, 3, 4, 5]);
  assert.deepEqual(totals(state, 'borrow'), [32, 26, 21, 16, 17]);
  assert.equal(gameDone(state, 'borrow'), true);
  assert.equal(roundDone(state, 'borrow:6'), true);
  assert.equal(activeRoundKey(state), null);
  assert.equal(nextTarget(state, 'borrow:6'), null);
  const overall = championship(state);
  assert.equal(overall.completed, 1);
  assert.deepEqual(Object.fromEntries(overall.rows.map(row => [row.id, row.points[0]])), {
    red: 5, blue: 4, yellow: 3, white: 2, green: 1,
  });
  const board = buildGameScoreboard(state, { key: 'borrow:6' });
  assert.equal(board.status, 'game-complete');
  assert.deepEqual(board.rows.map(row => row.teamId), ['red', 'blue', 'yellow', 'white', 'green']);
  assert.deepEqual(board.rows.map(row => row.score), [32, 26, 21, 17, 16]);
  assert.equal(buildGameScoreboardTimer(state, { key: 'borrow:6' }, 1000).status, 'game-complete');
  const finished = structuredClone(state);
  for (const id of TEAM_IDS) for (const success of [true, false]) assert.equal(recordSuccess(state, 'borrow', 6, id, success), false);
  assert.deepEqual(state, finished, 'A finished race is locked against further scoring');
  assert.deepEqual(validateState(state), state, 'The finished seven-round game remains a valid shared save');
});

test('Race failures earn zero without consuming the next finish award', () => {
  const state = defaultState();
  play(state, 6);
  assert.equal(recordSuccess(state, 'borrow', 6, 'red', false), true);
  for (const id of ['white', 'green', 'blue', 'yellow']) assert.equal(recordSuccess(state, 'borrow', 6, id), true);
  assert.deepEqual(state.borrow.scores.map(row => row[6]), [0, 3, 2, 4, 5]);
  assert.equal(roundDone(state, 'borrow:6'), true);
  assert.equal(gameDone(state, 'borrow'), false, 'The race alone cannot finish the earlier six rounds');
  assert.deepEqual(nextTarget(state, 'borrow:6'), { key: 'borrow:0', label: 'Round 1' });
});

test('Resetting the final race withdraws overall points and requires its timer to start again', () => {
  const state = defaultState();
  for (let round = 0; round < state.borrow.rounds; round++) finish(state, round);
  const firstSix = state.borrow.scores.map(row => row.slice(0, 6));
  assert.equal(championship(state).completed, 1);
  resetRound(state, 'borrow:6');
  assert.equal(gameDone(state, 'borrow'), false);
  assert.equal(championship(state).completed, 0);
  assert.deepEqual(state.borrow.scores.map(row => row.slice(0, 6)), firstSix);
  assert.deepEqual(state.borrow.scores.map(row => row[6]), Array(5).fill(null));
  assert.equal(state.timers['borrow:6'], undefined);
  assert.equal(recordSuccess(state, 'borrow', 6, 'red'), false);
  finish(state, 6);
  assert.equal(championship(state).completed, 1);
  assert.deepEqual(state.borrow.scores.map(row => row[6]), [5, 4, 3, 2, 2]);
});

test('A new 26-round duty plan covers the race and keeps all named helpers in the rotation', () => {
  const state = expandedCrew(), before = structuredClone(state);
  const plan = planCommitteeRotation(state, { capacity: true, grouped: true });
  assert.deepEqual(state, before);
  assert.equal(plan.summary.plannedRounds, 26);
  assert.equal(plan.summary.playingLimit, 9);
  const race = plan.rotation['borrow:6'];
  assert.equal(Object.keys(race).length, 15);
  assert.deepEqual(race['director:0'], { status: 'duty', coverFor: null });
  assert.deepEqual(race['first-aid:0'], { status: 'duty', coverFor: null });
  assert.equal(Object.values(race).filter(entry => entry.status === 'playing').length, 9);
  for (const [department, expected] of [['equipment', 2], ['food-water', 1], ['comms', 1]]) {
    assert.equal(Object.entries(race).filter(([id, entry]) => id.startsWith(department + ':') && entry.status !== 'playing').length, expected);
  }
  assert.ok(race['food-water:3'], 'Olin has a race assignment');
  assert.ok(race['comms:3'], 'Jesslyn has a race assignment');
  for (const person of plan.summary.people.filter(person => !['director', 'first-aid'].includes(person.department))) assert.ok(person.byGame.borrow > 0, person.name);
});

test('Enabling the race fills its missing crew without rewriting the saved 25-round plan', () => {
  const state = expandedCrew();
  state.borrow.rounds = 6;
  state.committeeRotation = planCommitteeRotation(state, { capacity: true, grouped: true }).rotation;
  const saved = structuredClone(state.committeeRotation);
  state.borrow.rounds = 7;
  const plan = planCommitteeRotation(state, { capacity: true, grouped: true });
  assert.equal(plan.summary.plannedRounds, 1);
  assert.equal(plan.summary.preservedRounds, 25);
  assert.ok(plan.rotation['borrow:6']);
  for (const [key, crew] of Object.entries(saved)) assert.deepEqual(plan.rotation[key], crew, key);
});

console.log(`${passed} same-card race tests passed.`);
