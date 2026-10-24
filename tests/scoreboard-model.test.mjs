import assert from 'node:assert/strict';
import { defaultState, TEAM_IDS, setWinner } from '../model.js';
import { resetRound, resetGame } from '../rounds.js';
import { buildGameScoreboard, buildGameScoreboardTimer, followGameScoreboardContext } from '../scoreboard-model.js';
import { makeClock, startClock, pauseClock, addTime } from '../timer-model.js';

const tests = [];
const test = (name, run) => { run(); tests.push(name); console.log('PASS ' + name); };
const byTeam = board => Object.fromEntries(board.rows.map(row => [row.teamId, row]));
const setColumn = (s, game, round, values) => values.forEach((value, i) => { s[game].scores[i][round] = value; });
function arena(s, division, active, eliminated = []) {
  Object.assign(s.cavalry.divisions[division], { active: [...active], eliminated: [...eliminated], started: true });
}
function draw(s) { s.tug.slots = [...TEAM_IDS]; s.tug.locked = true; }

test('A new board has no invented zeros, places or live status', () => {
  const s = defaultState(), board = buildGameScoreboard(s, { game: 'borrow', round: 0 });
  assert.equal(board.status, 'ready');
  assert.equal(board.roundComplete, false);
  assert.equal(board.complete, false);
  assert.equal(board.rows.length, 5);
  assert.ok(board.rows.every(row => row.score === null && row.roundScore === null && row.rank === null && row.pending));
});

test('Borrow ranks confirmed results, preserves a fail at zero and ties use competition places', () => {
  const s = defaultState();
  setColumn(s, 'borrow', 0, [5, 4, 2, 2, 0]);
  const board = buildGameScoreboard(s, { key: 'borrow:0' }), rows = byTeam(board);
  assert.deepEqual(board.rows.map(row => row.teamId), TEAM_IDS);
  assert.deepEqual(board.rows.map(row => row.rank), [1, 2, 3, 3, 5]);
  assert.equal(rows.white.score, 0);
  assert.equal(rows.white.roundScore, 0);
  assert.match(rows.white.detail, /Fail/);
  assert.equal(board.status, 'round-complete');
});

test('Selected Borrow rounds exclude all later points and keep unknown results pending', () => {
  const s = defaultState();
  setColumn(s, 'borrow', 0, [0, 5, null, null, null]);
  setColumn(s, 'borrow', 1, [5, null, null, null, null]);
  setColumn(s, 'borrow', 2, [5, 4, 3, 2, 2]);
  const early = byTeam(buildGameScoreboard(s, { game: 'borrow', round: 0 }));
  assert.equal(early.red.score, 0);
  assert.equal(early.yellow.score, null);
  const current = byTeam(buildGameScoreboard(s, { key: 'borrow:1' }));
  assert.equal(current.red.score, 5);
  assert.equal(current.blue.score, 5);
  assert.equal(current.blue.roundScore, null);
  assert.equal(current.blue.pending, true);
  assert.equal(current.red.pending, false);
});

