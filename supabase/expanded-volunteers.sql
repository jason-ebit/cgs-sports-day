-- Append Food & water and Comm positions after final-roster.sql.
-- Existing event data, editor grants, operation payloads and revisions stay intact.
-- All three known public roster shapes remain valid for reading and exact retry acknowledgement.
-- New edits require the expanded roster; refresh cached phones before editing.
begin;

-- Serialize the short metadata upgrade against result writes, while allowing reads.
lock table public.sports_day_events in exclusive mode;

create or replace function sports_day_private.default_committee_members()
returns jsonb language sql immutable set search_path = pg_catalog as $$
  select '{"director":[""],"judges":[""],"first-aid":["",""],"equipment":["","","",""],"food-water":["","","",""],"comms":["Cindy","Mario","",""],"team-leaders":["","","","",""],"warmup":[""]}'::jsonb;
$$;

create or replace function sports_day_private.valid_committee_members(m jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare
  departments text[] := array['director','judges','first-aid','equipment','food-water','comms','team-leaders','warmup'];
  slots integer[] := array[1,1,2,4,4,4,5,1];
  names jsonb; name jsonb; i integer;
begin
  if not sports_day_private.exact_keys(m,departments) then return false; end if;
  -- Accept only complete known roster shapes; mixed-size upgrades are invalid.
  if jsonb_typeof(m->'equipment')='array' and jsonb_array_length(m->'equipment')=3
    and jsonb_typeof(m->'comms')='array' and jsonb_array_length(m->'comms')=2 then
    slots := array[1,1,2,3,3,2,5,1];
  elsif jsonb_typeof(m->'equipment')='array' and jsonb_array_length(m->'equipment')=4
    and jsonb_typeof(m->'food-water')='array' and jsonb_array_length(m->'food-water')=3
    and jsonb_typeof(m->'comms')='array' and jsonb_array_length(m->'comms')=3 then
    slots := array[1,1,2,4,3,3,5,1];
  end if;
  for i in 1..array_length(departments,1) loop
    names := m->departments[i];
    if jsonb_typeof(names) <> 'array' or jsonb_array_length(names) <> slots[i] then return false; end if;
    for name in select value from jsonb_array_elements(names) loop
      if jsonb_typeof(name) <> 'string' or length(name #>> '{}') > 60 then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then return false;
end;
$$;

-- Append stable slots only. Each missing old position inherits the current
-- shared name, so normalization cannot blank a later Equipment, Food or Comm name.
create or replace function sports_day_private.canonical_committee_members(m jsonb, fallback jsonb default null)
returns jsonb language plpgsql immutable set search_path = pg_catalog as $$
declare
  result jsonb := coalesce(m,fallback,sports_day_private.default_committee_members());
  department text; slot integer;
begin
  foreach department in array array['equipment','food-water','comms'] loop
    while jsonb_array_length(result->department)<4 loop
      slot := jsonb_array_length(result->department);
      result := jsonb_set(result,array[department],(result->department) ||
        jsonb_build_array(coalesce(fallback->department->slot,'""'::jsonb)));
    end loop;
  end loop;
  return result;
end;
$$;

create or replace function sports_day_private.canonical_public_snapshot(s jsonb, fallback jsonb default null)
returns jsonb language sql immutable set search_path = pg_catalog as $$
  select s || jsonb_build_object(
    'committeeMembers',sports_day_private.canonical_committee_members(s->'committeeMembers',fallback->'committeeMembers'),
    'committeeRotation',coalesce(s->'committeeRotation',fallback->'committeeRotation',sports_day_private.default_committee_rotation()),
    'equipmentReady',(sports_day_private.default_equipment_ready() ||
      coalesce(fallback->'equipmentReady','{}'::jsonb) || coalesce(s->'equipmentReady','{}'::jsonb)) - 'cold-packs',
    'equipmentColdPacksReady',coalesce(s->'equipmentColdPacksReady',s->'equipmentReady'->'cold-packs',
      fallback->'equipmentColdPacksReady',fallback->'equipmentReady'->'cold-packs','false'::jsonb));
$$;

create or replace function sports_day_private.valid_committee_rotation(m jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare
  round_pattern text := '^(borrow:[0-6]|basket:(red|blue|yellow|green|white):[01]|cavalry:(women|men)|tug:(prelim|semi1|semi2|final)|relay:[0-2])$';
  people text[] := array['director:0','judges:0','first-aid:0','first-aid:1','equipment:0','equipment:1','equipment:2','equipment:3','food-water:0','food-water:1','food-water:2','food-water:3','comms:0','comms:1','comms:2','comms:3','team-leaders:0','team-leaders:1','team-leaders:2','team-leaders:3','team-leaders:4','warmup:0'];
  round_key text; person text; assignments jsonb; entry jsonb; cover_for text;
begin
  if m is null or jsonb_typeof(m) <> 'object' or (select count(*) from jsonb_object_keys(m)) > 26 then return false; end if;
  for round_key,assignments in select * from jsonb_each(m) loop
    if round_key !~ round_pattern or jsonb_typeof(assignments) <> 'object'
      or (select count(*) from jsonb_object_keys(assignments)) > 22 then return false; end if;
    for person,entry in select * from jsonb_each(assignments) loop
      if not (person = any(people)) or not sports_day_private.exact_keys(entry,array['status','coverFor'])
        or jsonb_typeof(entry->'status') <> 'string' or entry->>'status' not in ('playing','duty','cover') then return false; end if;
      if entry->'coverFor' <> 'null'::jsonb then
        cover_for := entry->>'coverFor';
        if entry->>'status' <> 'cover' or jsonb_typeof(entry->'coverFor') <> 'string'
          or not (cover_for = any(people)) or cover_for = person then return false; end if;
      end if;
    end loop;
  end loop;
  return true;
exception when others then return false;
end;
$$;

-- Preserve every existing unit version, including removed-assignment tombstones.
-- New roster units start at the current event revision, without changing it.
insert into sports_day_private.event_sync_metadata(event_id,unit_versions,reset_revision)
  select e.id,(select jsonb_object_agg(key,to_jsonb(e.revision))
    from jsonb_each(sports_day_private.shared_units(e.public_state))),e.revision
  from public.sports_day_events e on conflict(event_id) do nothing;
update sports_day_private.event_sync_metadata m set unit_versions =
  coalesce((select jsonb_object_agg(key,to_jsonb(e.revision))
    from jsonb_each(sports_day_private.shared_units(e.public_state)) unit
    where not (m.unit_versions ? unit.key)),'{}'::jsonb) || m.unit_versions
  from public.sports_day_events e where e.id=m.event_id;

-- A default capability lets old two-argument requests fail safely rather than
-- claiming editing rights for a roster their cached UI cannot display.
drop function if exists public.authorize_sports_day_editor(text,uuid);
create or replace function public.authorize_sports_day_editor(p_event_id text, p_device_id uuid, p_roster_version integer default 1)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare e public.sports_day_events;
begin
  if p_device_id is null then raise exception 'Invalid editor device.' using errcode='22023'; end if;
  select * into e from public.sports_day_events where id=p_event_id;
  if not found then raise exception 'Event is not configured.' using errcode='P0002'; end if;
  if auth.uid() is null or not exists (select 1 from sports_day_private.editors where event_id=p_event_id and editor_uid=auth.uid()) then
    raise exception 'This login is not the scorekeeper.' using errcode='42501';
  end if;
  if p_roster_version is distinct from 3 then return sports_day_private.reply(e,'upgrade_required'); end if;
  return sports_day_private.reply(e,'authorized');
end;
$$;

create or replace function public.apply_sports_day_patch(
  p_event_id text, p_device_id uuid, p_expected_revision bigint, p_operation_id uuid,
  p_snapshot jsonb, p_barrier boolean default false)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  e public.sports_day_events; previous sports_day_private.operations_v2;
  next_snapshot jsonb; old_units jsonb; next_units jsonb; versions jsonb;
  next_revision bigint; barrier_revision bigint; key text;
begin
  if p_device_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0
    or p_barrier is null or not sports_day_private.valid_snapshot(p_snapshot) then
    raise exception 'Invalid public score update.' using errcode='22023';
  end if;
  select * into e from public.sports_day_events where id=p_event_id for update;
  if not found then raise exception 'Event is not configured.' using errcode='P0002'; end if;
  if auth.uid() is null or not exists (select 1 from sports_day_private.editors where event_id=p_event_id and editor_uid=auth.uid()) then
    raise exception 'This login is not the scorekeeper.' using errcode='42501';
  end if;
  select * into previous from sports_day_private.operations_v2 where event_id=p_event_id and operation_id=p_operation_id;
  if found then
    if previous.device_id is distinct from p_device_id or previous.expected_revision is distinct from p_expected_revision
      or previous.snapshot is distinct from p_snapshot or previous.barrier is distinct from p_barrier then
      raise exception 'An operation ID cannot be reused for another update.' using errcode='22023';
    end if;
    return sports_day_private.reply(e,'duplicate') || jsonb_build_object('applied_revision',previous.applied_revision);
  end if;
  if jsonb_array_length(p_snapshot->'committeeMembers'->'equipment') is distinct from 4
    or jsonb_array_length(p_snapshot->'committeeMembers'->'food-water') is distinct from 4
    or jsonb_array_length(p_snapshot->'committeeMembers'->'comms') is distinct from 4 then
    return sports_day_private.reply(e,'upgrade_required');
  end if;
  if e.revision<>p_expected_revision then return sports_day_private.reply(e,'conflict'); end if;
  next_snapshot := sports_day_private.canonical_public_snapshot(p_snapshot,e.public_state);
  if not sports_day_private.valid_snapshot(next_snapshot) then raise exception 'Invalid merged public score update.' using errcode='22023'; end if;
  old_units := sports_day_private.shared_units(e.public_state);
  next_units := sports_day_private.shared_units(next_snapshot);
  insert into sports_day_private.event_sync_metadata(event_id,unit_versions,reset_revision)
    values(p_event_id,(select jsonb_object_agg(k,to_jsonb(e.revision)) from jsonb_object_keys(old_units) keys(k)),e.revision)
    on conflict(event_id) do nothing;
  select m.unit_versions,m.reset_revision into versions,barrier_revision
    from sports_day_private.event_sync_metadata m where m.event_id=p_event_id;
  next_revision := e.revision+1;
  for key in select jsonb_object_keys(old_units) union select jsonb_object_keys(next_units) loop
    if old_units->key is distinct from next_units->key then
      versions := versions || jsonb_build_object(key,next_revision);
    end if;
  end loop;
  if p_barrier or sports_day_private.destructive_transition(e.public_state,next_snapshot) then barrier_revision:=next_revision; end if;
  update sports_day_private.event_sync_metadata set unit_versions=versions,reset_revision=barrier_revision where event_id=p_event_id;
  update public.sports_day_events set public_state=next_snapshot,revision=next_revision,updated_at=clock_timestamp()
    where id=p_event_id returning * into e;
  insert into sports_day_private.operations_v2(event_id,operation_id,device_id,expected_revision,snapshot,barrier,applied_revision)
    values(p_event_id,p_operation_id,p_device_id,p_expected_revision,p_snapshot,p_barrier,e.revision);
  return sports_day_private.reply(e,'applied') || jsonb_build_object('applied_revision',e.revision);
end;
$$;

revoke all on function sports_day_private.default_committee_members() from public, anon, authenticated;
revoke all on function sports_day_private.valid_committee_members(jsonb) from public, anon, authenticated;
revoke all on function sports_day_private.canonical_committee_members(jsonb,jsonb) from public, anon, authenticated;
revoke all on function sports_day_private.canonical_public_snapshot(jsonb,jsonb) from public, anon, authenticated;
revoke all on function sports_day_private.valid_committee_rotation(jsonb) from public, anon, authenticated;
revoke all on function public.authorize_sports_day_editor(text,uuid,integer) from public, anon, authenticated;
revoke all on function public.apply_sports_day_patch(text,uuid,bigint,uuid,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.authorize_sports_day_editor(text,uuid,integer) to authenticated;
grant execute on function public.apply_sports_day_patch(text,uuid,bigint,uuid,jsonb,boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
