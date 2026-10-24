-- Run as project owner after final-roster.sql. Only a new isolated test event
-- is written, and all test data is rolled back at the end.
begin;
create or replace function pg_temp.roster_verify(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'Roster verification failed: %',message; end if;
end;
$$;

do $$
declare
  test_event text := 'cgs-final-roster-verify-'||gen_random_uuid();
  editor uuid; s jsonb; original jsonb; legacy jsonb; r jsonb; saved jsonb; fallback jsonb;
  device uuid := '41000000-0000-4000-8000-000000000001';
  other_device uuid := '41000000-0000-4000-8000-000000000002';
  old_operation uuid := '42000000-0000-4000-8000-000000000001';
  operation uuid := '42000000-0000-4000-8000-000000000002';
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
  perform set_config('cgs.roster_verify_event',test_event,true);
  perform set_config('cgs.roster_verify_editor',editor::text,true);
  perform set_config('cgs.roster_verify_snapshot',s::text,true);
  perform set_config('request.jwt.claim.sub',editor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',editor::text,'role','authenticated')::text,true);

  r:=public.authorize_sports_day_editor(test_event,device);
  perform pg_temp.roster_verify(r->>'status'='upgrade_required','cached clients must refresh before editing');
  r:=public.authorize_sports_day_editor(test_event,device,2);
  perform pg_temp.roster_verify(r->>'status'='authorized' and (r->>'revision')::bigint=rev,'current device authorized without changing revision');
  r:=public.authorize_sports_day_editor(test_event,other_device,2);
  perform pg_temp.roster_verify(r->>'status'='authorized','second scorekeeper device remains authorized');
  perform pg_temp.roster_verify((select count(*)=84 from jsonb_object_keys(r->'unit_versions')),'expanded default units agree');

  legacy:=jsonb_set(jsonb_set(s,'{committeeMembers,equipment}','["","",""]'),'{committeeMembers,comms}','["Cindy","Mario"]');
  perform pg_temp.roster_verify(sports_day_private.valid_committee_members(legacy->'committeeMembers'),'complete old roster accepted for recovery');
  perform pg_temp.roster_verify(sports_day_private.valid_committee_members(s->'committeeMembers'),'expanded roster accepted');
  perform pg_temp.roster_verify(not sports_day_private.valid_committee_members(jsonb_set(s->'committeeMembers','{comms}','["Cindy","Mario"]')),'half-upgraded roster rejected');
  perform pg_temp.roster_verify(not sports_day_private.valid_committee_members(jsonb_set(s->'committeeMembers','{equipment}','["","","","",""]')),'unexpected fifth Equipment slot rejected');
  r:=public.apply_sports_day_patch(test_event,device,rev,gen_random_uuid(),legacy,false);
  perform pg_temp.roster_verify(r->>'status'='upgrade_required' and (r->>'revision')::bigint=rev,'unseen legacy write is fenced before CAS');
  r:=public.apply_sports_day_patch(test_event,device,rev,gen_random_uuid(),legacy-'committeeMembers',false);
  perform pg_temp.roster_verify(r->>'status'='upgrade_required' and r->'public_state'=s,'omitted roster cannot erase current members');

  -- Simulate an immutable operation that was committed before this migration.
  insert into sports_day_private.operations_v2(event_id,operation_id,device_id,expected_revision,snapshot,barrier,applied_revision)
    values(test_event,old_operation,device,98,legacy,false,99);
  r:=public.apply_sports_day_patch(test_event,device,98,old_operation,legacy,false);
  perform pg_temp.roster_verify(r->>'status'='duplicate' and (r->>'applied_revision')::bigint=99 and
    (r->>'revision')::bigint=rev,'exact old operation retry remains acknowledgeable');
  rejected:=false;
  begin
    perform public.apply_sports_day_patch(test_event,device,99,old_operation,legacy,false);
  exception when sqlstate '22023' then rejected:=true;
  end;
  perform pg_temp.roster_verify(rejected,'immutable old operation cannot change its expected revision');

  s:=jsonb_set(s,'{committeeMembers,equipment}','["Rina","Timothy","Trishya","Darren"]');
  s:=jsonb_set(s,'{committeeMembers,comms}','["Jenni","Mario","Grace"]');
  s:=jsonb_set(s,'{committeeRotation}','{"borrow:0":{"equipment:3":{"status":"playing","coverFor":null},"comms:2":{"status":"cover","coverFor":"equipment:3"}}}');
  perform pg_temp.roster_verify(sports_day_private.valid_snapshot(s),'new names and appended rota IDs validate');
  fallback:=sports_day_private.canonical_public_snapshot(legacy,s);
  perform pg_temp.roster_verify(fallback->'committeeMembers'->'equipment'->>3='Darren' and
    fallback->'committeeMembers'->'comms'->>2='Grace','old payload normalization keeps appended shared names');
  perform pg_temp.roster_verify((fallback->'committeeMembers'->'equipment')->>0='' and
    (fallback->'committeeMembers'->'comms')->>0='Cindy','padding does not alter original slot IDs');
  r:=public.apply_sports_day_patch(test_event,device,rev,operation,s,false); rev:=rev+1;
  perform pg_temp.roster_verify(r->>'status'='applied','expanded roster and rota save');
  perform pg_temp.roster_verify((r->'unit_versions'->>'roster:equipment:3')::bigint=rev and
    (r->'unit_versions'->>'roster:comms:2')::bigint=rev and
    (r->'unit_versions'->>'rota:borrow:0:equipment:3')::bigint=rev and
    (r->'unit_versions'->>'rota:borrow:0:comms:2')::bigint=rev,'appended positions have independent revision units');
  perform pg_temp.roster_verify((r->>'reset_revision')::bigint=100,'roster update is not a game reset');
  perform pg_temp.roster_verify((r->'public_state')-'committeeMembers'-'committeeRotation'=original-'committeeMembers'-'committeeRotation','scores, timers, equipment and event data stay intact');
  perform pg_temp.roster_verify(r->'public_state'->'committeeMembers'->'director'=original->'committeeMembers'->'director' and
    r->'public_state'->'committeeMembers'->'judges'=original->'committeeMembers'->'judges' and
    r->'public_state'->'committeeMembers'->'team-leaders'=original->'committeeMembers'->'team-leaders','judge and team-leader names stay intact');
  saved:=s; before_versions:=r->'unit_versions';
  r:=public.apply_sports_day_patch(test_event,other_device,rev-1,gen_random_uuid(),s,false);
  perform pg_temp.roster_verify(r->>'status'='conflict' and r->'unit_versions'=before_versions,'stale expanded snapshot still uses CAS');
  r:=public.apply_sports_day_patch(test_event,device,rev-1,operation,s,false);
  perform pg_temp.roster_verify(r->>'status'='duplicate' and r->'public_state'=s,'new exact retries are idempotent');
  s:=jsonb_set(s,'{committeeRotation}','{}');
  r:=public.apply_sports_day_patch(test_event,other_device,rev,gen_random_uuid(),s,false); rev:=rev+1;
  perform pg_temp.roster_verify((r->'unit_versions'->>'rota:borrow:0:equipment:3')::bigint=rev and
    (r->'unit_versions'->>'rota:borrow:0:comms:2')::bigint=rev,'deleted new-position assignments retain tombstones');
  r:=public.apply_sports_day_patch(test_event,device,rev,gen_random_uuid(),legacy,false);
  perform pg_temp.roster_verify(r->>'status'='upgrade_required' and
    r->'public_state'->'committeeMembers'->'equipment'->>3='Darren' and
    r->'public_state'->'committeeMembers'->'comms'->>2='Grace','cached app cannot erase final names after save');
end;
$$;

set local role anon;
do $$
declare rejected boolean:=false; r jsonb;
begin
  r:=public.read_sports_day_event(current_setting('cgs.roster_verify_event'));
  if jsonb_array_length(r->'public_state'->'committeeMembers'->'equipment')<>4 then raise exception 'Public expanded roster read failed.'; end if;
  begin
    perform public.authorize_sports_day_editor(current_setting('cgs.roster_verify_event'),'41000000-0000-4000-8000-000000000001',2);
  exception when insufficient_privilege then rejected:=true;
  end;
  if not rejected then raise exception 'Anonymous editor authorization must stay denied.'; end if;
end;
$$;
reset role;

select set_config('request.jwt.claim.sub','49000000-0000-4000-8000-000000000009',true);
set local role authenticated;
do $$
declare rejected boolean:=false;
begin
  begin
    perform public.authorize_sports_day_editor(current_setting('cgs.roster_verify_event'),'41000000-0000-4000-8000-000000000001',2);
  exception when insufficient_privilege then rejected:=true;
  end;
  if not rejected then raise exception 'An unrelated login must stay denied.'; end if;
end;
$$;
reset role;

select pg_temp.roster_verify(not has_function_privilege('anon','sports_day_private.canonical_committee_members(jsonb,jsonb)','EXECUTE'),'normalizer stays private');
select pg_temp.roster_verify(not has_function_privilege('authenticated','sports_day_private.valid_committee_rotation(jsonb)','EXECUTE'),'rota helper stays private');
select pg_temp.roster_verify(not has_table_privilege('authenticated','sports_day_private.operations_v2','SELECT,INSERT,UPDATE,DELETE'),'retry history stays private');
select 'All final-roster verification checks passed; isolated changes will be rolled back.' as result;
rollback;
