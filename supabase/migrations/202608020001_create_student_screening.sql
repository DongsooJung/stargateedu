create table if not exists public.student_screening_batches (
  batch_id text primary key,
  source text not null,
  mode text not null check (mode in ('demo', 'authorized')),
  screened_at timestamptz not null,
  next_run_at timestamptz not null,
  candidate_count integer not null check (candidate_count between 0 and 100),
  priority_count integer not null default 0,
  review_count integer not null default 0,
  hold_count integer not null default 0,
  average_score integer not null default 0 check (average_score between 0 and 100),
  raw_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.student_screening_candidates (
  batch_id text not null references public.student_screening_batches(batch_id) on delete cascade,
  external_id text not null,
  rank integer not null check (rank between 1 and 100),
  display_name text not null,
  school_level text not null,
  subject text not null,
  goal text not null,
  region text not null,
  weekly_sessions integer not null check (weekly_sessions between 1 and 7),
  budget_monthly integer not null check (budget_monthly >= 0),
  schedule_fit integer not null check (schedule_fit between 0 and 100),
  guardian_verified boolean not null default false,
  remote boolean not null default false,
  requested_at timestamptz not null,
  request_age_days integer not null check (request_age_days >= 0),
  score integer not null check (score between 0 and 100),
  status text not null check (status in ('priority', 'review', 'hold')),
  profile_url text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (batch_id, external_id)
);

create index if not exists student_screening_batches_screened_at_idx
  on public.student_screening_batches (screened_at desc);

create index if not exists student_screening_candidates_score_idx
  on public.student_screening_candidates (batch_id, score desc);

alter table public.student_screening_batches enable row level security;
alter table public.student_screening_candidates enable row level security;

revoke all on table public.student_screening_batches from anon, authenticated;
revoke all on table public.student_screening_candidates from anon, authenticated;
grant select, insert, update, delete on table public.student_screening_batches to service_role;
grant select, insert, update, delete on table public.student_screening_candidates to service_role;

