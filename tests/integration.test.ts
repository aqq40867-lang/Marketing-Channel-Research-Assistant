// Integration tests: call POST on both API routes directly, with the backend pointed at the offline mock DeepSeek (scripts/mock-deepseek.ts).
// Unit tests already cover each gate itself; these check that the gates are wired into the pipeline and APIs correctly:
// whether checkpoints / channels with bad signatures are discarded, whether resuming skips completed steps, and whether fatal errors are reported properly.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ROOT = path.resolve(import.meta.dirname, "..");

const INPUT = {
  product: "A task management product for small teams of 1 to 20 people: assign tasks, set deadline reminders and track project progress.",
  audience: "Owners and founders of UK small businesses with 1 to 20 people",
  market: "UK",
  collabForms: ["guest_post", "article", "demo"],
};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

/** Start the mock server as a child process and return once it prints its listening address. */
async function startMock(env: Record<string, string> = {}): Promise<{ url: string; proc: ChildProcess }> {
  const port = await freePort();
  const proc = spawn(process.execPath, ["--import", "tsx", "scripts/mock-deepseek.ts"], {
    cwd: ROOT,
    env: { ...process.env, MOCK_PORT: String(port), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("mock server did not start within 15s")), 15_000);
    let err = "";
    proc.stderr!.on("data", (d) => (err += d));
    proc.stdout!.on("data", (d) => {
      if (String(d).includes("Mock DeepSeek on")) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`mock server exited (${code}): ${err}`));
    });
  });
  return { url: `http://127.0.0.1:${port}`, proc };
}

type ResearchRoute = typeof import("@/app/api/research/route");
type DraftRoute = typeof import("@/app/api/draft/route");

/** deepseek.ts reads DEEPSEEK_BASE_URL at load time, so the module must be reloaded for each mock server. */
async function loadRoutes(baseUrl: string): Promise<{ research: ResearchRoute; draft: DraftRoute }> {
  process.env.DEEPSEEK_BASE_URL = baseUrl;
  process.env.DEEPSEEK_API_KEY = "mock";
  process.env.APP_SECRET = "integration-test-secret";
  vi.resetModules();
  return {
    research: await import("@/app/api/research/route"),
    draft: await import("@/app/api/draft/route"),
  };
}

const req = (body: unknown) =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ev = any;

async function runResearch(route: ResearchRoute, body: unknown): Promise<Ev[]> {
  const res = await route.POST(req(body));
  expect(res.status).toBe(200);
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)));
}

const progressStates = (ev: Ev[]) =>
  Object.fromEntries(
    ev
      .filter((e) => e.type === "progress" && e.state !== "active")
      .map((e) => [e.step, e.state]),
  );

