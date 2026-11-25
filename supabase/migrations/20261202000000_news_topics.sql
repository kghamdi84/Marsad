-- Geopolitical topic counts (Phase 3, ADR 0012). One row per UTC day, filled by the topics job with the secret key;
-- readable only by the owner with MFA. Articles are not stored here, only counts and a few sample headlines.

create table public.news_topic_days (
  date date primary key,
  version text not null,
  total integer not null check (total >= 0),
  counts jsonb not null,
  samples jsonb not null,
  fetched_at timestamptz not null default now()
);

alter table public.news_topic_days enable row level security;
create policy news_topic_days_owner_read on public.news_topic_days
  for select to authenticated using (private.is_app_owner());
revoke all on public.news_topic_days from anon, authenticated;
grant select on public.news_topic_days to authenticated;

insert into public.source_status (source, display_name, note)
values ('massive_topics', 'Massive market news (topic counts)', 'Daily job at 01:20 UTC')
on conflict (source) do nothing;
