// Follow-up stats (pure functions, testable): the funnel counts the highest stage each channel ever reached.
// The board lets channels move back or be restored from failed to an earlier stage; counting only the current stage would undercount Sent/Won and distort the conversion rate.
import type { Lead, LeadStage } from "./types";
import { STAGE_LABEL, STAGES } from "./types";

const STAGE_BY_LABEL = new Map(Object.entries(STAGE_LABEL).map(([k, v]) => [v, k as LeadStage]));

export function higherStage(a: LeadStage, b: LeadStage): LeadStage {
  return STAGES.indexOf(a) >= STAGES.indexOf(b) ? a : b;
}

/**
 * Highest stage reached: the highest of the current stage, the maxStage field, and every target stage of “A → B” entries in the history.
 * Reading the history keeps follow-ups saved before maxStage existed working.
 */
export function maxStageOf(lead: Pick<Lead, "stage" | "maxStage" | "history">): LeadStage {
  let max = higherStage(lead.stage, lead.maxStage ?? "todo");
  for (const h of lead.history ?? []) {
    const m = /→\s*(.+?)\s*$/.exec(h.action);
    const s = m ? STAGE_BY_LABEL.get(m[1]) : undefined;
    if (s) max = higherStage(max, s);
  }
  return max;
}

export interface Funnel {
  /** Channels that reached each stage (moving back does not reduce this) */
  reached: { s: LeadStage; n: number }[];
  /** Channels currently at each stage and not failed */
  current: { s: LeadStage; n: number }[];
  sent: number;
  won: number;
}

export function funnel(leads: Lead[]): Funnel {
  const maxIdx = leads.map((l) => STAGES.indexOf(maxStageOf(l)));
  const reached = STAGES.map((s, i) => ({ s, n: maxIdx.filter((m) => m >= i).length }));
  const current = STAGES.map((s) => ({ s, n: leads.filter((l) => l.stage === s && !l.failed).length }));
  return { reached, current, sent: reached[STAGES.indexOf("sent")].n, won: reached[STAGES.indexOf("won")].n };
}
