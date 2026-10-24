import { defaultState, validateState, TEAM_IDS, GAME_IDS, matchTeams } from './model.js?v=58';
import { COMMITTEE_SLOT_COUNTS, ROTATION_ROUND_KEYS, COMMITTEE_PERSON_IDS } from './rota-model.js?v=58';
import { recordSuccess, eliminate, recordWinner, roundDone } from './rounds.js?v=58';
import { startClock, pauseClock, addTime, remainingMs } from './timer-model.js?v=58';

const copy = value => structuredClone(value);
const stable = value => JSON.stringify(value, (_, nested) => nested && typeof nested === 'object' && !Array.isArray(nested)
  ? Object.fromEntries(Object.keys(nested).sort().map(key => [key, nested[key]])) : nested);
export const sameScoreValue = (left, right) => stable(left) === stable(right);
const missing = value => value === undefined ? null : value;

/** Public consistency units. These IDs also belong to the database revision map. */
export function scoreUnits(snapshot) {
  const units = {};
  for (const [index, team] of TEAM_IDS.entries()) {
    units[`team:${team}:name`] = snapshot.teams[index].name;
    units[`team:${team}:seed`] = snapshot.teams[index].seed;
    for (const attempt of [0, 1]) units[`basket:${team}:${attempt}`] = {
      score: snapshot.basket.scores[index][attempt], finished: snapshot.finished.includes(`basket:${team}:${attempt}`),
    };
  }
  for (const [department, count] of Object.entries(COMMITTEE_SLOT_COUNTS)) for (let index = 0; index < count; index++) {
    units[`roster:${department}:${index}`] = snapshot.committeeMembers[department][index];
  }
  for (const [id, ready] of Object.entries(snapshot.equipmentReady)) units[`equipment:${id}`] = ready;
  units['equipment:cold-packs'] = snapshot.equipmentColdPacksReady;
  for (const round of ROTATION_ROUND_KEYS) for (const person of COMMITTEE_PERSON_IDS) {
    units[`rota:${round}:${person}`] = missing(snapshot.committeeRotation[round]?.[person]);
  }
  units['borrow:rounds'] = snapshot.borrow.rounds;
  for (let round = 0; round < 7; round++) units[`borrow:${round}`] = snapshot.borrow.scores.map(row => row[round]);
  for (let round = 0; round < 3; round++) units[`relay:${round}`] = snapshot.relay.scores.map(row => row[round]);
  for (const division of ['women', 'men']) units[`cavalry:${division}`] = snapshot.cavalry.divisions[division];
  units['cavalry:config'] = { division: snapshot.cavalry.division, cap: snapshot.cavalry.cap };
  units.tug = snapshot.tug;
  for (const game of GAME_IDS) units[`placements:${game}`] = snapshot.placements[game];
  units.timing = { timers: snapshot.timers, activeKey: snapshot.activeKey };
  units['finished-other'] = snapshot.finished.filter(key => !key.startsWith('basket:'));
  return units;
}

export function changedScoreUnits(base, desired) {
  const before = scoreUnits(base), after = scoreUnits(desired);
  return Object.keys(after).filter(unit => !sameScoreValue(before[unit], after[unit]));
}

