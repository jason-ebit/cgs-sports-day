-- Read-only checks after committee-rotation.sql. Run as the project owner.
-- Compare the metadata/hash with a pre-installation read to confirm the
-- functions-only migration did not touch the stored event or writer lease.
select id, revision, lease_revision, writer_id, lease_until, updated_at,
  md5(public_state::text) as stored_state_hash,
  sports_day_private.valid_snapshot(public_state) as stored_snapshot_valid,
  sports_day_private.default_committee_rotation() = '{}'::jsonb as default_rota_empty,
  sports_day_private.valid_committee_rotation('{}'::jsonb) as empty_rota_valid,
  sports_day_private.valid_snapshot(public_state - 'committeeRotation') as old_snapshot_valid,
  sports_day_private.valid_committee_rotation(sports_day_private.reply(e,'check')->'public_state'->'committeeRotation') as reply_rota_valid,
  sports_day_private.valid_committee_rotation('{"borrow:0":{"equipment:0":{"status":"playing","coverFor":null},"equipment:1":{"status":"duty","coverFor":null},"equipment:2":{"status":"cover","coverFor":"equipment:0"}}}'::jsonb) as sample_rota_valid,
  not sports_day_private.valid_committee_rotation('null'::jsonb) as null_rota_rejected,
  not sports_day_private.valid_committee_rotation('{"borrow:7":{}}'::jsonb)
    and not sports_day_private.valid_committee_rotation('{"basket:0":{}}'::jsonb)
    and not sports_day_private.valid_committee_rotation('{"basket:red:2":{}}'::jsonb)
    and sports_day_private.valid_committee_rotation('{"basket:red:0":{},"basket:white:1":{}}'::jsonb) as unknown_round_rejected,
  not sports_day_private.valid_committee_rotation('{"relay:0":{"equipment:3":{"status":"duty","coverFor":null}}}'::jsonb) as unknown_person_rejected,
  not sports_day_private.valid_committee_rotation('{"relay:0":{"comms:0":{"status":"rest","coverFor":null}}}'::jsonb) as unknown_status_rejected,
  not sports_day_private.valid_committee_rotation('{"relay:0":{"comms:0":{"status":"cover","coverFor":"comms:0"}}}'::jsonb) as self_cover_rejected,
  not sports_day_private.valid_committee_rotation('{"relay:0":{"comms:0":{"status":"duty","coverFor":"comms:1"}}}'::jsonb) as noncover_target_rejected,
  not sports_day_private.valid_committee_rotation('{"relay:0":{"comms:0":{"status":"playing","coverFor":null,"notes":"private"}}}'::jsonb) as extra_private_leaf_rejected,
  not sports_day_private.valid_snapshot(public_state || '{"committeeRotation":{"relay:0":{"comms:0":{"status":"playing","coverFor":null,"notes":"private"}}}}'::jsonb) as embedded_private_notes_rejected,
  (select count(*) = 21 from jsonb_object_keys(sports_day_private.reply(e,'check')->'public_state'->'equipmentReady')) as old_equipment_wire_count_correct,
  jsonb_typeof(sports_day_private.reply(e,'check')->'public_state'->'equipmentColdPacksReady') = 'boolean' as cold_pack_flag_valid,
  not has_function_privilege('anon','sports_day_private.default_committee_rotation()','EXECUTE') as default_helper_private,
  not has_function_privilege('authenticated','sports_day_private.valid_committee_rotation(jsonb)','EXECUTE') as validator_helper_private,
  not has_function_privilege('anon','public.apply_sports_day_update(text,uuid,bigint,uuid,jsonb)','EXECUTE') as anon_rpc_read_only,
  has_function_privilege('authenticated','public.apply_sports_day_update(text,uuid,bigint,uuid,jsonb)','EXECUTE') as scorekeeper_rpc_available,
  not has_table_privilege('anon','public.sports_day_events','INSERT,UPDATE,DELETE') as anon_table_read_only,
  not has_table_privilege('authenticated','public.sports_day_events','INSERT,UPDATE,DELETE') as authenticated_table_read_only,
  (select relrowsecurity from pg_class where oid='public.sports_day_events'::regclass) as row_security_enabled
from public.sports_day_events e where id='cgs-oct25';
