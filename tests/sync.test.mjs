import assert from 'node:assert/strict';
import { defaultState, championship } from '../model.js';
import { makeClock, startClock } from '../timer-model.js';
import { publicSnapshot, mergePublicState, createSyncService } from '../sync.js';

const tests = [];
async function test(name, fn) {
  try { await fn(); tests.push({ name, passed: true }); }
  catch (cause) { tests.push({ name, passed: false, cause }); }
}
function memoryStorage() {
  const data = new Map();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}
function fixture({ snapshot = publicSnapshot(defaultState()), localOffset = 0 } = {}) {
  let serverNow = 1700000000000, counter = 0, offline = false, loseAck = false, denyAccess = false, responseJitter = 0;
  let revision = 0, leaseRevision = 0, writer = null, lease = 0, shared = snapshot;
  const operations = new Map(), calls = [], storage = memoryStorage(), intervals = new Map();
  const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
  const data = status => ({ status, public_state: shared, revision, lease_revision: leaseRevision, writer_id: writer,
    lease_until: writer ? new Date(lease).toISOString() : null, server_ms: serverNow + responseJitter });
  const response = (payload, status = 200) => ({ ok: status < 400, status, json: async () => payload });
  const fetch = async (url, options) => {
    const path = new URL(url).pathname, body = options.body ? JSON.parse(options.body) : {};
    calls.push({ path, body, headers: options.headers });
    if (offline) throw Error('Network offline');
    assert.equal(options.headers.apikey, 'sb_publishable_test');
    if (path === '/auth/v1/token') return response({ access_token: 'editor-access', refresh_token: 'editor-refresh', expires_in: 3600, user: { email: body.email || 'keeper@example.org' } });
    if (path === '/auth/v1/logout') return response({});
    if (path.endsWith('/read_sports_day_event')) return response(data());
    if (denyAccess || options.headers.Authorization !== 'Bearer editor-access') return response({ message: 'Sign in first.' }, 401);
    if (path.endsWith('/claim_sports_day_writer')) {
      if (writer && writer !== body.p_writer_id && !body.p_transfer) return response(data('busy'));
      if (writer !== body.p_writer_id) leaseRevision++;
      writer = body.p_writer_id; lease = serverNow + 120000; return response(data('claimed'));
    }
    if (path.endsWith('/release_sports_day_writer')) {
      if (writer !== body.p_writer_id) return response(data('lease_lost'));
      writer = null; lease = 0; leaseRevision++; return response(data('released'));
    }
    if (path.endsWith('/apply_sports_day_update')) {
      const prior = operations.get(body.p_operation_id);
      if (prior) return response(data(prior === revision ? 'duplicate' : 'conflict'));
      if (writer !== body.p_writer_id || lease <= serverNow) return response(data('lease_lost'));
      if (body.p_expected_revision !== revision) return response(data('conflict'));
      mergePublicState(body.p_snapshot);
      revision++; shared = body.p_snapshot; lease = serverNow + 120000;
      operations.set(body.p_operation_id, revision);
      if (loseAck) { loseAck = false; throw Error('Response lost after commit'); }
      return response(data('applied'));
    }
    throw Error('Unexpected request ' + path);
  };
  const scheduler = { setInterval: fn => { const id = uuid(); intervals.set(id, fn); return id; }, clearInterval: id => intervals.delete(id) };
  function service(options = {}) {
    const statuses = [], delivered = [];
    const sync = createSyncService({ url: 'https://test-project.supabase.co', publishableKey: 'sb_publishable_test',
      fetch, getStorage: () => storage, uuid, scheduler, now: () => serverNow + localOffset,
      onStatus: value => statuses.push(value), onRemote: (state, meta) => delivered.push({ state, meta }), ...options });
    return { sync, statuses, delivered };
  }
  return { service, calls, storage, intervals, uuid, fetch,
    now: () => serverNow, advance: ms => serverNow += ms,
    offline: value => offline = value, loseAck: () => loseAck = true,
    denyAccess: () => denyAccess = true, jitter: value => responseJitter = value,
    get shared() { return shared; }, get revision() { return revision; }, get writer() { return writer; },
    externalUpdate(state) { shared = publicSnapshot(state); revision++; },
  };
}
async function writerFixture(options) {
  const f = fixture(options), instance = f.service();
  await instance.sync.start(); await instance.sync.login('keeper@example.org', 'private-password');
  await instance.sync.claimWriter(); return { ...f, ...instance, fixture: f };
}

