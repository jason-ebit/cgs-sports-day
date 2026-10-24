import { defaultState, validateState, GAME_IDS } from './model.js?v=62';
import { changedScoreUnits, scoreUnits, rebaseScoreSnapshot, reanchorScoreIntent, replaceScoreUnits, sameScoreValue } from './sync-merge.js?v=62';

// Shared snapshots deliberately omit names of leaders, medical/head-count notes,
// committee reminders and the free-text explanation of approved placings.
export function publicSnapshot(state, { offsetMs = 0 } = {}) {
  const s = validateState(state), offset = Math.round(offsetMs);
  // Keep the original nested map readable by phones running the prior release.
  // New shared items use optional top-level fields that those clients ignore.
  const {'cold-packs':equipmentColdPacksReady,...equipmentReady}=s.equipmentReady;
  return {
    version: 1,
    teams: s.teams.map(({ id, name, seed }) => ({ id, name, seed })),
    committeeMembers: s.committeeMembers,
    committeeRotation: s.committeeRotation,
    equipmentReady, equipmentColdPacksReady,
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
    timers: Object.fromEntries(Object.entries(s.timers).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([id, clock]) => [id, {
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
  if(snapshot.committeeMembers!==undefined)next.committeeMembers=snapshot.committeeMembers;
  if(snapshot.committeeRotation!==undefined)next.committeeRotation=snapshot.committeeRotation;
  if(snapshot.equipmentReady!==undefined)next.equipmentReady=snapshot.equipmentReady;
  if(snapshot.equipmentColdPacksReady!==undefined){
    if(typeof snapshot.equipmentColdPacksReady!=='boolean')throw Error('The shared equipment checks are not valid.');
    if(Object.hasOwn(snapshot.equipmentReady??{},'cold-packs')&&typeof snapshot.equipmentReady['cold-packs']!=='boolean')throw Error('The shared equipment checks are not valid.');
    next.equipmentReady={...next.equipmentReady,'cold-packs':snapshot.equipmentColdPacksReady};
  }
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
  next.committeeChecklist = local.committeeChecklist;
  next.preferences = local.preferences;
  return validateState(next);
}

function samePublic(a, b) {
  if (!b) return false;
  // Old v1 snapshots lack shared fields or newer equipment items, and JSONB reorders keys.
  // Compare the same canonical public shape without rewriting retry payloads.
  const reference = publicSnapshot(mergePublicState(b));
  const normalized = { ...a, timers: Object.fromEntries(Object.entries(a.timers).map(([id, clock]) => {
    const known = reference.timers?.[id];
    // Network latency can move the estimated server offset by a few milliseconds.
    // A private-note save must not become a timer write because of that estimate.
    const deadline = clock.deadline !== null && known?.deadline !== null && Math.abs(clock.deadline - known?.deadline) <= 1000
      ? known.deadline : clock.deadline;
    return [id, { ...clock, deadline }];
  })) };
  return JSON.stringify(normalized) === JSON.stringify(reference);
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clone = value => structuredClone(value);
const canonical = snapshot => publicSnapshot(mergePublicState(snapshot));
const validRevision = value => Number.isSafeInteger(value) && value >= 0;

// Devices share editor authority, while every immutable request still uses a
// revision compare-and-swap. Pending intent is based on real public snapshots.
export function createSyncService({
  url, publishableKey, eventId = 'cgs-oct25', fetch: fetcher = globalThis.fetch,
  now = () => Date.now(), uuid = () => globalThis.crypto.randomUUID(),
  getStorage = () => globalThis.localStorage,
  scheduler = globalThis, subscribe, onStatus = () => {}, onRemote = () => {},
  pollMs = 30000, requestTimeoutMs = 15000,
} = {}) {
  if (!/^https:\/\/[^/]+\.supabase\.co\/?$/.test(url ?? '') || !publishableKey) throw Error('Shared scores need a Supabase project URL and publishable key.');
  const baseUrl = url.replace(/\/$/, ''), storageKey = `cg-sports-day-sync:${baseUrl}:${eventId}`;
  let writerId = uuid(), session = null, wantsWriter = false, role = 'viewer', editingMode = null;
  let revision = null, remote = null, confirmed = null, presented = null, lastDelivered = null;
  let unitVersions = {}, resetRevision = 0, offsetMs = 0, connected = false, phase = 'connecting', error = '';
  let outbox = [], legacyOutbox = [], blockedConflict = false, conflictMessage = '';
  let storageError = false, protectedStorage = false, running = false, interval = null, unsubscribe = null;
  let sending = null, refreshing = null, refreshingToken = null, authorizing = null, deliveredOffset = null;

  function validateSession(value) {
    if (value !== null && (!value || typeof value.access_token !== 'string' || typeof value.refresh_token !== 'string' || !Number.isFinite(value.expires_at))) throw Error('Invalid saved login.');
    return value;
  }
  function validateVersions(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 2000 || Object.values(value).some(version => !validRevision(version))) throw Error('The shared unit revisions are invalid.');
    return { ...value };
  }
  function normalizeSavedSnapshot(snapshot) {
    const normalized = canonical(snapshot), supported = clone(snapshot);
    // A saved intent can acquire only blank appended roster slots. Its
    // immutable attempted request stays untouched so a lost receipt can retry.
    // Canonical validation already checked the exact published roster shape,
    // every department and every name before this one permitted normalization.
    if (supported.committeeMembers) supported.committeeMembers = clone(normalized.committeeMembers);
    if (!sameScoreValue(normalized, supported)) throw Error('The pending update contains unsupported fields.');
    return normalized;
  }
  try {
    const raw = getStorage().getItem(storageKey);
    if (raw !== null) {
      const saved = JSON.parse(raw);
      if (!saved || !uuidPattern.test(saved.writerId) || !Array.isArray(saved.outbox) || saved.outbox.length > 2 || typeof saved.wantsWriter !== 'boolean') throw Error('Invalid saved sync data.');
      session = validateSession(saved.session); writerId = saved.writerId; wantsWriter = saved.wantsWriter;
      if (saved.format === 2) {
        if (saved.revision !== null && !validRevision(saved.revision)) throw Error('Invalid saved revision.');
        revision = saved.revision; unitVersions = validateVersions(saved.unitVersions); resetRevision = saved.resetRevision;
        if (!validRevision(resetRevision) || revision !== null && (resetRevision > revision || Object.values(unitVersions).some(value => value > revision))) throw Error('Invalid reset revision.');
        confirmed = saved.confirmed === null ? null : canonical(saved.confirmed);
        presented = saved.presented === null ? null : canonical(saved.presented);
        editingMode = saved.editingMode === 'shared-v1' ? 'shared-v1' : null;
        outbox = saved.outbox.map((item, index) => {
          if (!item || !uuidPattern.test(item.operationId) || !validRevision(item.baseRevision) || typeof item.attempted !== 'boolean' || typeof item.barrier !== 'boolean' || index > 0 && item.attempted) throw Error('Invalid pending update.');
          const baseSnapshot = normalizeSavedSnapshot(item.baseSnapshot), snapshot = normalizeSavedSnapshot(item.snapshot);
          if (revision === null || item.baseRevision > revision) throw Error('Invalid pending base revision.');
          if (item.attempted && (!item.request || item.request.p_operation_id !== item.operationId || item.request.p_device_id !== writerId || item.request.p_event_id !== eventId || item.request.p_expected_revision !== item.baseRevision || item.request.p_barrier !== item.barrier || !sameScoreValue(normalizeSavedSnapshot(item.request.p_snapshot), snapshot))) throw Error('Invalid attempted request.');
          if (item.attempted && Object.keys(item.request).sort().join(',') !== ['p_event_id', 'p_device_id', 'p_expected_revision', 'p_operation_id', 'p_snapshot', 'p_barrier'].sort().join(',')) throw Error('Invalid attempted request fields.');
          return { ...clone(item), baseSnapshot, snapshot };
        });
        legacyOutbox = Array.isArray(saved.legacyOutbox) ? saved.legacyOutbox : [];
        if (legacyOutbox.length > 2) throw Error('Invalid older pending updates.');
        for (const item of legacyOutbox) canonical(item.snapshot);
        blockedConflict = saved.conflict === true || legacyOutbox.length > 0;
        conflictMessage = typeof saved.conflictMessage === 'string' ? saved.conflictMessage.slice(0, 240) : '';
      } else {
        for (const item of saved.outbox) {
          if (!item || !uuidPattern.test(item.operationId) || !validRevision(item.baseRevision) || typeof item.attempted !== 'boolean') throw Error('Invalid older pending update.');
          canonical(item.snapshot);
        }
        legacyOutbox = clone(saved.outbox);
        // Older queues do not include their true base snapshots. They cannot
        // safely be converted into intent against today's shared scores.
        if (legacyOutbox.length) {
          blockedConflict = true;
          conflictMessage = 'Older pending results were kept on this device. Download a backup, then load the shared scores before editing.';
        }
      }
      if (saved.offsetMs !== undefined && !Number.isSafeInteger(saved.offsetMs)) throw Error('Invalid saved server offset.');
      offsetMs = saved.offsetMs || 0;
      role = session && wantsWriter && editingMode === 'shared-v1' ? 'writer' : 'viewer';
      if (blockedConflict) phase = 'conflict'; else if (outbox.length) phase = 'pending';
    }
  } catch { storageError = true; protectedStorage = true; role = 'viewer'; }

  const pending = () => outbox.length + legacyOutbox.length;
  function persist() {
    if (protectedStorage) return false;
    try {
      getStorage().setItem(storageKey, JSON.stringify({ format: 2, writerId, session, wantsWriter, editingMode,
        revision, unitVersions, resetRevision, confirmed, presented, outbox, legacyOutbox,
        conflict: blockedConflict, conflictMessage, offsetMs }));
      storageError = false; return true;
    } catch { storageError = true; return false; }
  }
  function status() {
    return { phase, role, pending: pending(), revision, connected, email: session?.user?.email ?? '', signedIn: Boolean(session),
      error, remoteAvailable: confirmed !== null, storageError, offsetMs, editingMode, legacyPending: legacyOutbox.length > 0 };
  }
  function emit(next = phase, message = '') {
    phase = blockedConflict ? 'conflict' : next;
    error = blockedConflict ? conflictMessage : message;
    onStatus(status());
  }
  function block(message = 'These pending changes overlap newer shared results. Download a backup, then load the shared scores before editing.') {
    blockedConflict = true; conflictMessage = message; persist(); emit('conflict');
  }
  function failure(cause) {
    connected = false;
    if (cause?.status === 401 || !session && cause?.status === 400) { emit('signed-out', 'Sign in again to continue syncing.'); return; }
    emit(pending() ? 'pending' : 'offline', cause?.network ? 'Waiting for a connection.' : cause?.message || 'Shared scores are unavailable.');
  }
  async function request(path, { method = 'POST', body, auth = false } = {}) {
    const start = now(), headers = { apikey: publishableKey, 'Content-Type': 'application/json' };
    if (auth) {
      await ensureSession();
      if (!session) throw Object.assign(Error('Sign in to keep score.'), { status: 401 });
      headers.Authorization = `Bearer ${session.access_token}`;
    }
    let response, data;
    const controller = new AbortController(), timeout = globalThis.setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      response = await fetcher(baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: controller.signal });
      try { data = await response.json(); }
      catch (cause) { if (controller.signal.aborted || cause?.name === 'AbortError') throw cause; throw Error('The shared score service returned an unreadable response.'); }
    } catch (cause) {
      if (controller.signal.aborted || cause?.name === 'AbortError' || !response) throw Object.assign(Error('Waiting for a connection.'), { network: true });
      throw cause;
    } finally { globalThis.clearTimeout(timeout); }
    if (!response.ok) {
      const cause = Object.assign(Error(String(data?.msg || data?.message || data?.error_description || 'Unable to reach shared scores.').slice(0, 240)), { status: response.status });
      if (auth && response.status === 401) { session = null; role = 'viewer'; persist(); emit('signed-out', 'Sign in again to continue syncing.'); }
      if (auth && response.status === 403) { role = 'viewer'; wantsWriter = false; persist(); emit('watching', 'This login no longer has scorekeeper access. Pending changes were kept on this device.'); }
      throw cause;
    }
    if (Number.isFinite(data?.server_ms) && (!remote || data.revision >= remote.revision && data.server_ms >= remote.server_ms)) offsetMs = Math.round(data.server_ms - (start + now()) / 2);
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
    if (!session || session.expires_at * 1000 - now() > 60000) return;
    if (!refreshingToken) refreshingToken = (async () => {
      try { session = normalizeSession(await request('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: session.refresh_token } })); persist(); }
      catch (cause) { if ([400, 401].includes(cause.status)) { session = null; role = 'viewer'; persist(); emit('signed-out', 'Sign in again to continue syncing.'); } throw cause; }
      finally { refreshingToken = null; }
    })();
    await refreshingToken;
  }
  function record(data) {
    if (!data || !validRevision(data.revision)) throw Error('The shared score revision is invalid.');
    const versions = validateVersions(data.unit_versions || {}), reset = data.reset_revision ?? 0;
    if (!validRevision(reset) || reset > data.revision || Object.values(versions).some(value => value > data.revision)) throw Error('The shared change history is invalid.');
    const snapshot = data.public_state === null ? null : canonical(data.public_state);
    if (revision !== null && data.revision < revision) return false;
    remote = data; revision = data.revision; confirmed = snapshot; unitVersions = versions; resetRevision = reset;
    if (data.editing_mode === 'shared-v1') editingMode = 'shared-v1';
    return true;
  }
  function options(item) { return { baseRevision: item.baseRevision, currentRevision: revision, unitVersions, resetRevision, barrier: item.barrier, now: now() + offsetMs }; }
  function deliver(snapshot, { force = false } = {}) {
    if (!snapshot || legacyOutbox.length || protectedStorage) return;
    const changed = force || !sameScoreValue(lastDelivered, snapshot) || deliveredOffset === null || Math.abs(deliveredOffset - offsetMs) > 1000;
    presented = clone(snapshot);
    if (changed) { lastDelivered = clone(snapshot); deliveredOffset = offsetMs; onRemote(clone(snapshot), { revision, offsetMs }); }
  }
  function projection({ force = false } = {}) {
    if (!confirmed || legacyOutbox.length || protectedStorage) return;
    let view = clone(confirmed);
    for (const item of outbox) {
      const result = rebaseScoreSnapshot(item.baseSnapshot, item.snapshot, view, { ...options(item), projecting: true });
      if (result.ok) view = result.snapshot;
      else {
        // An attempted head may already have committed; only its exact retry
        // can resolve that uncertainty. Keep the local intent visible while
        // unrelated confirmed changes continue to arrive.
        try {
          const local = reanchorScoreIntent(item.baseSnapshot, item.snapshot, view, { now: now() + offsetMs });
          view = canonical(local);
        } catch { view = presented || item.snapshot; }
      }
    }
    deliver(view, { force });
    persist();
  }
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const data = await request('/rest/v1/rpc/read_sports_day_event', { body: { p_event_id: eventId } });
        if (record(data)) { projection(); persist(); emit(outbox.length ? 'pending' : role === 'writer' ? 'synced' : 'watching'); }
        return remote;
      } catch (cause) { failure(cause); throw cause; }
      finally { refreshing = null; }
    })();
    return refreshing;
  }
  async function login(email, password) {
    session = normalizeSession(await request('/auth/v1/token?grant_type=password', { body: { email: email.trim(), password } }));
    persist(); emit(pending() ? 'pending' : 'watching'); return session.user;
  }
  async function claimWriter({ adoptRemote = true, flushPending = true } = {}) {
    if (authorizing) return authorizing;
    authorizing = (async () => {
      try {
        const data = await request('/rest/v1/rpc/authorize_sports_day_editor', { auth: true, body: { p_event_id: eventId, p_device_id: writerId, p_roster_version: 3 } });
        if (data.status !== 'authorized' || data.editing_mode !== 'shared-v1') { role = 'viewer'; persist(); emit('watching', 'Shared editing needs the latest server setup.'); return false; }
        record(data); editingMode = 'shared-v1'; role = 'writer'; wantsWriter = true;
        if (adoptRemote || outbox.length) projection({ force: true });
        persist(); emit(pending() ? 'pending' : 'synced');
        if (outbox.length && flushPending && !blockedConflict) await flush();
        return true;
      } catch (cause) { if (cause.status === 403) role = 'viewer'; failure(cause); throw cause; }
      finally { authorizing = null; }
    })();
    return authorizing;
  }
  function queue(state, { barrier = false } = {}) {
    if (role !== 'writer' || blockedConflict || protectedStorage || revision === null) return false;
    let snapshot = publicSnapshot(state, { offsetMs });
    const baseline = presented || confirmed || publicSnapshot(defaultState());
    if (!barrier && samePublic(snapshot, baseline)) return true;
    // Ignore small clock-offset noise without hiding any explicit timer edit.
    if (samePublic(snapshot, baseline)) snapshot = clone(baseline);
    const tail = outbox.at(-1);
    if (tail && !tail.attempted) { tail.snapshot = clone(snapshot); tail.barrier ||= Boolean(barrier); tail.operationId = uuid(); }
    else outbox.push({ operationId: uuid(), baseRevision: revision, baseSnapshot: clone(baseline), snapshot: clone(snapshot), barrier: Boolean(barrier), attempted: false, request: null });
    presented = clone(snapshot);
    persist(); emit('pending'); void flush(); return true;
  }
  function retargetTail(oldItem, nextSnapshot) {
    const tail = outbox[1];
    if (!tail || tail.attempted) return true;
    const oldValues = scoreUnits(oldItem.snapshot), newValues = scoreUnits(nextSnapshot);
    const transformed = changedScoreUnits(oldItem.baseSnapshot, oldItem.snapshot).filter(unit => !sameScoreValue(oldValues[unit], newValues[unit]));
    if (!transformed.length) return true;
    const anchor = replaceScoreUnits(tail.baseSnapshot, nextSnapshot, transformed);
    let next;
    try { next = reanchorScoreIntent(tail.baseSnapshot, tail.snapshot, anchor, { now: now() + offsetMs }); }
    catch { block('The pending timer change needs review. Download a backup, then load the shared scores before editing.'); return false; }
    tail.snapshot = next;
    tail.baseSnapshot = anchor;
    return true;
  }
  function prepare(item, { afterConflict = false } = {}) {
    const base = confirmed || publicSnapshot(defaultState());
    const result = rebaseScoreSnapshot(item.baseSnapshot, item.snapshot, base, options(item));
    if (!result.ok) { block(); projection(); return false; }
    if (!retargetTail(item, result.snapshot)) return false;
    if (afterConflict) item.operationId = uuid();
    item.baseSnapshot = clone(base); item.baseRevision = revision; item.snapshot = clone(result.snapshot); item.attempted = false; item.request = null;
    return true;
  }
  async function flush() {
    if (sending) return sending;
    if (role !== 'writer' || blockedConflict || !outbox.length) return false;
    sending = (async () => {
      let races = 0;
      while (role === 'writer' && outbox.length && !blockedConflict) {
        const item = outbox[0];
        if (!item.attempted) {
          if (!prepare(item)) return false;
          if (!item.barrier && sameScoreValue(item.snapshot, confirmed)) { outbox.shift(); projection({ force: true }); persist(); continue; }
          item.request = { p_event_id: eventId, p_device_id: writerId, p_expected_revision: item.baseRevision, p_operation_id: item.operationId, p_snapshot: clone(item.snapshot), p_barrier: item.barrier };
          item.attempted = true; persist();
        }
        emit('syncing');
        try {
          const data = await request('/rest/v1/rpc/apply_sports_day_patch', { auth: true, body: item.request });
          record(data);
          if (['applied', 'duplicate'].includes(data.status)) {
            const applied = data.applied_revision ?? (data.status === 'applied' ? data.revision : null);
            if (!validRevision(applied) || applied <= item.baseRevision || applied > data.revision) throw Error('The shared result receipt is invalid.');
            outbox.shift();
            if (outbox[0] && !outbox[0].attempted) outbox[0].baseRevision = Math.max(outbox[0].baseRevision, applied);
            persist(); projection({ force: true }); emit(outbox.length ? 'pending' : role === 'writer' ? 'synced' : 'watching'); races = 0;
          } else if (data.status === 'conflict') {
            if (!prepare(item, { afterConflict: true })) return false;
            persist(); projection({ force: true });
            // Bounded retry prevents a busy event from monopolising the UI.
            if (++races >= 5) { emit('pending', 'Other results are arriving. Retrying shortly.'); return false; }
          } else { block('The server could not confirm these changes. Pending results were kept on this device.'); return false; }
        } catch (cause) { failure(cause); return false; }
      }
      return outbox.length === 0;
    })();
    try { return await sending; } finally { sending = null; }
  }
  async function acceptRemote() {
    if (sending) await sending;
    const data = await refresh();
    if (!data || data.public_state === null) throw Error('There are no shared scores to load yet.');
    outbox = []; legacyOutbox = []; blockedConflict = false; conflictMessage = ''; protectedStorage = false;
    record(data); deliver(confirmed, { force: true }); persist(); emit(role === 'writer' ? 'synced' : 'watching'); return true;
  }
  async function releaseWriter() {
    role = 'viewer'; wantsWriter = false; persist(); emit(pending() ? 'pending' : 'watching');
    if (sending) await sending;
  }
  async function logout() {
    const token = session?.access_token;
    await releaseWriter(); session = null; persist();
    emit(pending() ? 'pending' : 'watching');
    if (token) {
      const controller = new AbortController(), timeout = globalThis.setTimeout(() => controller.abort(), requestTimeoutMs);
      try { await fetcher(baseUrl + '/auth/v1/logout?scope=local', { method: 'POST', headers: { apikey: publishableKey, Authorization: `Bearer ${token}` }, signal: controller.signal }); } catch { /* Local login still clears while offline. */ }
      finally { globalThis.clearTimeout(timeout); }
    }
    emit(pending() ? 'pending' : 'watching');
  }
  async function start() {
    if (running) return;
    running = true; emit();
    if (subscribe) unsubscribe = subscribe(() => { void refresh().catch(() => {}); }, online => { if (online) void refresh().then(() => { if (role === 'writer') void flush(); }).catch(() => {}); });
    interval = scheduler.setInterval(() => { void refresh().then(() => { if (role === 'writer' && outbox.length) void flush(); }).catch(() => {}); }, pollMs);
    try { await refresh(); if (session && wantsWriter) await claimWriter({ flushPending: true }); }
    catch (cause) { failure(cause); }
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
    get pending() { return pending(); }, get remote() { return remote; }, get offsetMs() { return offsetMs; } };
}
