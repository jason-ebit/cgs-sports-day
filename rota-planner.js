import { COMMITTEE_PERSON_IDS, ROTATION_ROUND_KEYS, validateCommitteeRotation } from './rota-model.js?v=57';
import { gameDone } from './model.js?v=57';
import { roundDone } from './rounds.js?v=57';

const PROTECTED = new Set(['director', 'judges', 'first-aid']);
const STAFFED = ['equipment', 'food-water', 'comms'];
const FREE = new Set(['team-leaders', 'warmup']);
const departmentOf = id => id.slice(0, id.lastIndexOf(':'));
const copy = value => JSON.parse(JSON.stringify(value));
const nameKey = value => value.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();

export function plannerRoster(state) {
  const people = COMMITTEE_PERSON_IDS.flatMap(id => {
    const department = departmentOf(id), slot = Number(id.split(':').at(-1));
    const name = String(state.committeeMembers?.[department]?.[slot] || '').trim();
    return name && nameKey(name) !== 'tba' ? [{ id, name, department }] : [];
  });
  const counts = new Map();
  for (const person of people) counts.set(nameKey(person.name), (counts.get(nameKey(person.name)) || 0) + 1);
  return people.map(person => ({ ...person, ambiguous: counts.get(nameKey(person.name)) > 1 }));
}

export function reliefCandidates(state) {
  return plannerRoster(state).filter(person => !person.ambiguous && !PROTECTED.has(person.department));
}

export function rotationRoundLocked(state, key) {
  if (!ROTATION_ROUND_KEYS.includes(key)) return true;
  const [game, part, attempt] = key.split(':');
  if (game === 'borrow' && Number(part) >= state.borrow.rounds) return true;
  if (state.timers?.[key]?.started || state.finished?.includes(key) || roundDone(state, key) || gameDone(state, game)) return true;
  if (game === 'cavalry') return state.cavalry.divisions[part].started;
  if (game === 'basket') return state.basket.scores[['red', 'blue', 'yellow', 'green', 'white'].indexOf(part)][Number(attempt)] !== null;
  if (game === 'borrow' || game === 'relay') return state[game].scores.some(row => row[Number(part)] !== null);
  return false;
}

// A cover works in the covered person's department, not in two departments at once.
function workingCounts(people, assignments) {
  const counts = {};
  for (const person of people) {
    const assignment = assignments[person.id];
    if (assignment?.status === 'playing') continue;
    const department = assignment?.status === 'cover' ? departmentOf(assignment.coverFor) : person.department;
    counts[department] = (counts[department] || 0) + 1;
  }
  return counts;
}

