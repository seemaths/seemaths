-- Enable Supabase Cron/pg_cron first. Expired rows are inaccessible immediately;
-- this job removes their database records within the next 15 minutes.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
 'seemaths-assignment-expiry', '*/15 * * * *',
 $job$
 DELETE FROM assignments_portal.assignments
 WHERE expires_at <= extract(epoch FROM clock_timestamp())::bigint;
 DELETE FROM assignments_portal.rate_buckets
 WHERE expires_at <= extract(epoch FROM clock_timestamp())::bigint;
 $job$
);
-- Cron's own execution history also needs a bound.
SELECT cron.schedule(
 'seemaths-cron-history', '10 3 * * *',
 $job$
 DELETE FROM cron.job_run_details
 WHERE end_time < now() - interval '1 day'
 AND jobid IN (SELECT jobid FROM cron.job WHERE jobname IN
 ('seemaths-assignment-expiry', 'seemaths-cron-history'));
 $job$
);