describe("integration: API routes against mock DeepSeek", () => {
  let mock: Awaited<ReturnType<typeof startMock>>;
  let routes: Awaited<ReturnType<typeof loadRoutes>>;
  let firstRun: Ev[];

  beforeAll(async () => {
    mock = await startMock();
    routes = await loadRoutes(mock.url);
    firstRun = await runResearch(routes.research, { input: INPUT });
  }, 60_000);

  afterAll(() => {
    mock?.proc.kill();
  });

  const resultOf = (ev: Ev[]) => ev.filter((e) => e.type === "result").at(-1);
  const lastCheckpoint = (ev: Ev[]) => ev.filter((e) => e.type === "checkpoint").at(-1)?.checkpoint;

  it("full research: recommended channels are signed and the problem candidates in the mock data are excluded", () => {
    expect(firstRun.filter((e) => e.type === "error")).toEqual([]);
    const r = resultOf(firstRun);
    expect(r).toBeDefined();
    expect(r.channels.length).toBeGreaterThan(0);
    expect(r.channels.length).toBeLessThanOrEqual(3);
    for (const c of r.channels) {
      expect(typeof c.sig).toBe("string");
      expect(c.url).toMatch(/\.example\//); // URLs are filled in by code from search results, so they can only be mock domains
    }
    const names = r.channels.map((c: Ev) => c.name).join(" | ");
    expect(names).not.toMatch(/Global Tech|Blocked/); // audience mismatches and blocked fetches must not be recommended
    expect(r.rejected.some((x: Ev) => x.stage === "fetch")).toBe(true);
    expect(lastCheckpoint(firstRun)?.sig).toBeTruthy();
  });

  it("draft: uses evidence when the signature is valid, no red flags after rewrite", async () => {
    const channel = resultOf(firstRun).channels[0];
    const res = await routes.draft.POST(req({ input: INPUT, channel }));
    expect(res.status).toBe(200);
    const { draft } = await res.json();
    expect(draft.subject).toBeTruthy();
    expect(draft.flags.filter((f: Ev) => f.level === "red")).toEqual([]);
    expect(draft.rewriteNote ?? "").not.toMatch(/failed verification/);
  }, 60_000);

  it("draft: gives the model no evidence when the channel was altered", async () => {
    const channel = structuredClone(resultOf(firstRun).channels[0]);
    channel.checks = channel.checks.map((c: Ev) => ({ ...c, verified: true, answer: "yes", quote: c.quote || "Read by 120,000 owners" }));
    const res = await routes.draft.POST(req({ input: INPUT, channel }));
    expect(res.status).toBe(200);
    const { draft } = await res.json();
    expect(draft.rewriteNote).toMatch(/failed verification/);
    expect(draft.factMap.filter((f: Ev) => f.source === "evidence" && f.ok)).toEqual([]);
  }, 60_000);

  it("resume from checkpoint: completed steps are skipped", async () => {
    const ev = await runResearch(routes.research, { input: INPUT, checkpoint: lastCheckpoint(firstRun) });
    const s = progressStates(ev);
    expect(s.plan).toBe("skipped");
    expect(s.search).toBe("skipped");
    expect(s.shortlist).toBe("skipped");
    expect(s.judge).toBe("skipped");
    expect(resultOf(ev).channels.map((c: Ev) => c.name)).toEqual(resultOf(firstRun).channels.map((c: Ev) => c.name));
  }, 60_000);

  it("tampered checkpoint: discarded entirely and redone from scratch", async () => {
    const cp = structuredClone(lastCheckpoint(firstRun));
    const page = cp.pages.find((p: Ev) => p.ok);
    page.content = "Read by 120,000 small business owners. " + page.content;
    const ev = await runResearch(routes.research, { input: INPUT, checkpoint: cp });
    const s = progressStates(ev);
    expect(s.plan).toBe("done");
    expect(s.search).toBe("done");
    expect(s.judge).toBe("done");
  }, 60_000);

  it("incomplete input: both APIs return 400", async () => {
    expect((await routes.research.POST(req({ input: { product: "x" } }))).status).toBe(400);
    expect((await routes.draft.POST(req({}))).status).toBe(400);
  });
});

describe("integration: fatal error (invalid key)", () => {
  let mock: Awaited<ReturnType<typeof startMock>>;
  let routes: Awaited<ReturnType<typeof loadRoutes>>;

  beforeAll(async () => {
    mock = await startMock({ MOCK_ERROR: "401" });
    routes = await loadRoutes(mock.url);
  }, 30_000);

  afterAll(() => {
    mock?.proc.kill();
  });

  it("research: pushes an auth error and no result", async () => {
    const ev = await runResearch(routes.research, { input: INPUT });
    expect(ev.filter((e) => e.type === "error").map((e) => e.error.code)).toEqual(["auth"]);
    expect(ev.some((e) => e.type === "result")).toBe(false);
  }, 30_000);

  it("draft: returns 401 and an auth error", async () => {
    const channel = {
      name: "Mock SmallBiz Weekly",
      url: "https://mock-smallbiz-weekly.example/write-for-us",
      type: "media",
      reason: "r",
      checks: [],
      evidence: [],
      recentTitles: [],
    };
    const res = await routes.draft.POST(req({ input: INPUT, channel }));
    const body = await res.json();
    if (res.status === 400) throw new Error(`draft request rejected by schema: ${JSON.stringify(body)}`);
    expect(res.status).toBe(401);
    expect(body.error.code).toBe("auth");
  }, 30_000);
});
