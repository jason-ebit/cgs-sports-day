import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { defaultState } from '../model.js';
import { publicSnapshot } from '../sync.js';
import { scoreUnits } from '../sync-merge.js';

const migration = readFileSync(new URL('../supabase/multi-device.sql', import.meta.url), 'utf8');
const verification = readFileSync(new URL('../supabase/multi-device-verify.sql', import.meta.url), 'utf8');
const source = migration.replace(/--[^\n]*/g, '');
const body = name => {
  const match = source.match(new RegExp(`create or replace function ${name.replaceAll('.', '\\.')}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`, 'i'));
  assert.ok(match, `Missing function ${name}`);
  return match[1];
};
let passed = 0;
const test = async (name, run) => { await run(); passed++; console.log('PASS ' + name); };

await test('Every write RPC authorizes the approved login and uses a fixed safe search path', () => {
  for (const name of ['authorize_sports_day_editor', 'apply_sports_day_patch', 'claim_sports_day_writer', 'release_sports_day_writer', 'apply_sports_day_update']) {
    const definition = source.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?as \\$\\$`, 'i'))[0];
    assert.match(definition, /security definer set search_path = pg_catalog/);
    assert.match(body('public.' + name), /auth\.uid\(\) is null or not exists \(select 1 from sports_day_private\.editors/);
    assert.doesNotMatch(body('public.' + name), /\bexecute\s/i);
  }
});
await test('CAS serializes writes and retries acknowledge original application before checking current revision', () => {
  const apply = body('public.apply_sports_day_patch');
  assert.ok(apply.indexOf('for update') < apply.indexOf('auth.uid()'));
  assert.ok(apply.indexOf("reply(e,'duplicate')") < apply.indexOf('e.revision<>p_expected_revision'));
  assert.ok(apply.indexOf('e.revision<>p_expected_revision') < apply.indexOf('update public.sports_day_events'));
  for (const field of ['device_id', 'expected_revision', 'snapshot', 'barrier']) assert.match(apply, new RegExp(`previous\\.${field} is distinct from p_`));
  assert.match(apply, /'applied_revision',previous\.applied_revision/);
  assert.doesNotMatch(apply, /lease_until\s*=|lease_revision\s*=|writer_id\s*=/);
});
await test('Cached clients cannot transfer, release or replace shared scores', () => {
  for (const name of ['claim_sports_day_writer', 'release_sports_day_writer', 'apply_sports_day_update']) {
    const fn = body('public.' + name);
    assert.match(fn, /reply\(e,'upgrade_required'\)/);
    assert.doesNotMatch(fn, /\b(?:update|insert|delete)\b/i);
  }
});
await test('Private metadata and retry records retain RLS and authenticated-only RPC access', () => {
  for (const table of ['event_sync_metadata', 'operations_v2']) assert.ok(source.includes(`alter table sports_day_private.${table} enable row level security;`));
  assert.match(source, /revoke all on sports_day_private\.event_sync_metadata, sports_day_private\.operations_v2 from public, anon, authenticated/);
  for (const signature of ['authorize_sports_day_editor(text,uuid)', 'apply_sports_day_patch(text,uuid,bigint,uuid,jsonb,boolean)']) {
    assert.ok(source.includes(`revoke all on function public.${signature} from public, anon, authenticated;`));
    assert.ok(source.includes(`grant execute on function public.${signature} to authenticated;`));
  }
  assert.doesNotMatch(source, /grant\s+(?:all|insert|update|delete)\s+on/i);
  assert.doesNotMatch(source, /alter publication|editor_uid.*jsonb_build_object/i);
});
await test('Metadata initialization is idempotent and verification always rolls back isolated events', () => {
  const install = source.replace(/create or replace function [\s\S]*?\$\$[\s\S]*?\$\$;/gi, '');
  assert.doesNotMatch(install, /\b(?:update|delete)\s+public\.sports_day_events/i);
  assert.match(install, /insert into sports_day_private\.event_sync_metadata[\s\S]*on conflict\(event_id\) do nothing/);
  assert.match(verification, /test_event text := 'cgs-multi-verify-'\|\|gen_random_uuid\(\)/);
  assert.match(verification.trim(), /rollback;$/i);
});

if (!process.env.CGS_PGLITE_MODULE) {
  console.log('SKIP database execution: set CGS_PGLITE_MODULE to an installed @electric-sql/pglite/dist/index.js.');
} else {
  const { PGlite } = await import(pathToFileURL(process.env.CGS_PGLITE_MODULE).href);
  const db = new PGlite();
  const editor = '00000000-0000-4000-8000-000000000001';
  const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  const queryValue = async (sql, parameters = []) => Object.values((await db.query(sql, parameters)).rows[0])[0];
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create publication supabase_realtime;
      insert into auth.users values('${editor}','SCOREKEEPER_EMAIL_HERE');`);
    await db.exec(schema);
    const baseline = (await db.query('select * from public.sports_day_events order by id')).rows;
    const editors = (await db.query('select * from sports_day_private.editors order by event_id')).rows;
    await test('Actual PostgreSQL migration executes twice without changing existing events or editor permissions', async () => {
      await db.exec(migration);
      await db.exec(migration);
      assert.deepEqual((await db.query('select * from public.sports_day_events order by id')).rows, baseline);
      assert.deepEqual((await db.query('select * from sports_day_private.editors order by event_id')).rows, editors);
    });
    await test('SQL consistency units match browser units including exact ordered arrays and locked-attempt flags', async () => {
      const snapshot = publicSnapshot(defaultState());
      // Exercise the historical migration with its original roster contract.
      // The expanded-volunteers suite separately checks the current client/SQL shape.
      snapshot.committeeMembers.equipment = snapshot.committeeMembers.equipment.slice(0, 3);
      snapshot.committeeMembers['food-water'] = snapshot.committeeMembers['food-water'].slice(0, 3);
      snapshot.committeeMembers.comms = snapshot.committeeMembers.comms.slice(0, 2);
      snapshot.committeeRotation = { 'borrow:0': { 'equipment:0': { status: 'cover', coverFor: 'equipment:1' } } };
      snapshot.basket.scores[0][0] = 0;
      snapshot.finished = ['basket:red:0'];
      snapshot.equipmentColdPacksReady = true;
      assert.equal(await queryValue('select sports_day_private.valid_snapshot($1::jsonb)', [JSON.stringify(snapshot)]), true);
      const actual = await queryValue('select sports_day_private.shared_units($1::jsonb)', [JSON.stringify(snapshot)]);
      const appended = new Set(['roster:equipment:3', 'roster:food-water:3', 'roster:comms:2', 'roster:comms:3']);
      const expected = Object.fromEntries(Object.entries(scoreUnits(snapshot)).filter(([key, value]) => !appended.has(key) && (!key.startsWith('rota:') || value !== null)));
      assert.deepEqual(actual, expected);
      assert.equal(actual['basket:red:0'].score, 0);
      assert.equal(actual['basket:red:0'].finished, true);
      const legacy = structuredClone(snapshot);
      delete legacy.committeeMembers; delete legacy.committeeRotation; delete legacy.equipmentReady; delete legacy.equipmentColdPacksReady;
      const canonical = await queryValue('select sports_day_private.canonical_public_snapshot($1::jsonb,$2::jsonb)', [JSON.stringify(legacy), JSON.stringify(snapshot)]);
      assert.deepEqual(canonical, snapshot);
    });
    await test('Rollback-only real database verification passes CAS, multi-device writes, retries, resets and API role checks', async () => {
      await db.exec(verification);
      assert.deepEqual((await db.query('select * from public.sports_day_events order by id')).rows, baseline);
      assert.deepEqual((await db.query('select * from sports_day_private.editors order by event_id')).rows, editors);
      assert.equal(await queryValue('select count(*) from sports_day_private.operations_v2'), 0);
    });
  } finally { await db.close(); }
}
console.log(`${passed} multi-device backend checks passed.`);
