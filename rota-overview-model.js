import { DEPARTMENTS, GAME_NAMES } from './content.js?v=60';
import { TEAM_IDS } from './model.js?v=60';
import { rotationInterval } from './rota-intervals.js?v=60';

const GAME_ORDER = ['borrow', 'basket', 'cavalry', 'tug', 'relay'];
const CORE_STATIONS = ['director', 'judges', 'first-aid', 'equipment', 'food-water', 'comms'];
const MINIMUM = { director: 1, judges: 0, 'first-aid': 1, equipment: 2, 'food-water': 1, comms: 1 };
const PROTECTED = new Set(['director', 'first-aid']);
const nameKey = value => value.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();
const unique = values => [...new Set(values)];

function roster(state) {
  const all = DEPARTMENTS.flatMap(department => department.members.map((member, index) => {
    const raw = String(state?.committeeMembers?.[department.id]?.[index] ?? '').trim();
    return { id: `${department.id}:${index}`, name: nameKey(raw) === 'tba' ? '' : raw,
      department: department.id, departmentName: department.name, role: member.role };
  }));
  const counts = new Map();
  for (const person of all.filter(person => person.name)) counts.set(nameKey(person.name), (counts.get(nameKey(person.name)) || 0) + 1);
  return all.map(person => ({ ...person, ambiguous: Boolean(person.name && counts.get(nameKey(person.name)) > 1) }));
}

function rounds(state, game) {
  if (game === 'borrow') return Array.from({ length: state?.borrow?.rounds === 7 ? 7 : 6 }, (_, index) => ({ key: `borrow:${index}`, label: `Round ${index + 1}${index === 6 ? ' · optional' : ''}` }));
  if (game === 'basket') return TEAM_IDS.flatMap(team => [0, 1].map(attempt => ({
    key: `basket:${team}:${attempt}`, label: `${state?.teams?.find(item => item.id === team)?.name || team[0].toUpperCase() + team.slice(1)} · Try ${attempt + 1}`,
  })));
  if (game === 'cavalry') return [{ key: 'cavalry:women', label: 'Women’s round' }, { key: 'cavalry:men', label: 'Men’s round' }];
  if (game === 'tug') return ['prelim', 'semi1', 'semi2', 'final'].map((part, index) => ({ key: `tug:${part}`, label: ['Preliminary', 'Semifinal 1', 'Semifinal 2', 'Final'][index] }));
  return ['Baton', 'Three-legged', 'Spoon & ball'].map((label, index) => ({ key: `relay:${index}`, label }));
}

// Key ordering in JSONB must not make identical saved crews look different.
function assignmentKey(assignments) {
  return JSON.stringify(Object.keys(assignments).sort().map(id => [id, assignments[id]?.status, assignments[id]?.coverFor ?? null]));
}