function allocateRound(people, playing, minimum, relief, coverCounts) {
  const byId = new Map(people.map(person => [person.id, person]));
  const assignments = Object.fromEntries(people.map(person => [person.id, { status: playing.has(person.id) ? 'playing' : 'duty', coverFor: null }]));
  const firstAidPlaying = people.filter(person => person.department === 'first-aid' && playing.has(person.id));
  if (firstAidPlaying.length > 1) return null;
  if (firstAidPlaying.length && people.filter(person => person.department === 'first-aid').length !== 2) return null;
  const judgePlaying = people.filter(person => ['director', 'judges'].includes(person.department) && playing.has(person.id));
  if (judgePlaying.length > 1) return null;
  const critical = [
    ...(firstAidPlaying.length ? [[firstAidPlaying[0].id, relief.firstAidRelief]] : []),
    ...(judgePlaying.length ? [[judgePlaying[0].id, relief.judgeRelief]] : []),
  ];
  for (const [target, donorId] of critical) {
    const donor = byId.get(donorId);
    if (!donor || playing.has(donorId) || assignments[donorId].status !== 'duty') return null;
    assignments[donorId] = { status: 'cover', coverFor: target };
  }
  // A qualified relief cannot leave their own essential station short staffed.
  let counts = workingCounts(people, assignments);
  for (const [, donorId] of critical) {
    const department = byId.get(donorId).department;
    if ((counts[department] || 0) < (minimum[department] || 0)) return null;
  }
  const covered = id => Object.values(assignments).some(assignment => assignment.status === 'cover' && assignment.coverFor === id);
  const donorsFor = target => people.filter(person => {
    if (PROTECTED.has(person.department) || assignments[person.id].status !== 'duty') return false;
    // Covering one's own department keeps its staffing count unchanged.
    return person.department === target.department || (counts[person.department] || 0) > (minimum[person.department] || 0);
  }).sort((a, b) => {
    const rank = person => person.department === target.department ? 0 : FREE.has(person.department) ? 1 : 2;
    return rank(a) - rank(b) || (coverCounts[a.id] || 0) - (coverCounts[b.id] || 0) || COMMITTEE_PERSON_IDS.indexOf(a.id) - COMMITTEE_PERSON_IDS.indexOf(b.id);
  });
  // Fill missing station positions first, using a distinct named cover for each.
  for (const department of STAFFED) {
    while ((counts[department] || 0) < minimum[department]) {
      const target = people.find(person => person.department === department && playing.has(person.id) && !covered(person.id));
      if (!target) return null;
      const donor = donorsFor(target).find(person => person.department !== department);
      if (!donor) return null;
      assignments[donor.id] = { status: 'cover', coverFor: target.id };
      counts = workingCounts(people, assignments);
    }
  }
  // Name the handover even when the remaining same-department staff already meet the minimum.
  for (const target of people.filter(person => STAFFED.includes(person.department) && playing.has(person.id) && !covered(person.id))) {
    const donor = donorsFor(target)[0];
    if (!donor) continue;
    assignments[donor.id] = { status: 'cover', coverFor: target.id };
    counts = workingCounts(people, assignments);
  }
  return assignments;
}

function counters(people) {
  return Object.fromEntries(people.map(person => [person.id, { playingTurns: 0, dutyTurns: 0, coverTurns: 0, byGame: {} }]));
}
function countRound(counts, key, assignments) {
  const game = key.split(':')[0];
  for (const [id, assignment] of Object.entries(assignments)) {
    if (!counts[id]) continue;
    counts[id][`${assignment.status === 'playing' ? 'playing' : assignment.status === 'cover' ? 'cover' : 'duty'}Turns`]++;
    if (assignment.status === 'playing') counts[id].byGame[game] = (counts[id].byGame[game] || 0) + 1;
  }
}

