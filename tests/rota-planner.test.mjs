import assert from 'node:assert/strict';
import { defaultState } from '../model.js';
import { COMMITTEE_PERSON_IDS, validateCommitteeRotation } from '../rota-model.js';
import { planCommitteeRotation, plannerRoster, reliefCandidates, rotationRoundLocked } from '../rota-planner.js';

const tests = [];
const test = (name, run) => { run(); tests.push(name); };
const departmentOf = id => id.slice(0, id.lastIndexOf(':'));
const assignment = (status, coverFor = null) => ({ status, coverFor });
function namedState() {
  const state = defaultState();
  // These planner fairness fixtures describe the original six-round format.
  state.borrow.rounds = 6;
  for (const [department, members] of Object.entries(state.committeeMembers)) state.committeeMembers[department] = members.map((_, slot) => `${department} person ${slot + 1}`);
  return state;
}
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function checkCoverage(round, { firstAidRelief = null, judgeRelief = null } = {}) {
  const counts = {}, coverTargets = [];
  for (const [id, entry] of Object.entries(round)) {
    if (entry.status === 'playing') continue;
    const department = entry.status === 'cover' ? departmentOf(entry.coverFor) : departmentOf(id);
    counts[department] = (counts[department] || 0) + 1;
    if (entry.status === 'cover') {
      assert.equal(round[entry.coverFor].status, 'playing');
      coverTargets.push(entry.coverFor);
      if (department === 'first-aid') assert.equal(id, firstAidRelief);
      if (['director', 'judges'].includes(department)) assert.equal(id, judgeRelief);
      assert.ok(!['first-aid', 'director', 'judges'].includes(departmentOf(id)), 'Critical staff never cover a different post');
    }
  }
  assert.equal(new Set(coverTargets).size, coverTargets.length, 'No two covers are assigned to one absent person');
  assert.ok(counts['first-aid'] >= 2, 'Both first-aid posts have named staff');
  assert.ok(counts.director >= 1, 'The main-judge post has named staff');
  assert.ok(counts.judges >= 1, 'The assistant-observer post has named staff');
  assert.ok(counts.equipment >= 2, 'At least two people handle equipment');
  assert.ok(counts['food-water'] >= 1, 'The water station has cover');
  assert.ok(counts.comms >= 1, 'At least one person handles photos');
  assert.ok(Object.values(round).filter(entry => entry.status === 'playing').length <= 5);
}

test('Default planning gives support members fair turns within every game while keeping critical posts on duty', () => {
  const state = namedState(), plan = planCommitteeRotation(state);
  assert.equal(plan.summary.plannedRounds, 25);
  assert.equal(Object.hasOwn(plan.rotation, 'borrow:6'), false);
  for (const round of Object.values(plan.rotation)) {
    checkCoverage(round);
    for (const id of ['director:0', 'judges:0', 'first-aid:0', 'first-aid:1']) assert.deepEqual(round[id], assignment('duty'));
  }
  const support = plan.summary.people.filter(person => !['director', 'judges', 'first-aid'].includes(person.department));
  for (const game of ['borrow', 'basket', 'cavalry', 'tug', 'relay']) {
    const turns = support.map(person => person.byGame[game] || 0);
    assert.ok(Math.max(...turns) - Math.min(...turns) <= 1, `${game} turns differ by at most one`);
  }
  assert.ok(support.every(person => person.playingTurns > 0));
  assert.deepEqual(validateCommitteeRotation(plan.rotation), plan.rotation);
});

test('Planning is deterministic, works on a frozen snapshot and never mutates source assignments or scores', () => {
  const state = namedState();
  state.committeeRotation['borrow:0'] = { 'comms:0': assignment('playing') };
  const before = JSON.stringify(state);
  freeze(state);
  const first = planCommitteeRotation(state), second = planCommitteeRotation(state);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(state), before);
  assert.notEqual(first.rotation, state.committeeRotation);
});

test('Confirmed named relief allows both first-aid staff and both judges playing turns, one per role at a time', () => {
  const options = { firstAidRelief: 'team-leaders:0', judgeRelief: 'team-leaders:1' };
  const plan = planCommitteeRotation(namedState(), options);
  for (const round of Object.values(plan.rotation)) {
    checkCoverage(round, options);
    assert.ok(['first-aid:0', 'first-aid:1'].filter(id => round[id].status === 'playing').length <= 1);
    assert.ok(['director:0', 'judges:0'].filter(id => round[id].status === 'playing').length <= 1);
    assert.notEqual(round['judges:0'].coverFor, 'director:0', 'The assistant is never promoted automatically');
  }
  for (const id of ['director:0', 'judges:0', 'first-aid:0', 'first-aid:1']) assert.ok(plan.summary.people.find(person => person.id === id).playingTurns > 0);
});

