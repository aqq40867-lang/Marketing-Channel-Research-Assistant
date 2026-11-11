"use client";
// Browser research runner: calls /api/research, reads the SSE stream and writes every event to local storage (so closing the page doesn't lose completed steps).
import { useCallback, useEffect, useRef, useState } from "react";
import type { PipelineEvent } from "./pipeline";
import { newId, store } from "./storage";
import type { AppError, Research, ResearchInput, StepProgress } from "./types";
import { STEP_ORDER } from "./types";

/**
 * Once a run has a final result with nothing left to retry, its checkpoint (up to 8 page bodies, 100 KB or more) is no longer needed
 * and is not kept; otherwise a few dozen runs would fill localStorage and even follow-ups and drafts couldn't be saved.
 * Runs that are incomplete, errored (retryable), or have retryable candidates keep their checkpoint.
 */
export function isFinal(r: Pick<Research, "status" | "error">): boolean {
  if (r.error?.retryable) return false;
  return r.status === "done" || r.status === "partial" || (r.status === "failed" && r.error?.code === "no_results");
}

export function initialProgress(): StepProgress[] {
  return STEP_ORDER.map((step) => ({ step, state: "pending", detail: "" }));
}

export function cleanInput(i: ResearchInput): ResearchInput {
  return {
    ...i,
    product: i.product.trim(),
    audience: i.audience.trim(),
    market: i.market.trim(),
    productName: i.productName?.trim() ?? "",
    productUrl: i.productUrl?.trim() ?? "",
    excludeUrls: i.excludeUrls.map((x) => x.trim()).filter(Boolean),
  };
}

export function useResearchRunner() {
  const [runningId, setRunningId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(async (start: Research) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let cur: Research = {
      ...start,
      status: "running",
      error: undefined,
      // on retry: keep completed steps, reset the rest
      progress: start.progress.map((p) => (p.state === "done" || p.state === "skipped" ? p : { ...p, state: "pending", detail: "" })),
    };
    const persist = () => store.saveResearch(cur);
    persist();
    setRunningId(cur.id);

    const fail = (error: AppError, status: Research["status"] = "failed") => {
      cur = { ...cur, status, error };
      persist();
    };

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: cur.input,
          exclude: [...cur.input.excludeUrls, ...cur.autoExcluded],
          checkpoint: cur.checkpoint,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        fail(data.error ?? { code: "unknown", message: `Server returned HTTP ${res.status}`, suggestion: "Click “Retry”." });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let ev: PipelineEvent;
          try {
            ev = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (ev.type === "progress") {
            cur = {
              ...cur,
              progress: cur.progress.map((p) => (p.step === ev.step ? { ...p, state: ev.state, detail: ev.detail } : p)),
            };
          } else if (ev.type === "checkpoint") {
            cur = { ...cur, checkpoint: ev.checkpoint };
          } else if (ev.type === "result") {
            finished = true;
            cur = {
              ...cur,
              status: ev.status,
              channels: ev.channels,
              rejected: ev.rejected,
              summary: ev.summary,
              error: ev.error,
            };
            if (isFinal(cur)) cur = { ...cur, checkpoint: {} };
          } else if (ev.type === "error") {
            finished = true;
            cur = { ...cur, status: "failed", error: ev.error };
          }
          persist();
        }
      }
      if (!finished) {
        fail(
          { code: "network", message: "The connection to the local server was lost and the research did not finish.", suggestion: "Click “Resume”. Completed steps will not be redone." },
          "incomplete",
        );
      }
    } catch (e) {
      if (ctrl.signal.aborted) {
        fail({ code: "network", message: "The research was interrupted.", suggestion: "Click “Resume”. Completed steps will not be redone." }, "incomplete");
      } else {
        fail({
          code: "network",
          message: `Cannot connect to the local server: ${e instanceof Error ? e.message : e}`,
          suggestion: "Make sure npm run dev is still running in the terminal, then click “Resume”.",
        }, "incomplete");
      }
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setRunningId(null);
      }
    }
  }, []);

  const startNew = useCallback(
    (input: ResearchInput, autoExcluded: string[]) => {
      const r: Research = {
        id: newId(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        input: cleanInput(input),
        autoExcluded,
        status: "running",
        progress: initialProgress(),
        checkpoint: {},
        channels: [],
        rejected: [],
      };
      void run(r);
      return r.id;
    },
    [run],
  );

  const resume = useCallback((r: Research) => void run(r), [run]);

  return { runningId, startNew, resume };
}

/** On page load: mark runs that didn't finish (page was closed) as “Incomplete”; drop checkpoints no longer needed by finished runs. */
export function markStaleRuns() {
  for (const r of store.listResearches()) {
    if (isFinal(r) && r.checkpoint && Object.keys(r.checkpoint).length > 0) {
      store.saveResearch({ ...r, checkpoint: {} });
    } else if (r.status === "running") {
      store.saveResearch({
        ...r,
        status: "incomplete",
        progress: r.progress.map((p) => (p.state === "active" ? { ...p, state: "pending", detail: "Interrupted" } : p)),
        error: { code: "network", message: "The page was closed before the last research run finished.", suggestion: "Click “Resume” (completed steps are not redone) or “Start over”." },
      });
    }
  }
}
