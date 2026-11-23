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

-- Tells Supabase's API about new tables and functions straight away.
notify pgrst, 'reload schema';

-- Added with the Drive Pass's ranking points: the bonus ranking points
-- (Energized, Supercharged, Traversal) each multiplayer match earned.
alter table public.match_results add column if not exists bonus_rp integer not null default 0 check (bonus_rp between 0 and 3);
notify pgrst, 'reload schema';

-- Added with the leaderboards. Each row is one timed singleplayer run with an
-- official robot, by a signed-in player, in a Drive Pass season. Anyone can
-- read the runs; a player can only add their own. Ranking is done here, by
-- each player's best run, so a list can never be padded with one player's runs.
create table if not exists public.leaderboard_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  season_id text not null check (length(season_id) between 1 and 80),
  robot_id text not null check (length(robot_id) between 1 and 80),
  score integer not null check (score between 0 and 5000),
  played_at timestamptz not null default now()
);
create index if not exists leaderboard_runs_board on public.leaderboard_runs (season_id, robot_id, score desc);
alter table public.leaderboard_runs enable row level security;
drop policy if exists "runs are public" on public.leaderboard_runs;
create policy "runs are public" on public.leaderboard_runs for select using (true);
drop policy if exists "players add their own runs" on public.leaderboard_runs;
create policy "players add their own runs" on public.leaderboard_runs for insert to authenticated with check (user_id = auth.uid());

-- Ranking Points for a first top-3 place in a season's overall board, once a season.
-- Only the function below can add one, after checking the place itself.
create table if not exists public.season_awards (
  user_id uuid not null references auth.users (id) on delete cascade,
  season_id text not null check (length(season_id) between 1 and 80),
  place integer not null check (place between 1 and 3),
  rp integer not null check (rp in (10, 12, 15)),
  awarded_at timestamptz not null default now(),
  primary key (user_id, season_id)
);
alter table public.season_awards enable row level security;
drop policy if exists "awards are public" on public.season_awards;
create policy "awards are public" on public.season_awards for select using (true);

-- A board: each player's best run (for one robot, or any robot when p_robot is null), top 20.
create or replace function public.leaderboard(p_season text, p_robot text)
returns table (place bigint, user_id uuid, display_name text, name_color text, badge text, robot_id text, score integer, played_at timestamptz)
language sql stable security definer set search_path = public as $$
  with best as (
    select distinct on (r.user_id) r.user_id, r.robot_id, r.score, r.played_at
    from public.leaderboard_runs r
    where r.season_id = p_season and (p_robot is null or r.robot_id = p_robot)
    order by r.user_id, r.score desc, r.played_at asc
  )
  select rank() over (order by b.score desc, b.played_at asc), b.user_id, coalesce(p.display_name, 'Driver'),
         p.preferences -> 'settings' ->> 'nameColor', p.preferences -> 'settings' ->> 'badge', b.robot_id, b.score, b.played_at
  from best b left join public.profiles p on p.id = b.user_id
  order by b.score desc, b.played_at asc
  limit 20;
$$;

-- Where a player stands on every board of a season: each robot's, and the overall one (robot_id null).
create or replace function public.player_rankings(p_user uuid, p_season text)
returns table (robot_id text, place bigint, score integer)
language sql stable security definer set search_path = public as $$
  with best as (
    select distinct on (r.user_id, r.robot_id) r.user_id, r.robot_id, r.score, r.played_at
    from public.leaderboard_runs r where r.season_id = p_season
    order by r.user_id, r.robot_id, r.score desc, r.played_at asc
  ), per_robot as (
    select b.user_id, b.robot_id, b.score, rank() over (partition by b.robot_id order by b.score desc, b.played_at asc) as place from best b
  ), overall_best as (
    select distinct on (b.user_id) b.user_id, b.score, b.played_at from best b order by b.user_id, b.score desc, b.played_at asc
  ), overall as (
    select o.user_id, null::text as robot_id, o.score, rank() over (order by o.score desc, o.played_at asc) as place from overall_best o
  )
  select robot_id, place, score from per_robot where user_id = p_user and place <= 20
  union all
  select robot_id, place, score from overall where user_id = p_user and place <= 20;
$$;

-- Called after a run: if the player is now in the season's overall top 3 for the first time, they are given its points.
create or replace function public.claim_top3(p_season text)
returns integer language plpgsql security definer set search_path = public as $$
declare my_place bigint; points integer;
begin
  if auth.uid() is null then return 0; end if;
  if exists (select 1 from public.season_awards where user_id = auth.uid() and season_id = p_season) then return 0; end if;
  select place into my_place from public.player_rankings(auth.uid(), p_season) where robot_id is null;
  if my_place is null or my_place > 3 then return 0; end if;
  points := case my_place when 1 then 15 when 2 then 12 else 10 end;
  insert into public.season_awards (user_id, season_id, place, rp) values (auth.uid(), p_season, my_place, points)
  on conflict do nothing;
  return points;
end $$;

grant execute on function public.leaderboard(text, text) to anon, authenticated;
grant execute on function public.player_rankings(uuid, text) to anon, authenticated;
grant execute on function public.claim_top3(text) to authenticated;
notify pgrst, 'reload schema';
