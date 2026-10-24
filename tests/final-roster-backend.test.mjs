import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { scoreUnits } from '../sync-merge.js';

// This suite checks the release-58 migration independently of newer browser slots.
const historicalSlots={director:1,judges:1,'first-aid':2,equipment:4,'food-water':3,comms:3,'team-leaders':5,warmup:1};
const historicalPeople=Object.entries(historicalSlots).flatMap(([department,count])=>Array.from({length:count},(_,slot)=>`${department}:${slot}`));

const migration = readFileSync(new URL('../supabase/final-roster.sql', import.meta.url), 'utf8');
const verification = readFileSync(new URL('../supabase/final-roster-verify.sql', import.meta.url), 'utf8');
const source = migration.replace(/--[^\n]*/g, '');
const body = name => {
  const found = source.match(new RegExp(`create or replace function ${name.replaceAll('.', '\\.')}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`, 'i'));
  assert.ok(found, `Missing ${name}`);
  return found[1];
};
let passed = 0;
const test = async (name, run) => { await run(); passed++; console.log('PASS ' + name); };

await test('Release-58 SQL defaults and stable rota IDs retain their historical shape', () => {
  const defaults = JSON.parse(body('sports_day_private.default_committee_members').match(/select '([^']+)'::jsonb/)[1]);
  assert.deepEqual(Object.fromEntries(Object.entries(defaults).map(([id,names])=>[id,names.length])),historicalSlots);
  assert.deepEqual(defaults.comms,['Cindy','Mario','']);
  const people = body('sports_day_private.valid_committee_rotation').match(/people text\[\] := array\[([^\]]+)\]/)[1];
  assert.deepEqual(JSON.parse('[' + people.replaceAll("'", '"') + ']'), historicalPeople);
  assert.equal(historicalPeople.length, 20);
  assert.equal(defaults['first-aid'].length, 2);
  assert.equal(defaults.warmup.length, 1);
  assert.match(body('sports_day_private.valid_committee_rotation'), /jsonb_object_keys\(assignments\)\) > 20/);
});
await test('Cached authorization is capability fenced and immutable retry acknowledgement precedes roster and CAS gates', () => {
  assert.match(source, /drop function if exists public\.authorize_sports_day_editor\(text,uuid\)/);
  assert.match(source, /p_roster_version integer default 1/);
  assert.match(body('public.authorize_sports_day_editor'), /p_roster_version is distinct from 2/);
  const apply = body('public.apply_sports_day_patch');
  assert.ok(apply.indexOf("reply(e,'duplicate')") < apply.indexOf("reply(e,'upgrade_required')"));
  assert.ok(apply.indexOf("reply(e,'upgrade_required')") < apply.indexOf('e.revision<>p_expected_revision'));
  for (const field of ['device_id', 'expected_revision', 'snapshot', 'barrier']) assert.match(apply, new RegExp(`previous\\.${field} is distinct from p_`));
  assert.match(source, /lock table public\.sports_day_events in exclusive mode/);
  assert.doesNotMatch(apply, /lease_until\s*=|writer_id\s*=|lease_revision\s*=/);
});
await test('The migration changes metadata only and preserves version tombstones and API boundaries', () => {
  const installation = source.replace(/create or replace function [\s\S]*?\$\$[\s\S]*?\$\$;/gi, '');
  assert.doesNotMatch(installation, /\b(?:update|delete|insert into)\s+public\.sports_day_events/i);
  assert.doesNotMatch(installation, /\b(?:update|delete|insert into)\s+sports_day_private\.(?:editors|operations_v2)/i);
  assert.match(installation, /where not \(m\.unit_versions \? unit\.key\)/);
  assert.match(installation, /\|\| m\.unit_versions/);
  assert.match(source, /revoke all on function sports_day_private\.canonical_committee_members\(jsonb,jsonb\) from public, anon, authenticated/);
  assert.match(source, /grant execute on function public\.authorize_sports_day_editor\(text,uuid,integer\) to authenticated/);
  assert.match(verification, /test_event text := 'cgs-final-roster-verify-'\|\|gen_random_uuid\(\)/);
  assert.match(verification.trim(), /rollback;$/i);
});

