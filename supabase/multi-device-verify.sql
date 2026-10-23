-- Run as project owner after multi-device.sql. Every write is to a newly
-- generated isolated test event, and the entire transaction is rolled back.
-- No real scores, names, timers, editor permissions or leases are changed.
begin;
create temporary table multi_device_verification(event_id text, editor_uid uuid, initial_state jsonb) on commit drop;
create or replace function pg_temp.verify_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'Verification failed: %',message; end if;
end;
$$;

do $$
declare
  test_event text := 'cgs-multi-verify-'||gen_random_uuid();
  editor uuid; s jsonb; r jsonb; first_snapshot jsonb; saved_snapshot jsonb; before_units jsonb;
  device_a uuid := '10000000-0000-4000-8000-000000000001';
  device_b uuid := '10000000-0000-4000-8000-000000000002';
  operation_a uuid := '20000000-0000-4000-8000-000000000001';
  rev bigint := 100; barrier_before bigint; count_before bigint; key text; rejected boolean;
begin
  select e.public_state,a.editor_uid into s,editor
    from public.sports_day_events e join sports_day_private.editors a on a.event_id=e.id
    where e.id='cgs-oct25';
  if editor is null then raise exception 'Configure cgs-oct25 and its scorekeeper before verification.'; end if;
  s := sports_day_private.canonical_public_snapshot(s) || '{
    "tug":{"slots":[null,null,null,null,null],"locked":false,"winners":{"prelim":null,"semi1":null,"semi2":null,"final":null}},
    "borrow":{"rounds":6,"scores":[[null,null,null,null,null,null,null],[null,null,null,null,null,null,null],[null,null,null,null,null,null,null],[null,null,null,null,null,null,null],[null,null,null,null,null,null,null]]},
    "basket":{"scores":[[null,null],[null,null],[null,null],[null,null],[null,null]]},
    "relay":{"scores":[[null,null,null],[null,null,null],[null,null,null],[null,null,null],[null,null,null]]},
    "cavalry":{"division":"women","cap":null,"divisions":{"women":{"active":[],"eliminated":[],"started":false},"men":{"active":[],"eliminated":[],"started":false}}},
    "placements":{"borrow":{"values":[null,null,null,null,null],"approved":false},"basket":{"values":[null,null,null,null,null],"approved":false},"cavalry":{"values":[null,null,null,null,null],"approved":false},"tug":{"values":[null,null,null,null,null],"approved":false},"relay":{"values":[null,null,null,null,null],"approved":false}},
    "committeeRotation":{},"timers":{},"finished":[],"activeKey":null
  }'::jsonb;
  s := jsonb_set(s,'{equipmentReady}',sports_day_private.default_equipment_ready()-'cold-packs');
  s := jsonb_set(s,'{equipmentColdPacksReady}','false');
  perform pg_temp.verify_true(sports_day_private.valid_snapshot(s),'isolated fixture validates');
  insert into public.sports_day_events(id,public_state,revision,lease_revision,writer_id,lease_until)
    values(test_event,s,rev,12,device_a,clock_timestamp()+interval '1 hour');
  insert into sports_day_private.editors(event_id,editor_uid) values(test_event,editor);
  insert into multi_device_verification values(test_event,editor,s);
  perform set_config('cgs.verify_event',test_event,true);
  perform set_config('cgs.verify_editor',editor::text,true);
  perform set_config('cgs.verify_snapshot',s::text,true);
  perform set_config('request.jwt.claim.sub',editor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',editor::text,'role','authenticated')::text,true);

  r := public.authorize_sports_day_editor(test_event,device_a);
  perform pg_temp.verify_true(r->>'status'='authorized' and r->>'editing_mode'='shared-v1','first device authorized');
  perform pg_temp.verify_true((r->>'reset_revision')::bigint=100,'metadata fallback starts at existing revision');
  perform pg_temp.verify_true((select count(*)=82 from jsonb_object_keys(r->'unit_versions')),'all 82 default conflict units present');
  r := public.authorize_sports_day_editor(test_event,device_b);
  perform pg_temp.verify_true(r->>'status'='authorized' and (r->>'revision')::bigint=100,'second device authorized without transfer or revision change');
  perform pg_temp.verify_true((r->>'lease_revision')::bigint=12 and r->>'writer_id'=device_a::text,'authorization leaves legacy lease untouched');

  s := jsonb_set(s,'{equipmentReady,cones}','true'); first_snapshot:=s;
  r := public.apply_sports_day_patch(test_event,device_a,rev,operation_a,s,false); rev:=rev+1;
  perform pg_temp.verify_true(r->>'status'='applied' and (r->>'revision')::bigint=rev,'first CAS write applies');
  perform pg_temp.verify_true((r->'unit_versions'->>'equipment:cones')::bigint=rev and
    (r->'unit_versions'->>'equipment:balls')::bigint=100,'only changed checklist unit advances');
  perform pg_temp.verify_true((r->>'reset_revision')::bigint=100,'checklist change is not a reset');
  s := jsonb_set(s,'{equipmentReady,balls}','true');
  r := public.apply_sports_day_patch(test_event,device_b,rev,gen_random_uuid(),s,false); rev:=rev+1;
  perform pg_temp.verify_true(r->>'status'='applied','second device writes without reclaiming');
  r := public.apply_sports_day_patch(test_event,device_a,100,operation_a,first_snapshot,false);
  perform pg_temp.verify_true(r->>'status'='duplicate' and (r->>'revision')::bigint=rev and
    (r->>'applied_revision')::bigint=101 and r->'public_state'->'equipmentReady'->>'balls'='true','lost acknowledgement retry returns current state and original applied revision');
  r := public.apply_sports_day_patch(test_event,device_a,100,gen_random_uuid(),first_snapshot,false);
  perform pg_temp.verify_true(r->>'status'='conflict' and (r->>'revision')::bigint=rev,'stale CAS cannot erase another device update');
  select count(*) into count_before from sports_day_private.operations_v2 where event_id=test_event;
  perform pg_temp.verify_true(count_before=2,'duplicate and conflict create no operation records');
  foreach key in array array['device','revision','snapshot','barrier'] loop
    rejected:=false;
    begin
      perform public.apply_sports_day_patch(test_event,case when key='device' then device_b else device_a end,
        case when key='revision' then 101 else 100 end,operation_a,
        case when key='snapshot' then s else first_snapshot end,key='barrier');
    exception when sqlstate '22023' then rejected:=true;
    end;
    perform pg_temp.verify_true(rejected,'operation ID reuse rejects changed '||key);
  end loop;
  rejected:=false;
  begin
    perform public.apply_sports_day_patch(test_event,device_a,rev,gen_random_uuid(),s||'{"notes":{"0":"private"}}'::jsonb,false);
  exception when sqlstate '22023' then rejected:=true;
  end;
  perform pg_temp.verify_true(rejected,'private payload rejected');

  s:=jsonb_set(s,'{committeeMembers,first-aid,0}','"Verification volunteer"');
  s:=jsonb_set(s,'{teams,0,name}','"Verification red"');
  s:=jsonb_set(s,'{committeeRotation}','{"borrow:0":{"equipment:0":{"status":"duty","coverFor":null}}}');
  r:=public.apply_sports_day_patch(test_event,device_a,rev,gen_random_uuid(),s,false);rev:=rev+1;
  perform pg_temp.verify_true((r->'unit_versions'->>'roster:first-aid:0')::bigint=rev and
    (r->'unit_versions'->>'team:red:name')::bigint=rev and
    (r->'unit_versions'->>'rota:borrow:0:equipment:0')::bigint=rev and
    (r->>'reset_revision')::bigint=100,'names and rota have independent versions without reset');
  s:=jsonb_set(s,'{committeeRotation}','{}');
  r:=public.apply_sports_day_patch(test_event,device_b,rev,gen_random_uuid(),s,false);rev:=rev+1;
  perform pg_temp.verify_true((r->'unit_versions'->>'rota:borrow:0:equipment:0')::bigint=rev,'deleted rota entry keeps version tombstone');
  saved_snapshot:=s;
  r:=public.apply_sports_day_patch(test_event,device_a,rev,gen_random_uuid(),
    s-'committeeMembers'-'committeeRotation'-'equipmentReady'-'equipmentColdPacksReady',false);rev:=rev+1;
  perform pg_temp.verify_true(r->'public_state'=saved_snapshot,'omitted legacy optional fields preserved');

  s:=jsonb_set(s,'{borrow,scores,0,0}','5');
  r:=public.apply_sports_day_patch(test_event,device_a,rev,gen_random_uuid(),s,false);rev:=rev+1;
  perform pg_temp.verify_true((r->>'reset_revision')::bigint=100 and
    (r->'unit_versions'->>'borrow:0')::bigint=rev,'new Borrow award advances its whole-column unit only');
  s:=jsonb_set(s,'{borrow,scores,0,0}','4');
  r:=public.apply_sports_day_patch(test_event,device_b,rev,gen_random_uuid(),s,false);rev:=rev+1;
  perform pg_temp.verify_true((r->>'reset_revision')::bigint=rev,'Borrow correction is a reset barrier');
  s:=jsonb_set(s,'{borrow,scores,0,0}','null');
  r:=public.apply_sports_day_patch(test_event,device_a,rev,gen_random_uuid(),s,false);rev:=rev+1;
  perform pg_temp.verify_true((r->>'reset_revision')::bigint=rev and
    (r->'unit_versions'->>'borrow:0')::bigint=rev,'returning to empty does not erase ABA protection');
  s:=jsonb_set(s,'{relay,scores,0,0}','1');
  r:=public.apply_sports_day_patch(test_event,device_a,rev,gen_random_uuid(),s,false);rev:=rev+1;
  s:=jsonb_set(s,'{relay,scores,0,0}','2');
  r:=public.apply_sports_day_patch(test_event,device_b,rev,gen_random_uuid(),s,false);rev:=rev+1;
  perform pg_temp.verify_true((r->>'reset_revision')::bigint=rev,'Relay correction is a reset barrier');

  barrier_before:=(r->>'reset_revision')::bigint;
  s:=jsonb_set(s,'{basket,scores,0,0}','1');
  r:=public.apply_sports_day_patch(test_event,device_a,rev,gen_random_uuid(),s,false);rev:=rev+1;
  s:=jsonb_set(s,'{basket,scores,0,0}','2');
  r:=public.apply_sports_day_patch(test_event,device_b,rev,gen_random_uuid(),s,false);rev:=rev+1;
  perform pg_temp.verify_true((r->>'reset_revision')::bigint=barrier_before,'unlocked Basket counter changes are not resets');
  s:=jsonb_set(s,'{finished}','["basket:red:0"]');
  r:=public.apply_sports_day_patch(test_event,device_a,rev,gen_random_uuid(),s,false);rev:=rev+1;
  perform pg_temp.verify_true((r->'unit_versions'->>'basket:red:0')::bigint=rev,'Basket score and lock share one unit');
  s:=jsonb_set(s,'{basket,scores,0,0}','3');
  r:=public.apply_sports_day_patch(test_event,device_b,rev,gen_random_uuid(),s,false);rev:=rev+1;
  perform pg_temp.verify_true((r->>'reset_revision')::bigint=rev,'locked Basket correction is a reset barrier');
  s:=jsonb_set(s,'{finished}','[]');
  r:=public.apply_sports_day_patch(test_event,device_a,rev,gen_random_uuid(),s,false);rev:=rev+1;
  perform pg_temp.verify_true((r->>'reset_revision')::bigint=rev,'unlocking attempt is a reset barrier');

  s:=jsonb_set(s,'{cavalry,divisions,women}','{"active":["red","blue","yellow","green"],"eliminated":["red"],"started":true}');
  r:=public.apply_sports_day_patch(test_event,device_a,rev,gen_random_uuid(),s,false);rev:=rev+1;
  barrier_before:=(r->>'reset_revision')::bigint;
  s:=jsonb_set(s,'{cavalry,divisions,women,eliminated}','["red","blue"]');
  r:=public.apply_sports_day_patch(test_event,device_b,rev,gen_random_uuid(),s,false);rev:=rev+1;
  perform pg_temp.verify_true((r->>'reset_revision')::bigint=barrier_before,'append-only Cavalry elimination is not a reset');
  s:=jsonb_set(s,'{cavalry,divisions,women,eliminated}','["blue","red"]');
  r:=public.apply_sports_day_patch(test_event,device_a,rev,gen_random_uuid(),s,false);rev:=rev+1;
  perform pg_temp.verify_true((r->>'reset_revision')::bigint=rev,'Cavalry reorder is a reset barrier');
  s:=jsonb_set(s,'{cavalry,divisions,women,active}','["red","blue","yellow"]');
  r:=public.apply_sports_day_patch(test_event,device_b,rev,gen_random_uuid(),s,false);rev:=rev+1;
  perform pg_temp.verify_true((r->>'reset_revision')::bigint=rev,'changing a started arena is a reset barrier');

  s:=jsonb_set(s,'{tug}','{"slots":["red","blue","yellow","green","white"],"locked":true,"winners":{"prelim":"red","semi1":null,"semi2":null,"final":null}}');
  r:=public.apply_sports_day_patch(test_event,device_a,rev,gen_random_uuid(),s,false);rev:=rev+1;
  s:=jsonb_set(s,'{tug,winners,prelim}','"blue"');
  r:=public.apply_sports_day_patch(test_event,device_b,rev,gen_random_uuid(),s,false);rev:=rev+1;
  perform pg_temp.verify_true((r->>'reset_revision')::bigint=rev,'changing a recorded Tug winner is a reset barrier');

  s:=jsonb_set(s,'{timers}','{"borrow:0":{"duration":90000,"remaining":90000,"deadline":1234567890000,"signature":"","started":true}}');
  s:=jsonb_set(s,'{activeKey}','"borrow:0"');
  r:=public.apply_sports_day_patch(test_event,device_a,rev,gen_random_uuid(),s,false);rev:=rev+1;
  barrier_before:=(r->>'reset_revision')::bigint;
  s:=jsonb_set(s,'{timers,borrow:0,deadline}','null');
  r:=public.apply_sports_day_patch(test_event,device_b,rev,gen_random_uuid(),s,false);rev:=rev+1;
  perform pg_temp.verify_true((r->>'reset_revision')::bigint=barrier_before,'pausing a started timer is not a reset');
  s:=jsonb_set(s,'{timers,borrow:0,started}','false');
  r:=public.apply_sports_day_patch(test_event,device_a,rev,gen_random_uuid(),s,false);rev:=rev+1;
  perform pg_temp.verify_true((r->>'reset_revision')::bigint=rev,'resetting started timer creates barrier');
  s:=jsonb_set(s,'{timers}','{}');s:=jsonb_set(s,'{activeKey}','null');
  r:=public.apply_sports_day_patch(test_event,device_b,rev,gen_random_uuid(),s,false);rev:=rev+1;
  perform pg_temp.verify_true((r->>'reset_revision')::bigint=rev,'deleting timer creates barrier');
  before_units:=r->'unit_versions';
  r:=public.apply_sports_day_patch(test_event,device_a,rev,gen_random_uuid(),s,true);rev:=rev+1;
  perform pg_temp.verify_true((r->>'reset_revision')::bigint=rev and r->'unit_versions'=before_units,'explicit no-op reset still advances barrier');

  r:=public.claim_sports_day_writer(test_event,device_b,true);
  perform pg_temp.verify_true(r->>'status'='upgrade_required' and (r->>'revision')::bigint=rev,'legacy transfer fenced');
  r:=public.release_sports_day_writer(test_event,device_a);
  perform pg_temp.verify_true(r->>'status'='upgrade_required' and (r->>'lease_revision')::bigint=12,'legacy release fenced');
  r:=public.apply_sports_day_update(test_event,device_a,rev,gen_random_uuid(),first_snapshot);
  perform pg_temp.verify_true(r->>'status'='upgrade_required' and r->'public_state'=s,'legacy replacement fenced');
  perform pg_temp.verify_true(not (r ? 'editor_uid') and not (r ? 'email') and not (r ? 'password'),'reply has no editor identity or credentials');
  raise notice 'Shared editing CAS, retries, independent units, barriers, compatibility and legacy fences passed.';
end;
$$;

-- Exercise anonymous EXECUTE denial and public read under the actual API role.
set local role anon;
do $$
declare r jsonb; rejected boolean:=false;
begin
  r:=public.read_sports_day_event(current_setting('cgs.verify_event'));
  if r->>'editing_mode'<>'shared-v1' then raise exception 'Anonymous public read failed.'; end if;
  begin
    perform public.authorize_sports_day_editor(current_setting('cgs.verify_event'),'10000000-0000-4000-8000-000000000001');
  exception when insufficient_privilege then rejected:=true;
  end;
  if not rejected then raise exception 'Anonymous editor authorization must be denied.'; end if;
  rejected:=false;
  begin
    perform public.apply_sports_day_patch(current_setting('cgs.verify_event'),'10000000-0000-4000-8000-000000000001',0,
      '30000000-0000-4000-8000-000000000001',current_setting('cgs.verify_snapshot')::jsonb,false);
  exception when insufficient_privilege then rejected:=true;
  end;
  if not rejected then raise exception 'Anonymous result update must be denied.'; end if;
end;
$$;
reset role;

-- Authenticated accounts still require the existing private scorekeeper grant.
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000009',true);
select set_config('request.jwt.claims','{"sub":"90000000-0000-4000-8000-000000000009","role":"authenticated"}',true);
set local role authenticated;
do $$
declare rejected boolean:=false;
begin
  begin
    perform public.authorize_sports_day_editor(current_setting('cgs.verify_event'),'10000000-0000-4000-8000-000000000001');
  exception when insufficient_privilege then rejected:=true;
  end;
  if not rejected then raise exception 'Unapproved login authorization must be denied.'; end if;
  rejected:=false;
  begin
    perform public.apply_sports_day_patch(current_setting('cgs.verify_event'),'10000000-0000-4000-8000-000000000001',0,
      '30000000-0000-4000-8000-000000000001',current_setting('cgs.verify_snapshot')::jsonb,false);
  exception when insufficient_privilege then rejected:=true;
  end;
  if not rejected then raise exception 'Unapproved login result update must be denied.'; end if;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('cgs.verify_editor'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('cgs.verify_editor'),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare r jsonb; rejected boolean:=false;
begin
  r:=public.authorize_sports_day_editor(current_setting('cgs.verify_event'),'10000000-0000-4000-8000-000000000002');
  if r->>'status'<>'authorized' then raise exception 'Approved authenticated role must be authorized.'; end if;
  begin
    update public.sports_day_events set revision=revision+1 where id=current_setting('cgs.verify_event');
  exception when insufficient_privilege then rejected:=true;
  end;
  if not rejected then raise exception 'Authenticated direct table writes must stay denied.'; end if;
end;
$$;
reset role;

select pg_temp.verify_true(not has_table_privilege('anon','sports_day_private.operations_v2','SELECT,INSERT,UPDATE,DELETE'),'retry records private to anon');
select pg_temp.verify_true(not has_table_privilege('authenticated','sports_day_private.event_sync_metadata','SELECT,INSERT,UPDATE,DELETE'),'metadata private to authenticated');
select pg_temp.verify_true((select bool_and(relrowsecurity) from pg_class where oid in
  ('sports_day_private.operations_v2'::regclass,'sports_day_private.event_sync_metadata'::regclass)),'new private tables have RLS');
select pg_temp.verify_true(not has_function_privilege('authenticated','sports_day_private.shared_units(jsonb)','EXECUTE'),'unit helper not exposed');
select pg_temp.verify_true(not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and
  schemaname='sports_day_private' and tablename in ('operations_v2','event_sync_metadata')),'private metadata excluded from realtime');
select 'All multi-device verification checks passed; isolated writes will be rolled back.' as result;
rollback;
