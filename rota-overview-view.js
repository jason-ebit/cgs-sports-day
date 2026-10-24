const e = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const labelFor = department => ({director:'Judge / scores','first-aid':'First aid',judges:'Assistant judge',equipment:'Equipment','food-water':'Food & water',comms:'Comm',warmup:'Warmup','team-leaders':'Team leaders'})[department];
const roleName = item => labelFor(item.department) || item.departmentName || item.department;
const personName = person => `<span class="duty-name">${e(person.name)}</span>`;
const names = people => (people || []).map(personName).join('');
const sameStaff = (left, right) => left.length === right.length && left.every(person => right.some(other => other.id === person.id && other.name === person.name && other.status !== 'cover'));

function timing(shift) {
  const start = shift.plannedStart || shift.start, end = shift.plannedEnd || shift.end;
  if (start && end) return `<span class="duty-shift-time">${e(start)}–${e(end)} <small>planned</small></span>`;
  if (shift.blockStart && shift.blockEnd) return `<span class="duty-shift-time duty-shift-time-block">Within ${e(shift.blockStart)}–${e(shift.blockEnd)} <small>shared block</small></span>`;
  return '<span class="duty-shift-time"><small>Follow the game’s rounds</small></span>';
}

function renderHandover(shift) {
  const handover = shift.handover;
  if (!handover?.nextShiftId) return '';
  const changes = (handover.departments || []).filter(item => item.incoming?.length || item.outgoing?.length);
  const instruction = changes.length ? changes.map(item => {
    const incoming = item.incoming || [], outgoing = item.outgoing || [];
    const text = incoming.length && outgoing.length ? `${incoming.map(person=>person.name).join(', ')} ${incoming.length===1?'takes':'take'} over from ${outgoing.map(person=>person.name).join(', ')}`
      : incoming.length ? `${incoming.map(person=>person.name).join(', ')} ${incoming.length===1?'comes':'come'} on duty`
      : `${outgoing.map(person=>person.name).join(', ')} ${outgoing.length===1?'finishes':'finish'} duty; confirm cover first`;
    return `<li><strong>${e(roleName(item))}</strong><span>${e(text)}</span></li>`;
  }).join('') : '<li class="duty-handover-same">Same crew for the next shift.</li>';
  const nextLabel = handover.crossGame ? `Next game: ${handover.nextGameLabel || 'next game'} · ${handover.nextLabel || 'first shift'}` : `Next: ${handover.nextLabel || 'next shift'}`;
  return `<aside class="duty-handover" aria-label="Handover after ${e(shift.label)}"><div class="duty-handover-heading"><strong>${e(nextLabel)}</strong>${shift.handoverSeconds && !handover.crossGame ? `<span>${e(shift.handoverSeconds)} sec handover</span>` : ''}</div><ul>${instruction}</ul></aside>`;
}

