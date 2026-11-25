-- HUMAN+ : planificateur qui appelle la fonction send-reminders chaque minute.
-- AVANT de l'exécuter : remplace CHANGE_ME par le même mot secret que le secret CRON_SECRET de la fonction.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin perform cron.unschedule('humanplus-send-reminders'); exception when others then null; end $$;

select cron.schedule(
  'humanplus-send-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://ykvqgwdfjlqjlhegcdmh.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'Mohamedlebron008diene@'),
    body := '{}'::jsonb
  );
  $$
);
