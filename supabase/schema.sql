create extension if not exists "pgcrypto";

create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  destination text not null,
  days int not null check (days >= 1 and days <= 14),
  budget numeric not null check (budget > 0),
  interests text[] not null default '{}',
  pace text not null check (pace in ('relaxed', 'balanced', 'packed')),
  created_at timestamptz not null default now()
);

create table if not exists itinerary_versions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  style text not null check (style in ('explorer', 'comfort', 'foodie')),
  summary text not null,
  total_estimated_budget numeric not null,
  created_at timestamptz not null default now()
);

create table if not exists itinerary_days (
  id uuid primary key default gen_random_uuid(),
  itinerary_version_id uuid not null references itinerary_versions(id) on delete cascade,
  day_number int not null check (day_number >= 1),
  theme text not null,
  daily_budget numeric not null
);

create table if not exists itinerary_items (
  id uuid primary key default gen_random_uuid(),
  itinerary_day_id uuid not null references itinerary_days(id) on delete cascade,
  start_time text not null,
  end_time text not null,
  place_kind text not null check (place_kind in ('attraction', 'restaurant')),
  place_id text not null,
  place_name text not null,
  estimated_cost numeric not null,
  notes text not null
);