function renderShift(shift, game, fixedPosts, editable) {
  const stations = (shift.stations || []).filter(station => {
    if (!station.minimum && !station.staff?.length && !station.pendingStaff?.length && !station.shortfall) return false;
    return !fixedPosts.some(post => post.department === station.department && !station.shortfall && !station.pendingStaff?.length && sameStaff(post.staff || [], station.staff || []));
  });
  const warnings = [...new Set(shift.warnings || [])];
  const unset = shift.unassigned || [];
  return `<li class="duty-shift" data-duty-shift="${e(shift.id)}"><header class="duty-shift-heading"><h4>${e(shift.label)}</h4>${timing(shift)}</header>
    <dl class="duty-stations">${stations.map(station=>`<div class="duty-station${station.shortfall ? ' duty-station-missing' : ''}"><dt>${e(roleName(station))}</dt><dd>${station.staff?.length ? `<span class="duty-names">${names(station.staff)}</span>` : '<span class="duty-empty">No one assigned</span>'}${(station.pendingStaff || []).map(person=>`<small class="duty-pending-cover">${e(person.name)}${person.coveringName ? ` covering ${e(person.coveringName)}` : ''}: ${person.confirmation==='training'?'first aid and CPR skills need confirmation':'judge appointment needs confirmation'}</small>`).join('')}${station.shortfall ? `<small class="duty-shortfall">${e(station.shortfall)} ${station.shortfall===1?'person':'people'} needed</small>` : ''}</dd></div>`).join('')}</dl>
    <div class="duty-available"><strong>Available to play</strong><span class="duty-names">${shift.freeToPlay?.length ? names(shift.freeToPlay) : '<span class="duty-empty">No one marked available</span>'}</span></div>
    ${unset.length ? `<p class="duty-unassigned"><strong>Not assigned:</strong> ${e(unset.map(person=>person.name).join(', '))}</p>` : ''}
    ${shift.blockedFromPlay?.length ? `<p class="duty-unassigned"><strong>Needs cover before playing:</strong> ${e(shift.blockedFromPlay.map(person=>person.name).join(', '))}</p>` : ''}
    ${warnings.length ? `<ul class="duty-warnings">${warnings.map(warning=>`<li>${e(warning)}</li>`).join('')}</ul>` : ''}
    ${renderHandover(shift)}
    ${editable && shift.roundKeys?.length ? `<button type="button" class="duty-edit-shift" data-rota-edit-round="${e(shift.roundKeys[0])}" data-rota-edit-game="${e(game.id)}">Edit this shift <span aria-hidden="true">↗</span></button>` : ''}
  </li>`;
}

/** Read-only named crews. Every edit button points to an existing rota round. */
export function renderDutyOverview(model, {editable = false, openGameId = 'borrow'} = {}) {
  const games = model?.games || [], fixedPosts = model?.fixedPosts || [];
  const openedGame = games.some(game=>game.id===openGameId) ? openGameId : games[0]?.id;
  const warnings = [...new Set(model?.warnings || [])];
  return `<section class="duty-overview" aria-label="Committee duties by game"><p class="duty-intro">Named duty crews and handovers for each game.</p>
    ${fixedPosts.length ? `<aside class="duty-fixed" aria-label="On duty for every game shift"><h3>Every game shift</h3><dl>${fixedPosts.map(post=>`<div><dt>${e(roleName(post))}</dt><dd class="duty-names">${names(post.staff)}</dd></div>`).join('')}</dl></aside>` : ''}
    ${model?.warmup?.staff?.length ? `<p class="duty-warmup"><strong>Warm-up lead</strong><span>${e(model.warmup.staff.map(person=>person.name).join(', '))}${model.warmup.start&&model.warmup.end?` · ${e(model.warmup.start)}–${e(model.warmup.end)}`:' · before the games'}</span></p>` : ''}
    ${warnings.length ? `<ul class="duty-warnings duty-overview-warnings">${warnings.map(warning=>`<li>${e(warning)}</li>`).join('')}</ul>` : ''}
    <div class="duty-games">${games.map((game,index)=>`<details class="duty-game" data-rota-overview-game="${e(game.id)}"${game.id===openedGame?' open':''}><summary><span class="duty-game-number" aria-hidden="true">${index+1}</span><span class="duty-game-title">${e(game.label)}<small>${game.shifts?.length || 0} ${(game.shifts?.length || 0)===1?'shift':'shifts'}</small></span><span class="duty-game-chevron" aria-hidden="true">⌄</span></summary><ol class="duty-shifts">${(game.shifts || []).map(shift=>renderShift(shift,game,fixedPosts,editable)).join('') || '<li class="duty-shift duty-empty">No shifts set for this game.</li>'}</ol></details>`).join('')}</div>
    ${games.length ? '<p class="duty-footnote">Swap after the next crew is ready. Available players join when their team is called. Confirm teams and Cavalry divisions before play.</p>' : '<p class="duty-empty">No games to show.</p>'}
  </section>`;
}
