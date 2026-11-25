-- Cost tracker (Phase 8, ADR 0028). Every Claude call records its model, token usage and cost here (jobs, secret
-- key); the owner reads it with MFA. The caps are Khaled's to set in his preferences; while they are unset, AI stays
-- off and text comes from templates.
create table public.ai_usage (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  job text not null,
  purpose text not null,
  model text not null check (model in ('claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5')),
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  usd numeric(12, 6) not null check (usd >= 0),
  fell_back boolean not null default false
);
create index ai_usage_created_idx on public.ai_usage (created_at desc);

alter table public.ai_usage enable row level security;
create policy ai_usage_owner_read on public.ai_usage
  for select to authenticated using (private.is_app_owner());
revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;

alter table public.user_settings
  add column ai_daily_cap_usd numeric(8, 2) check (ai_daily_cap_usd is null or ai_daily_cap_usd > 0),
  add column ai_monthly_cap_usd numeric(8, 2) check (ai_monthly_cap_usd is null or ai_monthly_cap_usd > 0);
