import assert from 'node:assert/strict';
import { defaultState, TEAM_IDS } from '../model.js';
import { publicSnapshot, mergePublicState } from '../sync.js';
import { makeClock, startClock, pauseClock, addTime } from '../timer-model.js';
import { recordSuccess, eliminate, recordWinner, setBasketScore, finishBasketAttempt } from '../rounds.js';
import { scoreUnits, changedScoreUnits, rebaseScoreSnapshot, reanchorScoreIntent, sameScoreValue } from '../sync-merge.js';

let passed = 0, failed = 0;
const test = (name, run) => { try { run(); passed++; console.log('PASS ' + name); } catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.message); } };
const snap = state => publicSnapshot(state);
const clone = value => structuredClone(value);
const play = (state, key, seconds = 90) => { state.timers[key] = makeClock(seconds); startClock(state.timers, key, 1000); state.activeKey = key; return state; };
const versions = (base, remote) => {
  const changed = new Set(changedScoreUnits(base, remote));
  return Object.fromEntries(Object.keys(scoreUnits(base)).map(key => [key, changed.has(key) ? 11 : 10]));
};
const rebase = (base, desired, remote, extra = {}) => rebaseScoreSnapshot(base, desired, remote, {
  baseRevision: 10, currentRevision: 11, unitVersions: versions(base, remote), resetRevision: 0, now: 5000, ...extra,
});
const arrived = (base, game, id, success = true) => { const next = mergePublicState(base); assert.equal(recordSuccess(next, game, 0, id, success), true); return snap(next); };

test('Independent names, roster slots and checklist items merge without copying unrelated state', () => {
  const base = snap(defaultState()), local = clone(base), remote = clone(base);
  local.teams[0].name = 'Fire'; local.committeeMembers.equipment[0] = 'Rina'; local.equipmentColdPacksReady = true;
  remote.teams[1].name = 'Ocean'; remote.committeeMembers.equipment[1] = 'Timothy'; remote.equipmentReady.balls = true;
  const result = rebase(base, local, remote);
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.teams[0].name, 'Fire'); assert.equal(result.snapshot.teams[1].name, 'Ocean');
  assert.deepEqual(result.snapshot.committeeMembers.equipment.slice(0, 2), ['Rina', 'Timothy']);
  assert.equal(result.snapshot.equipmentReady.balls, true); assert.equal(result.snapshot.equipmentColdPacksReady, true);
});

test('Same-field conflicting edits stop while identical boolean changes coalesce', () => {
  const base = snap(defaultState()), local = clone(base), remote = clone(base);
  local.teams[0].name = 'Fire'; remote.teams[0].name = 'Rose';
  assert.equal(rebase(base, local, remote).ok, false);
  local.teams[0].name = remote.teams[0].name;
  assert.equal(rebase(base, local, remote).noop, true);
});

test('Monotonic unit versions reject ABA even when current values equal the old base', () => {
  const base = snap(defaultState()), local = clone(base);
  local.equipmentReady.balls = true;
  const result = rebase(base, local, clone(base), { currentRevision: 12, unitVersions: { 'equipment:balls': 12 } });
  assert.equal(result.ok, false); assert.deepEqual(result.conflicts, ['equipment:balls']);
});

test('Reset barriers reject old ordered actions and barriers themselves require exact revision', () => {
  const base = snap(play(defaultState(), 'borrow:0')), local = arrived(base, 'borrow', 'red');
  assert.equal(rebase(base, local, clone(base), { resetRevision: 11 }).ok, false);
  assert.equal(rebase(base, local, clone(base), { barrier: true }).ok, false);
  assert.equal(rebase(base, local, clone(base), { barrier: true, currentRevision: 10 }).ok, true);
});

test('Simultaneous Borrow successes receive distinct server-ordered awards', () => {
  const base = snap(play(defaultState(), 'borrow:0'));
  const result = rebase(base, arrived(base, 'borrow', 'red'), arrived(base, 'borrow', 'blue'));
  assert.equal(result.ok, true); assert.deepEqual(result.snapshot.borrow.scores.map(row => row[0]), [4, 5, null, null, null]);
});

test('Borrow failures stay zero without consuming a success place; contradictory duplicate taps stop', () => {
  const base = snap(play(defaultState(), 'borrow:0'));
  const result = rebase(base, arrived(base, 'borrow', 'red', false), arrived(base, 'borrow', 'blue'));
  assert.equal(result.ok, true); assert.deepEqual(result.snapshot.borrow.scores.map(row => row[0]), [0, 5, null, null, null]);
  assert.equal(rebase(base, arrived(base, 'borrow', 'red', false), arrived(base, 'borrow', 'red')).ok, false);
  assert.equal(rebase(base, arrived(base, 'borrow', 'red'), arrived(base, 'borrow', 'red')).noop, true);
});

