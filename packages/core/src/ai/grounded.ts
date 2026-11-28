/**
 * Generate, verify, regenerate once with the mismatches listed, then fall back to a deterministic template
 * (brief, in_app_ai). The model never has the last word: text reaches the user only if the verifier passes
 * it, or if it is the template built by code from the same facts. Every failure is reported so it can be logged.
 */
import { describeIssues, verifyText, type Issue, type VerifyOptions } from './verify.js';
import type { Payload } from './facts.js';

export interface GenerateRequest {
  attempt: 1 | 2;
  /** Mismatches from the previous attempt, empty on the first. Passed back so the model can correct them. */
  feedback: readonly string[];
}

export interface GroundedFailure {
  attempt: 1 | 2;
  kind: 'verification' | 'generation-error';
  /** Short lines: the mismatches, or the error message. */
  details: string[];
  /** The rejected text, kept for the audit log (never shown to the user). */
  rejectedText: string | null;
}

export type GroundedReason =
  'verified' | 'verification-failed' | 'generation-failed' | 'cost-cap' | 'refusal';

/**
 * Thrown by `generate` to end the attempts at once and use the template: a refusal (never retried), the cost cap
 * reached before a call, or an error a second attempt cannot fix (a rejected key, a malformed request).
 */
export class StopGeneration extends Error {
  readonly reason: 'refusal' | 'cost-cap' | 'generation-failed';
  constructor(reason: 'refusal' | 'cost-cap' | 'generation-failed', message: string) {
    super(message);
    this.name = 'StopGeneration';
    this.reason = reason;
  }
}

export interface GroundedResult {
  text: string;
  source: 'model' | 'template';
  reason: GroundedReason;
  /** How many model calls were made (0 when the cost cap sent us straight to the template). */
  attempts: number;
  failures: GroundedFailure[];
  /** Citation ids the final text uses. */
  citations: string[];
  /** False only if the template itself failed verification, which is a bug in the template. */
  templateVerified: boolean;
}

export interface GroundedOptions {
  payload: Payload;
  /** Calls the model. Thrown errors, `max_tokens` stops and refusals count as a failed attempt. */
  generate: (request: GenerateRequest) => Promise<string>;
  /** Builds deterministic text from the facts. Must pass the verifier. */
  template: () => string;
  /** False when the cost cap is reached: the template is used and the model is not called. */
  allowModel?: boolean;
  verify?: VerifyOptions;
  /**
   * Prompt-specific checks run after the verifier (a required section, no advice). Problems count as a failed
   * verification: they are passed back for the one regeneration, then the template is used.
   */
  check?: (text: string) => string[];
  onFailure?: (failure: GroundedFailure) => void;
}

export async function groundedGenerate(options: GroundedOptions): Promise<GroundedResult> {
  const failures: GroundedFailure[] = [];
  const record = (f: GroundedFailure) => {
    failures.push(f);
    options.onFailure?.(f);
  };
  const useTemplate = (reason: GroundedReason, attempts: number): GroundedResult => {
    const text = options.template();
    const check = verifyText(text, options.payload, options.verify);
    return {
      text,
      source: 'template',
      reason,
      attempts,
      failures,
      citations: check.citations,
      templateVerified: check.ok,
    };
  };

  if (options.allowModel === false) return useTemplate('cost-cap', 0);

  let feedback: string[] = [];
  let attempts = 0;
  let lastWasError = false;
  for (const attempt of [1, 2] as const) {
    attempts += 1;
    let text: string;
    try {
      text = await options.generate({ attempt, feedback });
    } catch (e) {
      if (e instanceof StopGeneration) {
        record({
          attempt,
          kind: 'generation-error',
          details: [e.message.slice(0, 300)],
          rejectedText: null,
        });
        // The cap stops before a call is made, so this attempt is not counted as one.
        return useTemplate(e.reason, e.reason === 'cost-cap' ? attempts - 1 : attempts);
      }
      lastWasError = true;
      record({
        attempt,
        kind: 'generation-error',
        details: [e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300)],
        rejectedText: null,
      });
      feedback = [];
      continue;
    }
    lastWasError = false;
    const v = verifyText(text, options.payload, options.verify);
    const problems = options.check?.(text) ?? [];
    if (v.ok && problems.length === 0) {
      return {
        text,
        source: 'model',
        reason: 'verified',
        attempts,
        failures,
        citations: v.citations,
        templateVerified: true,
      };
    }
    feedback = [...describeIssues(v.issues), ...problems];
    record({ attempt, kind: 'verification', details: feedback, rejectedText: text });
  }
  return useTemplate(lastWasError ? 'generation-failed' : 'verification-failed', attempts);
}

export type { Issue };
