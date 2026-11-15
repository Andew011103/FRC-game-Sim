-- Drive Practice: accounts and match records.
-- Run this once in your Supabase project: SQL Editor, New query, paste, Run.
-- It is safe to run again.

-- One row per player: the name other players see.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 20),
  created_at timestamptz not null default now()
);

-- One row per finished multiplayer match, per player.
create table if not exists public.match_results (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  played_at timestamptz not null default now(),
  game text not null check (char_length(game) <= 40),
  alliance text not null check (alliance in ('blue', 'red')),
  robot text not null check (char_length(robot) between 1 and 40),
  -- Custom robots are recorded but will never count on leaderboards.
  official boolean not null default false,
  own_score integer not null check (own_score between 0 and 100000),
  other_score integer not null check (other_score between 0 and 100000),
  players integer not null check (players between 1 and 6)
);

create index if not exists match_results_user on public.match_results (user_id, played_at desc);

alter table public.profiles enable row level security;
alter table public.match_results enable row level security;

-- Names are public (for leaderboards later). Players can only write their own.
drop policy if exists "names are public" on public.profiles;
create policy "names are public" on public.profiles for select using (true);
drop policy if exists "players add their own name" on public.profiles;
create policy "players add their own name" on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists "players change their own name" on public.profiles;
create policy "players change their own name" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Players read and add only their own matches. Nobody can edit or delete one.
drop policy if exists "players read their own matches" on public.match_results;
create policy "players read their own matches" on public.match_results for select to authenticated using (user_id = auth.uid());
drop policy if exists "players add their own matches" on public.match_results;
create policy "players add their own matches" on public.match_results for insert to authenticated with check (user_id = auth.uid());
