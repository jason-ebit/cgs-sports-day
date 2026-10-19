-- Read-only checks after equipment-cold-packs.sql. Run as the project owner.
-- Keep the row metadata/hash before and after installation if auditing that no
-- event data or active timer/lease changed during the function-only migration.
select id, revision, lease_revision, writer_id, lease_until, updated_at,
  md5(public_state::text) as stored_state_hash,
  sports_day_private.valid_snapshot(public_state) as stored_snapshot_valid,
  sports_day_private.valid_equipment_ready(sports_day_private.default_equipment_ready()) as defaults_valid,
  (select count(*) = 22 from jsonb_object_keys(sports_day_private.default_equipment_ready())) as item_count_correct,
  sports_day_private.valid_equipment_ready(sports_day_private.default_equipment_ready() - 'cold-packs') as old_21_item_checklist_valid,
  sports_day_private.valid_equipment_ready(sports_day_private.reply(e,'check')->'public_state'->'equipmentReady') as reply_checklist_valid,
  (select count(*) = 21 from jsonb_object_keys(sports_day_private.reply(e,'check')->'public_state'->'equipmentReady')) as reply_item_count_correct,
  (jsonb_typeof(sports_day_private.reply(e,'check')->'public_state'->'equipmentColdPacksReady') = 'boolean') as cold_pack_flag_valid,
  not sports_day_private.valid_snapshot(public_state || '{"equipmentColdPacksReady":"true"}'::jsonb) as nonboolean_cold_pack_rejected,
  not sports_day_private.valid_equipment_ready('{}'::jsonb) as incomplete_checklist_rejected,
  not sports_day_private.valid_equipment_ready(sports_day_private.default_equipment_ready() - 'gloves') as missing_old_item_rejected,
  not sports_day_private.valid_equipment_ready(sports_day_private.default_equipment_ready() || '{"gloves":"true"}'::jsonb) as nonboolean_rejected,
  not sports_day_private.valid_equipment_ready(sports_day_private.default_equipment_ready() || '{"unknown":false}'::jsonb) as unknown_item_rejected,
  not sports_day_private.valid_snapshot(public_state || '{"committeeNotes":{"equipment":"private"}}'::jsonb) as private_notes_rejected,
  not sports_day_private.valid_snapshot(public_state || jsonb_build_object('equipmentReady',sports_day_private.default_equipment_ready() || '{"gloves":{"private":"note"}}'::jsonb)) as embedded_private_object_rejected,
  not has_function_privilege('anon','sports_day_private.default_equipment_ready()','EXECUTE') as default_helper_private,
  not has_function_privilege('authenticated','sports_day_private.valid_equipment_ready(jsonb)','EXECUTE') as validator_helper_private,
  not has_function_privilege('anon','public.apply_sports_day_update(text,uuid,bigint,uuid,jsonb)','EXECUTE') as anon_rpc_read_only,
  has_function_privilege('authenticated','public.apply_sports_day_update(text,uuid,bigint,uuid,jsonb)','EXECUTE') as scorekeeper_rpc_available,
  not has_table_privilege('anon','public.sports_day_events','INSERT,UPDATE,DELETE') as anon_table_read_only,
  not has_table_privilege('authenticated','public.sports_day_events','INSERT,UPDATE,DELETE') as authenticated_table_read_only,
  (select relrowsecurity from pg_class where oid='public.sports_day_events'::regclass) as row_security_enabled
from public.sports_day_events e where id='cgs-oct25';
