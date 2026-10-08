import { TEAM_IDS, GAME_IDS, gameDone, matchTeams, validSlots } from './model.js?v=31';
import { MATCH_KEYS, MATCH_NAMES, TIMER_KEY } from './timer-model.js?v=31';
import { roundDone } from './rounds.js?v=31';

function orderedKeys(state,game) {
  if(game==='borrow')return Array.from({length:state.borrow.rounds},(_,i)=>`borrow:${i}`);
  if(game==='relay')return ['relay:0','relay:1','relay:2'];
  if(game==='basket')return TEAM_IDS.flatMap(id=>[0,1].map(i=>`basket:${id}:${i}`));
  if(game==='cavalry')return ['cavalry:women','cavalry:men'];
  if(game==='tug')return MATCH_KEYS.map(match=>`tug:${match}`);
  return [];
}
function readyKey(state,key) {
  const [game,part]=key.split(':');
  if(game!=='tug')return true;
  return state.tug.locked&&validSlots(state.tug.slots)&&matchTeams(state.tug,part).every(Boolean);
}
export function nextIncompleteKey(state,currentKey) {
  if(typeof currentKey!=='string')return null;
  const game=currentKey.split(':')[0];
  if(!GAME_IDS.includes(game)||gameDone(state,game))return null;
  const keys=orderedKeys(state,game),start=keys.indexOf(currentKey);
  for(let offset=1;offset<=keys.length;offset++) {
    const key=keys[(start+offset)%keys.length];
    if(readyKey(state,key)&&!roundDone(state,key))return key;
  }
  return null;
}
export function nextTarget(state,currentKey) {
  const key=nextIncompleteKey(state,currentKey);
  if(!key)return null;
  const [game,part,attempt]=key.split(':');let label;
  if(game==='basket')label=`${state.teams.find(team=>team.id===part)?.name||part} · attempt ${Number(attempt)+1}`;
  else if(game==='tug')label=MATCH_NAMES[part];
  else if(game==='cavalry')label=part==='women'?'Round 1 · Women':'Round 2 · Men';
  else label=`Round ${Number(part)+1}`;
  return {key,label};
}
function activeCandidate(state,key,clock) {
  if(!clock?.started||!TIMER_KEY.test(key))return false;
  const [game]=key.split(':');
  if(game==='event')return true;
  if(!orderedKeys(state,game).includes(key)||gameDone(state,game)||!readyKey(state,key)||roundDone(state,key))return false;
  return true;
}
export function activeRoundKey(state) {
  const entries=Object.entries(state.timers);
  const running=entries.find(([key,clock])=>clock.deadline!==null&&activeCandidate(state,key,clock));
  if(running)return running[0];
  const key=state.activeKey;
  return typeof key==='string'&&activeCandidate(state,key,state.timers[key])?key:null;
}
