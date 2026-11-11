// Export one research run as Markdown (input, channels, evidence, drafts)
import type { Draft, Research } from "./types";
import { CHANNEL_TYPE_LABEL, CHECK_LABEL, COLLAB_FORM_LABEL, PAID_LABEL, STATUS_LABEL } from "./types";

const ANSWER: Record<string, string> = { yes: "Yes", no: "No", unclear: "Unclear" };

export function researchToMarkdown(r: Research, drafts: Draft[]): string {
  const L: string[] = [];
  const i = r.input;
  L.push(`# Channel research: ${i.productName || i.product.slice(0, 30)}`);
  L.push("");
  L.push(`- Time: ${new Date(r.createdAt).toLocaleString("en-GB")}`);
  L.push(`- Status: ${STATUS_LABEL[r.status]}`);
  L.push("");
  L.push("> These results were generated with AI assistance and sources were checked automatically. Please manually confirm anything marked “Unverified” before reaching out.");
  L.push("");
  L.push("## Input");
  L.push("");
  L.push(`- Product description: ${i.product}`);
  L.push(`- Target customers: ${i.audience}`);
  L.push(`- Target market: ${i.market}`);
  if (i.productName) L.push(`- Product name: ${i.productName}`);
  if (i.productUrl) L.push(`- Product URL: ${i.productUrl}`);
  if (i.collabForms.length) L.push(`- Preferred collaboration forms: ${i.collabForms.map((f) => COLLAB_FORM_LABEL[f]).join(", ")}`);
  const ex = [...i.excludeUrls, ...r.autoExcluded];
  if (ex.length) L.push(`- Excluded channels: ${ex.join(", ")}`);
  L.push("");

  L.push(`## Recommended channels (${r.channels.length})`);
  L.push("");
  if (r.summary?.shortfallNote) L.push(`${r.summary.shortfallNote}\n`);
  r.channels.forEach((c, idx) => {
    L.push(`### ${idx + 1}. ${c.name}`);
    L.push("");
    L.push(`- URL: ${c.url}`);
    L.push(`- Type: ${CHANNEL_TYPE_LABEL[c.type]}`);
    L.push(`- Payment: ${PAID_LABEL[c.paid]}`);
    L.push(`- Why it fits: ${c.reason}`);
    L.push("");
    L.push("| Key check | Answer | Status | Quote |");
    L.push("| --- | --- | --- | --- |");
    for (const k of c.checks) {
      L.push(
        `| ${CHECK_LABEL[k.key]} | ${ANSWER[k.answer]}${k.note ? `: ${esc(k.note)}` : ""} | ${k.verified ? "Verified" : "Unverified"} | ${k.quote ? `"${esc(k.quote)}"` : "—"} |`,
      );
    }
    L.push("");
    if (c.evidence.length) {
      L.push("Evidence:");
      L.push("");
      for (const e of c.evidence) {
        L.push(`- [${e.verified ? "Verified" : "Unverified"}] ${e.claim} — "${e.quote}" ([source](${e.sourceUrl}))`);
      }
      L.push("");
    }
  });

  if (r.rejected.length) {
    L.push("## Excluded candidates");
    L.push("");
    for (const x of r.rejected) L.push(`- ${x.name} (${x.url}): ${x.reason}`);
    L.push("");
  }

  if (drafts.length) {
    L.push("## Outreach email drafts");
    L.push("");
    for (const d of drafts) {
      L.push(`### To ${d.channelName}`);
      L.push("");
      L.push(`**Subject:** ${d.subject}`);
      L.push("");
      L.push("```text");
      L.push(d.body);
      L.push("```");
      L.push("");
      const red = d.flags.filter((f) => f.level === "red");
      const ph = d.flags.filter((f) => f.kind === "placeholder");
      const yellow = d.flags.filter((f) => f.level === "yellow" && f.kind !== "placeholder");
      if (red.length) L.push(`- Red flags: ${red.map((f) => f.text).join("; ")}`);
      if (yellow.length) L.push(`- Yellow flags: ${yellow.map((f) => f.text).join("; ")}`);
      if (ph.length) L.push(`- Unfilled placeholders: ${ph.map((f) => f.text).join(" ")}`);
      if (d.factMap.length) {
        L.push("");
        L.push("Fact-check list:");
        L.push("");
        for (const f of d.factMap) {
          L.push(`- ${f.ok ? "✓" : "✗"} ${f.claim} ← ${f.source === "user_input" ? `your input “${f.ref}”` : f.ref}`);
        }
      }
      L.push("");
    }
  }

  if (r.summary?.queries.length) {
    L.push("## Search queries");
    L.push("");
    for (const q of r.summary.queries) L.push(`- \`${q}\``);
    L.push("");
  }
  return L.join("\n");
}

function esc(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
