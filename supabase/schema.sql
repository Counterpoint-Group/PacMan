-- COUNTERPOINT PAC-MAN ARCADE — database schema
-- Run this once in the Supabase SQL editor. Supabase is used ONLY as PostgreSQL (no Supabase Auth).

create table if not exists public.players (
  id              uuid primary key default gen_random_uuid(),
  employee_number integer unique,
  name            text not null,
  player_code     text not null,
  department      text,
  high_score      integer not null default 0 check (high_score >= 0),
  highest_level   integer not null default 0 check (highest_level >= 0),
  best_difficulty text check (best_difficulty in ('EASY', 'OK OK', 'NIGHTMARE')),
  total_games     integer not null default 0 check (total_games >= 0),
  last_played     timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists public.game_history (
  id               uuid primary key default gen_random_uuid(),
  player_id        uuid not null references public.players (id) on delete cascade,
  score            integer not null check (score >= 0),
  level_reached    integer not null check (level_reached >= 1),
  difficulty       text not null check (difficulty in ('EASY', 'OK OK', 'NIGHTMARE')),
  pellets_eaten    integer not null default 0 check (pellets_eaten >= 0),
  ghosts_eaten     integer not null default 0 check (ghosts_eaten >= 0),
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  played_at        timestamptz not null default now(),
  -- Set by the game so that pressing "TRY AGAIN" after a network error can never save a game twice.
  client_game_id   uuid unique
);

create index if not exists players_high_score_idx     on public.players (high_score desc);
create index if not exists players_highest_level_idx  on public.players (highest_level desc);
-- Workshop usernames are unique regardless of capitalization or surrounding spaces.
-- This index also protects against two simultaneous sign-ups choosing the same name.
create unique index if not exists players_name_unique_ci on public.players (lower(btrim(name)));
create index if not exists game_history_player_idx    on public.game_history (player_id);
create index if not exists game_history_played_at_idx on public.game_history (played_at desc);
create index if not exists game_history_diff_score_idx on public.game_history (difficulty, score desc);

-- SECURITY: the browser never talks to Supabase. Only the Next.js server (service role key) can read/write.
-- Enabling RLS with no policies means the public "anon" key can read nothing, even if it leaked.
alter table public.players      enable row level security;
alter table public.game_history enable row level security;
revoke all on public.players      from anon, authenticated;
revoke all on public.game_history from anon, authenticated;