await test('Shared snapshots exclude all committee, leader, participant and free-text rule information', () => {
  const s = defaultState();
  s.teams[0].leader = 'Private leader'; s.teams[0].participants = 20;
  s.notes[4] = 'Private event note'; s.committeeNotes['first-aid'] = { general: 'Medical detail' };
  s.cavalry.rule = 'Private arena note'; s.cavalry.divisions.women.counts[0] = 3;
  s.placements.borrow.rule = 'Private placement explanation';
  const snapshot = publicSnapshot(s), text = JSON.stringify(snapshot);
  for (const forbidden of ['Private', 'Medical', 'leader', 'participants', 'counts', 'committeeNotes', 'notes', 'rule']) assert.equal(text.includes(forbidden), false, forbidden);
  assert.equal(snapshot.placements.borrow.approved, true);
});

await test('Applying shared results keeps this phone’s private notes and headcounts', () => {
  const local = defaultState(); local.teams[0].leader = 'Local leader'; local.teams[1].participants = 15;
  local.notes[4] = 'Local note'; local.committeeNotes.judges = { general: 'Local instruction' };
  local.cavalry.divisions.men.counts[2] = 4; local.cavalry.rule = 'Local arena instruction';
  const remote = defaultState(); remote.teams[0].name = 'Crimson'; remote.borrow.scores[0][0] = 5;
  const next = mergePublicState(publicSnapshot(remote), local);
  assert.equal(next.teams[0].name, 'Crimson'); assert.equal(next.borrow.scores[0][0], 5);
  assert.equal(next.teams[0].leader, 'Local leader'); assert.equal(next.teams[1].participants, 15);
  assert.deepEqual(next.notes, local.notes); assert.deepEqual(next.committeeNotes, local.committeeNotes);
  assert.equal(next.cavalry.divisions.men.counts[2], 4); assert.equal(next.cavalry.rule, local.cavalry.rule);
  assert.equal(local.teams[0].name, 'Red', 'The merge cannot mutate the old state.');
});

await test('Approved tie decisions preserve championship points without exposing explanations', () => {
  const s = defaultState(); s.borrow.scores.forEach(row => row.fill(2));
  s.placements.borrow = { rule: 'Decided by a private committee note', values: [1, 2, 3, 4, 5] };
  const restored = mergePublicState(publicSnapshot(s));
  assert.deepEqual(championship(restored), championship(s));
  assert.equal(restored.placements.borrow.rule, 'Approved result');
  const plain = defaultState(); plain.borrow.scores.forEach(row => row.fill(2));
  assert.equal(mergePublicState(publicSnapshot(plain), s).placements.borrow.rule, '', 'An old local decision cannot override new shared ties.');
});

await test('Timer deadlines use server time and return to each phone’s local clock', () => {
  const s = defaultState(); s.timers['borrow:0'] = makeClock(30); startClock(s.timers, 'borrow:0', 100000); s.activeKey = 'borrow:0';
  const snapshot = publicSnapshot(s, { offsetMs: 9000 });
  assert.equal(snapshot.timers['borrow:0'].deadline, 139000);
  assert.equal(s.timers['borrow:0'].deadline, 130000);
  const viewer = mergePublicState(snapshot, defaultState(), { offsetMs: -2000 });
  assert.equal(viewer.timers['borrow:0'].deadline, 141000);
});

await test('Malformed shared scores, timers and approval flags are rejected before merging', () => {
  const snapshot = publicSnapshot(defaultState());
  for (const mutate of [s => s.relay.scores[0][0] = 6, s => s.placements.tug.approved = 'yes', s => s.timers = [], s => s.teams[0].id = 'unknown']) {
    const invalid = structuredClone(snapshot); mutate(invalid); assert.throws(() => mergePublicState(invalid));
  }
});

