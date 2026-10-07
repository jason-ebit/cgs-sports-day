import { defaultState, validateState, GAME_IDS } from './model.js?v=22';

// Shared snapshots deliberately omit names of leaders, medical/head-count notes,
// committee reminders and the free-text explanation of approved placings.
export function publicSnapshot(state, { offsetMs = 0 } = {}) {
  const s = validateState(state), offset = Math.round(offsetMs);
  return {
    version: 1,
    teams: s.teams.map(({ id, name, seed }) => ({ id, name, seed })),
    tug: s.tug, borrow: s.borrow, basket: s.basket, relay: s.relay,
    cavalry: {
      division: s.cavalry.division, cap: s.cavalry.cap,
      divisions: Object.fromEntries(['women', 'men'].map(id => {
        const { active, eliminated, started } = s.cavalry.divisions[id];
        return [id, { active, eliminated, started }];
      })),
    },
    placements: Object.fromEntries(GAME_IDS.map(id => [id, {
      values: s.placements[id].values, approved: Boolean(s.placements[id].rule.trim()),
    }])),
    timers: Object.fromEntries(Object.entries(s.timers).map(([id, clock]) => [id, {
      ...clock, deadline: clock.deadline === null ? null : clock.deadline + offset,
    }])),
    finished: s.finished, activeKey: s.activeKey,
  };
}

export function mergePublicState(snapshot, localState = defaultState(), { offsetMs = 0 } = {}) {
  if (!snapshot || snapshot.version !== 1) throw Error('The shared scores are not valid.');
  const local = validateState(localState), offset = Math.round(offsetMs), next = defaultState();
  next.teams = snapshot.teams?.map((team, index) => ({
    id: team.id, name: team.name, seed: team.seed,
    leader: local.teams[index]?.leader ?? '', participants: local.teams[index]?.participants ?? null,
  }));
  for (const key of ['tug', 'borrow', 'basket', 'relay', 'finished', 'activeKey']) next[key] = snapshot[key];
  next.cavalry.division = snapshot.cavalry?.division;
  next.cavalry.cap = snapshot.cavalry?.cap;
  next.cavalry.rule = local.cavalry.rule;
  for (const id of ['women', 'men']) next.cavalry.divisions[id] = {
    ...snapshot.cavalry?.divisions?.[id], counts: local.cavalry.divisions[id].counts,
  };
  for (const id of GAME_IDS) {
    const placing = snapshot.placements?.[id];
    if (!placing || typeof placing.approved !== 'boolean') throw Error('The shared placings are not valid.');
    next.placements[id] = {
      values: placing.values,
      rule: placing.approved ? local.placements[id].rule.trim() || 'Approved result' : '',
    };
  }
  if (!snapshot.timers || typeof snapshot.timers !== 'object' || Array.isArray(snapshot.timers)) throw Error('The shared timers are not valid.');
  next.timers = Object.fromEntries(Object.entries(snapshot.timers).map(([id, clock]) => [id, {
    ...clock, deadline: clock.deadline === null ? null : clock.deadline - offset,
  }]));
  next.notes = local.notes;
  next.committeeNotes = local.committeeNotes;
  return validateState(next);
}

