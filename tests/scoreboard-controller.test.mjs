import assert from 'node:assert/strict';
import { createScoreboard } from '../scoreboard-controller.js';
import { defaultState } from '../model.js';
import { makeClock, startClock, pauseClock, addTime } from '../timer-model.js';
import { publicSnapshot, mergePublicState } from '../sync.js';

// These doubles provide only the dialog, focus and Fullscreen API used by the
// controller. Standings and rendered controls come from the real model/view.
class Element {
  constructor(document, { parent = null, action = null } = {}) {
    this.ownerDocument = document;
    this.parentElement = parent;
    this.dataset = action ? { scoreboardAction: action } : {};
    this.listeners = new Map();
    this.disabled = false;
    this.isConnected = true;
    this.open = false;
    this.closeCalls = 0;
    this.showCalls = 0;
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  emit(type, values = {}) {
    const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...values };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
  focus() { this.ownerDocument.activeElement = this; }
  contains(element) {
    for (let current = element; current; current = current.parentElement) if (current === this) return true;
    return false;
  }
  closest(selector) {
    if (selector === '[data-scoreboard-action]' && this.dataset.scoreboardAction) return this;
    return this.parentElement?.closest(selector) || null;
  }
  showModal() { this.open = true; this.showCalls++; }
  close() {
    if (!this.open) return;
    this.open = false;
    this.closeCalls++;
    this.emit('close');
  }
}

class ScoreboardBody extends Element {
  constructor(document, options) {
    super(document, options);
    this.controls = new Map();
    this.timerNodes = new Map();
    this.writes = 0;
    this.markup = '';
  }
  set innerHTML(value) {
    for (const control of this.controls.values()) control.isConnected = false;
    this.controls.clear();
    this.markup = value;
    this.writes++;
    this.timerNodes.clear();
    for(const name of ['timer','clock','clock-status']){
      const selector=`[data-scoreboard-${name}]`;
      if(!value.includes(`data-scoreboard-${name}`))continue;
      const node=new Element(this.ownerDocument,{parent:this});
      node.textContent=name==='clock'?'00:00':name==='clock-status'?'Ready':'';
      this.timerNodes.set(selector,node);
    }
    for (const match of value.matchAll(/<button\b([^>]*)>/g)) {
      const action = match[1].match(/data-scoreboard-action="([^"]+)"/)?.[1];
      if (!action) continue;
      const control = new Element(this.ownerDocument, { parent: this, action });
      control.disabled = /\bdisabled(?:\s|=|$)/.test(match[1]);
      this.controls.set(action, control);
    }
  }
  get innerHTML() { return this.markup; }
  querySelector(selector) {
    if(this.timerNodes.has(selector))return this.timerNodes.get(selector);
    const action = selector.match(/^\[data-scoreboard-action="([^"]+)"\]$/)?.[1];
    return this.controls.get(action) || null;
  }
}

function fixture({ fullscreen = true } = {}) {
  const document = new Element(null);
  document.ownerDocument = document;
  document.fullscreenEnabled = fullscreen;
  document.fullscreenElement = null;
  const dialog = new Element(document);
  const body = new ScoreboardBody(document, { parent: dialog });
  const live = new Element(document), detail = new Element(document);
  live.open = true;
  detail.open = true;
  const closeLive = new Element(document, { parent: live });
  const closeDetail = new Element(document, { parent: detail });
  const opener = new Element(document, { parent: live });
  opener.focus();
  const nodes = new Map([
    ['#scoreboard-dialog', dialog], ['#scoreboard-body', body],
    ['#live-dialog', live], ['#detail-dialog', detail],
    ['#close-live', closeLive], ['#close-detail', closeDetail],
  ]);
  document.querySelector = selector => nodes.get(selector) || null;
  let state = defaultState(), status = { connected: true, phase: 'watching', pending: 0 };
  let stateReads = 0, fullscreenRequests = 0, fullscreenExits = 0, now = 1000;
  body.requestFullscreen = async () => {
    fullscreenRequests++;
    document.fullscreenElement = body;
    document.emit('fullscreenchange');
  };
  document.exitFullscreen = async () => {
    fullscreenExits++;
    document.fullscreenElement = null;
    document.emit('fullscreenchange');
  };
  const messages = [];
  const board = createScoreboard({
    document,
    getState: () => { stateReads++; return state; },
    getStatus: () => status,
    now: () => now,
    toast: message => messages.push(message),
  });
  return {
    document, dialog, body, live, detail, closeLive, closeDetail, opener, board, messages,
    get state() { return state; }, set state(value) { state = value; },
    get status() { return status; }, set status(value) { status = value; },
    get stateReads() { return stateReads; },
    get fullscreenRequests() { return fullscreenRequests; },
    get fullscreenExits() { return fullscreenExits; },
    advance: ms => now += ms,
    setNow: value => now = value,
    click(action) {
      const control = body.controls.get(action);
      assert.ok(control, `Expected a ${action} control`);
      dialog.emit('click', { target: control });
      return control;
    },
  };
}