await test('A viewer fetches shared scores and can never queue an update', async () => {
  const f = fixture(), { sync, delivered } = f.service(); await sync.start();
  assert.equal(sync.role, 'viewer'); assert.equal(sync.status.phase, 'watching'); assert.equal(delivered.length, 1);
  assert.equal(sync.queue(defaultState()), false); assert.equal(f.calls.some(c => c.path.endsWith('/apply_sports_day_update')), false);
  assert.equal(f.calls[0].headers.Authorization, undefined, 'The publishable key is not a bearer token.'); sync.stop();
});

await test('The first scorekeeper can publish existing local results into an empty event', async () => {
  const f = await writerFixture({ snapshot: null });
  assert.equal(f.sync.status.remoteAvailable, false);
  const s = defaultState(); s.borrow.scores[0][0] = 5;
  assert.equal(f.sync.queue(s), true); await f.sync.flush();
  assert.equal(f.fixture.shared.borrow.scores[0][0], 5); assert.equal(f.fixture.revision, 1); assert.equal(f.sync.status.phase, 'synced'); f.sync.stop();
});

await test('Changes to private notes produce no shared update', async () => {
  const f = await writerFixture(), s = defaultState(); s.notes[4] = 'Private'; s.teams[0].leader = 'Private';
  assert.equal(f.sync.queue(s), true); await f.sync.flush();
  assert.equal(f.calls.some(c => c.path.endsWith('/apply_sports_day_update')), false); f.sync.stop();
});

await test('Small server-offset corrections cannot turn a private note into a running-timer update', async () => {
  const f = await writerFixture(), s = defaultState(); s.timers['relay:0'] = makeClock(60);
  startClock(s.timers, 'relay:0', f.fixture.now()); s.activeKey = 'relay:0';
  f.sync.queue(s); await f.sync.flush(); const before = f.calls.filter(c => c.path.endsWith('/apply_sports_day_update')).length;
  f.fixture.jitter(25); await f.sync.refresh(); s.notes[9] = 'Private relay instruction';
  assert.equal(f.sync.queue(s), true); await f.sync.flush();
  assert.equal(f.calls.filter(c => c.path.endsWith('/apply_sports_day_update')).length, before); f.sync.stop();
});

await test('Offline scorekeeper results persist and publish automatically after reconnecting', async () => {
  const f = await writerFixture(), s = defaultState(); f.fixture.offline(true); s.borrow.scores[0][0] = 5;
  f.sync.queue(s); await f.sync.flush(); assert.equal(f.sync.pending, 1); assert.equal(f.sync.status.phase, 'pending');
  const persisted = JSON.parse([...f.storage.data.values()][0]); assert.equal(persisted.outbox[0].snapshot.borrow.scores[0][0], 5);
  f.fixture.offline(false); await f.sync.flush(); assert.equal(f.sync.pending, 0); assert.equal(f.fixture.shared.borrow.scores[0][0], 5); f.sync.stop();
});

await test('A lost server acknowledgement retries the same operation without awarding twice', async () => {
  const f = await writerFixture(), s = defaultState(); s.borrow.scores[0][0] = 5; f.fixture.loseAck();
  f.sync.queue(s); await f.sync.flush(); assert.equal(f.sync.pending, 1); assert.equal(f.fixture.revision, 1);
  await f.sync.flush(); assert.equal(f.sync.pending, 0); assert.equal(f.fixture.revision, 1);
  const calls = f.calls.filter(c => c.path.endsWith('/apply_sports_day_update'));
  assert.equal(calls[0].body.p_operation_id, calls[1].body.p_operation_id); assert.deepEqual(calls[0].body.p_snapshot, calls[1].body.p_snapshot); f.sync.stop();
});

