import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultState } from '../model.js';
import { rotationInterval, renderRotationInterval } from '../rota-intervals.js';

const event = JSON.parse(readFileSync(new URL('../schedule.json', import.meta.url), 'utf8'));
const test = (name, run) => { run(); console.log(`PASS ${name}`); };
const seconds = time => time.split(':').reduce((sum, value, index) => sum + Number(value) * [3600, 60, 1][index], 0);

test('Borrow keeps one crew for each pair and keeps its two handovers inside twenty minutes', () => {
  const state = defaultState();
  const intervals = [0, 1, 2, 3, 4, 5].map(round => rotationInterval(state, `borrow:${round}`, event.schedule));
  for (const first of [0, 2, 4]) assert.deepEqual(intervals[first], intervals[first + 1]);
  assert.deepEqual(intervals.filter((_, index) => index % 2 === 0).map(({ label, start, end, handoverSeconds }) => ({ label, start, end, handoverSeconds })), [
    { label: 'Rounds 1–2', start: '12:44', end: '12:49', handoverSeconds: 60 },
    { label: 'Rounds 3–4', start: '12:50', end: '12:56', handoverSeconds: 60 },
    { label: 'Rounds 5–6', start: '12:57', end: '13:03', handoverSeconds: 0 },
  ]);
  assert.equal(rotationInterval(state, 'borrow:6', event), null);
});

test('The optional Borrow round gets its own block without adding event time', () => {
  const state = defaultState();
  state.borrow.rounds = 7;
  const optional = rotationInterval(state, 'borrow:6', event);
  assert.equal(optional.groupKey, 'borrow:pair:3');
  assert.equal(optional.label, 'Round 7 · optional');
  assert.equal(optional.end, '13:03');
  assert.equal(optional.handoverSeconds, 0);
  assert.match(optional.note, /only if time allows/);
});

test('Basket holds the same crew for both attempts and then allows ninety seconds to swap', () => {
  const state = defaultState();
  for (const team of ['red', 'blue', 'yellow', 'green', 'white']) {
    assert.deepEqual(rotationInterval(state, `basket:${team}:0`, event), rotationInterval(state, `basket:${team}:1`, event));
  }
  const first = rotationInterval(state, 'basket:red:0', event), next = rotationInterval(state, 'basket:blue:0', event);
  assert.equal(first.handoverSeconds, 90);
  assert.equal(seconds(next.start) - seconds(first.end), 90);
  assert.equal(rotationInterval(state, 'basket:white:1', event).end, '13:28');
});

test('Cavalry and Tug swap only between actual rounds or matches', () => {
  const state = defaultState();
  const women = rotationInterval(state, 'cavalry:women', event), men = rotationInterval(state, 'cavalry:men', event);
  assert.equal(women.handoverSeconds, 90);
  assert.equal(seconds(men.start) - seconds(women.end), 90);
  assert.match(women.note, /division and team/);
  assert.match(women.note, /arena is clear/);
  const tug = ['prelim', 'semi1', 'semi2', 'final'].map(match => rotationInterval(state, `tug:${match}`, event));
  tug.slice(0, -1).forEach((interval, index) => assert.equal(seconds(tug[index + 1].start) - seconds(interval.end), 90));
  assert.equal(tug.at(-1).end, '15:08');
  assert.equal(tug.at(-1).handoverSeconds, 0);
});

test('Relay uses the existing eight, ten and eight minute limits with two ninety-second handovers', () => {
  const state = defaultState();
  assert.deepEqual([0, 1, 2].map(round => rotationInterval(state, `relay:${round}`, event)).map(({ label, start, end, handoverSeconds }) => ({ label, start, end, handoverSeconds })), [
    { label: 'Baton', start: '15:09', end: '15:17', handoverSeconds: 90 },
    { label: 'Three-legged', start: '15:18:30', end: '15:28:30', handoverSeconds: 90 },
    { label: 'Spoon & ball', start: '15:30', end: '15:38', handoverSeconds: 0 },
  ]);
});

test('Changed limits are reflected and overlong clocks do not promise impossible times', () => {
  const state = defaultState();
  state.timers['relay:0'] = { duration: 540000 };
  const overlong = rotationInterval(state, 'relay:0', event);
  assert.equal(overlong.start, null);
  assert.equal(overlong.end, null);
  assert.equal(overlong.reason, 'limits-too-long');
  assert.match(renderRotationInterval(state, 'relay:0', event), /Timer limits do not fit/);
  state.timers['relay:0'].duration = 420000;
  const shorter = rotationInterval(state, 'relay:0', event);
  assert.ok(shorter.start && shorter.end);
  assert.ok(seconds(shorter.end) - seconds(shorter.start) >= 420);
  state.cavalry.cap = 2700;
  assert.equal(rotationInterval(state, 'cavalry:men', event).reason, 'limits-too-long');
});

test('Missing or malformed schedule keeps grouping guidance without inventing clock times', () => {
  const state = defaultState();
  for (const schedule of [undefined, [], { schedule: [] }]) {
    const interval = rotationInterval(state, 'borrow:0', schedule);
    assert.equal(interval.groupKey, 'borrow:pair:0');
    assert.equal(interval.start, null);
    assert.equal(interval.end, null);
  }
  const malformed = structuredClone(event);
  malformed.schedule[9].start = '27:00';
  assert.equal(rotationInterval(state, 'relay:0', malformed).start, null);
  for (const key of [null, '', 'borrow:01', 'borrow:7', 'relay:3', 'basket:red:2', 'cavalry:all', 'tug:unknown', 'event:4']) {
    assert.equal(rotationInterval(state, key, event), null);
    assert.equal(renderRotationInterval(state, key, event), '');
  }
});

test('Rendering stays compact, escapes team names and introduces no scoring or timer controls', () => {
  const state = defaultState();
  state.teams[0].name = '<img src=x onerror=bad()>';
  const before = JSON.stringify({ state, event });
  const html = renderRotationInterval(state, 'basket:red:0', event);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img|<button|<input|<select|data-live|data-action/);
  assert.equal((html.match(/<li>/g) || []).length, 1);
  assert.match(html, /Planned/);
  assert.equal(JSON.stringify({ state, event }), before);
});
