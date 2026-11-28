-- Ask (checklist 8.1, ADR 0054). Additive: one table, one function, and a wider model check on ai_usage.
--
-- ask_log: every question Khaled asks, with the answer shown (Claude's verified answer or the facts-only text built
-- by code), the citations as returned (id, label, value text, source, as-of, Marsad page or SEC link), whether the
-- answer passed the figure check, the model, the spend and the outcome. Personal and owner-only: the Ask Edge
-- Function writes it with the caller's own JWT, the Ask page reads it; members (friends) neither read nor write it.
-- Append-only from the app: no update or delete grant.
create table public.ask_log (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question text not null check (char_length(question) between 1 and 500),
  answer text not null check (char_length(answer) <= 20000),
  citations jsonb not null default '[]'::jsonb check (jsonb_typeof(citations) = 'array'),
  verified boolean not null,
  model text check (model is null or model ~ '^claude-[a-z0-9-]{1,40}$'),
  usd numeric(12, 6) not null default 0 check (usd >= 0),
  state text not null check (state in ('answered', 'facts-only', 'refused', 'capped')),
  as_of timestamptz,
  created_at timestamptz not null default now(),
  check (not verified or state = 'answered')
);
create index ask_log_owner_created_idx on public.ask_log (owner_id, created_at desc);

alter table public.ask_log enable row level security;
create policy ask_log_owner on public.ask_log
  for all to authenticated
  using (private.is_mfa() and private.is_app_owner() and owner_id = (select auth.uid()))
  with check (private.is_mfa() and private.is_app_owner() and owner_id = (select auth.uid()));
revoke all on public.ask_log from anon, authenticated;
grant select, insert on public.ask_log to authenticated;

-- Whether the caller is the app owner, for the Ask function to refuse members before it spends anything. Security
-- invoker (it runs as the caller and only asks private.is_app_owner(), which reads the caller's own JWT); callable
-- by signed-in users only.
create function public.ask_is_owner()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.is_app_owner()
$$;
revoke execute on function public.ask_is_owner() from public, anon;
grant execute on function public.ask_is_owner() to authenticated;

-- Claude Sonnet 5.5's server-side fallback can answer a declined question on Claude Sonnet 5; its spend is recorded
-- under its own name and price (packages/core/src/ai/cost.ts).
alter table public.ai_usage drop constraint ai_usage_model_check;
alter table public.ai_usage
  add constraint ai_usage_model_check check (
    model in ('claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-opus-5-5')
  );