if (!process.env.CGS_PGLITE_MODULE) {
  console.log('SKIP PostgreSQL execution: set CGS_PGLITE_MODULE to the installed @electric-sql/pglite/dist/index.js.');
} else {
  const { PGlite } = await import(pathToFileURL(process.env.CGS_PGLITE_MODULE).href);
  const db = new PGlite();
  const editor = '00000000-0000-4000-8000-000000000001';
  const device = '51000000-0000-4000-8000-000000000001';
  const oldOperation = '52000000-0000-4000-8000-000000000001';
  const nextOperation = '52000000-0000-4000-8000-000000000002';
  const removedOperation = '52000000-0000-4000-8000-000000000003';
  const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  const previous = readFileSync(new URL('../supabase/multi-device.sql', import.meta.url), 'utf8');
  const rows = async table => (await db.query(`select * from ${table} order by 1,2`)).rows;
  const value = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const apply = async (revision, operation, snapshot, barrier = false) => value('select public.apply_sports_day_patch($1,$2,$3,$4,$5::jsonb,$6)', ['cgs-oct25', device, revision, operation, JSON.stringify(snapshot), barrier]);
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create publication supabase_realtime;
      insert into auth.users values('${editor}','SCOREKEEPER_EMAIL_HERE');`);
    await db.exec(schema);
    await db.exec(previous);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [editor]);
    const old = structuredClone(await value("select public_state from public.sports_day_events where id='cgs-oct25'"));
    old.committeeMembers.director[0] = 'Existing main judge';
    old.committeeMembers.judges[0] = 'Existing assistant';
    old.committeeMembers['first-aid'][1] = 'Existing medical volunteer';
    old.committeeMembers['team-leaders'][3] = 'Existing team leader';
    old.teams[0].name = 'Existing red';
    old.borrow.scores[0][0] = 5;
    old.equipmentReady.cones = true;
    assert.equal((await apply(0, oldOperation, old)).status, 'applied');
    const assigned = structuredClone(old);
    assigned.committeeRotation = { 'borrow:0': { 'equipment:0': { status: 'duty', coverFor: null } } };
    assert.equal((await apply(1, nextOperation, assigned)).status, 'applied');
    assert.equal((await apply(2, removedOperation, old)).status, 'applied');
    const baselineEvents = await rows('public.sports_day_events');
    const baselineEditors = await rows('sports_day_private.editors');
    const baselineOperations = await rows('sports_day_private.operations_v2');
    const baselineMetadata = await rows('sports_day_private.event_sync_metadata');
    await test('Actual PostgreSQL installation is rerunnable and preserves all event rows, private grants and immutable retry payloads', async () => {
      await db.exec(migration);
      await db.exec(migration);
      assert.deepEqual(await rows('public.sports_day_events'), baselineEvents);
      assert.deepEqual(await rows('sports_day_private.editors'), baselineEditors);
      assert.deepEqual(await rows('sports_day_private.operations_v2'), baselineOperations);
      const after = await rows('sports_day_private.event_sync_metadata');
      assert.equal(after.length, baselineMetadata.length);
      for (let i = 0; i < after.length; i++) {
        assert.equal(after[i].event_id, baselineMetadata[i].event_id);
        assert.equal(after[i].reset_revision, baselineMetadata[i].reset_revision);
        const { ['roster:equipment:3']: equipment, ['roster:comms:2']: comm, ...kept } = after[i].unit_versions;
        assert.equal(equipment, 3); assert.equal(comm, 3);
        assert.deepEqual(kept, baselineMetadata[i].unit_versions);
        assert.equal(kept['rota:borrow:0:equipment:0'], 3);
      }
    });
    await test('Old clients cannot claim editing authority or replace the final roster, but exact pre-upgrade retry is acknowledged', async () => {
      const legacyAuthorization = await value('select public.authorize_sports_day_editor($1,$2)', ['cgs-oct25', device]);
      assert.equal(legacyAuthorization.status, 'upgrade_required');
      const currentAuthorization = await value('select public.authorize_sports_day_editor($1,$2,2)', ['cgs-oct25', device]);
      assert.equal(currentAuthorization.status, 'authorized');
      assert.equal(currentAuthorization.revision, 3);
      assert.equal(currentAuthorization.public_state.committeeMembers.equipment.length, 4);
      assert.equal(currentAuthorization.public_state.committeeMembers.comms.length, 3);
      const duplicate = await apply(0, oldOperation, old);
      assert.equal(duplicate.status, 'duplicate'); assert.equal(duplicate.applied_revision, 1); assert.equal(duplicate.revision, 3);
      const rejected = await apply(3, '52000000-0000-4000-8000-000000000004', old);
      assert.equal(rejected.status, 'upgrade_required'); assert.equal(rejected.revision, 3);
      await assert.rejects(apply(1, oldOperation, old), error => error.code === '22023');
      assert.deepEqual(await rows('public.sports_day_events'), baselineEvents);
      assert.deepEqual(await rows('sports_day_private.operations_v2'), baselineOperations);
    });
    await test('Fallback padding preserves appended shared names and SQL/browser conflict units agree exactly', async () => {
      const expanded = await value('select sports_day_private.canonical_public_snapshot($1::jsonb)', [JSON.stringify(old)]);
      expanded.committeeMembers.equipment[3] = 'Darren';
      expanded.committeeMembers.comms[2] = 'Grace';
      expanded.committeeRotation = { 'borrow:0': { 'comms:2': { status: 'cover', coverFor: 'equipment:3' } } };
      const padded = await value('select sports_day_private.canonical_public_snapshot($1::jsonb,$2::jsonb)', [JSON.stringify(old), JSON.stringify(expanded)]);
      assert.equal(padded.committeeMembers.equipment[3], 'Darren');
      assert.equal(padded.committeeMembers.comms[2], 'Grace');
      assert.deepEqual(padded.committeeMembers.equipment.slice(0, 3), old.committeeMembers.equipment);
      assert.deepEqual(padded.committeeMembers.comms.slice(0, 2), old.committeeMembers.comms);
      const expected = Object.fromEntries(Object.entries(scoreUnits(expanded)).filter(([key, item]) =>
        !['roster:food-water:3','roster:comms:3'].includes(key) && (!key.startsWith('rota:') || item !== null)));
      assert.deepEqual(await value('select sports_day_private.shared_units($1::jsonb)', [JSON.stringify(expanded)]), expected);
      assert.equal(await value('select sports_day_private.valid_snapshot($1::jsonb)', [JSON.stringify(expanded)]), true);
      const half = structuredClone(expanded); half.committeeMembers.comms.pop();
      assert.equal(await value('select sports_day_private.valid_snapshot($1::jsonb)', [JSON.stringify(half)]), false);
    });
    await test('Actual rollback-only verification covers both new positions, two-device CAS, private access and saved judge/team-leader preservation', async () => {
      const beforeEvents = await rows('public.sports_day_events');
      const beforeEditors = await rows('sports_day_private.editors');
      const beforeOperations = await rows('sports_day_private.operations_v2');
      const beforeMetadata = await rows('sports_day_private.event_sync_metadata');
      await db.exec(verification);
      assert.deepEqual(await rows('public.sports_day_events'), beforeEvents);
      assert.deepEqual(await rows('sports_day_private.editors'), beforeEditors);
      assert.deepEqual(await rows('sports_day_private.operations_v2'), beforeOperations);
      assert.deepEqual(await rows('sports_day_private.event_sync_metadata'), beforeMetadata);
    });
  } finally { await db.close(); }
}
console.log(`${passed} final-roster backend checks passed.`);
