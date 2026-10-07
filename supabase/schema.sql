-- CG Sports Day: one signed-in scorekeeper, public read-only scores.
-- 1. In Authentication > Users, create your scorekeeper email and set a
--    password yourself. Do not put that password or a secret key in this app.
-- 2. Run this complete script once in the Supabase SQL Editor.
-- Replace SCOREKEEPER_EMAIL_HERE in the final block before running.
-- Re-running preserves scores and revisions. The final block grants this user
-- scorekeeping access to cgs-oct25; it fails clearly if the user is missing.

begin;

create schema if not exists sports_day_private;
revoke all on schema sports_day_private from public, anon, authenticated;

create or replace function sports_day_private.exact_keys(value jsonb, keys text[])
returns boolean language sql immutable set search_path = pg_catalog as $$
  select case when jsonb_typeof(value) = 'object' then
    value ?& keys and not exists (
      select 1 from jsonb_object_keys(value) k where not (k = any(keys))
    ) else false end;
$$;

create or replace function sports_day_private.integer_in(value jsonb, low numeric, high numeric, nullable boolean default false)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare n numeric;
begin
  if value = 'null'::jsonb then return nullable; end if;
  if value is null or jsonb_typeof(value) <> 'number' then return false; end if;
  n := value::text::numeric;
  return n = trunc(n) and n >= low and n <= high;
exception when others then return false;
end;
$$;

