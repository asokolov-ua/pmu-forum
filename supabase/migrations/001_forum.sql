-- Run once in the Supabase SQL editor. All public access is denied.
create table public.forum_applications (
  id uuid primary key default gen_random_uuid(),
  submission_key uuid not null unique,
  kind text not null check (kind in ('participant','speaker')),
  email text not null,
  answers jsonb not null,
  status text not null default 'new' check (status in ('new','approved','reserve','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_by text,
  unique(kind,email),
  check ((answers->>'privacyConsent')::boolean is true),
  check (answers->>'photoConsent' in ('Так','Ні')),
  check (kind = 'speaker' or answers->>'age' in ('16–17 років','18–24 роки','25 років і більше'))
);
create table public.forum_status_history (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.forum_applications on delete cascade,
  previous_status text not null,
  status text not null,
  actor text not null,
  changed_at timestamptz not null default now()
);
create table public.forum_notifications (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.forum_applications on delete cascade,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  delivered_at timestamptz,
  telegram_message_id bigint
);
create table public.forum_rate_limits (
  key text primary key,
  window_started timestamptz not null default now(),
  attempts integer not null default 1
);
create table public.forum_review_actions (
  action_id text primary key,
  application_id uuid not null references public.forum_applications on delete cascade,
  processed_at timestamptz not null default now()
);
create index forum_applications_kind_created on public.forum_applications(kind,created_at);
create index forum_notifications_pending on public.forum_notifications(available_at) where delivered_at is null;
alter table public.forum_applications enable row level security;
alter table public.forum_status_history enable row level security;
alter table public.forum_notifications enable row level security;
alter table public.forum_rate_limits enable row level security;
alter table public.forum_review_actions enable row level security;
revoke all on public.forum_applications, public.forum_status_history, public.forum_notifications, public.forum_rate_limits, public.forum_review_actions from anon, authenticated;
grant all on public.forum_applications, public.forum_status_history, public.forum_notifications, public.forum_rate_limits, public.forum_review_actions to service_role;
grant usage, select on sequence public.forum_status_history_id_seq to service_role;

create function public.create_forum_application(p_key uuid,p_kind text,p_email text,p_answers jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare result uuid;
begin
  -- Serialize same-email submissions so a retry always returns the existing ID.
  perform pg_advisory_xact_lock(hashtextextended(p_kind || ':' || lower(trim(p_email)),0));
  select id into result from public.forum_applications where submission_key=p_key or (kind=p_kind and email=lower(trim(p_email))) limit 1;
  if result is not null then return result; end if;
  insert into public.forum_applications(submission_key,kind,email,answers) values(p_key,p_kind,lower(trim(p_email)),p_answers) returning id into result;
  insert into public.forum_notifications(application_id) values(result);
  return result;
end;
$$;
create function public.consume_forum_rate_limit(p_key text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare count integer;
begin
  delete from public.forum_rate_limits where window_started < now()-interval '1 day';
  insert into public.forum_rate_limits as r(key) values(p_key)
  on conflict(key) do update set attempts=case when r.window_started<now()-interval '1 minute' then 1 else r.attempts+1 end,
  window_started=case when r.window_started<now()-interval '1 minute' then now() else r.window_started end returning attempts into count;
  return count<=5;
end;
$$;
create function public.claim_forum_notifications(p_limit integer default 2) returns setof public.forum_notifications
language plpgsql security invoker set search_path = '' as $$
begin
  return query update public.forum_notifications set locked_until=now()+interval '2 minutes',attempts=attempts+1
  where id in (select id from public.forum_notifications where delivered_at is null and available_at<=now() and (locked_until is null or locked_until<now()) order by available_at for update skip locked limit least(greatest(p_limit,1),5)) returning *;
end;
$$;
create function public.update_forum_status(p_id uuid,p_status text,p_actor text,p_action_id text default null) returns void
language plpgsql security invoker set search_path = '' as $$
declare previous text;
begin
  if p_status not in ('new','approved','reserve','rejected') then raise exception 'Invalid status'; end if;
  select status into previous from public.forum_applications where id=p_id for update;
  if not found then raise exception 'Application missing'; end if;
  if p_action_id is not null then
    insert into public.forum_review_actions(action_id,application_id) values(p_action_id,p_id) on conflict do nothing;
    if not found then return; end if;
  end if;
  if previous=p_status then return; end if;
  update public.forum_applications set status=p_status,reviewed_by=p_actor,updated_at=now() where id=p_id;
  insert into public.forum_status_history(application_id,previous_status,status,actor) values(p_id,previous,p_status,p_actor);
end;
$$;
revoke execute on function public.create_forum_application(uuid,text,text,jsonb),public.consume_forum_rate_limit(text),public.claim_forum_notifications(integer),public.update_forum_status(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.create_forum_application(uuid,text,text,jsonb),public.consume_forum_rate_limit(text),public.claim_forum_notifications(integer),public.update_forum_status(uuid,text,text,text) to service_role;