test('One confirmed relief person may serve both roles across rounds but only one role in each round', () => {
  const options = { firstAidRelief: 'warmup:0', judgeRelief: 'warmup:0' };
  const plan = planCommitteeRotation(namedState(), options);
  for (const round of Object.values(plan.rotation)) {
    checkCoverage(round, options);
    const criticalPlaying = ['director:0', 'judges:0', 'first-aid:0', 'first-aid:1'].filter(id => round[id].status === 'playing');
    assert.ok(criticalPlaying.length <= 1);
    if (criticalPlaying.length) assert.deepEqual(round['warmup:0'], assignment('cover', criticalPlaying[0]));
  }
  for (const id of ['director:0', 'judges:0', 'first-aid:0', 'first-aid:1']) assert.ok(plan.summary.people.find(person => person.id === id).playingTurns > 0);
});

test('Relief cannot leave its own department below its required staffing', () => {
  const state = namedState();
  state.committeeMembers.comms = ['Only photographer', ''];
  const plan = planCommitteeRotation(state, { firstAidRelief: 'comms:0' });
  for (const round of Object.values(plan.rotation)) {
    assert.notEqual(round['comms:0'].coverFor, 'first-aid:0');
    assert.notEqual(round['comms:0'].coverFor, 'first-aid:1');
    assert.equal(round['first-aid:0'].status, 'duty');
    assert.equal(round['first-aid:1'].status, 'duty');
  }
  assert.ok(plan.warnings.some(text => text.includes('First-aid relief could not be scheduled')));
});

test('Understaffed Equipment stays on duty until the missing names are filled', () => {
  const state = namedState();
  state.committeeMembers.equipment = ['Only equipment person', '', ''];
  const plan = planCommitteeRotation(state);
  for (const round of Object.values(plan.rotation)) assert.equal(round['equipment:0'].status, 'duty');
  assert.ok(plan.warnings.some(text => text.includes('Equipment needs at least two')));
});

test('Saved protected playing turns cannot hide unavailable relief in newly filled rounds', () => {
  const state = namedState();
  state.committeeMembers.comms = ['Only photographer', ''];
  state.committeeRotation['borrow:0'] = {
    'first-aid:0': assignment('playing'),
    'director:0': assignment('playing'),
  };
  const plan = planCommitteeRotation(state, { firstAidRelief: 'comms:0', judgeRelief: 'comms:0' });
  assert.deepEqual(plan.rotation['borrow:0'], state.committeeRotation['borrow:0']);
  assert.ok(plan.warnings.some(text => text.includes('First-aid relief could not be scheduled')));
  assert.ok(plan.warnings.some(text => text.includes('Judge relief could not be scheduled')));
});

test('A fully preserved rota does not claim relief failed when there were no new rounds to fill', () => {
  const state = namedState();
  state.committeeMembers.comms = ['Only photographer', ''];
  state.committeeRotation = planCommitteeRotation(state).rotation;
  const plan = planCommitteeRotation(state, { firstAidRelief: 'comms:0', judgeRelief: 'comms:0' });
  assert.equal(plan.summary.plannedRounds, 0);
  assert.ok(!plan.warnings.some(text => text.includes('relief could not be scheduled')));
});

test('Any existing manual round is kept by default, and saved playing turns affect later fairness', () => {
  const state = namedState();
  state.committeeRotation['borrow:0'] = { 'equipment:0': assignment('playing') };
  state.committeeRotation['relay:0'] = { 'warmup:0': assignment('duty') };
  const plan = planCommitteeRotation(state);
  assert.deepEqual(plan.rotation['borrow:0'], state.committeeRotation['borrow:0']);
  assert.deepEqual(plan.rotation['relay:0'], state.committeeRotation['relay:0']);
  assert.equal(plan.summary.preservedRounds, 2);
  assert.ok(plan.summary.people.find(person => person.id === 'equipment:0').playingTurns >= 1);
  assert.equal(plan.summary.plannedRounds, 23);
  assert.ok(plan.warnings.some(text => text.includes('Existing manual rounds are kept')));
  assert.ok(plan.warnings.filter(text => text.includes('stays on duty') || text.includes('judges stay on duty')).every(text => text.startsWith('In new auto-filled rounds,')));
});

