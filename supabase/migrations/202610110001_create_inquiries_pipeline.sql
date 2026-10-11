-- 통합 상담 문의 파이프라인
-- 모든 사이트(포털 /consult/, 홈페이지, LP, 블로그)의 문의를 한 테이블에 모읍니다.
-- 쓰기: Edge Function `inquiry`(service_role)만 가능
-- 읽기·상태 변경: inquiry_admins 에 등록된 이메일로 로그인한 관리자만 가능

-- 1) 관리자 허용 목록 -------------------------------------------------------
create table if not exists public.inquiry_admins (
  email      text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);
alter table public.inquiry_admins enable row level security;
revoke all on public.inquiry_admins from anon, authenticated;

insert into public.inquiry_admins (email) values
  ('ceo@stargateedu.co.kr'),
  ('jds068888@gmail.com')
on conflict do nothing;

create or replace function public.is_inquiry_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.inquiry_admins
     where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke execute on function public.is_inquiry_admin() from public, anon;
grant execute on function public.is_inquiry_admin() to authenticated;

-- 2) 문의 테이블 ------------------------------------------------------------
create table if not exists public.inquiries (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  category           text not null check (category in ('koi','math','ai_dev','publishing','partnership','other')),
  name               text not null check (char_length(name) between 1 and 40),
  phone              text not null check (phone ~ '^0[0-9]{8,10}$'),
  email              text check (email is null or char_length(email) <= 120),
  student_grade      text check (student_grade is null or char_length(student_grade) <= 20),
  preferred_time     text check (preferred_time is null or char_length(preferred_time) <= 60),
  message            text not null check (char_length(message) between 1 and 2000),

  is_guardian        boolean not null default false,
  consent_at         timestamptz not null,
  marketing_ok       boolean not null default false,

  source_site        text not null default 'unknown',   -- homepage / portal / lp / blog ...
  provider           text,                              -- direct / kakao / naver (간편 시작)
  utm                jsonb not null default '{}'::jsonb,
  referrer           text,
  page               text,

  score              int,                               -- 적합성 100점
  grade              text,                              -- S/A/B/C/D
  status             text not null default 'new'
                     check (status in ('new','contacted','consulted','enrolled','closed','spam')),
  owner_memo         text check (owner_memo is null or char_length(owner_memo) <= 2000),
  first_contacted_at timestamptz,
  notified           boolean not null default false,

  ip_hash            text,
  user_agent         text
);

create index if not exists inquiries_created_idx on public.inquiries (created_at desc);
create index if not exists inquiries_status_idx  on public.inquiries (status, created_at desc);
create index if not exists inquiries_ip_idx      on public.inquiries (ip_hash, created_at desc);

alter table public.inquiries enable row level security;
revoke all on public.inquiries from anon, authenticated;
grant select on public.inquiries to authenticated;
grant update (status, owner_memo) on public.inquiries to authenticated;  -- 관리자도 이 두 칸만 수정 가능

drop policy if exists inquiries_admin_select on public.inquiries;
create policy inquiries_admin_select on public.inquiries
  for select to authenticated using ((select public.is_inquiry_admin()));

drop policy if exists inquiries_admin_update on public.inquiries;
create policy inquiries_admin_update on public.inquiries
  for update to authenticated
  using ((select public.is_inquiry_admin()))
  with check ((select public.is_inquiry_admin()));

-- 3) 적합성 점수 (김과외 리드 기준 100점 = 수익성30 + 지역매치20 + 전문성20 + 계약확률20 + 지속성10)
create or replace function public.inquiry_score()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  s_profit int; s_region int; s_expert int; s_close int; s_keep int; total int;
  txt text := coalesce(new.message,'') || ' ' || coalesce(new.preferred_time,'');
  edu boolean := new.category in ('koi','math');
