-- Journal entries: each user can only see and change their own.
create table public.entries (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  data jsonb not null
);

create index entries_user_created on public.entries (user_id, created_at desc);

alter table public.entries enable row level security;

create policy "Read own entries" on public.entries
  for select to authenticated using (user_id = auth.uid());
create policy "Add own entries" on public.entries
  for insert to authenticated with check (user_id = auth.uid());
create policy "Update own entries" on public.entries
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Delete own entries" on public.entries
  for delete to authenticated using (user_id = auth.uid());

-- Daily AI usage per user, so nobody can run up the Claude bill.
-- Only the server (service role) touches this table.
create table public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  calls int not null default 0,
  primary key (user_id, day)
);

alter table public.ai_usage enable row level security;

-- Counts one AI call; returns false once the user hits today's limit.
create function public.use_ai_call(p_user uuid, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  insert into public.ai_usage (user_id, day, calls)
  values (p_user, current_date, 1)
  on conflict (user_id, day) do update set calls = public.ai_usage.calls + 1
  returning calls into n;
  return n <= p_limit;
end;
$$;

revoke all on function public.use_ai_call(uuid, int) from public, anon, authenticated;
