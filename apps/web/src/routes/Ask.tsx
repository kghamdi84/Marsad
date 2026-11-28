import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ASK_LIMITS, type AskBudget } from '@marsad/core';
import { Card } from '../components/Card';
import { PageTitle } from '../components/ui/kit';
import { AskAnswer, useWhen } from '../components/ask/AskAnswer';
import { callAsk, loadAskHistory, type AskResult } from '../components/ask/api';
import { t } from '../strings';

const s = t.ask;

/** Why the form is closed, in words, or null when Ask can take a question. */
function blocked(r: AskResult | undefined): { title: string; body?: string } | null {
  if (!r) return null;
  switch (r.state) {
    case 'not-configured':
      return { title: s.notConfigured, body: s.notConfiguredBody };
    case 'unreachable':
      return { title: s.notConfigured, body: s.notDeployed };
    case 'owner-only':
      return { title: s.ownerOnly };
    case 'signed-out':
      return { title: s.signedOut };
    case 'capped':
      return {
        title: r.budget?.capped === 'monthly' ? s.cappedMonthly : s.cappedDaily,
        body: s.cappedBody,
      };
    default:
      return null;
  }
}

function Notice({ title, body }: { title: string; body?: string | undefined }) {
  return (
    <div role="status" className="flex flex-col gap-1 rounded-lg border border-line bg-elev p-3">
      <p className="font-semibold text-ink">{title}</p>
      {body && <p className="text-sm text-fg">{body}</p>}
    </div>
  );
}

function SpendLine({ budget }: { budget: AskBudget | null | undefined }) {
  if (!budget) return <p className="text-xs text-ink3">{s.spendUnknown}</p>;
  return (
    <p className="text-xs text-ink3">
      {s.spendLeft(budget.dailyLeftUsd, budget.monthlyLeftUsd)}
      {budget.state === 'warn' && (
        <span className="ms-1 font-semibold text-warn">{s.spendWarn}</span>
      )}
    </p>
  );
}

/** The latest reply: the answer, or the notice that replaces it. */
function Reply({ r }: { r: AskResult }) {
  const stop = blocked(r);
  if (r.state === 'unreachable' || stop) {
    // A cap reached midway still shows the facts gathered before it.
    if (r.state === 'capped' && r.answer !== '')
      return (
        <AskAnswer
          answer={r.answer}
          citations={r.citations}
          verified={false}
          model={r.model}
          asOf={r.asOf}
          usd={r.usage.usd}
          prefix="ask-latest"
          note={s.cappedMidway}
        />
      );
    return stop ? <Notice title={stop.title} body={stop.body} /> : null;
  }
  if (r.state === 'invalid') return <Notice title={s.invalid} />;
  if (r.state === 'error' || r.state === 'ready') return <Notice title={s.error} />;
  const note =
    r.state === 'refused'
      ? s.refused
      : r.state === 'facts-only' && r.reason
        ? s.reasons[r.reason]
        : r.reason === 'no-data'
          ? s.reasons['no-data']
          : null;
  return (
    <AskAnswer
      answer={r.answer}
      citations={r.citations}
      verified={r.state === 'answered' && r.verified}
      model={r.model}
      asOf={r.asOf}
      usd={r.usage.usd}
      prefix="ask-latest"
      note={note}
    />
  );
}

function History() {
  const q = useQuery({ queryKey: ['ask-history'], queryFn: loadAskHistory });
  const when = useWhen();
  return (
    <Card id="ask-history" title={s.historyTitle} subtitle={s.historySubtitle}>
      {q.isError ? (
        <p role="status" className="text-sm text-crit">
          {s.historyError(q.error.message)}
        </p>
      ) : !q.data ? (
        <p role="status" className="text-sm text-ink3">
          {t.loading}
        </p>
      ) : q.data.length === 0 ? (
        <p className="text-sm text-ink3">{s.historyEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {q.data.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-1 border-b border-line pb-2 last:border-b-0"
            >
              <p className="font-semibold text-ink">{row.question}</p>
              <p className="flex flex-wrap gap-x-3 text-xs text-ink3">
                <span>{s.askedAt(when(row.created_at))}</span>
                <span>{s.states[row.state] ?? row.state}</span>
              </p>
              {(row.answer !== '' || row.citations.length > 0) && (
                <details>
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-up">
                    {s.showAnswer}
                  </summary>
                  <AskAnswer
                    answer={row.answer}
                    citations={row.citations}
                    verified={row.verified}
                    model={row.model}
                    asOf={row.as_of}
                    usd={row.usd}
                    prefix={`ask-${row.id}`}
                  />
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function Ask() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['ask-status'],
    queryFn: () => callAsk({ mode: 'status' }),
    staleTime: 60_000,
  });
  const [question, setQuestion] = useState('');
  const asked = useMutation({
    mutationFn: (q: string) => callAsk({ question: q }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['ask-history'] });
      void qc.invalidateQueries({ queryKey: ['ask-status'] });
    },
  });
  const latest = asked.data;
  const gate = blocked(status.data);
  const budget =
    (latest && 'budget' in latest ? latest.budget : null) ??
    (status.data && 'budget' in status.data ? status.data.budget : null);
  const trimmed = question.trim();
  const canAsk = !gate && !status.isPending && !asked.isPending && trimmed !== '';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (canAsk) asked.mutate(trimmed);
  };
  return (
    <div className="flex flex-col gap-5">
      <PageTitle page="ask" />
      <Card id="ask-form" title={s.formTitle} subtitle={s.formSubtitle}>
        {gate && <Notice title={gate.title} body={gate.body} />}
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label htmlFor="ask-question" className="text-sm text-muted">
            {s.label}
          </label>
          <textarea
            id="ask-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={ASK_LIMITS.maxQuestionChars}
            rows={3}
            placeholder={s.placeholder}
            disabled={!!gate}
            aria-describedby="ask-count ask-never"
            className="min-h-24 rounded-xl border border-line bg-bg px-3 py-2 text-base text-fg disabled:opacity-60"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span id="ask-count" className="text-xs text-ink3 tabular-nums">
              {s.counter(question.length, ASK_LIMITS.maxQuestionChars)}
            </span>
            <button
              type="submit"
              disabled={!canAsk}
              className="min-h-11 min-w-24 rounded-lg bg-accent px-4 font-semibold text-accent-ink disabled:opacity-50"
            >
              {s.submit}
            </button>
          </div>
          <p id="ask-never" className="text-xs text-ink3">
            {s.never}
          </p>
          <SpendLine budget={budget} />
        </form>
        <div aria-live="polite" className="flex flex-col gap-3">
          {asked.isPending && (
            <p role="status" className="text-sm text-ink3">
              {s.asking}
            </p>
          )}
          {!asked.isPending && latest && <Reply r={latest} />}
          {asked.isError && <Notice title={s.error} />}
        </div>
      </Card>
      <History />
    </div>
  );
}
