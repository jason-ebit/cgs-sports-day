-- Shared committee roster migration for the existing Olympics event backend.
-- Intended project: brkvlskorwqbylhrvgbe. Run once in its Supabase SQL Editor;
-- rerunning is safe. No score, roster, revision, lease, editor or retry rows are
-- rewritten by this script, and no tables, policies or access grants are added.
-- Existing function privileges remain in place. Only the existing authenticated
-- scorekeeper RPC can write names; old clients retain the locked server roster.

begin;

do $$
begin
  if to_regclass('public.sports_day_events') is null
    or to_regprocedure('sports_day_private.exact_keys(jsonb,text[])') is null
    or to_regprocedure('public.apply_sports_day_update(text,uuid,bigint,uuid,jsonb)') is null then
    raise exception 'Install the existing sports day schema before this migration.';
  end if;
end;
$$;

create or replace function sports_day_private.default_committee_members()
returns jsonb language sql immutable set search_path = pg_catalog as $$
  select '{"director":[""],"judges":[""],"first-aid":["",""],"equipment":["","",""],"food-water":["","",""],"comms":["Cindy","Mario"],"team-leaders":["","","","",""],"warmup":[""]}'::jsonb;
$$;

create or replace function sports_day_private.valid_committee_members(m jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare
  departments text[] := array['director','judges','first-aid','equipment','food-water','comms','team-leaders','warmup'];
  slots integer[] := array[1,1,2,3,3,2,5,1];
  names jsonb; name jsonb; i integer;
begin
  if not sports_day_private.exact_keys(m,departments) then return false; end if;
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

create or replace function sports_day_private.valid_snapshot(s jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare
  team_names text[] := array['red','blue','yellow','green','white'];
  game_names text[] := array['borrow','basket','cavalry','tug','relay'];
  timer_pattern text := '^(event:([0-9]|1[0-5])|tug:(prelim|semi1|semi2|final)|borrow:[0-6]|basket:(red|blue|yellow|green|white):[01]|relay:[0-2]|cavalry:(women|men))$';
  item jsonb; row_value jsonb; cell jsonb; d jsonb; clock_value jsonb;
  game text; key text; division text; winner text; first_team text; second_team text;
  i integer; j integer; width integer; ceiling integer; running integer := 0;
begin
  if s is null or octet_length(s::text) > 131072 or not sports_day_private.exact_keys(s - 'committeeMembers',
    array['version','teams','tug','borrow','basket','relay','cavalry','placements','timers','finished','activeKey'])
    or s->'version' <> '1'::jsonb then return false; end if;
  if s ? 'committeeMembers' and not sports_day_private.valid_committee_members(s->'committeeMembers') then return false; end if;

  if jsonb_typeof(s->'teams') <> 'array' or jsonb_array_length(s->'teams') <> 5 then return false; end if;
  for i in 0..4 loop
    item := s->'teams'->i;
    if not sports_day_private.exact_keys(item,array['id','name','seed'])
      or item->>'id' is distinct from team_names[i+1] or jsonb_typeof(item->'name') <> 'string'
      or length(item->>'name') > 24 or length(btrim(item->>'name')) = 0
      or not sports_day_private.integer_in(item->'seed',1,5,true) then return false; end if;
  end loop;

  item := s->'tug';
  if not sports_day_private.exact_keys(item,array['slots','locked','winners'])
    or jsonb_typeof(item->'locked') <> 'boolean' or jsonb_typeof(item->'slots') <> 'array'
    or jsonb_array_length(item->'slots') <> 5
    or not sports_day_private.exact_keys(item->'winners',array['prelim','semi1','semi2','final']) then return false; end if;
  if exists (select 1 from jsonb_array_elements(item->'slots') slot
      where slot <> 'null'::jsonb and (jsonb_typeof(slot) <> 'string' or not (slot <@ '["red","blue","yellow","green","white"]'::jsonb)))
    or (select count(*) <> count(distinct slot) from jsonb_array_elements(item->'slots') slot where slot <> 'null'::jsonb)
    or (item->>'locked' = 'true' and (select count(*) from jsonb_array_elements(item->'slots') slot where slot <> 'null'::jsonb) <> 5)
    then return false; end if;
  foreach key in array array['prelim','semi1','semi2','final'] loop
    if item->'winners'->key <> 'null'::jsonb then
      if jsonb_typeof(item->'winners'->key) <> 'string' or item->>'locked' <> 'true' then return false; end if;
      winner := item->'winners'->>key;
      first_team := case key when 'prelim' then item->'slots'->>0 when 'semi1' then item->'slots'->>2
        when 'semi2' then item->'slots'->>3 else item->'winners'->>'semi1' end;
      second_team := case key when 'prelim' then item->'slots'->>1 when 'semi1' then item->'winners'->>'prelim'
        when 'semi2' then item->'slots'->>4 else item->'winners'->>'semi2' end;
      if first_team is null or second_team is null or winner not in (first_team,second_team) then return false; end if;
    end if;
  end loop;

  foreach game in array array['borrow','basket','relay'] loop
    item := s->game;
    if not sports_day_private.exact_keys(item,case when game = 'borrow' then array['rounds','scores'] else array['scores'] end)
      or jsonb_typeof(item->'scores') <> 'array' or jsonb_array_length(item->'scores') <> 5 then return false; end if;
    if game = 'borrow' and item->'rounds' not in ('6'::jsonb,'7'::jsonb) then return false; end if;
    width := case game when 'borrow' then 7 when 'basket' then 2 else 3 end;
    ceiling := case game when 'basket' then 999 else 5 end;
    for i in 0..4 loop
      row_value := item->'scores'->i;
      if jsonb_typeof(row_value) <> 'array' or jsonb_array_length(row_value) <> width then return false; end if;
      for j in 0..width-1 loop
        cell := row_value->j;
        if not sports_day_private.integer_in(cell,case when game = 'relay' then 1 else 0 end,ceiling,true)
          or (game = 'borrow' and cell = '1'::jsonb) then return false; end if;
      end loop;
    end loop;
    if game = 'relay' then
      for j in 0..2 loop
        if (select count(*) <> count(distinct score->j) from jsonb_array_elements(item->'scores') score where score->j <> 'null'::jsonb)
          then return false; end if;
      end loop;
    end if;
  end loop;

  item := s->'cavalry';
  if not sports_day_private.exact_keys(item,array['division','cap','divisions'])
    or jsonb_typeof(item->'division') <> 'string' or item->>'division' not in ('women','men')
    or not sports_day_private.integer_in(item->'cap',1,2700,true)
    or not sports_day_private.exact_keys(item->'divisions',array['women','men']) then return false; end if;
  foreach division in array array['women','men'] loop
    d := item->'divisions'->division;
    if not sports_day_private.exact_keys(d,array['active','eliminated','started'])
      or not sports_day_private.team_ids(d->'active') or not sports_day_private.team_ids(d->'eliminated')
      or jsonb_typeof(d->'started') <> 'boolean' or not ((d->'eliminated') <@ (d->'active'))
      or jsonb_array_length(d->'eliminated') > greatest(0,jsonb_array_length(d->'active')-1)
      or (d->>'started' = 'false' and jsonb_array_length(d->'eliminated') > 0)
      or (d->>'started' = 'true' and jsonb_array_length(d->'active') < 2) then return false; end if;
  end loop;

  if not sports_day_private.exact_keys(s->'placements',game_names) then return false; end if;
  foreach game in array game_names loop
    item := s->'placements'->game;
    if not sports_day_private.exact_keys(item,array['values','approved']) or jsonb_typeof(item->'approved') <> 'boolean'
      or jsonb_typeof(item->'values') <> 'array' or jsonb_array_length(item->'values') <> 5 then return false; end if;
    for cell in select value from jsonb_array_elements(item->'values') loop
      if not sports_day_private.integer_in(cell,1,5,true) then return false; end if;
    end loop;
    if (select count(*) <> count(distinct place) from jsonb_array_elements(item->'values') place where place <> 'null'::jsonb)
      then return false; end if;
  end loop;

  if jsonb_typeof(s->'timers') <> 'object' or (select count(*) from jsonb_object_keys(s->'timers')) > 50 then return false; end if;
  for key,clock_value in select * from jsonb_each(s->'timers') loop
    if key !~ timer_pattern or not sports_day_private.exact_keys(clock_value,array['duration','remaining','deadline','signature','started'])
      or not sports_day_private.integer_in(clock_value->'duration',0,86400000)
      or not sports_day_private.integer_in(clock_value->'remaining',0,86400000)
      or not sports_day_private.integer_in(clock_value->'deadline',1,9007199254740991,true)
      or jsonb_typeof(clock_value->'signature') <> 'string' or length(clock_value->>'signature') > 160
      or jsonb_typeof(clock_value->'started') <> 'boolean' then return false; end if;
    if clock_value->'deadline' <> 'null'::jsonb then
      running := running+1;
      if clock_value->>'started' <> 'true' then return false; end if;
    end if;
  end loop;
  if running > 1 or (s->'activeKey' <> 'null'::jsonb and
    (jsonb_typeof(s->'activeKey') <> 'string' or not (s->'timers' ? (s->>'activeKey')))) then return false; end if;

  if jsonb_typeof(s->'finished') <> 'array' or jsonb_array_length(s->'finished') > 10
    or (select count(*) <> count(distinct finished) from jsonb_array_elements(s->'finished') finished) then return false; end if;
  for cell in select value from jsonb_array_elements(s->'finished') loop
    key := cell #>> '{}';
    if jsonb_typeof(cell) <> 'string' or key !~ '^basket:(red|blue|yellow|green|white):[01]$'
      or s->'basket'->'scores'->(array_position(team_names,split_part(key,':',2))-1)->(split_part(key,':',3)::integer) = 'null'::jsonb
      then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create or replace function sports_day_private.reply(e public.sports_day_events, status text)
returns jsonb language sql volatile set search_path = pg_catalog as $$
  select jsonb_build_object('status',status,'public_state',case when e.public_state ? 'committeeMembers' then e.public_state
      else jsonb_set(e.public_state,'{committeeMembers}',sports_day_private.default_committee_members()) end,'revision',e.revision,
    'server_ms',floor(extract(epoch from clock_timestamp())*1000)::bigint,
    'writer_id',e.writer_id,'lease_until',e.lease_until,'lease_revision',e.lease_revision);
$$;

create or replace function public.apply_sports_day_update(
  p_event_id text, p_writer_id uuid, p_expected_revision bigint, p_operation_id uuid, p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare e public.sports_day_events; previous sports_day_private.operations;
begin
  if p_writer_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision < 0
    or not sports_day_private.valid_snapshot(p_snapshot) then
    raise exception 'Invalid public score update.' using errcode = '22023';
  end if;
  select * into e from public.sports_day_events where id = p_event_id for update;
  if not found then raise exception 'Event is not configured.' using errcode = 'P0002'; end if;
  if auth.uid() is null or not exists (select 1 from sports_day_private.editors where event_id = p_event_id and editor_uid = auth.uid()) then
    raise exception 'This login is not the scorekeeper.' using errcode = '42501';
  end if;
  select * into previous from sports_day_private.operations where event_id = p_event_id and operation_id = p_operation_id;
  if found then
    if previous.writer_id is distinct from p_writer_id or previous.snapshot is distinct from p_snapshot then
      raise exception 'An operation ID cannot be reused for another update.' using errcode = '22023';
    end if;
    if e.revision <> previous.revision then return sports_day_private.reply(e,'conflict'); end if;
    return sports_day_private.reply(e,'duplicate');
  end if;
  if e.writer_id is distinct from p_writer_id or e.lease_until is null or e.lease_until <= clock_timestamp() then
    return sports_day_private.reply(e,'lease_lost');
  end if;
  if e.revision <> p_expected_revision then return sports_day_private.reply(e,'conflict'); end if;
  -- Older scorekeeper tabs may still send the original eleven-key snapshot.
  -- Keep their score update, but never let an omitted roster erase new names.
  update public.sports_day_events set public_state = case when p_snapshot ? 'committeeMembers' then p_snapshot
      else jsonb_set(p_snapshot,'{committeeMembers}',coalesce(e.public_state->'committeeMembers',sports_day_private.default_committee_members())) end,
    revision = revision+1,
    updated_at = clock_timestamp(), lease_until = clock_timestamp()+interval '120 seconds'
    where id = p_event_id returning * into e;
  insert into sports_day_private.operations(event_id,operation_id,writer_id,snapshot,revision)
    values(p_event_id,p_operation_id,p_writer_id,p_snapshot,e.revision);
  return sports_day_private.reply(e,'applied');
end;
$$;

-- New helpers have no public execution permission. CREATE OR REPLACE preserves
-- the existing ACLs on valid_snapshot, reply and the scorekeeper update RPC.
revoke all on function sports_day_private.default_committee_members() from public, anon, authenticated;
revoke all on function sports_day_private.valid_committee_members(jsonb) from public, anon, authenticated;

commit;

-- Optional, read-only verification after applying:
-- select id, revision, lease_revision, writer_id, lease_until,
--   sports_day_private.valid_snapshot(public_state) as stored_snapshot_valid,
--   sports_day_private.reply(e,'check')->'public_state'->'committeeMembers' as committee_members
-- from public.sports_day_events e where id = 'cgs-oct25';
-- select sports_day_private.valid_committee_members(sports_day_private.default_committee_members()) as defaults_valid,
--   not sports_day_private.valid_committee_members('{}'::jsonb) as incomplete_roster_rejected,
--   not sports_day_private.valid_committee_members(sports_day_private.default_committee_members() || '{"director":[42]}'::jsonb) as nonstring_rejected;
-- select id, revision, lease_revision, writer_id, lease_until, updated_at,
--   md5(public_state::text) as stored_state_hash,
--   not sports_day_private.valid_snapshot(public_state || '{"notes":{"general":"private"}}'::jsonb) as private_notes_rejected,
--   not sports_day_private.valid_snapshot(public_state || jsonb_build_object('committeeMembers',sports_day_private.default_committee_members() || '{"comms":["Cindy",{"medical":"private"}]}'::jsonb)) as embedded_private_object_rejected
-- from public.sports_day_events where id = 'cgs-oct25';
-- select has_function_privilege('anon','sports_day_private.default_committee_members()','EXECUTE') as anon_helper_access,
--   has_function_privilege('authenticated','sports_day_private.valid_committee_members(jsonb)','EXECUTE') as authenticated_helper_access,
--   has_function_privilege('anon','public.apply_sports_day_update(text,uuid,bigint,uuid,jsonb)','EXECUTE') as anon_can_write;
