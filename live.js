import { TEAM_IDS, matchTeams } from './model.js?v=27';
import { EVENT_GAMES, GAME_EVENTS, GAME_NAMES } from './content.js?v=27';
import { MATCH_KEYS, MATCH_NAMES, makeClock, remainingMs, pauseClock, startClock, addTime, resetClock, formatTime } from './timer-model.js?v=27';
import { roundDone, gameDone, timerStarted, recordSuccess, eliminate, cavalryPoints, setBasketScore, finishBasketAttempt, resetRound, resetGame, captureResultToken, canUndoResult, undoResult } from './rounds.js?v=27';
import { activeRoundKey, nextTarget } from './flow-model.js?v=27';
import { createTimerPopup } from './timer-popup.js?v=27';
import { captureView } from './view-state.js?v=27';

export function createLiveDesk(api) {
  const {getState,schedule,esc,dot,teamLabel,save,refresh,toast,recordWinner}=api;
  const canEdit=()=>api.canEdit?.()??true;
  const now=()=>api.now?.()??Date.now();
  const timeLeft=clock=>remainingMs(clock,now());
  const choices={},overlay=document.querySelector('#live-dialog');
  let overlayEvent=null,overlayOpener=null,sound=Boolean(api.preferences?.()?.sound),audio=null,lastResultToken=null;
  const popup=createTimerPopup({onHide:()=>toast('Timer hidden. The clock keeps running; open the game to see it.')});
  const name=id=>getState().teams.find(t=>t.id===id)?.name||'TBD';
  const ready=k=>getState().tug.locked&&matchTeams(getState().tug,k).every(Boolean);
  function setChoiceKey(ch,key) {
    const [game,part,attempt]=key.split(':');
    if(game==='tug')ch.match=part;
    if(['borrow','relay'].includes(game))ch.round=Number(part);
    if(game==='basket'){ch.team=part;ch.attempt=Number(attempt);}
    if(game==='cavalry')ch.division=part;
  }
  function context(index) {
    const s=getState(),game=EVENT_GAMES[index];
    const editable=canEdit();
    choices[index] ||= {round:0,team:'red',attempt:0,division:s.cavalry.division,match:MATCH_KEYS.find(k=>ready(k)&&!s.tug.winners[k])||'prelim',review:false,manual:false,editing:editable};
    const ch=choices[index],base={game,eventIndex:index,signature:'',ready:true};let ctx;
    if(ch.editing!==editable){ch.review=false;ch.manual=false;ch.editing=editable;}
    if(!editable&&!ch.review){const key=activeRoundKey(s);if(key?.startsWith(game+':'))setChoiceKey(ch,key);}
    if(game==='tug'){const pair=matchTeams(s.tug,ch.match);ctx={key:'tug:'+ch.match,seconds:60,title:MATCH_NAMES[ch.match],teams:pair,match:ch.match,ready:ready(ch.match),signature:pair.join('|'),hint:'60-second limit · tied pull: use a 30s rematch'};}
    else if(game==='borrow'){ch.round=Math.min(ch.round,s.borrow.rounds-1);ctx={key:'borrow:'+ch.round,seconds:[90,90,120,120,120,120,90][ch.round],title:`Round ${ch.round+1} · ${['Easy','Easy','Medium','Borrow-a-Person','Medium','Funny / Chaos','Contingency'][ch.round]}`,round:ch.round,teams:TEAM_IDS,hint:'Success order: 5 / 4 / 3 / 2 / 2 · fail: 0'};}
    else if(game==='basket')ctx={key:`basket:${ch.team}:${ch.attempt}`,seconds:30,title:`${name(ch.team)} · attempt ${ch.attempt+1} / 2`,team:ch.team,round:ch.attempt,teams:[ch.team],hint:'Count balls, then finish attempt · best of two counts'};
    else if(game==='relay')ctx={key:'relay:'+ch.round,seconds:[480,600,480][ch.round],title:['Baton Relay','Three-Legged Relay','Spoon & Ball Relay'][ch.round],round:ch.round,teams:TEAM_IDS,hint:'Tap Finish in arrival order · places convert to 5 / 4 / 3 / 2 / 1'};
    else if(game==='cavalry'){const division=ch.division,d=s.cavalry.divisions[division];ctx={key:'cavalry:'+division,seconds:s.cavalry.cap||300,title:division==='women'?'Round 1 · Women':'Round 2 · Men',division,teams:d.active,ready:d.active.length>=2,signature:d.active.join('|'),hint:'Select teams → play → tap each horse as it goes out. Last horse wins.'};}
    else ctx={key:'event:'+index,seconds:schedule[index].durationMinutes*60,title:schedule[index].title,teams:[],ready:schedule[index].durationMinutes>0,hint:'Event allocation · adjust as needed'};
    return {...base,...ctx,done:roundDone(s,ctx.key),complete:game?gameDone(s,game):false,review:!editable&&ch.review};
  }
  function clockFor(ctx,create=false){
    const s=getState(),existing=s.timers[ctx.key];
    if(existing&&(existing.signature===ctx.signature||existing.started))return existing;
    const clock=makeClock(ctx.seconds,ctx.signature);
    if(create&&canEdit())s.timers[ctx.key]=clock;
    return clock;
  }
  function followControls(ctx){
    if(canEdit()||!ctx.game)return '';
    return `<div class="live-follow"><span>${ctx.review?'Reviewing rounds':'Following live'}</span><button class="text-button" data-live-action="follow-live" ${ctx.review?'':'hidden'}>Follow live →</button></div>`;
  }
  function roundButtons(ctx){
    const s=getState(),ch=choices[ctx.eventIndex];let items=[],field='round',selected=ch.round;
    if(ctx.game==='tug'){field='match';selected=ch.match;items=MATCH_KEYS.map((k,i)=>({value:k,label:String(i+1),title:MATCH_NAMES[k],key:'tug:'+k}));}
    else if(ctx.game==='basket'){field='attempt';selected=ch.attempt;items=[0,1].map(i=>({value:i,label:String(i+1),title:'Attempt '+(i+1),key:`basket:${ch.team}:${i}`}));}
    else if(ctx.game==='cavalry'){field='division';selected=ctx.division;items=['women','men'].map((d,i)=>({value:d,label:String(i+1),title:d==='women'?'Women':'Men',key:'cavalry:'+d}));}
    else if(['borrow','relay'].includes(ctx.game))items=Array.from({length:ctx.game==='borrow'?s.borrow.rounds:3},(_,i)=>({value:i,label:String(i+1),title:'Round '+(i+1),key:ctx.game+':'+i}));
    return items.length?`<nav class="round-strip" aria-label="${ctx.game==='basket'?'Attempts':'Rounds'}"><span>${ctx.game==='basket'?'ATTEMPT':ctx.game==='tug'?'MATCH':'ROUND'}</span>${items.map(i=>`<button class="round-button ${selected===i.value?'selected':''} ${roundDone(s,i.key)?'done':''} ${s.timers[i.key]?.deadline&&timeLeft(s.timers[i.key])>0?'running':''}" data-live-choice="${field}" data-value="${i.value}" aria-pressed="${selected===i.value}" aria-label="${i.title}${roundDone(s,i.key)?', completed':''}" title="${i.title}">${i.label}${roundDone(s,i.key)?'<small>✓</small>':''}</button>`).join('')}</nav>`:'';
  }
  function rounds(index){const ctx=context(index);return `<div data-live-event="${index}">${roundButtons(ctx)}${followControls(ctx)}</div>`;}
  function teamChoices(ctx){
    if(!['basket','cavalry'].includes(ctx.game))return '';
    const s=getState(),d=ctx.game==='cavalry'?s.cavalry.divisions[ctx.division]:null;
    if(ctx.game==='cavalry'&&!canEdit())return `<div class="team-choices spectator-arena" aria-label="Teams in arena">${d.active.map(id=>`<span class="team-choice selected">${dot(id)}<span class="team-choice-name">${esc(name(id))}</span></span>`).join('')}</div>`;
    return `<div class="team-choices" ${ctx.game==='basket'?'role="group" aria-label="Choose team"':'role="group" aria-label="Teams in arena"'}>${TEAM_IDS.map(id=>{const selected=ctx.game==='basket'?ctx.team===id:d.active.includes(id);return `<button class="team-choice ${selected?'selected':''}" data-live-team="${id}" aria-label="${esc(name(id))}" aria-pressed="${selected}" ${ctx.game==='cavalry'&&(d.started||!canEdit())?'disabled':''}>${dot(id)}<span class="team-choice-name">${esc(name(id))}</span>${selected?'<span class="team-choice-check" aria-hidden="true">✓</span>':''}</button>`;}).join('')}</div>`;
  }
  function matchup(ctx){
    if(ctx.game==='tug')return `<div class="live-matchup">${ctx.teams.map((id,i)=>`${i?'<span class="versus">VS</span>':''}<div class="live-team">${id?dot(id):'<span class="dot unknown"></span>'}<strong>${esc(name(id))}</strong></div>`).join('')}</div>`;
    return ctx.game!=='cavalry'?`<div class="live-teams">${ctx.teams.map(teamLabel).join('')}</div>`:'';
  }
  function results(ctx){
    const s=getState(),editable=canEdit(),canScore=editable&&timerStarted(s,ctx.key)&&!ctx.done&&!ctx.complete,disabled=canScore?'':'disabled';
    if(ctx.game==='tug')return `<div class="section-label">${editable?'WHO WON?':'MATCH RESULT'} <span class="badge">${ctx.done?'Locked · saved':!editable?'Viewing scores':'Tap winner to save'}</span></div><div class="winner-choices">${ctx.teams.map(id=>{const selected=s.tug.winners[ctx.match]===id&&id,contents=`${id?dot(id):''}${esc(name(id))}${selected?' ✓':''}`;return editable?`<button class="winner-choice ${selected?'selected':''}" data-live-winner="${id||''}" ${!ctx.ready||!canScore?'disabled':''}>${contents}</button>`:`<span class="winner-choice ${selected?'selected':''}">${contents}</span>`;}).join('')}</div>${!ctx.ready?'<button class="primary" data-live-action="bracket">View bracket →</button>':''}`;
    if(ctx.game==='borrow'||ctx.game==='relay')return `<div class="section-label">${ctx.game==='borrow'?'SUCCESS / FAIL':'FINISH ORDER'} <span class="badge">${ctx.done?'Locked · saved':!editable?'Viewing scores':'Tap in order'}</span></div><div class="arrival-list">${TEAM_IDS.map((id,i)=>{const value=s[ctx.game].scores[i][ctx.round];return `<div class="arrival-row ${value!==null?'recorded':''}">${teamLabel(id)}<div class="arrival-actions">${value===null?(editable?`<button class="success-button" data-live-arrival="${id}" ${disabled}>${ctx.game==='borrow'?'Success':'Finish'}</button>${ctx.game==='borrow'?`<button class="fail-button" data-live-fail="${id}" ${disabled}>Fail</button>`:''}`:'<span class="result-pending">Waiting</span>'):`<strong>${ctx.game==='borrow'?(value===0?'Fail · 0':value+' pts'):'#'+value+' · '+(6-value)+' pts'} ✓</strong>`}</div></div>`;}).join('')}</div>`;
    if(ctx.game==='basket'){const value=s.basket.scores[TEAM_IDS.indexOf(ctx.team)][ctx.round]??0;return `<div class="section-label">SUCCESSFUL BALLS <span class="badge">${ctx.done?'Locked · saved':!editable?'Viewing scores':'Auto-save'}</span></div>${editable?`<div class="ball-counter"><button class="secondary" data-live-action="minus-ball" aria-label="Remove one ball" ${disabled}>−</button><input aria-label="Successful balls" type="number" inputmode="numeric" min="0" max="999" step="1" value="${value}" data-committed-value="${value}" data-live-score ${disabled}><button class="primary" data-live-action="plus-ball" aria-label="Add one ball" ${disabled}>+</button></div><button class="primary finish-attempt" data-live-action="finish" ${disabled}>${ctx.done?'Attempt complete ✓':'Finish attempt & lock'}</button>`:`<output class="ball-count" aria-label="Successful balls">${value}</output>`}`;}
    if(ctx.game==='cavalry'){
      const d=s.cavalry.divisions[ctx.division],left=d.active.filter(id=>!d.eliminated.includes(id)),pts=cavalryPoints(s,ctx.division);
      return `<div class="section-label">${ctx.done?'ROUND RESULTS':'ELIMINATION ORDER'} <span class="badge">${ctx.done?'Locked · saved':d.eliminated.length+' out'}</span></div>${!d.started?`<p class="help">${editable?'Choose at least two teams above. Press Play to open the arena.':'Waiting for the scorekeeper to start the arena.'}</p>`:`<div class="arena-order">${[...d.eliminated,...left].map(id=>`<div class="arrival-row">${teamLabel(id)}${ctx.done?`<strong>${pts[TEAM_IDS.indexOf(id)]} pts${left.includes(id)?' · winner':''}</strong>`:d.eliminated.includes(id)?`<span>Out #${d.eliminated.indexOf(id)+1}</span>`:editable?`<button class="fail-button" data-live-eliminate="${id}" ${disabled}>Horse out</button>`:'<span>In arena</span>'}</div>`).join('')}</div>`}<p class="help">Last → first out: 5 / 4 / 3 / 2 / 1 points. Teams outside the arena receive 0. Two rounds are added.</p>`;
    }
    return '';
  }
  function view(index,big=false){
    if(api.preferences)sound=Boolean(api.preferences()?.sound);
    const ctx=context(index),c=clockFor(ctx),ms=timeLeft(c),running=c.deadline!==null&&ms>0,started=timerStarted(getState(),ctx.key),editable=canEdit();
    const blocked=condition=>condition?'disabled':'';
    const target=ctx.game?nextTarget(getState(),ctx.key):null;
    const primary=ctx.complete||ctx.done&&!target?'<button class="primary" data-live-action="overview">Main Scores →</button>':ctx.done?`<button class="primary" data-live-action="next">Next: ${esc(target.label)} →</button>`:editable?`<button class="primary" data-live-action="toggle" ${blocked(!ctx.ready||ms===0)}>${running?'Ⅱ Pause':'▶ Play'}</button>`:'';
    const undo=editable&&lastResultToken?.key===ctx.key&&canUndoResult(getState(),lastResultToken)?`<button class="text-button undo-result" data-live-action="undo-result">Undo ${esc(name(lastResultToken.teamId))} result</button>`:'';
    const sync=syncLabel();
    const markup=`<div class="live-desk ${big?'is-big':''} ${ctx.complete?'game-completed':ctx.done?'round-completed':''}" data-live-event="${index}" data-live-key="${ctx.key}">${roundButtons(ctx)}${followControls(ctx)}<button class="live-sync ${sync.className}" data-live-action="sync" data-live-sync role="status">${esc(sync.text)}</button>${teamChoices(ctx)}<div class="match-workspace"><section class="live-stage ${running?'is-running':''}"><span class="eyebrow">${esc(ctx.title)}</span>${matchup(ctx)}<output class="clock-digits ${ms===0?'expired':''}" data-clock-digits role="timer" aria-label="Time remaining">${formatTime(ms)}</output><span class="clock-status" data-clock-status>${ctx.complete?'Game complete':ctx.done?'Round complete':running?'LIVE':ms===0?'Time up':started?'Paused':'Ready'}</span>${editable?`<div class="clock-controls"><button class="secondary" data-live-action="add" ${blocked(ctx.done||ctx.complete)}>+30s</button>${ctx.game==='tug'?`<button class="secondary" data-live-action="rematch" ${blocked(ctx.done||ctx.complete)}>30s rematch</button>`:''}</div><details class="clock-options"><summary>Timer settings</summary><div class="clock-settings"><label class="field">Limit (seconds)<input type="number" min="1" max="${ctx.game==='cavalry'?2700:86400}" step="1" inputmode="numeric" data-live-limit value="${c.duration/1000}" data-committed-value="${c.duration/1000}" ${blocked(running||ctx.done||ctx.complete)}></label><label class="checkbox"><input type="checkbox" data-live-sound ${sound?'checked':''}> End sound</label></div><button class="text-button" data-live-action="reset-clock" ${blocked(ctx.done||ctx.complete)}>Reset timer only</button></details>`:''}<p class="help">${esc(editable?ctx.hint:'Follow the timer and results as the scorekeeper updates them.')}</p></section>${ctx.game?`<section class="live-result">${results(ctx)}${undo}<p class="live-save-message" data-live-status role="status">${!editable?'Viewing live scores. Only the scorekeeper can record results.':!api.saved()?'Storage unavailable — export a backup to keep these results.':ctx.complete?'Game complete. Points added to the main Scores overview.':ctx.done?'Round saved and locked.':!started?'Press Play to unlock scoring.':'Results save as you tap. All rounds must finish for overall points.'}</p></section>`:''}</div>${primary&&(big||!overlay.open)?`<div class="live-action-dock">${primary}</div>`:''}<div class="live-bottom-actions">${!big?'<button class="secondary" data-live-action="expand">Big screen ↗</button>':''}${ctx.game?'<button class="text-button" data-live-action="sheet">Score sheet →</button>':''}${editable?`<details class="reset-menu"><summary>Reset…</summary><button class="text-button" data-live-action="reset-round">Reset ${ctx.game==='basket'?'attempt':ctx.game==='tug'?'match':'round'}</button>${ctx.game?'<button class="text-button" data-live-action="reset-game">Reset whole game</button>':''}</details>`:''}</div></div>`;
    return big?markup.replaceAll(' · ',' — '):markup;
  }
  function syncLabel(){
    const status=api.syncStatus?.()||{localPreview:true};
    if(status.localPreview)return {text:'Local preview · saved on this device',className:'is-local'};
    if(status.phase==='conflict')return {text:'Scores need attention · open sync',className:'needs-attention'};
    if(status.storageError)return {text:'Device storage unavailable · open sync',className:'needs-attention'};
    if(status.pending)return {text:status.connected?'Saving results…':'Offline · results waiting to sync',className:'is-pending'};
    if(!status.connected)return {text:status.phase==='connecting'?'Connecting to live scores…':'Offline · showing last saved scores',className:'is-offline'};
    return {text:status.role==='writer'?'Live · results synced':'Live scores · connected',className:'is-connected'};
  }
  function updateStatus(){const label=syncLabel();document.querySelectorAll('[data-live-sync]').forEach(el=>{if(el.textContent!==label.text)el.textContent=label.text;const className='live-sync '+label.className;if(el.className!==className)el.className=className;});}
  function renderOverlay(){if(overlayEvent===null)return;const restoreView=captureView(overlay,overlay.dataset.viewKey);document.querySelector('#live-title').textContent=GAME_NAMES[EVENT_GAMES[overlayEvent]]||schedule[overlayEvent].title;document.querySelector('#live-body').innerHTML=view(overlayEvent,true);overlay.dataset.viewKey=String(overlayEvent);restoreView(overlay.dataset.viewKey);}
  function open(index,match){context(index);if(match){choices[index].match=match;markManual(index);}if(!overlay.open){overlayOpener=document.activeElement;popup.resetOverlay();}overlayEvent=index;renderOverlay();if(!overlay.open)overlay.showModal();refresh();document.querySelector('#close-live').focus();}
  function refreshViews(){refresh();if(overlay.open)renderOverlay();tick();}
  function showReadyClock(ctx,c){
    document.querySelectorAll(`[data-live-key="${ctx.key}"]`).forEach(desk=>{
      const status=desk.querySelector('[data-clock-status]');if(status)status.textContent='Ready';
      const limit=desk.querySelector('[data-live-limit]');if(limit){limit.value=c.duration/1000;limit.dataset.committedValue=String(c.duration/1000);}
      const toggle=desk.querySelector('[data-live-action="toggle"]');if(toggle)toggle.disabled=!ctx.ready||timeLeft(c)===0;
      desk.querySelectorAll('[data-live-winner],[data-live-arrival],[data-live-fail],[data-live-eliminate],[data-live-score],[data-live-action="plus-ball"],[data-live-action="minus-ball"],[data-live-action="finish"]').forEach(control=>control.disabled=true);
      const saved=desk.querySelector('[data-live-status]');if(saved)saved.textContent='Press Play to unlock scoring.';
    });
    tick();
  }
  function beep(){if(!sound||!audio)return;try{const o=audio.createOscillator(),g=audio.createGain();o.connect(g);g.connect(audio.destination);o.frequency.value=880;g.gain.setValueAtTime(.15,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.7);o.start();o.stop(audio.currentTime+.7);}catch{}}
  function armAudio(){if(!sound)return;try{audio ||= new(window.AudioContext||window.webkitAudioContext)();audio.resume();}catch{}}
  function markManual(index){choices[index].manual=true;choices[index].review=!canEdit();}
  function selectKey(key,manual=false){const [game,part]=key.split(':'),index=game==='event'?Number(part):GAME_EVENTS[game];context(index);setChoiceKey(choices[index],key);if(manual)markManual(index);return index;}
  function resume(index){context(index);const ch=choices[index],key=activeRoundKey(getState());if(key?.startsWith(EVENT_GAMES[index]+':')&&!ch.manual&&!ch.review)setChoiceKey(ch,key);}
  function captureSelection(index){context(index);return {...choices[index]};}
  function restoreSelection(index,selection){
    if(!selection||typeof selection!=='object')return;
    context(index);const ch=choices[index];
    const rounds=EVENT_GAMES[index]==='relay'?3:getState().borrow.rounds;
    if(Number.isInteger(selection.round)&&selection.round>=0&&selection.round<rounds)ch.round=selection.round;
    if(TEAM_IDS.includes(selection.team))ch.team=selection.team;
    if([0,1].includes(selection.attempt))ch.attempt=selection.attempt;
    if(['women','men'].includes(selection.division))ch.division=selection.division;
    if(MATCH_KEYS.includes(selection.match))ch.match=selection.match;
    ch.review=selection.review===true;ch.manual=selection.manual===true;
  }
  function next(ctx){
    const target=nextTarget(getState(),ctx.key);
    if(target)selectKey(target.key,true);else if(ctx.game)api.openPanel('results');
    refreshViews();
  }
  document.addEventListener('click',async e=>{
    const launch=e.target.closest('[data-live-match]');if(launch){open(8,launch.dataset.liveMatch);return;}
    const control=e.target.closest('[data-live-choice],[data-live-team],[data-live-action],[data-live-winner],[data-live-arrival],[data-live-fail],[data-live-eliminate]');if(!control||control.disabled)return;
    const desk=control.closest('[data-live-event]');if(!desk)return;
    const ctx=context(Number(desk.dataset.liveEvent));
    try{
      if(control.dataset.liveChoice){const field=control.dataset.liveChoice,value=control.dataset.value;choices[ctx.eventIndex][field]=['round','attempt'].includes(field)?Number(value):value;markManual(ctx.eventIndex);refreshViews();return;}
      if(control.dataset.liveTeam){
        const id=control.dataset.liveTeam;
        if(ctx.game==='basket'){choices[ctx.eventIndex].team=id;markManual(ctx.eventIndex);refreshViews();return;}
        if(!canEdit()||ctx.game!=='cavalry'||ctx.done||ctx.complete||!TEAM_IDS.includes(id))return;
        const s=getState();
        const d=s.cavalry.divisions[ctx.division];if(d.started)return;
        d.active=d.active.includes(id)?d.active.filter(t=>t!==id):TEAM_IDS.filter(t=>t===id||d.active.includes(t));
        lastResultToken=null;
        save();refreshViews();return;
      }
      const action=control.dataset.liveAction;
      if(action==='follow-live'){choices[ctx.eventIndex].review=false;choices[ctx.eventIndex].manual=false;refreshViews();return;}
      if(action==='expand'){open(ctx.eventIndex);return;}
      if(action==='overview'){if(overlay.open)overlay.close();api.openPanel('results');return;}
      if(action==='sync'){if(overlay.open)overlay.close();api.openPanel('sync');return;}
      if(action==='sheet'||action==='bracket'){if(overlay.open)overlay.close();api.openPanel('event:'+ctx.eventIndex,action==='sheet'?'scores':'play');return;}
      if(action==='next'){next(ctx);return;}
      if(!canEdit())return;
      if(action==='reset-round'||action==='reset-game'){
        if(!await api.confirmChange(action==='reset-game'?'Reset this game’s scores, timers and setup? Other games and team names stay.':ctx.game==='tug'?'Reset this match and any dependent later matches?':'Reset this round’s scores and timer?'))return;
        if(!canEdit())return;
        const s=getState();lastResultToken=null;
        action==='reset-game'?resetGame(s,ctx.game):resetRound(s,ctx.key);if(action==='reset-game')delete choices[ctx.eventIndex];save();refreshViews();return;
      }
      if(ctx.done||ctx.complete)return;
      const s=getState();
      if(action==='undo-result'){
        if(lastResultToken?.key===ctx.key&&undoResult(s,lastResultToken)){lastResultToken=null;save();refreshViews();}
        return;
      }
      const scoring=control.dataset.liveWinner||control.dataset.liveArrival||control.dataset.liveFail||control.dataset.liveEliminate||['plus-ball','minus-ball','finish'].includes(action);
      if(scoring&&!timerStarted(s,ctx.key)){toast('Press Play before recording results.');return;}
      if(control.dataset.liveWinner){
        if(!await recordWinner(ctx.match,control.dataset.liveWinner)||!canEdit())return;
        const current=getState();
        if(roundDone(current,ctx.key)){if(current.timers[ctx.key])pauseClock(current.timers[ctx.key],now());if(current.activeKey===ctx.key){current.activeKey=null;save();}}
        refreshViews();return;
      }
      let c=s.timers[ctx.key];
      if(control.dataset.liveArrival||control.dataset.liveFail){
        const id=control.dataset.liveArrival||control.dataset.liveFail,success=!control.dataset.liveFail;
        const token=captureResultToken(s,ctx.key,id,success);
        if(!recordSuccess(s,ctx.game,ctx.round,id,success))return;
        lastResultToken=token;
      }
      else if(control.dataset.liveEliminate){
        const token=captureResultToken(s,ctx.key,control.dataset.liveEliminate);
        if(!eliminate(s,ctx.division,control.dataset.liveEliminate))return;
        lastResultToken=token;
      }
      else switch(action){
        case 'toggle':if(!ctx.ready)return;c=clockFor(ctx,true);if(c.deadline!==null)pauseClock(c,now());else{armAudio();if(!startClock(s.timers,ctx.key,now()))return;s.activeKey=ctx.key;if(ctx.game==='cavalry')s.cavalry.divisions[ctx.division].started=true;}popup.reveal();break;
        case 'add':c=clockFor(ctx,true);addTime(c,30,now());break;
        case 'reset-clock':c=clockFor(ctx,true);resetClock(c);lastResultToken=null;if(s.activeKey===ctx.key)s.activeKey=null;break;
        case 'rematch':if(ctx.game!=='tug')return;c=clockFor(ctx,true);resetClock(c,30);lastResultToken=null;if(s.activeKey===ctx.key)s.activeKey=null;break;
        case 'plus-ball':case 'minus-ball':{const value=s.basket.scores[TEAM_IDS.indexOf(ctx.team)][ctx.round]||0;if(!setBasketScore(s,ctx.team,ctx.round,Math.max(0,Math.min(999,value+(action==='plus-ball'?1:-1)))))return;lastResultToken=null;break;}
        case 'finish':{const input=desk.querySelector('[data-live-score]');if(!input||!input.validity.valid||input.value===''){toast('Enter a valid ball count.');return;}if(!setBasketScore(s,ctx.team,ctx.round,Number(input.value))||!finishBasketAttempt(s,ctx.team,ctx.round))return;lastResultToken=null;break;}
        default:return;
      }
      if(roundDone(s,ctx.key)){if(c)pauseClock(c,now());if(s.activeKey===ctx.key)s.activeKey=null;}
      save();refreshViews();
    }catch(error){toast(error.message);}
  });
  document.addEventListener('change',e=>{
    const el=e.target,desk=el.closest('[data-live-event]');if(!desk||!canEdit())return;
    const ctx=context(Number(desk.dataset.liveEvent)),s=getState();
    if(el.matches('[data-live-sound]')){sound=el.checked;api.savePreference?.('sound',sound);armAudio();return;}
    if(ctx.done||ctx.complete)return;
    if(el.matches('[data-live-limit]')){
      let c=clockFor(ctx);
      if(c.deadline!==null||!el.validity.valid||el.value===''){el.value=c.duration/1000;toast('Enter a valid whole-second limit while paused.');return;}
      c=clockFor(ctx,true);resetClock(c,Number(el.value));lastResultToken=null;el.dataset.committedValue=String(c.duration/1000);if(s.activeKey===ctx.key)s.activeKey=null;if(ctx.game==='cavalry')s.cavalry.cap=Number(el.value);save();showReadyClock(ctx,c);
    }else if(el.matches('[data-live-score]')){
      if(!timerStarted(s,ctx.key)||!el.validity.valid||el.value===''){el.value=s.basket.scores[TEAM_IDS.indexOf(ctx.team)][ctx.round]??0;el.dataset.committedValue=String(el.value);return;}
      if(!setBasketScore(s,ctx.team,ctx.round,Number(el.value)))return;
      el.dataset.committedValue=String(Number(el.value));lastResultToken=null;save();desk.querySelector('[data-live-status]').textContent=api.saved()?'Saved to the game score sheet.':'Storage unavailable — export a backup.';
    }
  });
  document.addEventListener('input',e=>{
    const el=e.target,desk=el.closest('[data-live-event]');
    if(!desk||!canEdit()||!el.matches('[data-live-score]'))return;
    const ctx=context(Number(desk.dataset.liveEvent)),s=getState();
    if(ctx.done||ctx.complete||!timerStarted(s,ctx.key)||!el.validity.valid||el.value==='')return;
    if(!setBasketScore(s,ctx.team,ctx.round,Number(el.value)))return;
    el.dataset.committedValue=String(Number(el.value));lastResultToken=null;save();
    document.querySelectorAll(`[data-live-key="${ctx.key}"] [data-live-score]`).forEach(peer=>{peer.dataset.committedValue=el.dataset.committedValue;if(peer!==el)peer.value=el.value;});
    desk.querySelector('[data-live-status]').textContent=api.saved()?'Saved to the game score sheet.':'Storage unavailable — export a backup.';
  });
  function describe(key){const [g,p,a]=key.split(':'),s=getState();if(g==='tug')return matchTeams(s.tug,p).map(name).join(' vs ');if(g==='basket')return `${name(p)} — attempt ${Number(a)+1}`;if(g==='cavalry')return s.cavalry.divisions[p].active.filter(id=>!s.cavalry.divisions[p].eliminated.includes(id)).map(name).join(' vs ');return g==='event'?schedule[Number(p)].title:`All teams — round ${Number(p)+1}`;}
  function tick(){
    if(api.preferences)sound=Boolean(api.preferences()?.sound);
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
    const activeKey=activeRoundKey(s),active=activeKey?[activeKey,s.timers[activeKey]]:null;
    const activeMs=active?timeLeft(active[1]):0;
    popup.update(active?.[0]||null,active?`${describe(active[0])} — ${formatTime(activeMs)}${activeMs===0?' — time up':active[1].deadline?'':' — paused'}`:'');
    document.querySelectorAll('.game-card').forEach(card=>{const game=EVENT_GAMES[Number(card.dataset.open.split(':')[1])],done=gameDone(s,game),running=!done&&active&&active[0].startsWith(game+':');card.disabled=done;card.classList.toggle('completed',done);card.classList.toggle('ongoing',Boolean(running));const bottom=card.querySelector('.game-bottom');bottom.dataset.pendingLabel ||= bottom.textContent;bottom.textContent=done?'Game complete ✓':bottom.dataset.pendingLabel;const badge=card.querySelector('.ongoing-status');if(badge){badge.hidden=!running;if(running)badge.textContent=`${activeMs===0?'TIME UP':active[1].deadline?'LIVE':'Ⅱ PAUSED'} — ${describe(active[0])} — ${formatTime(activeMs)}`;}});
    document.querySelectorAll('.schedule-row').forEach(row=>{const game=EVENT_GAMES[Number(row.dataset.open.split(':')[1])];row.classList.toggle('completed',Boolean(game&&gameDone(s,game)));});
    document.querySelectorAll('[data-match-card]').forEach(card=>card.classList.toggle('ongoing',Boolean(active&&active[0]==='tug:'+card.dataset.matchCard)));
    updateStatus();
  }
  document.querySelector('#active-timer').addEventListener('click',e=>{const key=e.currentTarget.dataset.key;if(!key)return;const index=selectKey(key);choices[index].review=false;choices[index].manual=false;api.openPanel('event:'+index,'timer');if(matchMedia('(max-width:760px)').matches)open(index);});
  document.querySelector('#close-live').addEventListener('click',()=>overlay.close());
  overlay.addEventListener('close',()=>{overlayEvent=null;refresh();if(overlayOpener?.isConnected)overlayOpener.focus();else document.querySelector('#close-detail').focus();});
  document.addEventListener('visibilitychange',tick);setInterval(tick,200);
  return {panel:index=>view(index),rounds,open,tick,resume,captureSelection,restoreSelection,updateStatus,refresh:refreshViews};
}
