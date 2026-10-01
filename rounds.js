import { TEAM_IDS, defaultState, matchTeams } from './model.js?v=3';
import { MATCH_KEYS } from './timer-model.js?v=3';

export function roundDone(s, key) {
  const [game, part, attempt] = key.split(':');
  if (game === 'tug') return Boolean(s.tug.winners[part]);
  if (game === 'cavalry') { const d=s.cavalry.divisions[part];return d.started && d.active.length-d.eliminated.length===1; }
  if (game === 'basket') return s.finished.includes(key);
  if (['borrow','relay'].includes(game)) return s[game].scores.every(row=>row[Number(part)]!==null);
  return false;
}
export function recordSuccess(s, game, round, id, success=true) {
  const key=`${game}:${round}`, i=TEAM_IDS.indexOf(id);
  if (!['borrow','relay'].includes(game)||i<0||roundDone(s,key)||s[game].scores[i][round]!==null) return false;
  const recorded=s[game].scores.map(r=>r[round]).filter(n=>n!==null && n>0).length;
  s[game].scores[i][round]=game==='borrow'?(success?[5,4,3,2,2][recorded]:0):recorded+1;
  s.placements[game].values=Array(5).fill(null);
  return true;
}
export function eliminate(s, division, id) {
  const d=s.cavalry.divisions[division];
  if (!d.started||roundDone(s,'cavalry:'+division)||!d.active.includes(id)||d.eliminated.includes(id)) return false;
  d.eliminated.push(id);s.placements.cavalry.values=Array(5).fill(null);return true;
}
export function cavalryPoints(s, division) {
  const d=s.cavalry.divisions[division];
  if (!roundDone(s,'cavalry:'+division)) return TEAM_IDS.map(()=>null);
  const order=[...d.eliminated,...d.active.filter(id=>!d.eliminated.includes(id))].reverse();
  return TEAM_IDS.map(id=>order.includes(id)?5-order.indexOf(id):0);
}
export function resetRound(s,key) {
  const [game,part,attempt]=key.split(':');
  const keys=[key];
  if(game==='tug') {
    if(part==='prelim')keys.push('tug:semi1','tug:final');
    if(['semi1','semi2'].includes(part))keys.push('tug:final');
    keys.forEach(k=>{s.tug.winners[k.split(':')[1]]=null;});
  } else if(game==='cavalry') {const d=s.cavalry.divisions[part];d.started=false;d.eliminated=[];}
  else if(game==='basket') s.basket.scores[TEAM_IDS.indexOf(part)][Number(attempt)]=null;
  else if(['borrow','relay'].includes(game)) s[game].scores.forEach(row=>row[Number(part)]=null);
  keys.forEach(k=>delete s.timers[k]);if(keys.includes(s.activeKey))s.activeKey=null;s.finished=s.finished.filter(k=>!keys.includes(k));
  if(s.placements[game])s.placements[game].values=Array(5).fill(null);
}
export function resetGame(s,game) {
  const fresh=defaultState();s[game]=fresh[game];s.placements[game]=fresh.placements[game];
  Object.keys(s.timers).filter(k=>k.startsWith(game+':')).forEach(k=>delete s.timers[k]);
  s.finished=s.finished.filter(k=>!k.startsWith(game+':'));if(s.activeKey?.startsWith(game+':'))s.activeKey=null;
}