function stationAssignments(people, allPeople, assignments) {
  const byId = new Map(allPeople.map(person => [person.id, person]));
  const staff = [], pendingStaff = [], freeToPlay = [], unassigned = [], invalidAssignments = [], warnings = [];
  const covers = new Map();
  for (const [id, assignment] of Object.entries(assignments)) {
    if (assignment?.status === 'cover' && assignment.coverFor) covers.set(assignment.coverFor, [...(covers.get(assignment.coverFor) || []), id]);
  }
  const invalid = (person, reason) => {
    invalidAssignments.push({ person: person || null, reason });
    warnings.push(`${person?.name || (person ? `TBA · ${person.departmentName}` : 'Unknown slot')}: ${reason}`);
  };
  for (const id of Object.keys(assignments)) {
    const person = byId.get(id);
    if (!person) invalid(null, 'Saved assignment has no committee slot. Check the plan.');
    else if (!person.name) invalid(person, 'Add a name before using this assignment.');
  }
  for (const person of people) {
    const assignment = assignments[person.id];
    if (person.ambiguous) { invalid(person, 'This name is in more than one slot. Keep one slot or use distinct names.'); unassigned.push(person); continue; }
    if (!assignment) { unassigned.push(person); continue; }
    if (assignment.status === 'playing') { freeToPlay.push(person); continue; }
    if (assignment.status === 'duty') { staff.push({ ...person, status: 'duty', coverFor: null, coveringName: null, station: person.department }); continue; }
    if (assignment.status !== 'cover') { invalid(person, 'Choose Playing, On duty or Cover.'); unassigned.push(person); continue; }
    const target = byId.get(assignment.coverFor);
    let reason;
    if (assignment.coverFor === person.id) reason = 'A person cannot cover their own slot.';
    else if (!target?.name) reason = 'Choose a named person to cover.';
    else if (target.ambiguous) reason = 'The cover target has a repeated name. Check their slot.';
    else if ((covers.get(target.id) || []).length > 1) reason = `More than one cover is set for ${target.name}. Choose one.`;
    else if (assignments[target.id]?.status !== 'playing') reason = `${target.name} is not marked Playing. Check the handover.`;
    if (reason) { invalid(person, reason); unassigned.push(person); continue; }
    const cover = { ...person, status: 'cover', coverFor: target.id, coveringName: target.name, station: target.department };
    if (PROTECTED.has(target.department)) {
      const confirmation = target.department === 'director' ? 'appointment' : 'training';
      const reason = target.department === 'director'
        ? person.department === 'judges' ? 'Assistant judge only observes. Confirm an appointed main judge before this swap.' : 'Confirm an appointed main judge before this swap.'
        : 'Confirm trained first-aid relief and CPR skills before this swap.';
      pendingStaff.push({ ...cover, needsConfirmation: true, confirmation });
      invalid(person, reason);
      continue;
    }
    staff.push(cover);
  }
  const departmentIds = unique([...CORE_STATIONS, ...staff.map(person => person.station), ...pendingStaff.map(person => person.station)]);
  const stations = departmentIds.map(id => {
    const department = DEPARTMENTS.find(item => item.id === id);
    const stationStaff = staff.filter(person => person.station === id), pending = pendingStaff.filter(person => person.station === id);
    const minimum = MINIMUM[id] || 0, shortfall = Math.max(0, minimum - stationStaff.length);
    if (shortfall) warnings.push(`${department?.name || id}: ${shortfall} more ${shortfall === 1 ? 'person needed' : 'people needed'} on duty.`);
    return { department: id, departmentName: department?.name || id, minimum, staff: stationStaff, pendingStaff: pending, shortfall, confirmed: shortfall === 0 && pending.length === 0 };
  });
  const blockedFromPlay = freeToPlay.filter(person => PROTECTED.has(person.department) && stations.find(station => station.department === person.department)?.shortfall);
  for (const person of blockedFromPlay) warnings.push(`${person.name}: stay on duty until the ${person.department === 'director' ? 'main judge' : 'trained first-aid'} handover is confirmed.`);
  return { stations, freeToPlay: freeToPlay.filter(person => !blockedFromPlay.includes(person)), blockedFromPlay, unassigned, invalidAssignments, warnings: unique(warnings) };
}

function shiftGroups(state, game, schedule) {
  const groups = [];
  for (const round of rounds(state, game)) {
    const interval = rotationInterval(state, round.key, schedule);
    const assignments = state?.committeeRotation?.[round.key] || {};
    const signature = assignmentKey(assignments), previous = groups.at(-1);
    if (previous && previous.interval?.groupKey === interval?.groupKey && previous.signature === signature) previous.rounds.push(round);
    else groups.push({ rounds: [round], assignments, signature, interval });
  }
  return groups.map(group => {
    const peers = groups.filter(other => other.interval?.groupKey === group.interval?.groupKey);
    const split = peers.length > 1;
    const interval = group.interval;
    const plannedStart = split ? null : interval?.start || null, plannedEnd = split ? null : interval?.end || null;
    return { id: group.rounds[0].key, roundKeys: group.rounds.map(round => round.key),
      label: split ? group.rounds.map(round => round.label).join(' / ') : interval?.label || group.rounds[0].label,
      plannedStart, plannedEnd, start: plannedStart, end: plannedEnd, blockStart: interval?.start || null, blockEnd: interval?.end || null,
      handoverSeconds: split && peers.at(-1) !== group ? 60 : interval?.handoverSeconds || 0,
      timingReason: split ? 'split-assignments' : interval?.reason || null, timingIssue: interval?.reason || null,
      assignments: group.assignments,
    };
  });
}