// Carry a later, not-yet-attempted local edit across an earlier local intent
// whose accepted points changed during replay. Unchanged cells belong to the
// new anchor; only the later edit is retained. Validation still happens when
// this intent is projected or submitted.
export function reanchorScoreIntent(base, desired, anchor, { now = Date.now() } = {}) {
  const next = copy(anchor), before = scoreUnits(base), after = scoreUnits(desired);
  for (const unit of changedScoreUnits(base, desired)) {
    const [game, part] = unit.split(':');
    if ((game === 'borrow' && part !== 'rounds') || game === 'relay') {
      const column = next[game].scores.map((row, index) => before[unit][index] === after[unit][index] ? row[Number(part)] : after[unit][index]);
      assignUnit(next, unit, column);
      if (before[unit].every((value, index) => value === after[unit][index] || value === null && after[unit][index] !== null)) {
        const intent = copy(next), replayed = copy(anchor);
        if (replayArrivals(anchor, intent, replayed, game, Number(part))) next[game].scores = replayed[game].scores;
      }
    } else if (game === 'cavalry' && part !== 'config' && before[unit].started && after[unit].started
      && sameScoreValue(before[unit].active, after[unit].active)
      && sameScoreValue(after[unit].eliminated.slice(0, before[unit].eliminated.length), before[unit].eliminated)) {
      const appended = after[unit].eliminated.slice(before[unit].eliminated.length);
      next.cavalry.divisions[part].eliminated.push(...appended.filter(team => !next.cavalry.divisions[part].eliminated.includes(team)));
    } else if (unit === 'tug' && sameScoreValue(base.tug.slots, desired.tug.slots) && base.tug.locked === desired.tug.locked) {
      for (const match of Object.keys(base.tug.winners)) if (base.tug.winners[match] !== desired.tug.winners[match]) next.tug.winners[match] = desired.tug.winners[match];
    } else if (unit === 'timing') {
      if (sameScoreValue(scoreUnits(anchor).timing, before.timing)) assignUnit(next, unit, after[unit]);
      else if (!replayTiming(base, desired, next, now, new Set())) throw Error('The pending timer change needs review.');
    } else assignUnit(next, unit, after[unit]);
  }
  return next;
}

export function replaceScoreUnits(snapshot, source, units) {
  const next = copy(snapshot), values = scoreUnits(source);
  for (const unit of units) assignUnit(next, unit, values[unit]);
  return next;
}

function assignUnit(snapshot, unit, value) {
  const [kind, part, field] = unit.split(':');
  if (kind === 'team') snapshot.teams[TEAM_IDS.indexOf(part)][field] = value;
  else if (kind === 'roster') snapshot.committeeMembers[part][Number(field)] = value;
  else if (kind === 'equipment') {
    if (part === 'cold-packs') snapshot.equipmentColdPacksReady = value;
    else snapshot.equipmentReady[part] = value;
  } else if (kind === 'rota') {
    const round = ROTATION_ROUND_KEYS.find(key => unit.startsWith(`rota:${key}:`));
    const person = unit.slice(`rota:${round}:`.length);
    if (value === null) {
      if (snapshot.committeeRotation[round]) {
        delete snapshot.committeeRotation[round][person];
        if (!Object.keys(snapshot.committeeRotation[round]).length) delete snapshot.committeeRotation[round];
      }
    } else (snapshot.committeeRotation[round] ||= {})[person] = copy(value);
  } else if (kind === 'borrow' || kind === 'relay') {
    if (part === 'rounds') snapshot.borrow.rounds = value;
    else value.forEach((score, index) => { snapshot[kind].scores[index][Number(part)] = score; });
  } else if (kind === 'basket') {
    snapshot.basket.scores[TEAM_IDS.indexOf(part)][Number(field)] = value.score;
    snapshot.finished = snapshot.finished.filter(key => key !== unit);
    if (value.finished) snapshot.finished.push(unit);
  } else if (kind === 'cavalry') {
    if (part === 'config') Object.assign(snapshot.cavalry, value);
    else snapshot.cavalry.divisions[part] = copy(value);
  } else if (kind === 'tug') snapshot.tug = copy(value);
  else if (kind === 'placements') snapshot.placements[part] = copy(value);
  else if (kind === 'timing') Object.assign(snapshot, copy(value));
  else if (kind === 'finished-other') snapshot.finished = [...snapshot.finished.filter(key => key.startsWith('basket:')), ...value];
}

