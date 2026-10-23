-- Shared editing for the existing approved scorekeeper login.
-- Run after committee-rotation.sql. Installation preserves every event snapshot,
-- score revision, writer lease and editor allowlist. Metadata and retry records
-- stay private. Re-running does not reset their versions or retry history.
begin;

create or replace function sports_day_private.canonical_public_snapshot(s jsonb, fallback jsonb default null)
returns jsonb language sql immutable set search_path = pg_catalog as $$
  select s || jsonb_build_object(
    'committeeMembers',coalesce(s->'committeeMembers',fallback->'committeeMembers',sports_day_private.default_committee_members()),
    'committeeRotation',coalesce(s->'committeeRotation',fallback->'committeeRotation',sports_day_private.default_committee_rotation()),
    'equipmentReady',(sports_day_private.default_equipment_ready() ||
      coalesce(fallback->'equipmentReady','{}'::jsonb) || coalesce(s->'equipmentReady','{}'::jsonb)) - 'cold-packs',
    'equipmentColdPacksReady',coalesce(s->'equipmentColdPacksReady',s->'equipmentReady'->'cold-packs',
      fallback->'equipmentColdPacksReady',fallback->'equipmentReady'->'cold-packs','false'::jsonb));
$$;

-- Conflict/dependency units shared with the browser's semantic rebase model.
-- Ordered results are columns/divisions, never independently merged team cells.
create or replace function sports_day_private.shared_units(snapshot jsonb)
returns jsonb language plpgsql immutable set search_path = pg_catalog as $$
declare
  s jsonb := sports_day_private.canonical_public_snapshot(snapshot);
  units jsonb := '{}'::jsonb; item jsonb; column_value jsonb; other_finished jsonb;
  ids text[] := array['red','blue','yellow','green','white'];
  game text; department text; round_key text; person text; item_key text;
  names jsonb; assignments jsonb; i integer; r integer;