function handoverBetween(current, next) {
  if (!next) return null;
  const ids = unique([...current.stations, ...next.stations].map(station => station.department));
  return { nextShiftId: next.id, nextLabel: next.label,
    nextGameId: next.gameId, nextGameLabel: GAME_NAMES[next.gameId], crossGame: current.gameId !== next.gameId,
    departments: ids.map(department => {
    const before = current.stations.find(station => station.department === department), after = next.stations.find(station => station.department === department);
    const previous = before?.staff || [], following = after?.staff || [];
    return { department, departmentName: before?.departmentName || after?.departmentName || department,
      incoming: following.filter(person => !previous.some(other => other.id === person.id)),
      outgoing: previous.filter(person => !following.some(other => other.id === person.id)),
      staying: following.filter(person => previous.some(other => other.id === person.id)) };
  }) };
}

/** A read-only public roster view. It never infers a player's team, division,
 * training or judge appointment, and never changes a saved assignment or clock. */
export function buildDutyOverview(state, { schedule } = {}) {
  const allPeople = roster(state), people = allPeople.filter(person => person.name);
  const games = GAME_ORDER.map(id => ({ id, label: GAME_NAMES[id], shifts: shiftGroups(state, id, schedule).map(group => {
    const { assignments, ...shift } = group;
    const resolved = stationAssignments(people, allPeople, assignments);
    const timingWarnings = shift.timingIssue === 'limits-too-long' ? ['Timer limits do not fit this game’s planned time. Check the timing before play.'] : [];
    return { ...shift, gameId: id, ...resolved, warnings: [...resolved.warnings, ...timingWarnings] };
  }) }));
  const shifts = games.flatMap(game => game.shifts);
  for (const [index, shift] of shifts.entries()) shift.handover = handoverBetween(shift, shifts[index + 1]);
  const fixedPosts = ['director', 'judges', 'first-aid'].flatMap(department => {
    const first = shifts[0]?.stations.find(station => station.department === department);
    if (!first?.staff.length || first.shortfall || first.pendingStaff.length) return [];
    const signature = first.staff.map(person => `${person.id}:${person.status}:${person.coverFor || ''}`).sort().join('|');
    if (!shifts.every(shift => {
      const station = shift.stations.find(item => item.department === department);
      return station && !station.shortfall && !station.pendingStaff.length && station.staff.map(person => `${person.id}:${person.status}:${person.coverFor || ''}`).sort().join('|') === signature;
    })) return [];
    return [{ department, departmentName: first.departmentName, staff: first.staff.map(person => ({ ...person })), roundKeys: shifts.flatMap(shift => shift.roundKeys), alwaysOnDuty: true }];
  });
  const warnings = [];
  const duplicateNames = unique(people.filter(person => person.ambiguous).map(person => person.name));
  if (duplicateNames.length) warnings.push(`Repeated names: ${duplicateNames.join(', ')}. Keep one committee slot per person or use distinct names.`);
  if (!people.some(person => person.id === 'director:0')) warnings.push('Add the main judge’s name before play.');
  if (!people.some(person => person.department === 'first-aid')) warnings.push('Add a first-aid name before play.');
  if (people.length && shifts.every(shift => shift.unassigned.length === people.length)) warnings.push('No duty plan is saved yet. Assign people before play.');
  const entries=Array.isArray(schedule)?schedule:schedule?.schedule||[];
  const warmupEvent=entries.find(event=>event.title==='Group Warm-Up');
  const warmup={staff:people.filter(person=>person.department==='warmup'&&!person.ambiguous),start:warmupEvent?.start||null,end:warmupEvent?.end||null};
  return { people, fixedPosts, games, warnings, warmup };
}
