import { TEAM_IDS, defaultState, setWinner, gameDone } from './model.js?v=20';
export { gameDone } from './model.js?v=20';

export function timerStarted(s,key) { return s.timers[key]?.started===true; }

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
  if (!['borrow','relay'].includes(game)||i<0||!Number.isInteger(round)||round<0||round>=(game==='borrow'?s.borrow.rounds:3)||!timerStarted(s,key)||gameDone(s,game)||roundDone(s,key)||s[game].scores[i][round]!==null) return false;
  // Older sheets allowed results to be entered out of order. Consume their
  // existing places so continuing a saved round never duplicates a relay place.
  const awards=game==='borrow'?[5,4,3,2,2]:[1,2,3,4,5];
  for(const row of s[game].scores){const used=awards.indexOf(row[round]);if(used!==-1)awards.splice(used,1);}
  s[game].scores[i][round]=game==='borrow'&&!success?0:awards[0];
  s.placements[game].values=Array(5).fill(null);
  return true;
}
export function eliminate(s, division, id) {
  const d=s.cavalry.divisions[division];
  if (!d||!d.started||!timerStarted(s,'cavalry:'+division)||gameDone(s,'cavalry')||roundDone(s,'cavalry:'+division)||!d.active.includes(id)||d.eliminated.includes(id)) return false;
  d.eliminated.push(id);s.placements.cavalry.values=Array(5).fill(null);return true;
}
export function recordWinner(s,match,id) {
  if(!timerStarted(s,'tug:'+match)||gameDone(s,'tug')||roundDone(s,'tug:'+match))return false;
  setWinner(s.tug,match,id);s.placements.tug.values=Array(5).fill(null);return true;
}
export function setBasketScore(s,id,attempt,value) {
  const i=TEAM_IDS.indexOf(id),key=`basket:${id}:${attempt}`;
  if(i<0||![0,1].includes(attempt)||!Number.isInteger(value)||value<0||value>999||!timerStarted(s,key)||gameDone(s,'basket')||roundDone(s,key))return false;
  s.basket.scores[i][attempt]=value;s.placements.basket.values=Array(5).fill(null);return true;
}
export function finishBasketAttempt(s,id,attempt) {
  const key=`basket:${id}:${attempt}`;
  if(!setBasketScore(s,id,attempt,s.basket.scores[TEAM_IDS.indexOf(id)]?.[attempt]??0))return false;
  s.finished.push(key);return true;
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
