/**
 * Building the messages for a prompt, and grading an output exactly as production does. The evaluation cases use
 * the same `gradeOutput` as the jobs, so a prompt version that passes its cases is held to the same bar live.
 */
import type { Payload } from '../ai/facts.js';
import { verifyText, type IssueKind } from '../ai/verify.js';
import { wrapUntrusted } from '../ai/untrusted.js';
import { promptKey, type PromptDef } from './types.js';

export * from './types.js';
export * from './formats.js';
export {
  PROMPTS,
  filingSummaryPrompt,
  thesisDraftPrompt,
  topicTagPrompt,
  weeklyReviewPrompt,
} from './catalog.js';

/**
 * The system prompt and the user turn. The system prompt is the static, cached prefix; the user turn holds the
 * wrapped documents first, then the facts with their ids, then the untrusted-text notice and the task.
 */
export function buildMessages(
  def: PromptDef,
  payload: Payload,
  randomHex: () => string,
): { system: string; user: string; promptKey: string } {
  const wrapped = wrapUntrusted(payload.documents, randomHex);
  const facts = payload.facts
    .map(
      (f) =>
        `[${f.id}] ${f.label}: ${f.value === null ? 'not available' : String(f.value)}${f.unit === 'text' || f.unit === 'date' ? '' : ` (${f.unit})`}`,
    )
    .join('\n');
  const user = [wrapped.block, facts ? `Facts:\n${facts}` : '', wrapped.notice, def.task]
    .filter(Boolean)
    .join('\n\n');
  return { system: def.system, user, promptKey: promptKey(def) };
}

export interface Grade {
  accepted: boolean;
  /** Verifier issue kinds (grounded outputs only). */
  issues: IssueKind[];
  /** Prompt-specific problems. */
  problems: string[];
}

/** Grades an output: the verifier for grounded prompts, then the prompt's own checks. */
export function gradeOutput(def: PromptDef, payload: Payload, output: string): Grade {
  const v = def.output === 'grounded' ? verifyText(output, payload) : null;
  const problems = def.check(output);
  const issues = v ? v.issues.map((i) => i.kind) : [];
  return { accepted: (v?.ok ?? true) && problems.length === 0, issues, problems };
}

/** Runs every evaluation case of a prompt; returns the cases whose grade did not match what they expect. */
export function evaluatePrompt(def: PromptDef): { name: string; grade: Grade }[] {
  return def.evals.flatMap((c) => {
    const grade = gradeOutput(def, c.payload, c.output);
    const missing = (c.issues ?? []).filter((k) => !grade.issues.includes(k));
    return grade.accepted !== c.accept || missing.length > 0 ? [{ name: c.name, grade }] : [];
  });
}
