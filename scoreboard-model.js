import { TEAM_IDS, COLOURS, GAME_IDS, gameDone, gamePlaces, matchTeams, validSlots } from './model.js?v=60';
import { GAME_NAMES } from './content.js?v=60';
import { roundDone, cavalryPoints } from './rounds.js?v=60';
import { MATCH_KEYS, MATCH_NAMES } from './timer-model.js?v=60';
import { activeRoundKey } from './flow-model.js?v=60';

const DIVISIONS = ['women', 'men'];
const present = value => Number.isFinite(value);

function scopeFor(state, context) {
  const [keyGame, part, attempt] = String(context.key || '').split(':');
  const game = GAME_IDS.includes(context.game) ? context.game : keyGame;
  if (!GAME_IDS.includes(game)) return null;
  const keyPart = keyGame === game ? part : undefined;
  if (game === 'borrow' || game === 'relay') {
    const count = game === 'borrow' ? state.borrow.rounds : 3;
    const requested = keyPart === undefined ? context.round : Number(keyPart);
    const round = Number.isInteger(requested) ? Math.max(0, Math.min(count - 1, requested)) : 0;
    return { game, key: `${game}:${round}`, round, count };
  }
  if (game === 'basket') {
    const team = TEAM_IDS.includes(keyPart) ? keyPart : TEAM_IDS.includes(context.team) ? context.team : TEAM_IDS[0];
    const requested = keyPart === undefined ? context.attempt ?? context.round : Number(attempt);
    const round = requested === 1 ? 1 : 0;
    return { game, key: `basket:${team}:${round}`, team, round };
  }
  if (game === 'cavalry') {
    const division = DIVISIONS.includes(keyPart) ? keyPart : DIVISIONS.includes(context.division) ? context.division : state.cavalry.division;
    return { game, key: `cavalry:${division}`, division, round: DIVISIONS.indexOf(division), count: 2 };
  }
  const match = MATCH_KEYS.includes(keyPart) ? keyPart : MATCH_KEYS.includes(context.match) ? context.match : 'prelim';
  return { game, key: `tug:${match}`, match };
}

/** Follow this game's active stage, or catch up to its latest saved stage.
 * The caller decides whether following is enabled for a historical review.
 * No active/completed stage leaves the selection unchanged, including after a
 * reset, so the subsequent board derives truthful empty/pending standings.
 */
export function followGameScoreboardContext(state, context = {}) {
  const next = { ...context };
  const game = GAME_IDS.includes(context.game) ? context.game : String(context.key || '').split(':')[0];
  if (!GAME_IDS.includes(game)) return next;
  const active = activeRoundKey(state);
  let key = active?.startsWith(game + ':') ? active : null;
  if (!key) {
    let candidates;
    if (game === 'borrow' || game === 'relay') candidates = Array.from({ length: game === 'borrow' ? state.borrow.rounds : 3 }, (_, round) => `${game}:${round}`);
    else if (game === 'cavalry') candidates = DIVISIONS.map(division => `cavalry:${division}`);
    else if (game === 'basket') candidates = state.finished.filter(value => /^basket:(red|blue|yellow|green|white):[01]$/.test(value));
    else candidates = state.tug.locked && validSlots(state.tug.slots) ? MATCH_KEYS.filter(match => {
      const pair = matchTeams(state.tug, match);
      return pair.every(Boolean) && pair.includes(state.tug.winners[match]);
    }).map(match => `tug:${match}`) : [];
    key = [...candidates].reverse().find(candidate => roundDone(state, candidate)) || null;
  }
  if (!key) return next;
  const [, part, attempt] = key.split(':');
  Object.assign(next, { game, key });
  if (game === 'borrow' || game === 'relay') next.round = Number(part);
  else if (game === 'basket') Object.assign(next, { team: part, attempt: Number(attempt), round: Number(attempt) });
  else if (game === 'cavalry') next.division = part;
  else next.match = part;
  return next;
}

function rankRows(rows, places = null) {
  const sorted = [...rows].sort((a, b) => {
    if (a.score === null || b.score === null) return a.score === b.score ? 0 : a.score === null ? 1 : -1;
    return b.score - a.score || (places ? places[TEAM_IDS.indexOf(a.teamId)] - places[TEAM_IDS.indexOf(b.teamId)] : 0);
  });
  let previousScore, previousRank;
  return sorted.map((row, index) => {
    const rank = row.score === null ? null : places ? places[TEAM_IDS.indexOf(row.teamId)] : row.score === previousScore ? previousRank : index + 1;
    if (row.score !== null) { previousScore = row.score; previousRank = rank; }
    return { ...row, rank };
  });
}

function baseRows(state) {
  // Only public team identity enters the display model. Committee rosters,
  // participant details, leaders, notes and private device data are omitted.
  return TEAM_IDS.map((teamId, i) => ({
    teamId,
    name: state.teams.find(team => team.id === teamId)?.name || teamId[0].toUpperCase() + teamId.slice(1),
    colour: COLOURS[i],
    rank: null,
    score: null,
    roundScore: null,
    detail: '',
    pending: true,
  }));
}

/**
 * Read-only standings for the selected live-desk context. `score` is confirmed
 * cumulative game performance, while `roundScore` belongs to the selected round
 * or attempt. Null means no confirmed result; a saved zero stays numeric zero.
 * Earlier round selections deliberately exclude later-round results. Basket
 * uses best locked attempts, and interim Tug standings use match wins rather
 * than inventing championship points before the tournament finishes.
 * Strings are raw public display text; the DOM renderer must escape them.
 */
