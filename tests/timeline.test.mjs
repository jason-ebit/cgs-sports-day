import assert from 'node:assert/strict';
import { defaultState } from '../model.js';
import { makeClock, startClock, pauseClock } from '../timer-model.js';
import { gameTimelineState, gameTimelineGeometry, createGameTimeline } from '../game-timeline.js';

const tests = [];
function test(name, run) { try { run(); tests.push({ name, pass: true }); } catch (error) { tests.push({ name, pass: false, error }); } }
const rect = (left, top, width, height) => ({ left, top, width, height });
const grid = rect(0, 0, 492, 454);
const cards = [rect(0, 0, 240, 150), rect(252, 0, 240, 150), rect(0, 162, 240, 150), rect(252, 162, 240, 150), rect(0, 324, 492, 130)];
function bezier(path, t) {
  const u = 1 - t;
  return [0, 1].map(i => u ** 3 * path.start[i] + 3 * u ** 2 * t * path.control1[i] + 3 * u * t ** 2 * path.control2[i] + t ** 3 * path.end[i]);
}
function assertInGaps(paths, rects, bounds) {
  for (const path of paths) for (let i = 1; i < 100; i++) {
    const [x, y] = bezier(path, i / 100);
    assert.ok(x >= 0 && x <= bounds.width && y >= 0 && y <= bounds.height, 'No curve can create an outer scroll gutter.');
    for (const card of rects) assert.equal(x > card.left + .001 && x < card.left + card.width - .001 && y > card.top + .001 && y < card.top + card.height - .001, false, 'The line cannot pass beneath card text.');
  }
}

