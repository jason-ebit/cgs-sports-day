import { validateClocks } from './timer-model.js?v=3';
export const TEAM_IDS = ['red', 'blue', 'yellow', 'green', 'white'];
export const COLOURS = ['#ed1639', '#2867a7', '#ffc622', '#0cab54', '#ffffff'];
export const GAME_IDS = ['borrow', 'basket', 'cavalry', 'tug', 'relay'];
export function defaultState() {
  return {
    version: 1,
    teams: TEAM_IDS.map((id, i) => ({ id, name: id[0].toUpperCase() + id.slice(1), leader: '', participants: null, seed: i + 1 })),
    tug: { slots: Array(5).fill(null), locked: false, winners: { prelim: null, semi1: null, semi2: null, final: null } },
    borrow: { rounds: 6, scores: TEAM_IDS.map(() => Array(7).fill(null)) },
    basket: { scores: TEAM_IDS.map(() => [null, null]) },
    relay: { scores: TEAM_IDS.map(() => [null, null, null]) },
    cavalry: { division: 'women', cap: null, rule: '', divisions: Object.fromEntries(['women', 'men'].map(d => [d, { counts: Array(5).fill(null), active: [], eliminated: [], started: false }])) },
    placements: Object.fromEntries(GAME_IDS.map(id => [id, { rule: '', values: Array(5).fill(null) }])),
    notes: {}, timers: {}, finished: [], activeKey: null,
  };
}
export function shuffled(ids, rng = Math.random) {
  const result = [...ids];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
export function seededSlots(teams) {
  if (new Set(teams.map(t => t.seed)).size !== 5 || teams.some(t => !Number.isInteger(t.seed) || t.seed < 1 || t.seed > 5)) throw Error('Give each team a unique seed from 1 to 5.');
  const order = [...teams].sort((a, b) => a.seed - b.seed).map(t => t.id);
  return [order[3], order[4], order[0], order[1], order[2]];
}
export function validSlots(slots) { return slots.length === 5 && new Set(slots).size === 5 && slots.every(id => TEAM_IDS.includes(id)); }
export function clearTug(tug) { tug.winners = { prelim: null, semi1: null, semi2: null, final: null }; }
export function matchTeams(tug, match) {
  const s = tug.slots, w = tug.winners;
  return ({ prelim: [s[0], s[1]], semi1: [s[2], w.prelim], semi2: [s[3], s[4]], final: [w.semi1, w.semi2] })[match];
}
export function setWinner(tug, match, id) {
  const pair = matchTeams(tug, match);
  if (!tug.locked || !pair || pair.some(x => !x) || !pair.includes(id)) throw Error('Lock a complete draw and finish the preceding match first.');
  if (tug.winners[match] === id) return;
  tug.winners[match] = id;
  if (match === 'prelim') { tug.winners.semi1 = null; tug.winners.final = null; }
  if (match === 'semi1' || match === 'semi2') tug.winners.final = null;
}
export function assignSlot(tug, index, id) {
  if (tug.locked) throw Error('Unlock the draw before editing.');
  if (id !== null && !TEAM_IDS.includes(id)) throw Error('Unknown team.');
  const previous = tug.slots[index], duplicate = tug.slots.indexOf(id);
  if (id && duplicate !== -1 && duplicate !== index) tug.slots[duplicate] = previous;
  tug.slots[index] = id;
  clearTug(tug);
}
export function totals(state, game) {
  if (game === 'cavalry') {
    const rounds=['women','men'].map(division=>{const d=state.cavalry.divisions[division];if(!d.started||d.active.length-d.eliminated.length!==1)return null;const order=[...d.eliminated,...d.active.filter(id=>!d.eliminated.includes(id))].reverse();return TEAM_IDS.map(id=>order.includes(id)?5-order.indexOf(id):0);});
    return TEAM_IDS.map((_,i)=>rounds.some(r=>!r)?null:rounds.reduce((sum,r)=>sum+r[i],0));
  }
  const count = game === 'borrow' ? state.borrow.rounds : game === 'basket' ? 2 : 3;
  return state[game].scores.map(row => {
    const cells = row.slice(0, count);
    if (cells.some(n => n === null)) return null;
    if (game === 'basket') return Math.max(...cells);
    return cells.reduce((sum, n) => sum + (game === 'relay' ? 6 - n : n), 0);
  });
}
export function placementsFromTotals(values) {
  if (values.some(v => v === null) || new Set(values).size !== 5) return null;
  const sorted = [...values].sort((a,b) => b-a);
  return values.map(v => sorted.indexOf(v) + 1);
}
export function approvedPlaces(state, game) {
  const p = state.placements[game];
  if (!p?.rule.trim() || p.values.some(n => !Number.isInteger(n) || n < 1 || n > 5) || new Set(p.values).size !== 5) return null;
  if (['borrow','basket','relay','cavalry'].includes(game)) {
    const scores = totals(state, game);
    if (scores.some(n => n === null)) return null;
    for(let i=0;i<5;i++) for(let j=0;j<5;j++) if(scores[i]>scores[j] && p.values[i]>p.values[j]) return null;
  }
  return p.values;
}
export function championship(state) {
  const places = GAME_IDS.map(game => {
    if (['borrow', 'basket', 'relay', 'cavalry'].includes(game)) return placementsFromTotals(totals(state, game)) || approvedPlaces(state, game);
    return approvedPlaces(state, game);
  });
  const rows = TEAM_IDS.map((id, i) => ({ id, points: places.map(p => p ? 6 - p[i] : null), total: places.reduce((sum, p) => sum + (p ? 6 - p[i] : 0), 0), firsts: places.filter(p => p && p[i] === 1).length }));
  return { complete: places.every(Boolean), completed: places.filter(Boolean).length, rows: rows.sort((a,b) => b.total - a.total || b.firsts - a.firsts) };
}
export function validateState(input) {
  // Rebuild a whitelisted object; imports never inject markup or arbitrary keys.
  const s = defaultState();
  const fail = () => { throw Error('This is not a valid Sports Day backup. No data was changed.'); };
  const text = (v, max) => { if (typeof v !== 'string' || v.length > max) fail(); return v; };
  const num = (v, max, min = 0) => { if (v !== null && (!Number.isInteger(v) || v < min || v > max)) fail(); return v; };
  const list = (v, length) => { if (!Array.isArray(v) || v.length !== length) fail(); return v; };
  const ids = v => { if (!Array.isArray(v) || v.some(x => !TEAM_IDS.includes(x)) || new Set(v).size !== v.length) fail(); return [...v]; };
  const bool = v => { if (typeof v !== 'boolean') fail(); return v; };
  if (!input || input.version !== 1) fail();
  s.teams = list(input.teams, 5).map((t,i) => { if (t.id !== TEAM_IDS[i] || !t.name?.trim()) fail(); return { id:t.id, name:text(t.name,24), leader:text(t.leader,60), participants:num(t.participants,100), seed:num(t.seed,5,1) }; });
  s.tug.slots = list(input.tug.slots, 5).map(id => { if (id !== null && !TEAM_IDS.includes(id)) fail(); return id; });
  const assigned = s.tug.slots.filter(Boolean); if (new Set(assigned).size !== assigned.length) fail();
  s.tug.locked = bool(input.tug.locked); if (s.tug.locked && !validSlots(s.tug.slots)) fail();
  for (const m of ['prelim','semi1','semi2','final']) { const id = input.tug.winners[m]; if (id !== null) { if (!s.tug.locked) fail(); try { setWinner(s.tug,m,id); } catch { fail(); } } }
  if (![6,7].includes(input.borrow.rounds)) fail(); s.borrow.rounds=input.borrow.rounds;
  for (const [g,n,max] of [['borrow',7,5],['basket',2,999],['relay',3,5]]) {
    s[g].scores = list(input[g].scores,5).map(row => list(row,n).map(v => { const result=num(v,max,g==='relay'?1:0); if(g==='borrow' && v===1) fail(); return result; }));
    if(g==='relay') for(let j=0;j<3;j++){const col=s[g].scores.map(r=>r[j]).filter(v=>v!==null);if(new Set(col).size!==col.length) fail();}
  }
  if(!['men','women'].includes(input.cavalry.division)) fail(); s.cavalry.division=input.cavalry.division;
  s.cavalry.cap=num(input.cavalry.cap,2700,1); s.cavalry.rule=text(input.cavalry.rule,1200);
  for(const division of ['men','women']) {
    const d=input.cavalry.divisions[division];const counts=list(d.counts,5).map(v=>num(v,100));const active=ids(d.active),eliminated=ids(d.eliminated),started=bool(d.started);
    if(eliminated.some(id=>!active.includes(id))||eliminated.length>Math.max(0,active.length-1)||(!started&&eliminated.length)||(started&&active.length<2))fail();
    s.cavalry.divisions[division]={counts,active,eliminated,started};
  }
  for(const g of GAME_IDS){const p=input.placements[g];if(!p && ['borrow','basket','relay'].includes(g))continue;s.placements[g]={rule:text(p.rule,1200),values:list(p.values,5).map(v=>num(v,5,1))};const filled=s.placements[g].values.filter(v=>v!==null);if(new Set(filled).size!==filled.length)fail();}
  if(!input.notes||typeof input.notes!=='object'||Array.isArray(input.notes))fail();
  for(const [key,value] of Object.entries(input.notes)){if(!/^\d{1,2}$/.test(key)||Number(key)>14)fail();s.notes[key]=text(value,2000);}
  s.timers = validateClocks(input.timers);
  if(input.finished!==undefined){if(!Array.isArray(input.finished)||input.finished.length>10||new Set(input.finished).size!==input.finished.length)fail();s.finished=input.finished.map(key=>{if(typeof key!=='string'||!/^basket:(red|blue|yellow|green|white):[01]$/.test(key))fail();const [,id,r]=key.split(':');if(s.basket.scores[TEAM_IDS.indexOf(id)][Number(r)]===null)fail();return key;});}
  if(input.activeKey!==undefined&&input.activeKey!==null&&typeof input.activeKey!=='string')fail();
  s.activeKey=input.activeKey&&s.timers[input.activeKey]?input.activeKey:null;
  return s;
}
