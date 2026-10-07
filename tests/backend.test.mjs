import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultState } from '../model.js';
import { publicSnapshot, mergePublicState } from '../sync.js';

// Schema contract checks, not a substitute for running against PostgreSQL.
// They protect the default data and the public/private access boundary while
// the production SQL is reviewed and installed in Supabase.
const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const stripComments = source => source.replace(/--[^\n]*/g, '');
const source = stripComments(sql);
const functionBody = name => {
  const match = source.match(new RegExp(`create or replace function ${name.replaceAll('.', '\\.')}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`, 'i'));
  assert.ok(match, `Missing SQL function ${name}`);
  return match[1];
};
const initial = JSON.parse(source.match(/initial := '([\s\S]*?)'::jsonb;/)[1]);
let passed = 0;
function test(name, run) { run(); passed++; console.log(`✓ ${name}`); }

test('SQL initial state matches the application public snapshot and validates', () => {
  assert.deepEqual(initial, publicSnapshot(defaultState()));
  assert.deepEqual(mergePublicState(initial), defaultState());
});

test('JSON containment operands are grouped before PostgreSQL generic operators', () => {
  assert.match(functionBody('sports_day_private.valid_snapshot'), /not \(\(d->'eliminated'\) <@ \(d->'active'\)\)/);
  // PostgreSQL gives -> and <@ the same precedence. An ungrouped right operand
  // parses as (left <@ object)->key and tries to extract JSON from a boolean.
  assert.doesNotMatch(source, /(?:<@|@>)\s+[a-z_][a-z_0-9]*\s*->/i);
});

test('Public state has no private leaves or embedded editor credentials', () => {
  const forbidden = new Set(['leader','participants','counts','rule','notes','committeeNotes','editor_uid','email','password']);
  function inspect(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) { assert.equal(forbidden.has(key), false, key); inspect(nested); }
  }
  inspect(initial);
  const eventColumns = source.match(/create table if not exists public\.sports_day_events \(([\s\S]*?)\n\);/)[1];
  assert.doesNotMatch(eventColumns, /editor_uid|email|password/);
  assert.match(source, /create table if not exists sports_day_private\.editors/);
  assert.doesNotMatch(source, /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
  assert.match(source, /SCOREKEEPER_EMAIL_HERE/);
});

test('Schema exposes read access and revokes direct public and authenticated writes', () => {
  assert.match(source, /alter table public\.sports_day_events enable row level security;/i);
  assert.match(source, /revoke all on public\.sports_day_events from public, anon, authenticated;/i);
  assert.match(source, /grant select on public\.sports_day_events to anon, authenticated;/i);
  assert.doesNotMatch(source, /grant\s+(?:all|insert|update|delete)\s+on/i);
  assert.match(source, /revoke all on schema sports_day_private from public, anon, authenticated;/i);
  assert.match(source, /revoke all on all tables in schema sports_day_private from public, anon, authenticated;/i);
  assert.match(source, /revoke all on all functions in schema sports_day_private from public, anon, authenticated;/i);
});

test('Only the signed-in editor can execute scorekeeper mutations', () => {
  for (const [name, signature] of [
    ['claim_sports_day_writer','text,uuid,boolean'],
    ['release_sports_day_writer','text,uuid'],
    ['apply_sports_day_update','text,uuid,bigint,uuid,jsonb'],
  ]) {
    const escaped = signature.replaceAll(',', ',');
    assert.ok(source.includes(`revoke all on function public.${name}(${escaped}) from public, anon, authenticated;`));
    assert.ok(source.includes(`grant execute on function public.${name}(${escaped}) to authenticated;`));
    assert.doesNotMatch(source, new RegExp(`grant execute on function public\\.${name}\\([^;]+to (?:[^;]*, ?)?(?:public|anon)(?:[,; ])`, 'i'));
    const body = functionBody(`public.${name}`);
    assert.match(body, /auth\.uid\(\) is null or not exists \(select 1 from sports_day_private\.editors/);
    assert.match(body, /errcode = '42501'/);
    assert.doesNotMatch(body, /\bexecute\s/i);
  }
  for (const definition of source.matchAll(/create or replace function public\.[\s\S]*?as \$\$/g)) {
    assert.match(definition[0], /security definer set search_path = pg_catalog/);
  }
});

test('Writes serialize, require the active lease and revision, and reject changed retries', () => {
  const body = functionBody('public.apply_sports_day_update');
  const lock = body.indexOf('for update');
  const auth = body.indexOf('auth.uid()');
  const lease = body.indexOf("reply(e,'lease_lost')");
  const revision = body.indexOf('e.revision <> p_expected_revision');
  const write = body.indexOf('update public.sports_day_events set public_state');
  assert.ok(lock >= 0 && auth > lock && lease > auth && revision > lease && write > revision);
  assert.match(body, /previous\.writer_id is distinct from p_writer_id or previous\.snapshot is distinct from p_snapshot/);
  assert.match(body, /if e\.revision <> previous\.revision then return sports_day_private\.reply\(e,'conflict'\)/);
  assert.match(body, /revision = revision\+1/);
  assert.match(body, /insert into sports_day_private\.operations/);
});

test('An expired phone remains the owner until an explicit transfer or release', () => {
  const body = functionBody('public.claim_sports_day_writer');
  const busyGuard = body.match(/if not p_transfer([\s\S]*?)then\s+return sports_day_private\.reply\(e,'busy'\)/)[1];
  assert.match(busyGuard, /e\.writer_id is not null/);
  assert.match(busyGuard, /e\.writer_id is distinct from p_writer_id/);
  assert.doesNotMatch(busyGuard, /lease_until|clock_timestamp/);
  assert.ok(body.indexOf("reply(e,'busy')") < body.indexOf('update public.sports_day_events'));
});

test('Ownership changes are ordered separately from scores and ordinary renewals', () => {
  const claim = functionBody('public.claim_sports_day_writer');
  const release = functionBody('public.release_sports_day_writer');
  const apply = functionBody('public.apply_sports_day_update');
  assert.match(claim, /lease_revision = lease_revision \+ case when writer_id is distinct from p_writer_id then 1 else 0 end/);
  assert.match(release, /lease_revision = lease_revision\+1/);
  assert.doesNotMatch(apply, /lease_revision\s*=/);
  assert.match(functionBody('sports_day_private.reply'), /'lease_revision',e\.lease_revision/);
  assert.match(source, /add column if not exists lease_revision bigint/);
});

test('Setup reruns preserve scores and publish only the public event table', () => {
  assert.match(source, /insert into public\.sports_day_events\(id,public_state\)[\s\S]*?on conflict\(id\) do nothing;/);
  assert.match(source, /insert into sports_day_private\.editors[\s\S]*?on conflict\(event_id\) do update set editor_uid = excluded\.editor_uid;/);
  assert.match(source, /alter publication supabase_realtime add table public\.sports_day_events;/);
  assert.doesNotMatch(source, /alter publication[^;]*sports_day_private/i);
  const reply = functionBody('sports_day_private.reply');
  assert.doesNotMatch(reply, /editor_uid|email|password/);
  assert.match(reply, /'server_ms'/);
});

console.log(`${passed} backend schema contracts passed (database execution still required).`);
