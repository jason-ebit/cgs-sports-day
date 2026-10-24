const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const COLOUR_LABELS = Object.freeze({red:'Red',blue:'Blue',yellow:'Yellow',green:'Green',white:'White'});
const crown = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m4 9 7 5 5-9 5 9 7-5-3 16H7Z" fill="currentColor"/><path d="M8 29h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const closeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6M8 12h13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const fullscreenIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const shownNumber = value => Number.isFinite(value) ? String(value) : '—';

/** A read-only display. All scores, ordering and ranks come from the board model. */
export function renderGameScoreboard(board, {fullscreenAvailable=false,isFullscreen=false,connectionText='',connectionLive=false}={}) {
  const status = board.status === 'game-complete' ? 'Final results' : board.status === 'round-complete' ? 'Round complete' : board.status === 'ready' ? 'Ready' : 'Live standings';
  const rows = board.rows.map(row => {
    const colourLabel = COLOUR_LABELS[row.teamId] || '';
    const customName = colourLabel && row.name.trim().toLowerCase() !== colourLabel.toLowerCase();
    const colour = /^#[\da-f]{6}$/i.test(row.colour) ? row.colour : '#aebbb0';
    const ranked = Number.isInteger(row.rank) && row.rank > 0;
    const leader = row.rank === 1 && Number.isFinite(row.score);
    const secondary = [customName ? `${colourLabel} team` : '', row.detail].filter(Boolean).join(' · ');
    return `<li class="scoreboard-row${leader?' is-leader':''}${row.pending?' is-pending':''}" style="--scoreboard-team:${colour}" data-scoreboard-team="${escapeHTML(row.teamId)}">
      <span class="scoreboard-rank" aria-label="${ranked?`Rank ${row.rank}`:'Unranked'}">${leader?`<span class="scoreboard-crown">${crown}</span>`:''}<span>${ranked?row.rank:'—'}</span></span>
      <div class="scoreboard-team"><strong class="scoreboard-team-name" title="${escapeHTML(row.name)}">${escapeHTML(row.name)}</strong>${secondary?`<span class="scoreboard-team-detail" title="${escapeHTML(secondary)}">${escapeHTML(secondary)}</span>`:''}</div>
      <div class="scoreboard-result"><strong class="scoreboard-score${row.score>=100?' has-three-digits':''}" aria-label="${escapeHTML(board.scoreLabel)}: ${Number.isFinite(row.score)?escapeHTML(row.score):'not yet saved'}">${shownNumber(row.score)}</strong>${Number.isFinite(row.roundScore)?`<span class="scoreboard-round-score" title="${escapeHTML(board.roundLabel)}">${board.game==='tug'?(row.roundScore===1?'Won match':'Lost match'):`${escapeHTML(board.roundLabel)} <b>${shownNumber(row.roundScore)}</b>`}</span>`:''}</div>
    </li>`;
  }).join('');
  return `<section class="scoreboard-screen" aria-label="${escapeHTML(board.title)} scoreboard">
    <header class="scoreboard-header">
      <div class="scoreboard-masthead"><span class="scoreboard-brand">CG OLYMPICS</span>${connectionText?`<span class="scoreboard-connection${connectionLive?' is-live':''}"><span aria-hidden="true"></span>${escapeHTML(connectionText)}</span>`:''}</div>
      <nav class="scoreboard-controls" aria-label="Scoreboard controls">${fullscreenAvailable?`<button type="button" class="scoreboard-control scoreboard-fullscreen" data-scoreboard-action="fullscreen" aria-label="${isFullscreen?'Exit full screen':'Full screen'}">${fullscreenIcon}<span>${isFullscreen?'Exit full screen':'Full screen'}</span></button>`:''}<button type="button" class="scoreboard-control scoreboard-back" data-scoreboard-action="close">${closeIcon}<span>Back to scoring</span></button></nav>
      <div class="scoreboard-heading"><div class="scoreboard-heading-copy"><h2 id="scoreboard-title">${escapeHTML(board.title)}</h2><div class="scoreboard-stage"><span>${escapeHTML(board.stageLabel)}</span><span class="scoreboard-status${board.status==='game-complete'?' is-complete':''}">${status}</span></div></div><div class="scoreboard-timer" data-scoreboard-timer data-timer-state="ready"><span class="scoreboard-timer-label">Time remaining</span><span class="scoreboard-clock-status" data-scoreboard-clock-status>Ready</span><output class="scoreboard-clock" data-scoreboard-clock role="timer" aria-label="Time remaining" aria-live="off" data-clock-length="5">00:00</output></div></div>
    </header>
    <div class="scoreboard-table" role="group" aria-label="Teams ranked by ${escapeHTML(board.scoreLabel)}">
      <div class="scoreboard-column-head" aria-hidden="true"><span>Rank</span><span>Team</span><span>${escapeHTML(board.scoreLabel)}</span></div>
      <ol class="scoreboard-rows" aria-label="Team standings">${rows}</ol>
    </div>
    <footer class="scoreboard-footer"><span>${escapeHTML(board.summaryLabel)}</span><span>OLYMPICS · OCT 25</span></footer>
  </section>`;
}
