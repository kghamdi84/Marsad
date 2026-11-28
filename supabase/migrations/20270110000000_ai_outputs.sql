-- AI outputs (ADR 0007, checklist 2.9, 2.10 and 7.8): every filing summary, thesis draft and weekly review prose the
-- AI jobs produce, written with the secret key. Each row keeps what reaches the user (the verified model text, or the
-- code-built template when the model was capped, refused or failed the verifier), the citations it uses, the prompt
-- id and version, the model, every failed attempt (with the rejected text, for audit) and the input snapshot the
-- text was built from, so a summary can be replayed and checked. Append-only: a changed source adds a row.
--
-- Filing summaries are shared research like the filings they describe: members read them (ADR 0040). Thesis drafts
-- and the weekly review name Khaled's holdings and trades: owner only. Nobody writes from the app.
create table public.ai_outputs (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('filing-summary', 'thesis-draft', 'weekly-review')),
  ticker text check (ticker is null or ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  -- The week ending date of a weekly review; null for the per-ticker kinds.
  for_date date,
  -- What the text was built from: accession numbers and section keys, as stored in their tables.
  source_ids text[] not null default '{}' check (cardinality(source_ids) <= 50),
  -- A hash of the sources and prompt version: the job writes a new row only when it changes.
  source_key text not null check (char_length(source_key) between 8 and 128),
  prompt_id text not null check (prompt_id in ('filing-summary', 'thesis-draft', 'weekly-review')),
  prompt_version integer not null check (prompt_version > 0),
  model text not null check (model in ('claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5')),
  -- The model that answered (a server-side fallback can differ); null when no call was made.
  served_model text,
  text text not null check (char_length(btrim(text)) > 0 and char_length(text) <= 20000),
  -- One object per id the text cites: {id, kind: fact|document, label, url, source, asOf}.
  citations jsonb not null default '[]'::jsonb check (jsonb_typeof(citations) = 'array'),
  -- True when the shown text passed the number verifier (model text always does; so must the template).
  verified boolean not null,
  source text not null check (source in ('model', 'template')),
  fallback_reason text check (
    fallback_reason is null
    or fallback_reason in ('verification-failed', 'generation-failed', 'cost-cap', 'refusal')
  ),
  attempts integer not null check (attempts between 0 and 2),
  failures jsonb not null default '[]'::jsonb check (jsonb_typeof(failures) = 'array'),
  input_snapshot jsonb not null check (jsonb_typeof(input_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  constraint ai_outputs_reason_matches_source check ((source = 'model') = (fallback_reason is null)),
  constraint ai_outputs_model_text_verified check (source = 'template' or verified),
  constraint ai_outputs_ticker_by_kind check ((kind = 'weekly-review') = (ticker is null)),
  constraint ai_outputs_week_by_kind check ((kind = 'weekly-review') = (for_date is not null))
);
create index ai_outputs_kind_ticker_idx on public.ai_outputs (kind, ticker, created_at desc);
create index ai_outputs_kind_week_idx on public.ai_outputs (kind, for_date desc);

alter table public.ai_outputs enable row level security;
create policy ai_outputs_owner_read on public.ai_outputs
  for select to authenticated using (private.is_app_owner());
create policy ai_outputs_member_read on public.ai_outputs
  for select to authenticated using (private.is_member() and kind = 'filing-summary');
revoke all on public.ai_outputs from anon, authenticated;
grant select on public.ai_outputs to authenticated;

-- The usage log gains what each call was for and how it ended (ADR 0007 addendum). Additive: old rows keep nulls.
alter table public.ai_usage
  add column served_model text,
  add column prompt_id text,
  add column prompt_version integer check (prompt_version is null or prompt_version > 0),
  add column outcome text check (
    outcome is null
    or outcome in ('text', 'max_tokens', 'refusal', 'invalid-json', 'unexpected-stop', 'api-error')
  );