await test('New offline edits never replace an attempted operation; only the unattempted tail is compacted', async () => {
  const f = await writerFixture(), s = defaultState(); f.fixture.offline(true);
  s.borrow.scores[0][0] = 5; f.sync.queue(s); await f.sync.flush();
  s.borrow.scores[1][0] = 4; f.sync.queue(s); await f.sync.flush();
  s.borrow.scores[2][0] = 3; f.sync.queue(s); await f.sync.flush();
  assert.equal(f.sync.pending, 2); const persisted = JSON.parse([...f.storage.data.values()][0]);
  assert.equal(persisted.outbox[0].snapshot.borrow.scores[1][0], null); assert.equal(persisted.outbox[1].snapshot.borrow.scores[2][0], 3);
  f.fixture.offline(false); await f.sync.flush(); assert.equal(f.fixture.revision, 2); assert.equal(f.fixture.shared.borrow.scores[2][0], 3); f.sync.stop();
});

await test('Rapid taps during an in-flight save serialize writes and preserve the latest result', async () => {
  const f = fixture(); let release, first = true, arrived;
  const waiting = new Promise(resolve => arrived = resolve), blocked = new Promise(resolve => release = resolve);
  const { sync } = f.service({ fetch: async (url, options) => {
    if (url.endsWith('/apply_sports_day_update') && first) { first = false; arrived(); await blocked; }
    return f.fetch(url, options);
  } });
  await sync.start(); await sync.login('keeper@example.org', 'password'); await sync.claimWriter();
  const s = defaultState(); s.borrow.scores[0][0] = 5; sync.queue(s); await waiting;
  s.borrow.scores[1][0] = 4; sync.queue(s); s.borrow.scores[2][0] = 3; sync.queue(s);
  assert.equal(sync.pending, 2); release(); await sync.flush();
  const updates = f.calls.filter(c => c.path.endsWith('/apply_sports_day_update'));
  assert.equal(updates.length, 2); assert.deepEqual(updates.map(c => c.body.p_expected_revision), [0, 1]);
  assert.equal(updates[0].body.p_snapshot.borrow.scores[1][0], null);
  assert.equal(f.shared.borrow.scores[2][0], 3); assert.equal(sync.pending, 0); sync.stop();
});

await test('An offline reload restores pending edits before reading a stale server snapshot', async () => {
  const f = await writerFixture(), s = defaultState(); f.fixture.offline(true); s.borrow.scores[0][0] = 5;
  f.sync.queue(s); await f.sync.flush(); f.sync.stop();
  const next = f.fixture.service(); await next.sync.start(); assert.equal(next.sync.role, 'writer'); assert.equal(next.sync.pending, 1); assert.equal(next.delivered.length, 0);
  s.borrow.scores[1][0] = 4; assert.equal(next.sync.queue(s), true); await next.sync.flush();
  f.fixture.offline(false); await next.sync.claimWriter(); assert.equal(next.sync.pending, 0); assert.equal(f.fixture.shared.borrow.scores[1][0], 4); next.sync.stop();
});

await test('A previously synced scorekeeper can reload offline and keep new results durably pending', async () => {
  const f = await writerFixture(); assert.equal(f.sync.pending, 0); f.sync.stop(); f.fixture.offline(true);
  const reloaded = f.fixture.service(); await reloaded.sync.start(); assert.equal(reloaded.sync.role, 'writer');
  const s = defaultState(); s.borrow.scores[0][0] = 5;
  assert.equal(reloaded.sync.queue(s), true); await reloaded.sync.flush(); assert.equal(reloaded.sync.pending, 1);
  const stored = JSON.parse([...f.storage.data.values()][0]); assert.equal(stored.outbox[0].snapshot.borrow.scores[0][0], 5);
  f.fixture.offline(false); await reloaded.sync.claimWriter(); assert.equal(reloaded.sync.pending, 0);
  assert.equal(f.fixture.shared.borrow.scores[0][0], 5); reloaded.sync.stop();
});

await test('A stale offline update stops at a conflict and never overwrites newer shared scores', async () => {
  const f = await writerFixture(), s = defaultState(); f.fixture.offline(true); s.borrow.scores[0][0] = 5;
  f.sync.queue(s); await f.sync.flush(); const newer = defaultState(); newer.borrow.scores[1][0] = 5;
  f.fixture.externalUpdate(newer); f.fixture.offline(false); await f.sync.flush();
  assert.equal(f.sync.status.phase, 'conflict'); assert.equal(f.sync.pending, 1); assert.equal(f.fixture.shared.borrow.scores[0][0], null);
  assert.equal(f.sync.queue(s), false); await f.sync.acceptRemote(); assert.equal(f.sync.pending, 0); assert.equal(f.delivered.at(-1).state.borrow.scores[1][0], 5); f.sync.stop();
});