/** Returns a reviewable draft; never changes the state or any saved manual round. */
export function planCommitteeRotation(state, { firstAidRelief = null, judgeRelief = null, replace = false } = {}) {
  if (typeof replace !== 'boolean') throw Error('Choose whether to keep or replace existing rounds.');
  const roster = plannerRoster(state), people = roster.filter(person => !person.ambiguous);
  const availableRelief = new Set(reliefCandidates(state).map(person => person.id));
  for (const [label, id] of [['First-aid', firstAidRelief], ['Judge', judgeRelief]]) {
    if (id !== null && !availableRelief.has(id)) throw Error(`${label} relief must be a named support member without a duplicate name.`);
  }
  const rotation = copy(validateCommitteeRotation(state.committeeRotation || {}));
  const roundKeys = ROTATION_ROUND_KEYS.filter(key => key !== 'borrow:6' || state.borrow.rounds === 7);
  const planned = [], preserved = [], skipped = [];
  for (const key of roundKeys) {
    if (rotationRoundLocked(state, key)) skipped.push(key);
    else if (!replace && Object.keys(rotation[key] || {}).length) preserved.push(key);
    else planned.push(key);
  }
  const warnings = [];
  if (preserved.length) warnings.push('Existing manual rounds are kept. Check their cover and handover before play.');
  const duplicates = roster.filter(person => person.ambiguous);
  if (duplicates.length) warnings.push(`Repeated names were left out of new rounds: ${[...new Set(duplicates.map(person => person.name))].join(', ')}. Give each person one committee slot, or use distinct names.`);
  const criticalIds = ['director:0', 'judges:0', 'first-aid:0', 'first-aid:1'];
  if (criticalIds.some(id => !people.some(person => person.id === id))) warnings.push('Add the main judge, assistant judge and both First aid names before using the rota. Missing or repeated names are not covered.');
  const namedIn = department => people.filter(person => person.department === department).length;
  const minimum = { equipment: Math.min(2, namedIn('equipment')), 'food-water': Math.min(1, namedIn('food-water')), comms: Math.min(1, namedIn('comms')) };
  if (namedIn('equipment') < 2) warnings.push('Equipment needs at least two named people on duty. The current named staff stay covered; add the missing people.');
  if (!namedIn('food-water')) warnings.push('Add at least one Food and water name to staff the water station.');
  if (!namedIn('comms')) warnings.push('Add at least one Comm name for photos and videos.');
  if (!firstAidRelief) warnings.push('In new auto-filled rounds, First aid stays on duty until trained relief with CPR skills is confirmed.');
  if (!judgeRelief) warnings.push('In new auto-filled rounds, both judges stay on duty until an appointed neutral replacement is confirmed.');
  warnings.push('Playing means a planned turn. Check each person’s team, the round and the women’s or men’s division before play.');
  const counts = counters(roster), plannedSet = new Set(planned);
  // Saved rounds, including completed ones, inform fairness but are never rewritten by default.
  for (const key of roundKeys) if (!plannedSet.has(key)) countRound(counts, key, rotation[key] || {});
  const gameRoundCounts = {};
  for (const key of roundKeys) gameRoundCounts[key.split(':')[0]] = (gameRoundCounts[key.split(':')[0]] || 0) + 1;
  const weightedTurns = id => Object.entries(counts[id].byGame).reduce((sum, [game, value]) => sum + value / gameRoundCounts[game], 0);
  const budget = Math.max(1, Math.min(5, Math.floor(people.length / 3)));
  const eligible = people.filter(person => (person.department !== 'equipment' || namedIn('equipment') >= 2) && (!['director', 'judges'].includes(person.department) || judgeRelief) && (person.department !== 'first-aid' || firstAidRelief));
  const applied = [];
  for (const [index, key] of planned.entries()) {
    if (!people.length) continue;
    const game = key.split(':')[0], playing = new Set();
    const offset = index % Math.max(1, people.length);
    const rank = person => (people.indexOf(person) - offset + people.length) % people.length;
    const candidates = [...eligible].sort((a, b) => (counts[a.id].byGame[game] || 0) - (counts[b.id].byGame[game] || 0) || weightedTurns(a.id) - weightedTurns(b.id) || counts[a.id].playingTurns - counts[b.id].playingTurns || rank(a) - rank(b));
    let assignments = allocateRound(people, playing, minimum, { firstAidRelief, judgeRelief }, Object.fromEntries(people.map(person => [person.id, counts[person.id].coverTurns])));
    for (const candidate of candidates) {
      if (playing.size >= budget) break;
      const proposed = new Set([...playing, candidate.id]);
      const result = allocateRound(people, proposed, minimum, { firstAidRelief, judgeRelief }, Object.fromEntries(people.map(person => [person.id, counts[person.id].coverTurns])));
      if (result) { playing.add(candidate.id); assignments = result; }
    }
    rotation[key] = assignments;
    applied.push(key);
    countRound(counts, key, assignments);
  }
  const newPlayingTurn = departments => applied.some(key => people.some(person => departments.includes(person.department) && rotation[key][person.id]?.status === 'playing'));
  if (applied.length && firstAidRelief && !newPlayingTurn(['first-aid'])) warnings.push('First-aid relief could not be scheduled without leaving another duty short. Adjust the cover plan manually.');
  if (applied.length && judgeRelief && !newPlayingTurn(['director', 'judges'])) warnings.push('Judge relief could not be scheduled without leaving another duty short. Adjust the cover plan manually.');
  return {
    rotation: validateCommitteeRotation(rotation),
    summary: {
      plannedRounds: applied.length, preservedRounds: preserved.length, skippedRounds: skipped.length,
      plannedKeys: applied, preservedKeys: preserved, skippedKeys: skipped, playingLimit: budget,
      people: roster.map(person => ({ ...person, playingTurns: counts[person.id].playingTurns, dutyTurns: counts[person.id].dutyTurns, coverTurns: counts[person.id].coverTurns, byGame: { ...counts[person.id].byGame } })),
    },
    warnings,
  };
}
