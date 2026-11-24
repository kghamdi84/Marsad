-- A separate status row for Massive's slow-moving reference data (market calendar, splits), so the
-- status page judges it by a daily limit and not by the live-price limit of the 'massive' row.
insert into public.source_status (source, display_name, note)
values ('massive_reference', 'Massive reference data (calendar, splits)', 'Daily job')
on conflict (source) do nothing;