await test('Conflict stays blocked through renewal, reconnect, sign-in and reload until shared scores are explicitly loaded', async () => {
  const f = await writerFixture(), s = defaultState(); f.fixture.offline(true); s.borrow.scores[0][0] = 5;
  f.sync.queue(s); await f.sync.flush(); const newer = defaultState(); newer.borrow.scores[1][0] = 5;
  f.fixture.externalUpdate(newer); f.fixture.offline(false); await f.sync.flush();
  assert.equal(f.sync.status.phase, 'conflict'); const attempts = f.calls.filter(c => c.path.endsWith('/apply_sports_day_update')).length;
  f.fixture.advance(60000); for (const callback of f.intervals.values()) callback();
  await f.sync.refresh(); await f.sync.claimWriter({ adoptRemote: false }); await f.sync.flush();
  assert.equal(f.sync.status.phase, 'conflict'); assert.equal(f.sync.queue(s), false);
  f.fixture.offline(true); await f.sync.refresh().catch(() => {}); assert.equal(f.sync.status.phase, 'conflict');
  f.fixture.offline(false); await f.sync.login('keeper@example.org', 'password'); assert.equal(f.sync.status.phase, 'conflict');
  f.sync.stop(); const reloaded = f.fixture.service(); await reloaded.sync.start();
  assert.equal(reloaded.sync.status.phase, 'conflict'); assert.equal(reloaded.sync.pending, 1); assert.equal(reloaded.sync.queue(s), false);
  assert.equal(f.calls.filter(c => c.path.endsWith('/apply_sports_day_update')).length, attempts);
  await reloaded.sync.acceptRemote(); assert.equal(reloaded.sync.status.phase, 'synced'); assert.equal(reloaded.sync.pending, 0); reloaded.sync.stop();
});

await test('Another device needs an explicit Transfer to replace the active scorekeeper', async () => {
  const f = await writerFixture(), other = f.fixture.service({ getStorage: () => memoryStorage() });
  await other.sync.start(); await other.sync.login('keeper@example.org', 'password');
  assert.equal(await other.sync.claimWriter(), false); assert.equal(other.sync.status.phase, 'busy');
  assert.equal(await other.sync.claimWriter({ transfer: true }), true);
  await f.sync.refresh(); assert.equal(f.sync.role, 'viewer'); assert.equal(f.sync.queue(defaultState()), false);
  f.sync.stop(); other.sync.stop();
});

await test('A transferred lease keeps the old phone’s unsent results and blocks further editing', async () => {
  const f = await writerFixture(), s = defaultState(); f.fixture.offline(true); s.borrow.scores[0][0] = 5;
  f.sync.queue(s); await f.sync.flush(); f.fixture.offline(false);
  const other = f.fixture.service({ getStorage: () => memoryStorage() }); await other.sync.start(); await other.sync.login('keeper@example.org', 'password');
  await other.sync.claimWriter({ transfer: true }); await f.sync.flush();
  assert.equal(f.sync.role, 'viewer'); assert.equal(f.sync.status.phase, 'conflict'); assert.equal(f.sync.pending, 1);
  assert.equal(f.fixture.shared.borrow.scores[0][0], null); assert.equal(f.sync.queue(s), false);
  f.sync.stop(); other.sync.stop();
});

await test('An expired transferred lease cannot be silently reclaimed by an old offline phone', async () => {
  const f = await writerFixture(), s = defaultState(); f.fixture.offline(true); s.borrow.scores[0][0] = 5;
  f.sync.queue(s); await f.sync.flush(); f.fixture.offline(false);
  const other = f.fixture.service({ getStorage: () => memoryStorage() }); await other.sync.start(); await other.sync.login('keeper@example.org', 'password');
  await other.sync.claimWriter({ transfer: true }); const transferred = f.fixture.writer;
  f.fixture.advance(180000); await f.sync.flush();
  assert.equal(f.fixture.writer, transferred); assert.equal(f.sync.role, 'viewer'); assert.equal(f.sync.pending, 1);
  assert.equal(f.sync.status.phase, 'conflict');
  assert.equal(f.fixture.shared.borrow.scores[0][0], null); assert.equal(f.sync.queue(s), false);
  f.sync.stop(); other.sync.stop();
});

