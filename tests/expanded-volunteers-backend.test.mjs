import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { COMMITTEE_PERSON_IDS } from '../rota-model.js';
import { defaultCommitteeMembers } from '../model.js';
import { scoreUnits } from '../sync-merge.js';

const migration = readFileSync(new URL('../supabase/expanded-volunteers.sql', import.meta.url), 'utf8');
const verification = readFileSync(new URL('../supabase/expanded-volunteers-verify.sql', import.meta.url), 'utf8');
const source = migration.replace(/--[^\n]*/g, '');
const body = name => {
  const found = source.match(new RegExp(`create or replace function ${name.replaceAll('.', '\\.')}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`, 'i'));
  assert.ok(found, `Missing ${name}`);
  return found[1];
};
let passed = 0;
const test = async (name, run) => { await run(); passed++; console.log('PASS ' + name); };

await test('The new SQL and browser agree on every stable slot, with no names populated by installation', () => {
  const defaults = JSON.parse(body('sports_day_private.default_committee_members').match(/select '([^']+)'::jsonb/)[1]);
  assert.deepEqual(defaults, defaultCommitteeMembers());
  const people = body('sports_day_private.valid_committee_rotation').match(/people text\[\] := array\[([^\]]+)\]/)[1];
  assert.deepEqual(JSON.parse('[' + people.replaceAll("'", '"') + ']'), COMMITTEE_PERSON_IDS);
  assert.equal(COMMITTEE_PERSON_IDS.length, 22);
  assert.equal(defaults.equipment.length, 4);
  assert.equal(defaults['food-water'].length, 4);
  assert.equal(defaults.comms.length, 4);
  assert.equal(defaults['first-aid'].length, 2);
  assert.equal(defaults.warmup.length, 1);
  assert.ok(!JSON.stringify(defaults).includes('Olin') && !JSON.stringify(defaults).includes('Jesslyn'));
  assert.match(body('sports_day_private.valid_committee_rotation'), /jsonb_object_keys\(assignments\)\) > 22/);
});
await test('Capability 3 gates fresh edits after immutable retry acknowledgement and before CAS', () => {
  assert.match(source, /p_roster_version integer default 1/);
  assert.match(body('public.authorize_sports_day_editor'), /p_roster_version is distinct from 3/);
  const apply = body('public.apply_sports_day_patch');
  assert.ok(apply.indexOf("reply(e,'duplicate')") < apply.indexOf("reply(e,'upgrade_required')"));
  assert.ok(apply.indexOf("reply(e,'upgrade_required')") < apply.indexOf('e.revision<>p_expected_revision'));
  for (const field of ['device_id', 'expected_revision', 'snapshot', 'barrier']) assert.match(apply, new RegExp(`previous\\.${field} is distinct from p_`));
  assert.doesNotMatch(apply, /lease_until\s*=|writer_id\s*=|lease_revision\s*=/);
});
await test('Installation preserves event data, editor allowlists, retry payloads and all existing unit versions', () => {
  const installation = source.replace(/create or replace function [\s\S]*?\$\$[\s\S]*?\$\$;/gi, '');
  assert.doesNotMatch(installation, /\b(?:update|delete|insert into)\s+public\.sports_day_events/i);
  assert.doesNotMatch(installation, /\b(?:update|delete|insert into)\s+sports_day_private\.(?:editors|operations_v2)/i);
  assert.match(installation, /where not \(m\.unit_versions \? unit\.key\)/);
  assert.match(installation, /\|\| m\.unit_versions/);
  assert.match(source, /grant execute on function public\.authorize_sports_day_editor\(text,uuid,integer\) to authenticated/);
  assert.match(verification, /test_event text := 'cgs-expanded-volunteers-verify-'\|\|gen_random_uuid\(\)/);
  assert.match(verification.trim(), /rollback;$/i);
});

