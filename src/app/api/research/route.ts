// POST /api/research: takes the form input (optionally with a checkpoint), streams progress over SSE, then the recommendations
import { runPipeline, type PipelineEvent } from "@/lib/pipeline";
import { researchInputSchema } from "@/lib/schemas";
import { restoreCheckpoint } from "@/lib/checkpoint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: { input?: unknown; exclude?: unknown; checkpoint?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: { code: "validation", message: "Invalid request format", suggestion: "Refresh the page and try again" } }, { status: 400 });
  }
  const parsed = researchInputSchema.safeParse(body.input);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => ({ field: String(i.path[0]), message: i.message }));
    return Response.json(
      { error: { code: "validation", message: "Input is incomplete", suggestion: "Add what the product does or the customer type", fields } },
      { status: 400 },
    );
  }
  const exclude = Array.isArray(body.exclude) ? body.exclude.filter((x): x is string => typeof x === "string") : [];
  // The checkpoint comes back from the browser: discard it entirely if the signature is wrong (altered) or the version doesn't match;
  // steps whose shape doesn't match the current code are redone along with later steps, so they can't skip checks or crash the pipeline
  const { checkpoint, dropped } = restoreCheckpoint(body.checkpoint);
  if (dropped.length) console.warn(`[research] checkpoint parts discarded and will be redone: ${dropped.join(", ")}`);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const emit = (e: PipelineEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          closed = true; // browser disconnected: stop pushing once the pipeline finishes this step
        }
      };
      // SSE comment lines as a heartbeat, so proxies don't drop the connection during long silences
      const ping = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          closed = true;
        }
      }, 15000);
      try {
        await runPipeline(parsed.data, exclude, checkpoint, emit);
      } finally {
        clearInterval(ping);
        if (!closed) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