test('Replace mode changes planned rounds but leaves all started, scored and finished rounds untouched', () => {
  const state = namedState();
  for (const key of ['borrow:0', 'borrow:1', 'basket:red:0', 'cavalry:women', 'tug:prelim', 'relay:0']) state.committeeRotation[key] = { 'warmup:0': assignment('duty') };
  state.timers['borrow:0'] = { started: true, deadline: null };
  state.borrow.scores[0][1] = 5;
  state.basket.scores[0][0] = 3;
  state.cavalry.divisions.women.started = true;
  state.cavalry.divisions.women.active = ['red', 'blue'];
  state.tug.winners.prelim = 'red';
  state.finished = ['relay:0'];
  state.committeeRotation['borrow:2'] = { 'comms:0': assignment('playing') };
  const plan = planCommitteeRotation(state, { replace: true });
  assert.equal(plan.summary.skippedRounds, 6);
  for (const key of ['borrow:0', 'borrow:1', 'basket:red:0', 'cavalry:women', 'tug:prelim', 'relay:0']) assert.deepEqual(plan.rotation[key], state.committeeRotation[key]);
  assert.notDeepEqual(plan.rotation['borrow:2'], state.committeeRotation['borrow:2']);
  assert.equal(rotationRoundLocked(state, 'borrow:0'), true);
  assert.equal(rotationRoundLocked(state, 'unrecognized:0'), true);
});

test('An inactive seventh round in a saved six-round plan stays untouched until enabled', () => {
  const state = namedState();
  state.committeeRotation['borrow:6'] = { 'warmup:0': assignment('playing') };
  const plan = planCommitteeRotation(state, { replace: true });
  assert.deepEqual(plan.rotation['borrow:6'], state.committeeRotation['borrow:6']);
  state.borrow.rounds = 7;
  assert.equal(planCommitteeRotation(state, { replace: true }).summary.plannedRounds, 26);
});

test('Duplicate names, Unicode variants and TBA placeholders never become two auto-assigned people', () => {
  const state = namedState();
  state.committeeMembers.equipment[0] = '  Alex  Kim ';
  state.committeeMembers['team-leaders'][0] = 'ＡＬＥＸ Kim';
  state.committeeMembers['food-water'][2] = ' tBa ';
  const roster = plannerRoster(state);
  assert.equal(roster.filter(person => person.ambiguous).length, 2);
  const plan = planCommitteeRotation(state);
  for (const round of Object.values(plan.rotation)) for (const id of ['equipment:0', 'team-leaders:0', 'food-water:2']) assert.ok(!Object.hasOwn(round, id));
  assert.ok(plan.warnings.some(text => text.includes('Repeated names')));
  assert.ok(!reliefCandidates(state).some(person => ['equipment:0', 'team-leaders:0'].includes(person.id)));
});

test('Missing critical names are not invented or reported as covered', () => {
  const state = defaultState(), plan = planCommitteeRotation(state);
  assert.ok(plan.warnings.some(text => text.includes('Main judge is not assigned')));
  for (const round of Object.values(plan.rotation)) for (const id of ['director:0', 'judges:0', 'first-aid:0', 'first-aid:1']) assert.ok(!Object.hasOwn(round, id));
  assert.deepEqual(Object.keys(plan.rotation['borrow:0']), ['comms:0', 'comms:1']);
  assert.ok(plan.summary.people.every(person => person.playingTurns > 0));
});

test('Same-department cover and external support never double-count a person at two stations', () => {
  const plan = planCommitteeRotation(namedState());
  let foundSameDepartment = false, foundCrossDepartment = false;
  for (const round of Object.values(plan.rotation)) {
    for (const [id, entry] of Object.entries(round)) if (entry.status === 'cover') {
      assert.notEqual(id, entry.coverFor);
      if (departmentOf(id) === departmentOf(entry.coverFor)) foundSameDepartment = true;
      else foundCrossDepartment = true;
    }
    checkCoverage(round);
  }
  assert.ok(foundSameDepartment);
  assert.ok(foundCrossDepartment);
});

test('Planner rejects invalid settings and unknown or critical relief', () => {
  const state = namedState();
  for (const firstAidRelief of ['director:0', 'judges:0', 'first-aid:0', 'unknown:0', '', false]) assert.throws(() => planCommitteeRotation(state, { firstAidRelief }), /named support member/);
  assert.throws(() => planCommitteeRotation(state, { replace: 'yes' }), /keep or replace/);
  assert.deepEqual(COMMITTEE_PERSON_IDS.length, 22);
});

test('Empty roster produces no invented assignments and no applicable plan', () => {
  const state = defaultState();
  for (const department of Object.keys(state.committeeMembers)) state.committeeMembers[department].fill('');
  const plan = planCommitteeRotation(state);
  assert.equal(plan.summary.plannedRounds, 0);
  assert.deepEqual(plan.rotation, {});
});

console.log(`${tests.length} rotation planner tests passed.`);
