-- STARGATE KOI AI recommendation data model
create extension if not exists pgcrypto;

create table if not exists public.koi_problems (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'boj',
  external_id text not null,
  title text not null,
  competition text,
  year integer,
  division text,
  round text,
  problem_no integer,
  difficulty integer check (difficulty between 1 and 5),
  tags text[] not null default '{}',
  level text[] not null default '{}',
  source_url text not null,
  summary text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source, external_id)
);

create table if not exists public.koi_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  problem_id uuid not null references public.koi_problems(id) on delete cascade,
  status text not null check (status in ('opened','attempted','solved','review')),
  is_correct boolean,
  elapsed_seconds integer check (elapsed_seconds is null or elapsed_seconds >= 0),
  weak_tags text[] not null default '{}',
  note text,
  attempted_at timestamptz not null default now()
);

create table if not exists public.koi_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  problem_id uuid not null references public.koi_problems(id) on delete cascade,
  score numeric(6,5) not null check (score >= 0 and score <= 1),
  reason jsonb not null default '{}'::jsonb,
  model text not null default 'hf-multilingual-minilm',
  recommended_at timestamptz not null default now()
);

create index if not exists koi_problems_tags_gin on public.koi_problems using gin(tags);
create index if not exists koi_problems_level_gin on public.koi_problems using gin(level);
create index if not exists koi_attempts_user_date on public.koi_attempts(user_id, attempted_at desc);
create index if not exists koi_recommendations_user_date on public.koi_recommendations(user_id, recommended_at desc);

alter table public.koi_problems enable row level security;
alter table public.koi_attempts enable row level security;
alter table public.koi_recommendations enable row level security;

create policy "public read active koi problems" on public.koi_problems
for select using (active = true);

create policy "users read own koi attempts" on public.koi_attempts
for select using (auth.uid() = user_id);
create policy "users insert own koi attempts" on public.koi_attempts
for insert with check (auth.uid() = user_id);
create policy "users update own koi attempts" on public.koi_attempts
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "users read own koi recommendations" on public.koi_recommendations
for select using (auth.uid() = user_id);
create policy "users insert own koi recommendations" on public.koi_recommendations
for insert with check (auth.uid() = user_id);

-- Verified KOI metadata only. Problem statements are intentionally not copied.
insert into public.koi_problems
(source, external_id, title, competition, year, division, round, problem_no, difficulty, tags, level, source_url, summary)
values
('boj','32068','보물 찾기','한국정보올림피아드',2024,'초등부','2차대회',1,1,array['구현','수학','시뮬레이션'],array['L1','L2'],'https://www.acmicpc.net/problem/32068','KOI 2024 2차 초등부 1번. 구현과 규칙 관찰 중심 입문 문제.'),
('boj','32074','점수 경주','한국정보올림피아드',2024,'고등부','2차대회',4,5,array['그래프','트리','고급알고리즘'],array['L3','L5'],'https://www.acmicpc.net/problem/32074','KOI 2024 2차 고등부 4번. 고급 그래프/트리 사고 훈련용.'),
('boj','28216','아이템 획득','한국정보올림피아드',2023,'초등부','1차대회',3,3,array['자료구조','좌표','쿼리'],array['L2','L3'],'https://www.acmicpc.net/problem/28216','KOI 2023 1차 초등부 3번. 좌표와 질의를 효율적으로 처리하는 문제.'),
('boj','28323','불안정한 수열','한국정보올림피아드',2023,'초등부','2차대회',1,2,array['그리디','수열','짝홀성'],array['L1','L2'],'https://www.acmicpc.net/problem/28323','KOI 2023 2차 초등부 1번. 수열의 성질을 관찰해 최대 선택을 구성하는 문제.')
on conflict (source, external_id) do update set
  title = excluded.title,
  competition = excluded.competition,
  year = excluded.year,
  division = excluded.division,
  round = excluded.round,
  problem_no = excluded.problem_no,
  difficulty = excluded.difficulty,
  tags = excluded.tags,
  level = excluded.level,
  source_url = excluded.source_url,
  summary = excluded.summary,
  active = true,
  updated_at = now();