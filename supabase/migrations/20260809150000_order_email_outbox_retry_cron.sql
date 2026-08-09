-- Retry pending/failed transactional emails once per minute. The service-role
-- credential is stored separately in Supabase Vault under the name below.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'process-order-email-outbox'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end;
$$;

select cron.schedule(
  'process-order-email-outbox',
  '* * * * *',
  $$
    select net.http_post(
      url := 'https://jhkkocjbamoybdvcvoaa.supabase.co/functions/v1/process-order-email-outbox',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'order_email_dispatch_service_role'
          limit 1
        )
      ),
      body := '{"dispatch_pending":true}'::jsonb
    );
  $$
);