// The existing game rules operate on a complete model, but only whitelisted
// public fields are ever copied back into the shared snapshot.
function model(snapshot) {
  const state = defaultState();
  for (const key of ['tug', 'borrow', 'basket', 'relay', 'timers', 'finished', 'activeKey', 'committeeMembers', 'committeeRotation']) state[key] = copy(snapshot[key]);
  state.teams = state.teams.map((team, index) => ({ ...team, ...snapshot.teams[index] }));
  Object.assign(state.cavalry, { division: snapshot.cavalry.division, cap: snapshot.cavalry.cap });
  for (const division of ['women', 'men']) Object.assign(state.cavalry.divisions[division], copy(snapshot.cavalry.divisions[division]));
  for (const game of GAME_IDS) state.placements[game] = { values: copy(snapshot.placements[game].values), rule: snapshot.placements[game].approved ? 'Approved result' : '' };
  state.equipmentReady = { ...snapshot.equipmentReady, 'cold-packs': snapshot.equipmentColdPacksReady };
  return validateState(state);
}

function replayArrivals(base, desired, latest, game, round) {
  if (game === 'borrow' && (base.borrow.rounds !== desired.borrow.rounds || latest.borrow.rounds !== base.borrow.rounds)) return false;
  const before = base[game].scores.map(row => row[round]), after = desired[game].scores.map(row => row[round]);
  const current = latest[game].scores.map(row => row[round]);
  if (before.some((score, index) => score !== null && current[index] !== score)) return false;
  const changes = before.map((score, index) => ({ score, index, next: after[index] })).filter(({ score, next }) => score !== next);
  if (!changes.length || changes.some(({ score, next }) => score !== null || next === null)) return false;
  changes.sort((left, right) => game === 'borrow' ? right.next - left.next : left.next - right.next);
  const state = model(latest);
  for (const { index, next } of changes) {
    const saved = state[game].scores[index][round];
    if (saved !== null) {
      if (game === 'borrow' && (saved === 0) !== (next === 0)) return false;
      continue;
    }
    if (!recordSuccess(state, game, round, TEAM_IDS[index], game !== 'borrow' || next !== 0)) return false;
  }
  latest[game].scores = copy(state[game].scores);
  return true;
}

function replayCavalry(base, desired, latest, division) {
  const before = base.cavalry.divisions[division], after = desired.cavalry.divisions[division], current = latest.cavalry.divisions[division];
  if (!before.started || !after.started || !current.started || !sameScoreValue(before.active, after.active) || !sameScoreValue(before.active, current.active)) return false;
  if (after.eliminated.length !== before.eliminated.length + 1 || !sameScoreValue(after.eliminated.slice(0, -1), before.eliminated) || !sameScoreValue(current.eliminated.slice(0, before.eliminated.length), before.eliminated)) return false;
  const team = after.eliminated.at(-1);
  if (current.eliminated.includes(team)) return true;
  const state = model(latest);
  if (!eliminate(state, division, team)) return false;
  latest.cavalry.divisions[division] = { active: copy(state.cavalry.divisions[division].active), eliminated: copy(state.cavalry.divisions[division].eliminated), started: true };
  return true;
}

function replayTug(base, desired, latest) {
  if (!base.tug.locked || !desired.tug.locked || !latest.tug.locked || !sameScoreValue(base.tug.slots, desired.tug.slots) || !sameScoreValue(base.tug.slots, latest.tug.slots)) return false;
  const changes = Object.keys(base.tug.winners).filter(match => base.tug.winners[match] !== desired.tug.winners[match]);
  if (changes.length !== 1) return false;
  const match = changes[0], winner = desired.tug.winners[match];
  if (base.tug.winners[match] !== null || winner === null || !sameScoreValue(matchTeams(base.tug, match), matchTeams(latest.tug, match))) return false;
  if (Object.keys(base.tug.winners).some(key => base.tug.winners[key] !== null && base.tug.winners[key] !== latest.tug.winners[key])) return false;
  if (latest.tug.winners[match] !== null) return latest.tug.winners[match] === winner;
  const state = model(latest);
  try { if (!recordWinner(state, match, winner)) return false; } catch { return false; }
  latest.tug = copy(state.tug);
  return true;
}