test('Relay converts saved finishing places to points before adding and ranking', () => {
  const s = defaultState();
  setColumn(s, 'relay', 0, [1, 2, 3, 4, 5]);
  setColumn(s, 'relay', 1, [5, 4, 3, 2, 1]);
  const board = buildGameScoreboard(s, { game: 'relay', round: 1 });
  assert.deepEqual(board.rows.map(row => row.score), [6, 6, 6, 6, 6]);
  assert.deepEqual(board.rows.map(row => row.roundScore), [1, 2, 3, 4, 5]);
  assert.deepEqual(board.rows.map(row => row.rank), [1, 1, 1, 1, 1]);
  assert.match(board.rows[0].detail, /#5/);
});

test('Historical rounds remain historical after a game finishes', () => {
  const s = defaultState();
  for (let round = 0; round < 3; round++) setColumn(s, 'relay', round, [1, 2, 3, 4, 5]);
  const early = buildGameScoreboard(s, { key: 'relay:0' });
  assert.equal(early.complete, true);
  assert.equal(early.status, 'round-complete');
  assert.equal(byTeam(early).red.score, 5);
  const final = buildGameScoreboard(s, { key: 'relay:2' });
  assert.equal(final.status, 'game-complete');
  assert.equal(byTeam(final).red.score, 15);
});

test('Basket excludes every in-progress counter, even when it exceeds saved scores', () => {
  const s = defaultState();
  s.basket.scores[0] = [8, 99];
  s.basket.scores[1] = [0, null];
  s.basket.scores[2] = [50, null];
  s.finished = ['basket:red:0', 'basket:blue:0'];
  const board = buildGameScoreboard(s, { key: 'basket:red:1' }), rows = byTeam(board);
  assert.equal(rows.red.score, 8);
  assert.equal(rows.red.roundScore, null);
  assert.equal(rows.red.pending, true);
  assert.equal(rows.blue.score, 0);
  assert.equal(rows.yellow.score, null);
  assert.equal(rows.yellow.rank, null);
  assert.equal(board.scoreLabel, 'Best saved balls');
});

test('Basket uses the best of locked attempts, not their sum or a default zero', () => {
  const s = defaultState();
  s.basket.scores[0] = [8, 12];
  s.basket.scores[1] = [0, 0];
  s.finished = ['basket:red:0', 'basket:red:1', 'basket:blue:0', 'basket:blue:1'];
  const board = buildGameScoreboard(s, { game: 'basket', team: 'red', round: 1 }), rows = byTeam(board);
  assert.equal(rows.red.score, 12);
  assert.equal(rows.red.roundScore, 12);
  assert.equal(rows.red.pending, false);
  assert.equal(rows.blue.score, 0);
  assert.equal(rows.blue.roundScore, null);
  assert.equal(rows.blue.pending, false);
  assert.equal(rows.white.score, null);
  assert.equal(board.roundComplete, true);
});

test('Only ten locked Basket attempts mark the whole game complete', () => {
  const s = defaultState();
  for (const [i, id] of TEAM_IDS.entries()) for (const attempt of [0, 1]) {
    s.basket.scores[i][attempt] = i;
    s.finished.push(`basket:${id}:${attempt}`);
  }
  assert.equal(buildGameScoreboard(s, { key: 'basket:white:1' }).status, 'game-complete');
  s.finished.pop();
  const board = buildGameScoreboard(s, { key: 'basket:white:1' });
  assert.equal(board.complete, false);
  assert.equal(board.roundComplete, false);
  assert.equal(byTeam(board).white.score, 4);
});

test('Incomplete Cavalry does not invent points for eliminated or surviving horses', () => {
  const s = defaultState();
  arena(s, 'women', ['red', 'blue', 'yellow'], ['red']);
  const board = buildGameScoreboard(s, { key: 'cavalry:women' }), rows = byTeam(board);
  assert.ok(board.rows.every(row => row.score === null && row.roundScore === null));
  assert.match(rows.red.detail, /division still in progress/);
  assert.equal(rows.blue.detail, 'In arena');
  assert.equal(rows.white.detail, 'Not in this arena');
  assert.equal(board.status, 'live');
});

test('Completed Cavalry awards exact arena points and confirmed zero to nonparticipants', () => {
  const s = defaultState();
  arena(s, 'women', ['red', 'blue'], ['red']);
  const board = buildGameScoreboard(s, { key: 'cavalry:women' }), rows = byTeam(board);
  assert.equal(rows.blue.score, 5);
  assert.equal(rows.red.score, 4);
  for (const id of ['yellow', 'green', 'white']) {
    assert.equal(rows[id].score, 0);
    assert.equal(rows[id].roundScore, 0);
    assert.equal(rows[id].pending, false);
  }
  assert.deepEqual(board.rows.map(row => row.rank), [1, 2, 3, 3, 3]);
  assert.equal(board.status, 'round-complete');
});

test('Cavalry sums completed divisions only and historical Women excludes Men', () => {
  const s = defaultState();
  arena(s, 'women', ['red', 'blue'], ['red']);
  arena(s, 'men', ['red', 'blue', 'green'], ['red']);
  let board = buildGameScoreboard(s, { key: 'cavalry:men' }), rows = byTeam(board);
  assert.equal(rows.red.score, 4);
  assert.equal(rows.red.roundScore, null);
  assert.equal(rows.red.pending, true);
  s.cavalry.divisions.men.eliminated.push('blue');
  board = buildGameScoreboard(s, { key: 'cavalry:men' });
  rows = byTeam(board);
  assert.equal(board.status, 'game-complete');
  assert.equal(rows.red.score, 7);
  assert.equal(rows.blue.score, 9);
  assert.equal(rows.green.score, 5);
  assert.equal(rows.white.score, 0);
  const historical = buildGameScoreboard(s, { key: 'cavalry:women' });
  assert.equal(historical.status, 'round-complete');
  assert.equal(byTeam(historical).red.score, 4);
  assert.equal(byTeam(historical).green.score, 0);
});

test('Tug interim standings show confirmed wins, a played loss at zero and unplayed teams as pending', () => {
  const s = defaultState(); draw(s); setWinner(s.tug, 'prelim', 'red');
  const board = buildGameScoreboard(s, { key: 'tug:prelim' }), rows = byTeam(board);
  assert.equal(board.scoreLabel, 'Match wins');
  assert.equal(rows.red.score, 1);
  assert.equal(rows.blue.score, 0);
  assert.equal(rows.yellow.score, null);
  assert.equal(rows.red.roundScore, 1);
  assert.equal(rows.blue.roundScore, 0);
  assert.equal(rows.blue.pending, false);
  assert.equal(rows.yellow.pending, true);
});

test('Tug final follows official 5/4/3/3/1 points with shared bronze positions', () => {
  const s = defaultState(); draw(s);
  for (const [match, id] of [['prelim', 'red'], ['semi1', 'red'], ['semi2', 'white'], ['final', 'white']]) setWinner(s.tug, match, id);
  const board = buildGameScoreboard(s, { key: 'tug:final' }), rows = byTeam(board);
  assert.equal(board.status, 'game-complete');
  assert.equal(board.scoreLabel, 'Game points');
  assert.deepEqual(board.rows.map(row => row.teamId), ['white', 'red', 'yellow', 'green', 'blue']);
  assert.deepEqual(board.rows.map(row => row.score), [5, 4, 3, 3, 1]);
  assert.deepEqual(board.rows.map(row => row.rank), [1, 2, 3, 3, 5]);
  assert.equal(rows.white.roundScore, 1);
  assert.equal(rows.red.roundScore, 0);
  assert.ok(board.rows.every(row => !row.pending));
});

test('Resetting a Tug predecessor withdraws final points and invalid dependent wins', () => {
  const s = defaultState(); draw(s);
  for (const [match, id] of [['prelim', 'red'], ['semi1', 'red'], ['semi2', 'white'], ['final', 'white']]) setWinner(s.tug, match, id);
  resetRound(s, 'tug:prelim');
  const board = buildGameScoreboard(s, { key: 'tug:prelim' }), rows = byTeam(board);
  assert.equal(board.complete, false);
  assert.equal(board.scoreLabel, 'Match wins');
  assert.equal(rows.red.score, null);
  assert.equal(rows.white.score, 1);
  assert.equal(rows.green.score, 0);
});

test('Final standings respect an approved tie decision used by the main Scores overview', () => {
  const s = defaultState();
  setColumn(s, 'relay', 0, [1, 2, 3, 4, 5]);
  setColumn(s, 'relay', 1, [3, 4, 5, 1, 2]);
  setColumn(s, 'relay', 2, [5, 3, 1, 4, 2]);
  s.placements.relay = { rule: 'Recorded tie-break', values: [5, 4, 3, 2, 1] };
  const board = buildGameScoreboard(s, { key: 'relay:2' });
  assert.deepEqual(board.rows.map(row => row.score), [9, 9, 9, 9, 9]);
  assert.deepEqual(board.rows.map(row => row.teamId), ['white', 'green', 'yellow', 'blue', 'red']);
  assert.deepEqual(board.rows.map(row => row.rank), [1, 2, 3, 4, 5]);
});

test('Keys identify the selected match or attempt without accepting another game scope', () => {
  const s = defaultState();
  assert.equal(buildGameScoreboard(s, { game: 'basket', key: 'basket:blue:1' }).stageLabel, 'Blue · attempt 2 / 2');
  assert.equal(buildGameScoreboard(s, { game: 'relay', key: 'borrow:5', round: 1 }).key, 'relay:1');
  assert.equal(buildGameScoreboard(s, { key: 'cavalry:men' }).stageLabel, 'Round 2 / 2 · Men');
  assert.equal(buildGameScoreboard(s, { game: 'borrow', round: 99 }).key, 'borrow:5');
  assert.equal(buildGameScoreboard(s, { key: 'event:1' }), null);
});

test('Started timers yield live state, and a whole-game reset clears prior rankings', () => {
  const s = defaultState();
  s.timers['borrow:0'] = { started: true };
  assert.equal(buildGameScoreboard(s, { key: 'borrow:0' }).status, 'live');
  setColumn(s, 'borrow', 0, [5, 4, 3, 2, 2]);
  resetGame(s, 'borrow');
  const board = buildGameScoreboard(s, { key: 'borrow:0' });
  assert.equal(board.status, 'ready');
  assert.ok(board.rows.every(row => row.score === null && row.rank === null));
});

test('The display model preserves raw team names, excludes private fields and never mutates state', () => {
  const s = defaultState();
  s.teams[0].name = '<b>Fire & Ice</b>';
  s.teams[0].leader = 'Private leader';
  s.committeeMembers.comms[0] = 'Private roster';
  s.notes[0] = 'Private note';
  const before = structuredClone(s);
  const board = buildGameScoreboard(s, { key: 'borrow:0' });
  assert.equal(byTeam(board).red.name, '<b>Fire & Ice</b>');
  assert.equal(byTeam(board).red.colour, '#ed1639');
  assert.doesNotMatch(JSON.stringify(board), /Private leader|Private roster|Private note|participants|committeeMembers/);
  assert.deepEqual(s, before);
});

test('Following prefers an active same-game round and preserves the caller context', () => {
  const s = defaultState(), context = { game: 'borrow', key: 'borrow:0', round: 0, eventIndex: 4 };
  setColumn(s, 'borrow', 1, [5, 4, 3, 2, 2]);
  s.timers['borrow:2'] = makeClock(90);
  startClock(s.timers, 'borrow:2', 100);
  const before = structuredClone(s), next = followGameScoreboardContext(s, context);
  assert.deepEqual(next, { game: 'borrow', key: 'borrow:2', round: 2, eventIndex: 4 });
  assert.deepEqual(context, { game: 'borrow', key: 'borrow:0', round: 0, eventIndex: 4 });
  assert.deepEqual(s, before);
});

test('Following catches up to the highest completed round while a partial later round waits', () => {
  const s = defaultState();
  setColumn(s, 'relay', 0, [1, 2, 3, 4, 5]);
  setColumn(s, 'relay', 1, [5, 4, 3, 2, 1]);
  s.relay.scores[0][2] = 1;
  assert.equal(followGameScoreboardContext(s, { key: 'relay:0' }).key, 'relay:1');
  assert.equal(followGameScoreboardContext(s, { game: 'relay', round: 0 }).round, 1);
});

test('Following never crosses into another active game', () => {
  const s = defaultState(), context = { game: 'relay', key: 'relay:0', round: 0 };
  s.timers['borrow:1'] = makeClock(90);
  startClock(s.timers, 'borrow:1', 100);
  assert.deepEqual(followGameScoreboardContext(s, context), context);
  setColumn(s, 'relay', 1, [1, 2, 3, 4, 5]);
  assert.equal(followGameScoreboardContext(s, context).key, 'relay:1');
});

test('Disabled contingency Borrow round is excluded from both active and completed catch-up', () => {
  const s = defaultState();
  setColumn(s, 'borrow', 4, [5, 4, 3, 2, 2]);
  setColumn(s, 'borrow', 6, [5, 4, 3, 2, 2]);
  s.timers['borrow:6'] = makeClock(90);
  startClock(s.timers, 'borrow:6', 100);
  assert.equal(followGameScoreboardContext(s, { game: 'borrow', round: 0 }).key, 'borrow:4');
  s.borrow.rounds = 7;
  assert.equal(followGameScoreboardContext(s, { game: 'borrow', round: 0 }).key, 'borrow:6');
});

test('Following Cavalry catches Women then Men, and an active division takes priority', () => {
  const s = defaultState();
  arena(s, 'women', ['red', 'blue'], ['red']);
  assert.equal(followGameScoreboardContext(s, { game: 'cavalry', division: 'men' }).division, 'women');
  arena(s, 'men', ['red', 'blue']);
  s.timers['cavalry:men'] = makeClock(90);
  startClock(s.timers, 'cavalry:men', 100);
  assert.equal(followGameScoreboardContext(s, { key: 'cavalry:women' }).key, 'cavalry:men');
  s.cavalry.divisions.men.eliminated = ['red'];
  assert.equal(followGameScoreboardContext(s, { key: 'cavalry:women' }).division, 'men');
});

test('Following Basket uses finish order and updates team and attempt fields together', () => {
  const s = defaultState();
  s.basket.scores[4][1] = 7;
  s.basket.scores[0][0] = 4;
  s.finished = ['basket:white:1', 'basket:red:0'];
  let context = followGameScoreboardContext(s, { game: 'basket', team: 'white', attempt: 1, round: 1 });
  assert.equal(context.key, 'basket:red:0');
  assert.equal(context.team, 'red');
  assert.equal(context.attempt, 0);
  assert.equal(context.round, 0);
  s.timers['basket:blue:1'] = makeClock(30);
  startClock(s.timers, 'basket:blue:1', 100);
  context = followGameScoreboardContext(s, context);
  assert.equal(context.key, 'basket:blue:1');
  assert.equal(context.team, 'blue');
  assert.equal(context.attempt, 1);
});

test('Following Tug uses furthest valid completed match and respects dependency resets', () => {
  const s = defaultState(); draw(s);
  setWinner(s.tug, 'prelim', 'red');
  setWinner(s.tug, 'semi1', 'red');
  setWinner(s.tug, 'semi2', 'white');
  let context = followGameScoreboardContext(s, { key: 'tug:prelim' });
  assert.equal(context.key, 'tug:semi2');
  assert.equal(context.match, 'semi2');
  setWinner(s.tug, 'final', 'white');
  assert.equal(followGameScoreboardContext(s, context).key, 'tug:final');
  resetRound(s, 'tug:semi2');
  assert.equal(followGameScoreboardContext(s, context).key, 'tug:semi1');
  s.tug.locked = false;
  assert.deepEqual(followGameScoreboardContext(s, context), context);
});

test('Resetting a game leaves the copied selection but yields an empty truthful board', () => {
  const s = defaultState();
  setColumn(s, 'borrow', 2, [5, 4, 3, 2, 2]);
  const context = followGameScoreboardContext(s, { game: 'borrow', key: 'borrow:0' });
  assert.equal(context.key, 'borrow:2');
  resetGame(s, 'borrow');
  const next = followGameScoreboardContext(s, context);
  assert.notEqual(next, context);
  assert.deepEqual(next, context);
  const board = buildGameScoreboard(s, next);
  assert.equal(board.status, 'ready');
  assert.ok(board.rows.every(row => row.score === null && row.rank === null));
});

test('Scoreboard clocks mirror all live game defaults without creating saved timers', () => {
  const s = defaultState();
  s.borrow.rounds = 7;
  const expected = {
    'borrow:0': 90, 'borrow:1': 90, 'borrow:2': 120, 'borrow:3': 120, 'borrow:4': 120, 'borrow:5': 120, 'borrow:6': 90,
    'basket:red:0': 30, 'basket:white:1': 30,
    'relay:0': 480, 'relay:1': 600, 'relay:2': 480,
    'cavalry:women': 300, 'cavalry:men': 300,
    'tug:prelim': 60, 'tug:semi1': 60, 'tug:semi2': 60, 'tug:final': 60,
  };
  const before = structuredClone(s);
  for (const [key, seconds] of Object.entries(expected)) {
    const timer = buildGameScoreboardTimer(s, { key }, 1000);
    assert.equal(timer.key, key);
    assert.equal(timer.remainingMs, seconds * 1000, key);
    assert.equal(timer.status, 'ready', key);
    assert.equal(timer.statusLabel, 'Ready', key);
  }
  assert.deepEqual(s, before);
  s.cavalry.cap = 180;
  assert.equal(buildGameScoreboardTimer(s, { key: 'cavalry:men' }).text, '03:00');
  assert.equal(buildGameScoreboardTimer(s, { key: 'event:4' }), null);
  assert.equal(buildGameScoreboardTimer(s), null);
});

test('Scoreboard time follows the real pause, resume, extension and expiry clock operations', () => {
  const s = defaultState(), key = 'borrow:0', ctx = { key };
  s.timers[key] = makeClock(90);
  startClock(s.timers, key, 1000);
  assert.deepEqual(buildGameScoreboardTimer(s, ctx, 2250), { key, text: '01:29', status: 'running', statusLabel: 'LIVE', remainingMs: 88750 });
  pauseClock(s.timers[key], 11000);
  assert.equal(buildGameScoreboardTimer(s, ctx, 41000).remainingMs, 80000);
  assert.equal(buildGameScoreboardTimer(s, ctx, 41000).status, 'paused');
  startClock(s.timers, key, 41000);
  addTime(s.timers[key], 30, 51000);
  assert.equal(buildGameScoreboardTimer(s, ctx, 51000).text, '01:40');
  assert.equal(buildGameScoreboardTimer(s, ctx, 151000).status, 'expired');
  assert.equal(buildGameScoreboardTimer(s, ctx, 151000).text, '00:00');
  pauseClock(s.timers[key], 151000);
  assert.equal(buildGameScoreboardTimer(s, ctx, 160000).status, 'expired');
  addTime(s.timers[key], 30, 160000);
  assert.equal(buildGameScoreboardTimer(s, ctx, 160000).status, 'paused');
  assert.equal(buildGameScoreboardTimer(s, ctx, 160000).statusLabel, 'Paused');
});

test('Scoreboard clock reads replacement remote snapshots and locally adjusted deadlines directly', () => {
  let s = defaultState();
  s.timers['relay:1'] = makeClock(600);
  startClock(s.timers, 'relay:1', 1000);
  assert.equal(buildGameScoreboardTimer(s, { key: 'relay:1' }, 2000).remainingMs, 599000);
  const remote = structuredClone(s);
  remote.timers['relay:1'] = { ...makeClock(700), started: true, deadline: 32000 };
  s = remote;
  const before = structuredClone(s);
  assert.equal(buildGameScoreboardTimer(s, { key: 'relay:1' }, 2000).remainingMs, 30000);
  pauseClock(s.timers['relay:1'], 3000);
  assert.equal(buildGameScoreboardTimer(s, { key: 'relay:1' }, 20000).remainingMs, 29000);
  assert.equal(before.timers['relay:1'].deadline, 32000);
  const paused = structuredClone(s);
  buildGameScoreboardTimer(s, { key: 'relay:1' }, 20000);
  assert.deepEqual(s, paused);
});

test('An active other game never leaks into a selected or historical scoreboard timer', () => {
  const s = defaultState();
  s.timers['borrow:2'] = makeClock(120);
  startClock(s.timers, 'borrow:2', 1000);
  s.activeKey = 'borrow:2';
  assert.equal(buildGameScoreboardTimer(s, { game: 'relay', key: 'borrow:2', round: 1 }, 2000).text, '10:00');
  assert.equal(buildGameScoreboardTimer(s, { key: 'borrow:0' }, 2000).text, '01:30');
  assert.equal(buildGameScoreboardTimer(s, { key: 'borrow:0' }, 2000).status, 'ready');
  s.timers['borrow:0'] = { ...makeClock(90), started: true, remaining: 12345 };
  assert.equal(buildGameScoreboardTimer(s, { key: 'borrow:0' }, 2000).text, '00:13');
  assert.equal(buildGameScoreboardTimer(s, { key: 'borrow:0' }, 2000).status, 'paused');
});

test('Changed unstarted Tug draws and Cavalry selections discard stale timer signatures only for display', () => {
  const s = defaultState(); draw(s);
  s.timers['tug:prelim'] = makeClock(35, 'yellow|green');
  s.cavalry.divisions.women.active = ['red', 'blue'];
  s.timers['cavalry:women'] = makeClock(45, 'red|yellow');
  const before = structuredClone(s);
  assert.equal(buildGameScoreboardTimer(s, { key: 'tug:prelim' }).text, '01:00');
  assert.equal(buildGameScoreboardTimer(s, { key: 'cavalry:women' }).text, '05:00');
  assert.deepEqual(s, before);
  s.timers['tug:prelim'].signature = 'red|blue';
  s.timers['cavalry:women'].signature = 'red|blue';
  assert.equal(buildGameScoreboardTimer(s, { key: 'tug:prelim' }).text, '00:35');
  assert.equal(buildGameScoreboardTimer(s, { key: 'cavalry:women' }).text, '00:45');
  s.timers['tug:prelim'].signature = 'old|draw';
  s.timers['cavalry:women'].signature = 'old|arena';
  s.timers['tug:prelim'].started = true;
  s.timers['cavalry:women'].started = true;
  assert.equal(buildGameScoreboardTimer(s, { key: 'tug:prelim' }).text, '00:35');
  assert.equal(buildGameScoreboardTimer(s, { key: 'cavalry:women' }).text, '00:45');
});

test('Completed selected rounds override running or expired clocks without changing them', () => {
  const s = defaultState();
  setColumn(s, 'borrow', 0, [5, 4, 3, 2, 2]);
  s.timers['borrow:0'] = { ...makeClock(90), started: true, deadline: 50000 };
  const before = structuredClone(s);
  assert.equal(buildGameScoreboardTimer(s, { key: 'borrow:0' }, 1000).status, 'round-complete');
  assert.equal(buildGameScoreboardTimer(s, { key: 'borrow:0' }, 50000).statusLabel, 'Round complete');
  assert.deepEqual(s, before);
  for (let round = 1; round < 6; round++) setColumn(s, 'borrow', round, [5, 4, 3, 2, 2]);
  assert.equal(buildGameScoreboardTimer(s, { key: 'borrow:0' }, 1000).status, 'round-complete');
  assert.equal(buildGameScoreboardTimer(s, { key: 'borrow:5' }, 1000).statusLabel, 'Game complete');
});

test('Timer completion scope agrees with all five game scoreboards and historical rounds', () => {
  const s = defaultState();
  for (let round = 0; round < 3; round++) setColumn(s, 'relay', round, [1, 2, 3, 4, 5]);
  arena(s, 'women', ['red', 'blue'], ['red']);
  arena(s, 'men', ['red', 'blue'], ['blue']);
  for (const [i, id] of TEAM_IDS.entries()) for (const attempt of [0, 1]) {
    s.basket.scores[i][attempt] = i;
    s.finished.push(`basket:${id}:${attempt}`);
  }
  draw(s);
  for (const [match, id] of [['prelim', 'red'], ['semi1', 'red'], ['semi2', 'white'], ['final', 'white']]) setWinner(s.tug, match, id);
  for (const key of ['relay:0', 'relay:2', 'cavalry:women', 'cavalry:men', 'basket:red:0', 'tug:prelim', 'tug:final']) {
    assert.equal(buildGameScoreboardTimer(s, { key }).status, buildGameScoreboard(s, { key }).status, key);
  }
  resetGame(s, 'relay');
  assert.equal(buildGameScoreboardTimer(s, { key: 'relay:2' }).status, 'ready');
});

test('Imported completed results do not invent an original remaining time', () => {
  const s = defaultState();
  setColumn(s, 'borrow', 0, [5, 4, 3, 2, 2]);
  assert.deepEqual(buildGameScoreboardTimer(s, { key: 'borrow:0' }, 1000), {
    key: 'borrow:0', text: '—', status: 'round-complete', statusLabel: 'Round complete', remainingMs: null,
  });
  s.timers['borrow:0'] = { ...makeClock(90), started: true, remaining: 27500 };
  const before = structuredClone(s);
  assert.equal(buildGameScoreboardTimer(s, { key: 'borrow:0' }, 1000).text, '00:28');
  assert.equal(buildGameScoreboardTimer(s, { key: 'borrow:0' }, 60000).remainingMs, 27500);
  assert.deepEqual(s, before);
});

console.log(`${tests.length} scoreboard model tests passed.`);