create or replace function sports_day_private.team_ids(value jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
begin
  if jsonb_typeof(value) <> 'array' or jsonb_array_length(value) > 5 then return false; end if;
  return not exists (select 1 from jsonb_array_elements(value) id
    where jsonb_typeof(id) <> 'string' or not (id <@ '["red","blue","yellow","green","white"]'::jsonb))
    and (select count(*) = count(distinct id) from jsonb_array_elements(value) id);
exception when others then return false;
end;
$$;

-- Strictly validate every public leaf. Private notes, leaders, headcounts and
-- rule text are rejected, including when hidden inside an otherwise valid field.
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
  if s is null or octet_length(s::text) > 131072 or not sports_day_private.exact_keys(s,
    array['version','teams','tug','borrow','basket','relay','cavalry','placements','timers','finished','activeKey'])
    or s->'version' <> '1'::jsonb then return false; end if;

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

create table if not exists public.sports_day_events (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  public_state jsonb not null check (sports_day_private.valid_snapshot(public_state)),
  revision bigint not null default 0 check (revision >= 0),
  lease_revision bigint not null default 0 check (lease_revision >= 0),
  writer_id uuid,
  lease_until timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  check ((writer_id is null) = (lease_until is null))
);

-- Ownership has its own ordering counter: a transfer does not change scores.
-- Keep schema reruns compatible with an already-created event table.
alter table public.sports_day_events add column if not exists lease_revision bigint
  not null default 0 check (lease_revision >= 0);

create table if not exists sports_day_private.operations (
  event_id text not null references public.sports_day_events(id) on delete cascade,
  operation_id uuid not null,
  writer_id uuid not null,
  snapshot jsonb not null,
  revision bigint not null,
  primary key (event_id,operation_id)
);

create table if not exists sports_day_private.editors (
  event_id text primary key references public.sports_day_events(id) on delete cascade,
  editor_uid uuid not null references auth.users(id) on delete cascade
);

alter table public.sports_day_events enable row level security;
drop policy if exists sports_day_public_read on public.sports_day_events;
create policy sports_day_public_read on public.sports_day_events for select to anon, authenticated using (true);
revoke all on public.sports_day_events from public, anon, authenticated;
grant select on public.sports_day_events to anon, authenticated;
revoke all on all tables in schema sports_day_private from public, anon, authenticated;

create or replace function sports_day_private.reply(e public.sports_day_events, status text)
returns jsonb language sql volatile set search_path = pg_catalog as $$
  select jsonb_build_object('status',status,'public_state',e.public_state,'revision',e.revision,
    'server_ms',floor(extract(epoch from clock_timestamp())*1000)::bigint,
    'writer_id',e.writer_id,'lease_until',e.lease_until,'lease_revision',e.lease_revision);
$$;

create or replace function public.read_sports_day_event(p_event_id text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare e public.sports_day_events;
begin
  select * into e from public.sports_day_events where id = p_event_id;
  if not found then raise exception 'Event is not configured.' using errcode = 'P0002'; end if;
  return sports_day_private.reply(e,'ready');
end;
$$;

create or replace function public.claim_sports_day_writer(p_event_id text, p_writer_id uuid, p_transfer boolean default false)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare e public.sports_day_events;
begin
  if p_writer_id is null or p_transfer is null then raise exception 'Invalid writer request.' using errcode = '22023'; end if;
  select * into e from public.sports_day_events where id = p_event_id for update;
  if not found then raise exception 'Event is not configured.' using errcode = 'P0002'; end if;
  if auth.uid() is null or not exists (select 1 from sports_day_private.editors where event_id = p_event_id and editor_uid = auth.uid()) then
    raise exception 'This login is not the scorekeeper.' using errcode = '42501';
  end if;
  -- Expiry stops writes but never silently transfers ownership. This prevents a
  -- disconnected previous phone from reclaiming after another phone takes over.
  if not p_transfer and e.writer_id is not null and e.writer_id is distinct from p_writer_id then
    return sports_day_private.reply(e,'busy');
  end if;
  update public.sports_day_events set lease_revision = lease_revision + case when writer_id is distinct from p_writer_id then 1 else 0 end,
    writer_id = p_writer_id, lease_until = clock_timestamp()+interval '120 seconds'
    where id = p_event_id returning * into e;
  return sports_day_private.reply(e,'claimed');
end;
$$;

create or replace function public.release_sports_day_writer(p_event_id text, p_writer_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare e public.sports_day_events;
begin
  select * into e from public.sports_day_events where id = p_event_id for update;
  if not found then raise exception 'Event is not configured.' using errcode = 'P0002'; end if;
  if auth.uid() is null or not exists (select 1 from sports_day_private.editors where event_id = p_event_id and editor_uid = auth.uid()) then
    raise exception 'This login is not the scorekeeper.' using errcode = '42501';
  end if;
  if p_writer_id is null or e.writer_id is distinct from p_writer_id then return sports_day_private.reply(e,'lease_lost'); end if;
  update public.sports_day_events set writer_id = null, lease_until = null, lease_revision = lease_revision+1
    where id = p_event_id returning * into e;
  return sports_day_private.reply(e,'released');
end;
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
  update public.sports_day_events set public_state = p_snapshot, revision = revision+1,
    updated_at = clock_timestamp(), lease_until = clock_timestamp()+interval '120 seconds'
    where id = p_event_id returning * into e;
  insert into sports_day_private.operations(event_id,operation_id,writer_id,snapshot,revision)
    values(p_event_id,p_operation_id,p_writer_id,p_snapshot,e.revision);
  return sports_day_private.reply(e,'applied');
end;
$$;

revoke all on all functions in schema sports_day_private from public, anon, authenticated;
revoke all on function public.read_sports_day_event(text) from public, anon, authenticated;
grant execute on function public.read_sports_day_event(text) to anon, authenticated;
revoke all on function public.claim_sports_day_writer(text,uuid,boolean) from public, anon, authenticated;
revoke all on function public.release_sports_day_writer(text,uuid) from public, anon, authenticated;
revoke all on function public.apply_sports_day_update(text,uuid,bigint,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.claim_sports_day_writer(text,uuid,boolean) to authenticated;
grant execute on function public.release_sports_day_writer(text,uuid) to authenticated;
grant execute on function public.apply_sports_day_update(text,uuid,bigint,uuid,jsonb) to authenticated;

-- Public table contains only public state and device lease metadata. Private
-- editor UUIDs and retry records never enter the Realtime publication.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename = 'sports_day_events') then
    alter publication supabase_realtime add table public.sports_day_events;
  end if;
end;
$$;

-- This is the only setup-specific value. Nothing in this script puts login
-- credentials into the website. Reruns preserve the event's existing snapshot.
do $$
declare editor uuid; initial jsonb;
begin
  select id into editor from auth.users where lower(email) = lower('SCOREKEEPER_EMAIL_HERE');
  if editor is null then raise exception 'Create the scorekeeper in Authentication > Users first and replace SCOREKEEPER_EMAIL_HERE, then run this script again.'; end if;
  initial := '{
    "version":1,
    "teams":[{"id":"red","name":"Red","seed":1},{"id":"blue","name":"Blue","seed":2},{"id":"yellow","name":"Yellow","seed":3},{"id":"green","name":"Green","seed":4},{"id":"white","name":"White","seed":5}],
    "tug":{"slots":[null,null,null,null,null],"locked":false,"winners":{"prelim":null,"semi1":null,"semi2":null,"final":null}},
    "borrow":{"rounds":6,"scores":[[null,null,null,null,null,null,null],[null,null,null,null,null,null,null],[null,null,null,null,null,null,null],[null,null,null,null,null,null,null],[null,null,null,null,null,null,null]]},
    "basket":{"scores":[[null,null],[null,null],[null,null],[null,null],[null,null]]},
    "relay":{"scores":[[null,null,null],[null,null,null],[null,null,null],[null,null,null],[null,null,null]]},
    "cavalry":{"division":"women","cap":null,"divisions":{"women":{"active":[],"eliminated":[],"started":false},"men":{"active":[],"eliminated":[],"started":false}}},
    "placements":{"borrow":{"values":[null,null,null,null,null],"approved":false},"basket":{"values":[null,null,null,null,null],"approved":false},"cavalry":{"values":[null,null,null,null,null],"approved":false},"tug":{"values":[null,null,null,null,null],"approved":false},"relay":{"values":[null,null,null,null,null],"approved":false}},
    "timers":{},"finished":[],"activeKey":null
  }'::jsonb;
  insert into public.sports_day_events(id,public_state) values('cgs-oct25',initial)
    on conflict(id) do nothing;
  insert into sports_day_private.editors(event_id,editor_uid) values('cgs-oct25',editor)
    on conflict(event_id) do update set editor_uid = excluded.editor_uid;
end;
$$;

commit;