const tests = [];
const test = (name, run) => tests.push({ name, run });
const setColumn = (state, round, values) => values.forEach((value, index) => { state.borrow.scores[index][round] = value; });
const control = (f, action) => f.body.querySelector(`[data-scoreboard-action="${action}"]`);
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
const rows = f => [...f.body.innerHTML.matchAll(/<li\b[^>]*data-scoreboard-team="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map(([, team, html]) => ({
  team,
  rank: Number(html.match(/aria-label="Rank (\d+)"/)?.[1]) || null,
  score: html.match(/class="scoreboard-score"[^>]*>([^<]*)<\/strong>/)?.[1],
}));

test('Opening the scoreboard preserves the underlying scoring dialogs, clocks and results', () => {
  const f = fixture();
  setColumn(f.state, 0, [5, 4, 3, 2, 0]);
  f.state.timers['borrow:1'] = makeClock(90);
  startClock(f.state.timers, 'borrow:1', 1000);
  f.state.activeKey = 'borrow:1';
  f.state.committeeMembers.comms[0] = 'Unrelated saved name';
  const before = structuredClone(f.state);
  f.board.open({ game: 'borrow', key: 'borrow:1', round: 1 });
  assert.equal(f.board.isOpen, true);
  assert.equal(f.dialog.showCalls, 1);
  assert.equal(f.live.open, true);
  assert.equal(f.detail.open, true);
  assert.equal(f.live.closeCalls + f.detail.closeCalls, 0);
  assert.equal(f.document.activeElement, control(f, 'close'));
  assert.deepEqual(f.state, before);
});

test('Back to scoring closes only the board and returns focus to its original opener', () => {
  const f = fixture();
  f.board.open({ game: 'borrow', round: 0 });
  // Changing the displayed game while open must not replace the real opener.
  control(f, 'fullscreen').focus();
  f.board.open({ game: 'relay', round: 0 });
  assert.equal(f.dialog.showCalls, 1);
  f.click('close');
  assert.equal(f.board.isOpen, false);
  assert.equal(f.document.activeElement, f.opener);
  assert.equal(f.live.open, true);
  assert.equal(f.detail.open, true);
  f.board.close();
  assert.equal(f.dialog.closeCalls, 1);
});

test('Escape cancels just the board and restores the scoring control', () => {
  const f = fixture();
  f.board.open({ game: 'borrow', round: 0 });
  const event = f.dialog.emit('cancel');
  assert.equal(event.defaultPrevented, true);
  assert.equal(f.board.isOpen, false);
  assert.equal(f.document.activeElement, f.opener);
  assert.equal(f.live.open, true);
  assert.equal(f.detail.open, true);
});

test('A removed or disabled opener falls back to the still-open match dialog', () => {
  for (const property of ['isConnected', 'disabled']) {
    const f = fixture();
    f.board.open({ game: 'borrow', round: 0 });
    f.opener[property] = property === 'disabled';
    f.board.close();
    assert.equal(f.document.activeElement, f.closeLive);
  }
});

test('Closing returns to the event detail when its match dialog has already closed', () => {
  const f = fixture();
  f.board.open({ game: 'borrow', round: 0 });
  f.opener.isConnected = false;
  f.live.open = false;
  f.board.close();
  assert.equal(f.document.activeElement, f.closeDetail);
  assert.equal(f.detail.open, true);
});