function samePublic(a, b) {
  if (!b) return false;
  const normalized = { ...a, timers: Object.fromEntries(Object.entries(a.timers).map(([id, clock]) => {
    const known = b.timers?.[id];
    // Network latency can move the estimated server offset by a few milliseconds.
    // A private-note save must not become a timer write because of that estimate.
    const deadline = clock.deadline !== null && known?.deadline !== null && Math.abs(clock.deadline - known?.deadline) <= 1000
      ? known.deadline : clock.deadline;
    return [id, { ...clock, deadline }];
  })) };
  return JSON.stringify(normalized) === JSON.stringify(b);
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// The database owns the writer lease and revision. An attempted operation stays
// immutable until acknowledged, so a lost response can be retried idempotently.
export function createSyncService({
  url, publishableKey, eventId = 'cgs-oct25', fetch: fetcher = globalThis.fetch,
  now = () => Date.now(), uuid = () => globalThis.crypto.randomUUID(),
  getStorage = () => globalThis.localStorage,
  scheduler = globalThis, subscribe, onStatus = () => {}, onRemote = () => {},
  pollMs = 30000, heartbeatMs = 40000, requestTimeoutMs = 15000,
} = {}) {
  if (!/^https:\/\/[^/]+\.supabase\.co\/?$/.test(url ?? '') || !publishableKey) throw Error('Shared scores need a Supabase project URL and publishable key.');
  const baseUrl = url.replace(/\/$/, ''), storageKey = `cg-sports-day-sync:${baseUrl}:${eventId}`;
  let writerId = uuid(), session = null, wantsWriter = false, role = 'viewer';
  let revision = null, remote = null, offsetMs = 0, connected = false, phase = 'connecting', error = '';
  let outbox = [], storageError = false, protectedStorage = false, running = false, interval = null, unsubscribe = null;
  let sending = null, refreshing = null, refreshingToken = null, renewing = null;
  let lastAck = null, lastRenewal = 0, remoteAvailable = false, deliveredOffset = null;
  let blockedConflict = false, conflictMessage = '';
  let knownLeaseRevision = null;

  function validateSnapshot(value) { mergePublicState(value); return value; }
  try {
    const raw = getStorage().getItem(storageKey);
    if (raw !== null) {
      const stored = JSON.parse(raw);
      if (!stored || !uuidPattern.test(stored.writerId) || !Array.isArray(stored.outbox) || stored.outbox.length > 2 || typeof stored.wantsWriter !== 'boolean') throw Error('Invalid saved sync data.');
      if (stored.conflict !== undefined && typeof stored.conflict !== 'boolean') throw Error('Invalid saved sync conflict.');
      if (stored.revision !== undefined && stored.revision !== null && (!Number.isSafeInteger(stored.revision) || stored.revision < 0)) throw Error('Invalid saved shared revision.');
      if (stored.leaseRevision !== undefined && stored.leaseRevision !== null && (!Number.isSafeInteger(stored.leaseRevision) || stored.leaseRevision < 0)) throw Error('Invalid saved scorekeeper revision.');
      if (stored.offsetMs !== undefined && !Number.isSafeInteger(stored.offsetMs)) throw Error('Invalid saved server clock offset.');
      for (const item of stored.outbox) {
        if (!uuidPattern.test(item.operationId) || !Number.isSafeInteger(item.baseRevision) || item.baseRevision < 0 || typeof item.attempted !== 'boolean') throw Error('Invalid pending result.');
        if (item.leaseRevision !== undefined && (!Number.isSafeInteger(item.leaseRevision) || item.leaseRevision < 0)) throw Error('Invalid pending scorekeeper revision.');
        validateSnapshot(item.snapshot);
      }
      if (stored.session !== null && (!stored.session || typeof stored.session.access_token !== 'string' || typeof stored.session.refresh_token !== 'string' || !Number.isFinite(stored.session.expires_at))) throw Error('Invalid saved login.');
      writerId = stored.writerId; outbox = stored.outbox; session = stored.session; wantsWriter = stored.wantsWriter;
      revision = stored.revision ?? null; knownLeaseRevision = stored.leaseRevision ?? outbox[0]?.leaseRevision ?? null;
      offsetMs = stored.offsetMs ?? 0;
      role = wantsWriter && session ? 'writer' : 'viewer';
      blockedConflict = stored.conflict === true;
      conflictMessage = blockedConflict ? 'The shared scores changed. Pending results were kept on this device.' : '';
      if (outbox.length) { phase = blockedConflict ? 'conflict' : 'pending'; revision = outbox[0].baseRevision; }
    }
  } catch { storageError = true; protectedStorage = true; }

  function persist() {
    if (protectedStorage) return false;
    try {
      getStorage().setItem(storageKey, JSON.stringify({ writerId, session, wantsWriter, outbox, conflict: blockedConflict,
        revision, leaseRevision: knownLeaseRevision, offsetMs }));
      storageError = false; return true;
    } catch { storageError = true; return false; }
  }
  function status() {
    return { phase, role, pending: outbox.length, revision, connected, email: session?.user?.email ?? '',
      signedIn: Boolean(session), error, remoteAvailable, storageError, offsetMs };
  }
  function emit(nextPhase = phase, message = '') {
    phase = blockedConflict ? 'conflict' : nextPhase;
    error = blockedConflict ? conflictMessage : message;
    onStatus(status());
  }
  function block(message) { blockedConflict = true; conflictMessage = message; persist(); emit('conflict'); }
  function failure(cause) {
    connected = false;
    if (cause?.status === 401 || (cause?.status === 400 && !session)) {
      emit('signed-out', 'Sign in again to continue syncing.'); return;
    }
    emit(outbox.length ? 'pending' : 'offline', cause?.network ? 'Waiting for a connection.' : cause?.message || 'Shared scores are unavailable.');
  }
  async function request(path, { method = 'POST', body, auth = false } = {}) {
    const start = now(), headers = { apikey: publishableKey, 'Content-Type': 'application/json' };
    if (auth) {
      await ensureSession();
      if (!session) throw Error('Sign in to keep score.');
      headers.Authorization = `Bearer ${session.access_token}`;
    }
    let response, data;
    const controller = new AbortController(), timeout = globalThis.setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      response = await fetcher(baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: controller.signal });
      try { data = await response.json(); }
      catch (cause) {
        if (controller.signal.aborted || cause?.name === 'AbortError') throw cause;
        throw Error('The shared score service returned an unreadable response.');
      }
    } catch (cause) {
      if (controller.signal.aborted || cause?.name === 'AbortError' || !response) {
        const networkError = Error('Waiting for a connection.'); networkError.network = true; throw networkError;
      }
      throw cause;
    }
    finally { globalThis.clearTimeout(timeout); }
    if (!response.ok) {
      const cause = Error(String(data?.msg || data?.message || data?.error_description || 'Unable to reach shared scores.').slice(0, 240));
      cause.status = response.status;
      if (response.status === 401 && auth) {
        session = null; role = 'viewer'; wantsWriter = false; persist();
        emit('signed-out', 'Sign in again to continue syncing.');
      }
      throw cause;
    }
    if (data && Number.isFinite(data.server_ms) && (!remote || (data.server_ms >= remote.server_ms && data.lease_revision >= remote.lease_revision))) offsetMs = Math.round(data.server_ms - (start + now()) / 2);
    connected = true;
    return data;
  }
  function normalizeSession(data) {
    if (!data?.access_token || !data?.refresh_token) throw Error('The scorekeeper login did not finish.');
    return { access_token: data.access_token, refresh_token: data.refresh_token,
      expires_at: Math.floor(now() / 1000) + (data.expires_in || Math.max(60, data.expires_at - (now() + offsetMs) / 1000) || 3600),
      user: { email: data.user?.email || session?.user?.email || '' } };
  }
  async function ensureSession() {
    if (!session) return;
    if (session.expires_at * 1000 - now() > 60000) return;
    if (!refreshingToken) refreshingToken = (async () => {
      try {
        const data = await request('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: session.refresh_token } });
        session = normalizeSession(data); persist();
      } catch (cause) {
        if (cause.status === 400 || cause.status === 401) { session = null; role = 'viewer'; persist(); emit('signed-out', 'Sign in again to continue syncing.'); }
        throw cause;
      } finally { refreshingToken = null; }
    })();
    await refreshingToken;
  }
  function record(data) {
    if (!data || !Number.isSafeInteger(data.revision) || data.revision < 0) throw Error('The shared score revision is invalid.');
    if (!Number.isSafeInteger(data.lease_revision) || data.lease_revision < 0) throw Error('The shared scorekeeper revision is invalid.');
    if (data.public_state !== null) validateSnapshot(data.public_state);
    if ((revision !== null && data.revision < revision) || (remote && (data.revision < remote.revision || data.lease_revision < remote.lease_revision))) return false;
    remote = data; remoteAvailable = data.public_state !== null;
    knownLeaseRevision = data.lease_revision;
    return true;
  }
  function deliver(data) {
    const changed = revision !== data.revision || !lastAck || deliveredOffset === null || Math.abs(deliveredOffset - offsetMs) > 1000;
    revision = data.revision;
    if (data.public_state !== null) {
      lastAck = data.public_state;
      if (changed) { deliveredOffset = offsetMs; onRemote(data.public_state, { revision, offsetMs }); }
    }
  }
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const data = await request('/rest/v1/rpc/read_sports_day_event', { body: { p_event_id: eventId } });
        if (!record(data)) return remote;
        if (role === 'writer' && data.writer_id !== writerId) {
          role = 'viewer'; wantsWriter = false; persist();
          if (outbox.length) block('Scorekeeping moved to another phone. Pending results were kept on this device.');
          else emit('busy', 'Scorekeeping moved to another phone.');
          if (!outbox.length) deliver(data);
        } else if (outbox.length) {
          emit(phase === 'conflict' ? 'conflict' : 'pending', phase === 'conflict' ? error : 'Results are waiting to sync.');
        } else {
          deliver(data); emit(role === 'writer' ? 'synced' : 'watching');
        }
        return data;
      } catch (cause) { failure(cause); throw cause; }
      finally { refreshing = null; }
    })();
    return refreshing;
  }
  async function login(email, password) {
    const data = await request('/auth/v1/token?grant_type=password', { body: { email: email.trim(), password } });
    session = normalizeSession(data); persist(); emit(outbox.length ? 'pending' : 'watching');
    return session.user;
  }
  async function claimWriter({ transfer = false, adoptRemote = true, flushPending = true } = {}) {
    const data = await request('/rest/v1/rpc/claim_sports_day_writer', { auth: true, body: {
      p_event_id: eventId, p_writer_id: writerId, p_transfer: Boolean(transfer),
    } });
    if (!record(data)) return false;
    if (data.status !== 'claimed') {
      role = 'viewer'; wantsWriter = false; persist();
      if (outbox.length) block('Another phone is keeping score. Pending results were kept on this device.');
      else emit('busy', 'Another phone is keeping score. Use Transfer to move it here.');
      return false;
    }
    role = 'writer'; wantsWriter = true; lastRenewal = now();
    if (outbox.length && outbox[0].leaseRevision !== data.lease_revision) block('Scorekeeping changed phones. Load the shared scores before editing. Pending results were kept on this device.');
    if (!outbox.length) {
      revision = data.revision;
      lastAck = data.public_state;
      if (adoptRemote && data.public_state !== null) onRemote(data.public_state, { revision, offsetMs });
    }
    persist(); emit(outbox.length ? 'pending' : 'synced');
    if (outbox.length && flushPending && !blockedConflict) await flush();
    return true;
  }
  async function renewWriter() {
    if (renewing) return renewing;
    renewing = (async () => {
      try { return await claimWriter({ adoptRemote: false, flushPending: false }); }
      catch (cause) { failure(cause); return false; }
      finally { renewing = null; }
    })();
    return renewing;
  }
  function queue(state) {
    if (role !== 'writer' || blockedConflict) return false;
    const snapshot = publicSnapshot(state, { offsetMs });
    if (samePublic(snapshot, outbox.at(-1)?.snapshot ?? lastAck)) return true;
    if (revision === null) return false;
    const tail = outbox.at(-1);
    if (tail && !tail.attempted) {
      tail.snapshot = snapshot; tail.operationId = uuid();
    } else {
      outbox.push({ baseRevision: outbox.length ? outbox[0].baseRevision + 1 : revision,
        leaseRevision: outbox[0]?.leaseRevision ?? knownLeaseRevision, operationId: uuid(), snapshot, attempted: false });
    }
    persist(); emit('pending');
    void flush();
    return true;
  }
  async function flush() {
    if (sending) return sending;
    if (role !== 'writer' || blockedConflict || !outbox.length) return false;
    sending = (async () => {
      if (now() - lastRenewal >= heartbeatMs && !await renewWriter()) return false;
      while (role === 'writer' && outbox.length && !blockedConflict) {
        const item = outbox[0]; item.attempted = true; persist(); emit('syncing');
        try {
          const data = await request('/rest/v1/rpc/apply_sports_day_update', { auth: true, body: {
            p_event_id: eventId, p_writer_id: writerId, p_expected_revision: item.baseRevision,
            p_operation_id: item.operationId, p_snapshot: item.snapshot,
          } });
          if (!record(data)) {
            if (remote?.writer_id !== writerId) { role = 'viewer'; wantsWriter = false; }
            block('The shared scores changed. Pending results were kept on this device.'); return false;
          }
          if (!['applied', 'duplicate'].includes(data.status)) {
            if (data.status === 'lease_lost') { role = 'viewer'; wantsWriter = false; }
            block(data.status === 'lease_lost' ? 'Scorekeeping moved to another phone. Pending results were kept on this device.' : 'The shared scores changed. Pending results were kept on this device.');
            persist(); return false;
          }
          revision = data.revision; lastAck = data.public_state; lastRenewal = now();
          outbox.shift();
          if (outbox.length) outbox[0].baseRevision = revision;
          persist(); emit(role === 'writer' ? outbox.length ? 'pending' : 'synced' : outbox.length ? 'conflict' : 'watching');
        } catch (cause) { failure(cause); return false; }
      }
      return !outbox.length;
    })();
    try { return await sending; } finally { sending = null; }
  }
  async function acceptRemote() {
    if (sending) await sending;
    const data = await refresh();
    if (!data || data.public_state === null) throw Error('There are no shared scores to load yet.');
    outbox = []; blockedConflict = false; conflictMessage = ''; protectedStorage = false; persist();
    revision = null; deliver(data); emit(role === 'writer' ? 'synced' : 'watching');
    return true;
  }
  async function releaseWriter() {
    if (sending) await sending;
    try {
      if (session && role === 'writer') await request('/rest/v1/rpc/release_sports_day_writer', { auth: true, body: { p_event_id: eventId, p_writer_id: writerId } });
    } finally {
      role = 'viewer'; wantsWriter = false; persist(); emit(outbox.length ? 'pending' : 'watching');
    }
  }
  async function logout() {
    const token = session?.access_token;
    try { await releaseWriter(); } catch { /* Logout must still clear a local login offline. */ }
    session = null; persist();
    if (token) {
      try { await fetcher(baseUrl + '/auth/v1/logout', { method: 'POST', headers: { apikey: publishableKey, Authorization: `Bearer ${token}` } }); }
      catch { /* The server session will expire; no credential remains on this phone. */ }
    }
    emit(outbox.length ? 'pending' : 'watching');
  }
  async function start() {
    if (running) return;
    running = true; emit();
    if (subscribe) unsubscribe = subscribe(() => { void refresh().catch(() => {}); }, online => {
      if (online) void refresh().catch(() => {});
    });
    interval = scheduler.setInterval(() => {
      if (role === 'writer' && now() - lastRenewal >= heartbeatMs) void renewWriter().then(claimed => { if (claimed) void flush(); });
      else if (outbox.length && role === 'writer') void flush();
      void refresh().catch(() => {});
    }, pollMs);
    try {
      await refresh();
      if (wantsWriter && session) await claimWriter({ adoptRemote: !outbox.length });
    } catch (cause) { failure(cause); }
  }
  function stop() {
    running = false;
    if (interval !== null) scheduler.clearInterval(interval);
    interval = null;
    if (typeof unsubscribe === 'function') unsubscribe();
    unsubscribe = null;
  }
  return { start, stop, refresh, login, logout, claimWriter, releaseWriter, queue, flush, acceptRemote,
    get status() { return status(); }, get role() { return role; }, get session() { return session?.user ?? null; },
    get pending() { return outbox.length; }, get remote() { return remote; }, get offsetMs() { return offsetMs; },
  };
}
