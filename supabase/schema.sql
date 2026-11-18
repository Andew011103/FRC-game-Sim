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

-- Added with the player record screen. Singleplayer matches are recorded too,
-- and multiplayer matches record the points the player's own robot scored.
alter table public.match_results add column if not exists kind text not null default 'multi' check (kind in ('multi', 'single'));
alter table public.match_results add column if not exists solo_score integer check (solo_score between 0 and 100000);

-- Records are public, so any player's record card can be shown. Adding a match is still only for its own player.
drop policy if exists "players read their own matches" on public.match_results;
drop policy if exists "match records are public" on public.match_results;
create policy "match records are public" on public.match_results for select using (true);

-- Added so a player's chosen robot and settings follow them to any device.
alter table public.profiles add column if not exists preferences jsonb check (pg_column_size(preferences) < 20000);

-- Added with the list of open matches. A host lists its room here so other
-- players can find it. Nobody reads or writes the table directly: the three
-- functions below do, and only whoever holds a room's secret (its host, or
-- the player who takes it over) can change or remove its entry. Entries
-- not refreshed for a minute are left out of the list and cleared away.
create table if not exists public.open_rooms (
  code text primary key check (code ~ '^[A-Z]{5}$'),
  secret text not null check (length(secret) between 8 and 64),
  host_name text not null check (length(host_name) between 1 and 20),
  players integer not null default 0 check (players between 0 and 6),
  spectators integer not null default 0 check (spectators between 0 and 16),
  playing boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.open_rooms enable row level security;
revoke all on public.open_rooms from anon, authenticated;

create or replace function public.put_room(
  p_code text, p_secret text, p_host text, p_players integer, p_spectators integer, p_playing boolean
) returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.open_rooms where updated_at < now() - interval '2 minutes';
  insert into public.open_rooms (code, secret, host_name, players, spectators, playing, updated_at)
  values (p_code, p_secret, p_host, p_players, p_spectators, p_playing, now())
  on conflict (code) do update
    set host_name = excluded.host_name, players = excluded.players, spectators = excluded.spectators,
        playing = excluded.playing, updated_at = now()
    where open_rooms.secret = excluded.secret;
end $$;

create or replace function public.drop_room(p_code text, p_secret text)
returns void language sql security definer set search_path = public as $$
  delete from public.open_rooms where code = p_code and secret = p_secret;
$$;

create or replace function public.open_rooms()
returns table (code text, host_name text, players integer, spectators integer, playing boolean)
language sql stable security definer set search_path = public as $$
  select code, host_name, players, spectators, playing from public.open_rooms
  where updated_at > now() - interval '1 minute'
  order by playing, updated_at desc
  limit 50;
$$;

grant execute on function public.put_room(text, text, text, integer, integer, boolean) to anon, authenticated;
grant execute on function public.drop_room(text, text) to anon, authenticated;
grant execute on function public.open_rooms() to anon, authenticated;