test('Multiple queued Borrow arrivals retain local order while receiving recomputed awards', () => {
  const base = snap(play(defaultState(), 'borrow:0')), state = mergePublicState(base);
  recordSuccess(state, 'borrow', 0, 'red'); recordSuccess(state, 'borrow', 0, 'yellow');
  const result = rebase(base, snap(state), arrived(base, 'borrow', 'blue'));
  assert.equal(result.ok, true); assert.deepEqual(result.snapshot.borrow.scores.map(row => row[0]), [4, 5, 3, null, null]);
});

test('Relay replay preserves unique arrival places instead of merging duplicate first places', () => {
  const base = snap(play(defaultState(), 'relay:0'));
  const result = rebase(base, arrived(base, 'relay', 'red'), arrived(base, 'relay', 'blue'));
  assert.equal(result.ok, true); assert.deepEqual(result.snapshot.relay.scores.map(row => row[0]), [2, 1, null, null, null]);
});

test('The last rebased arrival derives round completion and pauses only that timer', () => {
  const state = play(defaultState(), 'relay:0');
  for (const id of TEAM_IDS.slice(0, 3)) recordSuccess(state, 'relay', 0, id);
  const base = snap(state), local = arrived(base, 'relay', 'green'), remote = arrived(base, 'relay', 'white');
  const result = rebase(base, local, remote);
  assert.equal(result.ok, true); assert.deepEqual(result.snapshot.relay.scores.map(row => row[0]), [1, 2, 3, 5, 4]);
  assert.equal(result.snapshot.timers['relay:0'].deadline, null); assert.equal(result.snapshot.activeKey, null);
});

test('Cavalry concurrent eliminations append in order, but cannot eliminate the last horse', () => {
  const state = play(defaultState(), 'cavalry:women');
  Object.assign(state.cavalry.divisions.women, { started: true, active: [...TEAM_IDS], eliminated: [] });
  const base = snap(state), local = mergePublicState(base), remote = mergePublicState(base);
  eliminate(local, 'women', 'red'); eliminate(remote, 'women', 'blue');
  let result = rebase(base, snap(local), snap(remote));
  assert.equal(result.ok, true); assert.deepEqual(result.snapshot.cavalry.divisions.women.eliminated, ['blue', 'red']);
  state.cavalry.divisions.women.active = ['red', 'blue'];
  const lastBase = snap(state), lastLocal = mergePublicState(lastBase), lastRemote = mergePublicState(lastBase);
  eliminate(lastLocal, 'women', 'red'); eliminate(lastRemote, 'women', 'blue');
  result = rebase(lastBase, snap(lastLocal), snap(lastRemote));
  assert.equal(result.ok, false); assert.deepEqual(result.snapshot.cavalry.divisions.women.eliminated, ['blue']);
});

test('Tug independent matches merge while opposing winners in one match conflict', () => {
  const state = defaultState(); state.tug.slots = [...TEAM_IDS]; state.tug.locked = true;
  play(state, 'tug:prelim'); play(state, 'tug:semi2');
  const base = snap(state), local = mergePublicState(base), remote = mergePublicState(base);
  recordWinner(local, 'prelim', 'red'); recordWinner(remote, 'semi2', 'white');
  const result = rebase(base, snap(local), snap(remote));
  assert.equal(result.ok, true); assert.equal(result.snapshot.tug.winners.prelim, 'red'); assert.equal(result.snapshot.tug.winners.semi2, 'white');
  const opposite = mergePublicState(base); recordWinner(opposite, 'prelim', 'blue');
  assert.equal(rebase(base, snap(local), snap(opposite)).ok, false);
});

test('Basket attempts merge independently but same-attempt counters never silently overwrite', () => {
  const state = defaultState(); play(state, 'basket:red:0'); play(state, 'basket:blue:0');
  const base = snap(state), local = mergePublicState(base), remote = mergePublicState(base);
  setBasketScore(local, 'red', 0, 3); setBasketScore(remote, 'blue', 0, 7);
  let result = rebase(base, snap(local), snap(remote));
  assert.equal(result.ok, true); assert.equal(result.snapshot.basket.scores[0][0], 3); assert.equal(result.snapshot.basket.scores[1][0], 7);
  setBasketScore(remote, 'red', 0, 4);
  result = rebase(base, snap(local), snap(remote)); assert.equal(result.ok, false);
});

test('Basket locking keeps its score and finished journal atomic without losing another team lock', () => {
  const state = defaultState(); play(state, 'basket:red:0'); play(state, 'basket:blue:0');
  const base = snap(state), local = mergePublicState(base), remote = mergePublicState(base);
  setBasketScore(local, 'red', 0, 0); finishBasketAttempt(local, 'red', 0);
  setBasketScore(remote, 'blue', 0, 2); finishBasketAttempt(remote, 'blue', 0);
  const result = rebase(base, snap(local), snap(remote));
  assert.equal(result.ok, true); assert.deepEqual(result.snapshot.finished, ['basket:blue:0', 'basket:red:0']);
  assert.equal(result.snapshot.basket.scores[0][0], 0);
});

