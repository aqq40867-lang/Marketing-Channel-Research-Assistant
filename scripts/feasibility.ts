/**
 * Feasibility check (step 1 of the PRD build order):
 * Run a few UK small-business queries through DeepSeek Search to see whether real channels such as SmallBusiness.co.uk, Startup Donut and
 * Enterprise Nation show up; then Fetch the top results and run a quote check that the page title appears word for word in the body.
 *
 * Usage: npm run feasibility   (reads DEEPSEEK_API_KEY from .env.local or .env)
 */
import { existsSync, readFileSync } from "node:fs";
import { buildQueries } from "../src/lib/queries";
import { domainOf, quoteInText } from "../src/lib/text";

for (const f of [".env.local", ".env"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const KEY = process.env.DEEPSEEK_API_KEY;
const BASE = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
if (!KEY) {
  console.error("DEEPSEEK_API_KEY is missing: copy .env.example to .env.local and add your key first.");
  process.exit(1);
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

const EXPECTED = ["smallbusiness.co.uk", "startupdonut.co.uk", "enterprisenation.com"];

async function main() {
  const queries = buildQueries({ topic: "task management", audience: "small business owners", market: "UK", tld: ".co.uk" });
  const seen = new Map<string, { url: string; title: string; q: string }>();
  for (const { q } of queries) {
    try {
      const r = await call<{ results: { url: string; title: string }[] }>("/v1/tools/search", { query: q, count: 10 });
      console.log(`✓ ${r.results.length.toString().padStart(2)} hits  ${q}`);
      for (const x of r.results) if (!seen.has(domainOf(x.url))) seen.set(domainOf(x.url), { ...x, q });
    } catch (e) {
      console.log(`✕ search failed  ${q}  ${(e as Error).message}`);
    }
  }
  console.log(`\n${seen.size} domains after deduping.`);
  const ukLike = [...seen.keys()].filter((d) => d.endsWith(".uk"));
  console.log(`${ukLike.length} of them are .uk domains: ${ukLike.slice(0, 15).join(", ")}`);
  for (const d of EXPECTED) console.log(`${seen.has(d) ? "✓ found" : "✕ not found"}  ${d}`);

  console.log("\nFetching the top 5 results and checking quotes:");
  for (const x of [...seen.values()].slice(0, 5)) {
    try {
      const p = await call<{ title: string; content: string }>("/v1/tools/fetch", { url: x.url });
      const ok = p.title ? quoteInText(p.title.slice(0, 60), `${p.title}\n${p.content}`) : false;
      console.log(`✓ ${x.url}  body ${p.content.length} chars, title check ${ok ? "passed" : "failed"}`);
    } catch (e) {
      console.log(`✕ ${x.url}  ${(e as Error).message}`);
    }
  }
}
main();
