/**
 * Versioned prompts (ADR 0007, checklist 2.11). A prompt is code: its id and version are stored with every output
 * it produces, a change to its text is a new version, and each version carries evaluation cases that run offline
 * against the same verifier that guards production text. Pure.
 */
import type { ModelId } from '../ai/cost.js';
import type { Payload } from '../ai/facts.js';
import type { IssueKind } from '../ai/verify.js';

export interface PromptDef {
  id: string;
  /** Bumped on any change to `system`, `task` or `check`; stored as `${id}@${version}`. */
  version: number;
  model: ModelId;
  /** What the output is for, in one line. */
  purpose: string;
  /** Static instructions (the cached prefix): no per-call data, no dates, no random tags. */
  system: string;
  /** The task line that ends the user turn. */
  task: string;
  /** 'grounded': verified sentence by sentence against the payload; 'json': a structured answer checked by `check`. */
  output: 'grounded' | 'json';
  /** Prompt-specific checks beyond the verifier (sections present, allowed labels). Empty array means accepted. */
  check: (output: string) => string[];
  evals: readonly EvalCase[];
}

export interface EvalCase {
  name: string;
  payload: Payload;
  /** A candidate output, as a model might write it. */
  output: string;
  /** Whether the output must be accepted. */
  accept: boolean;
  /** For rejected grounded outputs: the verifier issue kinds that must be among the reasons. */
  issues?: readonly IssueKind[];
}

export const promptKey = (p: Pick<PromptDef, 'id' | 'version'>) => `${p.id}@${p.version}`;