test('Refresh reads replacement shared state and shows the newest score ordering without editing it', () => {
  const f = fixture();
  setColumn(f.state, 0, [5, 4, 3, 2, 0]);
  f.board.open({ game: 'borrow', round: 0 });
  assert.deepEqual(rows(f).map(row => row.team), ['red', 'blue', 'yellow', 'green', 'white']);
  const replacement = structuredClone(f.state);
  replacement.teams[1].name = 'Blue Rockets';
  setColumn(replacement, 0, [1, 5, 2, 4, 0]);
  f.state = replacement;
  const before = structuredClone(replacement);
  f.board.refresh();
  assert.deepEqual(rows(f).map(row => row.team), ['blue', 'green', 'yellow', 'red', 'white']);
  assert.deepEqual(rows(f).map(row => row.rank), [1, 2, 3, 4, 5]);
  assert.deepEqual(rows(f).map(row => row.score), ['5', '4', '2', '1', '0']);
  assert.match(f.body.innerHTML, /Blue Rockets/);
  assert.deepEqual(f.state, before);
});

test('The public board escapes team names and never displays private rosters or notes', () => {
  const f = fixture();
  f.state.teams[0].name = '<img src=x onerror="alert(1)">';
  f.state.teams[0].leader = 'PRIVATE_LEADER';
  f.state.committeeMembers.comms[0] = 'PRIVATE_COMMITTEE_NAME';
  f.state.notes[0] = 'PRIVATE_EVENT_NOTE';
  f.state.committeeNotes.comms = 'PRIVATE_COMMITTEE_NOTE';
  const before = structuredClone(f.state);
  f.board.open({ game: 'borrow', round: 0 });
  assert.match(f.body.innerHTML, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(f.body.innerHTML, /<img\b/);
  assert.doesNotMatch(f.body.innerHTML, /PRIVATE_LEADER|PRIVATE_COMMITTEE_NAME|PRIVATE_EVENT_NOTE|PRIVATE_COMMITTEE_NOTE/);
  assert.deepEqual(f.state, before);
});

test('Connection changes replace LIVE with saving, offline, connecting or attention states', () => {
  const f = fixture();
  f.board.open({ game: 'borrow', round: 0 });
  assert.match(f.body.innerHTML, /scoreboard-connection is-live/);
  assert.match(f.body.innerHTML, />LIVE<\/span>/);
  const cases = [
    [{ connected: true, pending: 1 }, 'Saving results…'],
    [{ connected: false, pending: 1 }, 'Offline · waiting to sync'],
    [{ connected: false, phase: 'connecting' }, 'Connecting…'],
    [{ connected: false, phase: 'offline' }, 'Offline · saved scores'],
    [{ connected: true, phase: 'conflict' }, 'Sync needs attention'],
    [{ connected: true, storageError: true }, 'Sync needs attention'],
    [{ localPreview: true, connected: true }, 'Local preview'],
  ];
  const before = structuredClone(f.state);
  for (const [status, label] of cases) {
    f.status = status;
    f.board.refresh();
    assert.ok(f.body.innerHTML.includes(label), `Missing connection label: ${label}`);
    assert.doesNotMatch(f.body.innerHTML, /scoreboard-connection is-live/);
  }
  assert.deepEqual(f.state, before);
});

test('Identical standings never replace the controls, and changed standings preserve control focus', () => {
  const f = fixture();
  f.board.open({ game: 'borrow', round: 0 });
  const fullscreenButton = control(f, 'fullscreen');
  fullscreenButton.focus();
  const writes = f.body.writes;
  for (let index = 0; index < 3; index++) f.board.refresh();
  assert.equal(f.body.writes, writes);
  assert.equal(control(f, 'fullscreen'), fullscreenButton);
  assert.equal(f.document.activeElement, fullscreenButton);
  f.state.teams[0].name = 'New team name';
  f.board.refresh();
  assert.equal(f.body.writes, writes + 1);
  assert.equal(fullscreenButton.isConnected, false);
  assert.equal(f.document.activeElement, control(f, 'fullscreen'));
});

test('A hidden board neither renders nor reads shared state until it is opened again', () => {
  const f = fixture();
  f.board.refresh();
  assert.equal(f.stateReads, 0);
  f.board.open({ game: 'borrow', round: 0 });
  f.board.close();
  const writes = f.body.writes, reads = f.stateReads;
  f.board.refresh();
  assert.equal(f.body.writes, writes);
  assert.equal(f.stateReads, reads);
  const nextOpener = new Element(f.document, { parent: f.live });
  nextOpener.focus();
  f.board.open({ game: 'borrow', round: 0 });
  f.board.close();
  assert.equal(f.document.activeElement, nextOpener);
});

test('Native Full screen requests the scoreboard body, supports exiting and keeps scoring open', async () => {
  const f = fixture();
  f.board.open({ game: 'borrow', round: 0 });
  const before = structuredClone(f.state);
  f.click('fullscreen');
  await flush();
  assert.equal(f.fullscreenRequests, 1);
  assert.equal(f.document.fullscreenElement, f.body);
  assert.match(f.body.innerHTML, /Exit full screen/);
  assert.equal(f.board.isOpen, true);
  assert.equal(f.live.open, true);
  f.click('fullscreen');
  await flush();
  assert.equal(f.fullscreenExits, 1);
  assert.equal(f.document.fullscreenElement, null);
  assert.equal(f.board.isOpen, true);
  assert.deepEqual(f.state, before);
});

test('Without the Fullscreen API, the full-viewport scoreboard still opens and closes normally', () => {
  for (const support of ['disabled', 'missing']) {
    const f = fixture({ fullscreen: support !== 'disabled' });
    if (support === 'missing') delete f.body.requestFullscreen;
    f.board.open({ game: 'borrow', round: 0 });
    assert.equal(f.board.isOpen, true);
    assert.match(f.body.innerHTML, /class="scoreboard-screen"/);
    assert.ok(!control(f, 'fullscreen') || control(f, 'fullscreen').disabled);
    assert.ok(control(f, 'close'));
    assert.equal(f.fullscreenRequests, 0);
    f.click('close');
    assert.equal(f.document.activeElement, f.opener);
  }
});

test('A rejected Full screen request gives visible feedback while leaving the board usable', async () => {
  const f = fixture();
  f.body.requestFullscreen = () => Promise.reject(new Error('Permission denied'));
  f.board.open({ game: 'borrow', round: 0 });
  f.click('fullscreen');
  await flush();
  assert.equal(f.board.isOpen, true);
  assert.equal(f.live.open, true);
  assert.equal(f.document.fullscreenElement, null);
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0], /full screen.*unavailable/i);
  f.click('close');
  assert.equal(f.document.activeElement, f.opener);
});

