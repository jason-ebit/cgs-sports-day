import assert from 'node:assert/strict';
import { createDeviceStore } from '../device-store.js';
import { defaultState } from '../model.js';

const key = 'cg-sports-day-v1', tests = [];
const test = (name, run) => { run(); tests.push(name); console.log('PASS ' + name); };
function storage(raw = null) {
  const values = new Map(raw === null ? [] : [[key, raw]]);
  return {
    values, writes: 0,
    getItem(id) { return values.get(id) ?? null; },
    setItem(id, value) { this.writes++; values.set(id, value); },
  };
}

test('A fresh device loads defaults and saves current event changes', () => {
  const local = storage(), store = createDeviceStore({ getStorage: () => local });
  assert.deepEqual(store.state, defaultState());
  assert.equal(store.saved, true);
  assert.equal(store.protected, false);
  store.state.teams[0].leader = 'Jason';
  assert.equal(store.save(), true);
  assert.equal(JSON.parse(local.getItem(key)).teams[0].leader, 'Jason');
  assert.deepEqual(JSON.parse(store.backup()), store.state);
});

test('A healthy stored event restores results and exports current edits', () => {
  const original = defaultState(); original.notes[4] = 'Judge ready';
  const local = storage(JSON.stringify(original)), store = createDeviceStore({ getStorage: () => local });
  assert.deepEqual(store.state, original);
  store.state.teams[1].leader = 'Cindy';
  assert.equal(JSON.parse(store.backup()).teams[1].leader, 'Cindy');
  assert.equal(store.save(), true);
  assert.equal(store.saved, true);
});

test('Corrupt JSON, empty records and invalid states are retained verbatim without overwrite', () => {
  for (const raw of ['{unfinished', '', '{"version":2}', 'null']) {
    const local = storage(raw), store = createDeviceStore({ getStorage: () => local });
    assert.equal(store.protected, true);
    assert.equal(store.saved, false);
    store.state.teams[0].leader = 'New input';
    assert.equal(store.save(), false);
    assert.equal(local.writes, 0);
    assert.equal(local.getItem(key), raw);
    assert.equal(store.backup(), raw);
  }
});

test('A failed initial read cannot overwrite existing data after storage becomes readable', () => {
  const raw = JSON.stringify(defaultState()), local = storage(raw);
  let blocked = true;
  const store = createDeviceStore({ getStorage: () => ({
    getItem(id) { if (blocked) throw Error('Blocked read'); return local.getItem(id); },
    setItem(id, value) { local.setItem(id, value); },
  }) });
  blocked = false;
  assert.equal(store.save(), false);
  assert.equal(local.writes, 0);
  assert.equal(store.backup(), raw);
  assert.equal(store.protected, true);
});

test('An inaccessible storage getter is safe and never exports defaults as a recovery backup', () => {
  const store = createDeviceStore({ getStorage: () => { throw Error('SecurityError'); } });
  assert.equal(store.saved, false);
  assert.equal(store.protected, true);
  assert.equal(store.save(), false);
  assert.throws(() => store.backup(), /Saved data is unavailable/);
});

test('Explicit reset or validated import clears protection and replaces the retained record', () => {
  for (const replacement of [defaultState(), { ...defaultState(), notes: { 4: 'Imported note' } }]) {
    const local = storage('{corrupt'), store = createDeviceStore({ getStorage: () => local });
    assert.equal(store.replace(replacement), true);
    assert.equal(store.protected, false);
    assert.equal(store.saved, true);
    assert.equal(store.state, replacement);
    assert.deepEqual(JSON.parse(local.getItem(key)), replacement);
    assert.deepEqual(JSON.parse(store.backup()), replacement);
    assert.equal(store.save(), true);
  }
});

test('An authorized replacement can retry saving after storage access returns', () => {
  const local = storage('{corrupt'); let blocked = true;
  const store = createDeviceStore({ getStorage: () => { if (blocked) throw Error('SecurityError'); return local; } });
  const replacement = defaultState(); replacement.teams[0].name = 'Crimson';
  assert.equal(store.replace(replacement), false);
  assert.equal(store.protected, false);
  assert.equal(store.saved, false);
  assert.deepEqual(JSON.parse(store.backup()), replacement);
  blocked = false;
  assert.equal(store.save(), true);
  assert.equal(store.saved, true);
  assert.deepEqual(JSON.parse(local.getItem(key)), replacement);
});

test('A failed write preserves the previous stored record and can retry without losing current edits', () => {
  const original = defaultState(), raw = JSON.stringify(original), local = storage(raw);
  let quotaFull = true;
  const store = createDeviceStore({ getStorage: () => ({
    getItem: id => local.getItem(id),
    setItem(id, value) { if (quotaFull) throw Error('Quota exceeded'); local.setItem(id, value); },
  }) });
  store.state.teams[0].leader = 'Mario';
  assert.equal(store.save(), false);
  assert.equal(store.saved, false);
  assert.equal(store.protected, false);
  assert.equal(local.getItem(key), raw);
  assert.equal(JSON.parse(store.backup()).teams[0].leader, 'Mario');
  quotaFull = false;
  assert.equal(store.save(), true);
  assert.equal(store.saved, true);
  assert.equal(JSON.parse(local.getItem(key)).teams[0].leader, 'Mario');
});

console.log(`${tests.length} storage tests passed.`);
