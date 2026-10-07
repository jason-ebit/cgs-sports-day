import { TEAM_IDS, COLOURS, GAME_IDS, defaultState, shuffled, seededSlots, validSlots, clearTug, matchTeams, assignSlot, totals, gamePlaces, championship, validateState } from './model.js?v=23';
import { roundDone, gameDone, timerStarted, recordWinner as saveMatchWinner, cavalryPoints } from './rounds.js?v=23';
import { createLiveDesk } from './live.js?v=23';
import { MATCH_KEYS, MATCH_NAMES, pauseClock } from './timer-model.js?v=23';
import { icon } from './icons.js?v=23';
import { EVENT_ICONS, EVENT_GAMES, GAME_EVENTS, GAME_NAMES, NOTES, COMMITTEE, DEPARTMENTS, SUPPLIES, orderedSchedule } from './content.js?v=23';
import { renderMedia, downloadBlob } from './media.js?v=23';
import { captureView } from './view-state.js?v=23';
import { createDeviceStore } from './device-store.js?v=23';
import { createSyncService, mergePublicState, publicSnapshot } from './sync.js?v=23';
import { createBeforeSyncBackup } from './before-sync.js?v=23';
import { SYNC_CONFIG } from './sync-config.js?v=23';
import { renderLiveConnection } from './connection-badge.js?v=23';
import { createGameTimeline } from './game-timeline.js?v=23';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store = createDeviceStore();
const beforeSync = createBeforeSyncBackup();
let state = store.state, saveAvailable = store.saved, current = null, tab = 'notes', returnFocus = null, exportSize = 'poster', mediaCanvas = null, mediaToken = 0;
let department = 'all';
let renderedPanel = null;
let timeline = null;
let sync = null, applyingRemote = false, lastSyncEditable = false;
const localPreview = ['localhost','127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('local');
const writerAuthority = () => localPreview || sync?.role === 'writer' && sync.status.phase !== 'conflict' && !sync.status.storageError;
const canEdit = () => writerAuthority() && !store.protected && !beforeSync.error;
const requireWriter = () => { if(writerAuthority())return true; toast('Sign in as the scorekeeper to change shared scores.'); return false; };
const requireEditor = () => { if(canEdit())return true; toast(store.protected?'Export the protected backup, then import or reset before keeping score.':beforeSync.error?'Recover the original backup in Reset / backup first.':'Sign in as the scorekeeper to change shared scores.'); return false; };
const response = await fetch('./schedule.json?v=23', {cache:'no-cache'});
if (!response.ok) throw Error('Could not load the approved schedule.');
const schedule = (await response.json()).schedule;
const dialog = $('#detail-dialog'), body = $('#detail-body');
const team = id => state.teams.find(t => t.id === id);
const dot = id => `<span class="dot ${id === 'white' ? 'white' : ''}" style="--team-color:${COLOURS[TEAM_IDS.indexOf(id)]}"></span>`;
const teamLabel = id => `<span class="score-team">${dot(id)}<span>${esc(team(id)?.name || '—')}</span></span>`;
const teamDots = (ids = TEAM_IDS) => ids.map(id => `<span class="team-dot-label">${dot(id)}<span class="team-name">${esc(team(id).name)}</span></span>`).join('');
const leadersFor = standings => standings.completed ? standings.rows.filter(row=>row.total===standings.rows[0].total).map(row=>row.id) : [];
function updateLeaderCrowns() {
  const leaders=leadersFor(championship(state));
  document.querySelectorAll('[data-leader-crown]').forEach(crown=>crown.hidden=!leaders.includes(crown.dataset.leaderCrown));
}
const note = (title, text, pending = false) => `<section class="note-card ${pending ? 'pending' : ''}"><h3>${esc(title)}</h3><p>${esc(text)}</p></section>`;
const numberInput = (label, value, attrs = '', max = 100, min = 0) => `<label class="field">${esc(label)}<input type="number" inputmode="numeric" min="${min}" max="${max}" step="1" value="${value ?? ''}" ${attrs}></label>`;
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').classList.remove('visible'), 3000); }
function save() {
  saveAvailable = store.save(state);
  $('#save-state').textContent = saveAvailable ? 'Saved on this device' : store.protected ? 'Existing backup protected' : 'Not saved · export a backup';
  $('#panel-save').textContent = saveAvailable ? 'Changes save on this device' : store.protected ? 'Saved data unreadable · export before replacing' : 'Storage unavailable · export a backup';
  updateLeaderCrowns();
  timeline?.update();
  if(sync&&!applyingRemote&&canEdit())sync.queue(state);
  updateSyncLabels();
}
function updateSyncLabels(){
  if(!sync)return;
  const status=sync.status;
  renderLiveConnection($('#sync-tool'),status);
  $('#sync-tool').dataset.syncPhase=status.phase;
  $('#save-state').textContent=status.role==='writer'?(status.pending?'Pending on this phone':status.connected?'Shared scores synced':'Offline · cached scores'):status.connected?'Viewing shared scores':'Cached scores · reconnecting';
  $('#panel-save').textContent=status.role==='writer'?'Scores sync automatically · reminders stay on this phone':'Live scores · reminders stay on this phone';
  const error=$('#sync-error');if(error){error.textContent=syncErrorText(status);error.hidden=!status.error;}
}
function syncErrorText(status){
  if(/schema cache|could not find the function|relation .* does not exist/i.test(status.error))return 'Live scores need the Supabase setup before connecting. Refresh after setup is complete.';
  if(/permission denied|scorekeeper access|not allowed|editor/i.test(status.error))return 'Only the registered scorekeeper can change shared scores.';
  return status.error;
}
function syncPanel(){
  if(!sync)return '<p class="sync-caution"><strong>Scorekeeper only.</strong> Off limits to everyone else.</p>';
  const s=sync.status;
  const login=!s.signedIn?`<form id="scorekeeper-login" class="sync-login"><label class="field">Scorekeeper email<input name="email" type="email" autocomplete="username" required></label><label class="field">Password<input name="password" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">Sign in &amp; keep score</button></form>`:`<p class="sync-account">Signed in as ${esc(s.email)}</p><div class="button-row">${s.role==='writer'?'<button class="secondary" data-sync-action="release">Stop keeping score</button>':'<button class="primary" data-sync-action="claim">Keep score on this phone</button><button class="secondary" data-sync-action="transfer">Transfer scorekeeping here</button>'}<button class="text-button" data-sync-action="logout">Sign out</button></div>`;
  const pending=s.pending||s.storageError?`<span class="section-label">${s.storageError?'Storage needs attention':s.phase==='conflict'?'Pending results need review':'Pending results'}</span><div class="button-row"><button class="primary" data-sync-action="retry">Retry sync</button><button class="secondary" data-sync-action="accept">Load shared scores</button><button class="secondary" data-action="export-json">Download this phone’s backup</button></div>`:'';
  return `<p class="sync-caution"><strong>Scorekeeper only.</strong> Off limits to everyone else.</p><p class="sync-error" id="sync-error" role="status" ${s.error?'':'hidden'}>${esc(syncErrorText(s))}</p>${login}${pending}${beforeSync.raw?'<button class="secondary" data-open="data">Original phone backup →</button>':''}<div class="button-row"><button class="secondary" data-sync-action="refresh">Refresh scores</button><button class="secondary" data-open="results">Scoreboard →</button><button class="secondary" data-sync-action="share">Copy viewing link</button></div>`;
}
function miniBracket() {
  const s = state.tug.slots, n = (id, fallback) => esc(team(id)?.name.slice(0, 12) || fallback);
  return `<svg class="mini-bracket" viewBox="0 0 300 94" aria-label="Preliminary to two semifinals to final"><path d="M70 19h15v10h15M70 44h15V29M70 76h30M162 29h18v22h20M162 76h18V51"/><rect x="0" y="7" width="70" height="24" rx="5"/><rect x="0" y="32" width="70" height="24" rx="5"/><rect x="0" y="64" width="70" height="24" rx="5"/><rect x="100" y="17" width="62" height="24" rx="5"/><rect x="100" y="64" width="62" height="24" rx="5"/><rect x="200" y="39" width="98" height="24" rx="5"/><text x="35" y="23" text-anchor="middle">${n(s[0],'Draw 1')}</text><text x="35" y="48" text-anchor="middle">${n(s[1],'Draw 2')}</text><text x="35" y="80" text-anchor="middle">3 byes</text><text x="131" y="33" text-anchor="middle">Semi 1</text><text x="131" y="80" text-anchor="middle">Semi 2</text><text x="249" y="55" text-anchor="middle">${n(state.tug.winners.final,'Final')}</text></svg>`;
}
function renderPoster() {
  $('#schedule-list').style.setProperty('--event-count',schedule.length);
  $('#schedule-list').innerHTML = orderedSchedule(schedule).map(e => `<button class="schedule-row ${e.highlight || ''}" data-open="event:${e.eventIndex}" aria-label="${esc(e.title)}, ${e.start}${e.durationMinutes ? ' to '+e.end : ''}. Open notes and controls"><span class="time">${e.start}${e.durationMinutes ? ' – '+e.end : ''}</span><span class="event-icon">${icon(EVENT_ICONS[e.eventIndex])}</span><span class="event-title">${esc(e.title)}</span></button>`).join('');
  const leaders=leadersFor(championship(state));
  $('#team-legend').innerHTML = TEAM_IDS.map(id=>{
    const label=team(id).leader.trim()||id[0].toUpperCase()+id.slice(1);
    return `<span class="team-dot-label"><span class="legend-marker">${dot(id)}<span class="leader-crown" data-leader-crown="${id}" role="img" aria-label="Leading team" ${leaders.includes(id)?'':'hidden'}>${icon('crown')}</span></span><span class="team-name" title="${esc(label)}">${esc(label)}</span></span>`;
  }).join('');
  const head = (g, n) => `<div class="game-head"><span class="game-number">${n}</span>${icon(g)}<h3>${GAME_NAMES[g]}</h3></div>`;
  const gameCards = `
    <button class="game-card" data-open="event:4">${head('borrow',1)}<p class="game-kicker">ALL FIVE TEAMS TOGETHER</p><div class="game-team-row">${teamDots()}</div><p class="game-copy">6–7 rounds · cumulative points</p><div class="game-bottom">Total points → placing</div></button>
    <button class="game-card" data-open="event:5">${head('basket',2)}<p class="game-kicker">TEAMS TAKE TURNS</p><div class="game-team-row">${teamDots(['yellow','white','red','green','blue'])}</div><p class="game-copy">2 attempts per team</p><div class="game-bottom">Best score → placing</div></button>
    <button class="game-card" data-open="event:7">${head('cavalry',3)}<p class="game-kicker">ALL-IN BATTLE</p><div class="cavalry-arena"><div class="arena-ring">${TEAM_IDS.map(dot).join('')}<span>ALL TEAMS</span></div></div><p class="game-copy">Same-gender rounds · last horse wins</p><div class="game-bottom">Elimination order → points</div></button>
    <button class="game-card" data-open="event:8">${head('tug',4)}<p class="game-kicker">DRAWN TOURNAMENT BRACKET</p>${miniBracket()}<p class="game-copy">1 preliminary · 2 semis · final</p><div class="game-bottom">${state.tug.locked ? 'Draw locked · view bracket' : 'Draw opponents → bracket'}</div></button>
    <button class="game-card relay" data-open="event:9"><div class="relay-left">${head('relay',5)}<p class="game-kicker">ALL FIVE TEAMS RACE</p><div class="relay-lanes">${TEAM_IDS.map(id=>`<div class="lane">${dot(id)}<span class="lane-name">${esc(team(id).name)}</span><span class="lane-line"></span></div>`).join('')}</div><div class="game-bottom">3-round points → placing</div></div><div class="relay-rounds"><h4>Relay Rounds</h4>${['Baton Relay','Three-Legged Relay','Spoon & Ball Relay'].map((s,i)=>`<div class="relay-round"><span class="game-number">${i+1}</span><span>${esc(s)}</span></div>`).join('')}</div></button>`;
  const cardTemplate=document.createElement('template');
  cardTemplate.innerHTML=gameCards;
  const gameGrid=$('#game-grid');
  // Keep the timeline attached so live score refreshes preserve its animation.
  [...gameGrid.childNodes].forEach(child=>{if(child.nodeType!==1||!child.classList.contains('game-timeline'))child.remove();});
  gameGrid.prepend(cardTemplate.content);
  document.querySelectorAll('.game-card').forEach(card=>{
    if(!card.classList.contains('relay')){
      const summary=document.createElement('div');summary.className='game-summary';
      [...card.children].filter(child=>!child.matches('.game-head,.game-bottom')).forEach(child=>summary.append(child));
      card.querySelector('.game-bottom').before(summary);
    }
    card.insertAdjacentHTML('beforeend','<span class="ongoing-status" hidden></span>');
  });
  requestAnimationFrame(fitPoster);
  document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
  timeline?.update();
}
function openPanel(key, initialTab = null) {
  if (!dialog.open) returnFocus = document.activeElement;
  current = key; const gameIndex=key.startsWith('event:')?Number(key.split(':')[1]):null;
  if(EVENT_GAMES[gameIndex])live.resume(gameIndex);
  tab = initialTab || (EVENT_GAMES[gameIndex]?'timer':'notes'); renderPanel();
  if (!dialog.open) dialog.showModal();
  $('#close-detail').focus();
}
function restoreFocus(){ if(returnFocus?.isConnected) returnFocus.focus(); else if(returnFocus?.dataset.open) document.querySelector(`[data-open="${CSS.escape(returnFocus.dataset.open)}"]`)?.focus(); }
function closePanel() { dialog.close(); restoreFocus(); }
function bullets(title, items, pending=false) { return `<section class="note-card compact-note ${pending?'pending':''}"><h3>${esc(title)}</h3><ul>${items.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></section>`; }
function eventNotes(index,game) {return bullets('How it works',NOTES[index])+`<div class="button-row"><button class="primary" data-tab="timer">Open timer →</button>${game?`<button class="secondary" data-tab="${game==='tug'?'play':game==='cavalry'?'timer':'scores'}">${game==='tug'?'Draw & bracket':game==='cavalry'?'Set up arena':'Score sheet'} →</button>`:''}</div>`;}
function inventoryPanel() {
  const row=item=>`<li class="inventory-row"><span class="inventory-item"><strong>${esc(item.name)}</strong>${item.detail?`<small>${esc(item.detail)}</small>`:''}</span>${item.links?`<span class="inventory-links">${item.links.map(link=>`<a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(item.name+' · '+link.label+' · opens in a new tab')}">${esc(link.label)} <span aria-hidden="true">↗</span></a>`).join('')}</span>`:item.action?`<span class="inventory-action">${esc(item.action)}</span>`:''}</li>`;
  return `<section class="committee-inventory" aria-labelledby="inventory-title"><h3 id="inventory-title">Items &amp; shopping links</h3><div class="inventory-grid"><section class="inventory-group inventory-have"><h4>Already have <span>${SUPPLIES.have.length}</span></h4><ul>${SUPPLIES.have.map(row).join('')}</ul></section><section class="inventory-group inventory-get"><h4>Must buy / prepare <span>${SUPPLIES.get.length}</span></h4><ul>${SUPPLIES.get.map(row).join('')}</ul></section></div><p class="help">Bring what we have; buy, borrow or prepare what’s missing. Links are from the handover.</p></section>`;
}
function committeePanel(index = null) {
  const general=index===null;
  if(general&&department==='all')department='director';
  const selected=DEPARTMENTS.find(item=>item.id===department);
  const tabs=[...(general?[]:[{id:'all',name:'All'}]),...DEPARTMENTS];
  const items=selected?(general?selected.general:selected.notes[index]):COMMITTEE[index];
  const key=general?'general':String(index);
  const value=selected?state.committeeNotes[selected.id]?.[key]:state.notes[index];
  const gameLinks=general?`<nav class="committee-event-links" aria-label="Committee notes by game"><span class="section-label">Game notes</span>${Object.entries(GAME_EVENTS).map(([game,eventIndex])=>`<button class="secondary" data-open="event:${eventIndex}" data-initial-tab="committee">${esc(GAME_NAMES[game])} <span aria-hidden="true">↗</span></button>`).join('')}</nav>`:'';
  const reminder=selected?.id==='director'?(general?inventoryPanel():'<button class="secondary" data-open="committee">Items &amp; shopping links →</button>'):`<label class="field">${selected?esc(selected.name)+' reminder':'Shared reminder'}<textarea class="compact-textarea" ${selected?`data-committee-note="${selected.id}" data-note-key="${key}"`:`data-event-note="${index}"`} maxlength="2000" placeholder="Anything else to remember?">${esc(value||'')}</textarea></label><p class="help">Saved on this device. Reminders stay out of poster exports.</p>`;
  const extras=selected?.id==='director'?reminder+gameLinks:gameLinks+reminder;
  return `<nav class="committee-tabs" aria-label="Committee departments">${tabs.map(item=>`<button data-department="${item.id}" aria-pressed="${department===item.id}" class="${department===item.id?'selected':''}">${esc(item.name)}</button>`).join('')}</nav>${items.length?bullets(selected?.name||'Everyone',items):'<p class="committee-empty">No extra task for this event.</p>'}${extras}`;
}
function gameSheet(game) {
  if(game!=='tug')return scorePanel(game);
  if(game==='tug')return `<div class="section-label">MATCH RESULTS <span class="badge">Auto-saved</span></div><div class="score-table-wrap"><table class="score-table match-sheet"><thead><tr><th>Match</th><th>Opponents</th><th>Winner</th><th></th></tr></thead><tbody>${MATCH_KEYS.map(k=>{const pair=matchTeams(state.tug,k),ready=state.tug.locked&&pair.every(Boolean);return `<tr><td>${MATCH_NAMES[k]}</td><td>${pair.map(id=>esc(team(id)?.name||'TBD')).join(' vs ')}</td><td>${state.tug.winners[k]?teamLabel(state.tug.winners[k]):'—'}</td><td><button class="text-button" data-live-match="${k}" ${ready?'':'disabled'}>${state.tug.winners[k]?'Review':'Run'} ↗</button></td></tr>`;}).join('')}</tbody></table></div><p class="help">Final results go straight to the main Scores overview. Semifinal losers share third place.</p><button class="secondary" data-open="results">Championship points →</button>`;

}
function renderPanel() {
  const restoreView = captureView(dialog, renderedPanel);
  const eventIndex = current?.startsWith('event:') ? Number(current.split(':')[1]) : null;
  const event = eventIndex !== null ? schedule[eventIndex] : null, game = EVENT_GAMES[eventIndex];
  $('#detail-title').textContent = event?.title || ({ teams:'Teams', results:'Scores', media:'Share / export', data:'Reset / backup', committee:'Committee notes', sync:'Scorekeeper' })[current];
  $('#detail-eyebrow').textContent = event ? `${event.start}${event.durationMinutes ? ' – '+event.end+' · '+event.durationMinutes+' MIN' : ''} / OCT 25` : 'CG SPORTS DAY / OCT 25';
  const tabs=[['timer','Timer & scoring'],...(game==='tug'?[['play','Bracket']]:[]),...(game?[['scores','Scores']]:[]),['notes','Format'],['committee','Committee']];
  dialog.classList.toggle('game-dialog',Boolean(game));
  dialog.classList.toggle('sync-dialog',current==='sync');
  if(tab==='play'&&game&&game!=='tug')tab=game==='cavalry'?'timer':'scores';
  $('#detail-tabs').innerHTML=event?tabs.map(([key,label])=>`<button data-tab="${key}" class="${tab===key?'active':''}" aria-pressed="${tab===key}">${label}</button>`).join(''):'';
  if(event) {
    if(tab==='committee')body.innerHTML=committeePanel(eventIndex);
    else if(tab==='timer')body.innerHTML=live.panel(eventIndex);
    else if(tab==='scores'&&game)body.innerHTML=gameSheet(game);
    else if(tab==='play'&&game)body.innerHTML=tugPanel();
    else body.innerHTML=eventNotes(eventIndex,game);
    if(game&&tab!=='timer')body.insertAdjacentHTML('afterbegin',live.rounds(eventIndex));
  } else if(current==='teams') body.innerHTML=teamsPanel();
  else if(current==='committee') body.innerHTML=committeePanel();
  else if(current==='results') body.innerHTML=resultsPanel();
  else if(current==='data') body.innerHTML=dataPanel();
  else if(current==='sync') body.innerHTML=syncPanel();
  else if(current==='media') { body.innerHTML=mediaPanel(); updateMedia(); }
  if(!canEdit())body.querySelectorAll('[data-assign-slot],[data-borrow-rounds],[data-winner],[data-placement],[data-placement-rule],[data-team][data-field="name"],[data-team][data-field="seed"],[data-action="random-draw"],[data-action="seed-draw"],[data-action="lock-draw"],[data-action="clear-matches"]').forEach(el=>el.disabled=true);
  if(!writerAuthority())body.querySelectorAll('[data-action="reset-all"],[data-action="restore-before-sync"],#import-file').forEach(el=>el.disabled=true);
  updateSyncLabels();
  renderedPanel = `${current}/${tab}`;
  restoreView(renderedPanel);
}
function teamsPanel() {
  return bullets('Team setup',['Add names, leaders and headcounts. The colour legend shows the leader’s name.','Seeds are optional. Use seeds puts 4 vs 5 in the prelim; 1–3 get byes.']) + state.teams.map((t,i)=>`<section class="team-edit"><h3 class="team-edit-title">${dot(t.id)}${t.id[0].toUpperCase()+t.id.slice(1)} team</h3><div class="field-row"><label class="field">Team name<input data-team="${i}" data-field="name" maxlength="24" value="${esc(t.name)}" required></label><label class="field">Leader<input data-team="${i}" data-field="leader" maxlength="60" placeholder="TBA" value="${esc(t.leader)}"></label>${numberInput('Members',t.participants,`data-team="${i}" data-field="participants"`)}${numberInput('Seed',t.seed,`data-team="${i}" data-field="seed"`,5,1)}</div></section>`).join('')+'<p class="help">Scores stay with their colour when names change. Pick Cavalry teams in Timer & scoring.</p><div class="button-row"><button class="primary" data-action="go-draw">Open tug-of-war draw ↗</button></div>';
}
function tugPanel() {
  const t=state.tug,done=gameDone(state,'tug'), labels=['Prelim · A','Prelim · B','Semi 1 · bye','Semi 2 · A / bye','Semi 2 · B / bye'];
  const match=(key,label,placeholders)=>{const pair=matchTeams(t,key);return `<div class="match" data-match-card="${key}"><div class="match-label">${label}<span>60s ↗</span></div>${pair.map((id,i)=>`<button data-live-match="${key}" ${!t.locked||pair.some(x=>!x)?'disabled':''} class="${t.winners[key]===id&&id?'winner':''}" aria-label="${esc(label+': open timer for '+pair.map(t=>team(t)?.name||'TBD').join(' vs '))}">${id?dot(id):''}<span>${esc(team(id)?.name||placeholders[i])}</span></button>`).join('')}</div>`;};
  return `<details class="draw-settings" ${t.locked?'':'open'}><summary>${t.locked?'Draw locked · view / edit':'Set up the draw'}</summary><div class="section-label">THE DRAW <span class="badge ${t.locked?'':'pending'}">${t.locked?'Locked':'Draft · not locked'}</span></div><p class="help">Draw five unique slots, assign them manually, or use your team seeds. Selecting an assigned team swaps its slot.</p><div class="button-row"><button class="primary" data-action="random-draw" ${t.locked?'disabled':''}>Draw opponents</button><button class="secondary" data-action="seed-draw" ${t.locked?'disabled':''}>Use seeds</button><button class="secondary" data-action="lock-draw" ${done||!t.locked&&!validSlots(t.slots)?'disabled':''}>${t.locked?'Unlock & edit':'Lock draw'}</button></div><div class="seed-grid">${labels.map((label,i)=>`<div class="field"><span>${label}</span><div class="team-choices slot-choices" role="group" aria-label="${label}">${TEAM_IDS.map(id=>`<button class="team-choice ${t.slots[i]===id?'selected':''}" data-assign-slot="${i}" data-team-id="${id}" aria-label="${label}: ${esc(team(id).name)}" aria-pressed="${t.slots[i]===id}" ${t.locked?'disabled':''}>${dot(id)}<span>${esc(team(id).name)}</span></button>`).join('')}</div></div>`).join('')}</div></details><div class="section-label">THE BRACKET <span class="badge">Select match to time & score</span></div><div class="bracket-scroll"><div class="bracket"><div class="bracket-column"><h4>PRELIMINARY</h4>${match('prelim','P · Preliminary',['Draw 1','Draw 2'])}<p class="byes-note">Three drawn teams advance<br>directly to the semifinals.</p></div><div class="bracket-column"><h4>SEMIFINALS</h4>${match('semi1','S1 · Semifinal',['Draw 3 · bye','Winner P'])}${match('semi2','S2 · Semifinal',['Draw 4 · bye','Draw 5 · bye'])}</div><div class="bracket-column"><h4>FINAL</h4>${match('final','F · Final',['Winner S1','Winner S2'])}</div></div></div>${t.winners.final?`<div class="champion">${icon('trophy')}${esc(team(t.winners.final).name)} wins the final</div>`:''}<div class="button-row">${(()=>{const next=MATCH_KEYS.find(k=>t.locked&&matchTeams(t,k).every(Boolean)&&!t.winners[k]);return next?`<button class="primary" data-live-match="${next}">Run ${MATCH_NAMES[next].toLowerCase()} · ${matchTeams(t,next).map(id=>esc(team(id).name)).join(' vs ')} ↗</button>`:'';})()}<button class="secondary" data-tab="scores">Score sheet →</button></div><p class="help">The final sends points automatically. Semifinal losers share third place.</p><p class="help">Changing an earlier winner clears affected later results and approved tug-of-war placements.</p>${!done&&Object.values(t.winners).some(Boolean)?'<button class="text-button" data-action="clear-matches">Clear match results</button>':''}`;
}
function scorePanel(game) {
  const done=gameDone(state,game),labels=game==='borrow'?Array.from({length:state.borrow.rounds},(_,i)=>'R'+(i+1)):game==='basket'?['Attempt 1','Attempt 2']:game==='cavalry'?['R1 · Women','R2 · Men']:['Baton','3-legged','Spoon'];
  const values=totals(state,game),places=gamePlaces(state,game);
  const rows=game==='cavalry'?TEAM_IDS.map((_,i)=>['women','men'].map(d=>cavalryPoints(state,d)[i])):state[game].scores;
  return `<div class="section-label">SCORE SHEET <span class="badge">${done?'Game complete · points sent':'Auto-saved from match desk'}</span></div>${game==='borrow'?`<div class="button-row"><button class="${state.borrow.rounds===6?'primary':'secondary'}" data-borrow-rounds="6" ${done?'disabled':''}>6 rounds</button><button class="${state.borrow.rounds===7?'primary':'secondary'}" data-borrow-rounds="7" ${done?'disabled':''}>7 · contingency</button></div>`:''}<div class="score-table-wrap"><table class="score-table"><thead><tr><th>Team</th>${labels.map(l=>`<th>${l}</th>`).join('')}<th>${game==='basket'?'Best':'Total'}</th></tr></thead><tbody>${state.teams.map((t,i)=>`<tr><td>${teamLabel(t.id)}</td>${labels.map((label,j)=>`<td>${rows[i][j]===null?'—':game==='relay'?'#'+rows[i][j]:rows[i][j]}</td>`).join('')}<td><strong>${values[i]??'—'}</strong></td></tr>`).join('')}</tbody></table></div><p class="help">Start each timer before scoring. Finished rounds are locked; use Reset in Timer & scoring to correct a result.</p><div class="button-row"><button class="secondary" data-tab="timer">Timer & scoring →</button>${done?'<button class="primary" data-open="results">Main Scores →</button>':''}</div><div class="section-label">GAME PLACING</div>${places?state.teams.map((t,i)=>({id:t.id,place:places[i]})).sort((a,b)=>a.place-b.place).map(t=>`<div class="result-line">${teamLabel(t.id)}<span>#${t.place} · ${6-t.place} championship pts</span></div>`).join(''):note('Game in progress','Finish every round or attempt to send points to the main Scores overview.',true)}`;
}
function resultsPanel() {
  const c=championship(state),leaders=leadersFor(c);
  return note(c.complete?'All five games complete':`${c.completed} of 5 games complete`,c.complete?'Overall ties use most first-place finishes, then a short tie-breaker if still equal.':'Each game adds its points automatically after its last round. Finish the remaining games before announcing a winner.',!c.complete)+`<div class="score-table-wrap"><table class="score-table"><thead><tr><th>Team</th><th>Borrow</th><th>Basket</th><th>Cavalry</th><th>Tug</th><th>Relay</th><th>Total</th></tr></thead><tbody>${c.rows.map(r=>`<tr><td><span class="leader-score">${teamLabel(r.id)}${leaders.includes(r.id)?`<span class="score-crown" role="img" aria-label="Leading team">${icon('crown')}</span>`:''}</span></td>${r.points.map(p=>`<td>${p??'—'}</td>`).join('')}<td><strong>${r.total}</strong></td></tr>`).join('')}</tbody></table></div><p class="help">Crowns mark the leading total; tied leaders share a crown. A dash means the game is still in progress. Places award 5 / 4 / 3 / 2 / 1 points; tied scores share a place and points. Tug-of-war semifinal losers share third place.</p><div class="button-row">${GAME_IDS.map(g=>`<button class="secondary" data-score-open="${g}">${GAME_NAMES[g]}${gameDone(state,g)?' ✓':' ↗'}</button>`).join('')}</div>`;
}
function dataPanel() { return (store.protected?note('Saved data needs attention','The existing backup could not be read, so it stays untouched. Download it before importing a backup or resetting. New entries cannot save until then.',true):'')+(beforeSync.error?note('Original phone backup',beforeSync.error,true)+'<div class="button-row"><button class="secondary" data-action="export-recovery">Download recovery copy</button><button class="secondary" data-action="recover-sync">Reconnect to shared scores</button></div>':'')+bullets('Keep a backup',['Shared scores sync automatically. Keep a JSON copy before resets or switching phones.','JSON includes this phone’s leaders and committee reminders. Poster images leave them out.'])+'<div class="button-row"><button class="primary" data-action="export-json">Download JSON backup</button><label class="secondary import-label">Import backup<input type="file" id="import-file" accept="application/json,.json"></label></div>'+(beforeSync.raw?note('Before live sync','The original scores are still backed up on this phone. Restoring replaces shared results for everyone; private reminders stay as they are.')+'<div class="button-row"><button class="secondary" data-action="export-before-sync">Download original phone backup</button><button class="secondary" data-action="restore-before-sync">Restore original scores</button></div>':'')+bullets('Reset the day',['The scorekeeper can clear shared teams, scores, timers and draw for everyone.','This phone’s private notes are also cleared. Download a backup first.'])+'<button class="danger" data-action="reset-all">Reset event data</button>'; }
function mediaPanel() { return bullets('Share the rundown',['Full poster or 9:16 phone story, with the schedule, team names and game formats.','Leader names and committee reminders stay out of the image.'])+`<div class="field-row"><label class="field">Image format<select id="export-size"><option value="poster" ${exportSize==='poster'?'selected':''}>Full poster · 1536 × 1610</option><option value="phone" ${exportSize==='phone'?'selected':''}>Phone story · 1080 × 1920</option></select></label><div class="field">PNG image<button class="primary" id="download-media" data-action="download-media" disabled>Preparing image…</button></div></div><div class="export-preview" id="export-preview" aria-live="polite">Preparing preview…</div>`; }
async function updateMedia(){const token=++mediaToken;try{mediaCanvas=await renderMedia({state,schedule,size:exportSize});if(token!==mediaToken||current!=='media')return;$('#export-preview').replaceChildren(mediaCanvas);$('#download-media').disabled=false;$('#download-media').textContent='Download PNG ↓';}catch(e){if(current==='media')$('#export-preview').textContent='Image could not be generated. Please try again.';console.error(e);}}
async function confirmChange(message) { const d=$('#confirm-dialog'); $('#confirm-copy').textContent=message; d.showModal(); return new Promise(resolve=>{const finish=value=>{d.close();d.oncancel=null;resolve(value);};$('#confirm-ok').onclick=()=>finish(true);$('#confirm-cancel').onclick=()=>finish(false);d.oncancel=e=>{e.preventDefault();finish(false);};}); }
function changed(refresh=true){save();renderPoster();if(refresh)renderPanel();}
function invalidatePlaces(game){state.placements[game].values=Array(5).fill(null);}
async function recordTugWinner(match,id) {
  if(!requireEditor())return false;
  if(state.tug.winners[match]){toast('This match is completed. Reset it to change the result.');return false;}
  if(!timerStarted(state,'tug:'+match)){toast('Press Play before recording a winner.');return false;}
  if(!saveMatchWinner(state,match,id))return false;
  if(state.timers['tug:'+match])pauseClock(state.timers['tug:'+match]);invalidatePlaces('tug');
  const affected=match==='prelim'?['semi1','final']:['semi1','semi2'].includes(match)?['final']:[];
  affected.forEach(k=>delete state.timers['tug:'+k]);
  save();renderPoster();return true;
}
const live=createLiveDesk({getState:()=>state,schedule,esc,dot,teamLabel,save,refresh:()=>{if(dialog.open&&!(applyingRemote&&current==='sync'))renderPanel();},toast,confirmChange,recordWinner:recordTugWinner,invalidatePlaces,openPanel,saved:()=>saveAvailable,canEdit});
timeline=createGameTimeline({getState:()=>state,container:$('#game-grid')});
if(!localPreview){
  sync=createSyncService({...SYNC_CONFIG,
    onStatus(status){
      updateSyncLabels();
      const editable=canEdit();if(editable!==lastSyncEditable){lastSyncEditable=editable;live.refresh();}
    },
    onRemote(snapshot,{offsetMs}){
      if(!store.protected)beforeSync.capture(state);
      const merged=mergePublicState(snapshot,state,{offsetMs});
      applyingRemote=true;
      try{state=merged;save();renderPoster();live.refresh();}
      finally{applyingRemote=false;}
    },
    subscribe(onChange,onConnection){
      if(!globalThis.supabase?.createClient)return ()=>{};
      const client=globalThis.supabase.createClient(SYNC_CONFIG.url,SYNC_CONFIG.publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
      const channel=client.channel('sports-day-view').on('postgres_changes',{event:'UPDATE',schema:'public',table:'sports_day_events',filter:`id=eq.${SYNC_CONFIG.eventId}`},onChange).subscribe(status=>onConnection(status==='SUBSCRIBED'));
      return ()=>{void client.removeChannel(channel);};
    }
  });
}
async function syncAction(action){
  if(!sync)return;
  if(action==='share'){
    await navigator.clipboard.writeText('https://jason-ebit.github.io/cgs-sports-day/');toast('Viewing link copied.');return;
  }
  if(action==='refresh')await sync.refresh();
  if(action==='retry')await sync.flush();
  if(action==='claim')await sync.claimWriter();
  if(action==='transfer'){
    if(!await confirmChange('Move scorekeeping to this phone? The other phone will become a viewer. Pending results on the other phone stay there until reviewed.'))return;
    await sync.claimWriter({transfer:true});
  }
  if(action==='accept'){
    if(!await confirmChange('Load the confirmed shared scores and discard this phone’s pending results? Download this phone’s backup first to keep them.'))return;
    await sync.acceptRemote();
  }
  if(action==='release'||action==='logout'){
    if(sync.pending&&!await confirmChange('This phone has pending results. Download a backup before stopping, or keep this page open to sync them. Stop anyway?'))return;
    await (action==='logout'?sync.logout():sync.releaseWriter());
  }
  if(current==='sync')renderPanel();
}
document.addEventListener('submit',async event=>{
  if(event.target.id!=='scorekeeper-login')return;
  event.preventDefault();const form=event.target,button=form.querySelector('button'),email=form.elements.email.value,password=form.elements.password.value;
  form.elements.password.value='';button.disabled=true;button.textContent='Signing in…';
  try{await sync.login(email,password);await sync.claimWriter();if(current==='sync')renderPanel();}
  catch(error){toast(error.message);if(current==='sync'){if(sync.status.signedIn)renderPanel();else{button.disabled=false;button.textContent='Sign in & keep score';updateSyncLabels();}}}
});
document.addEventListener('click',async event=>{
  const el=event.target.closest('button,[data-open]');if(!el||el.disabled)return;
  try {
    if(el.dataset.syncAction){await syncAction(el.dataset.syncAction);return;}
    if(el.dataset.open){openPanel(el.dataset.open,el.dataset.initialTab||null);return;}
    if(el.dataset.department){department=el.dataset.department;renderPanel();return;}
    if(el.dataset.tab){tab=el.dataset.tab;renderPanel();return;}
    if(el.dataset.scoreOpen){openPanel('event:'+GAME_EVENTS[el.dataset.scoreOpen],gameDone(state,el.dataset.scoreOpen)?'scores':'timer');return;}
    if(el.dataset.assignSlot!==undefined){if(!requireEditor())return;assignSlot(state.tug,Number(el.dataset.assignSlot),el.dataset.teamId);Object.keys(state.timers).filter(k=>k.startsWith('tug:')).forEach(k=>delete state.timers[k]);invalidatePlaces('tug');changed();return;}
    if(el.dataset.borrowRounds){if(!requireEditor()||gameDone(state,'borrow'))return;state.borrow.rounds=Number(el.dataset.borrowRounds);if(state.borrow.rounds===6){if(state.timers['borrow:6'])pauseClock(state.timers['borrow:6']);if(state.activeKey==='borrow:6')state.activeKey=null;}invalidatePlaces('borrow');changed();return;}
    if(el.dataset.winner){if(await recordTugWinner(el.dataset.winner,el.dataset.teamId))renderPanel();return;}
    if(['random-draw','seed-draw','lock-draw','clear-matches'].includes(el.dataset.action)&&!requireEditor())return;
    if(['reset-all','restore-before-sync'].includes(el.dataset.action)&&!requireWriter())return;
    switch(el.dataset.action){
      case 'go-draw':openPanel('event:8','play');break;
      case 'random-draw':if(!state.tug.locked){state.tug.slots=shuffled(TEAM_IDS);clearTug(state.tug);Object.keys(state.timers).filter(k=>k.startsWith('tug:')).forEach(k=>delete state.timers[k]);invalidatePlaces('tug');changed();toast('Opponents drawn. Review and lock the draw.');}break;
      case 'seed-draw':if(!state.tug.locked){state.tug.slots=seededSlots(state.teams);clearTug(state.tug);Object.keys(state.timers).filter(k=>k.startsWith('tug:')).forEach(k=>delete state.timers[k]);invalidatePlaces('tug');changed();toast('Seeded draw ready. Review and lock it.');}break;
      case 'lock-draw':if(state.tug.locked){if(!await confirmChange('Unlock the draw? All match results and approved tug-of-war placements will be cleared.')||!requireEditor())return;state.tug.locked=false;clearTug(state.tug);Object.keys(state.timers).filter(k=>k.startsWith('tug:')).forEach(k=>delete state.timers[k]);invalidatePlaces('tug');}else if(validSlots(state.tug.slots))state.tug.locked=true;changed();break;
      case 'clear-matches':if(await confirmChange('Clear all tug-of-war winners and approved placements? The locked draw will stay.')&&requireEditor()){clearTug(state.tug);Object.keys(state.timers).filter(k=>k.startsWith('tug:')).forEach(k=>delete state.timers[k]);invalidatePlaces('tug');changed();}break;
      case 'export-json':downloadBlob(new Blob([store.backup(state)],{type:'application/json'}),'cg-sports-day-backup.json');break;
      case 'export-recovery':if(beforeSync.recoveryRaw!==null)downloadBlob(new Blob([beforeSync.recoveryRaw],{type:'application/json'}),'cg-sports-day-original-recovery.json');break;
      case 'recover-sync':if(await confirmChange('Replace the unreadable original-backup record with this phone’s current scores, then load confirmed shared scores? Download the recovery copy first. Any pending results will be discarded.')){beforeSync.recover(state);await sync.acceptRemote();renderPanel();}break;
      case 'export-before-sync':if(beforeSync.raw)downloadBlob(new Blob([beforeSync.raw],{type:'application/json'}),'cg-sports-day-before-sync.json');break;
      case 'restore-before-sync':if(beforeSync.raw&&await confirmChange('Replace shared scores with this phone’s original scores from before live sync? Everyone will see these results. Current local reminders will stay.')&&requireWriter()){state=mergePublicState(publicSnapshot(validateState(JSON.parse(beforeSync.raw))),state);store.replace(state);changed();toast('Original phone scores restored.');}break;
      case 'reset-all':if(await confirmChange('Reset the shared event for everyone, plus this phone’s private notes? Teams, scores, timers and draw will be cleared. Download a backup first to keep them.')&&requireWriter()){state=defaultState();store.replace(state);changed();toast('Event data reset.');}break;
      case 'download-media':if(mediaCanvas)mediaCanvas.toBlob(blob=>{if(blob)downloadBlob(blob,`cg-sports-day-${exportSize}.png`);else toast('Image export failed. Please try again.');},'image/png');break;
    }
  }catch(e){toast(e.message);}
});
document.addEventListener('change',async event=>{
  const el=event.target,d=el.dataset;if(el.closest('[data-live-event]'))return;let n=el.value===''?null:Number(el.value);
  try {
    if(el.type==='number'&&!el.validity.valid){toast('Enter a whole number within the field’s range.');renderPanel();return;}
    if(d.team!==undefined){if(['name','seed'].includes(d.field)&&!requireEditor()){renderPanel();return;}const t=state.teams[Number(d.team)];if(d.field==='name'&&!el.value.trim()){el.value=t.name;toast('Team names cannot be blank.');return;}t[d.field]=['seed','participants'].includes(d.field)?n:el.value.trim();changed(false);}
    else if(d.placement){if(!requireEditor())return;const p=state.placements[d.placement];if(n!==null&&p.values.some((v,i)=>i!==Number(d.row)&&v===n)){toast('Each team needs a unique final place.');renderPanel();return;}p.values[Number(d.row)]=n;changed();}
    else if(d.placementRule){if(!requireEditor())return;state.placements[d.placementRule].rule=el.value;changed();}
    else if(el.id==='export-size'){exportSize=el.value;renderPanel();}
    else if(el.id==='import-file'){
      if(!requireWriter())return;
      const file=el.files[0];if(!file)return;if(file.size>500000)throw Error('Backup is too large. Choose a Sports Day JSON backup.');
      const imported=validateState(JSON.parse(await file.text()));
      if(await confirmChange('Replace shared scores for everyone and this phone’s notes with the validated backup? Download your current backup first to keep it.')&&requireWriter()){state=imported;store.replace(state);changed();toast('Backup restored.');}
      el.value='';
    }
  }catch(e){toast(e instanceof SyntaxError?'That file is not valid JSON. No data was changed.':e.message);}
});
document.addEventListener('input',event=>{
  const d=event.target.dataset;
  if(d.team!==undefined&&['leader','name'].includes(d.field)){
    if(d.field==='name'&&!canEdit())return;
    const value=event.target.value.trim();
    if(d.field==='leader'||value){state.teams[Number(d.team)][d.field]=value;save();renderPoster();}
  }
  if(d.eventNote!==undefined){state.notes[d.eventNote]=event.target.value;save();}
  if(d.committeeNote){state.committeeNotes[d.committeeNote]||={};state.committeeNotes[d.committeeNote][d.noteKey]=event.target.value;save();}
});
$('#close-detail').addEventListener('click',closePanel);
dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closePanel();}});
dialog.addEventListener('close',restoreFocus);
let fitEnabled=true;
function fitPoster(){
  const viewport=$('#poster-viewport'),poster=$('#poster');
  document.body.classList.toggle('fit-home',fitEnabled);
  poster.style.removeProperty('transform');poster.style.removeProperty('width');
  if(!fitEnabled){viewport.style.removeProperty('height');timeline?.update();return;}
  const available=Math.max(420,innerHeight-$('.toolbar').offsetHeight-$('#home-shortcuts').offsetHeight);
  viewport.style.height=available+'px';
  timeline?.update();
}
$('#fit-toggle').addEventListener('click',()=>{fitEnabled=!fitEnabled;$('#fit-toggle').textContent=fitEnabled?'Expand layout':'Fit screen';$('#fit-toggle').setAttribute('aria-pressed',String(!fitEnabled));fitPoster();});
document.querySelectorAll('[data-home-view-button]').forEach(button=>button.addEventListener('click',()=>{document.body.dataset.homeView=button.dataset.homeViewButton;document.querySelectorAll('[data-home-view-button]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));fitPoster();}));
window.addEventListener('resize',fitPoster);document.fonts.ready.then(fitPoster);
renderPoster();live.tick();
if(sync)void sync.start();else{$('#sync-label').textContent='Local preview';}
if(!saveAvailable){$('#save-state').textContent='Existing backup protected';toast('Saved data could not be loaded. Export it before restoring or resetting.');}else $('#save-state').textContent='Saved on this device';

if ('serviceWorker' in navigator) {
  const register = () => navigator.serviceWorker.register('./sw.js').catch(() => {});
  if(document.readyState==='complete')register();
  else window.addEventListener('load', register, {once:true});
}