test('Closing exits only this scoreboard fullscreen and never another element fullscreen', async () => {
  const owned = fixture();
  owned.board.open({ game: 'borrow', round: 0 });
  owned.click('fullscreen');
  await flush();
  owned.board.close();
  await flush();
  assert.equal(owned.fullscreenExits, 1);
  assert.equal(owned.document.fullscreenElement, null);
  const external = fixture();
  const unrelated = new Element(external.document);
  external.document.fullscreenElement = unrelated;
  external.board.open({ game: 'borrow', round: 0 });
  external.board.close();
  await flush();
  assert.equal(external.fullscreenExits, 0);
  assert.equal(external.document.fullscreenElement, unrelated);
});

test('A Full screen request resolving after close is cleaned up without reopening the board', async () => {
  const f = fixture();
  let grant;
  f.body.requestFullscreen = () => new Promise(resolve => {
    grant = () => {
      f.document.fullscreenElement = f.body;
      f.document.emit('fullscreenchange');
      resolve();
    };
  });
  f.board.open({ game: 'borrow', round: 0 });
  f.click('fullscreen');
  f.board.close();
  const writes = f.body.writes;
  assert.equal(f.fullscreenExits, 0);
  grant();
  await flush();
  assert.equal(f.board.isOpen, false);
  assert.equal(f.document.fullscreenElement, null);
  assert.equal(f.fullscreenExits, 1);
  assert.equal(f.body.writes, writes);
  assert.equal(f.document.activeElement, f.opener);
});

test('Leaving browser Full screen updates the control without dismissing the board', async () => {
  const f = fixture();
  f.board.open({ game: 'borrow', round: 0 });
  f.click('fullscreen');
  await flush();
  assert.match(f.body.innerHTML, /Exit full screen/);
  await f.document.exitFullscreen();
  assert.equal(f.board.isOpen, true);
  assert.doesNotMatch(f.body.innerHTML, /Exit full screen/);
  assert.match(f.body.innerHTML, /aria-label="Full screen"/);
});

test('The normal board follows new completed rounds while an explicit review remains pinned', () => {
  for (const review of [false, true]) {
    const f = fixture();
    setColumn(f.state, 0, [5, 4, 3, 2, 0]);
    f.board.open({ game: 'borrow', key: 'borrow:0', round: 0, ...(review ? { review: true } : {}) });
    assert.match(f.body.innerHTML, /Round 1 \/ 6/);
    setColumn(f.state, 1, [0, 5, 3, 2, 4]);
    const before = structuredClone(f.state);
    f.board.refresh();
    if (review) {
      assert.match(f.body.innerHTML, /Round 1 \/ 6/);
      assert.deepEqual(rows(f).map(row => row.team), ['red', 'blue', 'yellow', 'green', 'white']);
      assert.equal(rows(f)[0].score, '5');
    } else {
      assert.match(f.body.innerHTML, /Round 2 \/ 6/);
      assert.equal(rows(f)[0].team, 'blue');
      assert.equal(rows(f)[0].score, '9');
    }
    assert.deepEqual(f.state, before);
  }
});

