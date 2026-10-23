import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultState, defaultCommitteeMembers, DEPARTMENT_IDS, COMMITTEE_SLOTS } from '../model.js';
import { publicSnapshot, mergePublicState } from '../sync.js';

// Historical base-schema contract checks. The multi-device migration tests cover
// the final active protocol. These checks are not a substitute for running against PostgreSQL.
// They protect the default data and the public/private access boundary while
// the production SQL is reviewed and installed in Supabase.
const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const stripComments = source => source.replace(/--[^\n]*/g, '');
const source = stripComments(sql);
const rosterMigration = stripComments(readFileSync(new URL('../supabase/committee-roster.sql', import.meta.url), 'utf8'));
const migration = stripComments(readFileSync(new URL('../supabase/equipment-checklist.sql', import.meta.url), 'utf8'));
const coldPacksMigration = stripComments(readFileSync(new URL('../supabase/equipment-cold-packs.sql', import.meta.url), 'utf8'));
const rotationMigration = stripComments(readFileSync(new URL('../supabase/committee-rotation.sql', import.meta.url), 'utf8'));
const functionBody = (name,input=source) => {
  const match = input.match(new RegExp(`create or replace function ${name.replaceAll('.', '\\.')}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`, 'i'));
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

test('SQL roster defaults, department slots and string limits agree with the application',()=>{
  const defaults=JSON.parse(functionBody('sports_day_private.default_committee_members').match(/select '([^']+)'::jsonb/)[1]);
  assert.deepEqual(defaults,defaultCommitteeMembers());
  const body=functionBody('sports_day_private.valid_committee_members');
  const ids=JSON.parse('['+body.match(/departments text\[\] := array\[([^\]]+)\]/)[1].replaceAll("'",'"')+']');
  const slots=JSON.parse('['+body.match(/slots integer\[\] := array\[([^\]]+)\]/)[1]+']');
  assert.deepEqual(ids,DEPARTMENT_IDS);assert.deepEqual(Object.fromEntries(ids.map((id,index)=>[id,slots[index]])),COMMITTEE_SLOTS);
  assert.match(body,/exact_keys\(m,departments\)/);assert.match(body,/jsonb_array_length\(names\) <> slots\[i\]/);
  assert.match(body,/jsonb_typeof\(name\) <> 'string' or length\(name #>> '\{\}'\) > 60/);
  const validator=functionBody('sports_day_private.valid_snapshot');
  assert.match(validator,/exact_keys\(s - 'committeeMembers' - 'equipmentReady'/);
  assert.match(validator,/s \? 'committeeMembers' and not sports_day_private\.valid_committee_members/);
});

test('SQL equipment defaults and strict boolean IDs agree with the application',()=>{
  const defaults=JSON.parse(functionBody('sports_day_private.default_equipment_ready').match(/select '([^']+)'::jsonb/)[1]);
  assert.deepEqual(defaults,defaultState().equipmentReady);
  assert.equal(Object.keys(defaults).length,22);assert.ok(Object.values(defaults).every(value=>value===false));
  const body=functionBody('sports_day_private.valid_equipment_ready');
  const ids=JSON.parse('['+body.match(/exact_keys\(m - 'cold-packs',array\[([^\]]+)\]/)[1].replaceAll("'",'"')+']');
  assert.deepEqual(ids,Object.keys(defaults).filter(id=>id!=='cold-packs'));
  assert.match(body,/jsonb_each\(m\) item where jsonb_typeof\(item.value\) <> 'boolean'/);
  const validator=functionBody('sports_day_private.valid_snapshot');
  assert.match(validator,/s \? 'equipmentReady' and not sports_day_private\.valid_equipment_ready/);
  assert.match(validator,/s \? 'equipmentColdPacksReady' and jsonb_typeof\(s->'equipmentColdPacksReady'\) <> 'boolean'/);
});

test('Legacy writes preserve each shared field independently and retry records retain the original payload',()=>{
  const body=functionBody('public.apply_sports_day_update');
  assert.match(body,/next_snapshot := p_snapshot \|\| jsonb_build_object/);
  assert.ok(body.includes("'committeeMembers',coalesce(p_snapshot->'committeeMembers',e.public_state->'committeeMembers',sports_day_private.default_committee_members())"));
  assert.match(body,/'equipmentReady',\(sports_day_private\.default_equipment_ready\(\) \|\|\s*coalesce\(e\.public_state->'equipmentReady','\{\}'::jsonb\) \|\|\s*coalesce\(p_snapshot->'equipmentReady','\{\}'::jsonb\)\) - 'cold-packs'/);
  assert.match(body,/'equipmentColdPacksReady',coalesce\(p_snapshot->'equipmentColdPacksReady',\s*p_snapshot->'equipmentReady'->'cold-packs',e\.public_state->'equipmentColdPacksReady',\s*e\.public_state->'equipmentReady'->'cold-packs','false'::jsonb\)/);
  assert.match(body,/public_state = next_snapshot/);
  assert.match(body,/values\(p_event_id,p_operation_id,p_writer_id,p_snapshot,e\.revision\)/);
  assert.match(body,/previous\.snapshot is distinct from p_snapshot/);
  const reply=functionBody('sports_day_private.reply');
  assert.match(reply,/'committeeMembers',sports_day_private\.default_committee_members\(\)/);
  assert.match(reply,/'equipmentReady',\(sports_day_private\.default_equipment_ready\(\) \|\|\s*coalesce\(e\.public_state->'equipmentReady','\{\}'::jsonb\)\) - 'cold-packs'/);
});

test('Historical roster migration retains its original contract and helper definitions',()=>{
  for(const name of ['sports_day_private.default_committee_members','sports_day_private.valid_committee_members']){
    assert.equal(functionBody(name,rosterMigration).trim(),functionBody(name).trim(),name);
  }
  assert.match(functionBody('sports_day_private.valid_snapshot',rosterMigration),/exact_keys\(s - 'committeeMembers',/);
  assert.doesNotMatch(rosterMigration,/equipmentReady/);
  assert.match(functionBody('public.apply_sports_day_update',rosterMigration),/public_state = case when p_snapshot \? 'committeeMembers'/);
});

test('Historical equipment migration keeps its original 21-item contract',()=>{
  const defaults=JSON.parse(functionBody('sports_day_private.default_equipment_ready',migration).match(/select '([^']+)'::jsonb/)[1]);
  const current=publicSnapshot(defaultState()).equipmentReady;delete current['cold-packs'];
  assert.deepEqual(defaults,current);
  const validator=functionBody('sports_day_private.valid_equipment_ready',migration);
  const ids=JSON.parse('['+validator.match(/exact_keys\(m,array\[([^\]]+)\]/)[1].replaceAll("'",'"')+']');
  assert.deepEqual(ids,Object.keys(defaults));
  const priorValidator=functionBody('sports_day_private.valid_snapshot',migration);
  assert.match(priorValidator,/exact_keys\(s - 'committeeMembers' - 'equipmentReady',/);
  assert.doesNotMatch(priorValidator,/equipmentColdPacksReady/);
  assert.match(functionBody('sports_day_private.reply',migration),/default_equipment_ready\(\)\) \|\| e\.public_state/);
  assert.match(functionBody('public.apply_sports_day_update',migration),/'equipmentReady',coalesce\(p_snapshot->'equipmentReady',e\.public_state->'equipmentReady',sports_day_private\.default_equipment_ready\(\)\)/);
});

test('Historical cold-pack migration remains rerunnable without changing rows or access grants',()=>{
  const names=['sports_day_private.default_equipment_ready','sports_day_private.valid_equipment_ready','sports_day_private.valid_snapshot','sports_day_private.reply','public.apply_sports_day_update'];
  assert.equal([...coldPacksMigration.matchAll(/create or replace function /g)].length,names.length);
  for(const name of names.slice(0,2)) assert.equal(functionBody(name,coldPacksMigration).trim(),functionBody(name).trim(),name);
  assert.doesNotMatch(coldPacksMigration,/committeeRotation/);
  for(const input of [migration,coldPacksMigration]){
    const outsideFunctions=input.replace(/create or replace function [\s\S]*?\$\$[\s\S]*?\$\$;/gi,'');
    assert.match(outsideFunctions,/begin;/i);assert.match(outsideFunctions,/commit;/i);
    assert.doesNotMatch(outsideFunctions,/\b(?:insert|update|delete|grant|create table|alter table)\b/i);
    assert.match(outsideFunctions,/revoke all on function sports_day_private\.default_equipment_ready\(\) from public, anon, authenticated;/);
    assert.match(outsideFunctions,/revoke all on function sports_day_private\.valid_equipment_ready\(jsonb\) from public, anon, authenticated;/);
  }
});

test('Committee rota uses only known round and roster slots with strict status and cover entries',()=>{
  assert.equal(functionBody('sports_day_private.default_committee_rotation').trim(),"select '{}'::jsonb;");
  const body=functionBody('sports_day_private.valid_committee_rotation');
  const ids=JSON.parse('['+body.match(/people text\[\] := array\[([^\]]+)\]/)[1].replaceAll("'",'"')+']');
  assert.deepEqual(ids,DEPARTMENT_IDS.flatMap(id=>Array.from({length:COMMITTEE_SLOTS[id]},(_,i)=>`${id}:${i}`)));
  assert.equal(ids.length,18);
  const pattern=new RegExp(body.match(/round_pattern text := '([^']+)'/)[1]);
  const rounds=[...Array.from({length:7},(_,i)=>`borrow:${i}`),...['red','blue','yellow','green','white'].flatMap(team=>[0,1].map(attempt=>`basket:${team}:${attempt}`)),'cavalry:women','cavalry:men','tug:prelim','tug:semi1','tug:semi2','tug:final','relay:0','relay:1','relay:2'];
  assert.equal(rounds.length,26);for(const key of rounds)assert.ok(pattern.test(key),key);
  for(const key of ['borrow:7','basket:0','basket:1','basket:purple:0','basket:red:2','tug:0','event:0','relay:3','cavalry:open'])assert.equal(pattern.test(key),false,key);
  assert.match(body,/exact_keys\(entry,array\['status','coverFor'\]\)/);
  assert.match(body,/entry->>'status' not in \('playing','duty','cover'\)/);
  assert.match(body,/entry->>'status' <> 'cover'/);assert.match(body,/cover_for = person/);
  assert.match(functionBody('sports_day_private.valid_snapshot'),/s \? 'committeeRotation' and not sports_day_private\.valid_committee_rotation/);
  assert.ok(functionBody('public.apply_sports_day_update').includes("'committeeRotation',coalesce(p_snapshot->'committeeRotation',e.public_state->'committeeRotation',sports_day_private.default_committee_rotation())"));
  assert.match(functionBody('sports_day_private.reply'),/'committeeRotation',sports_day_private\.default_committee_rotation\(\)/);
});

test('Committee rota migration matches fresh setup and changes no rows or access grants',()=>{
  const names=['sports_day_private.default_committee_rotation','sports_day_private.valid_committee_rotation','sports_day_private.valid_snapshot','sports_day_private.reply','public.apply_sports_day_update'];
  assert.equal([...rotationMigration.matchAll(/create or replace function /g)].length,names.length);
  for(const name of names)assert.equal(functionBody(name,rotationMigration).trim(),functionBody(name).trim(),name);
  const outsideFunctions=rotationMigration.replace(/create or replace function [\s\S]*?\$\$[\s\S]*?\$\$;/gi,'');
  assert.match(outsideFunctions,/begin;/i);assert.match(outsideFunctions,/commit;/i);
  assert.doesNotMatch(outsideFunctions,/\b(?:insert|update|delete|grant|create table|alter table)\b/i);
  for(const signature of ['default_committee_rotation()','valid_committee_rotation(jsonb)'])assert.ok(outsideFunctions.includes(`revoke all on function sports_day_private.${signature} from public, anon, authenticated;`));
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
  for (const table of ['public.sports_day_events', 'sports_day_private.operations', 'sports_day_private.editors']) {
    assert.ok(source.includes(`alter table ${table} enable row level security;`));
  }
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

test('Historical base schema: writes serialize, require the active lease and revision, and reject changed retries', () => {
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

test('Historical base schema: an expired phone remains the owner until an explicit transfer or release', () => {
  const body = functionBody('public.claim_sports_day_writer');
  const busyGuard = body.match(/if not p_transfer([\s\S]*?)then\s+return sports_day_private\.reply\(e,'busy'\)/)[1];
  assert.match(busyGuard, /e\.writer_id is not null/);
  assert.match(busyGuard, /e\.writer_id is distinct from p_writer_id/);
  assert.doesNotMatch(busyGuard, /lease_until|clock_timestamp/);
  assert.ok(body.indexOf("reply(e,'busy')") < body.indexOf('update public.sports_day_events'));
});

test('Historical base schema: ownership changes are ordered separately from scores and ordinary renewals', () => {
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
