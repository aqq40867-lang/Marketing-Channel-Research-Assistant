// Checkpoint restore (server only): a checkpoint sent back by the browser is first signature-checked, then validated step by step against the current schemas.
// A signature only proves it was not altered, not that it matches the current code: checkpoints saved by an older version still have valid signatures
// but their fields may have changed. A mismatched step and every step after it are dropped and re-run, instead of letting the pipeline crash on an old shape.
import "server-only";
import { checkpointStepSchemas, CHECKPOINT_VERSION, judgementSchema } from "./schemas";
import { verify } from "./sign";
import type { Checkpoint } from "./types";

export interface RestoreResult {
  checkpoint: Checkpoint;
  /** Parts that were dropped and must be redone (for logging) */
  dropped: string[];
}

export function restoreCheckpoint(raw: unknown): RestoreResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { checkpoint: {}, dropped: [] };
  const { sig, ...data } = raw as Checkpoint;
  if (!verify("checkpoint", data, sig)) return { checkpoint: {}, dropped: ["signature"] };
  // Checkpoints without a version were saved before versioning existed; they have the same shape as version 1
  if ((data.v ?? 1) !== CHECKPOINT_VERSION) return { checkpoint: {}, dropped: [`version ${data.v}`] };

  const out: Checkpoint = {};
  const dropped: string[] = [];
  // Steps depend on earlier ones (candidate ids come from search results, judgements depend on fetched text): if one step is invalid, every later step is redone
  const order = ["plan", "search", "shortlist", "pages"] as const;
  let broken = false;
  for (const key of order) {
    if (data[key] === undefined) {
      broken = true; // this step has not run yet, so later steps cannot be valid
      continue;
    }
    if (broken) {
      dropped.push(key);
      continue;
    }
    const r = checkpointStepSchemas[key].safeParse(data[key]);
    if (r.success) {
      (out as Record<string, unknown>)[key] = r.data;
    } else {
      broken = true;
      dropped.push(key);
    }
  }
  // Model judgements: re-validate each one against the current judgementSchema; drop and re-judge only the invalid ones
  if (Array.isArray(data.judgements)) {
    if (broken) {
      dropped.push("judgements");
    } else {
      out.judgements = [];
      for (const j of data.judgements) {
        const r = judgementSchema.safeParse(j?.raw);
        if (j && typeof j.id === "string" && r.success) out.judgements.push({ id: j.id, raw: r.data });
        else dropped.push(`judgement ${j?.id ?? "?"}`);
      }
    }
  }
  return { checkpoint: out, dropped };
}