export function buildGameScoreboard(state, context = {}) {
  const scope = scopeFor(state, context);
  if (!scope) return null;
  const { game, key } = scope;
  const complete = Boolean(gameDone(state, game));
  const roundComplete = Boolean(roundDone(state, key));
  const board = {
    game, key, title: GAME_NAMES[game], stageLabel: '', summaryLabel: '',
    status: 'ready', complete, roundComplete, scoreLabel: 'Points', roundLabel: 'Round points', rows: baseRows(state),
  };
  let finalScope = false;
  if (game === 'borrow' || game === 'relay') {
    const { round, count } = scope;
    board.stageLabel = `Round ${round + 1} / ${count}`;
    board.summaryLabel = `Points through round ${round + 1}`;
    board.rows = board.rows.map((row, i) => {
      const scores = state[game].scores[i].slice(0, round + 1);
      const saved = scores.filter(present);
      const roundScore = present(scores[round]) ? game === 'relay' ? 6 - scores[round] : scores[round] : null;
      const missing = scores.length - saved.length;
      return {
        ...row,
        score: saved.length ? saved.reduce((sum, value) => sum + (game === 'relay' ? 6 - value : value), 0) : null,
        roundScore,
        pending: missing > 0,
        detail: roundScore === null ? 'Waiting for result' : game === 'borrow' && roundScore === 0 ? 'Fail · 0 points' : game === 'relay' ? `Finished #${scores[round]}` : 'Result saved',
      };
    });
    finalScope = round === count - 1;
  } else if (game === 'basket') {
    const { team, round } = scope;
    const selectedName = board.rows.find(row => row.teamId === team).name;
    board.stageLabel = `${selectedName} · attempt ${round + 1} / 2`;
    board.summaryLabel = 'Best result from locked attempts';
    board.scoreLabel = 'Best saved balls';
    board.roundLabel = 'Attempt balls';
    board.rows = board.rows.map((row, i) => {
      const attempts = [0, 1].filter(index => state.finished.includes(`basket:${row.teamId}:${index}`) && present(state.basket.scores[i][index]));
      const score = attempts.length ? Math.max(...attempts.map(index => state.basket.scores[i][index])) : null;
      return {
        ...row, score,
        roundScore: row.teamId === team && attempts.includes(round) ? state.basket.scores[i][round] : null,
        pending: attempts.length < 2,
        detail: attempts.length ? `${attempts.length} / 2 attempts locked` : 'No locked attempt',
      };
    });
    finalScope = true;
  } else if (game === 'cavalry') {
    const { division, round } = scope;
    const current = state.cavalry.divisions[division];
    const saved = DIVISIONS.slice(0, round + 1).map(part => cavalryPoints(state, part));
    board.stageLabel = `Round ${round + 1} / 2 · ${division === 'women' ? 'Women' : 'Men'}`;
    board.summaryLabel = `Completed division points through ${division === 'women' ? 'Women' : 'Men'}`;
    board.roundLabel = 'Division points';
    board.rows = board.rows.map((row, i) => {
      const points = saved.map(values => values[i]);
      const confirmed = points.filter(present);
      const roundScore = points[round];
      const inArena = current.active.includes(row.teamId);
      const out = current.eliminated.includes(row.teamId);
      return {
        ...row,
        score: confirmed.length ? confirmed.reduce((sum, value) => sum + value, 0) : null,
        roundScore,
        pending: confirmed.length < points.length,
        detail: roundComplete ? !inArena ? 'Not in arena · 0 points' : out ? 'Result saved' : 'Last horse · winner' : !current.started ? 'Waiting for arena' : !inArena ? 'Not in this arena' : out ? 'Out · division still in progress' : 'In arena',
      };
    });
    finalScope = round === 1;
  } else {
    const validDraw = state.tug.locked && validSlots(state.tug.slots);
    const matches = validDraw ? MATCH_KEYS.filter(match => {
      const pair = matchTeams(state.tug, match);
      return pair.every(Boolean) && pair.includes(state.tug.winners[match]);
    }) : [];
    const selectedPair = validDraw ? matchTeams(state.tug, scope.match) : [];
    const matchSaved = matches.includes(scope.match);
    board.stageLabel = MATCH_NAMES[scope.match];
    board.summaryLabel = complete ? 'Final tournament points' : 'Confirmed match wins · tournament in progress';
    board.scoreLabel = complete ? 'Game points' : 'Match wins';
    board.roundLabel = 'Match result';
    const places = complete ? gamePlaces(state, game) : null;
    board.rows = board.rows.map((row, i) => {
      const played = matches.filter(match => matchTeams(state.tug, match).includes(row.teamId));
      const wins = played.filter(match => state.tug.winners[match] === row.teamId).length;
      const lost = played.some(match => state.tug.winners[match] !== row.teamId);
      return {
        ...row,
        score: complete ? 6 - places[i] : played.length ? wins : null,
        roundScore: matchSaved && selectedPair.includes(row.teamId) ? Number(state.tug.winners[scope.match] === row.teamId) : null,
        pending: !complete && !lost,
        detail: complete ? `Place ${places[i]} · ${wins} ${wins === 1 ? 'win' : 'wins'}` : lost ? 'Eliminated' : played.length ? `${wins} confirmed ${wins === 1 ? 'win' : 'wins'}` : 'Not played yet',
      };
    });
    finalScope = true;
  }
  const hasResult = board.rows.some(row => row.score !== null || row.roundScore !== null);
  const started = state.timers[key]?.started || game === 'cavalry' && state.cavalry.divisions[scope.division].started;
  board.status = complete && finalScope ? 'game-complete' : roundComplete ? 'round-complete' : started || hasResult ? 'live' : 'ready';
  board.rows = rankRows(board.rows, complete && finalScope ? gamePlaces(state, game) : null);
  return board;
}
