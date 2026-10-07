import { TEAM_IDS, matchTeams } from './model.js?v=24';
import { EVENT_GAMES, GAME_EVENTS, GAME_NAMES } from './content.js?v=24';
import { MATCH_KEYS, MATCH_NAMES, makeClock, remainingMs, pauseClock, startClock, addTime, resetClock, formatTime } from './timer-model.js?v=24';
import { roundDone, gameDone, timerStarted, recordSuccess, eliminate, cavalryPoints, setBasketScore, finishBasketAttempt, resetRound, resetGame } from './rounds.js?v=24';
import { createTimerPopup } from './timer-popup.js?v=24';
import { captureView } from './view-state.js?v=24';

export function createLiveDesk(api) {
  const {getState,schedule,esc,dot,teamLabel,save,refresh,toast,recordWinner}=api;
  const canEdit=()=>api.canEdit?.()??true;
  const now=()=>api.now?.()??Date.now();
  const timeLeft=clock=>remainingMs(clock,now());
  const choices={},overlay=document.querySelector('#live-dialog');
  let overlayEvent=null,overlayOpener=null,sound=false,audio=null;
  const popup=createTimerPopup({onHide:()=>toast('Timer hidden. The clock keeps running; open the game to see it.')});
  const name=id=>getState().teams.find(t=>t.id===id)?.name||'TBD';
  const ready=k=>getState().tug.locked&&matchTeams(getState().tug,k).every(Boolean);
  function context(index) {
    const s=getState(),game=EVENT_GAMES[index];
    choices[index] ||= {round:0,team:'red',attempt:0,division:s.cavalry.division,match:MATCH_KEYS.find(k=>ready(k)&&!s.tug.winners[k])||'prelim'};
    const ch=choices[index],base={game,eventIndex:index,signature:'',ready:true};let ctx;
    if(game==='tug'){const pair=matchTeams(s.tug,ch.match);ctx={key:'tug:'+ch.match,seconds:60,title:MATCH_NAMES[ch.match],teams:pair,match:ch.match,ready:ready(ch.match),signature:pair.join('|'),hint:'60-second limit · tied pull: use a 30s rematch'};}
    else if(game==='borrow'){ch.round=Math.min(ch.round,s.borrow.rounds-1);ctx={key:'borrow:'+ch.round,seconds:[90,90,120,120,120,120,90][ch.round],title:`Round ${ch.round+1} · ${['Easy','Easy','Medium','Borrow-a-Person','Medium','Funny / Chaos','Contingency'][ch.round]}`,round:ch.round,teams:TEAM_IDS,hint:'Success order: 5 / 4 / 3 / 2 / 2 · fail: 0'};}
    else if(game==='basket')ctx={key:`basket:${ch.team}:${ch.attempt}`,seconds:30,title:`${name(ch.team)} · attempt ${ch.attempt+1} / 2`,team:ch.team,round:ch.attempt,teams:[ch.team],hint:'Count balls, then finish attempt · best of two counts'};
    else if(game==='relay')ctx={key:'relay:'+ch.round,seconds:[480,600,480][ch.round],title:['Baton Relay','Three-Legged Relay','Spoon & Ball Relay'][ch.round],round:ch.round,teams:TEAM_IDS,hint:'Tap Finish in arrival order · places convert to 5 / 4 / 3 / 2 / 1'};
    else if(game==='cavalry'){const division=ch.division,d=s.cavalry.divisions[division];ctx={key:'cavalry:'+division,seconds:s.cavalry.cap||300,title:division==='women'?'Round 1 · Women':'Round 2 · Men',division,teams:d.active,ready:d.active.length>=2,signature:d.active.join('|'),hint:'Select teams → play → tap each horse as it goes out. Last horse wins.'};}
    else ctx={key:'event:'+index,seconds:schedule[index].durationMinutes*60,title:schedule[index].title,teams:[],ready:schedule[index].durationMinutes>0,hint:'Event allocation · adjust as needed'};
    return {...base,...ctx,done:roundDone(s,ctx.key),complete:game?gameDone(s,game):false};
  }
  function clockFor(ctx){
    const s=getState(),existing=s.timers[ctx.key];
    if(existing?.signature===ctx.signature)return existing;
    const clock=makeClock(ctx.seconds,ctx.signature);
    if(canEdit())s.timers[ctx.key]=clock;
    return clock;
  }
  function roundButtons(ctx){
    const s=getState(),ch=choices[ctx.eventIndex];let items=[],field='round',selected=ch.round;
    if(ctx.game==='tug'){field='match';selected=ch.match;items=MATCH_KEYS.map((k,i)=>({value:k,label:String(i+1),title:MATCH_NAMES[k],key:'tug:'+k}));}
    else if(ctx.game==='basket'){field='attempt';selected=ch.attempt;items=[0,1].map(i=>({value:i,label:String(i+1),title:'Attempt '+(i+1),key:`basket:${ch.team}:${i}`}));}
    else if(ctx.game==='cavalry'){field='division';selected=ctx.division;items=['women','men'].map((d,i)=>({value:d,label:String(i+1),title:d==='women'?'Women':'Men',key:'cavalry:'+d}));}
    else if(['borrow','relay'].includes(ctx.game))items=Array.from({length:ctx.game==='borrow'?s.borrow.rounds:3},(_,i)=>({value:i,label:String(i+1),title:'Round '+(i+1),key:ctx.game+':'+i}));
    return items.length?`<nav class="round-strip" aria-label="${ctx.game==='basket'?'Attempts':'Rounds'}"><span>${ctx.game==='basket'?'ATTEMPT':ctx.game==='tug'?'MATCH':'ROUND'}</span>${items.map(i=>`<button class="round-button ${selected===i.value?'selected':''} ${roundDone(s,i.key)?'done':''} ${s.timers[i.key]?.deadline&&timeLeft(s.timers[i.key])>0?'running':''}" data-live-choice="${field}" data-value="${i.value}" aria-pressed="${selected===i.value}" aria-label="${i.title}${roundDone(s,i.key)?', completed':''}" title="${i.title}">${i.label}${roundDone(s,i.key)?'<small>✓</small>':''}</button>`).join('')}</nav>`:'';
  }
  function rounds(index){return `<div data-live-event="${index}">${roundButtons(context(index))}</div>`;}
  function teamChoices(ctx){
    if(!['basket','cavalry'].includes(ctx.game))return '';
    const s=getState(),d=ctx.game==='cavalry'?s.cavalry.divisions[ctx.division]:null;
    return `<div class="team-choices" ${ctx.game==='basket'?'role="group" aria-label="Choose team"':'role="group" aria-label="Teams in arena"'}>${TEAM_IDS.map(id=>{const selected=ctx.game==='basket'?ctx.team===id:d.active.includes(id);return `<button class="team-choice ${selected?'selected':''}" data-live-team="${id}" aria-label="${esc(name(id))}" aria-pressed="${selected}" ${ctx.game==='cavalry'&&(d.started||!canEdit())?'disabled':''}>${dot(id)}<span class="team-choice-name">${esc(name(id))}</span>${selected?'<span class="team-choice-check" aria-hidden="true">✓</span>':''}</button>`;}).join('')}</div>`;
  }
  function matchup(ctx){
    if(ctx.game==='tug')return `<div class="live-matchup">${ctx.teams.map((id,i)=>`${i?'<span class="versus">VS</span>':''}<div class="live-team">${id?dot(id):'<span class="dot unknown"></span>'}<strong>${esc(name(id))}</strong></div>`).join('')}</div>`;
    return ctx.game!=='cavalry'?`<div class="live-teams">${ctx.teams.map(teamLabel).join('')}</div>`:'';
  }
  function results(ctx){
    const s=getState(),canScore=canEdit()&&timerStarted(s,ctx.key)&&!ctx.done&&!ctx.complete,disabled=canScore?'':'disabled';
    if(ctx.game==='tug')return `<div class="section-label">WHO WON? <span class="badge">${ctx.done?'Locked · saved':!canEdit()?'Viewing scores':'Tap winner to save'}</span></div><div class="winner-choices">${ctx.teams.map(id=>`<button class="winner-choice ${s.tug.winners[ctx.match]===id&&id?'selected':''}" data-live-winner="${id||''}" ${!ctx.ready||!canScore?'disabled':''}>${id?dot(id):''}${esc(name(id))}${s.tug.winners[ctx.match]===id&&id?' ✓':''}</button>`).join('')}</div>${!ctx.ready?'<button class="primary" data-live-action="bracket">View bracket →</button>':''}`;
    if(ctx.game==='borrow'||ctx.game==='relay')return `<div class="section-label">${ctx.game==='borrow'?'SUCCESS / FAIL':'FINISH ORDER'} <span class="badge">${ctx.done?'Locked · saved':!canEdit()?'Viewing scores':'Tap in order'}</span></div><div class="arrival-list">${TEAM_IDS.map((id,i)=>{const value=s[ctx.game].scores[i][ctx.round];return `<div class="arrival-row ${value!==null?'recorded':''}">${teamLabel(id)}<div class="arrival-actions">${value===null?`<button class="success-button" data-live-arrival="${id}" ${disabled}>${ctx.game==='borrow'?'Success':'Finish'}</button>${ctx.game==='borrow'?`<button class="fail-button" data-live-fail="${id}" ${disabled}>Fail</button>`:''}`:`<strong>${ctx.game==='borrow'?(value===0?'Fail · 0':value+' pts'):'#'+value+' · '+(6-value)+' pts'} ✓</strong>`}</div></div>`;}).join('')}</div>`;
    if(ctx.game==='basket')return `<div class="section-label">SUCCESSFUL BALLS <span class="badge">${ctx.done?'Locked · saved':!canEdit()?'Viewing scores':'Auto-save'}</span></div><div class="ball-counter"><button class="secondary" data-live-action="minus-ball" aria-label="Remove one ball" ${disabled}>−</button><input aria-label="Successful balls" type="number" inputmode="numeric" min="0" max="999" step="1" value="${s.basket.scores[TEAM_IDS.indexOf(ctx.team)][ctx.round]??0}" data-live-score ${disabled}><button class="primary" data-live-action="plus-ball" aria-label="Add one ball" ${disabled}>+</button></div><button class="primary finish-attempt" data-live-action="finish" ${disabled}>${ctx.done?'Attempt complete ✓':'Finish attempt & lock'}</button>`;
    if(ctx.game==='cavalry'){
      const d=s.cavalry.divisions[ctx.division],left=d.active.filter(id=>!d.eliminated.includes(id)),pts=cavalryPoints(s,ctx.division);
      return `<div class="section-label">${ctx.done?'ROUND RESULTS':'ELIMINATION ORDER'} <span class="badge">${ctx.done?'Locked · saved':d.eliminated.length+' out'}</span></div>${!d.started?`<p class="help">${canEdit()?'Choose at least two teams above. Press Play to open the arena.':'Waiting for the scorekeeper to start the arena.'}</p>`:`<div class="arena-order">${[...d.eliminated,...left].map(id=>`<div class="arrival-row">${teamLabel(id)}${ctx.done?`<strong>${pts[TEAM_IDS.indexOf(id)]} pts${left.includes(id)?' · winner':''}</strong>`:d.eliminated.includes(id)?`<span>Out #${d.eliminated.indexOf(id)+1}</span>`:`<button class="fail-button" data-live-eliminate="${id}" ${disabled}>Horse out</button>`}</div>`).join('')}</div>`}<p class="help">Last → first out: 5 / 4 / 3 / 2 / 1 points. Teams outside the arena receive 0. Two rounds are added.</p>`;
    }
    return '';
  }
  function view(index,big=false){
    const ctx=context(index),c=clockFor(ctx),ms=timeLeft(c),running=c.deadline!==null&&ms>0,started=timerStarted(getState(),ctx.key),editable=canEdit();
    const blocked=condition=>!editable||condition?'disabled':'';
    const markup=`<div class="live-desk ${big?'is-big':''} ${ctx.complete?'game-completed':ctx.done?'round-completed':''}" data-live-event="${index}" data-live-key="${ctx.key}">${roundButtons(ctx)}${teamChoices(ctx)}<div class="match-workspace"><section class="live-stage ${running?'is-running':''}"><span class="eyebrow">${esc(ctx.title)}</span>${matchup(ctx)}<output class="clock-digits ${ms===0?'expired':''}" data-clock-digits role="timer" aria-label="Time remaining">${formatTime(ms)}</output><span class="clock-status" data-clock-status>${ctx.complete?'Game complete':ctx.done?'Round complete':running?'LIVE':ms===0?'Time up':started?'Paused':'Ready'}</span><div class="clock-controls"><button class="primary" data-live-action="toggle" ${blocked(!ctx.ready||ms===0||ctx.done)}>${running?'Ⅱ Pause':'▶ Play'}</button><button class="secondary" data-live-action="add" ${blocked(ctx.done)}>+30s</button>${ctx.game==='tug'?`<button class="secondary" data-live-action="rematch" ${blocked(ctx.done)}>30s rematch</button>`:''}</div><details class="clock-options"><summary>Timer settings</summary><div class="clock-settings"><label class="field">Limit (seconds)<input type="number" min="1" max="${ctx.game==='cavalry'?2700:86400}" step="1" inputmode="numeric" data-live-limit value="${c.duration/1000}" ${blocked(running||ctx.done)}></label><label class="checkbox"><input type="checkbox" data-live-sound ${sound?'checked':''} ${blocked(false)}> End sound</label></div><button class="text-button" data-live-action="reset-clock" ${blocked(ctx.done)}>Reset timer only</button></details><p class="help">${esc(editable?ctx.hint:'Follow the timer and results as the scorekeeper updates them.')}</p></section>${ctx.game?`<section class="live-result">${results(ctx)}<p class="live-save-message" data-live-status role="status">${!editable?'Viewing live scores. Only the scorekeeper can record results.':!api.saved()?'Storage unavailable — export a backup to keep these results.':ctx.complete?'Game complete. Points added to the main Scores overview.':ctx.done?'Round saved. Reset this round to edit.':!started?'Press Play to unlock scoring.':'Results save as you tap. All rounds must finish for overall points.'}</p>${ctx.complete?'<button class="primary" data-live-action="overview">Main Scores →</button>':ctx.done?'<button class="primary" data-live-action="next">Next →</button>':''}</section>`:''}</div><div class="live-bottom-actions">${!big?'<button class="secondary" data-live-action="expand">Big screen ↗</button>':''}${ctx.game?'<button class="text-button" data-live-action="sheet">Score sheet →</button>':''}<details class="reset-menu"><summary>Reset…</summary><button class="text-button" data-live-action="reset-round" ${blocked(false)}>Reset ${ctx.game==='basket'?'attempt':ctx.game==='tug'?'match':'round'}</button>${ctx.game?'<button class="text-button" data-live-action="reset-game" ${blocked(false)}>Reset whole game</button>':''}</details></div></div>`;
    return big?markup.replaceAll(' · ',' — '):markup;
  }
  function renderOverlay(){if(overlayEvent===null)return;const restoreView=captureView(overlay,overlay.dataset.viewKey);document.querySelector('#live-title').textContent=GAME_NAMES[EVENT_GAMES[overlayEvent]]||schedule[overlayEvent].title;document.querySelector('#live-body').innerHTML=view(overlayEvent,true);overlay.dataset.viewKey=String(overlayEvent);restoreView(overlay.dataset.viewKey);}
  function open(index,match){context(index);if(match)choices[index].match=match;if(!overlay.open){overlayOpener=document.activeElement;popup.resetOverlay();}overlayEvent=index;renderOverlay();if(!overlay.open)overlay.showModal();document.querySelector('#close-live').focus();}
  function refreshViews(){refresh();if(overlay.open)renderOverlay();tick();}
  function showReadyClock(ctx,c){
    document.querySelectorAll(`[data-live-key="${ctx.key}"]`).forEach(desk=>{
      desk.querySelector('[data-clock-status]').textContent='Ready';
      desk.querySelector('[data-live-limit]').value=c.duration/1000;
      desk.querySelector('[data-live-action="toggle"]').disabled=!ctx.ready||timeLeft(c)===0;
      desk.querySelectorAll('[data-live-winner],[data-live-arrival],[data-live-fail],[data-live-eliminate],[data-live-score],[data-live-action="plus-ball"],[data-live-action="minus-ball"],[data-live-action="finish"]').forEach(control=>control.disabled=true);
      const status=desk.querySelector('[data-live-status]');if(status)status.textContent='Press Play to unlock scoring.';
    });
    tick();
  }
  function beep(){if(!sound||!audio)return;try{const o=audio.createOscillator(),g=audio.createGain();o.connect(g);g.connect(audio.destination);o.frequency.value=880;g.gain.setValueAtTime(.15,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.7);o.start();o.stop(audio.currentTime+.7);}catch{}}
  function armAudio(){if(!sound)return;try{audio ||= new(window.AudioContext||window.webkitAudioContext)();audio.resume();}catch{}}
  function selectKey(key){const parts=key.split(':'),index=parts[0]==='event'?Number(parts[1]):GAME_EVENTS[parts[0]];context(index);const ch=choices[index];if(parts[0]==='tug')ch.match=parts[1];if(['borrow','relay'].includes(parts[0]))ch.round=Number(parts[1]);if(parts[0]==='basket'){ch.team=parts[1];ch.attempt=Number(parts[2]);}if(parts[0]==='cavalry')ch.division=parts[1];return index;}
  function resume(index){const s=getState(),entry=Object.entries(s.timers).find(([key,c])=>key.startsWith(EVENT_GAMES[index]+':')&&(c.deadline!==null||key===s.activeKey));if(entry&&!roundDone(s,entry[0]))selectKey(entry[0]);}
  function next(ctx){
    const s=getState(),ch=choices[ctx.eventIndex];
    if(ctx.game==='tug'){ch.match=MATCH_KEYS.find(k=>ready(k)&&!s.tug.winners[k])||ctx.match;}
    else if(ctx.game==='basket'){const key=TEAM_IDS.flatMap(id=>[0,1].map(i=>`basket:${id}:${i}`)).find(k=>!roundDone(s,k));if(key)selectKey(key);else toast('All attempts completed.');}
    else if(ctx.game==='cavalry')ch.division=ctx.division==='women'?'men':'women';
    else if(['borrow','relay'].includes(ctx.game))ch.round=Math.min(ch.round+1,(ctx.game==='borrow'?s.borrow.rounds:3)-1);
    refreshViews();
  }
  document.addEventListener('click',async e=>{
    const launch=e.target.closest('[data-live-match]');if(launch){open(8,launch.dataset.liveMatch);return;}
    const control=e.target.closest('[data-live-choice],[data-live-team],[data-live-action],[data-live-winner],[data-live-arrival],[data-live-fail],[data-live-eliminate]');if(!control||control.disabled)return;
    const desk=control.closest('[data-live-event]');if(!desk)return;
    const ctx=context(Number(desk.dataset.liveEvent)),c=clockFor(ctx),s=getState();
    try{
      if(control.dataset.liveChoice){const field=control.dataset.liveChoice,value=control.dataset.value;choices[ctx.eventIndex][field]=['round','attempt'].includes(field)?Number(value):value;refreshViews();return;}
      if(control.dataset.liveTeam){
        const id=control.dataset.liveTeam;
        if(ctx.game==='basket'){choices[ctx.eventIndex].team=id;refreshViews();return;}
        if(!canEdit())return;
        const d=s.cavalry.divisions[ctx.division];if(d.started)return;
        d.active=d.active.includes(id)?d.active.filter(t=>t!==id):TEAM_IDS.filter(t=>t===id||d.active.includes(t));
        save();refreshViews();return;
      }
      const action=control.dataset.liveAction;
      if(action==='expand'){open(ctx.eventIndex);return;}
      if(action==='overview'){if(overlay.open)overlay.close();api.openPanel('results');return;}
      if(action==='sheet'||action==='bracket'){if(overlay.open)overlay.close();api.openPanel('event:'+ctx.eventIndex,action==='sheet'?'scores':'play');return;}
      if(action==='next'){next(ctx);return;}
      if(!canEdit())return;
      if(action==='reset-round'||action==='reset-game'){
        if(!await api.confirmChange(action==='reset-game'?'Reset this game’s scores, timers and setup? Other games and team names stay.':ctx.game==='tug'?'Reset this match and any dependent later matches?':'Reset this round’s scores and timer?'))return;
        if(!canEdit())return;
        action==='reset-game'?resetGame(s,ctx.game):resetRound(s,ctx.key);if(action==='reset-game')delete choices[ctx.eventIndex];save();refreshViews();return;
      }
      if(ctx.done||ctx.complete)return;
      const scoring=control.dataset.liveWinner||control.dataset.liveArrival||control.dataset.liveFail||control.dataset.liveEliminate||['plus-ball','minus-ball','finish'].includes(action);
      if(scoring&&!timerStarted(s,ctx.key)){toast('Press Play before recording results.');return;}
      if(control.dataset.liveWinner){await recordWinner(ctx.match,control.dataset.liveWinner);if(!canEdit())return;}
      else if(control.dataset.liveArrival||control.dataset.liveFail){recordSuccess(s,ctx.game,ctx.round,control.dataset.liveArrival||control.dataset.liveFail,!control.dataset.liveFail);}
      else if(control.dataset.liveEliminate){eliminate(s,ctx.division,control.dataset.liveEliminate);}
      else switch(action){
        case 'toggle':if(c.deadline!==null)pauseClock(c,now());else if(ctx.ready){armAudio();if(startClock(s.timers,ctx.key,now())){s.activeKey=ctx.key;if(ctx.game==='cavalry')s.cavalry.divisions[ctx.division].started=true;}}popup.reveal();break;
        case 'add':addTime(c,30,now());break;
        case 'reset-clock':resetClock(c);if(s.activeKey===ctx.key)s.activeKey=null;break;
        case 'rematch':resetClock(c,30);if(s.activeKey===ctx.key)s.activeKey=null;break;
        case 'plus-ball':case 'minus-ball':{const value=s.basket.scores[TEAM_IDS.indexOf(ctx.team)][ctx.round]||0;setBasketScore(s,ctx.team,ctx.round,Math.max(0,Math.min(999,value+(action==='plus-ball'?1:-1))));break;}
        case 'finish':{const input=desk.querySelector('[data-live-score]');if(!input.validity.valid||input.value===''){toast('Enter a valid ball count.');return;}setBasketScore(s,ctx.team,ctx.round,Number(input.value));finishBasketAttempt(s,ctx.team,ctx.round);break;}
      }
      if(roundDone(s,ctx.key)){pauseClock(c,now());if(s.activeKey===ctx.key)s.activeKey=null;}
      save();refreshViews();
    }catch(error){toast(error.message);}
  });
  document.addEventListener('change',e=>{
    const el=e.target,desk=el.closest('[data-live-event]');if(!desk||!canEdit())return;
    const ctx=context(Number(desk.dataset.liveEvent)),c=clockFor(ctx),s=getState();
    if(el.matches('[data-live-sound]')){sound=el.checked;armAudio();return;}
    if(ctx.done||ctx.complete)return;
    if(el.matches('[data-live-limit]')){
      if(c.deadline!==null||!el.validity.valid||el.value===''){el.value=c.duration/1000;toast('Enter a valid whole-second limit while paused.');return;}
      resetClock(c,Number(el.value));if(s.activeKey===ctx.key)s.activeKey=null;if(ctx.game==='cavalry')s.cavalry.cap=Number(el.value);save();showReadyClock(ctx,c);
    }else if(el.matches('[data-live-score]')){
      if(!timerStarted(s,ctx.key)||!el.validity.valid||el.value===''){el.value=s.basket.scores[TEAM_IDS.indexOf(ctx.team)][ctx.round]??0;return;}
      setBasketScore(s,ctx.team,ctx.round,Number(el.value));save();desk.querySelector('[data-live-status]').textContent=api.saved()?'Saved to the game score sheet.':'Storage unavailable — export a backup.';
    }
  });
  document.addEventListener('input',e=>{
    const el=e.target,desk=el.closest('[data-live-event]');
    if(!desk||!canEdit()||!el.matches('[data-live-score]'))return;
    const ctx=context(Number(desk.dataset.liveEvent)),s=getState();
    if(ctx.done||ctx.complete||!timerStarted(s,ctx.key)||!el.validity.valid||el.value==='')return;
    setBasketScore(s,ctx.team,ctx.round,Number(el.value));save();
    document.querySelectorAll(`[data-live-key="${ctx.key}"] [data-live-score]`).forEach(peer=>{if(peer!==el)peer.value=el.value;});
    desk.querySelector('[data-live-status]').textContent=api.saved()?'Saved to the game score sheet.':'Storage unavailable — export a backup.';
  });
  function describe(key){const [g,p,a]=key.split(':'),s=getState();if(g==='tug')return matchTeams(s.tug,p).map(name).join(' vs ');if(g==='basket')return `${name(p)} — attempt ${Number(a)+1}`;if(g==='cavalry')return s.cavalry.divisions[p].active.filter(id=>!s.cavalry.divisions[p].eliminated.includes(id)).map(name).join(' vs ');return g==='event'?schedule[Number(p)].title:`All teams — round ${Number(p)+1}`;}
  function tick(){
    const s=getState();let changed=false;
    if(canEdit())for(const c of Object.values(s.timers))if(c.deadline!==null&&timeLeft(c)===0){pauseClock(c,now());changed=true;beep();}
    if(changed){save();refresh();if(overlay.open)renderOverlay();toast('Time up. Record the remaining results.');}
    document.querySelectorAll('[data-live-key]').forEach(desk=>{
      const c=s.timers[desk.dataset.liveKey],display=desk.querySelector('[data-clock-digits]');if(!c||!display)return;
      const ms=timeLeft(c);display.textContent=formatTime(ms);display.classList.toggle('expired',ms===0);
      if(!canEdit()){
        const ctx=context(Number(desk.dataset.liveEvent)),status=desk.querySelector('[data-clock-status]');
        if(status)status.textContent=ctx.complete?'Game complete':ctx.done?'Round complete':ms===0?'Time up':c.deadline!==null?'LIVE':timerStarted(s,ctx.key)?'Paused':'Ready';
        desk.querySelector('.live-stage')?.classList.toggle('is-running',c.deadline!==null&&ms>0);
      }
    });
    const unfinished=key=>!roundDone(s,key)&&!gameDone(s,key.split(':')[0]);
    const active=Object.entries(s.timers).find(([key,c])=>c.deadline!==null&&unfinished(key))||(s.activeKey&&s.timers[s.activeKey]&&unfinished(s.activeKey)?[s.activeKey,s.timers[s.activeKey]]:null);
    const activeMs=active?timeLeft(active[1]):0;
    popup.update(active?.[0]||null,active?`${describe(active[0])} — ${formatTime(activeMs)}${activeMs===0?' — time up':active[1].deadline?'':' — paused'}`:'');
    document.querySelectorAll('.game-card').forEach(card=>{const game=EVENT_GAMES[Number(card.dataset.open.split(':')[1])],done=gameDone(s,game),running=!done&&active&&active[0].startsWith(game+':');card.disabled=done;card.classList.toggle('completed',done);card.classList.toggle('ongoing',Boolean(running));const bottom=card.querySelector('.game-bottom');bottom.dataset.pendingLabel ||= bottom.textContent;bottom.textContent=done?'Game complete ✓':bottom.dataset.pendingLabel;const badge=card.querySelector('.ongoing-status');if(badge){badge.hidden=!running;if(running)badge.textContent=`${activeMs===0?'TIME UP':active[1].deadline?'LIVE':'Ⅱ PAUSED'} — ${describe(active[0])} — ${formatTime(activeMs)}`;}});
    document.querySelectorAll('.schedule-row').forEach(row=>{const game=EVENT_GAMES[Number(row.dataset.open.split(':')[1])];row.classList.toggle('completed',Boolean(game&&gameDone(s,game)));});
    document.querySelectorAll('[data-match-card]').forEach(card=>card.classList.toggle('ongoing',Boolean(active&&active[0]==='tug:'+card.dataset.matchCard)));
  }
  document.querySelector('#active-timer').addEventListener('click',e=>{const index=selectKey(e.currentTarget.dataset.key);api.openPanel('event:'+index,'timer');if(matchMedia('(max-width:760px)').matches)open(index);});
  document.querySelector('#close-live').addEventListener('click',()=>overlay.close());
  overlay.addEventListener('close',()=>{overlayEvent=null;refresh();if(overlayOpener?.isConnected)overlayOpener.focus();else document.querySelector('#close-detail').focus();});
  document.addEventListener('visibilitychange',tick);setInterval(tick,200);
  return {panel:index=>view(index),rounds,open,tick,resume,refresh:refreshViews};
}