const clockConfigSame = (left, right) => Boolean(left && right && left.duration === right.duration && left.signature === right.signature);

function additiveTiming(base, desired) {
  const keys = [...new Set([...Object.keys(base.timers), ...Object.keys(desired.timers)])].filter(key => !sameScoreValue(base.timers[key], desired.timers[key]));
  if (keys.length !== 1 || base.activeKey !== desired.activeKey) return false;
  const before = base.timers[keys[0]], after = desired.timers[keys[0]];
  if (!clockConfigSame(before, after) || before.started !== after.started) return false;
  const delta = before.deadline !== null && after.deadline !== null ? after.deadline - before.deadline
    : before.deadline === null && after.deadline === null ? after.remaining - before.remaining : 0;
  return delta > 0 && delta % 30000 === 0;
}

function replayTiming(base, desired, latest, now, completedKeys) {
  const keys = [...new Set([...Object.keys(base.timers), ...Object.keys(desired.timers)])].filter(key => !sameScoreValue(base.timers[key], desired.timers[key]));
  const starts = keys.filter(key => desired.timers[key]?.deadline !== null && desired.timers[key]?.deadline !== undefined && (base.timers[key]?.deadline === null || !base.timers[key]));
  if (starts.length === 1) {
    const key = starts[0], before = base.timers[key], after = desired.timers[key], current = latest.timers[key];
    if (before && !clockConfigSame(before, after)) return false;
    // Other changed clocks must be the automatic pauses made by startClock.
    if (keys.some(other => other !== key && !(base.timers[other]?.deadline !== null && base.timers[other]?.deadline !== undefined && desired.timers[other]?.deadline === null && clockConfigSame(base.timers[other], desired.timers[other])))) return false;
    if (current?.deadline !== null && current?.deadline !== undefined) return clockConfigSame(current, after);
    if (current && !sameScoreValue(current, before)) return false;
    if (!current && before) return false;
    latest.timers[key] = { ...copy(after), deadline: null, remaining: remainingMs(after, now) };
    if (startClock(latest.timers, key, now)) latest.activeKey = key;
    else { latest.timers[key].started = true; if (latest.activeKey === key) latest.activeKey = null; }
    return true;
  }
  if (keys.length === 1) {
    const key = keys[0], before = base.timers[key], after = desired.timers[key], current = latest.timers[key];
    if (!after) return false;
    if ((!before || !before.started) && !after.started && after.deadline === null) {
      if (!sameScoreValue(current, before)) return false;
      latest.timers[key] = copy(after);
      return true;
    }
    if (!clockConfigSame(before, after) || !clockConfigSame(current, after) || before.started !== after.started) return false;
    if (before.deadline !== null && after.deadline === null) {
      if (completedKeys.has(key)) return true;
      // A timer expiry from another phone must not cancel a newer extension.
      if (after.remaining === 0 && current.deadline !== null && current.deadline > now) return true;
      if (current.deadline !== null) pauseClock(current, now);
      if (base.activeKey !== desired.activeKey && latest.activeKey === key) latest.activeKey = desired.activeKey;
      return true;
    }
    const delta = before.deadline !== null && after.deadline !== null ? after.deadline - before.deadline
      : before.deadline === null && after.deadline === null ? after.remaining - before.remaining : 0;
    if (delta > 0 && delta % 30000 === 0) { addTime(current, delta / 1000, now); return true; }
  }
  if (keys.length === 0) return base.activeKey === desired.activeKey || desired.activeKey === null && completedKeys.has(base.activeKey);
  if (keys.every(key => completedKeys.has(key))) return true;
  return false;
}