begin
  for i in 0..4 loop
    units := units || jsonb_build_object('team:'||ids[i+1]||':name',s->'teams'->i->'name',
      'team:'||ids[i+1]||':seed',s->'teams'->i->'seed');
  end loop;
  for department,names in select * from jsonb_each(s->'committeeMembers') loop
    for i in 0..jsonb_array_length(names)-1 loop
      units := units || jsonb_build_object('roster:'||department||':'||i,names->i);
    end loop;
  end loop;
  for item_key,item in select * from jsonb_each(s->'equipmentReady') loop
    units := units || jsonb_build_object('equipment:'||item_key,item);
  end loop;
  units := units || jsonb_build_object('equipment:cold-packs',s->'equipmentColdPacksReady');
  for round_key,assignments in select * from jsonb_each(s->'committeeRotation') loop
    for person,item in select * from jsonb_each(assignments) loop
      units := units || jsonb_build_object('rota:'||round_key||':'||person,item);
    end loop;
  end loop;
  units := units || jsonb_build_object('borrow:rounds',s->'borrow'->'rounds');
  foreach game in array array['borrow','relay'] loop
    for r in 0..case when game='borrow' then 6 else 2 end loop
      select jsonb_agg(value->r order by ordinal) into column_value
        from jsonb_array_elements(s->game->'scores') with ordinality cells(value,ordinal);
      units := units || jsonb_build_object(game||':'||r,column_value);
    end loop;
  end loop;
  for i in 0..4 loop
    for r in 0..1 loop
      item_key := 'basket:'||ids[i+1]||':'||r;
      units := units || jsonb_build_object(item_key,jsonb_build_object(
        'score',s->'basket'->'scores'->i->r,'finished',(s->'finished') ? item_key));
    end loop;
  end loop;
  foreach item_key in array array['women','men'] loop
    units := units || jsonb_build_object('cavalry:'||item_key,s->'cavalry'->'divisions'->item_key);
  end loop;
  units := units || jsonb_build_object('cavalry:config',jsonb_build_object(
    'division',s->'cavalry'->'division','cap',s->'cavalry'->'cap'),'tug',s->'tug',
    'timing',jsonb_build_object('timers',s->'timers','activeKey',s->'activeKey'));
  foreach game in array array['borrow','basket','cavalry','tug','relay'] loop
    units := units || jsonb_build_object('placements:'||game,s->'placements'->game);
  end loop;
  select coalesce(jsonb_agg(value order by ordinal),'[]'::jsonb) into other_finished
    from jsonb_array_elements(s->'finished') with ordinality items(value,ordinal)
    where (value #>> '{}') !~ '^basket:(red|blue|yellow|green|white):[01]$';
  return units || jsonb_build_object('finished-other',other_finished);
end;
$$;

-- These transitions invalidate all pending semantic actions, including ABA
-- cases where a reset later restores the same empty values as an old snapshot.
create or replace function sports_day_private.destructive_transition(before_state jsonb, after_state jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare
  a jsonb := sports_day_private.canonical_public_snapshot(before_state);
  b jsonb := sports_day_private.canonical_public_snapshot(after_state);
  ids text[] := array['red','blue','yellow','green','white'];
  game text; key text; division text; cell jsonb; old_clock jsonb; old_division jsonb; new_division jsonb;
  i integer; r integer;
begin
  if a->'borrow'->'rounds' is distinct from b->'borrow'->'rounds' then return true; end if;
  foreach game in array array['borrow','relay'] loop
    for i in 0..4 loop
      for r in 0..case when game='borrow' then 6 else 2 end loop
        cell := a->game->'scores'->i->r;
        if cell <> 'null'::jsonb and cell is distinct from b->game->'scores'->i->r then return true; end if;
      end loop;
    end loop;
  end loop;
  for cell in select value from jsonb_array_elements(a->'finished') loop
    if not ((b->'finished') ? (cell #>> '{}')) then return true; end if;
  end loop;
  for i in 0..4 loop
    for r in 0..1 loop
      key := 'basket:'||ids[i+1]||':'||r;
      cell := a->'basket'->'scores'->i->r;
      if (cell <> 'null'::jsonb and b->'basket'->'scores'->i->r = 'null'::jsonb)
        or (((a->'finished') ? key) and cell is distinct from b->'basket'->'scores'->i->r) then return true; end if;
    end loop;
  end loop;
  foreach division in array array['women','men'] loop
    old_division := a->'cavalry'->'divisions'->division;
    new_division := b->'cavalry'->'divisions'->division;
    if old_division->>'started'='true' and
      (new_division->>'started'<>'true' or old_division->'active' is distinct from new_division->'active') then return true; end if;
    if jsonb_array_length(new_division->'eliminated') < jsonb_array_length(old_division->'eliminated') then return true; end if;
    if jsonb_array_length(old_division->'eliminated') > 0 then
      for i in 0..jsonb_array_length(old_division->'eliminated')-1 loop
        if old_division->'eliminated'->i is distinct from new_division->'eliminated'->i then return true; end if;
      end loop;
    end if;
  end loop;
  foreach key in array array['prelim','semi1','semi2','final'] loop
    cell := a->'tug'->'winners'->key;
    if cell <> 'null'::jsonb and cell is distinct from b->'tug'->'winners'->key then return true; end if;
  end loop;
  if a->'tug'->>'locked'='true' and
    (b->'tug'->>'locked'<>'true' or a->'tug'->'slots' is distinct from b->'tug'->'slots') then return true; end if;
  for key,old_clock in select * from jsonb_each(a->'timers') loop
    if not ((b->'timers') ? key) or
      (old_clock->>'started'='true' and b->'timers'->key->>'started'<>'true') then return true; end if;
  end loop;
  return false;
end;
$$;

create table if not exists sports_day_private.event_sync_metadata (
  event_id text primary key references public.sports_day_events(id) on delete cascade,
  unit_versions jsonb not null check (jsonb_typeof(unit_versions)='object'),
  reset_revision bigint not null check (reset_revision >= 0)
);
create table if not exists sports_day_private.operations_v2 (
  event_id text not null references public.sports_day_events(id) on delete cascade,
  operation_id uuid not null,
  device_id uuid not null,
  expected_revision bigint not null check (expected_revision >= 0),
  snapshot jsonb not null,
  barrier boolean not null,
  applied_revision bigint not null check (applied_revision >= 0),
  primary key(event_id,operation_id)
);
alter table sports_day_private.event_sync_metadata enable row level security;
alter table sports_day_private.operations_v2 enable row level security;
revoke all on sports_day_private.event_sync_metadata, sports_day_private.operations_v2 from public, anon, authenticated;

insert into sports_day_private.event_sync_metadata(event_id,unit_versions,reset_revision)
  select e.id,(select jsonb_object_agg(key,to_jsonb(e.revision))
    from jsonb_each(sports_day_private.shared_units(e.public_state))),e.revision
  from public.sports_day_events e on conflict(event_id) do nothing;

create or replace function sports_day_private.reply(e public.sports_day_events, status text)
returns jsonb language sql volatile set search_path = pg_catalog as $$
  select jsonb_build_object('status',status,'public_state',sports_day_private.canonical_public_snapshot(e.public_state),
    'revision',e.revision,'server_ms',floor(extract(epoch from clock_timestamp())*1000)::bigint,
    'writer_id',e.writer_id,'lease_until',e.lease_until,'lease_revision',e.lease_revision,
    'editing_mode','shared-v1',
    'unit_versions',coalesce((select m.unit_versions from sports_day_private.event_sync_metadata m where m.event_id=e.id),
      (select jsonb_object_agg(key,to_jsonb(e.revision)) from jsonb_each(sports_day_private.shared_units(e.public_state)))),
    'reset_revision',coalesce((select m.reset_revision from sports_day_private.event_sync_metadata m where m.event_id=e.id),e.revision));
$$;

create or replace function public.authorize_sports_day_editor(p_event_id text, p_device_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare e public.sports_day_events;
begin
  if p_device_id is null then raise exception 'Invalid editor device.' using errcode='22023'; end if;
  select * into e from public.sports_day_events where id=p_event_id;
  if not found then raise exception 'Event is not configured.' using errcode='P0002'; end if;
  if auth.uid() is null or not exists (select 1 from sports_day_private.editors where event_id=p_event_id and editor_uid=auth.uid()) then
    raise exception 'This login is not the scorekeeper.' using errcode='42501';
  end if;
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

-- Cached single-writer clients must refresh rather than replacing snapshots or
-- claiming/releasing ownership under the previous lease protocol.
create or replace function public.claim_sports_day_writer(p_event_id text, p_writer_id uuid, p_transfer boolean default false)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare e public.sports_day_events;
begin
  select * into e from public.sports_day_events where id=p_event_id;
  if not found then raise exception 'Event is not configured.' using errcode='P0002'; end if;
  if auth.uid() is null or not exists (select 1 from sports_day_private.editors where event_id=p_event_id and editor_uid=auth.uid()) then
    raise exception 'This login is not the scorekeeper.' using errcode='42501';
  end if;
  return sports_day_private.reply(e,'upgrade_required');
end;
$$;
create or replace function public.release_sports_day_writer(p_event_id text, p_writer_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare e public.sports_day_events;
begin
  select * into e from public.sports_day_events where id=p_event_id;
  if not found then raise exception 'Event is not configured.' using errcode='P0002'; end if;
  if auth.uid() is null or not exists (select 1 from sports_day_private.editors where event_id=p_event_id and editor_uid=auth.uid()) then
    raise exception 'This login is not the scorekeeper.' using errcode='42501';
  end if;
  return sports_day_private.reply(e,'upgrade_required');
end;
$$;
create or replace function public.apply_sports_day_update(
  p_event_id text, p_writer_id uuid, p_expected_revision bigint, p_operation_id uuid, p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare e public.sports_day_events;
begin
  select * into e from public.sports_day_events where id=p_event_id;
  if not found then raise exception 'Event is not configured.' using errcode='P0002'; end if;
  if auth.uid() is null or not exists (select 1 from sports_day_private.editors where event_id=p_event_id and editor_uid=auth.uid()) then
    raise exception 'This login is not the scorekeeper.' using errcode='42501';
  end if;
  return sports_day_private.reply(e,'upgrade_required');
end;
$$;

revoke all on function sports_day_private.canonical_public_snapshot(jsonb,jsonb) from public, anon, authenticated;
revoke all on function sports_day_private.shared_units(jsonb) from public, anon, authenticated;
revoke all on function sports_day_private.destructive_transition(jsonb,jsonb) from public, anon, authenticated;
revoke all on function sports_day_private.reply(public.sports_day_events,text) from public, anon, authenticated;
revoke all on function public.authorize_sports_day_editor(text,uuid) from public, anon, authenticated;
revoke all on function public.apply_sports_day_patch(text,uuid,bigint,uuid,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.authorize_sports_day_editor(text,uuid) to authenticated;
grant execute on function public.apply_sports_day_patch(text,uuid,bigint,uuid,jsonb,boolean) to authenticated;
-- The previous RPC grants stay authenticated-only; their bodies are now inert.
commit;