await test('Explicitly transferring back after a reload cannot flush results recorded under an older writer generation', async () => {
  const f = await writerFixture(), s = defaultState(); f.fixture.offline(true); s.borrow.scores[0][0] = 5;
  f.sync.queue(s); await f.sync.flush(); f.sync.stop(); f.fixture.offline(false);
  const other = f.fixture.service({ getStorage: () => memoryStorage() }); await other.sync.start(); await other.sync.login('keeper@example.org', 'password');
  await other.sync.claimWriter({ transfer: true });
  const returned = f.fixture.service();
  assert.equal(await returned.sync.claimWriter({ transfer: true }), true);
  assert.equal(returned.sync.status.phase, 'conflict'); assert.equal(returned.sync.pending, 1);
  assert.equal(returned.sync.queue(s), false); await returned.sync.flush();
  assert.equal(f.fixture.shared.borrow.scores[0][0], null); assert.equal(f.fixture.revision, 0);
  await returned.sync.acceptRemote(); assert.equal(returned.sync.status.phase, 'synced'); assert.equal(returned.sync.pending, 0);
  returned.sync.stop(); other.sync.stop();
});

await test('A delayed same-score claim response cannot restore the old writer after a transfer was observed', async () => {
  const f = fixture(); let delay = false, release, arrived;
  const waiting = new Promise(resolve => arrived = resolve), blocked = new Promise(resolve => release = resolve);
  const first = f.service({ fetch: async (url, options) => {
    const response = await f.fetch(url, options);
    if (delay && url.endsWith('/claim_sports_day_writer')) { delay = false; arrived(); await blocked; }
    return response;
  } });
  await first.sync.start(); await first.sync.login('keeper@example.org', 'password'); await first.sync.claimWriter();
  delay = true; const renewal = first.sync.claimWriter({ adoptRemote: false }); await waiting;
  const other = f.service({ getStorage: () => memoryStorage() }); await other.sync.start(); await other.sync.login('keeper@example.org', 'password');
  await other.sync.claimWriter({ transfer: true }); await first.sync.refresh();
  assert.equal(first.sync.role, 'viewer'); release(); assert.equal(await renewal, false);
  assert.equal(first.sync.role, 'viewer'); assert.equal(first.sync.queue(defaultState()), false);
  assert.equal(first.sync.remote.writer_id, f.writer); first.sync.stop(); other.sync.stop();
});

await test('A timer keeps the right countdown when the scorekeeper phone clock is skewed', async () => {
  const f = await writerFixture({ localOffset: 90000 }), s = defaultState(); s.timers['relay:0'] = makeClock(60);
  startClock(s.timers, 'relay:0', f.fixture.now() + 90000); s.activeKey = 'relay:0';
  f.sync.queue(s); await f.sync.flush(); assert.equal(f.fixture.shared.timers['relay:0'].deadline, f.fixture.now() + 60000);
  assert.equal(f.sync.offsetMs, -90000); f.sync.stop();
});

await test('The same writer renews an expired offline lease before sending pending scores', async () => {
  const f = await writerFixture(), s = defaultState(); f.fixture.offline(true); s.borrow.scores[0][0] = 5;
  f.sync.queue(s); await f.sync.flush(); f.fixture.advance(180000); f.fixture.offline(false);
  await f.sync.flush(); assert.equal(f.sync.pending, 0); assert.equal(f.sync.role, 'writer'); assert.equal(f.fixture.shared.borrow.scores[0][0], 5);
  assert.equal(f.calls.filter(c => c.path.endsWith('/claim_sports_day_writer')).length, 2); f.sync.stop();
});