if (!process.env.CGS_PGLITE_MODULE) {
  console.log('SKIP PostgreSQL execution: set CGS_PGLITE_MODULE to the installed @electric-sql/pglite/dist/index.js.');
} else {
  const { PGlite } = await import(pathToFileURL(process.env.CGS_PGLITE_MODULE).href);
  const db = new PGlite();
  const editor = '00000000-0000-4000-8000-000000000001';
  const device = '71000000-0000-4000-8000-000000000001';
  const legacyOperation = '72000000-0000-4000-8000-000000000001';
  const previousOperation = '72000000-0000-4000-8000-000000000002';
  const removedOperation = '72000000-0000-4000-8000-000000000003';
  const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  const sharedMigration = readFileSync(new URL('../supabase/multi-device.sql', import.meta.url), 'utf8');
  const previousMigration = readFileSync(new URL('../supabase/final-roster.sql', import.meta.url), 'utf8');
  const rows = async table => (await db.query(`select * from ${table} order by 1,2`)).rows;
  const value = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const apply = async (revision, operation, snapshot, barrier = false) => value('select public.apply_sports_day_patch($1,$2,$3,$4,$5::jsonb,$6)', ['cgs-oct25', device, revision, operation, JSON.stringify(snapshot), barrier]);
  const valid = snapshot => value('select sports_day_private.valid_snapshot($1::jsonb)', [JSON.stringify(snapshot)]);
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create publication supabase_realtime;
      insert into auth.users values('${editor}','SCOREKEEPER_EMAIL_HERE');`);
    await db.exec(schema);
    await db.exec(sharedMigration);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [editor]);
    const legacy = structuredClone(await value("select public_state from public.sports_day_events where id='cgs-oct25'"));
    legacy.committeeMembers.director[0] = 'Existing main judge';
    legacy.committeeMembers.judges[0] = 'Existing assistant';
    legacy.committeeMembers['first-aid'][1] = 'Existing medical volunteer';
    legacy.committeeMembers['team-leaders'][3] = 'Existing team leader';
    legacy.teams[0].name = 'Existing red';
    legacy.borrow.scores[0][0] = 5;
    legacy.equipmentReady.cones = true;
    assert.equal((await apply(0, legacyOperation, legacy)).status, 'applied');
    await db.exec(previousMigration);
    const previous = await value('select sports_day_private.canonical_public_snapshot($1::jsonb)', [JSON.stringify(legacy)]);
    previous.committeeMembers.equipment[3] = 'Darren';
    previous.committeeMembers.comms[2] = 'Grace';
    previous.committeeRotation = { 'borrow:0': { 'equipment:0': { status: 'duty', coverFor: null } } };
    assert.equal((await apply(1, previousOperation, previous)).status, 'applied');
    const currentBefore = structuredClone(previous); currentBefore.committeeRotation = {};
    assert.equal((await apply(2, removedOperation, currentBefore)).status, 'applied');
    const baselineEvents = await rows('public.sports_day_events');
    const baselineEditors = await rows('sports_day_private.editors');
    const baselineOperations = await rows('sports_day_private.operations_v2');
    const baselineMetadata = await rows('sports_day_private.event_sync_metadata');
    await test('Actual PostgreSQL installation is rerunnable and only adds missing metadata without changing existing records', async () => {
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
        const { ['roster:food-water:3']: food, ['roster:comms:3']: comm, ...kept } = after[i].unit_versions;
        assert.equal(food, 3); assert.equal(comm, 3);
        assert.deepEqual(kept, baselineMetadata[i].unit_versions);
        assert.equal(kept['rota:borrow:0:equipment:0'], 3);
      }
    });
    await test('Both cached roster protocols are fenced, while exact real pre-upgrade retries remain idempotent', async () => {
      for (const version of [1, 2, 4]) {
        const r = await value('select public.authorize_sports_day_editor($1,$2,$3)', ['cgs-oct25', device, version]);
        assert.equal(r.status, 'upgrade_required'); assert.equal(r.revision, 3);
      }
      assert.equal((await value('select public.authorize_sports_day_editor($1,$2)', ['cgs-oct25', device])).status, 'upgrade_required');
      const r = await value('select public.authorize_sports_day_editor($1,$2,3)', ['cgs-oct25', device]);
      assert.equal(r.status, 'authorized'); assert.equal(r.revision, 3);
      assert.equal(r.public_state.committeeMembers['food-water'].length, 4);
      assert.equal(r.public_state.committeeMembers.comms.length, 4);
      for (const [revision, operation, snapshot] of [[0, legacyOperation, legacy], [1, previousOperation, previous]]) {
        const duplicate = await apply(revision, operation, snapshot);
        assert.equal(duplicate.status, 'duplicate'); assert.equal(duplicate.applied_revision, revision + 1); assert.equal(duplicate.revision, 3);
        await assert.rejects(apply(revision + 1, operation, snapshot), error => error.code === '22023');
      }
      for (const snapshot of [legacy, previous, currentBefore]) {
        const rejected = await apply(2, '72000000-0000-4000-8000-000000000004', snapshot);
        assert.equal(rejected.status, 'upgrade_required'); assert.equal(rejected.revision, 3);
      }
      assert.deepEqual(await rows('public.sports_day_events'), baselineEvents);
      assert.deepEqual(await rows('sports_day_private.operations_v2'), baselineOperations);
    });
    await test('Only the three complete roster shapes validate and all 22 stable rotation IDs agree with browser conflict units', async () => {
      const expanded = await value('select sports_day_private.canonical_public_snapshot($1::jsonb)', [JSON.stringify(currentBefore)]);
      expanded.committeeMembers['food-water'][3] = 'Olin';
      expanded.committeeMembers.comms[3] = 'Jesslyn';
      expanded.committeeRotation = { 'borrow:0': Object.fromEntries(COMMITTEE_PERSON_IDS.map(id => [id, { status: 'duty', coverFor: null }])) };
      assert.equal(await valid(legacy), true); assert.equal(await valid(previous), true); assert.equal(await valid(expanded), true);
      for (const [eq, food, comm] of [[4, 3, 4], [4, 4, 3], [3, 3, 3], [3, 4, 2], [4, 5, 4]]) {
        const invalid = structuredClone(expanded);
        invalid.committeeMembers.equipment = Array(eq).fill('');
        invalid.committeeMembers['food-water'] = Array(food).fill('');
        invalid.committeeMembers.comms = Array(comm).fill('');
        assert.equal(await valid(invalid), false, `Reject mixed roster ${eq}/${food}/${comm}`);
      }
      const invalid = structuredClone(expanded);
      invalid.committeeRotation['borrow:0']['comms:4'] = { status: 'playing', coverFor: null };
      assert.equal(await valid(invalid), false);
      for (const old of [legacy, previous]) {
        const padded = await value('select sports_day_private.canonical_public_snapshot($1::jsonb,$2::jsonb)', [JSON.stringify(old), JSON.stringify(expanded)]);
        assert.equal(padded.committeeMembers['food-water'][3], 'Olin'); assert.equal(padded.committeeMembers.comms[3], 'Jesslyn');
        assert.equal(padded.committeeMembers.equipment[3], 'Darren'); assert.equal(padded.committeeMembers.comms[2], 'Grace');
        assert.deepEqual(padded.committeeMembers['food-water'].slice(0, 3), old.committeeMembers['food-water']);
        assert.deepEqual(padded.committeeMembers.comms.slice(0, old.committeeMembers.comms.length), old.committeeMembers.comms);
      }
      const expected = Object.fromEntries(Object.entries(scoreUnits(expanded)).filter(([key, item]) => !key.startsWith('rota:') || item !== null));
      assert.deepEqual(await value('select sports_day_private.shared_units($1::jsonb)', [JSON.stringify(expanded)]), expected);
    });
    await test('Rollback verification exercises new-slot writes, two-device CAS, privacy, unchanged scores and retry tombstones', async () => {
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
console.log(`${passed} expanded-volunteers backend checks passed.`);