/** Replay a known local intent over a newer confirmed public snapshot. */
export function rebaseScoreSnapshot(base, desired, current, {
  baseRevision = 0, currentRevision = baseRevision, unitVersions = {}, resetRevision = 0, barrier = false, now = Date.now(), projecting = false,
} = {}) {
  const changedUnits = changedScoreUnits(base, desired), conflicts = [];
  const failure = units => ({ ok: false, snapshot: copy(current), conflicts: units, changedUnits, noop: false });
  if (resetRevision > baseRevision || barrier && currentRevision !== baseRevision) return failure(['reset']);
  if (barrier) return { ok: true, snapshot: copy(desired), conflicts, changedUnits, noop: false };
  const before = scoreUnits(base), after = scoreUnits(desired), remote = scoreUnits(current), next = copy(current);
  const games = new Set(changedUnits.map(unit => unit.split(':')[0]).filter(game => GAME_IDS.includes(game)));
  const invalidations = new Set([...games].filter(game => desired.placements[game].values.every(value => value === null)
    && desired.placements[game].approved === base.placements[game].approved).map(game => `placements:${game}`));
  const completedKeys = new Set();
  let timingChanged = changedUnits.includes('timing');
  if (currentRevision !== baseRevision && Object.keys(base.timers).some(key => !desired.timers[key]
    || base.timers[key].started && desired.timers[key]?.started === false)) return failure(['timing']);
  for (const unit of changedUnits) {
    if (unit === 'timing' || invalidations.has(unit)) continue;
    if (sameScoreValue(remote[unit], after[unit])) continue;
    if (unit.startsWith('rota:')) {
      const round = ROTATION_ROUND_KEYS.find(key => unit.startsWith(`rota:${key}:`));
      const resultUnit = round.startsWith('tug:') ? 'tug' : round;
      const rosterChanged = Object.keys(before).some(key => key.startsWith('roster:') && ((unitVersions[key] || 0) > baseRevision || !sameScoreValue(before[key], remote[key])));
      if (rosterChanged || (unitVersions[resultUnit] || 0) > baseRevision || !sameScoreValue(base.timers[round], current.timers[round]) || !sameScoreValue(before[resultUnit], remote[resultUnit])) {
        conflicts.push(unit); continue;
      }
    }
    if ((unitVersions[unit] || 0) <= baseRevision && sameScoreValue(before[unit], remote[unit])) { assignUnit(next, unit, after[unit]); continue; }
    const [kind, part] = unit.split(':');
    const replayed = (kind === 'borrow' && part !== 'rounds' || kind === 'relay') ? replayArrivals(base, desired, next, kind, Number(part))
      : kind === 'cavalry' && part !== 'config' ? replayCavalry(base, desired, next, part)
        : kind === 'tug' ? replayTug(base, desired, next) : false;
    if (!replayed) conflicts.push(unit);
  }
  if (conflicts.length) return failure(conflicts);
  // Result completion is derived again after replay, including a last arrival
  // recorded on another phone. It never copies an old paused timer wholesale.
  let state;
  try { state = model(next); } catch { return failure(changedUnits); }
  for (const game of games) {
    const resultChanged = Object.keys(remote).some(unit => (unit === game || unit.startsWith(game + ':')) && !sameScoreValue(remote[unit], scoreUnits(next)[unit]));
    if (resultChanged && invalidations.has(`placements:${game}`)) next.placements[game].values = Array(5).fill(null);
    for (const key of Object.keys(next.timers)) if (key.startsWith(game + ':') && roundDone(state, key)) completedKeys.add(key);
  }
  if (timingChanged) {
    if (sameScoreValue(remote.timing, after.timing) && (projecting || !additiveTiming(base, desired))) timingChanged = false;
    else if ((unitVersions.timing || 0) <= baseRevision && sameScoreValue(before.timing, remote.timing)) Object.assign(next, copy(after.timing));
    else if (!replayTiming(base, desired, next, now, completedKeys)) return failure(['timing']);
  }
  for (const key of completedKeys) {
    if (next.timers[key]?.deadline !== null && next.timers[key]?.deadline !== undefined) pauseClock(next.timers[key], now);
    if (next.activeKey === key) next.activeKey = null;
  }
  try { model(next); } catch { return failure(changedUnits); }
  return { ok: true, snapshot: next, conflicts, changedUnits, noop: sameScoreValue(next, current) };
}
