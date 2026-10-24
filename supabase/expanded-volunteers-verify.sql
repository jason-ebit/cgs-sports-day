-- Run as project owner after expanded-volunteers.sql. Only isolated test rows
-- are written, and all fixtures and changes are rolled back at the end.
begin;
create or replace function pg_temp.expanded_roster_verify(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'Expanded roster verification failed: %',message; end if;
end;
$$;

do $$
declare
  test_event text := 'cgs-expanded-volunteers-verify-'||gen_random_uuid();
  editor uuid; s jsonb; original jsonb; legacy jsonb; previous jsonb; r jsonb; padded jsonb;
  device uuid := '61000000-0000-4000-8000-000000000001';
  other_device uuid := '61000000-0000-4000-8000-000000000002';
  legacy_operation uuid := '62000000-0000-4000-8000-000000000001';
  previous_operation uuid := '62000000-0000-4000-8000-000000000002';
  operation uuid := '62000000-0000-4000-8000-000000000003';
  rev bigint := 100; rejected boolean; before_versions jsonb;
begin
  select sports_day_private.canonical_public_snapshot(e.public_state),a.editor_uid into s,editor
    from public.sports_day_events e join sports_day_private.editors a on a.event_id=e.id
    where e.id='cgs-oct25';
  if editor is null then raise exception 'Configure cgs-oct25 and its scorekeeper first.'; end if;
  s:=jsonb_set(s,'{committeeMembers}',sports_day_private.default_committee_members());
  s:=jsonb_set(s,'{committeeMembers,director,0}','"Existing main judge"');
  s:=jsonb_set(s,'{committeeMembers,judges,0}','"Existing assistant"');
  s:=jsonb_set(s,'{committeeMembers,team-leaders,0}','"Existing team leader"');
  s:=jsonb_set(s,'{committeeRotation}','{}');
  original:=s;
  insert into public.sports_day_events(id,public_state,revision) values(test_event,s,rev);
  insert into sports_day_private.editors(event_id,editor_uid) values(test_event,editor);
  perform set_config('cgs.expanded_verify_event',test_event,true);
  perform set_config('request.jwt.claim.sub',editor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',editor::text,'role','authenticated')::text,true);

  r:=public.authorize_sports_day_editor(test_event,device);
  perform pg_temp.expanded_roster_verify(r->>'status'='upgrade_required','default capability must refresh');
  r:=public.authorize_sports_day_editor(test_event,device,2);
  perform pg_temp.expanded_roster_verify(r->>'status'='upgrade_required','previous capability must refresh');
  r:=public.authorize_sports_day_editor(test_event,device,3);
  perform pg_temp.expanded_roster_verify(r->>'status'='authorized' and (r->>'revision')::bigint=rev,'current authorization preserves revision');
  r:=public.authorize_sports_day_editor(test_event,other_device,3);
  perform pg_temp.expanded_roster_verify(r->>'status'='authorized','second device stays editable');
  perform pg_temp.expanded_roster_verify((select count(*)=86 from jsonb_object_keys(r->'unit_versions')),'expanded default unit count agrees');

  previous:=jsonb_set(jsonb_set(s,'{committeeMembers,food-water}','["","",""]'),'{committeeMembers,comms}','["Cindy","Mario",""]');
  legacy:=jsonb_set(jsonb_set(previous,'{committeeMembers,equipment}','["","",""]'),'{committeeMembers,comms}','["Cindy","Mario"]');
  perform pg_temp.expanded_roster_verify(sports_day_private.valid_snapshot(legacy),'first historical shape is readable');
  perform pg_temp.expanded_roster_verify(sports_day_private.valid_snapshot(previous),'previous historical shape is readable');
  perform pg_temp.expanded_roster_verify(sports_day_private.valid_snapshot(s),'current shape is valid');
  perform pg_temp.expanded_roster_verify(not sports_day_private.valid_committee_members(jsonb_set(s->'committeeMembers','{comms}','["Cindy","Mario",""]')),'partial Comm upgrade rejected');
  perform pg_temp.expanded_roster_verify(not sports_day_private.valid_committee_members(jsonb_set(s->'committeeMembers','{food-water}','["","",""]')),'partial Food upgrade rejected');
  perform pg_temp.expanded_roster_verify(not sports_day_private.valid_committee_members(jsonb_set(previous->'committeeMembers','{equipment}','["","",""]')),'mixed historical shapes rejected');
  r:=public.apply_sports_day_patch(test_event,device,rev-1,gen_random_uuid(),previous,false);
  perform pg_temp.expanded_roster_verify(r->>'status'='upgrade_required' and (r->>'revision')::bigint=rev,'unseen previous write fenced before CAS');
  r:=public.apply_sports_day_patch(test_event,device,rev,gen_random_uuid(),legacy,false);
  perform pg_temp.expanded_roster_verify(r->>'status'='upgrade_required','unseen first historical write fenced');
  r:=public.apply_sports_day_patch(test_event,device,rev,gen_random_uuid(),s-'committeeMembers',false);
  perform pg_temp.expanded_roster_verify(r->>'status'='upgrade_required' and r->'public_state'=s,'omitted roster cannot erase members');

  -- Simulate immutable receipts committed under both earlier roster protocols.
  insert into sports_day_private.operations_v2(event_id,operation_id,device_id,expected_revision,snapshot,barrier,applied_revision)
    values(test_event,legacy_operation,device,96,legacy,false,97),
      (test_event,previous_operation,device,98,previous,false,99);
  r:=public.apply_sports_day_patch(test_event,device,96,legacy_operation,legacy,false);
  perform pg_temp.expanded_roster_verify(r->>'status'='duplicate' and (r->>'applied_revision')::bigint=97,'exact first historical retry acknowledged');
  r:=public.apply_sports_day_patch(test_event,device,98,previous_operation,previous,false);
  perform pg_temp.expanded_roster_verify(r->>'status'='duplicate' and (r->>'applied_revision')::bigint=99 and (r->>'revision')::bigint=rev,'exact previous retry acknowledged');
  rejected:=false;
  begin
    perform public.apply_sports_day_patch(test_event,other_device,98,previous_operation,previous,false);
  exception when sqlstate '22023' then rejected:=true;
  end;
  perform pg_temp.expanded_roster_verify(rejected,'old receipt cannot be reused by another device');

  s:=jsonb_set(s,'{committeeMembers,equipment}','["Rina","Timothy","Trishya","Darren"]');
  s:=jsonb_set(s,'{committeeMembers,food-water}','["Cindy","Vin","Maria","Olin"]');
  s:=jsonb_set(s,'{committeeMembers,comms}','["Jenni","Mario","Grace","Jesslyn"]');
  s:=jsonb_set(s,'{committeeRotation}','{"borrow:0":{"food-water:3":{"status":"duty","coverFor":null},"comms:3":{"status":"cover","coverFor":"comms:0"}}}');
  perform pg_temp.expanded_roster_verify(sports_day_private.valid_snapshot(s),'new names and stable rotation positions validate');
  padded:=sports_day_private.canonical_public_snapshot(previous,s);
  perform pg_temp.expanded_roster_verify(padded->'committeeMembers'->'food-water'->>3='Olin' and padded->'committeeMembers'->'comms'->>3='Jesslyn','previous snapshot padding keeps appended shared names');
  padded:=sports_day_private.canonical_public_snapshot(legacy,s);
  perform pg_temp.expanded_roster_verify(padded->'committeeMembers'->'equipment'->>3='Darren' and padded->'committeeMembers'->'comms'->>2='Grace' and padded->'committeeMembers'->'food-water'->>3='Olin' and padded->'committeeMembers'->'comms'->>3='Jesslyn','first historical snapshot keeps every appended shared name');
  perform pg_temp.expanded_roster_verify(padded->'committeeMembers'->'comms'->>0='Cindy' and padded->'committeeMembers'->'comms'->>1='Mario','old slot IDs are never reordered');
  r:=public.apply_sports_day_patch(test_event,device,rev,operation,s,false); rev:=rev+1;
  perform pg_temp.expanded_roster_verify(r->>'status'='applied','expanded roster and rotation save');
  perform pg_temp.expanded_roster_verify((r->'unit_versions'->>'roster:food-water:3')::bigint=rev and (r->'unit_versions'->>'roster:comms:3')::bigint=rev and (r->'unit_versions'->>'rota:borrow:0:food-water:3')::bigint=rev and (r->'unit_versions'->>'rota:borrow:0:comms:3')::bigint=rev,'new positions have independent revision units');
  perform pg_temp.expanded_roster_verify((r->>'reset_revision')::bigint=100,'roster update is not a game reset');
  perform pg_temp.expanded_roster_verify((r->'public_state')-'committeeMembers'-'committeeRotation'=original-'committeeMembers'-'committeeRotation','scores, timers, equipment and event data stay intact');
  perform pg_temp.expanded_roster_verify(r->'public_state'->'committeeMembers'->'director'=original->'committeeMembers'->'director' and r->'public_state'->'committeeMembers'->'judges'=original->'committeeMembers'->'judges' and r->'public_state'->'committeeMembers'->'team-leaders'=original->'committeeMembers'->'team-leaders','judge and leader names stay intact');
  before_versions:=r->'unit_versions';
  r:=public.apply_sports_day_patch(test_event,other_device,rev-1,gen_random_uuid(),s,false);
  perform pg_temp.expanded_roster_verify(r->>'status'='conflict' and r->'unit_versions'=before_versions,'second device still uses CAS');
  r:=public.apply_sports_day_patch(test_event,device,rev-1,operation,s,false);
  perform pg_temp.expanded_roster_verify(r->>'status'='duplicate' and r->'public_state'=s,'current exact retry is idempotent');
  s:=jsonb_set(s,'{committeeRotation}','{}');
  r:=public.apply_sports_day_patch(test_event,other_device,rev,gen_random_uuid(),s,false); rev:=rev+1;
  perform pg_temp.expanded_roster_verify((r->'unit_versions'->>'rota:borrow:0:food-water:3')::bigint=rev and (r->'unit_versions'->>'rota:borrow:0:comms:3')::bigint=rev,'deleted assignments retain version tombstones');
  r:=public.apply_sports_day_patch(test_event,device,rev,gen_random_uuid(),previous,false);
  perform pg_temp.expanded_roster_verify(r->>'status'='upgrade_required' and r->'public_state'->'committeeMembers'->'food-water'->>3='Olin' and r->'public_state'->'committeeMembers'->'comms'->>3='Jesslyn','cached app cannot erase added names');
end;
$$;

set local role anon;
do $$
declare rejected boolean:=false; r jsonb;
begin
  r:=public.read_sports_day_event(current_setting('cgs.expanded_verify_event'));
  if jsonb_array_length(r->'public_state'->'committeeMembers'->'food-water')<>4 or jsonb_array_length(r->'public_state'->'committeeMembers'->'comms')<>4 then raise exception 'Public expanded roster read failed.'; end if;
  begin
    perform public.authorize_sports_day_editor(current_setting('cgs.expanded_verify_event'),'61000000-0000-4000-8000-000000000001',3);
  exception when insufficient_privilege then rejected:=true;
  end;
  if not rejected then raise exception 'Anonymous editor authorization must stay denied.'; end if;
end;
$$;
reset role;

select set_config('request.jwt.claim.sub','69000000-0000-4000-8000-000000000009',true);
set local role authenticated;
do $$
declare rejected boolean:=false;
begin
  begin
    perform public.authorize_sports_day_editor(current_setting('cgs.expanded_verify_event'),'61000000-0000-4000-8000-000000000001',3);
  exception when insufficient_privilege then rejected:=true;
  end;
  if not rejected then raise exception 'An unrelated login must stay denied.'; end if;
end;
$$;
reset role;

select pg_temp.expanded_roster_verify(not has_function_privilege('anon','sports_day_private.canonical_committee_members(jsonb,jsonb)','EXECUTE'),'normalizer stays private');
select pg_temp.expanded_roster_verify(not has_function_privilege('authenticated','sports_day_private.valid_committee_rotation(jsonb)','EXECUTE'),'rotation validator stays private');
select pg_temp.expanded_roster_verify(not has_table_privilege('authenticated','sports_day_private.operations_v2','SELECT,INSERT,UPDATE,DELETE'),'retry history stays private');
select 'All expanded-volunteers verification checks passed; isolated changes will be rolled back.' as result;
rollback;
