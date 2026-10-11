-- 주간 문의 리포트: 매주 월요일 08:52 KST(일요일 23:52 UTC) 카카오톡 발송
-- 선행 조건: Edge Function `inquiry-weekly-report` 배포 (verify_jwt=true)
-- anon 키는 공개 키이며, 함수 쪽 6일 중복 발송 차단으로 남용을 막습니다.
select cron.unschedule(jobid) from cron.job where jobname = 'inquiry_weekly_report';
select cron.schedule(
  'inquiry_weekly_report',
  '52 23 * * 0',
  $$select net.http_post(
      url := 'https://inftexpcnfinglwlrvsj.supabase.co/functions/v1/inquiry-weekly-report',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImluZnRleHBjbmZpbmdsd2xydnNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTMyMzgsImV4cCI6MjA4ODQ4OTIzOH0.HONuULp0L3B5T0gTiwJMnowjJonJzzNHhUV_LtpDQoI"}'::jsonb,
      body := '{}'::jsonb)$$
);
