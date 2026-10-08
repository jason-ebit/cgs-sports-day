import { TEAM_IDS, defaultState, setWinner, gameDone } from './model.js?v=30';
export { gameDone } from './model.js?v=30';

// Result journals belong to this browser session, never to the shared snapshot.
const resultRevisions = new WeakMap(), resultTokens = new WeakMap();
const resultRevision = s => resultRevisions.get(s) || 0;
const advanceResultRevision = s => resultRevisions.set(s, resultRevision(s) + 1);

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
  s[game].scores[i][round]=nextAward(s,game,round,success);
  s.placements[game].values=Array(5).fill(null);
  advanceResultRevision(s);
  return true;
}
function nextAward(s,game,round,success) {
  if(game==='borrow'&&!success)return 0;
  const awards=game==='borrow'?[5,4,3,2,2]:[1,2,3,4,5];
  for(const row of s[game].scores){const used=awards.indexOf(row[round]);if(used!==-1)awards.splice(used,1);}
  return awards[0];
}
export function eliminate(s, division, id) {
  const d=s.cavalry.divisions[division];
  if (!d||!d.started||!timerStarted(s,'cavalry:'+division)||gameDone(s,'cavalry')||roundDone(s,'cavalry:'+division)||!d.active.includes(id)||d.eliminated.includes(id)) return false;
  d.eliminated.push(id);s.placements.cavalry.values=Array(5).fill(null);advanceResultRevision(s);return true;
}
function resultSnapshot(s,key) {
  const [game,part]=key.split(':');
  if(['borrow','relay'].includes(game)&&/^(?:[0-6])$/.test(part)) {
    const round=Number(part),count=game==='borrow'?s.borrow.rounds:3;
    if(round>=count)return null;
    return {scores:s[game].scores.map(row=>row[round]),rounds:count};
  }
  if(game==='cavalry'&&['women','men'].includes(part)) {
    const d=s.cavalry.divisions[part];
    return {active:[...d.active],eliminated:[...d.eliminated],started:d.started};
  }
  return null;
}
// Capture before the tap; retain the token only when the result was accepted.
export function captureResultToken(s,key,id,success=true) {
  if(typeof key!=='string'||!/^(borrow:[0-6]|relay:[0-2]|cavalry:(women|men))$/.test(key)||!TEAM_IDS.includes(id)||typeof success!=='boolean')return null;
  const before=resultSnapshot(s,key),[game,part]=key.split(':'),i=TEAM_IDS.indexOf(id);
  if(!before||!timerStarted(s,key)||gameDone(s,game)||roundDone(s,key))return null;
  const after=JSON.parse(JSON.stringify(before));
  if(game==='cavalry') {
    if(!before.started||!before.active.includes(id)||before.eliminated.includes(id))return null;
    after.eliminated.push(id);
  } else {
    if(before.scores[i]!==null)return null;
    after.scores[i]=nextAward(s,game,Number(part),success);
  }
  const token=Object.freeze({key,teamId:id});
  resultTokens.set(token,{source:s,revision:resultRevision(s)+1,before,after:JSON.stringify(after),used:false});
  return token;
}
export function canUndoResult(s,token) {
  const journal=token&&resultTokens.get(token);
  if(!journal||journal.used||resultRevision(journal.source)!==journal.revision)return false;
  // A structurally unchanged server acknowledgement may replace the state.
  // A later local result on that replacement must still invalidate this token.
  if(s!==journal.source&&resultRevision(s)!==0)return false;
  const [game]=token.key.split(':'),snapshot=resultSnapshot(s,token.key);
  return Boolean(snapshot&&timerStarted(s,token.key)&&!gameDone(s,game)&&!roundDone(s,token.key)&&JSON.stringify(snapshot)===journal.after);
}
export function undoResult(s,token) {
  if(!canUndoResult(s,token))return false;
  const journal=resultTokens.get(token),[game,part]=token.key.split(':');
  if(game==='cavalry')s.cavalry.divisions[part].eliminated=[...journal.before.eliminated];
  else s[game].scores[TEAM_IDS.indexOf(token.teamId)][Number(part)]=journal.before.scores[TEAM_IDS.indexOf(token.teamId)];
  s.placements[game].values=Array(5).fill(null);
  journal.used=true;advanceResultRevision(s);
  return true;
}
export function recordWinner(s,match,id) {
  if(!timerStarted(s,'tug:'+match)||gameDone(s,'tug')||roundDone(s,'tug:'+match))return false;
  setWinner(s.tug,match,id);s.placements.tug.values=Array(5).fill(null);advanceResultRevision(s);return true;
}
export function setBasketScore(s,id,attempt,value) {
  const i=TEAM_IDS.indexOf(id),key=`basket:${id}:${attempt}`;
  if(i<0||![0,1].includes(attempt)||!Number.isInteger(value)||value<0||value>999||!timerStarted(s,key)||gameDone(s,'basket')||roundDone(s,key))return false;
  s.basket.scores[i][attempt]=value;s.placements.basket.values=Array(5).fill(null);advanceResultRevision(s);return true;
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
  advanceResultRevision(s);
}
export function resetGame(s,game) {
  const fresh=defaultState();s[game]=fresh[game];s.placements[game]=fresh.placements[game];
  Object.keys(s.timers).filter(k=>k.startsWith(game+':')).forEach(k=>delete s.timers[k]);
  s.finished=s.finished.filter(k=>!k.startsWith(game+':'));if(s.activeKey?.startsWith(game+':'))s.activeKey=null;
  advanceResultRevision(s);
}