test('Independent rota entries merge; changed roster or a started/scored round blocks stale plans', () => {
  const base = snap(defaultState()), local = clone(base), remote = clone(base);
  local.committeeRotation = { 'borrow:0': { 'equipment:0': { status: 'duty', coverFor: null } } };
  remote.committeeRotation = { 'borrow:0': { 'comms:0': { status: 'playing', coverFor: null } } };
  assert.equal(rebase(base, local, remote).ok, true);
  remote.committeeMembers.equipment[0] = 'New name'; assert.equal(rebase(base, local, remote).ok, false);
  const started = clone(base); started.timers['borrow:0'] = { ...makeClock(90), started: true };
  assert.equal(rebase(base, local, started).ok, false);
});

test('Deleted rota version tombstones prevent an old assignment from reappearing', () => {
  const base = snap(defaultState()), local = clone(base);
  local.committeeRotation = { 'borrow:0': { 'equipment:0': { status: 'duty', coverFor: null } } };
  const result = rebase(base, local, clone(base), { unitVersions: { 'rota:borrow:0:equipment:0': 12 }, currentRevision: 12 });
  assert.equal(result.ok, false);
});

test('Starting another timer rebases through the one-running-clock rule', () => {
  const state = play(defaultState(), 'borrow:0'), base = snap(state), local = mergePublicState(base), remote = mergePublicState(base);
  play(local, 'relay:0'); addTime(remote.timers['borrow:0'], 30, 5000);
  const result = rebase(base, snap(local), snap(remote));
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.timers['borrow:0'].deadline, null);
  assert.notEqual(result.snapshot.timers['relay:0'].deadline, null);
  assert.equal(result.snapshot.activeKey, 'relay:0');
});

test('Distinct concurrent +30 taps both extend the clock', () => {
  const base = snap(play(defaultState(), 'borrow:0')), local = clone(base), remote = clone(base);
  addTime(local.timers['borrow:0'], 30, 5000); addTime(remote.timers['borrow:0'], 30, 5000);
  const result = rebase(base, local, remote);
  assert.equal(result.ok, true); assert.equal(result.snapshot.timers['borrow:0'].deadline, base.timers['borrow:0'].deadline + 60000);
});

test('An old expiry does not cancel a newer timer extension', () => {
  const base = snap(play(defaultState(), 'borrow:0')), local = clone(base), remote = clone(base);
  pauseClock(local.timers['borrow:0'], 100000); addTime(remote.timers['borrow:0'], 30, 5000);
  const result = rebase(base, local, remote, { now: 100000 });
  assert.equal(result.ok, true); assert.equal(result.snapshot.timers['borrow:0'].deadline, remote.timers['borrow:0'].deadline);
});

test('A stale activeKey-only change must apply intentionally or report a conflict', () => {
  const state = play(defaultState(), 'borrow:0'); pauseClock(state.timers['borrow:0'], 5000);
  const base = snap(state), local = clone(base), remote = clone(base);
  local.activeKey = null; remote.equipmentReady.balls = true;
  const result = rebase(base, local, remote, { unitVersions: { timing: 11 } });
  assert.ok(!result.ok || result.snapshot.activeKey === null, 'must not silently drop the requested shortcut change');
});

test('Own-ack tail reanchoring preserves remote arrivals and recomputes the next queued award', () => {
  const initial = snap(play(defaultState(), 'borrow:0'));
  const oldHead = arrived(initial, 'borrow', 'red');
  const oldTailState = mergePublicState(oldHead); recordSuccess(oldTailState, 'borrow', 0, 'yellow');
  const remote = arrived(initial, 'borrow', 'blue');
  const rebasedHead = rebase(initial, oldHead, remote).snapshot;
  const tail = reanchorScoreIntent(oldHead, snap(oldTailState), rebasedHead, { now: 5000 });
  assert.deepEqual(tail.borrow.scores.map(row => row[0]), [4, 5, 3, null, null]);
});

test('Unsupported tail timer resets cannot overwrite a newer anchor clock', () => {
  const base = snap(play(defaultState(), 'borrow:0')), local = clone(base), anchor = clone(base);
  Object.assign(local.timers['borrow:0'], { deadline: null, remaining: 90000, started: false });
  addTime(anchor.timers['borrow:0'], 30, 5000);
  const untouched = clone(anchor);
  assert.throws(() => reanchorScoreIntent(base, local, anchor, { now: 5000 }), /needs review/);
  assert.deepEqual(anchor, untouched);
});

test('Rebasing never changes its inputs or introduces private model fields', () => {
  const base = snap(defaultState()), local = clone(base), remote = clone(base);
  local.equipmentReady.balls = true; remote.committeeMembers.comms[0] = 'Documentary';
  const originals = [clone(base), clone(local), clone(remote)];
  const result = rebase(base, local, remote);
  assert.deepEqual([base, local, remote], originals);
  assert.doesNotMatch(JSON.stringify(result.snapshot), /committeeNotes|participants|"leader"|"counts"|"rule"/);
  assert.equal(sameScoreValue(result.snapshot, clone(result.snapshot)), true);
});

console.log(`${passed} sync merge tests passed; ${failed} failed.`);
assert.equal(failed, 0);