begin
  -- 수익성 30
  s_profit := case new.category when 'koi' then 30 when 'ai_dev' then 30 when 'math' then 25
                                when 'partnership' then 20 when 'publishing' then 15 else 10 end;
  -- 지역매치 20 (교육 문의만 지역 가중)
  if not edu then s_region := 12;
  elsif txt ~ '대치|도곡|개포|역삼|선릉|한티|은마' then s_region := 20;
  elsif txt ~ '강남|서초|송파|반포|잠실|방배' then s_region := 16;
  elsif txt ~ '분당|판교|수지|용인|과천' then s_region := 13;
  elsif txt ~ '온라인|화상|비대면|줌|zoom' then s_region := 12;
  else s_region := 10; end if;
  -- 전문성 20 (강점 영역과의 일치)
  s_expert := case new.category when 'koi' then 20 when 'ai_dev' then 18 when 'math' then 16 else 10 end;
  if txt ~* 'KOI|정보올림피아드|IOI|USACO|알고리즘|영재|과학고|KMO' then s_expert := 20; end if;
  -- 계약확률 20 (구체성 신호)
  s_close := 4
    + case when char_length(new.message) >= 60 then 6 when char_length(new.message) >= 25 then 3 else 0 end
    + case when new.preferred_time is not null then 4 else 0 end
    + case when new.email is not null then 2 else 0 end
    + case when new.is_guardian then 2 else 0 end
    + case when txt ~ '바로|이번 ?주|급|빨리|시작하고|등록' then 2 else 0 end;
  s_close := least(s_close, 20);
  -- 지속성 10 (장기 수강 가능 학년)
  s_keep := case
    when new.student_grade ~ '^초[4-6]$|^중[1-3]$' then 10
    when new.student_grade ~ '^고[12]$' then 7
    when new.student_grade is null and not edu then 6
    when new.student_grade is null then 5
    else 4 end;

  total := s_profit + s_region + s_expert + s_close + s_keep;
  new.score := total;
  new.grade := case when total >= 85 then 'S' when total >= 75 then 'A' when total >= 65 then 'B'
                    when total >= 55 then 'C' else 'D' end;
  return new;
end $$;

drop trigger if exists inquiries_score on public.inquiries;
create trigger inquiries_score before insert on public.inquiries
  for each row execute function public.inquiry_score();

-- 4) 상태 변경 시각 기록 -----------------------------------------------------
create or replace function public.inquiry_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if old.status = 'new' and new.status <> 'new' and new.first_contacted_at is null then
    new.first_contacted_at := now();
  end if;
  return new;
end $$;

drop trigger if exists inquiries_touch on public.inquiries;
create trigger inquiries_touch before update on public.inquiries
  for each row execute function public.inquiry_touch();

-- 5) 주간 통계 (리포트 함수에서 service_role 로 호출) -------------------------
create table if not exists public.inquiry_reports (
  id         bigint generated always as identity primary key,
  sent_at    timestamptz not null default now(),
  period_from timestamptz not null,
  period_to   timestamptz not null,
  payload    jsonb not null
);
alter table public.inquiry_reports enable row level security;
revoke all on public.inquiry_reports from anon, authenticated;

create or replace function public.inquiry_weekly_stats(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with w as (
    select * from public.inquiries
     where created_at >= p_from and created_at < p_to and status <> 'spam'
  ), prev as (
    select count(*) n from public.inquiries
     where created_at >= p_from - (p_to - p_from) and created_at < p_from and status <> 'spam'
  )
  select jsonb_build_object(
    'total',      (select count(*) from w),
    'prev_total', (select n from prev),
    'enrolled',   (select count(*) from public.inquiries where status = 'enrolled' and updated_at >= p_from and updated_at < p_to),
    'open_new',   (select count(*) from public.inquiries where status = 'new'),
    'stale_new',  (select count(*) from public.inquiries where status = 'new' and created_at < now() - interval '24 hours'),
    'top_grade',  (select count(*) from w where grade in ('S','A')),
    'median_first_contact_h', (select round((percentile_cont(0.5) within group (order by extract(epoch from first_contacted_at - created_at)) / 3600)::numeric, 1)
                                 from w where first_contacted_at is not null),
    'by_category', coalesce((select jsonb_object_agg(category, n) from (select category, count(*) n from w group by 1) x), '{}'::jsonb),
    'by_source',   coalesce((select jsonb_object_agg(src, n) from (
                      select coalesce(nullif(utm->>'utm_source',''), source_site) src, count(*) n from w group by 1 order by 2 desc limit 5) x), '{}'::jsonb)
  );
$$;
revoke execute on function public.inquiry_weekly_stats(timestamptz, timestamptz) from public, anon, authenticated;

-- 6) 보유기간 경과분 파기 (1년, 등록 전환 건 제외) -----------------------------
create or replace function public.purge_old_inquiries(retention interval default interval '1 year')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  delete from public.inquiries
   where created_at < now() - retention
     and status <> 'enrolled';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.purge_old_inquiries(interval) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'inquiries_purge_1y';
select cron.schedule('inquiries_purge_1y', '40 4 * * *', $$select public.purge_old_inquiries()$$);
