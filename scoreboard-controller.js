import { buildGameScoreboard, buildGameScoreboardTimer, followGameScoreboardContext } from './scoreboard-model.js?v=63';
import { renderGameScoreboard } from './scoreboard-view.js?v=63';

// Presentation state stays on this screen. Opening a board never edits results or clocks.
export function createScoreboard({getState,getStatus=()=>null,now=()=>Date.now(),toast=()=>{},document:doc=globalThis.document}={}) {
  const dialog=doc.querySelector('#scoreboard-dialog'),body=doc.querySelector('#scoreboard-body');
  let context=null,opener=null,markup='',following=true;
  const inFullscreen=()=>doc.fullscreenElement===body;
  const fullscreenAvailable=()=>doc.fullscreenEnabled===true&&typeof body.requestFullscreen==='function';
  function connection() {
    const status=getStatus();
    if(status?.localPreview)return {connectionText:'Local preview',connectionLive:false};
    if(status?.phase==='conflict'||status?.storageError)return {connectionText:'Sync needs attention',connectionLive:false};
    if(status?.pending)return {connectionText:status.connected?'Saving results…':'Offline · waiting to sync',connectionLive:false};
    if(status?.connected)return {connectionText:'LIVE',connectionLive:true};
    return {connectionText:status?.phase==='connecting'?'Connecting…':'Offline · saved scores',connectionLive:false};
  }
  function updateTimer(state) {
    const timer=buildGameScoreboardTimer(state,context,now());
    if(!timer)return;
    const surface=body.querySelector('[data-scoreboard-timer]');
    const digits=body.querySelector('[data-scoreboard-clock]');
    const status=body.querySelector('[data-scoreboard-clock-status]');
    if(surface){
      if(surface.dataset.timerState!==timer.status)surface.dataset.timerState=timer.status;
      if(surface.dataset.timerKey!==timer.key)surface.dataset.timerKey=timer.key;
    }
    if(digits){
      if(digits.textContent!==timer.text)digits.textContent=timer.text;
      const length=String(timer.text.length);
      if(digits.dataset.clockLength!==length)digits.dataset.clockLength=length;
    }
    if(status&&status.textContent!==timer.statusLabel)status.textContent=timer.statusLabel;
  }
  function refresh() {
    if(!dialog.open||!context)return;
    const state=getState();
    if(following)context=followGameScoreboardContext(state,context);
    const board=buildGameScoreboard(state,context);
    if(!board)return;
    const next=renderGameScoreboard(board,{fullscreenAvailable:fullscreenAvailable(),isFullscreen:inFullscreen(),...connection()});
    if(next!==markup){
      const focus=dialog.contains(doc.activeElement)?doc.activeElement?.dataset?.scoreboardAction:null;
      body.innerHTML=next;markup=next;
      if(focus)body.querySelector(`[data-scoreboard-action="${focus}"]`)?.focus({preventScroll:true});
    }
    updateTimer(state);
  }
  // Use the live desk's existing tick. Counting down never rebuilds the rows,
  // steals focus, starts another clock or writes shared state.
  function tick() {
    if(!dialog.open||!context)return;
    const state=getState();
    if(following&&followGameScoreboardContext(state,context).key!==context.key){refresh();return;}
    updateTimer(state);
  }
  function open(nextContext) {
    if(!nextContext?.game)return;
    if(!dialog.open)opener=doc.activeElement;
    context={...nextContext};
    following=nextContext.review!==true;
    if(!dialog.open)dialog.showModal();
    refresh();
    body.querySelector('[data-scoreboard-action="close"]')?.focus({preventScroll:true});
  }
  function restoreFocus() {
    if(opener?.isConnected&&!opener.disabled){opener.focus({preventScroll:true});return;}
    const live=doc.querySelector('#live-dialog');
    const target=live?.open?doc.querySelector('#close-live'):doc.querySelector('#close-detail');
    target?.focus({preventScroll:true});
  }
  function releaseFullscreen() {
    if(inFullscreen()&&typeof doc.exitFullscreen==='function'){
      try { Promise.resolve(doc.exitFullscreen()).catch(()=>{}); } catch {}
    }
  }
  function close() {if(dialog.open)dialog.close();}
  async function fullscreen() {
    if(!dialog.open)return;
    try {
      if(inFullscreen())await doc.exitFullscreen();
      else if(fullscreenAvailable())await body.requestFullscreen();
      else return;
    } catch {
      toast('The scoreboard still fills this screen. Browser full screen is unavailable here.');
    }
    // A browser may resolve its permission request after the board was closed.
    if(!dialog.open)releaseFullscreen();
    else refresh();
  }
  dialog.addEventListener('click',event=>{
    const control=event.target.closest('[data-scoreboard-action]');
    if(!control||control.disabled)return;
    if(control.dataset.scoreboardAction==='close')close();
    if(control.dataset.scoreboardAction==='fullscreen')void fullscreen();
  });
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('close',()=>{
    context=null;markup='';releaseFullscreen();restoreFocus();opener=null;
  });
  doc.addEventListener('fullscreenchange',()=>{if(dialog.open)refresh();});
  return {open,close,refresh,tick,get isOpen(){return dialog.open;}};
}