test('The normal board follows the ongoing same-game round without stopping its clock', () => {
  const f = fixture();
  setColumn(f.state, 0, [5, 4, 3, 2, 0]);
  f.board.open({ game: 'borrow', key: 'borrow:0', round: 0 });
  f.state.timers['borrow:1'] = makeClock(90);
  startClock(f.state.timers, 'borrow:1', 1000);
  f.state.activeKey = 'borrow:1';
  const before = structuredClone(f.state);
  f.board.refresh();
  assert.match(f.body.innerHTML, /Round 2 \/ 6/);
  assert.match(f.body.innerHTML, /Live standings/);
  assert.deepEqual(f.state, before);
});

const countdown=f=>f.body.querySelector('[data-scoreboard-clock]');
const clockStatus=f=>f.body.querySelector('[data-scoreboard-clock-status]');
const timerSurface=f=>f.body.querySelector('[data-scoreboard-timer]');

test('A running audience countdown updates in place without rebuilding rows, moving focus or changing its clock', async () => {
  const f=fixture();
  f.state.timers['borrow:0']=makeClock(90);
  startClock(f.state.timers,'borrow:0',1000);f.state.activeKey='borrow:0';
  f.board.open({game:'borrow',key:'borrow:0'});
  assert.equal(countdown(f).textContent,'01:30');
  assert.equal(clockStatus(f).textContent,'LIVE');
  assert.equal(timerSurface(f).dataset.timerKey,'borrow:0');
  f.click('fullscreen');await flush();
  const focused=control(f,'close');focused.focus();
  const writes=f.body.writes,before=structuredClone(f.state),digits=countdown(f);
  f.advance(10250);f.board.tick();
  assert.equal(digits.textContent,'01:20');
  assert.equal(countdown(f),digits);
  assert.equal(f.body.writes,writes);
  assert.equal(f.document.activeElement,focused);
  assert.equal(f.document.fullscreenElement,f.body);
  f.board.refresh();
  assert.equal(f.body.writes,writes,'Ordinary live refresh must not rebuild just because seconds changed');
  assert.deepEqual(f.state,before);
});

test('Pause, added time, resume and replacement shared clocks all reach the open scoreboard', () => {
  const f=fixture();
  f.state.timers['borrow:0']=makeClock(90);
  startClock(f.state.timers,'borrow:0',1000);f.state.activeKey='borrow:0';
  f.board.open({game:'borrow',key:'borrow:0'});
  f.advance(10000);pauseClock(f.state.timers['borrow:0'],11000);f.board.refresh();
  assert.equal(countdown(f).textContent,'01:20');assert.equal(clockStatus(f).textContent,'Paused');
  const writes=f.body.writes;
  f.advance(30000);f.board.tick();assert.equal(countdown(f).textContent,'01:20');
  addTime(f.state.timers['borrow:0'],30,41000);f.board.refresh();
  assert.equal(countdown(f).textContent,'01:50');assert.equal(clockStatus(f).textContent,'Paused');
  startClock(f.state.timers,'borrow:0',41000);f.advance(2000);f.board.tick();
  assert.equal(countdown(f).textContent,'01:48');assert.equal(clockStatus(f).textContent,'LIVE');
  const replacement=structuredClone(f.state);pauseClock(replacement.timers['borrow:0'],43000);
  replacement.timers['borrow:0'].remaining=45000;f.state=replacement;
  const before=structuredClone(replacement);f.board.refresh();
  assert.equal(countdown(f).textContent,'00:45');assert.equal(clockStatus(f).textContent,'Paused');
  assert.equal(f.body.writes,writes);assert.deepEqual(f.state,before);
});

test('A foreground tick catches up after a long gap and clamps expiry without writing viewer state', () => {
  const f=fixture();f.state.timers['basket:red:0']=makeClock(30);
  startClock(f.state.timers,'basket:red:0',1000);f.state.activeKey='basket:red:0';
  f.board.open({game:'basket',key:'basket:red:0'});
  const before=structuredClone(f.state),writes=f.body.writes;
  f.advance(180000);f.board.tick();
  assert.equal(countdown(f).textContent,'00:00');assert.equal(clockStatus(f).textContent,'Time up');
  assert.equal(timerSurface(f).dataset.timerState,'expired');assert.equal(f.body.writes,writes);
  assert.deepEqual(f.state,before,'The viewer never pauses or saves an expired remote clock');
});