await test('Realtime invalidation refreshes viewers and stopping removes the subscription and fallback timer', async () => {
  const f = fixture(); let invalidate, connection, closed = false;
  const { sync, delivered } = f.service({ subscribe: (onInvalidate, onConnection) => { invalidate = onInvalidate; connection = onConnection; return () => closed = true; } });
  await sync.start(); const s = defaultState(); s.borrow.scores[0][0] = 5; f.externalUpdate(s);
  invalidate(); await sync.refresh(); assert.equal(delivered.at(-1).state.borrow.scores[0][0], 5);
  connection(true); await sync.refresh(); sync.stop(); assert.equal(closed, true); assert.equal(f.intervals.size, 0);
});

await test('Login credentials are private, session refresh is automatic, and logout keeps pending results', async () => {
  const f = await writerFixture(); assert.equal(f.sync.status.email, 'keeper@example.org');
  assert.equal('access_token' in f.sync.status, false); assert.equal('access_token' in f.sync.session, false);
  assert.equal([...f.storage.data.values()][0].includes('private-password'), false);
  f.fixture.advance(3600000); await f.sync.claimWriter();
  assert.equal(f.calls.filter(c => c.path === '/auth/v1/token').length, 2);
  f.fixture.offline(true); const s = defaultState(); s.borrow.scores[0][0] = 5; f.sync.queue(s); await f.sync.flush();
  await f.sync.logout(); assert.equal(f.sync.session, null); assert.equal(f.sync.role, 'viewer'); assert.equal(f.sync.pending, 1);
  const persisted = JSON.parse([...f.storage.data.values()][0]); assert.equal(persisted.session, null); f.sync.stop();
});

await test('An invalidated scorekeeper login clears credentials without losing pending results', async () => {
  const f = await writerFixture(), s = defaultState(); s.borrow.scores[0][0] = 5; f.fixture.denyAccess();
  f.sync.queue(s); await f.sync.flush();
  assert.equal(f.sync.status.phase, 'signed-out'); assert.equal(f.sync.status.signedIn, false);
  assert.equal(f.sync.role, 'viewer'); assert.equal(f.sync.pending, 1); f.sync.stop();
});

await test('A stalled request times out and leaves the viewer usable offline', async () => {
  const f = fixture();
  const { sync } = f.service({ requestTimeoutMs: 5, fetch: (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Error('Request aborted')), { once: true });
  }) });
  await sync.start(); assert.equal(sync.status.phase, 'offline'); assert.equal(sync.status.connected, false); sync.stop();
});

await test('A response with received headers but a stalled JSON body still times out as a network failure', async () => {
  const f = fixture();
  const { sync } = f.service({ requestTimeoutMs: 5, fetch: async (url, options) => ({ ok: true, status: 200,
    json: () => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(Error('Body aborted'), { name: 'AbortError' })), { once: true })),
  }) });
  await sync.start(); assert.equal(sync.status.phase, 'offline'); assert.equal(sync.status.error, 'Waiting for a connection.'); sync.stop();
});

await test('Unavailable storage is reported while current pending scores remain in memory', async () => {
  const f = fixture(), { sync } = f.service({ getStorage: () => { throw Error('Blocked'); } });
  await sync.start(); await sync.login('keeper@example.org', 'password'); await sync.claimWriter();
  f.offline(true); const s = defaultState(); s.borrow.scores[0][0] = 5; sync.queue(s); await sync.flush();
  assert.equal(sync.status.storageError, true); assert.equal(sync.pending, 1); sync.stop();
});

await test('Unreadable pending sync data is protected from silent replacement', async () => {
  const f = fixture(), key = 'cg-sports-day-sync:https://test-project.supabase.co:cgs-oct25'; f.storage.setItem(key, '{unfinished');
  const { sync } = f.service(); await sync.start(); await sync.login('keeper@example.org', 'password'); await sync.claimWriter();
  assert.equal(f.storage.getItem(key), '{unfinished'); assert.equal(sync.status.storageError, true); sync.stop();
});

for (const result of tests) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.cause ? '\n' + result.cause.stack : ''}`);
if (tests.some(result => !result.passed)) process.exitCode = 1;
console.log(`${tests.filter(result => result.passed).length}/${tests.length} sync tests passed.`);