test('A fresh event starts at game one and leaves later games upcoming', () => {
  const result = gameTimelineState(defaultState(), { now: 1000 });
  assert.deepEqual(result.steps.map(step => step.status), ['next', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
  assert.equal(result.active, null); assert.equal(result.next, 'borrow'); assert.equal(result.completed, 0);
  assert.deepEqual(result.steps.map(step => step.eventIndex), [4, 5, 7, 8, 9]);
});

test('A started, paused or expired timer keeps the current unfinished game highlighted', () => {
  const state = defaultState(); state.timers['cavalry:women'] = makeClock(30); state.activeKey = 'cavalry:women';
  assert.equal(gameTimelineState(state, { now: 1000 }).active, null, 'An unstarted timer does not advance the timeline.');
  startClock(state.timers, state.activeKey, 1000);
  let result = gameTimelineState(state, { now: 2000 }); assert.equal(result.active, 'cavalry'); assert.equal(result.steps[2].running, true);
  pauseClock(state.timers[state.activeKey], 2000); result = gameTimelineState(state, { now: 4000 });
  assert.equal(result.active, 'cavalry'); assert.equal(result.steps[2].running, false); assert.equal(result.next, 'tug');
  state.timers[state.activeKey].remaining = 0; assert.equal(gameTimelineState(state, { now: 5000 }).active, 'cavalry');
});

test('The actual running game takes precedence over a stale selected timer', () => {
  const state = defaultState(); state.timers['borrow:0'] = makeClock(30); state.timers['relay:0'] = makeClock(30);
  startClock(state.timers, 'borrow:0', 1000); pauseClock(state.timers['borrow:0'], 2000);
  startClock(state.timers, 'relay:0', 2000); state.activeKey = 'borrow:0';
  assert.equal(gameTimelineState(state, { now: 3000 }).active, 'relay');
});

test('A completed round cannot keep its unfinished game ongoing through a stale active key or deadline', () => {
  const state = defaultState(); state.borrow.scores.forEach(row => row[0] = 2);
  state.timers['borrow:0'] = makeClock(30); startClock(state.timers, 'borrow:0', 1000); state.activeKey = 'borrow:0';
  assert.equal(gameTimelineState(state, { now: 2000 }).active, null, 'A finished round with a lingering running deadline is excluded.');
  pauseClock(state.timers['borrow:0'], 2000);
  assert.equal(gameTimelineState(state, { now: 3000 }).active, null, 'A stale paused round is excluded too.');
  state.timers['basket:red:0'] = makeClock(30); startClock(state.timers, 'basket:red:0', 3000); state.activeKey = 'basket:red:0';
  state.basket.scores[0][0] = 0; state.finished.push('basket:red:0');
  assert.equal(gameTimelineState(state, { now: 4000 }).active, null, 'A finished ball attempt cannot select an ongoing game.');
  assert.equal(gameTimelineState(state, { now: 4000 }).next, 'borrow');
});

test('Prayer and other non-game clocks do not select a Games timeline step', () => {
  const state = defaultState(); state.timers['event:15'] = makeClock(120); startClock(state.timers, 'event:15', 1000); state.activeKey = 'event:15';
  assert.equal(gameTimelineState(state, { now: 2000 }).active, null); assert.equal(gameTimelineState(state).next, 'borrow');
});

test('Completed scores move the next marker without treating a draft ball count as a completed game', () => {
  const state = defaultState(); state.borrow.scores.forEach(row => row.fill(2)); state.basket.scores.forEach(row => row.fill(3));
  const result = gameTimelineState(state); assert.equal(result.steps[0].status, 'completed'); assert.equal(result.steps[1].status, 'next');
  assert.equal(result.completed, 1); assert.equal(result.segments[0].status, 'current'); assert.equal(result.segments[1].status, 'upcoming');
  for (const id of state.teams.map(t => t.id)) for (const round of [0, 1]) state.finished.push(`basket:${id}:${round}`);
  const completed = gameTimelineState(state); assert.equal(completed.completed, 2); assert.equal(completed.next, 'cavalry'); assert.equal(completed.segments[0].status, 'completed');
});

test('All finished games turn every connector green and leave no ongoing or next marker', () => {
  const state = defaultState(); state.borrow.scores.forEach(row => row.fill(2)); state.basket.scores.forEach(row => row.fill(3));
  for (const id of state.teams.map(t => t.id)) for (const round of [0, 1]) state.finished.push(`basket:${id}:${round}`);
  state.relay.scores = state.teams.map((t, i) => [i + 1, i + 1, i + 1]);
  for (const division of ['women', 'men']) state.cavalry.divisions[division] = { counts: Array(5).fill(null), active: ['red', 'blue'], eliminated: ['blue'], started: true };
  state.tug = { slots: ['red', 'blue', 'yellow', 'green', 'white'], locked: true, winners: { prelim: 'red', semi1: 'yellow', semi2: 'green', final: 'yellow' } };
  const result = gameTimelineState(state); assert.equal(result.completed, 5); assert.equal(result.active, null); assert.equal(result.next, null);
  assert.ok(result.steps.every(step => step.status === 'completed')); assert.ok(result.segments.every(segment => segment.status === 'completed'));
});

test('The two-column geometry connects all five cards in order and stays entirely in existing gaps', () => {
  const paths = gameTimelineGeometry(cards, grid); assert.equal(paths.length, 4);
  assert.deepEqual(paths.map(path => [path.from, path.to]), [['borrow', 'basket'], ['basket', 'cavalry'], ['cavalry', 'tug'], ['tug', 'relay']]);
  assert.deepEqual(paths[0].start, [240, 75]); assert.deepEqual(paths[0].end, [252, 75]);
  assert.deepEqual(paths[1].start, [372, 150]); assert.deepEqual(paths[1].end, [120, 162]);
  assert.deepEqual(paths[3].start, [372, 312]); assert.deepEqual(paths[3].end, [246, 324]);
  assertInGaps(paths, cards, grid);
});

test('Phone-sized gaps keep curves inside the grid and shrink timeline dots to fit', () => {
  const bounds = rect(0, 0, 280, 273), phone = [rect(0, 0, 136, 86), rect(144, 0, 136, 86), rect(0, 94, 136, 86), rect(144, 94, 136, 86), rect(0, 188, 280, 85)];
  const paths = gameTimelineGeometry(phone, bounds); assertInGaps(paths, phone, bounds);
  assert.ok(paths.every(path => path.dot.radius <= 8 / 3));
});

test('Expanded poster transforms produce the same local SVG geometry as the normal layout', () => {
  const scale = .42, transform = r => rect(100 + r.left * scale, 80 + r.top * scale, r.width * scale, r.height * scale);
  const scaled = gameTimelineGeometry(cards.map(transform), { ...transform(grid), layoutWidth: grid.width, layoutHeight: grid.height });
  assert.deepEqual(scaled.map(path => path.d), gameTimelineGeometry(cards, grid).map(path => path.d));
});

test('A hidden or incomplete Games layout does not draw invalid coordinates', () => {
  assert.deepEqual(gameTimelineGeometry(cards, rect(0, 0, 0, 0)), []); assert.deepEqual(gameTimelineGeometry(cards.slice(0, 4), grid), []);
  const invalid = cards.map(card => ({ ...card })); invalid[3].width = NaN; assert.deepEqual(gameTimelineGeometry(invalid, grid), []);
});

class Element {
  constructor(tag, ownerDocument) {
    this.tag = tag; this.ownerDocument = ownerDocument; this.attributes = new Map(); this.dataset = {}; this.children = []; this.parentNode = null;
    this.style = { setProperty: (key, value) => this.style[key] = String(value) };
    this.classList = { add: name => this.setAttribute('class', (this.getAttribute('class') || '') + ' ' + name),
      remove: name => this.setAttribute('class', (this.getAttribute('class') || '').split(' ').filter(value => value !== name).join(' ')),
      contains: name => (this.getAttribute('class') || '').split(' ').includes(name) };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  append(child) { child.parentNode = this; this.children.push(child); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  replaceChildren(...children) { this.children.forEach(child => child.parentNode = null); this.children = []; children.forEach(child => this.append(child)); }
  getBoundingClientRect() { return this.bounds; }
}
function domFixture({ reduce = false } = {}) {
  const document = { createElementNS: (namespace, tag) => new Element(tag, document) };
  const container = new Element('div', document); container.bounds = grid; container.clientWidth = grid.width; container.clientHeight = grid.height;
  let state = defaultState(), observed, disconnected = false; const frames = new Map(), timeouts = new Map(); let id = 0;
  class Observer { constructor(callback) { observed = callback; } observe(target) { assert.equal(target, container); } disconnect() { disconnected = true; } }
  container.querySelector = selector => container.children.find(child => child.dataset.open && selector.includes(child.dataset.open)) ?? null;
  container.querySelectorAll = () => container.children.filter(child => child.dataset.open);
  const replaceCards = () => {
    const nodes = cards.map((bounds, i) => { const card = new Element('button', document); card.bounds = bounds; card.dataset.open = `event:${[4, 5, 7, 8, 9][i]}`; return card; });
    container.replaceChildren(...nodes); return nodes;
  };
  replaceCards();
  const timeline = createGameTimeline({ getState: () => state, container, now: () => 1000, ResizeObserver: Observer, reducedMotion: () => reduce,
    requestFrame: fn => { const handle = ++id; frames.set(handle, fn); return handle; }, cancelFrame: handle => frames.delete(handle),
    timers: { setTimeout: fn => { const handle = ++id; timeouts.set(handle, fn); return handle; }, clearTimeout: handle => timeouts.delete(handle) } });
  const draw = () => { for (const [handle, callback] of frames) { frames.delete(handle); callback(); } };
  return { timeline, container, frames, timeouts, draw, replaceCards,
    svg: () => container.children.find(child => child.tag === 'svg'), observe: () => observed(), disconnected: () => disconnected,
    change: next => state = next };
}

test('Rendering schedules one frame, adds no layout row, and identifies the current game accessibly', () => {
  const f = domFixture(); f.timeline.update(); f.timeline.update(); assert.equal(f.frames.size, 1); f.draw();
  assert.equal(f.svg().getAttribute('aria-hidden'), 'true'); assert.equal(f.svg().getAttribute('focusable'), 'false');
  assert.equal(f.svg().children.filter(node => node.tag === 'path').length, 4);
  assert.equal(f.container.children[0].dataset.timelineState, 'next'); assert.equal(f.container.children[0].getAttribute('aria-description'), 'Game 1 of 5. Next up.');
  assert.equal(f.svg().classList.contains('is-drawing'), true); f.timeline.destroy();
});

test('Replacing the Games cards rebuilds the SVG without restarting the initial draw animation', () => {
  const f = domFixture(); f.timeline.update(); f.draw(); const first = f.svg(); f.replaceCards();
  const state = defaultState(); state.timers['tug:prelim'] = makeClock(60); startClock(state.timers, 'tug:prelim', 1000); state.activeKey = 'tug:prelim'; f.change(state);
  f.timeline.update(); f.draw(); assert.notEqual(f.svg(), first); assert.equal(f.svg().classList.contains('is-drawing'), false);
  assert.equal(f.container.children[3].dataset.timelineState, 'active'); assert.ok(f.svg().children.some(child => child.getAttribute('class')?.includes('--current'))); f.timeline.destroy();
});

test('Updates and resizes preserve attached SVG nodes and the original draw timer', () => {
  const f = domFixture(); f.timeline.update(); f.draw(); const svg = f.svg(), original = [...svg.children];
  const timer = [...f.timeouts.keys()][0];
  f.timeline.update(); f.draw(); assert.equal(f.svg(), svg); assert.deepEqual(svg.children, original);
  assert.equal([...f.timeouts.keys()][0], timer, 'An update cannot restart the initial animation timeout.');
  const previous = original[0].getAttribute('d');
  f.container.bounds = { ...grid, width: grid.width * .7, height: grid.height * .7 };
  f.container.clientWidth = f.container.bounds.width; f.container.clientHeight = f.container.bounds.height;
  f.container.children.filter(node => node.tag === 'button').forEach(card => card.bounds = { ...card.bounds,
    left: card.bounds.left * .7, top: card.bounds.top * .7, width: card.bounds.width * .7, height: card.bounds.height * .7 });
  f.observe(); f.draw(); assert.equal(f.svg(), svg); assert.deepEqual(svg.children, original);
  assert.notEqual(original[0].getAttribute('d'), previous, 'Geometry still responds to a real resize.');
  const settle = f.timeouts.get(timer); settle(); assert.equal(svg.classList.contains('is-drawing'), false);
  f.timeline.update(); f.draw(); assert.deepEqual(svg.children, original); f.timeline.destroy();
});

test('Reduced-motion users see the complete timeline immediately', () => {
  const f = domFixture({ reduce: true }); f.timeline.update(); f.draw(); assert.equal(f.svg().classList.contains('is-drawing'), false); assert.equal(f.timeouts.size, 0); f.timeline.destroy();
});

test('Resizing redraws the curves and destroying cleans up scheduled work and owned card descriptions', () => {
  const f = domFixture(); f.timeline.update(); f.draw(); f.observe(); assert.equal(f.frames.size, 1);
  f.timeline.destroy(); assert.equal(f.frames.size, 0); assert.equal(f.timeouts.size, 0); assert.equal(f.disconnected(), true); assert.equal(f.svg(), undefined);
  assert.equal(f.container.children[0].dataset.timelineState, undefined); assert.equal(f.container.children[0].getAttribute('aria-description'), null);
  f.timeline.update(); assert.equal(f.frames.size, 0);
});

for (const result of tests) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}${result.error ? '\n' + result.error.stack : ''}`);
if (tests.some(result => !result.pass)) process.exitCode = 1;
console.log(`${tests.filter(result => result.pass).length}/${tests.length} timeline tests passed.`);