test('Following moves the standings and timer together while historical review keeps its own clock', () => {
  for(const review of [false,true]){
    const f=fixture();f.state.timers['borrow:0']=makeClock(90);
    startClock(f.state.timers,'borrow:0',1000);pauseClock(f.state.timers['borrow:0'],11000);
    setColumn(f.state,0,[5,4,3,2,0]);
    f.board.open({game:'borrow',key:'borrow:0',review});
    assert.equal(countdown(f).textContent,'01:20');
    f.state.timers['borrow:1']=makeClock(120);startClock(f.state.timers,'borrow:1',1000);f.state.activeKey='borrow:1';
    const before=structuredClone(f.state);f.advance(5000);f.board.tick();
    if(review){
      assert.match(f.body.innerHTML,/Round 1 \/ 6/);assert.equal(timerSurface(f).dataset.timerKey,'borrow:0');
      assert.equal(countdown(f).textContent,'01:20');assert.equal(clockStatus(f).textContent,'Round complete');
    }else{
      assert.match(f.body.innerHTML,/Round 2 \/ 6/);assert.equal(timerSurface(f).dataset.timerKey,'borrow:1');
      assert.equal(countdown(f).textContent,'01:55');assert.equal(clockStatus(f).textContent,'LIVE');
    }
    assert.deepEqual(f.state,before);
  }
});

test('A different game clock never takes over the selected game scoreboard', () => {
  const f=fixture();f.state.timers['borrow:0']=makeClock(90);
  startClock(f.state.timers,'borrow:0',1000);f.state.activeKey='borrow:0';
  f.board.open({game:'borrow',key:'borrow:0'});
  f.state.timers['relay:0']=makeClock(480);startClock(f.state.timers,'relay:0',11000);f.state.activeKey='relay:0';
  f.advance(10000);const before=structuredClone(f.state);f.board.tick();
  assert.equal(timerSurface(f).dataset.timerKey,'borrow:0');assert.equal(countdown(f).textContent,'01:20');
  assert.equal(clockStatus(f).textContent,'Paused');assert.deepEqual(f.state,before);
});

test('Synced devices with different local clocks show the same shared remaining time without a second offset', () => {
  const keeper=fixture(),viewer=fixture();
  keeper.state.timers['relay:0']=makeClock(480);startClock(keeper.state.timers,'relay:0',1000);keeper.state.activeKey='relay:0';
  const snapshot=publicSnapshot(keeper.state,{offsetMs:60000});
  viewer.setNow(500000);viewer.state=mergePublicState(snapshot,defaultState(),{offsetMs:-439000});
  keeper.board.open({game:'relay',key:'relay:0'});viewer.board.open({game:'relay',key:'relay:0'});
  assert.equal(countdown(keeper).textContent,'08:00');assert.equal(countdown(viewer).textContent,'08:00');
  keeper.advance(11234);viewer.advance(11234);keeper.board.tick();viewer.board.tick();
  assert.equal(countdown(keeper).textContent,countdown(viewer).textContent);assert.equal(countdown(viewer).textContent,'07:49');
});

test('Closed scoreboards do no ticking work and reopening uses the current deadline', () => {
  const f=fixture();f.state.timers['relay:0']=makeClock(480);startClock(f.state.timers,'relay:0',1000);f.state.activeKey='relay:0';
  const initial=f.stateReads;f.board.tick();assert.equal(f.stateReads,initial);
  f.board.open({game:'relay',key:'relay:0'});f.board.close();
  const reads=f.stateReads,writes=f.body.writes;f.advance(65000);f.board.tick();
  assert.equal(f.stateReads,reads);assert.equal(f.body.writes,writes);
  f.board.open({game:'relay',key:'relay:0'});assert.equal(countdown(f).textContent,'06:55');
});

let failures = 0;
for (const { name, run } of tests) {
  try { await run(); console.log('PASS ' + name); }
  catch (error) { failures++; console.error('FAIL ' + name + '\n' + error.stack); }
}
console.log(`${tests.length - failures}/${tests.length} scoreboard controller tests passed.`);
if (failures) process.exitCode = 1;
