/**
 * Local mock DeepSeek server: for testing the whole flow and error states offline without an API key.
 * All data is fictional (domains end in .example, channel names contain "Mock") and must not be taken as real research results.
 *
 * Usage:
 *   npm run mock                       # starts on http://localhost:8787
 *   MOCK_ERROR=401 npm run mock        # every request returns 401 (tests a bad key)
 *   MOCK_ERROR=402 / 429 / 500         # tests insufficient balance, rate limiting, server errors
 * Then set DEEPSEEK_BASE_URL=http://localhost:8787 and DEEPSEEK_API_KEY=mock in .env.local
 */
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 8787);
const FORCED = process.env.MOCK_ERROR ? Number(process.env.MOCK_ERROR) : 0;
const FETCH_FORCED = process.env.MOCK_FETCH_ERROR ? Number(process.env.MOCK_FETCH_ERROR) : 0;

const SITES = [
  {
    url: "https://mock-smallbiz-weekly.example/write-for-us",
    title: "Write for us | Mock SmallBiz Weekly",
    content: `# Write for Mock SmallBiz Weekly

Mock SmallBiz Weekly is a UK publication for owners of small businesses with fewer than 50 staff.
We accept guest articles from practitioners who can share practical advice. Contributions are free to submit and we never charge for editorial content.

## Recent articles
- How to run a weekly team meeting that takes 15 minutes
- Delegating tasks when you are the founder
`,
  },
  {
    url: "https://mock-founders-circle.example/community",
    title: "Mock Founders Circle – community for UK founders",
    content: `# Mock Founders Circle

An online community where UK founders of small teams swap advice. Members meet monthly for online workshops.
Partners can run a members-only demo or Q&A session; please contact the community team with a proposal.
Workshop partnerships are offered as paid sponsorship packages.
`,
  },
  {
    url: "https://mock-ops-letter.example/newsletter",
    title: "The Mock Ops Letter newsletter",
    content: `# The Mock Ops Letter

A fortnightly newsletter with operations tips for small business owners across the United Kingdom.
Reader-submitted practical articles are welcome: send us your pitch through the contact form.
`,
  },
  {
    url: "https://mock-global-tech.example/guest-post",
    title: "Global Tech Mock – guest post",
    content: `# Global Tech Mock

A technology blog for enterprise IT leaders worldwide. We accept guest posts on cloud infrastructure.
`,
  },
  {
    url: "https://mock-blocked-site.example/contribute",
    title: "Mock Blocked Site – contribute",
    content: "",
  },
];

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function chat(system: string, user: string): unknown {
  if (system.includes("short English search keywords")) {
    return { topic: "task management", audience: "small business owners", market: "UK", tld: ".co.uk" };
  }
  if (system.includes("shortlisting promotion channels")) {
    // deliberately includes a non-existent id R99 to check that code drops it
    return {
      picks: [
        { id: "R1", type: "media", why: "Publication for UK small business owners" },
        { id: "R2", type: "community", why: "UK founders community" },
        { id: "R3", type: "newsletter", why: "Small-business operations newsletter" },
        { id: "R4", type: "media", why: "Tech blog" },
        { id: "R5", type: "smb_site", why: "Submission page" },
        { id: "R99", type: "media", why: "Does not exist" },
      ],
    };
  }
  if (system.includes("assess ONE candidate")) {
    if (user.includes("mock-smallbiz-weekly")) {
      return {
        is_channel: true,
        name: "Mock SmallBiz Weekly",
        type: "media",
        reason: "Dedicated to UK small business owners and accepts practitioner contributions; a good fit for small-team management topics.",
        checks: {
          audience: { answer: "yes", note: "For owners of small businesses with fewer than 50 staff", quote: "a UK publication for owners of small businesses with fewer than 50 staff" },
          market: { answer: "yes", note: "UK publication", quote: "Mock SmallBiz Weekly is a UK publication" },
          accepts: { answer: "yes", note: "Accepts contributions", quote: "We accept guest articles from practitioners who can share practical advice." },
          paid: { answer: "no", note: "Free", quote: "we never charge for editorial content" },
        },
        evidence: [
          { claim: "Focuses on practical advice", quote: "practitioners who can share practical advice" },
          { claim: "(evidence made up by the model; should be marked unverified)", quote: "Read by 120,000 UK business owners every week" },
        ],
        recent_titles: ["Delegating tasks when you are the founder"],
        audience_relevance: 5,
        reachability: 5,
      };
    }
    if (user.includes("mock-founders-circle")) {
      return {
        is_channel: true,
        name: "Mock Founders Circle",
        type: "community",
        reason: "Community of UK small-team founders; open to members-only demos or Q&A.",
        checks: {
          audience: { answer: "yes", note: "Small-team founders", quote: "UK founders of small teams swap advice" },
          market: { answer: "yes", note: "UK", quote: "An online community where UK founders" },
          accepts: { answer: "yes", note: "Demos or Q&A possible", quote: "Partners can run a members-only demo or Q&A session" },
          paid: { answer: "yes", note: "Partnerships are paid sponsorships", quote: "Workshop partnerships are offered as paid sponsorship packages." },
        },
        evidence: [{ claim: "Monthly online events", quote: "Members meet monthly for online workshops." }],
        recent_titles: [],
        audience_relevance: 4,
        reachability: 4,
      };
    }
    if (user.includes("mock-ops-letter")) {
      return {
        is_channel: true,
        name: "The Mock Ops Letter",
        type: "newsletter",
        reason: "Operations-tips newsletter for UK small business owners; welcomes practical articles from readers.",
        checks: {
          audience: { answer: "yes", note: "Small business owners", quote: "operations tips for small business owners" },
          // the model paraphrased the page (it says United Kingdom), so this should be unverified → market unconfirmed → excluded
          market: { answer: "yes", note: "UK", quote: "small business owners in the UK" },
          accepts: { answer: "yes", note: "Welcomes contributions", quote: "Reader-submitted practical articles are welcome" },
          paid: { answer: "unclear", note: "", quote: "" },
        },
        evidence: [],
        recent_titles: [],
        audience_relevance: 4,
        reachability: 3,
      };
    }
    if (user.includes("mock-global-tech")) {
      return {
        is_channel: true,
        name: "Global Tech Mock",
        type: "media",
        reason: "Tech blog",
        checks: {
          audience: { answer: "no", note: "For enterprise IT leaders", quote: "A technology blog for enterprise IT leaders worldwide." },
          market: { answer: "unclear", note: "", quote: "" },
          accepts: { answer: "yes", note: "", quote: "We accept guest posts on cloud infrastructure." },
          paid: { answer: "unclear", note: "", quote: "" },
        },
        evidence: [],
        recent_titles: [],
        audience_relevance: 1,
        reachability: 4,
      };
    }
    return { bad: "shape" }; // triggers a zod validation failure → retry → still fails
  }
  if (system.includes("outreach email")) {
    const second = user.includes("YOUR PREVIOUS DRAFT HAD PROBLEMS");
    const body = `Hi [Editor's name],

I'm [Your name], [Your role] at [Product name]. We make a task management tool for small teams of 1 to 20 people: assigning tasks, deadline reminders and project progress in one place.

I enjoyed your piece "Delegating tasks when you are the founder" and noticed you accept guest articles from practitioners who can share practical advice.
${second ? "" : "\nOur users save 30% of their admin time.\n"}
A few article ideas for your readers:
- A simple weekly routine for assigning work in a small team
- How to set deadlines your team will actually hit
- Keeping projects visible without extra meetings

Would any of these suit Mock SmallBiz Weekly? If so, I'd be glad to send a full draft for your review.

Best regards,
[Your name]
[Product name] – [Product URL]`;
    return {
      subject: "Guest article idea for Mock SmallBiz Weekly readers",
      body,
      claims: [
        { claim: "We make a task management tool for small teams of 1 to 20 people", source: "user_input", ref: "product" },
        { claim: "you accept guest articles from practitioners", source: "evidence", ref: "E3" },
        ...(second ? [] : [{ claim: "Our users save 30% of their admin time.", source: "evidence", ref: "E42" }]),
      ],
    };
  }
  return {};
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (FORCED) return json(res, FORCED, { error: { message: `mock forced ${FORCED}` } });
    const body = raw ? JSON.parse(raw) : {};
    const url = req.url || "";
    if (url.startsWith("/v1/tools/search")) {
      const results = SITES.map((s, i) => ({
        rerank_score: 2.5 - i * 0.2,
        title: s.title,
        url: s.url,
        snippet: s.content.slice(0, 160),
        summary: "",
        content: "",
        site_name: null,
        site_icon: null,
        date: null,
        authority: -1,
      }));
      return json(res, 200, { results });
    }
    if (url.startsWith("/v1/tools/fetch")) {
      // MOCK_FETCH_ERROR=403 or 404: simulate Fetch blocked by security policy / no content (only affects fetching; search and chat work normally)
      if (FETCH_FORCED) return json(res, FETCH_FORCED, { error: { message: `mock fetch forced ${FETCH_FORCED}` } });
      const site = SITES.find((s) => body.url === s.url);
      if (!site || !site.content) return json(res, 200, { title: "", content: "" });
      return json(res, 200, { title: site.title, content: site.content });
    }
    if (url.startsWith("/chat/completions")) {
      const system = body.messages?.[0]?.content ?? "";
      const user = body.messages?.[1]?.content ?? "";
      const out = chat(system, user);
      return json(res, 200, { choices: [{ message: { content: JSON.stringify(out) } }] });
    }
    json(res, 404, { error: "not found" });
  });
});

server.listen(PORT, () => console.log(`Mock DeepSeek on http://localhost:${PORT}${FORCED ? ` (forcing HTTP ${FORCED})` : ""}`));
