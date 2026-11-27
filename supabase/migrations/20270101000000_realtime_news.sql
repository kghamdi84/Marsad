-- Live news on Watch (Marsad v2, Khaled's go-ahead 2026-11-27): add news_articles and filings to Supabase's
-- realtime publication, so the page hears new rows as the jobs store them. Additive: nothing is dropped or
-- rewritten. Realtime applies the tables' existing row-level security, so only signed-in owners and members who
-- can already read these rows receive them. Guarded so the offline test database, which has no
-- supabase_realtime publication, runs the file unchanged.
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array array['news_articles', 'filings'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
